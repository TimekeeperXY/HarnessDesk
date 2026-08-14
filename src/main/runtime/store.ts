import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import * as tar from 'tar'

interface RuntimeBundleManifest {
  runtimeId: string
  archiveSha256: string
  entryCount: number
}

function safeRuntimeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error('Bundled runtime manifest has an invalid id')
  return value
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function extractWithSystemTar(archive: string, target: string, entryCount: number, onProgress: (value: number) => void): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('tar.exe', ['-xvzf', archive, '-C', target], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let entries = 0
    let carry = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      const text = carry + chunk.toString()
      const lines = text.split(/\r?\n/)
      carry = lines.pop() ?? ''
      entries += lines.filter(Boolean).length
      onProgress(Math.min(0.99, 0.02 + (entries / entryCount) * 0.97))
    })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolvePromise() : reject(new Error(`Windows runtime extraction failed (${code}): ${stderr.trim()}`)))
  })
}

export async function ensurePackagedRuntime(options: {
  resourcesPath: string
  userData: string
  onProgress(progress: number): void
}): Promise<string> {
  const bundle = resolve(options.resourcesPath, 'runtime-bundle')
  const archive = join(bundle, 'runtime.tar.gz')
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')) as Partial<RuntimeBundleManifest>
  const runtimeId = safeRuntimeId(manifest.runtimeId)
  if (typeof manifest.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.archiveSha256)) throw new Error('Bundled runtime manifest has an invalid checksum')
  const entryCount = typeof manifest.entryCount === 'number' && manifest.entryCount > 0 ? manifest.entryCount : 1
  const cacheRoot = resolve(options.userData, 'runtime-cache')
  const target = join(cacheRoot, runtimeId)
  const marker = join(target, '.ready')
  if (await exists(marker) && (await readFile(marker, 'utf8')).trim() === manifest.archiveSha256) {
    options.onProgress(1)
    return target
  }

  await mkdir(cacheRoot, { recursive: true })
  const partial = join(cacheRoot, `${runtimeId}.partial-${process.pid}`)
  const relativePartial = relative(cacheRoot, partial)
  if (relativePartial.startsWith('..') || isAbsolute(relativePartial)) throw new Error('Unsafe runtime cache path')
  await rm(partial, { recursive: true, force: true })
  await mkdir(partial, { recursive: true })
  let entries = 0
  options.onProgress(0)
  try {
    if (await sha256(archive) !== manifest.archiveSha256) throw new Error('Bundled Harness runtime failed its integrity check')
    options.onProgress(0.02)
    if (process.platform === 'win32') {
      await extractWithSystemTar(archive, partial, entryCount, options.onProgress)
    } else {
      await tar.x({
        cwd: partial,
        file: archive,
        strict: true,
        preservePaths: false,
        onentry: () => {
          entries += 1
          if (entries === 1 || entries % 80 === 0) options.onProgress(Math.min(0.99, 0.02 + (entries / entryCount) * 0.97))
        },
      })
    }
    const nodePath = process.platform === 'win32'
      ? join(partial, 'runtime', 'node', 'node.exe')
      : join(partial, 'runtime', 'node', 'bin', 'node')
    await access(nodePath)
    await access(join(partial, 'runtime', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    await writeFile(join(partial, '.ready'), `${manifest.archiveSha256}\n`, { mode: 0o600 })
    if (await exists(target)) await rm(target, { recursive: true, force: true })
    await rename(partial, target)
    options.onProgress(1)
    return target
  } catch (error) {
    await rm(partial, { recursive: true, force: true })
    throw error
  }
}
