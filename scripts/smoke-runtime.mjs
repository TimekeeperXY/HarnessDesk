import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppLogger } from '../dist-electron/main/logger.js'
import { RuntimeController } from '../dist-electron/main/runtime/controller.js'

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1')
const prepared = process.argv.includes('--prepared')
const temporary = await mkdtemp(join(tmpdir(), 'harnessdesk-smoke-'))
const logger = new AppLogger(temporary)
await logger.initialize()
const runtime = new RuntimeController(logger)

try {
  const url = await runtime.start({
    userData: temporary,
    dshHome: join(temporary, 'harness'),
    workspace: decodeURIComponent(root),
    resourcesPath: prepared ? join(decodeURIComponent(root), 'build') : '',
    packaged: prepared,
    visionBridge: { enabled: true, endpoint: 'http://127.0.0.1:1234/v1', model: 'qwen/qwen3.5-9b' },
  })
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Harness smoke request returned ${response.status}`)
  console.log(`Harness smoke test passed at ${url.origin}`)
} catch (error) {
  const logDirectory = join(temporary, 'logs')
  for (const name of await readdir(logDirectory).catch(() => [])) {
    console.error(await readFile(join(logDirectory, name), 'utf8'))
  }
  throw error
} finally {
  const stopStarted = Date.now()
  await runtime.stop()
  const stopElapsed = Date.now() - stopStarted
  let shutdownError
  if (stopElapsed >= 7_500) {
    const logDirectory = join(temporary, 'logs')
    for (const name of await readdir(logDirectory).catch(() => [])) {
      console.error(await readFile(join(logDirectory, name), 'utf8'))
    }
    shutdownError = new Error(`Harness did not shut down gracefully (${stopElapsed} ms)`)
  }
  await rm(temporary, { recursive: true, force: true })
  if (shutdownError !== undefined) throw shutdownError
}
