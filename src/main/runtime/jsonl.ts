export class JsonLineDecoder<T> {
  private buffer = ''

  push(chunk: Buffer | string): T[] {
    this.buffer += chunk.toString()
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    const values: T[] = []
    for (const line of lines) {
      if (line.trim().length === 0) continue
      values.push(JSON.parse(line) as T)
    }
    return values
  }

  end(): T[] {
    const line = this.buffer.trim()
    this.buffer = ''
    return line.length === 0 ? [] : [JSON.parse(line) as T]
  }
}
