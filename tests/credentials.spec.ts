import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { credentialPath, writeDeepSeekCredential } from '../src/main/credentials.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Harness credentials', () => {
  it('writes and updates the official YAML document without exposing another key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harnessdesk-credentials-'))
    roots.push(root)
    await writeDeepSeekCredential(root, 'sk-first-value')
    await writeDeepSeekCredential(root, 'sk-second-value')
    expect(await readFile(credentialPath(root), 'utf8')).toContain('DEEPSEEK_API_KEY: sk-second-value')
  })

  it('rejects multiline values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harnessdesk-credentials-'))
    roots.push(root)
    await expect(writeDeepSeekCredential(root, 'sk-a\nmalicious: value')).rejects.toThrow('unsupported characters')
  })
})
