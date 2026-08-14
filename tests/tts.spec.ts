import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeTtsEndpoint, streamMiMoSpeech, synthesizeMiMoSpeech } from '../src/main/tts.js'

afterEach(() => vi.unstubAllGlobals())

describe('MiMo TTS endpoint', () => {
  it('normalizes the API base and completion URL', () => {
    expect(normalizeTtsEndpoint('https://api.xiaomimimo.com/v1/')).toBe('https://api.xiaomimimo.com/v1')
    expect(normalizeTtsEndpoint('https://api.xiaomimimo.com/v1/chat/completions')).toBe('https://api.xiaomimimo.com/v1')
  })

  it('rejects non-HTTPS endpoints and embedded credentials', () => {
    expect(() => normalizeTtsEndpoint('http://127.0.0.1:8080/v1')).toThrow('HTTPS')
    expect(() => normalizeTtsEndpoint('https://user:pass@example.com/v1')).toThrow('credentials')
    expect(() => normalizeTtsEndpoint('https://api.xiaomimimo.com/v1?key=secret')).toThrow('query')
  })

  it('sends the selected answer as an assistant message without exposing the key in authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { audio: { data: 'AQID' } } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await synthesizeMiMoSpeech({
      enabled: true,
      autoPlay: false,
      endpoint: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5-tts',
      voice: 'Mia',
      style: '温和、清晰',
      format: 'wav',
    }, '回答 <harnessdesk_visual_context>内部描述</harnessdesk_visual_context>你好', 'F:/unused', 'mimo-test-key')
    expect(result).toEqual({ ok: true, audioBase64: 'AQID', format: 'wav' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'api-key': 'mimo-test-key' })
    expect(init.body).toContain('"role":"assistant"')
    expect(init.body).toContain('回答 你好')
    expect(init.body).not.toContain('内部描述')
    expect(init.body).toContain('"voice":"Mia"')
  })

  it('normalizes a returned audio data URL and detects WAV bytes', async () => {
    const wav = Buffer.from('RIFF----WAVE', 'ascii').toString('base64')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { audio: { data: `data:audio/wav;base64,${wav}` } } }] }), { status: 200 })))
    const result = await synthesizeMiMoSpeech({
      enabled: true,
      autoPlay: false,
      endpoint: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5-tts',
      voice: 'Mia',
      style: '',
      format: 'mp3',
    }, '测试', 'F:/unused', 'mimo-test-key')
    expect(result).toEqual({ ok: true, audioBase64: wav, format: 'wav' })
  })

  it('parses MiMo PCM16 SSE chunks for low-latency playback', async () => {
    const chunk = Buffer.from(new Int16Array([0, 16384, -16384]).buffer).toString('base64')
    const payload = [
      `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: chunk } } }] })}\n\n`,
      'data: [DONE]\n\n',
    ].join('')
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const events: Array<{ type: string; audioBase64?: string; sampleRate?: number }> = []
    await streamMiMoSpeech({
      enabled: true,
      autoPlay: false,
      endpoint: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5-tts',
      voice: 'Mia',
      style: '温和、清晰',
      format: 'wav',
    }, '流式测试', 'F:/unused', value => events.push(value), new AbortController().signal, 'mimo-test-key')
    expect(events).toEqual([{ type: 'chunk', audioBase64: chunk, sampleRate: 24000 }])
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toContain('"stream":true')
    expect(init.body).toContain('"format":"pcm16"')
  })
})
