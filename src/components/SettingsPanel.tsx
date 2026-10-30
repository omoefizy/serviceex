import {
  ChevronLeft,
  BookOpen,
  Cloud,
  Copy,
  Download,
  FolderOpen,
  HardDrive,
  Highlighter,
  HardDriveDownload,
  Image,
  KeyRound,
  Layers,
  LayoutPanelLeft,
  Library,
  Link2,
  Mic,
  MicOff,
  Monitor,
  Moon,
  Palette,
  Plug,
  PlugZap,
  Plus,
  Play,
  Presentation,
  Quote,
  RefreshCw,
  Save,
  Sparkles,
  Square,
  Stethoscope,
  Sun,
  SunMoon,
  Trash2,
  Type,
  Unplug,
  Wifi,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { SETTINGS_PAGE_EVENT, takeSettingsPage } from '../lib/shell'
import type {
  AiModel,
  AiStatus,
  AppSettings,
  DisplayInfo,
  HighlightColor,
  KeyProvider,
  Layout,
  PairedDevice,
  LivePowerPointTestResult,
  OutputDisplay,
  PresentationEngineId,
  PresentationEngineSetting,
  PresentationEngineStatus,
  SpeechEngineId,
  SpeechKeyStatus,
  ThemeContentType,
  WhisperModelId,
  WhisperStatus,
} from '../../shared/types'
import { HIGHLIGHT_COLORS, HIGHLIGHT_KINDS } from '../../shared/highlights'
import { can, hasFeature, type FeatureKey } from '../../shared/features'
import { createLayout, deleteLayout, duplicateLayout, LAYOUT_PANELS, renameLayout, updateLayout } from '../../shared/layouts'
import { DEFAULT_SHARE_PORT, formatBytes, parseShareAddress } from '../../shared/sharing'
import { recentProblems } from '../lib/diagnostics'
import { describeError, reportError, type ErrorLike } from '../lib/errors'
import { useOperatorStore } from '../store'
import { dspOf, rememberDevice } from '../lib/listener'
import {
  capabilitiesOf,
  listMicrophones,
  SignalWatch,
  startMic,
  TARGET_PEAK_DB,
  TARGET_RMS_DB,
  type MicCapture,
  type MicDevice,
  type MicReading,
  type MicState,
  type SignalAdvice,
} from '../lib/mic'
import { IS_MAC, MOD } from '../lib/shortcuts'
import { switchLayout } from '../lib/layouts'
import { beginPairingAt, errorText, TROUBLESHOOTING_ID, useSharingStore } from '../lib/sharing'
import { usePersistentState } from '../lib/usePersistentState'
import { LevelMeter } from './LevelMeter'
import { ScriptureDisplayForm } from './ScriptureDisplay'
import { ThemeDefaultsForm } from './ThemeEditor'
import { UpgradeNote } from './UpgradeNote'
import { AccountSection, BalanceLines } from './AccountSection'
import { CopyDiagnosticsButton } from './PanelBoundary'
import { openPlans, useAccount } from '../lib/account'
import { formatHours } from '../../shared/account'
import { Button, Card, ErrorNote, IconButton, Input, SegmentedControl, Select, Toggle } from './ui'

/** The church's name and the footer line for exports, saved when the field is left. */
function ChurchProfileFields() {
  const churchName = useOperatorStore((s) => s.settings.churchName)
  const churchFooter = useOperatorStore((s) => s.settings.churchFooter)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [name, setName] = useState(churchName)
  const [footer, setFooter] = useState(churchFooter)
  useEffect(() => setName(churchName), [churchName])
  useEffect(() => setFooter(churchFooter), [churchFooter])
  return (
    <>
      <label className="field">
        <span>Church name</span>
        <Input
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== churchName && updateSettings({ churchName: name }).catch(console.error)}
        />
      </label>
      <label className="field">
        <span>
          Footer line <small>optional, such as an address or website, at the foot of each exported page</small>
        </span>
        <Input
          value={footer}
          maxLength={200}
          onChange={(e) => setFooter(e.target.value)}
          onBlur={() => footer !== churchFooter && updateSettings({ churchFooter: footer }).catch(console.error)}
        />
      </label>
      <p className="hint">Used on sermon exports. Each sermon keeps the church name it was recorded with.</p>
    </>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="settings-section" icon={icon} title={title}>
      {children}
    </Card>
  )
}

const APPEARANCES: { value: AppSettings['appearance']; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <SunMoon size={15} aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={15} aria-hidden="true" /> },
  { value: 'light', label: 'Light', icon: <Sun size={15} aria-hidden="true" /> },
]

const INTERVALS: { value: AppSettings['backupIntervalMinutes']; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
]

const KEY_PROVIDERS: { value: KeyProvider; label: string }[] = [
  { value: 'developer_key', label: 'Developer key' },
  { value: 'service', label: 'ServiceEx account' },
]

/** Where a service's key comes from, in developer builds: a key saved here, or the ServiceEx account (Settings, Account). */
function KeyProviderField({ value, onChange }: { value: KeyProvider; onChange(value: KeyProvider): void }) {
  return (
    <label className="field">
      <span>Key</span>
      <Select value={value} onChange={(e) => onChange(e.target.value as KeyProvider)}>
        {KEY_PROVIDERS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
    </label>
  )
}

/** `features`: the plan features a mode can run with; any one of them will do. Cloud falls back to offline. */
const LISTENING_MODES: { value: SpeechEngineId; label: string; icon: ReactNode; hint: string; features: FeatureKey[] }[] = [
  {
    value: 'auto',
    label: 'Cloud',
    features: ['listener.cloud', 'listener.offline'],
    icon: <Cloud size={15} aria-hidden="true" />,
    hint: 'Transcribes in the cloud, and switches to offline listening on this computer if the connection drops.',
  },
  {
    value: 'whisper',
    label: 'Offline',
    features: ['listener.offline'],
    icon: <HardDrive size={15} aria-hidden="true" />,
    hint: 'Transcribes on this computer: nothing leaves it, and no internet or account is needed once a model is downloaded.',
  },
]

/** Listening mode, the AI switch and the account's cloud listening hours. No keys here. */
function AiListeningSection() {
  const account = useAccount()
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [status, setStatus] = useState<SpeechKeyStatus | null>(null)

  useEffect(() => {
    window.api.speech.status().then(setStatus, console.error)
  }, [settings.speechEngine, settings.speechKeyProvider])

  // Cloud only, offered in developer builds, shows as Cloud.
  const mode = settings.speechEngine === 'whisper' ? 'whisper' : 'auto'
  return (
    <Section icon={<Sparkles size={16} aria-hidden="true" />} title="AI and listening">
      <div className="field">
        <span>Listening mode</span>
        <SegmentedControl
          aria-label="Listening mode"
          value={mode}
          options={LISTENING_MODES.map((m) => ({ value: m.value, label: m.label, icon: m.icon, disabled: !m.features.some(can) }))}
          onChange={(value) => updateSettings({ speechEngine: value })}
        />
        <span className="hint">{LISTENING_MODES.find((m) => m.value === mode)?.hint}</span>
        {mode === 'auto' && status?.cloudNotice && (
          <span className="hint" role="status">
            {status.cloudNotice}
          </span>
        )}
        {!can('listener.cloud') && <UpgradeNote feature="listener.cloud" />}
        {!can('listener.offline') && <UpgradeNote feature="listener.offline" />}
      </div>
      {account?.signedIn ? <BalanceLines account={account} /> : <p className="hint">Cloud listening hours: sign in to ServiceEx in Account above.</p>}

      <Toggle checked={settings.aiEnabled} onChange={(e) => updateSettings({ aiEnabled: e.target.checked })}>
        Use AI features
      </Toggle>
      <p className="hint">When this is off, ServiceEx sends nothing to Anthropic.</p>
    </Section>
  )
}

const AI_MODELS: { value: AiModel; label: string }[] = [
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recommended)' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (faster and cheaper)' },
]

/**
 * Developer builds only: the Anthropic key and model. The key is typed here once and goes to the main process; it is
 * never shown again.
 */
function AiDeveloperSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.api.ai.status().then(setStatus, console.error)
  }, [settings.aiEnabled, settings.aiModel])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setResult(null)
    const saved = await window.api.ai.setKey(key)
    // Drop the typed key from the page either way.
    setKey('')
    setBusy(false)
    if (saved.ok) {
      setStatus(saved.value)
      setResult({ ok: true, text: 'Key saved and encrypted.' })
    } else {
      setResult({ ok: false, text: saved.error.message })
    }
  }

  async function handleRemove() {
    setStatus(await window.api.ai.clearKey())
    setResult({ ok: true, text: 'Key removed.' })
  }

  async function handleTest() {
    setBusy(true)
    setResult(null)
    const tested = await window.api.ai.testConnection()
    setBusy(false)
    setResult(tested.ok ? { ok: true, text: `Connected. ${tested.value.model} is ready.` } : { ok: false, text: tested.error.message })
  }

  if (!status?.developerMode) return null
  return (
    <Section icon={<KeyRound size={16} aria-hidden="true" />} title="AI developer key">
      <p className="hint">Shown only in developer builds (SERVICEEX_DEV=1, or running unpackaged).</p>
      <KeyProviderField value={settings.aiKeyProvider} onChange={(aiKeyProvider) => updateSettings({ aiKeyProvider })} />

      {status && !status.encryptionAvailable && (
        <p className="error">This system cannot encrypt the key (no keychain or keyring), so it cannot be saved.</p>
      )}

      <form className="field" onSubmit={handleSave}>
        <label htmlFor="ai-key">Anthropic API key</label>
        <div className="settings-row">
          <Input
            id="ai-key"
            className="settings-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={status?.hasKey ? 'A key is saved. Enter a new one to replace it.' : 'sk-ant-…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button type="submit" disabled={!key.trim() || busy || status?.encryptionAvailable === false}>
            <KeyRound size={15} aria-hidden="true" /> Save key
          </Button>
          {status?.hasKey && (
            <Button onClick={handleRemove}>
              <Trash2 size={15} aria-hidden="true" /> Remove
            </Button>
          )}
        </div>
        <span className="hint">Encrypted by your operating system and stored on this computer only. It is never shown again.</span>
      </form>

      <label className="field">
        <span>Model</span>
        <Select value={settings.aiModel} onChange={(e) => updateSettings({ aiModel: e.target.value as AiModel })}>
          {AI_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </label>

      <div className="settings-row">
        <Button onClick={handleTest} disabled={busy || !status?.hasKey || !settings.aiEnabled}>
          <PlugZap size={15} aria-hidden="true" /> Test connection
        </Button>
        {result && (
          <span className={result.ok ? 'hint' : 'error'} role="status">
            {result.text}
          </span>
        )}
      </div>
    </Section>
  )
}

/** `features`: the plan features an engine can run with; any one of them will do. */
const SPEECH_ENGINES: { value: SpeechEngineId; label: string; icon: ReactNode; hint: string; features: FeatureKey[] }[] = [
  {
    value: 'auto',
    label: 'Auto',
    features: ['listener.cloud', 'listener.offline'],
    icon: <RefreshCw size={15} aria-hidden="true" />,
    hint:
      'Uses Deepgram in the cloud, and switches to whisper.cpp on this computer if the connection drops, without losing words. ' +
      'It goes back to the cloud once the connection has been stable for 20 seconds. Set up both below.',
  },
  {
    value: 'deepgram',
    label: 'Cloud only',
    features: ['listener.cloud'],
    icon: <Cloud size={15} aria-hidden="true" />,
    hint: 'Deepgram transcribes in the cloud: very accurate, needs the internet and an API key.',
  },
  {
    value: 'whisper',
    label: 'Offline only',
    features: ['listener.offline'],
    icon: <HardDrive size={15} aria-hidden="true" />,
    hint: 'whisper.cpp transcribes on this computer: nothing leaves it, and no internet is needed once a model is downloaded.',
  },
]

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`

/** The verdict for a measured real time factor, matching the listener's own (below 0.8 keeps up). */
function speedText(rtf: number | undefined, id: WhisperModelId): { text: string; ok: boolean } | null {
  if (rtf === undefined) return null
  if (rtf < 0.8) return { text: `Measured ${rtf.toFixed(2)}× real time on this computer: keeping up.`, ok: true }
  const smaller = id === 'base.en' ? 'tiny.en' : id === 'tiny.en' ? null : 'base.en'
  return { text: `Measured ${rtf.toFixed(2)}× real time: falling behind.${smaller ? ` Try ${smaller}.` : ''}`, ok: false }
}

/** Download, choose and delete whisper.cpp models, with a recommendation for this computer. */
function WhisperModels() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [status, setStatus] = useState<WhisperStatus | null>(null)
  const [received, setReceived] = useState<Partial<Record<WhisperModelId, number>>>({})
  const [errors, setErrors] = useState<Partial<Record<WhisperModelId, string>>>({})

  useEffect(() => {
    const refresh = () =>
      window.api.speech.whisper.status().then((next) => {
        setStatus(next)
        // Downloads that were already running when Settings opened.
        setReceived(Object.fromEntries(next.models.filter((m) => m.receivedBytes !== null).map((m) => [m.id, m.receivedBytes])))
      }, console.error)
    refresh()
    return window.api.speech.whisper.onProgress((progress) => {
      if (!progress.finished) {
        setReceived((r) => ({ ...r, [progress.id]: progress.receivedBytes }))
        return
      }
      setReceived((r) => {
        const next = { ...r }
        delete next[progress.id]
        return next
      })
      if (!progress.finished.ok && !progress.finished.cancelled) setErrors((e) => ({ ...e, [progress.id]: (progress.finished as { message: string }).message }))
      refresh()
    })
  }, [])

  async function download(id: WhisperModelId) {
    setErrors((e) => ({ ...e, [id]: undefined }))
    setReceived((r) => ({ ...r, [id]: 0 }))
    const result = await window.api.speech.whisper.download(id)
    // With nothing downloaded yet, the first model to arrive becomes the one in use.
    if (result.ok && !status?.models.some((m) => m.downloaded && m.id === settings.whisperModel)) {
      await updateSettings({ whisperModel: id })
    }
  }

  async function remove(id: WhisperModelId) {
    const result = await window.api.speech.whisper.deleteModel(id)
    if (!result.ok) setErrors((e) => ({ ...e, [id]: result.error.message }))
    setStatus(await window.api.speech.whisper.status())
  }

  if (!status) return null
  if (!status.engineInstalled) {
    return <p className="error">The offline engine is not included in this build. Developers: run npm run fetch:whisper.</p>
  }

  return (
    <div className="field">
      <span>Model</span>
      <p className="hint">
        This computer: {status.systemSummary}. Recommended: <strong>{status.recommended}</strong>. {status.recommendedReason}
      </p>
      <ul className="whisper-models">
        {status.models.map((model) => {
          const downloading = received[model.id] !== undefined
          const fraction = downloading ? (received[model.id] ?? 0) / model.sizeBytes : 0
          const speed = speedText(settings.whisperSpeed[model.id], model.id)
          const inUse = settings.whisperModel === model.id
          return (
            <li key={model.id} className={`whisper-model${inUse ? ' in-use' : ''}`}>
              <label className="whisper-model-choice">
                <input
                  type="radio"
                  name="whisper-model"
                  checked={inUse}
                  disabled={!model.downloaded}
                  onChange={() => updateSettings({ whisperModel: model.id })}
                />
                <span className="whisper-model-name">
                  {model.label} <span className="whisper-model-id">{model.id}</span>
                  {model.id === status.recommended && <span className="badge">Recommended</span>}
                </span>
                <span className="whisper-model-size">{megabytes(model.sizeBytes)}</span>
              </label>
              <p className="hint">{model.description}</p>
              {speed ? (
                <p className={speed.ok ? 'hint speed-ok' : 'error'}>{speed.text}</p>
              ) : (
                model.downloaded && <p className="hint">Its speed is measured the first time you listen with it.</p>
              )}
              {downloading && (
                <div className="settings-row">
                  <progress className="download-progress" max={1} value={fraction} aria-label={`Downloading ${model.label}`} />
                  <span className="hint">{Math.floor(fraction * 100)}%</span>
                  <Button onClick={() => window.api.speech.whisper.cancelDownload(model.id)}>
                    <X size={15} aria-hidden="true" /> Cancel
                  </Button>
                </div>
              )}
              {!downloading && (
                <div className="settings-row">
                  {model.downloaded ? (
                    <Button onClick={() => remove(model.id)}>
                      <Trash2 size={15} aria-hidden="true" /> Delete
                    </Button>
                  ) : (
                    <Button onClick={() => download(model.id).catch(console.error)}>
                      <Download size={15} aria-hidden="true" /> Download
                    </Button>
                  )}
                </div>
              )}
              {errors[model.id] && <p className="error">{errors[model.id]}</p>}
            </li>
          )
        })}
      </ul>
      <span className="hint">Models are saved in {status.folder}, and each download is checked against its published size and checksum.</span>
    </div>
  )
}

const MIC_STATES: Record<MicState, string> = {
  open: 'Connected',
  muted: 'Muted by the system; sending silence until it is back',
  reopening: 'Reconnecting',
  waiting: 'Not connected; it is opened as soon as it is plugged back in',
}

/** The audio test records this long. */
const TEST_SECONDS = 10

const formatDb = (db: number) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`

/**
 * Input, offline models and transcript saving for the sermon listener, and in developer builds the engine and the
 * Deepgram key. The key is typed here once and goes to the main process; it is never shown again.
 */
function ListenerSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [status, setStatus] = useState<SpeechKeyStatus | null>(null)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [testing, setTesting] = useState(false)
  const [reading, setReading] = useState<MicReading | null>(null)
  const [advice, setAdvice] = useState<SignalAdvice[]>([])
  const [opened, setOpened] = useState<MicDevice | null>(null)
  const [micState, setMicState] = useState<MicState | null>(null)
  const [micError, setMicError] = useState<ErrorLike | null>(null)
  /** 100 ms chunks recorded so far while the audio test records; null when not recording. */
  const [recordedChunks, setRecordedChunks] = useState<number | null>(null)
  const [recording, setRecording] = useState<ArrayBuffer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [heard, setHeard] = useState<{ ok: boolean; text: string } | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const capture = useRef<MicCapture | null>(null)
  const chunks = useRef<ArrayBuffer[] | null>(null)
  const player = useRef<AudioContext | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.api.speech.status().then(setStatus, console.error)
    const refresh = () => listMicrophones().then(setMics, console.error)
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])

  // Stop playing when Settings closes.
  useEffect(() => () => void player.current?.close().catch(() => undefined), [])

  const active = testing || recordedChunks !== null
  // The meter (and the audio test's recording) runs on the chosen input, and restarts when the choice changes.
  useEffect(() => {
    if (!active) return
    let started: MicCapture | null = null
    let cancelled = false
    const watch = new SignalWatch()
    setMicError(null)
    startMic({
      deviceId: settings.micDeviceId,
      deviceName: settings.micDeviceName,
      processing: settings.micProcessing,
      dsp: dspOf(useOperatorStore.getState().settings),
      onReading(next) {
        watch.push(next)
        setReading(next)
        setAdvice(watch.advice(useOperatorStore.getState().settings.micChannel))
      },
      onChunk(pcm) {
        const list = chunks.current
        if (!list) return
        list.push(pcm)
        setRecordedChunks(list.length)
        if (list.length < TEST_SECONDS * 10) return
        // Ten seconds: join the chunks into one recording.
        const joined = new Uint8Array(list.reduce((sum, c) => sum + c.byteLength, 0))
        let at = 0
        for (const c of list) {
          joined.set(new Uint8Array(c), at)
          at += c.byteLength
        }
        chunks.current = null
        setRecording(joined.buffer)
        setRecordedChunks(null)
      },
      onDevice(device) {
        setOpened(device)
        rememberDevice(device)
      },
      onState: setMicState,
    }).then(
      (capturing) => {
        if (cancelled) return capturing.stop()
        started = capturing
        capture.current = capturing
        // Names are only listed once the microphone is allowed.
        listMicrophones().then(setMics, console.error)
      },
      (error: unknown) => {
        if (cancelled) return
        setMicError(reportError('Settings', error))
        setTesting(false)
        chunks.current = null
        setRecordedChunks(null)
      },
    )
    return () => {
      cancelled = true
      started?.stop()
      capture.current = null
      setReading(null)
      setAdvice([])
      setMicState(null)
    }
  }, [active, settings.micDeviceId, settings.micDeviceName, settings.micProcessing])

  // Channel, gain, filter and gate changes are heard at once.
  const dsp = dspOf(settings)
  useEffect(() => {
    capture.current?.configure(dsp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dsp.channel, dsp.gainDb, dsp.highPass, dsp.noiseGate, dsp.gateThresholdDb])

  function startRecording() {
    void player.current?.close().catch(() => undefined)
    player.current = null
    setPlaying(false)
    setRecording(null)
    setHeard(null)
    chunks.current = []
    setRecordedChunks(0)
  }

  function stopRecording() {
    chunks.current = null
    setRecordedChunks(null)
  }

  function play() {
    if (!recording) return
    void player.current?.close().catch(() => undefined)
    const samples = new Int16Array(recording)
    const context = new AudioContext()
    const buffer = context.createBuffer(1, samples.length, 16000)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.onended = () => {
      if (player.current !== context) return
      player.current = null
      setPlaying(false)
      context.close().catch(() => undefined)
    }
    player.current = context
    setPlaying(true)
    source.start()
  }

  function stopPlaying() {
    void player.current?.close().catch(() => undefined)
    player.current = null
    setPlaying(false)
  }

  async function transcribe() {
    if (!recording) return
    setTranscribing(true)
    setHeard(null)
    const answer = await window.api.speech.transcribeTest(recording)
    setTranscribing(false)
    if (!answer.ok) setHeard({ ok: false, text: answer.error.message })
    else setHeard({ ok: true, text: answer.value.text ? `${answer.value.engine} heard: “${answer.value.text}”` : `${answer.value.engine} heard nothing.` })
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setResult(null)
    const saved = await window.api.speech.setKey(key)
    // Drop the typed key from the page either way.
    setKey('')
    setBusy(false)
    if (saved.ok) {
      setStatus(saved.value)
      setResult({ ok: true, text: 'Key saved and encrypted.' })
    } else {
      setResult({ ok: false, text: saved.error.message })
    }
  }

  async function handleRemove() {
    setStatus(await window.api.speech.clearKey())
    setResult({ ok: true, text: 'Key removed.' })
  }

  async function handleTest() {
    setBusy(true)
    setResult(null)
    const tested = await window.api.speech.testConnection()
    setBusy(false)
    setResult(tested.ok ? { ok: true, text: `Connected. Deepgram ${tested.value.model} is ready.` } : { ok: false, text: tested.error.message })
  }

  // The saved device, found by id or, when its id has changed, by name.
  const selected = mics.find((m) => m.deviceId === settings.micDeviceId) ?? mics.find((m) => settings.micDeviceName !== null && m.label === settings.micDeviceName)
  const chosenMissing = settings.micDeviceId !== null && mics.length > 0 && !selected
  const caps = capabilitiesOf(selected)
  const shown = opened && (!selected || opened.deviceId === selected.deviceId) ? opened : null
  const channels = shown?.channels ?? caps.channels
  const sampleRate = shown?.sampleRate ?? caps.sampleRate
  const channelCount = Math.max(2, channels ?? 2, typeof settings.micChannel === 'number' ? settings.micChannel : 0)

  return (
    <Section icon={<Mic size={16} aria-hidden="true" />} title="Sermon listener">
      <label className="field">
        <span>Audio input</span>
        <Select
          value={selected?.deviceId ?? settings.micDeviceId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null
            const label = mics.find((m) => m.deviceId === id)?.label || null
            updateSettings({ micDeviceId: id, micDeviceName: id ? label : null })
          }}
        >
          <option value="">System default</option>
          {mics.map((m, i) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Input ${i + 1}`}
            </option>
          ))}
          {chosenMissing && <option value={settings.micDeviceId ?? ''}>{settings.micDeviceName ?? 'Chosen input'} (not connected)</option>}
        </Select>
        <span className="hint">
          {chosenMissing
            ? 'Not connected. Listening waits for it, sending silence, and picks it up as soon as it is plugged back in.'
            : [
                channels ? `${channels} channel${channels === 1 ? '' : 's'}` : null,
                sampleRate ? `${sampleRate} Hz` : null,
                shown?.bluetooth ? 'Bluetooth' : null,
                micState && micState !== 'open' ? MIC_STATES[micState] : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Includes USB audio interfaces and mixers.'}
        </span>
      </label>

      <label className="field">
        <span>Channel</span>
        <Select
          value={String(settings.micChannel)}
          onChange={(e) => {
            const value = e.target.value
            updateSettings({ micChannel: value === 'mono' || value === 'left' || value === 'right' ? value : Number(value) })
          }}
        >
          <option value="mono">Mono (left and right mixed)</option>
          <option value="left">Left (channel 1)</option>
          <option value="right">Right (channel 2)</option>
          {Array.from({ length: channelCount - 2 }, (_, i) => i + 3).map((n) => (
            <option key={n} value={n}>
              Channel {n}
            </option>
          ))}
        </Select>
        <span className="hint">
          {settings.micProcessing
            ? 'Processing for room microphones mixes the input to mono, so the channel choice has no effect.'
            : 'A feed from the desk often arrives on one side of a stereo interface, or on its own channel of a multichannel one.'}
        </span>
      </label>

      <label className="field">
        <span>Input gain: {formatDb(settings.micGainDb)}</span>
        <input
          type="range"
          min={-24}
          max={12}
          step={0.5}
          value={settings.micGainDb}
          onChange={(e) => updateSettings({ micGainDb: Number(e.target.value) })}
          onDoubleClick={() => updateSettings({ micGainDb: 0 })}
        />
      </label>
      <Toggle checked={settings.micHighPass} onChange={(e) => updateSettings({ micHighPass: e.target.checked })}>
        High-pass filter at 80 Hz (removes rumble)
      </Toggle>
      <Toggle checked={settings.micNoiseGate} onChange={(e) => updateSettings({ micNoiseGate: e.target.checked })}>
        Noise gate
      </Toggle>
      <label className="field">
        <span>Gate threshold: {settings.micGateThresholdDb} dBFS</span>
        <input
          type="range"
          min={-80}
          max={-30}
          step={1}
          value={settings.micGateThresholdDb}
          disabled={!settings.micNoiseGate}
          onChange={(e) => updateSettings({ micGateThresholdDb: Number(e.target.value) })}
        />
        <span className="hint">Below the threshold the signal is lowered by 18 dB, not muted. A limiter always stops the signal clipping.</span>
      </label>

      <div className="settings-row">
        <Button onClick={() => setTesting(!testing)}>
          {testing ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
          {testing ? 'Stop meter' : 'Test input level'}
        </Button>
        <LevelMeter reading={reading} />
      </div>
      <p className="hint">
        Aim for an average around {TARGET_RMS_DB} dBFS (where green turns amber) with peaks below {TARGET_PEAK_DB} dBFS (where amber
        turns red). Gain and cleanup changes are heard at once, also while listening.
      </p>
      {active && advice.length > 0 && (
        <ul className="mic-advice">
          {advice.map((item) => (
            <li key={item.text} className={item.level}>
              {item.text}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={micError} />

      <div className="settings-row">
        {recordedChunks === null ? (
          <Button onClick={startRecording} disabled={transcribing}>
            <Mic size={15} aria-hidden="true" /> Record {TEST_SECONDS} s test
          </Button>
        ) : (
          <Button onClick={stopRecording}>
            <Square size={14} aria-hidden="true" /> Recording… {Math.ceil(TEST_SECONDS - recordedChunks / 10)} s
          </Button>
        )}
        <Button disabled={!recording} onClick={playing ? stopPlaying : play}>
          {playing ? <Square size={14} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          {playing ? 'Stop' : 'Play back'}
        </Button>
        <Button disabled={!recording || transcribing} onClick={() => transcribe().catch(console.error)}>
          <Quote size={15} aria-hidden="true" /> {transcribing ? 'Transcribing…' : 'Transcribe test'}
        </Button>
      </div>
      <p className="hint">Records what the speech engine hears (after the channel, gain and cleanup), then plays it back or sends it to the engine.</p>
      {heard && (
        <p className={heard.ok ? 'mic-heard' : 'error'} role="status">
          {heard.text}
        </p>
      )}

      <Toggle checked={settings.micProcessing} onChange={(e) => updateSettings({ micProcessing: e.target.checked })}>
        Processing for room microphones
      </Toggle>
      <p className="hint">
        Echo cancellation, noise suppression and automatic gain. Off (the default) sends the raw signal, which suits a line feed from
        the sound desk or a lectern microphone; turn it on for a laptop or room microphone. Applies the next time the input opens.
      </p>

      {status?.developerMode && (
        <div className="field">
          <span>Speech engine</span>
          <SegmentedControl
            aria-label="Speech engine"
            value={settings.speechEngine}
            options={SPEECH_ENGINES.map((engine) => ({ value: engine.value, label: engine.label, icon: engine.icon, disabled: !engine.features.some(can) }))}
            onChange={(value) => updateSettings({ speechEngine: value })}
          />
          <span className="hint">
            {SPEECH_ENGINES.find((e) => e.value === settings.speechEngine)?.hint}
          </span>
        </div>
      )}

      {(settings.speechEngine !== 'deepgram' || !status?.developerMode) && <WhisperModels />}

      {status?.developerMode && settings.speechEngine !== 'whisper' && !status.encryptionAvailable && (
        <p className="error">This system cannot encrypt the key (no keychain or keyring), so it cannot be saved.</p>
      )}
      {status?.developerMode && settings.speechEngine !== 'whisper' && (
        <>
          <KeyProviderField value={settings.speechKeyProvider} onChange={(speechKeyProvider) => updateSettings({ speechKeyProvider })} />
          <form className="field" onSubmit={handleSave}>
            <label htmlFor="deepgram-key">Deepgram API key</label>
            <div className="settings-row">
              <Input
                id="deepgram-key"
                className="settings-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={status?.hasKey ? 'A key is saved. Enter a new one to replace it.' : 'Deepgram key'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button type="submit" disabled={!key.trim() || busy || status?.encryptionAvailable === false}>
                <KeyRound size={15} aria-hidden="true" /> Save key
              </Button>
              {status?.hasKey && (
                <Button onClick={handleRemove}>
                  <Trash2 size={15} aria-hidden="true" /> Remove
                </Button>
              )}
            </div>
            <span className="hint">Encrypted by your operating system and stored on this computer only. It is never shown again.</span>
          </form>
          <div className="settings-row">
            <Button onClick={handleTest} disabled={busy || !status?.hasKey}>
              <PlugZap size={15} aria-hidden="true" /> Test connection
            </Button>
            {result && (
              <span className={result.ok ? 'hint' : 'error'} role="status">
                {result.text}
              </span>
            )}
          </div>
        </>
      )}

      <Toggle checked={settings.saveTranscripts} onChange={(e) => updateSettings({ saveTranscripts: e.target.checked })}>
        Save transcripts
      </Toggle>
      <p className="hint">
        Off: the transcript is kept in memory only and is gone when the app closes. On: each listening session is also written to a
        text file{status ? ` in ${status.transcriptsFolder}` : ''}.
      </p>
    </Section>
  )
}

const DETECTION_ALERTS: { value: AppSettings['detectionAlert']; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'sound', label: 'Sound' },
  { value: 'flash', label: 'Flash' },
]

/** Scripture suggestions from the live transcript: on or off, how sure they must be, and how they announce themselves. */
/** The default translation, switching translations on the Live box, and two translations on one slide. */
function ScriptureSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const versions = useOperatorStore((s) => s.bibleVersions)
  const dual = settings.scriptureDual
  const listed = versions.some((v) => v.code === settings.scriptureDefaultVersion) ? versions : [{ code: settings.scriptureDefaultVersion, name: '' }, ...versions]
  return (
    <Section icon={<BookOpen size={16} aria-hidden="true" />} title="Scripture">
      <label className="field">
        <span>
          Default translation <small>For a typed reference, listener suggestions, search set to All, and the command palette.</small>
        </span>
        <Select value={settings.scriptureDefaultVersion} onChange={(e) => updateSettings({ scriptureDefaultVersion: e.target.value })}>
          {listed.map((v) => (
            <option key={v.code} value={v.code}>
              {v.name ? `${v.code} · ${v.name}` : v.code}
            </option>
          ))}
        </Select>
      </label>
      <p className="hint">A service can use its own translation: pick it in the schedule header.</p>
      <Toggle
          checked={settings.scriptureSwitchLiveImmediately}
          onChange={(e) => updateSettings({ scriptureSwitchLiveImmediately: e.target.checked })}
      >
        Switch live immediately
      </Toggle>
      <p className="hint">
        On: a version chip on the Live box (or {MOD}1 to 9, Alt+Shift+↑ and Alt+Shift+↓) crossfades the live verse into that translation. Off: the new
        translation waits in the preview, and you resend it.
      </p>
      <div className="field">
        <span>Two translations on a slide</span>
        <SegmentedControl
          aria-label="Second translation layout"
          value={dual.layout}
          options={DUAL_LAYOUTS.map((l) => ({ value: l.value, label: l.label }))}
          onChange={(value) => updateSettings({ scriptureDual: { ...dual, layout: value } })}
        />
        <span className="hint">
          Turn it on and pick the versions from the Dual menu on the Preview or Live box. A theme with two text boxes uses its own layout.
        </span>
      </div>
    </Section>
  )
}

/** Live highlighting: what happens to the marks when the slide changes, and the brush it starts with. */
function HighlightSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const brush = settings.highlightDefault
  return (
    <Section icon={<Highlighter size={16} aria-hidden="true" />} title="Live highlighting">
      <p className="hint">
        Mark words on the Live or Preview box: {MOD}H turns highlight mode on, then click a word, drag across a phrase or double click a
        sentence. 1 to 5 pick a color, Esc clears the live slide.
      </p>
      <Toggle
          checked={settings.highlightClearOnSlideChange}
          onChange={(e) => updateSettings({ highlightClearOnSlideChange: e.target.checked })}
      >
        Clear highlights when the slide changes
      </Toggle>
      <Toggle checked={settings.highlightKeepWithItem} onChange={(e) => updateSettings({ highlightKeepWithItem: e.target.checked })}>
        Keep highlights with the schedule item
      </Toggle>
      <p className="hint">On: a schedule item's highlights come back when it is loaded again, until the app closes.</p>
      <div className="field">
        <span>Default style</span>
        <SegmentedControl
          aria-label="Default highlight style"
          value={brush.kind}
          options={HIGHLIGHT_KINDS.map((k) => ({ value: k.id, label: k.label }))}
          onChange={(value) => updateSettings({ highlightDefault: { ...brush, kind: value } })}
        />
      </div>
      <label className="field">
        <span>Default color</span>
        <Select
          value={brush.color}
          onChange={(e) => updateSettings({ highlightDefault: { ...brush, color: e.target.value as HighlightColor } })}
        >
          {HIGHLIGHT_COLORS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </label>
    </Section>
  )
}

const DUAL_LAYOUTS: { value: AppSettings['scriptureDual']['layout']; label: string }[] = [
  { value: 'stacked', label: 'One above the other' },
  { value: 'sideBySide', label: 'Side by side' },
]

function DetectionSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const percent = Math.round(settings.detectionMinConfidence * 100)
  return (
    <Section icon={<BookOpen size={16} aria-hidden="true" />} title="Scripture detection">
      <Toggle checked={settings.scriptureDetection} onChange={(e) => updateSettings({ scriptureDetection: e.target.checked })}>
        Suggest verses heard in the sermon
      </Toggle>
      <p className="hint">
        References spoken aloud, such as "John chapter three verse sixteen", and verses quoted without a reference appear above the
        slides. Clicking one puts it in the preview; it only goes live when you send it.
      </p>
      <label className="field">
        <span>Minimum confidence: {percent}%</span>
        <input
          type="range"
          min={30}
          max={95}
          step={5}
          value={percent}
          disabled={!settings.scriptureDetection}
          onChange={(e) => updateSettings({ detectionMinConfidence: Number(e.target.value) / 100 })}
        />
        <span className="hint">
          Lower shows more, including possible quotes and bare chapter numbers; higher shows only clearly named verses.
        </span>
      </label>
      <div className="field">
        <span>On a new suggestion</span>
        <SegmentedControl
          aria-label="On a new suggestion"
          value={settings.detectionAlert}
          options={DETECTION_ALERTS.map((a) => ({ value: a.value, label: a.label, disabled: !settings.scriptureDetection }))}
          onChange={(value) => updateSettings({ detectionAlert: value })}
        />
      </div>
      <Toggle title={settings.aiEnabled ? undefined : 'AI features are turned off above'}
          checked={settings.aiEnabled && settings.aiScriptureFallback}
          disabled={!settings.aiEnabled || !settings.scriptureDetection}
          onChange={(e) => updateSettings({ aiScriptureFallback: e.target.checked })}
      >
        Ask AI when nothing is found
      </Toggle>
      <p className="hint">
        {settings.aiEnabled
          ? 'When the talk sounds like scripture ("the Bible says", "in the book of") but nothing is found for 8 seconds, the last 25 seconds of transcript go to Claude Haiku, at most once every 10 seconds. It names passages only, each checked against the Bible here; they are marked "AI suggested".'
          : 'Turn on AI features above to use this.'}
      </p>
    </Section>
  )
}

/** Quote slides from the sermon: the default speaker line, and AI statement suggestions (off by default). */
const PRESENTATION_ENGINES: { value: PresentationEngineSetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'powerpoint', label: 'PowerPoint' },
  { value: 'libreoffice', label: 'LibreOffice' },
]

const ENGINE_LABELS: Record<PresentationEngineId, string> = {
  'powerpoint-windows': 'Microsoft PowerPoint (through COM)',
  'powerpoint-mac': 'Microsoft PowerPoint (through AppleScript)',
  libreoffice: 'LibreOffice (headless)',
}

function PresentationsSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [status, setStatus] = useState<PresentationEngineStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<ErrorLike | null>(null)

  useEffect(() => {
    window.api.presentations.engineStatus().then(setStatus, console.error)
  }, [settings.presentationEngine])

  async function test() {
    setTesting(true)
    setResult(null)
    setError(null)
    try {
      const done = await window.api.presentations.testConversion()
      setResult(`${ENGINE_LABELS[done.engine]} converted ${done.slides} slides in ${(done.ms / 1000).toFixed(1)} s.`)
    } catch (err) {
      setError(reportError('Settings', err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Section icon={<Presentation size={16} aria-hidden="true" />} title="Presentations">
      <div className="field">
        <span>PowerPoint engine</span>
        <SegmentedControl
          aria-label="PowerPoint engine"
          value={settings.presentationEngine}
          options={PRESENTATION_ENGINES.map((engine) => ({ value: engine.value, label: engine.label }))}
          onChange={(value) => updateSettings({ presentationEngine: value })}
        />
        <span className="hint">Auto uses desktop PowerPoint when it is installed, otherwise LibreOffice. PDFs and images need neither.</span>
      </div>
      {status && (status.active ? <p className="hint">Active: {ENGINE_LABELS[status.active]}</p> : <ErrorNote error={describeError(status.message)} />)}
      <div className="settings-row">
        <Button disabled={testing || !status?.active} onClick={test}>
          <RefreshCw size={15} aria-hidden="true" /> {testing ? 'Converting…' : 'Test conversion'}
        </Button>
        {result && <span className="hint">{result}</span>}
      </div>
      <ErrorNote error={error} />
      {status?.active === 'powerpoint-mac' && (
        <p className="hint">
          The first conversion asks to let ServiceEx control PowerPoint. If it was turned down, allow it in System Settings, Privacy and
          Security, Automation.
        </p>
      )}
      <Toggle
          checked={settings.presentationAutoRefreshLive}
          onChange={(e) => updateSettings({ presentationAutoRefreshLive: e.target.checked })}
      >
        Auto refresh live
      </Toggle>
      <p className="hint">
        When a presentation is saved again in PowerPoint, its slides here update. Off: if it is live, the output keeps the older slides
        until you press Resend. On: the output changes straight away.
      </p>
      <Toggle
          checked={settings.presentationLivePowerPoint}
          onChange={(e) => updateSettings({ presentationLivePowerPoint: e.target.checked })}
      >
        Play animations with PowerPoint
      </Toggle>
      <p className="hint">
        Slides with animations or transitions go live through PowerPoint itself, over the output display; every other slide stays a still
        image. Right arrow plays the next animation step, Left goes back. Sending anything else brings the output back at once, with the
        slide show waiting under it. If PowerPoint is missing or slow to start, the still slide shows instead. {IS_MAC ? '⌘⇧K' : 'Ctrl+Shift+K'}{' '}
        ends the slide show. Each presentation can be left out in the Presentations library.
      </p>
    </Section>
  )
}

const SHARE_LIMITS: { value: number; label: string }[] = [
  { value: 100, label: '100 MB' },
  { value: 500, label: '500 MB' },
  { value: 1024, label: '1 GB' },
  { value: 2048, label: '2 GB (default)' },
  { value: 5120, label: '5 GB' },
  { value: 10240, label: '10 GB' },
]

/** Local network sharing: on or off, this computer's name, limits and the paired devices. */
function SharingSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const status = useSharingStore((s) => s.status)
  const [name, setName] = useState(settings.sharingDeviceName)
  const [error, setError] = useState<ErrorLike | null>(null)

  useEffect(() => setName(settings.sharingDeviceName), [settings.sharingDeviceName])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(reportError('Settings', err))
    }
  }

  const limitOptions = SHARE_LIMITS.some((l) => l.value === settings.sharingMaxSizeMb)
    ? SHARE_LIMITS
    : [...SHARE_LIMITS, { value: settings.sharingMaxSizeMb, label: `${settings.sharingMaxSizeMb} MB` }]

  return (
    <Section icon={<Wifi size={16} aria-hidden="true" />} title="Sharing">
      <p className="sharing-notice">
        <Wifi size={15} aria-hidden="true" />
        <span>
          Uses your <strong>local network</strong> (the Wi-Fi or Ethernet this computer is on) to send songs, services, themes and media to other ServiceEx
          computers. Nothing goes over the internet. While on, computers on this network can see this computer's name; only paired ones can send to it.
        </span>
      </p>
      <Toggle checked={settings.sharingEnabled} onChange={(e) => run(() => updateSettings({ sharingEnabled: e.target.checked }))}>
        Share with other ServiceEx computers on this network
      </Toggle>
      <ErrorNote error={status?.error && describeError(status.error)} />
      {settings.sharingEnabled && status?.port && (
        <p className="hint">
          On as {status.deviceName}
          {status.addresses.length > 0 ? ` at ${status.addresses.join(', ')}` : ''} (port {status.port}).
        </p>
      )}
      <label className="field">
        <span>Device name</span>
        <Input
          value={name}
          maxLength={40}
          placeholder={status?.deviceName ?? 'This computer'}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== settings.sharingDeviceName && run(() => updateSettings({ sharingDeviceName: name }))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="hint">What other computers show on their device chips, such as "Sanctuary booth". Empty uses the computer's name.</span>
      </label>
      <label className="field">
        <span>Largest file to receive</span>
        <Select value={settings.sharingMaxSizeMb} onChange={(e) => run(() => updateSettings({ sharingMaxSizeMb: Number(e.target.value) }))}>
          {limitOptions.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
        <span className="hint">
          Allowed types: .serviceex packages, PowerPoint (.pptx, .ppt), PDF, images, MP4, WebM, MP3, WAV, .txt and OpenLyrics .xml. Anything else is refused,
          and nothing received is ever opened or run.
        </span>
      </label>
      <Toggle checked={settings.sharingAutoAccept} onChange={(e) => run(() => updateSettings({ sharingAutoAccept: e.target.checked }))}>
        Auto accept from trusted devices
      </Toggle>
      <p className="hint">
        Items from devices marked Trusted below go straight into the library, kept beside anything with the same name. They never change the output or go
        live.
      </p>

      <ErrorNote error={error} />
      <p className="hint">Paired computers, device chips and cues are under Devices below.</p>
    </Section>
  )
}

const THEME_TYPES: { type: ThemeContentType; label: string }[] = [
  { type: 'song', label: 'Songs' },
  { type: 'scripture', label: 'Scripture' },
  { type: 'announcement', label: 'Announcements' },
  { type: 'quote', label: 'Quotes' },
  { type: 'lowerThird', label: 'Lower thirds' },
  { type: 'logo', label: 'Logo' },
]

/** Named layouts: which panels this computer shows, and the defaults each one sets. No layout is tied to a computer. */
function LayoutsSection() {
  const layouts = useOperatorStore((s) => s.settings.layouts)
  const activeId = useOperatorStore((s) => s.settings.activeLayoutId)
  const themes = useOperatorStore((s) => s.themes)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [openId, setOpenId] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<ErrorLike | null>(null)

  const save = (action: () => Layout[]) => {
    setError(null)
    try {
      updateSettings({ layouts: action() }).catch((err) => setError(reportError('Settings', err)))
    } catch (err) {
      setError(reportError('Settings', err))
    }
  }

  if (!hasFeature('sharing.layouts')) return null
  return (
    <div id="settings-layouts">
      <Section icon={<LayoutPanelLeft size={16} aria-hidden="true" />} title="Layouts">
        <p className="hint">
          A layout is the set of panels this computer shows. Switch at any time from the toolbar, with {MOD}⌥1 to 9, or {MOD}⇧L for the next one. Settings
          and the editors always open, whatever the layout.
        </p>
        <ul className="layout-list">
          {layouts.map((layout) => (
            <li key={layout.id} className={layout.id === activeId ? 'active' : ''}>
              <div className="settings-row">
                <label className="input-hit" title={`Use ${layout.name}`}>
                  <input
                    type="radio"
                    name="active-layout"
                    aria-label={`Use ${layout.name}`}
                    checked={layout.id === activeId}
                    onChange={() => switchLayout(layout.id).catch((err) => setError(reportError('Settings', err)))}
                  />
                </label>
                <Input
                  className="layout-name"
                  aria-label="Layout name"
                  maxLength={40}
                  value={names[layout.id] ?? layout.name}
                  onChange={(e) => setNames((n) => ({ ...n, [layout.id]: e.target.value }))}
                  onBlur={() => {
                    const name = names[layout.id]
                    if (name !== undefined && name !== layout.name) save(() => renameLayout(layouts, layout.id, name))
                    setNames((n) => {
                      const rest = { ...n }
                      delete rest[layout.id]
                      return rest
                    })
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <Button aria-expanded={openId === layout.id} onClick={() => setOpenId(openId === layout.id ? null : layout.id)}>
                  Panels and defaults
                </Button>
                <IconButton
                  label={`Duplicate ${layout.name}`}
                  tooltip="Duplicate"
                  icon={<Copy size={15} />}
                  onClick={() => save(() => duplicateLayout(layouts, layout.id).layouts)}
                />
                <IconButton
                  label={`Delete ${layout.name}`}
                  tooltip="Delete"
                  icon={<Trash2 size={15} />}
                  disabled={layouts.length <= 1}
                  onClick={() => save(() => deleteLayout(layouts, layout.id))}
                />
              </div>
              {openId === layout.id && (
                <div className="layout-detail">
                  <fieldset className="layout-panels">
                    <legend>Panels</legend>
                    {LAYOUT_PANELS.map((panel) => (
                      <Toggle key={panel.id}
                          checked={layout.panels.includes(panel.id)}
                          onChange={(e) =>
                            save(() =>
                              updateLayout(layouts, layout.id, {
                                panels: e.target.checked ? [...layout.panels, panel.id] : layout.panels.filter((p) => p !== panel.id),
                              }),
                            )
                          }
                      >
                        {panel.label}
                      </Toggle>
                    ))}
                  </fieldset>
                  <label className="field">
                    <span>Shared service list starts on</span>
                    <Select
                      value={layout.itemFilter}
                      onChange={(e) => save(() => updateLayout(layouts, layout.id, { itemFilter: e.target.value === 'mine' ? 'mine' : 'all' }))}
                    >
                      <option value="all">All items</option>
                      <option value="mine">This computer's items</option>
                    </Select>
                  </label>
                  <label className="field">
                    <span>Output background when nothing is live</span>
                    <Select
                      value={layout.outputBackground ?? ''}
                      onChange={(e) => save(() => updateLayout(layouts, layout.id, { outputBackground: e.target.value === 'black' || e.target.value === 'logo' ? e.target.value : null }))}
                    >
                      <option value="">Leave as it is</option>
                      <option value="black">Black</option>
                      <option value="logo">Logo</option>
                    </Select>
                  </label>
                  <fieldset className="layout-themes">
                    <legend>Default themes set by this layout</legend>
                    {THEME_TYPES.map(({ type, label }) => (
                      <label key={type} className="field">
                        <span>{label}</span>
                        <Select
                          value={layout.themeDefaults[type] ?? ''}
                          onChange={(e) =>
                            save(() => {
                              const themeDefaults = { ...layout.themeDefaults }
                              if (e.target.value) themeDefaults[type] = Number(e.target.value)
                              else delete themeDefaults[type]
                              return updateLayout(layouts, layout.id, { themeDefaults })
                            })
                          }
                        >
                          <option value="">Leave as it is</option>
                          {themes.map((theme) => (
                            <option key={theme.id} value={theme.id}>
                              {theme.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}
            </li>
          ))}
        </ul>
        <Button
          onClick={() =>
            save(() => {
              const { layouts: next, layout } = createLayout(layouts, 'New layout')
              setOpenId(layout.id)
              return next
            })
          }
        >
          <Plus size={15} aria-hidden="true" /> New layout
        </Button>
        <ErrorNote error={error} />
      </Section>
    </div>
  )
}

/** Paired computers, the device chips, cues, and help when two computers cannot see each other. */
function DevicesSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const peers = useSharingStore((s) => s.peers)
  const [paired, setPaired] = useState<PairedDevice[]>([])
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [tests, setTests] = useState<Record<string, { busy: boolean; text: string; ok: boolean }>>({})
  const [forgetting, setForgetting] = useState<string | null>(null)
  const [error, setError] = useState<ErrorLike | null>(null)
  const status = useSharingStore((s) => s.status)
  const publicNetworks = status?.publicNetworks ?? []
  // The last address typed stays in the field, for pairing again or with the next computer on that network.
  const isText = (v: unknown): v is string => typeof v === 'string'
  const [host, setHost] = usePersistentState('serviceex.pairAddress', '', isText)
  const [port, setPort] = usePersistentState('serviceex.pairPort', String(DEFAULT_SHARE_PORT), isText)
  const [addressError, setAddressError] = useState<string | null>(null)

  function pairByAddress(e: FormEvent) {
    e.preventDefault()
    const address = parseShareAddress(host, port)
    if ('error' in address) return setAddressError(address.error)
    setAddressError(null)
    beginPairingAt(host, port).catch(console.error)
  }

  // The list follows pairing, renaming and forgetting, wherever they happen.
  useEffect(() => {
    window.api.sharing.paired().then(setPaired, console.error)
  }, [peers])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(reportError('Settings', err))
    }
  }

  async function test(id: string, kind: 'connection' | 'sync') {
    setTests((t) => ({ ...t, [id]: { busy: true, text: 'Testing…', ok: true } }))
    const call = kind === 'connection' ? window.api.sharing.testConnection(id) : window.api.sharing.testSync(id)
    const result = await call.catch((err) => ({ ok: false, error: errorText(err), ms: undefined }))
    const done = kind === 'connection' ? `Connected · ${result.ms} ms, encrypted` : `Sync works · ${result.ms} ms round trip`
    setTests((t) => ({ ...t, [id]: { busy: false, ok: result.ok, text: result.ok ? done : (result.error ?? 'Could not connect') } }))
  }

  return (
    <Section icon={<Plug size={16} aria-hidden="true" />} title="Devices">
      {hasFeature('sharing.presence') && (
        <Toggle checked={settings.sharingDeviceChips} onChange={(e) => run(() => updateSettings({ sharingDeviceChips: e.target.checked }))}>
          Device chips in the toolbar status area, with the title of what each computer has live
        </Toggle>
      )}
      <p className="hint">Only the title is shared, never the slide. Turned off, this computer also stops telling the others what it has live.</p>
      {hasFeature('sharing.send') && (
        <label className="field">
          <span>When a cue arrives</span>
          <Select value={settings.sharingCueAlert} onChange={(e) => run(() => updateSettings({ sharingCueAlert: e.target.value as AppSettings['sharingCueAlert'] }))}>
            <option value="off">Just show it in the tray (default)</option>
            <option value="sound">Play a short tone</option>
            <option value="flash">Flash the tray button</option>
          </Select>
          <span className="hint">Cues wait in the tray with Preview, Add to schedule and Dismiss. A cue never changes what is on the output.</span>
        </label>
      )}

      {publicNetworks.length > 0 && (
        <div className="error" role="alert">
          <p>
            Windows treats {publicNetworks.join(', ')} as a <strong>Public</strong> network, so it blocks other computers from reaching this one. If this is the
            church's own network, set it to Private:
          </p>
          <ol>
            <li>Open Windows Settings, then Network and internet.</li>
            <li>Choose Wi-Fi or Ethernet, then the network in use (on Windows 10: Status, then Properties).</li>
            <li>Under Network profile type, choose Private network.</li>
          </ol>
        </div>
      )}

      <form className="field" onSubmit={pairByAddress}>
        <span>Add by IP address</span>
        <div className="settings-row">
          <Input
            className="pair-address-input"
            aria-label="IP address or .local name of the other computer"
            placeholder="192.168.1.20"
            autoComplete="off"
            spellCheck={false}
            maxLength={253}
            value={host}
            onChange={(e) => {
              setHost(e.target.value)
              setAddressError(null)
            }}
          />
          <Input
            className="pair-port-input"
            aria-label="Port"
            inputMode="numeric"
            maxLength={5}
            value={port}
            onChange={(e) => {
              setPort(e.target.value.replace(/\D/g, ''))
              setAddressError(null)
            }}
          />
          <Button type="submit" disabled={!settings.sharingEnabled || !host.trim()}>
            <Link2 size={15} aria-hidden="true" /> Pair
          </Button>
        </div>
        {addressError && <p className="error">{addressError}</p>}
        <span className="hint">
          For a computer that does not appear as a chip. Its address and port are under Settings, Sharing on that computer. Only local network addresses work
          (10.x, 172.16 to 172.31.x, 192.168.x, 169.254.x, or a name ending in .local). Once paired, the address is remembered with the device.
        </span>
      </form>

      <div className="field">
        <span>Paired computers</span>
        {paired.length === 0 ? (
          <p className="hint">None yet. Turn Sharing on here and on the other computer, then click its chip in the toolbar to pair.</p>
        ) : (
          <ul className="paired-list">
            {paired.map((device) => {
              const peer = peers.find((p) => p.id === device.id)
              const online = peer?.online ?? false
              const result = tests[device.id]
              const shown = device.alias || device.name
              return (
                <li key={device.id}>
                  <div className="paired-device">
                    <span className={`device-dot${online ? ' online' : ''}`} aria-hidden="true" />
                    <strong>{shown}</strong>
                    <span className="hint">
                      {device.alias ? `${device.name} · ` : ''}
                      {device.disconnected ? 'disconnected' : online ? 'online' : 'offline'} · paired {new Date(device.pairedAt).toLocaleDateString()}
                      {peer?.liveTitle ? ` · live: ${peer.liveTitle}` : ''}
                    </span>
                  </div>
                  <div className="settings-row">
                    <Input
                      aria-label={`Name for ${device.name} on this computer`}
                      placeholder={device.name}
                      maxLength={40}
                      value={aliases[device.id] ?? device.alias}
                      onChange={(e) => setAliases((a) => ({ ...a, [device.id]: e.target.value }))}
                      onBlur={() => {
                        const alias = aliases[device.id]
                        if (alias !== undefined && alias !== device.alias) run(async () => setPaired(await window.api.sharing.setAlias(device.id, alias)))
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <Toggle title="Auto accept applies to trusted devices only"
                        checked={device.trusted}
                        onChange={(e) => run(async () => setPaired(await window.api.sharing.setTrusted(device.id, e.target.checked)))}
                    >
                      Trusted
                    </Toggle>
                  </div>
                  <div className="settings-row">
                    <Button
                      title={device.disconnected ? 'Exchange cues, the shared service and library sync with it again' : 'Stop exchanging anything with it, without forgetting the pairing'}
                      onClick={() => run(async () => setPaired(await window.api.sharing.setDisconnected(device.id, !device.disconnected)))}
                    >
                      {device.disconnected ? <Plug size={15} aria-hidden="true" /> : <Unplug size={15} aria-hidden="true" />} {device.disconnected ? 'Connect' : 'Disconnect'}
                    </Button>
                    <Button disabled={!settings.sharingEnabled || result?.busy} onClick={() => test(device.id, 'connection')}>
                      <PlugZap size={15} aria-hidden="true" /> Test connection
                    </Button>
                    <Button disabled={!settings.sharingEnabled || device.disconnected || result?.busy} onClick={() => test(device.id, 'sync')}>
                      <RefreshCw size={15} aria-hidden="true" /> Test sync
                    </Button>
                    {forgetting === device.id ? (
                      <>
                        <Button variant="danger"
                          onClick={() =>
                            run(async () => {
                              setPaired(await window.api.sharing.forget(device.id))
                              setForgetting(null)
                            })
                          }
                        >
                          Forget {shown}
                        </Button>
                        <Button onClick={() => setForgetting(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button onClick={() => setForgetting(device.id)}>
                        <Trash2 size={15} aria-hidden="true" /> Forget
                      </Button>
                    )}
                  </div>
                  {result && !result.busy && <p className={result.ok ? 'hint' : 'error'}>{result.text}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <ErrorNote error={error} />
      <details className="troubleshooting" id={TROUBLESHOOTING_ID}>
        <summary>Cannot see or reach the other computer?</summary>
        <ol>
          <li>Open ServiceEx on both computers and turn Sharing on in both. Each one should then show the other as a chip in the toolbar.</li>
          <li>
            Put both on the same network. Guest and public Wi-Fi often use <strong>client isolation</strong>: devices on it can reach the internet but not each
            other. Use the main network, ask whoever runs the Wi-Fi to turn client isolation off for it, or connect both with a network cable.
          </li>
          <li>
            On Windows, allow ServiceEx through <strong>Windows Defender Firewall</strong>. Windows asks the first time Sharing is turned on: tick Private
            networks and choose Allow (this needs an administrator). If that was missed, open Windows Security, Firewall and network protection, Allow an app
            through firewall, choose Change settings, and tick ServiceEx for Private. The installer does not add this rule, because it installs without
            administrator rights.
            {status?.firewallCommand && (
              <>
                {' '}
                An administrator can also add it from a Command Prompt opened with Run as administrator:
                <code className="settings-path firewall-command">{status.firewallCommand}</code>
                <Button onClick={() => navigator.clipboard.writeText(status.firewallCommand ?? '').catch(console.error)}>
                  <Copy size={15} aria-hidden="true" /> Copy command
                </Button>
              </>
            )}
          </li>
          <li>
            On Windows, set the network to <strong>Private</strong>, not Public: Windows blocks other computers on Public networks whatever the firewall says.
            Open Settings, Network and internet, choose Wi-Fi or Ethernet and the network in use, and under Network profile type choose Private network.
          </li>
          <li>
            If the other computer still does not appear as a chip, use Add by IP address above with the address shown in its Settings, Sharing. Some networks
            block the messages computers use to find each other but still let them connect.
          </li>
          <li>On a Mac, if the firewall is on, allow incoming connections for ServiceEx in System Settings, Network, Firewall, Options.</li>
          <li>Use Test connection, then Test sync, above. Both should answer within a second or two.</li>
        </ol>
        <p className="hint">
          To move a service without the network, use Export package in the schedule and Import package in the Inbox, with a USB drive.
        </p>
      </details>
    </Section>
  )
}

const BANDWIDTH: { value: number; label: string }[] = [
  { value: 0, label: 'No limit' },
  { value: 1024, label: '1 MB/s' },
  { value: 5120, label: '5 MB/s' },
  { value: 10240, label: '10 MB/s' },
  { value: 25600, label: '25 MB/s' },
]

/** Copies songs, themes, fonts, media and presentations between paired computers. Off by default. */
function LibrarySyncSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const library = useSharingStore((s) => s.library)
  const [error, setError] = useState<ErrorLike | null>(null)

  if (!hasFeature('sharing.librarySync')) return null
  const run = (action: () => Promise<unknown>) => {
    setError(null)
    action().catch((err) => setError(reportError('Settings', err)))
  }
  const options = BANDWIDTH.some((b) => b.value === settings.sharingBandwidthKbps)
    ? BANDWIDTH
    : [...BANDWIDTH, { value: settings.sharingBandwidthKbps, label: `${settings.sharingBandwidthKbps} KB/s` }]
  const files = library?.files ?? []
  return (
    <Section icon={<Library size={16} aria-hidden="true" />} title="Library sync">
      <Toggle checked={settings.sharingLibrarySync} onChange={(e) => run(() => updateSettings({ sharingLibrarySync: e.target.checked }))}>
        Keep songs, themes, fonts, media and presentations in step with paired computers
      </Toggle>
      <p className="hint">
        Fetches what the other computers have and this one does not, in the background. The same content is never copied twice, whatever it is called.
        Nothing here is replaced or deleted, and nothing goes live. Large files wait while a slide is live.
      </p>
      <label className="field">
        <span>Bandwidth limit</span>
        <Select value={settings.sharingBandwidthKbps} onChange={(e) => run(() => updateSettings({ sharingBandwidthKbps: Number(e.target.value) }))}>
          {options.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="settings-row">
        <Button
          disabled={!settings.sharingEnabled || !settings.sharingLibrarySync || library?.running}
          onClick={() => run(async () => useSharingStore.setState({ library: await window.api.sharing.syncLibraryNow() }))}
        >
          <RefreshCw size={15} aria-hidden="true" /> {library?.running ? 'Syncing…' : 'Sync now'}
        </Button>
        <span className="hint">
          {library?.paused ?? (library?.lastRunAt ? `Last synced ${new Date(library.lastRunAt).toLocaleString()}` : 'Not synced yet')}
        </span>
      </div>
      <ErrorNote error={library?.error && describeError(library.error)} />
      <ErrorNote error={error} />
      {files.length > 0 && (
        <ul className="sync-files">
          {files.map((file) => (
            <li key={file.sha256} className={file.state}>
              <span className="sync-file-name" title={`${file.kind} from ${file.peerName}`}>
                {file.name}
              </span>
              <span className="hint">
                {file.state === 'transferring'
                  ? `${file.size > 0 ? Math.floor((file.received / file.size) * 100) : 0}% of ${formatBytes(file.size)}`
                  : file.state === 'done'
                    ? 'Done'
                    : file.state === 'failed'
                      ? (file.error ?? 'Failed')
                      : `Waiting · ${formatBytes(file.size)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** Plays a generated animated deck with PowerPoint on the output display, and lists each step with its time. */
function LivePowerPointSection() {
  const enabled = useOperatorStore((s) => s.settings.presentationLivePowerPoint)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<LivePowerPointTestResult | null>(null)
  const [error, setError] = useState<ErrorLike | null>(null)

  async function test() {
    setTesting(true)
    setResult(null)
    setError(null)
    try {
      setResult(await window.api.livePowerPoint.test())
    } catch (err) {
      setError(reportError('Settings', err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Section icon={<Play size={16} aria-hidden="true" />} title="Live PowerPoint diagnostics">
      <p className="hint">
        Plays a three slide sample deck with click animations and a fade transition in PowerPoint, over the output, and steps through it.
        The output shows the slide show for about ten seconds.{enabled ? '' : ' Play animations with PowerPoint is off; the test runs all the same.'}
      </p>
      <div className="settings-row">
        <Button disabled={testing} onClick={test}>
          <Play size={15} aria-hidden="true" /> {testing ? 'Testing…' : 'Test Live PowerPoint'}
        </Button>
        {result && (
          <span className={result.ok ? 'hint' : 'error'}>
            {result.ok ? 'Passed' : 'Failed'} in {(result.totalMs / 1000).toFixed(1)} s
          </span>
        )}
      </div>
      <ErrorNote error={error} />
      {result && (
        <>
          <p className="hint">Display: {result.display}</p>
          <p className="hint">Show window: {result.mode}</p>
          <ol className="powerpoint-test-steps">
            {result.steps.map((step, index) => (
              <li key={index} className={step.ok ? undefined : 'failed'}>
                <span>{step.label}</span>
                <span>{step.detail}</span>
                <span>{step.ms} ms</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Section>
  )
}

function QuotesSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [speaker, setSpeaker] = useState(settings.quoteSpeakerName)

  useEffect(() => setSpeaker(settings.quoteSpeakerName), [settings.quoteSpeakerName])

  return (
    <Section icon={<Quote size={16} aria-hidden="true" />} title="Sermon quotes">
      <label className="field">
        <span>
          Default speaker name <small>Shown under quote slides; empty for none. Each quote can change it.</small>
        </span>
        <Input
          value={speaker}
          maxLength={100}
          placeholder="Pastor's name"
          onChange={(e) => setSpeaker(e.target.value)}
          onBlur={() => speaker.trim() !== settings.quoteSpeakerName && updateSettings({ quoteSpeakerName: speaker.trim() })}
        />
      </label>
      <p className="hint">Select words in the live transcript and press Send as Slide to show them as a quote in the preview.</p>
      <Toggle title={settings.aiEnabled ? undefined : 'AI features are turned off above'}
          checked={settings.aiEnabled && settings.statementPicking}
          disabled={!settings.aiEnabled}
          onChange={(e) => updateSettings({ statementPicking: e.target.checked })}
      >
        Suggest quotable statements with AI
      </Toggle>
      <p className="hint">
        {settings.aiEnabled
          ? 'Every 30 seconds while listening, the new transcript text is sent to Claude Haiku, which picks up to two short lines that stand on their own. Only lines found word for word in the transcript appear, as cards above the slides. Nothing is saved unless you add it to the schedule.'
          : 'Turn on AI features above to use this.'}
      </p>
    </Section>
  )
}

/**
 * Lower thirds: the idle design every output shows while the main content is cleared, and the design quick lower
 * thirds use in place of the template.
 */
function LowerThirdsSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const designs = useOperatorStore((s) => s.designs)
  const [error, setError] = useState<ErrorLike | null>(null)
  const lowerThirds = designs.filter((d) => d.style.category === 'lowerThird')
  // A deleted design reads as none.
  const chosen = (id: number | null) => (id !== null && designs.some((d) => d.id === id) ? String(id) : '')
  const save = (patch: Partial<AppSettings>) => {
    setError(null)
    updateSettings(patch).catch((err) => setError(reportError('Lower thirds', err)))
  }

  return (
    <Section icon={<Layers size={16} aria-hidden="true" />} title="Lower thirds">
      <ErrorNote error={error} />
      <label className="field">
        <span>
          Idle design <small>Shown on every output whenever the main content is cleared, such as the church logo in a corner.</small>
        </span>
        <Select value={chosen(settings.idleDesignId)} onChange={(e) => save({ idleDesignId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">None</option>
          {designs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </label>
      <p className="hint">
        Make it in Designs with a transparent background. An element marked "Hide while a lower third is live" steps aside whenever one is up.
      </p>
      <label className="field">
        <span>
          Default design <small>What quick lower thirds use. None uses the template chosen in the Lower third panel.</small>
        </span>
        <Select value={chosen(settings.lowerThirdDesignId)} onChange={(e) => save({ lowerThirdDesignId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">None: use the template</option>
          {lowerThirds.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </label>
      <p className="hint">The design's text bound to Headline and Body takes the lower third's words.</p>
      <label className="field">
        <span>
          Send as lower third goes straight to <small>Where Enter in the Send as lower third box sends a quote from the transcript, the heard cards or the workspace.</small>
        </span>
        <Select value={settings.lowerThirdQuickTarget} onChange={(e) => save({ lowerThirdQuickTarget: e.target.value === 'live' ? 'live' : 'preview' })}>
          <option value="preview">Preview</option>
          <option value="live">Live</option>
        </Select>
      </label>
    </Section>
  )
}

/** The diagnostics report, for support: what went wrong since the window opened, with the technical details. */
function DiagnosticsSection() {
  const [count, setCount] = useState(() => recentProblems().length)
  // The count is read when the section is drawn and again on each copy; problems are rare enough not to poll.
  return (
    <Section icon={<Stethoscope size={16} aria-hidden="true" />} title="Diagnostics">
      <p className="hint">
        If something goes wrong, copy the diagnostics and send them to ServiceEx support. They list this version, the system, and the
        problems since this window opened with their technical details. Nothing is sent by itself.
      </p>
      <div className="settings-row" onClickCapture={() => setTimeout(() => setCount(recentProblems().length))}>
        <CopyDiagnosticsButton />
        <span className="hint">{count === 0 ? 'No problems recorded' : `${count} problem${count === 1 ? '' : 's'} recorded`}</span>
      </div>
    </Section>
  )
}

/** The nav's groups, by section title. A section not listed here goes under Service. */
const NAV_GROUPS: { label: string; titles: string[] }[] = [
  { label: 'Account', titles: ['Account', 'Appearance', 'Church profile'] },
  {
    label: 'Service',
    titles: [
      'Default themes',
      'Scripture',
      'Scripture display',
      'Live highlighting',
      'Scripture detection',
      'Sermon quotes',
      'AI and listening',
      'AI developer key',
      'Sermon listener',
      'Presentations',
      'Layouts',
      'Autosave and backups',
    ],
  },
  { label: 'Devices', titles: ['Output', 'Lower thirds', 'Sharing', 'Devices', 'Library sync', 'Live PowerPoint diagnostics'] },
  { label: 'Support', titles: ['Diagnostics'] },
]

const sectionTitle = (section: Element) => section.querySelector('h3')?.textContent?.trim() ?? ''

/** A nav name where it differs from the section's own title. */
const NAV_LABELS: Record<string, string> = { Account: 'Account and plan' }

/** The line under each page's title. */
const DESCRIPTIONS: Record<string, string> = {
  Account: 'Log in or create a free account, and see your plan, licence and cloud listening hours.',
  Appearance: 'Dark, light, or following this computer.',
  'Church profile': 'Your church name and logo, for the Logo screen and sermon exports.',
  'Default themes': 'The theme each kind of slide starts with.',
  Scripture: 'The Bible versions on this computer and the one references open in.',
  'Scripture display': 'How verses look on screen: size, references and two translations.',
  'Live highlighting': 'Marking words on the live verse while it is on screen.',
  'Scripture detection': 'How verses heard in the sermon are suggested.',
  'Sermon quotes': 'Quotable lines from the sermon, shown as quote slides.',
  'AI and listening': 'Choose how ServiceEx listens, and what the AI may help with.',
  'AI developer key': 'Keys for developer builds.',
  'Sermon listener': 'Choose what ServiceEx listens to, and how. Changes apply the next time you start listening, never during a service.',
  Presentations: 'How PowerPoint, PDF and image slides are imported and shown.',
  Layouts: 'Which panels this computer shows, saved under a name.',
  'Autosave and backups': 'Song editor drafts and automatic backups of your library.',
  Output: 'Where the projector output opens, and how slides change.',
  'Lower thirds': 'The idle design shown when the screen is cleared, and the design quick lower thirds use.',
  Sharing: 'Other computers on this network, and what they may send you.',
  Devices: 'Computers you have paired with, and what each may do.',
  'Library sync': 'Keeping songs and slides the same on paired computers.',
  'Live PowerPoint diagnostics': 'Checks for running presentations in PowerPoint itself.',
  Diagnostics: 'Logs and details to send when something goes wrong.',
}

/** The plan at the foot of the Settings nav, with Manage plan. */
function PlanCard() {
  const account = useAccount()
  const plan = account?.signedIn ? account.license.plan : 'Free'
  const hours = account?.signedIn && account.balance ? `Cloud listening: ${formatHours(account.balance.totalSeconds)} left` : account?.signedIn ? null : 'Not signed in'
  return (
    <div className="settings-plan-card">
      <span className="settings-plan-name">{plan} plan</span>
      {hours && <span className="settings-plan-detail">{hours}</span>}
      <Button variant="primary" size="sm" className="settings-plan-manage" onClick={() => openPlans(true)} disabled={account !== null && !account.configured}>
        Manage plan
      </Button>
    </div>
  )
}

/** The nav's groups as the page has them: a section a build leaves out is not listed. */
function navGroups(titles: string[]) {
  const listed = new Set(NAV_GROUPS.flatMap((g) => g.titles))
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    titles: titles.filter((t) => group.titles.includes(t) || (group.label === 'Service' && !listed.has(t))),
  })).filter((g) => g.titles.length > 0)
}

/** The Settings nav: one page per section, grouped under Account, Service, Devices and Support. */
function SettingsNav({ titles, current, onChoose }: { titles: string[]; current: string; onChoose(title: string): void }) {
  return (
    <nav className="settings-nav-groups" aria-label="Settings sections">
      {navGroups(titles).map((group) => (
        <div key={group.label} className="settings-nav-group">
          <span className="settings-nav-heading">{group.label}</span>
          {group.titles.map((title) => (
            <button key={title} type="button" className="settings-nav-item" aria-current={current === title ? 'page' : undefined} onClick={() => onChoose(title)}>
              {NAV_LABELS[title] ?? title}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

export function SettingsPanel() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const openSettings = useOperatorStore((s) => s.openSettings)
  const loadSettings = useOperatorStore((s) => s.loadSettings)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const contentRef = useRef<HTMLElement>(null)
  const [titles, setTitles] = useState<string[]>([])
  const [chosen, setChosen] = useState<string>(() => takeSettingsPage() ?? 'Account')
  const page = titles.includes(chosen) ? chosen : (navGroups(titles)[0]?.titles[0] ?? chosen)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<ErrorLike | null>(null)

  useEffect(() => {
    window.api.settings.listDisplays().then(setDisplays, console.error)
  }, [])

  // Another screen asking for a page while Settings is open (see openSettingsAt).
  useEffect(() => {
    const show = (e: Event) => setChosen(takeSettingsPage() ?? (e as CustomEvent<string>).detail)
    window.addEventListener(SETTINGS_PAGE_EVENT, show)
    return () => window.removeEventListener(SETTINGS_PAGE_EVENT, show)
  }, [])

  // The sections come from the page itself, so a section a build leaves out is not listed.
  useLayoutEffect(() => {
    const root = contentRef.current
    if (!root) return
    const read = () =>
      setTitles((current) => {
        const next = Array.from(root.querySelectorAll('.settings-section')).map(sectionTitle).filter(Boolean)
        return next.join('\n') === current.join('\n') ? current : next
      })
    read()
    const watcher = new MutationObserver(read)
    watcher.observe(root, { childList: true, subtree: true })
    return () => watcher.disconnect()
  }, [])

  // Every section stays mounted, so each keeps what is typed in it; only the chosen page's shows.
  useLayoutEffect(() => {
    const root = contentRef.current
    if (!root) return
    for (const section of root.querySelectorAll<HTMLElement>('.settings-section')) section.hidden = sectionTitle(section) !== page
    root.scrollTop = 0
  }, [page, titles])

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null)
    setMessage(null)
    try {
      await action()
      if (done) setMessage(done)
    } catch (err) {
      setError(reportError('Settings', err))
    }
  }

  const setOutputDisplay = (value: string) =>
    run(() => updateSettings({ outputDisplay: (value === 'auto' || value === 'window' ? value : Number(value)) as OutputDisplay }))

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <Button variant="ghost" className="settings-back" icon={<ChevronLeft size={18} aria-hidden="true" />} onClick={() => openSettings(false)}>
          Back to service
        </Button>
        <h2 className="visually-hidden">Settings</h2>
        <SettingsNav titles={titles} current={page} onChoose={setChosen} />
        <PlanCard />
      </aside>
      <section className="panel settings-panel" ref={contentRef} aria-labelledby="settings-page-heading">
        <div className="settings-column">
          <h1 id="settings-page-heading" className="settings-page-heading">
            {NAV_LABELS[page] ?? page}
          </h1>
          {DESCRIPTIONS[page] && <p className="settings-page-lead">{DESCRIPTIONS[page]}</p>}
          <ErrorNote error={error} />
          {message && <p className="hint">{message}</p>}

          <AccountSection />

          <Section icon={<SunMoon size={16} aria-hidden="true" />} title="Appearance">
            <SegmentedControl
              aria-label="Appearance"
              value={settings.appearance}
              options={APPEARANCES.map((a) => ({ value: a.value, label: a.label, icon: a.icon }))}
              onChange={(value) => run(() => updateSettings({ appearance: value }))}
            />
          </Section>

          <Section icon={<Monitor size={16} aria-hidden="true" />} title="Output">
            <label className="field">
              <span>Output display</span>
              <Select value={String(settings.outputDisplay)} onChange={(e) => setOutputDisplay(e.target.value)}>
                <option value="auto">Automatic (first display that is not the main one)</option>
                <option value="window">In a window</option>
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} · {d.width}×{d.height}
                    {d.primary ? ' (main display)' : ''}
                  </option>
                ))}
              </Select>
            </label>
            <p className="hint">Changing this reopens the output window on the chosen display, fullscreen.</p>
            <Toggle
                checked={settings.autoGoLiveOnNext}
                onChange={(e) => run(() => updateSettings({ autoGoLiveOnNext: e.target.checked }))}
            >
              Auto go live on schedule next
            </Toggle>
            <p className="hint">
              Off: {MOD}↓ puts the next schedule item in the preview, and Enter or Go Live sends it. On: it goes live straight away.
            </p>
            <label className="fade-control">
              <span>Crossfade</span>
              <input
                type="range"
                min={0}
                max={1500}
                step={100}
                value={settings.fadeMs}
                onChange={(e) => run(() => updateSettings({ fadeMs: Number(e.target.value) }))}
              />
              <span className="fade-value">{(settings.fadeMs / 1000).toFixed(1)} s</span>
            </label>
          </Section>

          <LowerThirdsSection />

          <Section icon={<Image size={16} aria-hidden="true" />} title="Church profile">
            <ChurchProfileFields />
            <span className="field-label">Church logo</span>
            <div className="settings-logo">
              <div className="settings-logo-preview">
                {settings.logoUrl ? <img src={settings.logoUrl} alt="Current logo" /> : <span className="hint">Placeholder logo</span>}
              </div>
              <div className="settings-row">
                <Button
                  onClick={() => run(async () => {
                    const saved = await window.api.settings.pickLogo()
                    if (saved) await loadSettings()
                  })}
                >
                  <Image size={15} aria-hidden="true" /> Choose image…
                </Button>
                {settings.logoUrl && (
                  <Button onClick={() => run(() => updateSettings({ logoUrl: null }))}>
                    <Trash2 size={15} aria-hidden="true" /> Use placeholder
                  </Button>
                )}
              </div>
            </div>
            <p className="hint">Shown when you press Logo (L), and at the top of sermon PDFs. A transparent PNG works best.</p>
          </Section>

          <Section icon={<Palette size={16} aria-hidden="true" />} title="Default themes">
            <ThemeDefaultsForm />
          </Section>

          <AiListeningSection />
          <AiDeveloperSection />

          <ListenerSection />

          <ScriptureSection />
          <Section icon={<Type size={16} aria-hidden="true" />} title="Scripture display">
            <ScriptureDisplayForm />
            <p className="hint">
              The Aa button on the Live and Preview boxes adjusts one verse: {MOD}+ and {MOD}− change its size, Alt+↑ and Alt+↓ move it.
            </p>
          </Section>
          <HighlightSection />
          <DetectionSection />
          <QuotesSection />

          <PresentationsSection />
          <LivePowerPointSection />

          <SharingSection />
          <DevicesSection />
          <LibrarySyncSection />
          <LayoutsSection />

          <Section icon={<Save size={16} aria-hidden="true" />} title="Autosave and backups">
            <Toggle
                checked={settings.autosaveDrafts}
                onChange={(e) => run(() => updateSettings({ autosaveDrafts: e.target.checked }))}
            >
              Autosave song editor drafts
            </Toggle>
            <div className="field">
              <span>Backup folder</span>
              <div className="settings-row">
                <span className="settings-path" title={settings.backupFolder ?? undefined}>
                  {settings.backupFolder ?? 'Not set'}
                </span>
                <Button
                  onClick={() => run(async () => {
                    if (await window.api.settings.pickBackupFolder()) await loadSettings()
                  })}
                >
                  <FolderOpen size={15} aria-hidden="true" /> Choose…
                </Button>
              </div>
            </div>
            <label className="field">
              <span>Automatic backups</span>
              <Select
                value={settings.backupIntervalMinutes}
                disabled={!settings.backupFolder}
                onChange={(e) => run(() => updateSettings({ backupIntervalMinutes: Number(e.target.value) as AppSettings['backupIntervalMinutes'] }))}
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </Select>
            </label>
            <div className="settings-row">
              <Button
                disabled={!settings.backupFolder}
                onClick={() => run(async () => {
                  const file = await window.api.settings.backupNow()
                  await loadSettings()
                  setMessage(`Backed up to ${file}`)
                })}
              >
                <HardDriveDownload size={15} aria-hidden="true" /> Back up now
              </Button>
              <span className="hint">
                {settings.lastBackupAt ? `Last backup ${new Date(settings.lastBackupAt).toLocaleString()}` : 'No backups yet'} · the
                newest 20 are kept
              </span>
            </div>
          </Section>

          <DiagnosticsSection />
        </div>
      </section>
    </div>
  )
}
