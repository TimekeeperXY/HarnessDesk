export type Locale = 'en' | 'zh-CN'

export interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
}

export interface DesktopConfig {
  schemaVersion: 1
  locale: Locale
  onboardingComplete: boolean
  lastWorkspace?: string
  windowBounds: WindowBounds
  updateChecksEnabled: boolean
  visionBridge: VisionBridgeConfig
}

export interface VisionBridgeConfig {
  enabled: boolean
  endpoint: string
  model: string
}

export interface VisionBridgeTestResult extends OperationResult {
  models?: string[]
  selectedModel?: string
}

export type RuntimePhase = 'idle' | 'preparing' | 'starting' | 'ready' | 'stopping' | 'failed'

export interface RuntimeState {
  phase: RuntimePhase
  harnessVersion: string
  port?: number
  activeTurns: number
  error?: string
  startedAt?: number
  preparationProgress?: number
}

export type DesktopBridgeEvent =
  | { type: 'ready'; pid: number }
  | { type: 'turn-started'; sessionId?: string; turn?: number }
  | { type: 'turn-ended'; sessionId?: string; turn?: number }
  | { type: 'runtime-warning'; message: string }
  | { type: 'runtime-fatal'; message: string }
  | { type: 'shutdown-complete' }

export type DesktopBridgeCommand = { type: 'shutdown' }

export interface Diagnostics {
  appVersion: string
  harnessVersion: string
  platform: string
  arch: string
  dataDirectory: string
  logDirectory: string
  cliDataDetected: boolean
  updaterConfigured: boolean
  runtime: RuntimeState
}

export interface OnboardingInput {
  locale: Locale
  workspace: string
  apiKey?: string
}

export interface OperationResult {
  ok: boolean
  error?: string
}

export interface HarnessDeskApi {
  getConfig(): Promise<DesktopConfig>
  setLocale(locale: Locale): Promise<DesktopConfig>
  setVisionBridge(config: VisionBridgeConfig): Promise<DesktopConfig>
  testVisionBridge(config: VisionBridgeConfig): Promise<VisionBridgeTestResult>
  selectWorkspace(): Promise<string | undefined>
  completeOnboarding(input: OnboardingInput): Promise<OperationResult>
  getRuntimeState(): Promise<RuntimeState>
  startRuntime(): Promise<OperationResult>
  retryRuntime(): Promise<OperationResult>
  showHarness(): Promise<OperationResult>
  showDiagnostics(): Promise<void>
  showVisionSettings(): Promise<void>
  getDiagnostics(): Promise<Diagnostics>
  openLogs(): Promise<void>
  openDataDirectory(): Promise<void>
  checkForUpdates(): Promise<OperationResult>
  onRuntimeState(listener: (state: RuntimeState) => void): () => void
}
