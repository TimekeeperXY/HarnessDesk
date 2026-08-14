import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as tar from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { ensurePackagedRuntime } from '../src/main/runtime/store.js'

const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))))

describe('packaged runtime store', () => {
  it('extracts once, validates the bundle, and reuses the versioned cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harnessdesk-runtime-'))
    temporary.push(root)
    const resourcesPath = join(root, 'resources')
    const source = join(root, 'source')
    const nodeRelative = process.platform === 'win32' ? join('runtime', 'node', 'node.exe') : join('runtime', 'node', 'bin', 'node')
    const dshRelative = join('runtime', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await mkdir(dirname(join(source, nodeRelative)), { recursive: true })
    await mkdir(dirname(join(source, dshRelative)), { recursive: true })
    await writeFile(join(source, nodeRelative), 'node')
    await writeFile(join(source, dshRelative), 'dsh')
    const bundle = join(resourcesPath, 'runtime-bundle')
    await mkdir(bundle, { recursive: true })
    const archive = join(bundle, 'runtime.tar.gz')
    await tar.c({ cwd: source, file: archive, gzip: true }, ['runtime'])
    const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify({ runtimeId: 'fixture-win-x64', archiveSha256: checksum, entryCount: 8 }))
    const progress: number[] = []
    const userData = join(root, 'user-data')

    const first = await ensurePackagedRuntime({ resourcesPath, userData, onProgress: value => progress.push(value) })
    expect(await readFile(join(first, dshRelative), 'utf8')).toBe('dsh')
    expect(progress.at(-1)).toBe(1)
    const second = await ensurePackagedRuntime({ resourcesPath, userData, onProgress: value => progress.push(value) })
    expect(second).toBe(first)
  })
})
