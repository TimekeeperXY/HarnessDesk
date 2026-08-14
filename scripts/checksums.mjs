import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const release = join(root, 'release')
const names = (await readdir(release)).filter(name => /\.(?:exe|dmg|zip)$/.test(name))
if (names.length === 0) throw new Error('No release artifacts found')
const lines = []
for (const name of names.sort()) {
  const digest = createHash('sha256').update(await readFile(join(release, name))).digest('hex')
  lines.push(`${digest}  ${basename(name)}`)
}
await writeFile(join(release, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)
console.log(`Wrote checksums for ${names.length} artifact(s)`)
