import { describe, expect, it } from 'vitest'
import { JsonLineDecoder } from '../src/main/runtime/jsonl.js'

describe('JSONL decoder', () => {
  it('preserves split UTF-8-safe text chunks and emits complete lines', () => {
    const decoder = new JsonLineDecoder<{ type: string }>()
    expect(decoder.push('{"type":"rea')).toEqual([])
    expect(decoder.push('dy"}\n{"type":"next"}\n')).toEqual([{ type: 'ready' }, { type: 'next' }])
  })

  it('emits a final unterminated record', () => {
    const decoder = new JsonLineDecoder<{ ok: boolean }>()
    decoder.push('{"ok":true}')
    expect(decoder.end()).toEqual([{ ok: true }])
  })
})
