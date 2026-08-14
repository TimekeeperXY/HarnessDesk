import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
const build = join(root, 'build')
await mkdir(build, { recursive: true })
await sharp(join(build, 'icon.svg')).resize(1024, 1024).png().toFile(join(build, 'icon.png'))
console.log('Prepared build/icon.png')
