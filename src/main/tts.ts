import type { TtsAudioFormat, TtsConfig, TtsModel, TtsStreamEvent, TtsSynthesisResult } from '../shared/contracts.js'
import { readMiMoCredential } from './credentials.js'

const MAX_TEXT_LENGTH = 12_000
const TTS_MODELS: readonly TtsModel[] = ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone']

function validTtsModel(value: unknown): value is TtsModel {
  return typeof value === 'string' && TTS_MODELS.includes(value as TtsModel)
}

function validAudioFormat(value: unknown): value is TtsAudioFormat {
  return value === 'mp3' || value === 'wav'
}

function formatFromMime(mime: string): TtsAudioFormat | undefined {
  const normalized = mime.toLowerCase()
  if (normalized === 'wav') return 'wav'
  if (normalized === 'mp3') return 'mp3'
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav' || normalized === 'audio/wave') return 'wav'
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3'
  return undefined
}

function normalizeAudioPayload(raw: string): { base64: string; format?: TtsAudioFormat } {
  const trimmed = raw.trim()
  const dataUrl = /^data:([^;,]+);base64,(.*)$/is.exec(trimmed)
  const format = dataUrl?.[1] === undefined ? undefined : formatFromMime(dataUrl[1])
  const base64 = (dataUrl?.[2] ?? trimmed).replace(/\s/g, '')
  return format === undefined ? { base64 } : { base64, format }
}

function inferAudioFormat(base64: string): TtsAudioFormat | undefined {
  try {
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav'
    if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3'
  } catch { /* use the configured format */ }
  return undefined
}

export function normalizeTtsEndpoint(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('MiMo TTS endpoint must use HTTPS')
  if (url.username || url.password) throw new Error('MiMo TTS endpoint must not contain credentials')
  if (url.search || url.hash) throw new Error('MiMo TTS endpoint must not contain query parameters')
  url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '')
  if (!url.pathname.endsWith('/v1')) throw new Error('MiMo TTS endpoint must end with /v1')
  return url.href.replace(/\/$/, '')
}

function cleanText(text: string): string {
  return text
    .replace(/<harnessdesk_visual_context\b[^>]*>[\s\S]*?<\/harnessdesk_visual_context>/gi, '')
    .replace(/<harnessdesk_visual_attachments\b[^>]*>[\s\S]*?<\/harnessdesk_visual_attachments>/gi, '')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
}

function errorText(status: number, body: string): string {
  if (status === 401 || status === 403) return 'MiMo API Key 无效或已过期'
  if (status === 429) return 'MiMo TTS 请求过于频繁，请稍后重试'
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    if (typeof parsed.error?.message === 'string') return parsed.error.message.slice(0, 240)
  } catch { /* use generic error */ }
  return `MiMo TTS 请求失败（HTTP ${status}）`
}

type TtsStreamEmitter = (event: Omit<TtsStreamEvent, 'streamId'>) => void

function streamMessages(config: TtsConfig, target: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (config.style.trim()) messages.push({ role: 'user', content: config.style.trim() })
  messages.push({ role: 'assistant', content: target })
  return messages
}

function processSseLine(line: string, emit: TtsStreamEmitter): boolean {
  const value = line.trim()
  if (!value.startsWith('data:')) return false
  const payload = value.slice(5).trim()
  if (payload === '[DONE]') return true
  try {
    const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { audio?: { data?: string } } }> }
    const audioBase64 = parsed.choices?.[0]?.delta?.audio?.data
    if (typeof audioBase64 === 'string' && audioBase64.length > 0) emit({ type: 'chunk', audioBase64: audioBase64.replace(/\s/g, ''), sampleRate: 24_000 })
  } catch { /* ignore keep-alive and malformed SSE frames */ }
  return false
}

export async function streamMiMoSpeech(
  config: TtsConfig,
  text: string,
  userData: string,
  emit: TtsStreamEmitter,
  signal: AbortSignal,
  apiKeyOverride?: string,
): Promise<void> {
  if (config.model !== 'mimo-v2.5-tts') throw new Error('当前音色模型不支持低延迟流式输出')
  if (!validAudioFormat(config.format)) throw new Error('不支持的音频格式')
  const endpoint = normalizeTtsEndpoint(config.endpoint)
  const apiKey = apiKeyOverride?.trim() || await readMiMoCredential(userData)
  if (!apiKey) throw new Error('请先在 HarnessDesk 语音设置中填写 MiMo API Key')
  const target = cleanText(text)
  if (!target) throw new Error('没有可朗读的文本')
  const requestAudio: { format: 'pcm16'; voice?: string } = { format: 'pcm16' }
  if (config.voice.trim()) requestAudio.voice = config.voice.trim()
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ model: config.model, messages: streamMessages(config, target), audio: requestAudio, stream: true }),
    signal,
  })
  if (!response.ok) return Promise.reject(new Error(errorText(response.status, await response.text())))
  if (response.body === null) throw new Error('MiMo TTS 未返回流式音频')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done = false
  while (!done) {
    const part = await reader.read()
    buffer += decoder.decode(part.value ?? new Uint8Array(), { stream: !part.done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) if (processSseLine(line, emit)) done = true
    if (part.done) break
  }
  if (buffer.trim().length > 0) processSseLine(buffer, emit)
}

export async function synthesizeMiMoSpeech(
  config: TtsConfig,
  text: string,
  userData: string,
  apiKeyOverride?: string,
): Promise<TtsSynthesisResult> {
  try {
    if (!validTtsModel(config.model)) return { ok: false, error: '不支持的 MiMo TTS 模型' }
    if (!validAudioFormat(config.format)) return { ok: false, error: '不支持的音频格式' }
    const endpoint = normalizeTtsEndpoint(config.endpoint)
    const apiKey = apiKeyOverride?.trim() || await readMiMoCredential(userData)
    if (!apiKey) return { ok: false, error: '请先在 HarnessDesk 语音设置中填写 MiMo API Key' }
    const target = cleanText(text)
    if (!target) return { ok: false, error: '没有可朗读的文本' }
    const messages = streamMessages(config, target)
    if (config.model === 'mimo-v2.5-tts-voicedesign' && messages.length === 1) messages.unshift({ role: 'user', content: '自然、清晰、温和的中文播报音色。' })
    const requestAudio: { format: TtsAudioFormat; voice?: string } = { format: config.format }
    if (config.model !== 'mimo-v2.5-tts-voicedesign' && config.voice.trim()) requestAudio.voice = config.voice.trim()
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({ model: config.model, messages, audio: requestAudio }),
      signal: AbortSignal.timeout(60_000),
    })
    const body = await response.text()
    if (!response.ok) return { ok: false, error: errorText(response.status, body) }
    const parsed = JSON.parse(body) as { choices?: Array<{ message?: { audio?: { data?: string; format?: string } } }> }
    const returnedAudio = parsed.choices?.[0]?.message?.audio
    if (typeof returnedAudio?.data !== 'string' || returnedAudio.data.length === 0) return { ok: false, error: 'MiMo TTS 返回了空音频' }
    const normalized = normalizeAudioPayload(returnedAudio.data)
    if (normalized.base64.length === 0) return { ok: false, error: 'MiMo TTS 返回了空音频' }
    const declaredFormat = typeof returnedAudio.format === 'string' ? formatFromMime(returnedAudio.format) : undefined
    const format = normalized.format ?? inferAudioFormat(normalized.base64) ?? declaredFormat ?? config.format
    return { ok: true, audioBase64: normalized.base64, format }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
