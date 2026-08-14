const URL_PATTERN = /dsh web:\s+(https?:\/\/[^\s]+)/i

export function parseHarnessUrl(line: string): URL | undefined {
  const match = URL_PATTERN.exec(line)
  if (match?.[1] === undefined) return undefined
  let url: URL
  try {
    url = new URL(match[1])
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return undefined
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return undefined
  return url
}

export async function waitForHarness(url: URL, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'error' })
      if (response.ok) return
      lastError = new Error(`health check returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`Harness did not become ready: ${lastError instanceof Error ? lastError.message : 'timeout'}`)
}
