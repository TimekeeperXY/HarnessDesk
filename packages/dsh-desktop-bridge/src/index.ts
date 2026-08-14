import { createReadStream, createWriteStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'harnessdesk-desktop-bridge'
export const inject = ['appExit']

export interface Config {
  eventFd?: number
  controlFd?: number
}

interface SessionLike {
  id?: unknown
}

interface EventLike {
  type?: unknown
  data?: { turn?: unknown }
}

interface BridgeContext extends Context {
  appExit?: (code: number) => void
}

type BridgeEvent =
  | { type: 'ready'; pid: number }
  | { type: 'turn-started'; sessionId?: string; turn?: number }
  | { type: 'turn-ended'; sessionId?: string; turn?: number }
  | { type: 'runtime-warning'; message: string }
  | { type: 'runtime-fatal'; message: string }
  | { type: 'shutdown-complete' }

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Connect Harness lifecycle events to HarnessDesk's private stdio pipes. */
export function apply(ctx: BridgeContext, config: Config = {}): void {
  const eventFd = config.eventFd ?? 3
  const controlFd = config.controlFd ?? 4
  const events = createWriteStream('', { fd: eventFd, autoClose: true })
  const controls = createReadStream('', { fd: controlFd, autoClose: true })
  const lines = createInterface({ input: controls, crlfDelay: Infinity })

  const send = (event: BridgeEvent): void => {
    events.write(`${JSON.stringify(event)}\n`)
  }

  const onSessionEvent = (sessionValue: unknown, eventValue: unknown): void => {
    const session = sessionValue as SessionLike
    const event = eventValue as EventLike
    const shared: { sessionId?: string; turn?: number } = {}
    const sessionId = optionalString(session.id)
    const turn = optionalNumber(event.data?.turn)
    if (sessionId !== undefined) shared.sessionId = sessionId
    if (turn !== undefined) shared.turn = turn
    if (event.type === 'turn/start') send({ type: 'turn-started', ...shared })
    if (event.type === 'turn/end') send({ type: 'turn-ended', ...shared })
  }

  const contextWithEvents = ctx as unknown as {
    on(name: string, listener: (...args: unknown[]) => void, options?: { global?: boolean }): () => void
    effect(setup: () => () => void, label?: string): void
  }
  const disposeSessionEvent = contextWithEvents.on('session/event', onSessionEvent, { global: true })
  contextWithEvents.effect(() => () => {
    disposeSessionEvent()
    send({ type: 'shutdown-complete' })
    lines.close()
    controls.destroy()
    events.end()
  }, 'harnessdesk.desktopBridge')

  lines.on('line', line => {
    try {
      const command = JSON.parse(line) as { type?: unknown }
      if (command.type !== 'shutdown') {
        send({ type: 'runtime-warning', message: 'Ignored an unknown desktop command' })
        return
      }
      if (ctx.appExit === undefined) {
        send({ type: 'runtime-fatal', message: 'The Harness shutdown service is unavailable' })
        return
      }
      ctx.appExit(0)
    } catch {
      send({ type: 'runtime-warning', message: 'Ignored a malformed desktop command' })
    }
  })

  send({ type: 'ready', pid: process.pid })
}

export default apply
