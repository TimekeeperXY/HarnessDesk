import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import { stringify } from 'yaml'
import type { DesktopBridgeCommand, DesktopBridgeEvent, RuntimeState, VisionBridgeConfig } from '../../shared/contracts.js'
import type { AppLogger } from '../logger.js'
import { JsonLineDecoder } from './jsonl.js'
import { parseHarnessUrl, waitForHarness } from './url.js'

const HARNESS_VERSION = '0.1.0-rc.6'
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 8_000

interface ControllerPaths {
  userData: string
  dshHome: string
  workspace: string
  resourcesPath: string
  packaged: boolean
  visionBridge: VisionBridgeConfig
}

interface RuntimeEvents {
  state: [RuntimeState]
  ready: [URL]
}

class TypedEmitter extends EventEmitter<RuntimeEvents> {}

export function resolveRuntimeExecutables(paths: Pick<ControllerPaths, 'packaged' | 'resourcesPath'>): {
  node: string
  dshBin: string
  bridge: string
} {
  if (paths.packaged) {
    const node = process.platform === 'win32'
      ? join(paths.resourcesPath, 'runtime', 'node', 'node.exe')
      : join(paths.resourcesPath, 'runtime', 'node', 'bin', 'node')
    return {
      node,
      dshBin: join(paths.resourcesPath, 'runtime', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      bridge: join(paths.resourcesPath, 'runtime', 'app', 'node_modules', '@harnessdesk', 'dsh-desktop-bridge', 'lib', 'index.js'),
    }
  }

  const require = createRequire(import.meta.url)
  const dshPackage = require.resolve('@deepseek-ai/dsh/package.json')
  const bridgePackage = require.resolve('@harnessdesk/dsh-desktop-bridge/package.json')
  return {
    node: process.env.HARNESSDESK_NODE_PATH?.trim() || 'node',
    dshBin: join(dirname(dshPackage), 'lib', 'bin.js'),
    bridge: join(dirname(bridgePackage), 'lib', 'index.js'),
  }
}

export class RuntimeController {
  private child: ChildProcess | undefined
  private control: Writable | undefined
  private startupAbort?: AbortController
  private expectedExit = false
  private state: RuntimeState = {
    phase: 'idle',
    harnessVersion: HARNESS_VERSION,
    activeTurns: 0,
  }
  readonly events = new TypedEmitter()

  constructor(private readonly logger: AppLogger) {}

  getState(): RuntimeState {
    return structuredClone(this.state)
  }

  setPreparing(progress: number): void {
    this.setState({ phase: 'preparing', activeTurns: 0, preparationProgress: Math.max(0, Math.min(1, progress)) })
  }

  async start(paths: ControllerPaths): Promise<URL> {
    if (this.state.phase === 'ready' && this.state.port !== undefined) {
      return new URL(`http://127.0.0.1:${this.state.port}/`)
    }
    if (this.state.phase === 'starting') throw new Error('Harness is already starting')

    this.expectedExit = false
    this.setState({ phase: 'starting', activeTurns: 0, startedAt: Date.now() })
    const executables = resolveRuntimeExecutables(paths)
    const patchPath = await this.writeBridgePatch(paths.userData, executables.bridge)
    await mkdir(paths.dshHome, { recursive: true })
    await this.logger.info(`Starting Harness ${HARNESS_VERSION} in ${paths.workspace}`)

    const child = spawn(executables.node, [
      executables.dshBin,
      '--profile', 'web',
      '--patch', patchPath,
      '--host', '127.0.0.1',
      '--port', '0',
    ], {
      cwd: paths.workspace,
      env: {
        ...process.env,
        DSH_HOME: paths.dshHome,
        DSH_TELEMETRY_DISABLED: '1',
        HARNESSDESK_DESKTOP: '1',
        HARNESSDESK_VISION_BRIDGE_ENABLED: paths.visionBridge.enabled ? '1' : '0',
        HARNESSDESK_VISION_ENDPOINT: paths.visionBridge.endpoint,
        HARNESSDESK_VISION_MODEL: paths.visionBridge.model,
      },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.control = child.stdio[4] as Writable
    this.startupAbort = new AbortController()

    child.on('error', error => {
      void this.fail(`Unable to launch Harness: ${error.message}`)
    })
    child.on('exit', (code, signal) => {
      this.child = undefined
      this.control = undefined
      this.startupAbort?.abort(new Error('Harness exited during startup'))
      if (this.expectedExit) {
        this.setState({ phase: 'idle', activeTurns: 0 })
        return
      }
      void this.fail(`Harness exited unexpectedly (${signal ?? code ?? 'unknown'})`)
    })

    this.pipeLogs(child.stdout, 'stdout')
    this.pipeLogs(child.stderr, 'stderr')
    this.consumeBridge(child.stdio[3] as Readable)

    try {
      const url = await this.waitForUrl(child.stdout as Readable, this.startupAbort.signal)
      await waitForHarness(url, START_TIMEOUT_MS, this.startupAbort.signal)
      const startedAt = this.state.startedAt
      this.setState({
        phase: 'ready',
        port: Number(url.port),
        activeTurns: this.state.activeTurns,
        ...(startedAt === undefined ? {} : { startedAt }),
      })
      this.events.emit('ready', url)
      await this.logger.info(`Harness ready at ${url.origin}`)
      return url
    } catch (error) {
      await this.fail(error instanceof Error ? error.message : String(error))
      await this.forceStop()
      throw error
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) {
      this.setState({ phase: 'idle', activeTurns: 0 })
      return
    }
    this.expectedExit = true
    this.setState({ phase: 'stopping', activeTurns: this.state.activeTurns })
    await this.logger.info('Requesting graceful Harness shutdown')
    const command: DesktopBridgeCommand = { type: 'shutdown' }
    this.control?.write(`${JSON.stringify(command)}\n`)

    const exited = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), STOP_TIMEOUT_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
    if (!exited) await this.forceStop()
    this.setState({ phase: 'idle', activeTurns: 0 })
  }

  private async waitForUrl(stdout: Readable, signal: AbortSignal): Promise<URL> {
    return await new Promise<URL>((resolve, reject) => {
      let buffer = ''
      const timeout = setTimeout(() => finish(new Error('Harness did not report a local URL')), START_TIMEOUT_MS)
      const onAbort = (): void => finish(signal.reason instanceof Error ? signal.reason : new Error('Startup cancelled'))
      const onData = (chunk: Buffer | string): void => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const url = parseHarnessUrl(line)
          if (url !== undefined) {
            cleanup()
            resolve(url)
            return
          }
        }
      }
      const cleanup = (): void => {
        clearTimeout(timeout)
        stdout.off('data', onData)
        signal.removeEventListener('abort', onAbort)
      }
      const finish = (error: Error): void => {
        cleanup()
        reject(error)
      }
      stdout.on('data', onData)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private pipeLogs(stream: Readable | null, source: string): void {
    stream?.on('data', chunk => {
      const lines = chunk.toString().split(/\r?\n/).filter((line: string) => line.length > 0)
      for (const line of lines) void this.logger.info(`[harness:${source}] ${line}`)
    })
  }

  private consumeBridge(stream: Readable): void {
    const decoder = new JsonLineDecoder<DesktopBridgeEvent>()
    stream.on('data', chunk => {
      try {
        for (const event of decoder.push(chunk)) this.applyBridgeEvent(event)
      } catch (error) {
        void this.logger.warn(`Invalid desktop bridge event: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  private applyBridgeEvent(event: DesktopBridgeEvent): void {
    switch (event.type) {
      case 'turn-started':
        this.setState({ activeTurns: this.state.activeTurns + 1 })
        break
      case 'turn-ended':
        this.setState({ activeTurns: Math.max(0, this.state.activeTurns - 1) })
        break
      case 'runtime-warning':
        void this.logger.warn(`[bridge] ${event.message}`)
        break
      case 'runtime-fatal':
        void this.fail(event.message)
        break
      case 'ready':
        void this.logger.info(`[bridge] ${event.type}`)
        break
      case 'shutdown-complete':
        void this.logger.info('[bridge] shutdown-complete')
        if (this.state.phase === 'stopping') this.child?.kill('SIGTERM')
        break
      default:
        event satisfies never
    }
  }

  private async writeBridgePatch(userData: string, bridgePath: string): Promise<string> {
    const path = join(userData, 'runtime', 'desktop.patch.yml')
    await mkdir(dirname(path), { recursive: true })
    const patch = [{
      insert: [{
        id: 'harnessdesk-desktop-bridge',
        name: pathToFileURL(bridgePath).href,
        config: { eventFd: 3, controlFd: 4 },
      }],
    }]
    await writeFile(path, stringify(patch), { encoding: 'utf8', mode: 0o600 })
    return path
  }

  private setState(patch: Partial<RuntimeState>): void {
    this.state = { ...this.state, ...patch, harnessVersion: HARNESS_VERSION }
    if (patch.phase !== undefined && patch.phase !== 'failed') delete this.state.error
    if (patch.port === undefined && patch.phase !== undefined && patch.phase !== 'ready') delete this.state.port
    if (patch.phase !== undefined && patch.phase !== 'preparing') delete this.state.preparationProgress
    this.events.emit('state', this.getState())
  }

  private async fail(message: string): Promise<void> {
    await this.logger.error(message)
    this.setState({ phase: 'failed', activeTurns: this.state.activeTurns, error: message })
  }

  private async forceStop(): Promise<void> {
    const child = this.child
    if (child?.pid === undefined) return
    await this.logger.warn(`Forcing Harness process tree ${child.pid} to stop`)
    if (process.platform === 'win32') {
      await new Promise<void>(resolve => {
        execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => resolve())
      })
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
  }
}
