import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import extract from 'extract-zip'
import * as tar from 'tar'
import { patchHarnessRuntime } from './patch-harness-runtime.mjs'
import { pruneRuntime } from './prune-runtime.mjs'
import { archiveRuntime } from './archive-runtime.mjs'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const readFlag = name => {
  const inline = args.find(arg => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const platform = readFlag('--platform') ?? process.platform
const arch = readFlag('--arch') ?? process.arch
const nodeVersion = '22.19.0'
const extension = platform === 'win32' ? 'zip' : 'tar.gz'
const platformName = platform === 'win32' ? 'win' : platform
const archiveName = `node-v${nodeVersion}-${platformName}-${arch}.${extension}`
const distribution = `https://nodejs.org/dist/v${nodeVersion}`
const runtimeRoot = join(root, 'build', 'runtime')
const bundleRoot = join(root, 'build', 'runtime-bundle')
const cacheRoot = join(root, '.cache', 'node-runtime')
const extractRoot = join(cacheRoot, `node-v${nodeVersion}-${platformName}-${arch}`)

async function download(url, path) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`)
  await writeFile(path, Buffer.from(await response.arrayBuffer()))
}

await mkdir(cacheRoot, { recursive: true })
const archivePath = join(cacheRoot, archiveName)
try {
  await readFile(archivePath)
} catch {
  console.log(`Downloading ${archiveName}`)
  await download(`${distribution}/${archiveName}`, archivePath)
}

const checksumsPath = join(cacheRoot, `SHASUMS256-${nodeVersion}.txt`)
await download(`${distribution}/SHASUMS256.txt`, checksumsPath)
const expectedLine = (await readFile(checksumsPath, 'utf8')).split(/\r?\n/).find(line => line.endsWith(`  ${archiveName}`))
if (!expectedLine) throw new Error(`No checksum published for ${archiveName}`)
const expected = expectedLine.split(/\s+/)[0]
const actual = createHash('sha256').update(await readFile(archivePath)).digest('hex')
if (actual !== expected) throw new Error(`Checksum mismatch for ${archiveName}`)

await rm(extractRoot, { recursive: true, force: true })
await mkdir(extractRoot, { recursive: true })
if (extension === 'zip') await extract(archivePath, { dir: extractRoot })
else await tar.x({ file: archivePath, cwd: extractRoot })
const [distributionRoot] = await readdir(extractRoot)
if (!distributionRoot) throw new Error('Node archive was empty')

await rm(runtimeRoot, { recursive: true, force: true })
await mkdir(runtimeRoot, { recursive: true })
await cp(join(extractRoot, distributionRoot), join(runtimeRoot, 'node'), { recursive: true })

const runtimeApp = join(runtimeRoot, 'app')
await mkdir(runtimeApp, { recursive: true })
await writeFile(join(runtimeApp, 'package.json'), JSON.stringify({
  name: '@harnessdesk/runtime',
  private: true,
  version: '0.1.0',
  type: 'module',
  dependencies: {
    '@deepseek-ai/cordis': '4.0.1',
    '@deepseek-ai/dsh': '0.1.0-rc.6',
  },
}, null, 2) + '\n')
const npmCli = platform === 'win32'
  ? join(runtimeRoot, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : join(runtimeRoot, 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
await execFileAsync(process.execPath, [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--save-exact'], {
  cwd: runtimeApp,
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024,
})

const bridgeTarget = join(runtimeApp, 'node_modules', '@harnessdesk', 'dsh-desktop-bridge')
await mkdir(bridgeTarget, { recursive: true })
await cp(join(root, 'packages', 'dsh-desktop-bridge', 'lib'), join(bridgeTarget, 'lib'), { recursive: true })
await cp(join(root, 'packages', 'dsh-desktop-bridge', 'package.json'), join(bridgeTarget, 'package.json'))

const visionTarget = join(runtimeApp, 'node_modules', '@harnessdesk', 'dsh-desktop-vision')
await mkdir(visionTarget, { recursive: true })
await cp(join(root, 'packages', 'dsh-desktop-vision', 'lib'), join(visionTarget, 'lib'), { recursive: true })
await cp(join(root, 'packages', 'dsh-desktop-vision', 'package.json'), join(visionTarget, 'package.json'))
await patchHarnessRuntime(runtimeApp)
await pruneRuntime(runtimeRoot, platform)

await writeFile(join(runtimeRoot, 'manifest.json'), JSON.stringify({
  nodeVersion,
  harnessVersion: '0.1.0-rc.6',
  platform,
  arch,
  sourceArchive: basename(archivePath),
  sourceSha256: actual,
}, null, 2) + '\n')

await archiveRuntime({
  runtimeRoot,
  bundleRoot,
  runtimeId: `harness-0.1.0-rc.6-node-${nodeVersion}-${platform}-${arch}`,
})
console.log(`Prepared ${platform}/${arch} runtime bundle at ${bundleRoot}`)
