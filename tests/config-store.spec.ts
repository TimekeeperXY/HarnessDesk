import { describe, expect, it } from 'vitest'
import { defaultLocale, migrateConfig } from '../src/main/config-store.js'

describe('desktop config', () => {
  it('selects Chinese only for Chinese system locales', () => {
    expect(defaultLocale('zh-HK')).toBe('zh-CN')
    expect(defaultLocale('en-US')).toBe('en')
  })

  it('migrates malformed values to safe defaults', () => {
    expect(migrateConfig({ locale: 'xx', onboardingComplete: 'yes', windowBounds: { width: 2 }, tts: { model: 'unsupported' } }, 'en-US'))
      .toMatchObject({
        locale: 'en',
        onboardingComplete: false,
        windowBounds: { width: 1180, height: 780 },
        tts: { model: 'mimo-v2.5-tts', endpoint: 'https://api.xiaomimimo.com/v1' },
      })
  })

  it('preserves supported user choices', () => {
    expect(migrateConfig({
      schemaVersion: 0,
      locale: 'zh-CN',
      onboardingComplete: true,
      lastWorkspace: 'C:\\项目',
      windowBounds: { width: 900, height: 600, x: 10, y: 20 },
      updateChecksEnabled: true,
      visionBridge: { enabled: false, endpoint: 'http://localhost:1234/v1', model: 'qwen-vision' },
      tts: {
        enabled: false,
        autoPlay: false,
        endpoint: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2.5-tts',
        voice: 'mimo_default',
        style: '',
        format: 'wav',
      },
    }, 'en-US')).toEqual({
      schemaVersion: 1,
      locale: 'zh-CN',
      onboardingComplete: true,
      lastWorkspace: 'C:\\项目',
      windowBounds: { width: 900, height: 600, x: 10, y: 20 },
      updateChecksEnabled: true,
      visionBridge: { enabled: false, endpoint: 'http://localhost:1234/v1', model: 'qwen-vision' },
      tts: {
        enabled: false,
        autoPlay: false,
        endpoint: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2.5-tts',
        voice: 'mimo_default',
        style: '',
        format: 'wav',
      },
    })
  })
})
