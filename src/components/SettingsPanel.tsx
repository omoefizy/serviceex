import {
  BookOpen,
  Cloud,
  Download,
  FolderOpen,
  HardDrive,
  HardDriveDownload,
  Image,
  KeyRound,
  Mic,
  MicOff,
  Monitor,
  Moon,
  Palette,
  PlugZap,
  Presentation,
  Quote,
  RefreshCw,
  Save,
  Sparkles,
  Sun,
  SunMoon,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type {
  AiModel,
  AiStatus,
  AppSettings,
  DisplayInfo,
  OutputDisplay,
  PresentationEngineId,
  PresentationEngineSetting,
  PresentationEngineStatus,
  SpeechEngineId,
  SpeechKeyStatus,
  WhisperModelId,
  WhisperStatus,
} from '../../shared/types'
import { useOperatorStore } from '../store'
import { listMicrophones, meterFraction, startMic, type MicCapture } from '../lib/mic'
import { MOD } from '../lib/shortcuts'
import { ThemeDefaultsForm } from './ThemeEditor'

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>
        {icon}
        {title}
      </h3>
      {children}
    </section>
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

const AI_MODELS: { value: AiModel; label: string }[] = [
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recommended)' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (faster and cheaper)' },
]

/** API key, model and an off switch. The key is typed here once and goes to the main process; it is never shown again. */
function AiSection() {
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

  return (
    <Section icon={<Sparkles size={16} aria-hidden="true" />} title="AI">
      <label className="inline-check">
        <input type="checkbox" checked={settings.aiEnabled} onChange={(e) => updateSettings({ aiEnabled: e.target.checked })} />
        Use AI features
      </label>
      <p className="hint">When this is off, WorshipDeck sends nothing to Anthropic.</p>

      {status && !status.encryptionAvailable && (
        <p className="error">This system cannot encrypt the key (no keychain or keyring), so it cannot be saved.</p>
      )}

      <form className="field" onSubmit={handleSave}>
        <label htmlFor="ai-key">Anthropic API key</label>
        <div className="settings-row">
          <input
            id="ai-key"
            className="input settings-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={status?.hasKey ? 'A key is saved. Enter a new one to replace it.' : 'sk-ant-…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" className="button" disabled={!key.trim() || busy || status?.encryptionAvailable === false}>
            <KeyRound size={15} aria-hidden="true" /> Save key
          </button>
          {status?.hasKey && (
            <button type="button" className="button" onClick={handleRemove}>
              <Trash2 size={15} aria-hidden="true" /> Remove
            </button>
          )}
        </div>
        <span className="hint">Encrypted by your operating system and stored on this computer only. It is never shown again.</span>
      </form>

      <label className="field">
        <span>Model</span>
        <select className="input" value={settings.aiModel} onChange={(e) => updateSettings({ aiModel: e.target.value as AiModel })}>
          {AI_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-row">
        <button className="button" onClick={handleTest} disabled={busy || !status?.hasKey || !settings.aiEnabled}>
          <PlugZap size={15} aria-hidden="true" /> Test connection
        </button>
        {result && (
          <span className={result.ok ? 'hint' : 'error'} role="status">
            {result.text}
          </span>
        )}
      </div>
    </Section>
  )
}

const SPEECH_ENGINES: { value: SpeechEngineId; label: string; icon: ReactNode; hint: string }[] = [
  {
    value: 'auto',
    label: 'Auto',
    icon: <RefreshCw size={15} aria-hidden="true" />,
    hint:
      'Uses Deepgram in the cloud, and switches to whisper.cpp on this computer if the connection drops, without losing words. ' +
      'It goes back to the cloud once the connection has been stable for 20 seconds. Set up both below.',
  },
  {
    value: 'deepgram',
    label: 'Cloud only',
    icon: <Cloud size={15} aria-hidden="true" />,
    hint: 'Deepgram transcribes in the cloud: very accurate, needs the internet and an API key.',
  },
  {
    value: 'whisper',
    label: 'Offline only',
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
                  <button type="button" className="button" onClick={() => window.api.speech.whisper.cancelDownload(model.id)}>
                    <X size={15} aria-hidden="true" /> Cancel
                  </button>
                </div>
              )}
              {!downloading && (
                <div className="settings-row">
                  {model.downloaded ? (
                    <button type="button" className="button" onClick={() => remove(model.id)}>
                      <Trash2 size={15} aria-hidden="true" /> Delete
                    </button>
                  ) : (
                    <button type="button" className="button" onClick={() => download(model.id).catch(console.error)}>
                      <Download size={15} aria-hidden="true" /> Download
                    </button>
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

/**
 * Microphone, Deepgram key and transcript saving for the sermon listener. The key is typed here once and goes to the
 * main process; it is never shown again.
 */
function ListenerSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const [status, setStatus] = useState<SpeechKeyStatus | null>(null)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [micError, setMicError] = useState<string | null>(null)
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

  // The level meter runs on the chosen microphone while testing, and restarts when the choice changes.
  useEffect(() => {
    if (!testing) return
    let capture: MicCapture | null = null
    let cancelled = false
    setMicError(null)
    startMic({ deviceId: settings.micDeviceId, processing: settings.micProcessing, onLevel: setLevel }).then(
      (started) => {
        if (cancelled) return started.stop()
        capture = started
        // Names are only listed once the microphone is allowed.
        listMicrophones().then(setMics, console.error)
      },
      (error: unknown) => {
        if (cancelled) return
        setMicError(error instanceof Error ? error.message : String(error))
        setTesting(false)
      },
    )
    return () => {
      cancelled = true
      capture?.stop()
      setLevel(0)
    }
  }, [testing, settings.micDeviceId, settings.micProcessing])

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

  const chosenMissing = settings.micDeviceId !== null && mics.length > 0 && !mics.some((m) => m.deviceId === settings.micDeviceId)

  return (
    <Section icon={<Mic size={16} aria-hidden="true" />} title="Sermon listener">
      <label className="field">
        <span>Microphone</span>
        <select
          className="input"
          value={settings.micDeviceId ?? ''}
          onChange={(e) => updateSettings({ micDeviceId: e.target.value || null })}
        >
          <option value="">System default</option>
          {mics.map((m, i) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Microphone ${i + 1}`}
            </option>
          ))}
          {chosenMissing && <option value={settings.micDeviceId ?? ''}>Not connected</option>}
        </select>
      </label>
      <div className="settings-row">
        <button type="button" className="button" onClick={() => setTesting(!testing)}>
          {testing ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
          {testing ? 'Stop test' : 'Test microphone'}
        </button>
        <span className="level-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meterFraction(level) * 100)}>
          <span style={{ width: `${(1 - meterFraction(level)) * 100}%` }} />
        </span>
      </div>
      {micError && <p className="error">{micError}</p>}
      <label className="inline-check">
        <input type="checkbox" checked={settings.micProcessing} onChange={(e) => updateSettings({ micProcessing: e.target.checked })} />
        Processing for room microphones
      </label>
      <p className="hint">
        Echo cancellation, noise suppression and automatic gain. Off sends the plain signal, which suits a feed from the sound desk or
        a lectern microphone; turn it on for a laptop or room microphone. Applies the next time listening starts.
      </p>

      <div className="field">
        <span>Speech engine</span>
        <div className="segmented" role="radiogroup" aria-label="Speech engine">
          {SPEECH_ENGINES.map((engine) => (
            <button
              key={engine.value}
              type="button"
              role="radio"
              aria-checked={settings.speechEngine === engine.value}
              className={settings.speechEngine === engine.value ? 'active' : ''}
              onClick={() => updateSettings({ speechEngine: engine.value })}
            >
              {engine.icon}
              {engine.label}
            </button>
          ))}
        </div>
        <span className="hint">
          {SPEECH_ENGINES.find((e) => e.value === settings.speechEngine)?.hint}
        </span>
      </div>

      {settings.speechEngine !== 'deepgram' && <WhisperModels />}

      {settings.speechEngine !== 'whisper' && status && !status.encryptionAvailable && (
        <p className="error">This system cannot encrypt the key (no keychain or keyring), so it cannot be saved.</p>
      )}
      {settings.speechEngine !== 'whisper' && (
        <>
          <form className="field" onSubmit={handleSave}>
            <label htmlFor="deepgram-key">Deepgram API key</label>
            <div className="settings-row">
              <input
                id="deepgram-key"
                className="input settings-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={status?.hasKey ? 'A key is saved. Enter a new one to replace it.' : 'Deepgram key'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button type="submit" className="button" disabled={!key.trim() || busy || status?.encryptionAvailable === false}>
                <KeyRound size={15} aria-hidden="true" /> Save key
              </button>
              {status?.hasKey && (
                <button type="button" className="button" onClick={handleRemove}>
                  <Trash2 size={15} aria-hidden="true" /> Remove
                </button>
              )}
            </div>
            <span className="hint">Encrypted by your operating system and stored on this computer only. It is never shown again.</span>
          </form>
          <div className="settings-row">
            <button type="button" className="button" onClick={handleTest} disabled={busy || !status?.hasKey}>
              <PlugZap size={15} aria-hidden="true" /> Test connection
            </button>
            {result && (
              <span className={result.ok ? 'hint' : 'error'} role="status">
                {result.text}
              </span>
            )}
          </div>
        </>
      )}

      <label className="inline-check">
        <input type="checkbox" checked={settings.saveTranscripts} onChange={(e) => updateSettings({ saveTranscripts: e.target.checked })} />
        Save transcripts
      </label>
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
function DetectionSection() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const percent = Math.round(settings.detectionMinConfidence * 100)
  return (
    <Section icon={<BookOpen size={16} aria-hidden="true" />} title="Scripture detection">
      <label className="inline-check">
        <input type="checkbox" checked={settings.scriptureDetection} onChange={(e) => updateSettings({ scriptureDetection: e.target.checked })} />
        Suggest verses heard in the sermon
      </label>
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
        <div className="segmented" role="radiogroup" aria-label="On a new suggestion">
          {DETECTION_ALERTS.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={settings.detectionAlert === a.value}
              className={settings.detectionAlert === a.value ? 'active' : ''}
              disabled={!settings.scriptureDetection}
              onClick={() => updateSettings({ detectionAlert: a.value })}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <label className="inline-check" title={settings.aiEnabled ? undefined : 'AI features are turned off above'}>
        <input
          type="checkbox"
          checked={settings.aiEnabled && settings.aiScriptureFallback}
          disabled={!settings.aiEnabled || !settings.scriptureDetection}
          onChange={(e) => updateSettings({ aiScriptureFallback: e.target.checked })}
        />
        Ask AI when nothing is found
      </label>
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
  const [error, setError] = useState<string | null>(null)

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
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Section icon={<Presentation size={16} aria-hidden="true" />} title="Presentations">
      <div className="field">
        <span>PowerPoint engine</span>
        <div className="segmented" role="radiogroup" aria-label="PowerPoint engine">
          {PRESENTATION_ENGINES.map((engine) => (
            <button
              key={engine.value}
              type="button"
              role="radio"
              aria-checked={settings.presentationEngine === engine.value}
              className={settings.presentationEngine === engine.value ? 'active' : ''}
              onClick={() => updateSettings({ presentationEngine: engine.value })}
            >
              {engine.label}
            </button>
          ))}
        </div>
        <span className="hint">Auto uses desktop PowerPoint when it is installed, otherwise LibreOffice. PDFs and images need neither.</span>
      </div>
      {status && (status.active ? <p className="hint">Active: {ENGINE_LABELS[status.active]}</p> : <p className="error">{status.message}</p>)}
      <div className="settings-row">
        <button type="button" className="button" disabled={testing || !status?.active} onClick={test}>
          <RefreshCw size={15} aria-hidden="true" /> {testing ? 'Converting…' : 'Test conversion'}
        </button>
        {result && <span className="hint">{result}</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {status?.active === 'powerpoint-mac' && (
        <p className="hint">
          The first conversion asks to let WorshipDeck control PowerPoint. If it was turned down, allow it in System Settings, Privacy and
          Security, Automation.
        </p>
      )}
      <label className="inline-check">
        <input
          type="checkbox"
          checked={settings.presentationAutoRefreshLive}
          onChange={(e) => updateSettings({ presentationAutoRefreshLive: e.target.checked })}
        />
        Auto refresh live
      </label>
      <p className="hint">
        When a presentation is saved again in PowerPoint, its slides here update. Off: if it is live, the output keeps the older slides
        until you press Resend. On: the output changes straight away.
      </p>
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
        <input
          className="input"
          value={speaker}
          maxLength={100}
          placeholder="Pastor's name"
          onChange={(e) => setSpeaker(e.target.value)}
          onBlur={() => speaker.trim() !== settings.quoteSpeakerName && updateSettings({ quoteSpeakerName: speaker.trim() })}
        />
      </label>
      <p className="hint">Select words in the live transcript and press Send as Slide to show them as a quote in the preview.</p>
      <label className="inline-check" title={settings.aiEnabled ? undefined : 'AI features are turned off above'}>
        <input
          type="checkbox"
          checked={settings.aiEnabled && settings.statementPicking}
          disabled={!settings.aiEnabled}
          onChange={(e) => updateSettings({ statementPicking: e.target.checked })}
        />
        Suggest quotable statements with AI
      </label>
      <p className="hint">
        {settings.aiEnabled
          ? 'Every 30 seconds while listening, the new transcript text is sent to Claude Haiku, which picks up to two short lines that stand on their own. Only lines found word for word in the transcript appear, as cards above the slides. Nothing is saved unless you add it to the schedule.'
          : 'Turn on AI features above to use this.'}
      </p>
    </Section>
  )
}

export function SettingsPanel() {
  const settings = useOperatorStore((s) => s.settings)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const openSettings = useOperatorStore((s) => s.openSettings)
  const loadSettings = useOperatorStore((s) => s.loadSettings)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.settings.listDisplays().then(setDisplays, console.error)
  }, [])

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null)
    setMessage(null)
    try {
      await action()
      if (done) setMessage(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const setOutputDisplay = (value: string) =>
    run(() => updateSettings({ outputDisplay: (value === 'auto' || value === 'window' ? value : Number(value)) as OutputDisplay }))

  return (
    <section className="panel settings-panel">
      <header className="panel-header">
        <h2>Settings</h2>
        <button className="icon-button" aria-label="Close settings" title="Close" onClick={() => openSettings(false)}>
          <X size={18} />
        </button>
      </header>

      {error && <p className="error">{error}</p>}
      {message && <p className="hint">{message}</p>}

      <Section icon={<SunMoon size={16} aria-hidden="true" />} title="Appearance">
        <div className="segmented" role="radiogroup" aria-label="Appearance">
          {APPEARANCES.map((a) => (
            <button
              key={a.value}
              role="radio"
              aria-checked={settings.appearance === a.value}
              className={settings.appearance === a.value ? 'active' : ''}
              onClick={() => run(() => updateSettings({ appearance: a.value }))}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </Section>

      <Section icon={<Monitor size={16} aria-hidden="true" />} title="Output">
        <label className="field">
          <span>Output display</span>
          <select className="input" value={String(settings.outputDisplay)} onChange={(e) => setOutputDisplay(e.target.value)}>
            <option value="auto">Automatic (first display that is not the main one)</option>
            <option value="window">In a window</option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} · {d.width}×{d.height}
                {d.primary ? ' (main display)' : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Changing this reopens the output window on the chosen display, fullscreen.</p>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={settings.autoGoLiveOnNext}
            onChange={(e) => run(() => updateSettings({ autoGoLiveOnNext: e.target.checked }))}
          />
          Auto go live on schedule next
        </label>
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

      <Section icon={<Image size={16} aria-hidden="true" />} title="Logo">
        <div className="settings-logo">
          <div className="settings-logo-preview">
            {settings.logoUrl ? <img src={settings.logoUrl} alt="Current logo" /> : <span className="hint">Placeholder logo</span>}
          </div>
          <div className="settings-row">
            <button
              className="button"
              onClick={() => run(async () => {
                const saved = await window.api.settings.pickLogo()
                if (saved) await loadSettings()
              })}
            >
              <Image size={15} aria-hidden="true" /> Choose image…
            </button>
            {settings.logoUrl && (
              <button className="button" onClick={() => run(() => updateSettings({ logoUrl: null }))}>
                <Trash2 size={15} aria-hidden="true" /> Use placeholder
              </button>
            )}
          </div>
        </div>
        <p className="hint">Shown when you press Logo (L). A transparent PNG works best.</p>
      </Section>

      <Section icon={<Palette size={16} aria-hidden="true" />} title="Default themes">
        <ThemeDefaultsForm />
      </Section>

      <AiSection />

      <ListenerSection />

      <DetectionSection />
      <QuotesSection />

      <PresentationsSection />

      <Section icon={<Save size={16} aria-hidden="true" />} title="Autosave and backups">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={settings.autosaveDrafts}
            onChange={(e) => run(() => updateSettings({ autosaveDrafts: e.target.checked }))}
          />
          Autosave song editor drafts
        </label>
        <div className="field">
          <span>Backup folder</span>
          <div className="settings-row">
            <span className="settings-path" title={settings.backupFolder ?? undefined}>
              {settings.backupFolder ?? 'Not set'}
            </span>
            <button
              className="button"
              onClick={() => run(async () => {
                if (await window.api.settings.pickBackupFolder()) await loadSettings()
              })}
            >
              <FolderOpen size={15} aria-hidden="true" /> Choose…
            </button>
          </div>
        </div>
        <label className="field">
          <span>Automatic backups</span>
          <select
            className="input"
            value={settings.backupIntervalMinutes}
            disabled={!settings.backupFolder}
            onChange={(e) => run(() => updateSettings({ backupIntervalMinutes: Number(e.target.value) as AppSettings['backupIntervalMinutes'] }))}
          >
            {INTERVALS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-row">
          <button
            className="button"
            disabled={!settings.backupFolder}
            onClick={() => run(async () => {
              const file = await window.api.settings.backupNow()
              await loadSettings()
              setMessage(`Backed up to ${file}`)
            })}
          >
            <HardDriveDownload size={15} aria-hidden="true" /> Back up now
          </button>
          <span className="hint">
            {settings.lastBackupAt ? `Last backup ${new Date(settings.lastBackupAt).toLocaleString()}` : 'No backups yet'} · the
            newest 20 are kept
          </span>
        </div>
      </Section>
    </section>
  )
}
