import { rm } from 'node:fs/promises'

for (const target of [
  'dist',
  'dist-electron',
  'packages/dsh-desktop-bridge/lib',
  'packages/dsh-desktop-vision/lib',
  'tsconfig.electron.tsbuildinfo',
  'packages/dsh-desktop-bridge/tsconfig.tsbuildinfo',
  'packages/dsh-desktop-vision/tsconfig.tsbuildinfo',
]) {
  await rm(new URL(`../${target}`, import.meta.url), { recursive: true, force: true })
}
