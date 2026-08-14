import { mkdir, open, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const KEEP_DAYS = 14

export function redactSecrets(input: string): string {
  return input
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
}

function dateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export class AppLogger {
  readonly directory: string

  constructor(userData: string) {
    this.directory = join(userData, 'logs')
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    await this.prune()
  }

  async info(message: string): Promise<void> {
    await this.write('INFO', message)
  }

  async warn(message: string): Promise<void> {
    await this.write('WARN', message)
  }

  async error(message: string): Promise<void> {
    await this.write('ERROR', message)
  }

  private async write(level: string, message: string): Promise<void> {
    const path = join(this.directory, `harnessdesk-${dateStamp()}.log`)
    const file = await open(path, 'a', 0o600)
    try {
      await file.write(`${new Date().toISOString()} ${level} ${redactSecrets(message)}\n`)
    } finally {
      await file.close()
    }
  }

  private async prune(): Promise<void> {
    const names = (await readdir(this.directory)).filter(name => /^harnessdesk-\d{4}-\d{2}-\d{2}\.log$/.test(name))
    const entries = await Promise.all(names.map(async name => {
      const path = join(this.directory, name)
      return { path, ...(await stat(path)) }
    }))
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
    let total = 0
    for (const entry of entries) {
      total += entry.size
      if (entry.mtimeMs < cutoff || total > MAX_TOTAL_BYTES) await unlink(entry.path)
    }
  }
}
