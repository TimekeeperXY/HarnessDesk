import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { transformUnsupportedImagePrompt } from '../packages/dsh-desktop-vision/lib/index.js'

const imagePath = process.argv[2]
const model = process.argv[3] ?? ''
if (!imagePath) throw new Error('Usage: node scripts/smoke-vision.mjs <image> [model]')
const mediaType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[extname(imagePath).toLowerCase()]
if (!mediaType) throw new Error('Unsupported smoke-test image type')
const result = await transformUnsupportedImagePrompt([
  { type: 'text', text: 'Describe this interface and identify the product name.' },
  { type: 'image', data: (await readFile(imagePath)).toString('base64'), mediaType, name: basename(imagePath) },
], { enabled: true, endpoint: 'http://127.0.0.1:1234/v1', model })
const visual = result.at(-1)?.text ?? ''
if (!visual.includes('harnessdesk_visual_context')) throw new Error('Vision bridge returned no visual context')
console.log(visual.slice(0, 1200))
