import { contextBridge, ipcRenderer } from 'electron'
import type { HarnessDeskApi, Locale, OnboardingInput, RuntimeState, VisionBridgeConfig } from '../shared/contracts.js'

const api: HarnessDeskApi = {
  getConfig: () => ipcRenderer.invoke('desktop:get-config'),
  setLocale: (locale: Locale) => ipcRenderer.invoke('desktop:set-locale', locale),
  setVisionBridge: (config: VisionBridgeConfig) => ipcRenderer.invoke('desktop:set-vision-bridge', config),
  testVisionBridge: (config: VisionBridgeConfig) => ipcRenderer.invoke('desktop:test-vision-bridge', config),
  selectWorkspace: () => ipcRenderer.invoke('desktop:select-workspace'),
  completeOnboarding: (input: OnboardingInput) => ipcRenderer.invoke('desktop:complete-onboarding', input),
  getRuntimeState: () => ipcRenderer.invoke('runtime:get-state'),
  startRuntime: () => ipcRenderer.invoke('runtime:start'),
  retryRuntime: () => ipcRenderer.invoke('runtime:retry'),
  showHarness: () => ipcRenderer.invoke('runtime:show-harness'),
  showDiagnostics: () => ipcRenderer.invoke('desktop:show-diagnostics'),
  showVisionSettings: () => ipcRenderer.invoke('desktop:show-vision-settings'),
  getDiagnostics: () => ipcRenderer.invoke('desktop:get-diagnostics'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  openDataDirectory: () => ipcRenderer.invoke('desktop:open-data'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  onRuntimeState: (listener: (state: RuntimeState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: RuntimeState): void => listener(state)
    ipcRenderer.on('runtime:state', handler)
    return () => ipcRenderer.off('runtime:state', handler)
  },
}

contextBridge.exposeInMainWorld('harnessdesk', api)
