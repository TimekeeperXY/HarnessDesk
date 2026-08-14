import { describe, expect, it, vi } from 'vitest'
import { normalizeVisionEndpoint, transformUnsupportedImagePrompt } from '../packages/dsh-desktop-vision/src/index.js'

describe('LM Studio vision bridge', () => {
  it('only accepts loopback HTTP endpoints', () => {
    expect(normalizeVisionEndpoint('http://localhost:1234/v1').href).toBe('http://localhost:1234/v1')
    expect(() => normalizeVisionEndpoint('https://example.com/v1')).toThrow(/loopback/)
  })

  it('converts pasted images to local visual context', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'qwen-vision' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'A blue settings window with an error banner.' } }] }), { status: 200 }))
    const result = await transformUnsupportedImagePrompt([
      { type: 'text', text: 'What is wrong here?' },
      { type: 'image', data: 'aGVsbG8=', mediaType: 'image/png', name: 'screen.png' },
    ], { endpoint: 'http://127.0.0.1:1234/v1', model: '' }, { fetchImpl })
    expect(result).toHaveLength(2)
    expect(result[1]?.text).toContain('A blue settings window')
    expect(result[1]?.text).toContain('screen.png')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
