import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar'

async function countEntries(path) {
  let count = 1
  for (const entry of await readdir(path, { withFileTypes: true })) {
    count += 1
    if (entry.isDirectory()) count += await countEntries(join(path, entry.name)) - 1
  }
  return count
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function archiveRuntime({ runtimeRoot, bundleRoot, runtimeId }) {
  await rm(bundleRoot, { recursive: true, force: true })
  await mkdir(bundleRoot, { recursive: true })
  const archivePath = join(bundleRoot, 'runtime.tar.gz')
  const entryCount = await countEntries(runtimeRoot)
  console.log(`Compressing ${entryCount} runtime entries into a single install resource`)
  await tar.c({ cwd: dirname(runtimeRoot), file: archivePath, gzip: { level: 1 }, portable: true }, [basename(runtimeRoot)])
  const archiveSha256 = await hashFile(archivePath)
  await writeFile(join(bundleRoot, 'manifest.json'), JSON.stringify({ runtimeId, archiveSha256, entryCount }, null, 2) + '\n')
  return { archivePath, archiveSha256, entryCount }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [runtimeRoot, bundleRoot, runtimeId] = process.argv.slice(2)
  if (!runtimeRoot || !bundleRoot || !runtimeId) throw new Error('Usage: node archive-runtime.mjs <runtime-root> <bundle-root> <runtime-id>')
  await archiveRuntime({ runtimeRoot, bundleRoot, runtimeId })
}
