import { spawn } from 'node:child_process'
import net from 'node:net'

const host = '127.0.0.1'
const requestedPort = Number.parseInt(process.env.HARNESSDESK_DEV_PORT ?? '5173', 10)
const firstPort = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65_536 ? requestedPort : 5173
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = new Set()

function probePort(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    const finish = available => {
      server.removeAllListeners()
      server.close(() => resolve(available))
    }
    server.once('error', () => finish(false))
    server.listen({ host, port }, () => finish(true))
  })
}

function chooseEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen({ host, port: 0 }, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Could not determine an ephemeral development port'))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

async function choosePort() {
  if (await probePort(firstPort)) return firstPort
  return chooseEphemeralPort()
}

function start(args, env) {
  const child = spawn(pnpm, args, {
    env,
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32',
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

function waitForPort(port, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    let timer
    const check = () => {
      const socket = net.createConnection({ host, port })
      socket.once('connect', () => {
        socket.destroy()
        clearTimeout(timer)
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - started >= timeoutMs) {
          clearTimeout(timer)
          reject(new Error(`Vite did not start on ${host}:${port}`))
          return
        }
        timer = setTimeout(check, 150)
      })
    }
    check()
  })
}

async function stopAll() {
  for (const child of children) child.kill()
}

const port = await choosePort()
const environment = { ...process.env, HARNESSDESK_DEV_PORT: String(port) }
console.log(`[HarnessDesk] Vite development server: http://${host}:${port}`)

const vite = start(['exec', 'vite', '--host', host, '--port', String(port), '--strictPort'], environment)
const typecheck = start(['exec', 'tsc', '-p', 'tsconfig.electron.json', '--watch', '--preserveWatchOutput'], environment)
vite.once('exit', code => {
  if (code !== 0) void stopAll()
})
typecheck.once('exit', code => {
  if (code !== 0) void stopAll()
})

try {
  await waitForPort(port)
  const electron = start(['exec', 'electron', '.'], {
    ...environment,
    VITE_DEV_SERVER_URL: `http://${host}:${port}`,
  })
  electron.once('exit', () => { void stopAll() })
  const stop = () => { void stopAll() }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  await new Promise(resolve => electron.once('exit', resolve))
} finally {
  await stopAll()
}
