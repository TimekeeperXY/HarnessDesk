import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPE_OR_MAP = /(?:\.d\.(?:ts|mts|cts)|\.map)$/

async function removeBuildOnlyFiles(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) await removeBuildOnlyFiles(child)
    else if (TYPE_OR_MAP.test(entry.name)) await rm(child, { force: true })
  }
}

export async function pruneRuntime(runtimeRoot, platform) {
  const nodeRoot = join(runtimeRoot, 'node')
  const keep = platform === 'win32'
    ? new Set(['node.exe', 'LICENSE', 'README.md'])
    : new Set(['bin', 'LICENSE', 'README.md'])
  for (const entry of await readdir(nodeRoot, { withFileTypes: true })) {
    if (!keep.has(entry.name)) await rm(join(nodeRoot, entry.name), { recursive: true, force: true })
  }
  if (platform !== 'win32') {
    for (const entry of await readdir(join(nodeRoot, 'bin'), { withFileTypes: true })) {
      if (entry.name !== 'node') await rm(join(nodeRoot, 'bin', entry.name), { recursive: true, force: true })
    }
  }

  const modules = join(runtimeRoot, 'app', 'node_modules')
  const buildOnlyDirectories = [
    ['@mistralai', 'mistralai', 'src'], ['@mistralai', 'mistralai', 'examples'],
    ['@mistralai', 'mistralai', 'packages'], ['@mistralai', 'mistralai', 'tests'],
    ['openai', 'src'], ['@anthropic-ai', 'sdk', 'src'], ['@anthropic-ai', 'sdk', '.github'],
    ['@smithy', 'core', 'dist-types'],
  ]
  for (const parts of buildOnlyDirectories) await rm(join(modules, ...parts), { recursive: true, force: true })
  await removeBuildOnlyFiles(modules)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtimeRoot = process.argv[2]
  if (!runtimeRoot) throw new Error('Usage: node prune-runtime.mjs <runtime-root> [platform]')
  await pruneRuntime(runtimeRoot, process.argv[3] ?? process.platform)
}
