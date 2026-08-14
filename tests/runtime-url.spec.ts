import { describe, expect, it } from 'vitest'
import { parseHarnessUrl } from '../src/main/runtime/url.js'

describe('Harness URL validation', () => {
  it('accepts only an explicit loopback HTTP URL with a valid port', () => {
    expect(parseHarnessUrl('dsh web: http://127.0.0.1:43127')?.port).toBe('43127')
    expect(parseHarnessUrl('dsh web: http://localhost:43127')).toBeUndefined()
    expect(parseHarnessUrl('dsh web: https://127.0.0.1:43127')).toBeUndefined()
    expect(parseHarnessUrl('dsh web: http://127.0.0.1:43127?next=https://evil.test')).toBeUndefined()
  })
})
