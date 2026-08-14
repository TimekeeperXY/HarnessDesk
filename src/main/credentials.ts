import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseDocument } from 'yaml'

const KEY_NAME = 'DEEPSEEK_API_KEY'
const MIMO_KEY_NAME = 'MIMO_API_KEY'

export function credentialPath(dshHome: string): string {
  return join(dshHome, '.credentials.yaml')
}

export async function writeDeepSeekCredential(dshHome: string, apiKey: string): Promise<void> {
  const value = apiKey.trim()
  if (value.length === 0) return
  if (/\r|\n|\0/.test(value)) throw new Error('API key contains unsupported characters')

  const path = credentialPath(dshHome)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  let source = ''
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const document = parseDocument(source || '{}\n', { uniqueKeys: true })
  if (document.errors.length > 0) throw new Error('The existing Harness credential file is invalid')
  const existing = document.toJS() as unknown
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
    throw new Error('The existing Harness credential file must contain a mapping')
  }
  document.set(KEY_NAME, value)

  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, document.toString(), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
  if (process.platform !== 'win32') {
    await chmod(dirname(path), 0o700)
    await chmod(path, 0o600)
  }
}

export function mimoCredentialPath(userData: string): string {
  return join(userData, 'mimo-credentials.yaml')
}

export async function writeMiMoCredential(userData: string, apiKey: string): Promise<void> {
  const value = apiKey.trim()
  if (value.length === 0) return
  if (/\r|\n|\0/.test(value)) throw new Error('API key contains unsupported characters')
  const path = mimoCredentialPath(userData)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  let source = ''
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const document = parseDocument(source || '{}\n', { uniqueKeys: true })
  if (document.errors.length > 0) throw new Error('The existing MiMo credential file is invalid')
  const existing = document.toJS() as unknown
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
    throw new Error('The existing MiMo credential file must contain a mapping')
  }
  document.set(MIMO_KEY_NAME, value)
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, document.toString(), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
  if (process.platform !== 'win32') {
    await chmod(dirname(path), 0o700)
    await chmod(path, 0o600)
  }
}

export async function readMiMoCredential(userData: string): Promise<string | undefined> {
  try {
    const document = parseDocument(await readFile(mimoCredentialPath(userData), 'utf8'), { uniqueKeys: true })
    if (document.errors.length > 0) return undefined
    const value = document.get(MIMO_KEY_NAME)
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
