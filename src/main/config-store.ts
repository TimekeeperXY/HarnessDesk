import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DesktopConfig, Locale, TtsConfig, TtsModel, VisionBridgeConfig, WindowBounds } from '../shared/contracts.js'

const CONFIG_FILENAME = 'desktop-config.json'

export function defaultLocale(systemLocale: string): Locale {
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function defaultConfig(systemLocale: string): DesktopConfig {
  return {
    schemaVersion: 1,
    locale: defaultLocale(systemLocale),
    onboardingComplete: false,
    windowBounds: { width: 1180, height: 780 },
    updateChecksEnabled: false,
    visionBridge: { enabled: true, endpoint: 'http://127.0.0.1:1234/v1', model: '' },
    tts: {
      enabled: false,
      autoPlay: false,
      endpoint: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5-tts',
      voice: 'mimo_default',
      style: '',
      format: 'wav',
    },
  }
}

function validVisionBridge(value: unknown): value is VisionBridgeConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<VisionBridgeConfig>
  return typeof candidate.enabled === 'boolean'
    && typeof candidate.endpoint === 'string'
    && typeof candidate.model === 'string'
}

const TTS_MODELS: readonly TtsModel[] = ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone']

function validTtsConfig(value: unknown): value is TtsConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<TtsConfig>
  return typeof candidate.enabled === 'boolean'
    && typeof candidate.autoPlay === 'boolean'
    && typeof candidate.endpoint === 'string'
    && TTS_MODELS.includes(candidate.model as TtsModel)
    && typeof candidate.voice === 'string'
    && typeof candidate.style === 'string'
    && (candidate.format === 'mp3' || candidate.format === 'wav')
}

function validBounds(value: unknown): value is WindowBounds {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<WindowBounds>
  return Number.isInteger(candidate.width) && Number.isInteger(candidate.height)
    && (candidate.width ?? 0) >= 760 && (candidate.height ?? 0) >= 560
}

export function migrateConfig(raw: unknown, systemLocale: string): DesktopConfig {
  const fallback = defaultConfig(systemLocale)
  if (typeof raw !== 'object' || raw === null) return fallback
  const source = raw as Record<string, unknown>
  const locale: Locale = source.locale === 'zh-CN' || source.locale === 'en'
    ? source.locale
    : fallback.locale
  const lastWorkspace = typeof source.lastWorkspace === 'string' && source.lastWorkspace.length > 0
    ? source.lastWorkspace
    : undefined
  return {
    schemaVersion: 1,
    locale,
    onboardingComplete: source.onboardingComplete === true,
    ...(lastWorkspace === undefined ? {} : { lastWorkspace }),
    windowBounds: validBounds(source.windowBounds) ? source.windowBounds : fallback.windowBounds,
    updateChecksEnabled: source.updateChecksEnabled === true,
    visionBridge: validVisionBridge(source.visionBridge) ? source.visionBridge : fallback.visionBridge,
    tts: validTtsConfig(source.tts) ? source.tts : fallback.tts,
  }
}

export class ConfigStore {
  private value: DesktopConfig
  private readonly path: string

  private constructor(path: string, value: DesktopConfig) {
    this.path = path
    this.value = value
  }

  static async open(userData: string, systemLocale: string): Promise<ConfigStore> {
    const path = join(userData, CONFIG_FILENAME)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') parsed = undefined
    }
    return new ConfigStore(path, migrateConfig(parsed, systemLocale))
  }

  get(): DesktopConfig {
    return structuredClone(this.value)
  }

  async update(patch: Partial<Omit<DesktopConfig, 'schemaVersion'>>): Promise<DesktopConfig> {
    this.value = { ...this.value, ...patch, schemaVersion: 1 }
    await this.persist()
    return this.get()
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.path)
  }
}
