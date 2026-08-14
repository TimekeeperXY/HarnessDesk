import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../src/main/logger.js'

describe('log redaction', () => {
  it('redacts common API key and authorization forms', () => {
    const value = redactSecrets('Authorization: Bearer abc123 api_key=xyz sk-secretvalue')
    expect(value).not.toContain('abc123')
    expect(value).not.toContain('xyz')
    expect(value).not.toContain('secretvalue')
  })
})
