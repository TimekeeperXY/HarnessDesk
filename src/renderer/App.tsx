import { useEffect, useMemo, useState } from 'react'
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  Desktop,
  FileText,
  FolderOpen,
  Key,
  ImageSquare,
  PlugsConnected,
  ShieldCheck,
  SpeakerHigh,
  Warning,
} from '@phosphor-icons/react'
import type { DesktopConfig, Diagnostics, Locale, RuntimeState, TtsConfig, TtsModel, TtsSynthesisResult, VisionBridgeConfig } from '../shared/contracts.js'
import { translator } from './i18n.js'

const iconProps = { size: 20, weight: 'regular' as const }

function createTtsAudio(result: TtsSynthesisResult): { audio: HTMLAudioElement; url: string } {
  if (!result.audioBase64) throw new Error('MiMo TTS returned empty audio')
  const binary = atob(result.audioBase64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const type = result.format === 'wav' ? 'audio/wav' : 'audio/mpeg'
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  return { audio: new Audio(url), url }
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand${compact ? ' brand-compact' : ''}`}>
      <span className="brand-mark" aria-hidden="true"><i /><i /></span>
      <span className="brand-name">HarnessDesk</span>
      <span className="brand-edition">community</span>
    </div>
  )
}

function LocaleControl({ locale, onChange }: { locale: Locale; onChange(locale: Locale): void }) {
  return (
    <div className="locale-control" aria-label="Language">
      <button className={locale === 'zh-CN' ? 'active' : ''} onClick={() => onChange('zh-CN')}>中文</button>
      <button className={locale === 'en' ? 'active' : ''} onClick={() => onChange('en')}>EN</button>
    </div>
  )
}

function Shell({ children, locale, onLocale, step }: { children: React.ReactNode; locale: Locale; onLocale(locale: Locale): void; step?: number }) {
  const t = translator(locale)
  return (
    <main className="shell">
      <header className="topbar">
        <Brand compact />
        <LocaleControl locale={locale} onChange={onLocale} />
      </header>
      <div className="shell-body">
        <div className="ambient-grid" aria-hidden="true"><span /><span /><span /></div>
        <section className="content">
          <div className="content-meta">
            <div className="community-note">
              <span className="status-dot" aria-hidden="true" />
              <div><strong>{t('community')}</strong><p>{t('notOfficial')}</p></div>
            </div>
            {step !== undefined && (
              <div className="stage-track" aria-label={`${step + 1} / 3`}>
                {[0, 1, 2].map(index => <span key={index} className={index <= step ? 'active' : ''} />)}
                <small>0{step + 1} / 03</small>
              </div>
            )}
          </div>
          {children}
        </section>
      </div>
    </main>
  )
}

function Welcome({ locale, next }: { locale: Locale; next(): void }) {
  const t = translator(locale)
  return (
    <div className="page-block welcome">
      <p className="eyebrow">HarnessDesk</p>
      <h1>{t('welcomeTitle')}</h1>
      <p className="lead">{t('welcomeBody')}</p>
      <div className="storage-note">
        <ShieldCheck {...iconProps} />
        <div>
          <strong>{t('storageTitle')}</strong>
          <p>{t('storageBody')}</p>
        </div>
      </div>
      <button className="primary" onClick={next}>{t('startSetup')}<ArrowRight {...iconProps} /></button>
    </div>
  )
}

function WorkspaceStep({ locale, workspace, setWorkspace, back, next }: {
  locale: Locale
  workspace: string
  setWorkspace(path: string): void
  back(): void
  next(): void
}) {
  const t = translator(locale)
  const [error, setError] = useState('')
  const choose = async (): Promise<void> => {
    const selected = await window.harnessdesk.selectWorkspace()
    if (selected !== undefined) {
      setWorkspace(selected)
      setError('')
    }
  }
  const continueNext = (): void => {
    if (!workspace) setError(t('workspaceRequired'))
    else next()
  }
  return (
    <div className="page-block form-page">
      <FolderOpen size={34} weight="regular" className="page-icon" />
      <h1>{t('workspaceTitle')}</h1>
      <p className="lead">{t('workspaceBody')}</p>
      <div className="folder-field">
        <span title={workspace}>{workspace || t('noFolder')}</span>
        <button className="secondary" onClick={() => { void choose() }}><FolderOpen {...iconProps} />{t('chooseFolder')}</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="text-button" onClick={back}><ArrowLeft {...iconProps} />{t('back')}</button>
        <button className="primary" onClick={continueNext}>{t('continue')}<ArrowRight {...iconProps} /></button>
      </div>
    </div>
  )
}

function KeyStep({ locale, apiKey, setApiKey, back, launch, busy, error }: {
  locale: Locale
  apiKey: string
  setApiKey(value: string): void
  back(): void
  launch(): void
  busy: boolean
  error: string
}) {
  const t = translator(locale)
  return (
    <div className="page-block form-page">
      <Key size={34} weight="regular" className="page-icon" />
      <h1>{t('keyTitle')}</h1>
      <p className="lead">{t('keyBody')}</p>
      <label className="input-block">
        <span>{t('apiKey')}</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={t('keyPlaceholder')}
          onChange={event => setApiKey(event.target.value)}
        />
        <small>{t('keyHelp')}</small>
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="text-button" onClick={back} disabled={busy}><ArrowLeft {...iconProps} />{t('back')}</button>
        <button className="primary" onClick={launch} disabled={busy}>{busy ? t('launching') : t('launch')}<ArrowRight {...iconProps} /></button>
      </div>
    </div>
  )
}

function Loading({ locale, runtime }: { locale: Locale; runtime: RuntimeState | undefined }) {
  const t = translator(locale)
  const preparing = runtime?.phase === 'preparing'
  const progress = Math.round((runtime?.preparationProgress ?? 0) * 100)
  return (
    <div className="page-block status-page" aria-live="polite">
      <div className="loading-mark" aria-hidden="true"><span /><span /><span /></div>
      <h1>{t(preparing ? 'preparing' : 'launching')}</h1>
      <p className="lead">{t(preparing ? 'preparingBody' : 'launchingBody')}</p>
      {preparing
        ? <div className="runtime-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /><small>{progress}%</small></div>
        : <div className="skeleton-lines" aria-hidden="true"><span /><span /><span /></div>}
    </div>
  )
}

function Failure({ locale, error, retry, diagnostics }: {
  locale: Locale
  error: string
  retry(): void
  diagnostics(): void
}) {
  const t = translator(locale)
  return (
    <div className="page-block status-page error-page">
      <Warning size={38} weight="regular" className="error-icon" />
      <h1>{t('failed')}</h1>
      <p className="lead error-copy">{error}</p>
      <div className="actions left-actions">
        <button className="primary" onClick={retry}><ArrowClockwise {...iconProps} />{t('retry')}</button>
        <button className="secondary" onClick={diagnostics}><FileText {...iconProps} />{t('diagnostics')}</button>
      </div>
    </div>
  )
}

function DiagnosticsPage({ locale }: { locale: Locale }) {
  const t = translator(locale)
  const [data, setData] = useState<Diagnostics>()
  const [updateMessage, setUpdateMessage] = useState('')
  useEffect(() => { void window.harnessdesk.getDiagnostics().then(setData) }, [])
  if (data === undefined) return <Loading locale={locale} runtime={undefined} />
  const rows = [
    [t('appVersion'), data.appVersion],
    [t('harnessVersion'), data.harnessVersion],
    [t('platform'), `${data.platform} / ${data.arch}`],
    [t('runtime'), `${data.runtime.phase}${data.runtime.port === undefined ? '' : ` : ${data.runtime.port}`}`],
    [t('dataFolder'), data.dataDirectory],
    [t('logFolder'), data.logDirectory],
    [t('cliDetected'), data.cliDataDetected ? t('yes') : t('no')],
    [t('updater'), data.updaterConfigured ? t('yes') : t('no')],
  ]
  return (
    <div className="page-block diagnostics-page">
      <Desktop size={34} weight="regular" className="page-icon" />
      <h1>{t('diagnostics')}</h1>
      <p className="lead">{t('diagBody')}</p>
      <dl className="diagnostic-list">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {updateMessage && <p className="inline-note">{updateMessage}</p>}
      <div className="diagnostic-actions">
        <button className="secondary" onClick={() => { void window.harnessdesk.openLogs() }}><FileText {...iconProps} />{t('openLogs')}</button>
        <button className="secondary" onClick={() => { void window.harnessdesk.openDataDirectory() }}><Database {...iconProps} />{t('openData')}</button>
        <button className="secondary" onClick={() => { void window.harnessdesk.checkForUpdates().then(result => setUpdateMessage(result.error ?? '')) }}><ArrowClockwise {...iconProps} />{t('updater')}</button>
        <button className="primary" onClick={() => { void window.harnessdesk.showHarness() }}><ArrowLeft {...iconProps} />{t('returnHarness')}</button>
      </div>
    </div>
  )
}

function VisionSettingsPage({ locale, initial, onSaved }: { locale: Locale; initial: VisionBridgeConfig; onSaved(config: DesktopConfig): void }) {
  const t = translator(locale)
  const [value, setValue] = useState(initial)
  const [models, setModels] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const test = async (): Promise<void> => {
    setTesting(true)
    setMessage('')
    setError('')
    const result = await window.harnessdesk.testVisionBridge(value)
    setTesting(false)
    if (!result.ok) {
      setError(result.error ?? 'LM Studio connection failed')
      return
    }
    setModels(result.models ?? [])
    const selected = result.selectedModel ?? value.model
    if (!value.model && selected) setValue(current => ({ ...current, model: selected }))
    setMessage(t('visionConnected').replace('{model}', selected))
  }
  const save = async (): Promise<void> => {
    setMessage('')
    setError('')
    try {
      const config = await window.harnessdesk.setVisionBridge(value)
      onSaved(config)
      setValue(config.visionBridge)
      setMessage(t('visionSaved'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <div className="page-block diagnostics-page vision-page">
      <ImageSquare size={34} weight="regular" className="page-icon" />
      <h1>{t('visionTitle')}</h1>
      <p className="lead">{t('visionBody')}</p>
      <label className="toggle-row">
        <input type="checkbox" checked={value.enabled} onChange={event => setValue({ ...value, enabled: event.target.checked })} />
        <span aria-hidden="true"><i /></span>
        <strong>{t('visionEnabled')}</strong>
      </label>
      <div className="vision-fields">
        <label className="input-block">
          <span>{t('visionEndpoint')}</span>
          <input value={value.endpoint} spellCheck={false} onChange={event => setValue({ ...value, endpoint: event.target.value })} />
        </label>
        <label className="input-block">
          <span>{t('visionModel')}</span>
          <input list="vision-models" value={value.model} placeholder={t('visionModelAuto')} spellCheck={false} onChange={event => setValue({ ...value, model: event.target.value })} />
          <datalist id="vision-models">{models.map(model => <option value={model} key={model} />)}</datalist>
        </label>
      </div>
      <p className="privacy-note"><PlugsConnected {...iconProps} />{t('visionPrivacy')}</p>
      {message && <p className="success-note" role="status">{message}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="diagnostic-actions">
        <button className="secondary" onClick={() => { void test() }} disabled={testing}><PlugsConnected {...iconProps} />{testing ? t('visionTesting') : t('visionTest')}</button>
        <button className="primary" onClick={() => { void save() }}>{t('visionSave')}</button>
        <button className="text-button" onClick={() => { void window.harnessdesk.showHarness() }}><ArrowLeft {...iconProps} />{t('returnHarness')}</button>
      </div>
    </div>
  )
}

const ttsVoices = ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean']
const ttsModels: TtsModel[] = ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone']

function VoiceSettingsPage({ locale, initial, onSaved }: { locale: Locale; initial: TtsConfig; onSaved(config: DesktopConfig): void }) {
  const t = translator(locale)
  const [value, setValue] = useState(initial)
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const test = async (): Promise<void> => {
    setTesting(true)
    setMessage('')
    setError('')
    const result = await window.harnessdesk.testTts(value, apiKey || undefined)
    setTesting(false)
    if (!result.ok || !result.audioBase64) {
      setError(result.error ?? t('voiceFailed'))
      return
    }
    const { audio, url } = createTtsAudio(result)
    audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
    try {
      await audio.play()
      setMessage(t('voiceTested'))
    } catch (cause) {
      URL.revokeObjectURL(url)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const save = async (): Promise<void> => {
    setMessage('')
    setError('')
    try {
      const config = await window.harnessdesk.setTtsConfig(value, apiKey || undefined)
      onSaved(config)
      setValue(config.tts)
      setApiKey('')
      setMessage(t('voiceSaved'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <div className="page-block diagnostics-page voice-page">
      <SpeakerHigh size={34} weight="regular" className="page-icon" />
      <h1>{t('voiceTitle')}</h1>
      <p className="lead">{t('voiceBody')}</p>
      <label className="toggle-row">
        <input type="checkbox" checked={value.enabled} onChange={event => setValue({ ...value, enabled: event.target.checked })} />
        <span aria-hidden="true"><i /></span>
        <strong>{t('voiceEnabled')}</strong>
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={value.autoPlay} onChange={event => setValue({ ...value, autoPlay: event.target.checked })} />
        <span aria-hidden="true"><i /></span>
        <strong>{t('voiceAutoPlay')}</strong>
      </label>
      <div className="vision-fields">
        <label className="input-block">
          <span>{t('voiceEndpoint')}</span>
          <input value={value.endpoint} spellCheck={false} onChange={event => setValue({ ...value, endpoint: event.target.value })} />
        </label>
        <label className="input-block">
          <span>{t('voiceApiKey')}</span>
          <input type="password" autoComplete="off" value={apiKey} placeholder={t('voiceKeyPlaceholder')} onChange={event => setApiKey(event.target.value)} />
          <small>{t('voiceKeyHelp')}</small>
        </label>
      </div>
      <div className="vision-fields">
        <label className="input-block">
          <span>{t('voiceModel')}</span>
          <select value={value.model} onChange={event => setValue({ ...value, model: event.target.value as TtsModel })}>
            {ttsModels.map(model => <option value={model} key={model}>{model}</option>)}
          </select>
        </label>
        <label className="input-block">
          <span>{t('voicePreset')}</span>
          <select value={value.voice} disabled={value.model !== 'mimo-v2.5-tts'} onChange={event => setValue({ ...value, voice: event.target.value })}>
            {ttsVoices.map(voice => <option value={voice} key={voice}>{voice}</option>)}
          </select>
        </label>
      </div>
      <label className="input-block">
        <span>{t('voiceStyle')}</span>
        <input value={value.style} placeholder={t('voiceStylePlaceholder')} onChange={event => setValue({ ...value, style: event.target.value })} />
        <small>{value.model === 'mimo-v2.5-tts-voiceclone' ? t('voiceCloneReserved') : value.model === 'mimo-v2.5-tts-voicedesign' ? t('voiceDesignReserved') : t('voiceStyleHelp')}</small>
      </label>
      <p className="privacy-note"><ShieldCheck {...iconProps} />{t('voicePrivacy')}</p>
      {message && <p className="success-note" role="status">{message}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="diagnostic-actions">
        <button className="secondary" onClick={() => { void test() }} disabled={testing}><SpeakerHigh {...iconProps} />{testing ? t('voiceTesting') : t('voiceTest')}</button>
        <button className="primary" onClick={() => { void save() }}>{t('voiceSave')}</button>
        <button className="text-button" onClick={() => { void window.harnessdesk.showHarness() }}><ArrowLeft {...iconProps} />{t('returnHarness')}</button>
      </div>
    </div>
  )
}

export function App() {
  const [config, setConfig] = useState<DesktopConfig>()
  const [step, setStep] = useState(0)
  const [workspace, setWorkspace] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [runtime, setRuntime] = useState<RuntimeState>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const view = useMemo(() => new URLSearchParams(location.search).get('view') ?? 'home', [])

  useEffect(() => {
    void window.harnessdesk.getConfig().then(value => {
      setConfig(value)
      setWorkspace(value.lastWorkspace ?? '')
      if (value.onboardingComplete && view === 'home') {
        setBusy(true)
        void window.harnessdesk.startRuntime().then(result => {
          if (!result.ok) setError(result.error ?? 'Harness failed to start')
          setBusy(false)
        })
      }
    })
    void window.harnessdesk.getRuntimeState().then(setRuntime)
    return window.harnessdesk.onRuntimeState(setRuntime)
  }, [view])

  if (config === undefined) return <div className="boot"><Brand /></div>
  const locale = config.locale
  const setLocale = (next: Locale): void => {
    setConfig({ ...config, locale: next })
    void window.harnessdesk.setLocale(next).then(setConfig)
  }
  if (view === 'diagnostics') return <Shell locale={locale} onLocale={setLocale}><DiagnosticsPage locale={locale} /></Shell>
  if (view === 'vision') return <Shell locale={locale} onLocale={setLocale}><VisionSettingsPage locale={locale} initial={config.visionBridge} onSaved={setConfig} /></Shell>
  if (view === 'voice') return <Shell locale={locale} onLocale={setLocale}><VoiceSettingsPage locale={locale} initial={config.tts} onSaved={setConfig} /></Shell>

  const launch = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const result = await window.harnessdesk.completeOnboarding({
      locale,
      workspace,
      ...(apiKey.trim().length === 0 ? {} : { apiKey }),
    })
    if (!result.ok) setError(result.error ?? 'Harness failed to start')
    setBusy(false)
  }
  const retry = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const result = await window.harnessdesk.retryRuntime()
    if (!result.ok) setError(result.error ?? 'Harness failed to start')
    setBusy(false)
  }

  let page: React.ReactNode
  if (!config.onboardingComplete) {
    if (step === 0) page = <Welcome locale={locale} next={() => setStep(1)} />
    else if (step === 1) page = <WorkspaceStep locale={locale} workspace={workspace} setWorkspace={setWorkspace} back={() => setStep(0)} next={() => setStep(2)} />
    else page = <KeyStep locale={locale} apiKey={apiKey} setApiKey={setApiKey} back={() => setStep(1)} launch={() => { void launch() }} busy={busy} error={error} />
  } else if (error || runtime?.phase === 'failed') {
    page = <Failure locale={locale} error={error || runtime?.error || 'Unknown error'} retry={() => { void retry() }} diagnostics={() => { void window.harnessdesk.showDiagnostics() }} />
  } else {
    page = <Loading locale={locale} runtime={runtime} />
  }

  return <Shell locale={locale} onLocale={setLocale} step={config.onboardingComplete ? 2 : step}>{page}</Shell>
}
