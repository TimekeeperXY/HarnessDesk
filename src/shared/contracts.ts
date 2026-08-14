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
  tts: TtsConfig
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

export type TtsModel = 'mimo-v2.5-tts' | 'mimo-v2.5-tts-voicedesign' | 'mimo-v2.5-tts-voiceclone'

export type TtsAudioFormat = 'mp3' | 'wav'

export interface TtsConfig {
  enabled: boolean
  autoPlay: boolean
  endpoint: string
  model: TtsModel
  voice: string
  style: string
  format: TtsAudioFormat
}

export interface TtsSynthesisResult extends OperationResult {
  audioBase64?: string
  format?: TtsAudioFormat
}

export type TtsStreamEventType = 'started' | 'chunk' | 'ended' | 'error'

export interface TtsStreamEvent {
  streamId: string
  type: TtsStreamEventType
  audioBase64?: string
  sampleRate?: number
  error?: string
}

export interface TtsStreamStartResult extends OperationResult {
  streamId?: string
  sampleRate?: number
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
  getTtsConfig(): Promise<TtsConfig>
  setTtsConfig(config: TtsConfig, apiKey?: string): Promise<DesktopConfig>
  testTts(config: TtsConfig, apiKey?: string): Promise<TtsSynthesisResult>
  speakText(text: string): Promise<TtsSynthesisResult>
  startTtsStream(text: string): Promise<TtsStreamStartResult>
  stopTtsStream(streamId: string): Promise<OperationResult>
  selectWorkspace(): Promise<string | undefined>
  completeOnboarding(input: OnboardingInput): Promise<OperationResult>
  getRuntimeState(): Promise<RuntimeState>
  startRuntime(): Promise<OperationResult>
  retryRuntime(): Promise<OperationResult>
  showHarness(): Promise<OperationResult>
  showDiagnostics(): Promise<void>
  showVisionSettings(): Promise<void>
  showTtsSettings(): Promise<void>
  getDiagnostics(): Promise<Diagnostics>
  openLogs(): Promise<void>
  openDataDirectory(): Promise<void>
  checkForUpdates(): Promise<OperationResult>
  onRuntimeState(listener: (state: RuntimeState) => void): () => void
  onTtsConfig(listener: (config: TtsConfig) => void): () => void
  onTtsStream(listener: (event: TtsStreamEvent) => void): () => void
}
