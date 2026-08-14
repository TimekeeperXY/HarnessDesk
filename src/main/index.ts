import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron'
import updater from 'electron-updater'
import { normalizeVisionEndpoint, testVisionBridge } from '@harnessdesk/dsh-desktop-vision'
import type { DesktopConfig, Diagnostics, Locale, OnboardingInput, OperationResult, TtsConfig, TtsStreamEvent, TtsStreamStartResult, TtsSynthesisResult, VisionBridgeConfig, VisionBridgeTestResult } from '../shared/contracts.js'
import { ConfigStore } from './config-store.js'
import { writeDeepSeekCredential, writeMiMoCredential } from './credentials.js'
import { AppLogger } from './logger.js'
import { RuntimeController } from './runtime/controller.js'
import { ensurePackagedRuntime } from './runtime/store.js'
import { harnessTtsCss, harnessTtsScript } from './tts-injection.js'
import { normalizeTtsEndpoint, streamMiMoSpeech, synthesizeMiMoSpeech } from './tts.js'

const { autoUpdater } = updater
const APP_VERSION = app.getVersion()
const HARNESS_VERSION = '0.1.0-rc.6'

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let configStore: ConfigStore
let logger: AppLogger
let runtime: RuntimeController
let harnessUrl: URL | undefined
let runtimeStart: Promise<OperationResult> | undefined
let previousActiveTurns = 0
let quitting = false
let shellUrl = ''
let harnessChromeCssKey: string | undefined
let harnessTtsCssKey: string | undefined
const ttsStreams = new Map<string, { ownerId: number; controller: AbortController }>()

const harnessChromeCss = `
  html { box-sizing: border-box !important; padding-top: 56px !important; background: #f7f9fd !important; }
  body { height: calc(100vh - 56px) !important; min-height: 0 !important; }
  body > div:first-child { height: 100% !important; min-height: 0 !important; }
  body::before {
    content: "HarnessDesk";
    box-sizing: border-box;
    position: fixed;
    inset: 0 0 auto 0;
    z-index: 2147483647;
    height: 56px;
    padding-left: ${process.platform === 'darwin' ? '86px' : '22px'};
    color: #18345f;
    background: rgba(247, 249, 253, 0.96);
    border-bottom: 1px solid rgba(201, 213, 231, 0.72);
    font: 600 13px/56px system-ui, sans-serif;
    letter-spacing: -0.01em;
    -webkit-app-region: drag;
    user-select: none;
  }
`

if (process.env.HARNESSDESK_E2E_USER_DATA !== undefined) {
  app.setPath('userData', resolve(process.env.HARNESSDESK_E2E_USER_DATA))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function copy(locale: Locale) {
  return locale === 'zh-CN' ? {
    app: 'HarnessDesk',
    reload: '重新加载',
    harness: '返回 Harness',
    diagnostics: '诊断信息',
    vision: 'LM Studio 视觉桥',
    voice: 'MiMo 语音',
    logs: '打开日志目录',
    data: '打开数据目录',
    updates: '检查更新',
    about: '关于 HarnessDesk',
    quit: '退出',
    show: '显示 HarnessDesk',
    runningTitle: '任务仍在运行',
    runningMessage: 'Harness 仍有运行中的任务。你可以让它继续在后台运行，或安全停止后退出。',
    background: '继续后台',
    stop: '停止并退出',
    cancel: '取消',
    completed: 'Harness 任务已完成',
  } : {
    app: 'HarnessDesk',
    reload: 'Reload',
    harness: 'Return to Harness',
    diagnostics: 'Diagnostics',
    vision: 'LM Studio Vision Bridge',
    voice: 'MiMo Voice',
    logs: 'Open Logs',
    data: 'Open Data Folder',
    updates: 'Check for Updates',
    about: 'About HarnessDesk',
    quit: 'Quit',
    show: 'Show HarnessDesk',
    runningTitle: 'A task is still running',
    runningMessage: 'Harness still has active work. Keep it running in the background or stop it safely before quitting.',
    background: 'Keep Running',
    stop: 'Stop and Quit',
    cancel: 'Cancel',
    completed: 'Harness task completed',
  }
}

function dshHome(): string {
  return join(app.getPath('userData'), 'harness')
}

function localShellTarget(view = 'home'): string {
  const dev = process.env.VITE_DEV_SERVER_URL
  if (dev !== undefined) return `${dev}/?view=${encodeURIComponent(view)}`
  return join(app.getAppPath(), 'dist', 'index.html')
}

async function loadShell(view = 'home'): Promise<void> {
  if (mainWindow === undefined) return
  stopAllTtsStreams()
  if (harnessChromeCssKey !== undefined) {
    await mainWindow.webContents.removeInsertedCSS(harnessChromeCssKey).catch(() => undefined)
    harnessChromeCssKey = undefined
  }
  if (harnessTtsCssKey !== undefined) {
    await mainWindow.webContents.removeInsertedCSS(harnessTtsCssKey).catch(() => undefined)
    harnessTtsCssKey = undefined
  }
  const dev = process.env.VITE_DEV_SERVER_URL
  if (dev !== undefined) {
    shellUrl = new URL(dev).origin
    await mainWindow.loadURL(`${dev}/?view=${encodeURIComponent(view)}`)
  } else {
    const path = localShellTarget(view)
    shellUrl = pathToFileURL(normalize(path)).href
    await mainWindow.loadFile(path, { query: { view } })
  }
  mainWindow.show()
}

function stopAllTtsStreams(): void {
  for (const stream of ttsStreams.values()) stream.controller.abort()
  ttsStreams.clear()
}

function isAllowedNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (harnessUrl !== undefined && url.origin === harnessUrl.origin) return true
    if (process.env.VITE_DEV_SERVER_URL !== undefined && url.origin === shellUrl) return true
    return url.protocol === 'file:' && new URL(shellUrl).protocol === 'file:' && url.pathname === new URL(shellUrl).pathname
  } catch {
    return false
  }
}

function assertShellSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url
  if (url === undefined) throw new Error('IPC sender has no frame')
  if (process.env.VITE_DEV_SERVER_URL !== undefined) {
    if (new URL(url).origin !== shellUrl) throw new Error('IPC is restricted to the HarnessDesk shell')
    return
  }
  const sender = new URL(url)
  const expected = new URL(shellUrl)
  if (sender.protocol !== 'file:' || sender.pathname !== expected.pathname) {
    throw new Error('IPC is restricted to the HarnessDesk shell')
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const rawUrl = event.senderFrame?.url
  if (rawUrl === undefined) throw new Error('IPC sender has no frame')
  try {
    const sender = new URL(rawUrl)
    if (process.env.VITE_DEV_SERVER_URL !== undefined && sender.origin === shellUrl) return
    if (sender.protocol === 'file:' && new URL(shellUrl).protocol === 'file:' && sender.pathname === new URL(shellUrl).pathname) return
    if (harnessUrl !== undefined && sender.origin === harnessUrl.origin) return
  } catch { /* reject below */ }
  throw new Error('IPC is restricted to HarnessDesk and the local Harness UI')
}

async function showHarness(): Promise<OperationResult> {
  if (mainWindow === undefined || harnessUrl === undefined) return { ok: false, error: 'Harness is not ready' }
  stopAllTtsStreams()
  await mainWindow.loadURL(harnessUrl.href)
  harnessChromeCssKey = await mainWindow.webContents.insertCSS(harnessChromeCss)
  harnessTtsCssKey = await mainWindow.webContents.insertCSS(harnessTtsCss)
  await mainWindow.webContents.executeJavaScript(harnessTtsScript)
  mainWindow.show()
  return { ok: true }
}

async function startRuntime(): Promise<OperationResult> {
  if (runtimeStart !== undefined) return runtimeStart
  runtimeStart = startRuntimeOnce()
  try {
    return await runtimeStart
  } finally {
    runtimeStart = undefined
  }
}

async function startRuntimeOnce(): Promise<OperationResult> {
  const config = configStore.get()
  if (config.lastWorkspace === undefined) return { ok: false, error: 'Choose a workspace first' }
  try {
    let runtimeResourcesPath = process.resourcesPath
    if (app.isPackaged) {
      runtime.setPreparing(0)
      runtimeResourcesPath = await ensurePackagedRuntime({
        resourcesPath: process.resourcesPath,
        userData: app.getPath('userData'),
        onProgress: progress => runtime.setPreparing(progress),
      })
    }
    harnessUrl = await runtime.start({
      userData: app.getPath('userData'),
      dshHome: dshHome(),
      workspace: config.lastWorkspace,
      resourcesPath: runtimeResourcesPath,
      packaged: app.isPackaged,
      visionBridge: config.visionBridge,
    })
    return await showHarness()
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function updateTrayMenu(): void {
  if (tray === undefined) return
  const labels = copy(configStore.get().locale)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: labels.show, click: () => {
      if (mainWindow?.isMinimized()) mainWindow.restore()
      mainWindow?.show()
      mainWindow?.focus()
    } },
    { label: labels.harness, click: () => { void showHarness() } },
    { label: labels.voice, click: () => { void loadShell('voice') } },
    { type: 'separator' },
    { label: labels.quit, click: () => { void quitApplication() } },
  ]))
}

function createTray(): void {
  if (tray !== undefined) {
    updateTrayMenu()
    return
  }
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#1f8879"/><path d="M9 8v16M23 8v16M9 16h14" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>`
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(mark)}`).resize({ width: 16, height: 16 })
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('HarnessDesk')
  updateTrayMenu()
  tray.on('click', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
  tray.on('double-click', () => mainWindow?.show())
}

async function quitApplication(): Promise<void> {
  if (quitting) return
  quitting = true
  stopAllTtsStreams()
  await runtime.stop()
  tray?.destroy()
  tray = undefined
  app.quit()
}

async function handleWindowClose(event: Electron.Event): Promise<void> {
  if (quitting) return
  event.preventDefault()
  createTray()
  mainWindow?.hide()
}

function buildMenu(): void {
  const labels = copy(configStore.get().locale)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: labels.app,
      submenu: [
        { label: labels.harness, click: () => { void showHarness() } },
        { label: labels.reload, accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { label: labels.diagnostics, click: () => { void loadShell('diagnostics') } },
        { label: labels.vision, click: () => { void loadShell('vision') } },
        { label: labels.voice, click: () => { void loadShell('voice') } },
        { label: labels.logs, click: () => { void shell.openPath(logger.directory) } },
        { label: labels.data, click: () => { void shell.openPath(app.getPath('userData')) } },
        { label: labels.updates, click: () => { void checkForUpdates() } },
        { type: 'separator' },
        { role: 'quit', label: labels.quit, click: () => { void quitApplication() } },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      role: 'help',
      submenu: [{
        label: labels.about,
        click: () => dialog.showMessageBox({
          type: 'info',
          title: 'HarnessDesk',
          message: `HarnessDesk ${APP_VERSION}`,
          detail: `Community desktop client for DeepSeek Harness ${HARNESS_VERSION}. Not an official DeepSeek product.`,
        }),
      }],
    },
  ]))
}

async function checkForUpdates(): Promise<OperationResult> {
  const feed = process.env.HARNESSDESK_UPDATE_URL?.trim()
  if (!app.isPackaged || !configStore.get().updateChecksEnabled || !feed) {
    return { ok: false, error: 'Updates are disabled until a signed release feed is configured.' }
  }
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function registerIpc(): void {
  ipcMain.handle('desktop:get-config', event => { assertShellSender(event); return configStore.get() })
  ipcMain.handle('desktop:set-locale', async (event, locale: Locale) => {
    assertShellSender(event)
    if (locale !== 'en' && locale !== 'zh-CN') throw new Error('Unsupported locale')
    const config = await configStore.update({ locale })
    buildMenu()
    updateTrayMenu()
    return config
  })
  ipcMain.handle('desktop:set-vision-bridge', async (event, value: VisionBridgeConfig) => {
    assertShellSender(event)
    const endpoint = normalizeVisionEndpoint(value.endpoint).href.replace(/\/$/, '')
    return configStore.update({ visionBridge: { enabled: value.enabled, endpoint, model: value.model.trim() } })
  })
  ipcMain.handle('desktop:test-vision-bridge', async (event, value: VisionBridgeConfig): Promise<VisionBridgeTestResult> => {
    assertShellSender(event)
    try {
      const result = await testVisionBridge(value)
      return { ok: true, models: result.models, selectedModel: result.selectedModel }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('desktop:get-tts-config', event => { assertTrustedSender(event); return configStore.get().tts })
  ipcMain.handle('desktop:set-tts-config', async (event, value: TtsConfig, apiKey?: string): Promise<DesktopConfig> => {
    assertShellSender(event)
    if (typeof value?.enabled !== 'boolean' || typeof value.autoPlay !== 'boolean') throw new Error('Invalid MiMo TTS settings')
    if (!['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone'].includes(value.model)) throw new Error('Unsupported MiMo TTS model')
    if (value.format !== 'mp3' && value.format !== 'wav') throw new Error('Unsupported MiMo TTS audio format')
    const endpoint = normalizeTtsEndpoint(value.endpoint)
    if (apiKey !== undefined && apiKey.trim().length > 0) await writeMiMoCredential(app.getPath('userData'), apiKey)
    const config = await configStore.update({
      tts: {
        enabled: value.enabled,
        autoPlay: value.autoPlay,
        endpoint,
        model: value.model,
        voice: value.voice.trim(),
        style: value.style.trim(),
        format: value.format,
      },
    })
    mainWindow?.webContents.send('tts:config', config.tts)
    return config
  })
  ipcMain.handle('desktop:test-tts', async (event, value: TtsConfig, apiKey?: string): Promise<TtsSynthesisResult> => {
    assertShellSender(event)
    return synthesizeMiMoSpeech(value, '这是 HarnessDesk 的语音测试。', app.getPath('userData'), apiKey)
  })
  ipcMain.handle('desktop:speak-text', async (event, text: string): Promise<TtsSynthesisResult> => {
    assertTrustedSender(event)
    if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, error: '没有可朗读的文本' }
    const config = configStore.get().tts
    if (!config.enabled) return { ok: false, error: 'MiMo 语音输出尚未启用' }
    return synthesizeMiMoSpeech(config, text, app.getPath('userData'))
  })
  ipcMain.handle('desktop:start-tts-stream', async (event, text: string): Promise<TtsStreamStartResult> => {
    assertTrustedSender(event)
    if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, error: '没有可朗读的文本' }
    const config = configStore.get().tts
    if (!config.enabled) return { ok: false, error: 'MiMo 语音输出尚未启用' }
    if (config.model !== 'mimo-v2.5-tts') return { ok: false, error: '当前音色模型不支持低延迟流式输出' }
    for (const [id, stream] of ttsStreams) {
      if (stream.ownerId === event.sender.id) {
        stream.controller.abort()
        ttsStreams.delete(id)
      }
    }
    const streamId = randomUUID()
    const controller = new AbortController()
    ttsStreams.set(streamId, { ownerId: event.sender.id, controller })
    const send = (value: Omit<TtsStreamEvent, 'streamId'>): void => {
      if (!event.sender.isDestroyed()) event.sender.send('tts:stream', { streamId, ...value })
    }
    const timeout = setTimeout(() => controller.abort(), 120_000)
    send({ type: 'started', sampleRate: 24_000 })
    void streamMiMoSpeech(config, text, app.getPath('userData'), value => send(value), controller.signal)
      .then(() => { if (!controller.signal.aborted) send({ type: 'ended' }) })
      .catch(error => {
        if (!controller.signal.aborted) send({ type: 'error', error: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => { clearTimeout(timeout); ttsStreams.delete(streamId) })
    return { ok: true, streamId, sampleRate: 24_000 }
  })
  ipcMain.handle('desktop:stop-tts-stream', (event, streamId: string): OperationResult => {
    assertTrustedSender(event)
    if (typeof streamId !== 'string' || streamId.length === 0) return { ok: false, error: '无效的语音流 ID' }
    const stream = ttsStreams.get(streamId)
    if (stream === undefined) return { ok: true }
    if (stream.ownerId !== event.sender.id) return { ok: false, error: '无权停止该语音流' }
    stream.controller.abort()
    ttsStreams.delete(streamId)
    return { ok: true }
  })
  ipcMain.handle('desktop:select-workspace', async event => {
    assertShellSender(event)
    const config = configStore.get()
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      ...(config.lastWorkspace === undefined ? {} : { defaultPath: config.lastWorkspace }),
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('desktop:complete-onboarding', async (event, input: OnboardingInput): Promise<OperationResult> => {
    assertShellSender(event)
    if (input.locale !== 'en' && input.locale !== 'zh-CN') return { ok: false, error: 'Unsupported locale' }
    if (!existsSync(input.workspace)) return { ok: false, error: 'The selected workspace no longer exists' }
    try {
      if (input.apiKey !== undefined && input.apiKey.trim().length > 0) {
        await writeDeepSeekCredential(dshHome(), input.apiKey)
      }
      await configStore.update({ locale: input.locale, lastWorkspace: input.workspace, onboardingComplete: true })
      buildMenu()
      return await startRuntime()
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('runtime:get-state', event => { assertShellSender(event); return runtime.getState() })
  ipcMain.handle('runtime:start', event => { assertShellSender(event); return startRuntime() })
  ipcMain.handle('runtime:retry', async event => {
    assertShellSender(event)
    await runtime.stop()
    return startRuntime()
  })
  ipcMain.handle('runtime:show-harness', event => { assertShellSender(event); return showHarness() })
  ipcMain.handle('desktop:show-diagnostics', event => { assertShellSender(event); return loadShell('diagnostics') })
  ipcMain.handle('desktop:show-vision-settings', event => { assertShellSender(event); return loadShell('vision') })
  ipcMain.handle('desktop:show-tts-settings', event => { assertShellSender(event); return loadShell('voice') })
  ipcMain.handle('desktop:get-diagnostics', (event): Diagnostics => {
    assertShellSender(event)
    return {
      appVersion: APP_VERSION,
      harnessVersion: HARNESS_VERSION,
      platform: process.platform,
      arch: process.arch,
      dataDirectory: app.getPath('userData'),
      logDirectory: logger.directory,
      cliDataDetected: existsSync(join(homedir(), '.dsh')),
      updaterConfigured: Boolean(process.env.HARNESSDESK_UPDATE_URL),
      runtime: runtime.getState(),
    }
  })
  ipcMain.handle('desktop:open-logs', event => { assertShellSender(event); return shell.openPath(logger.directory).then(() => undefined) })
  ipcMain.handle('desktop:open-data', event => { assertShellSender(event); return shell.openPath(app.getPath('userData')).then(() => undefined) })
  ipcMain.handle('desktop:check-updates', event => { assertShellSender(event); return checkForUpdates() })
}

async function createMainWindow(): Promise<void> {
  const config = configStore.get()
  mainWindow = new BrowserWindow({
    ...config.windowBounds,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#f7f9fd',
    title: 'HarnessDesk',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 18, y: 19 } }
      : { titleBarOverlay: { color: '#f7f9fd', symbolColor: '#34527f', height: 56 } }),
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:') void shell.openExternal(target.href)
    } catch { /* malformed links remain blocked */ }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })
  mainWindow.on('close', event => { void handleWindowClose(event) })
  mainWindow.on('resize', () => {
    if (mainWindow === undefined || mainWindow.isMinimized()) return
    const size = mainWindow.getSize()
    const width = size[0] ?? 1180
    const height = size[1] ?? 780
    const current = configStore.get().windowBounds
    void configStore.update({
      windowBounds: {
        width,
        height,
        ...(current.x === undefined ? {} : { x: current.x }),
        ...(current.y === undefined ? {} : { y: current.y }),
      },
    })
  })
  mainWindow.on('move', () => {
    if (mainWindow === undefined) return
    const position = mainWindow.getPosition()
    const x = position[0] ?? 0
    const y = position[1] ?? 0
    const current = configStore.get().windowBounds
    void configStore.update({ windowBounds: { width: current.width, height: current.height, x, y } })
  })
  await loadShell()
}

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
})

app.on('before-quit', event => {
  if (!quitting) {
    event.preventDefault()
    void quitApplication()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && runtime.getState().activeTurns === 0) void quitApplication()
})

app.on('activate', () => {
  if (mainWindow === undefined || mainWindow.isDestroyed()) void createMainWindow()
  else mainWindow.show()
})

void app.whenReady().then(async () => {
  configStore = await ConfigStore.open(app.getPath('userData'), app.getLocale())
  logger = new AppLogger(app.getPath('userData'))
  await logger.initialize()
  await logger.info(`HarnessDesk ${APP_VERSION} starting on ${process.platform}/${process.arch}`)
  runtime = new RuntimeController(logger)
  runtime.events.on('state', state => {
    mainWindow?.webContents.send('runtime:state', state)
    if (tray !== undefined) {
      const suffix = state.activeTurns > 0 ? ` · ${state.activeTurns} active` : ''
      tray.setToolTip(`HarnessDesk${suffix}`)
    }
    if (previousActiveTurns > 0 && state.activeTurns === 0 && !mainWindow?.isVisible() && Notification.isSupported()) {
      new Notification({ title: 'HarnessDesk', body: copy(configStore.get().locale).completed }).show()
    }
    previousActiveTurns = state.activeTurns
  })
  registerIpc()
  buildMenu()
  await createMainWindow()
  createTray()
})
