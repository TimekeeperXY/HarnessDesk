import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { translator } from '../src/renderer/i18n.js'

describe('shell copy', () => {
  it('provides both language variants', () => {
    expect(translator('en')('launch')).toBe('Launch Harness')
    expect(translator('zh-CN')('launch')).toBe('启动 Harness')
  })

  it('contains no decorative long dash characters', async () => {
    const source = await readFile(new URL('../src/renderer/i18n.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/[—–]/)
  })
})
