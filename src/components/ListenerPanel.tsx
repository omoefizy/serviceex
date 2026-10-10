import { Eraser, Mic, Square, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SpeechEngineId, SpeechMode } from '../../shared/types'
import { useListener, type ListenerStatus } from '../lib/listener'
import { meterFraction } from '../lib/mic'
import { useOperatorStore } from '../store'

const MODE_LABELS: Record<SpeechMode, string> = { cloud: 'Cloud', offline: 'Offline', reconnecting: 'Reconnecting' }

interface Chip {
  label: string
  /** Which engine, beside Listening. */
  detail?: string
  tone: string
  why: string
}

/**
 * The status chip: Listening (Cloud or Offline), Reconnecting or Restarting while running; Stopped or Error otherwise;
 * with why as its tooltip.
 */
function chipOf(status: ListenerStatus, mode: SpeechMode | null, reason: string, error: string | null, restarting: string | null): Chip {
  if (restarting && (status === 'listening' || status === 'connecting')) return { label: 'Restarting', tone: 'busy', why: restarting }
  switch (status) {
    case 'listening':
      if (mode === 'reconnecting') return { label: 'Reconnecting', tone: 'reconnecting', why: reason }
      return mode
        ? { label: 'Listening', detail: MODE_LABELS[mode], tone: mode, why: reason }
        : { label: 'Listening', tone: 'cloud', why: 'Listening.' }
    case 'starting':
    case 'connecting':
      return { label: 'Starting', tone: 'busy', why: status === 'starting' ? 'Opening the microphone.' : 'Connecting to the speech engine.' }
    case 'stopping':
      return { label: 'Stopping', tone: 'busy', why: 'Finishing the last words before stopping.' }
    case 'error':
      return { label: 'Error', tone: 'error', why: error ?? 'The listener stopped with an error.' }
    default:
      return { label: 'Stopped', tone: 'stopped', why: 'Not listening. Press Start Listening to begin.' }
  }
}

const ENGINE_LABELS: Record<SpeechEngineId, string> = { auto: 'Auto', deepgram: 'Cloud only', whisper: 'Offline only' }

const clockTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Start and stop the sermon listener, and watch the live transcript: settled text in white, words still forming in grey. */
export function ListenerPanel() {
  const { status, error, finals, partial, level, performance, mode, modeReason, warning, restarting, notice, log, start, stop, clear, dismissNotice } =
    useListener()
  const openSettings = useOperatorStore((s) => s.openSettings)
  const saving = useOperatorStore((s) => s.settings.saveTranscripts)
  const speechEngine = useOperatorStore((s) => s.settings.speechEngine)
  const whisperModel = useOperatorStore((s) => s.settings.whisperModel)
  /** What is missing before listening can start, or null when ready. */
  const [notReady, setNotReady] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  /** Follow new text only while the operator has not scrolled up to read. */
  const following = useRef(true)

  useEffect(() => {
    window.api.speech.status().then((s) => setNotReady(s.readyHint), console.error)
  }, [status, speechEngine, whisperModel])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && following.current) el.scrollTop = el.scrollHeight
  }, [finals, partial])

  const running = status === 'starting' || status === 'connecting' || status === 'listening'
  const chip = chipOf(status, mode, modeReason, error, restarting)

  return (
    <section className="panel listener-panel" aria-label="Sermon listener">
      <header className="panel-header">
        <h2>Listener</h2>
        <span className="listener-engine">
          {ENGINE_LABELS[speechEngine]}
          {speechEngine !== 'deepgram' && ` · ${whisperModel}`}
        </span>
        <span className={`listener-status ${chip.tone}`} role="status" title={chip.why} aria-label={`${chip.label}: ${chip.why}`}>
          <span className="listener-dot" aria-hidden="true" />
          {chip.label}
          {chip.detail && <span className="listener-status-detail">· {chip.detail}</span>}
        </span>
      </header>

      <div className="settings-row">
        {running ? (
          <button type="button" className="button" onClick={() => stop().catch(console.error)}>
            <Square size={14} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button type="button" className="button primary" disabled={status === 'stopping' || notReady !== null} onClick={() => start()}>
            <Mic size={15} aria-hidden="true" /> Start Listening
          </button>
        )}
        {running && (
          <span className="level-meter small" aria-hidden="true">
            <span style={{ width: `${(1 - meterFraction(level)) * 100}%` }} />
          </span>
        )}
        {!running && finals.length > 0 && (
          <button type="button" className="icon-button" aria-label="Clear the transcript" title="Clear the transcript" onClick={clear}>
            <Eraser size={15} />
          </button>
        )}
      </div>
      {notReady && !running && (
        <p className="hint">
          {notReady}{' '}
          <button type="button" className="link-button" onClick={() => openSettings(true)}>
            Open Settings
          </button>
        </p>
      )}
      {performance && (
        <p className={`speed-chip ${performance.keepingUp ? 'ok' : 'behind'}`} role="status">
          {performance.keepingUp ? 'Keeping up' : 'Falling behind'} · {performance.realTimeFactor.toFixed(2)}× real time
          {performance.backlogSeconds > 0 && ` · ${performance.backlogSeconds} s waiting`}
          {performance.suggestion && ` · try ${performance.suggestion} in Settings`}
        </p>
      )}
      {warning && running && (
        <p className="listener-warning" role="alert">
          {warning}
        </p>
      )}
      {notice && (
        <p className="listener-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" title="Dismiss" onClick={dismissNotice}>
            <X size={14} />
          </button>
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div
        className="transcript"
        ref={scroller}
        aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {finals.length === 0 && !partial ? (
          <p className="transcript-empty">
            The live transcript appears here. {saving ? 'It is also saved to a file (see Settings).' : 'It is kept in memory only.'}
          </p>
        ) : (
          <p>
            {finals.map((line, i) => (
              <span key={i} className="transcript-final">
                {line}{' '}
              </span>
            ))}
            {partial && <span className="transcript-partial">{partial}</span>}
          </p>
        )}
      </div>

      <details className="listener-log">
        <summary>Event log ({log.length})</summary>
        {log.length === 0 ? (
          <p className="hint">Nothing yet. Connections, restarts and microphone problems appear here (kept in memory only).</p>
        ) : (
          <ol>
            {log.map((entry, i) => (
              <li key={i}>
                <time>{clockTime(entry.at)}</time> {entry.text}
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  )
}
