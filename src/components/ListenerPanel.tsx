import { Eraser, Mic, Quote, Square, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SpeechEngineId, SpeechMode } from '../../shared/types'
import { useListener, type ListenerStatus } from '../lib/listener'
import type { MicDevice, MicState, SignalAdvice } from '../lib/mic'
import { useDetectionDebug } from '../lib/scriptureDetection'
import { useOperatorStore } from '../store'
import { LevelMeter } from './LevelMeter'
import { QuoteModal } from './QuoteModal'

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

const INPUT_STATES: Record<Exclude<MicState, 'open'>, { label: string; why: string }> = {
  muted: { label: 'Muted', why: 'The system muted the input; silence is sent in its place until it is back.' },
  reopening: { label: 'Reconnecting', why: 'Opening the input again; silence is sent meanwhile.' },
  waiting: { label: 'Unplugged', why: 'The chosen input is not connected. Silence is sent until it is plugged back in, then it is used again.' },
}

/** The input's health: its connection first, then the most serious problem with the signal. */
function inputHealth(state: MicState | null, advice: SignalAdvice[]): { label: string; tone: string; why: string } {
  if (state && state !== 'open') return { ...INPUT_STATES[state], tone: state === 'waiting' ? 'error' : 'warning' }
  const worst = advice.find((a) => a.level !== 'info')
  if (worst) return { label: worst.level === 'error' ? 'Problem' : 'Check', tone: worst.level, why: worst.text }
  return { label: 'Good', tone: 'ok', why: advice[0]?.text ?? 'The signal looks healthy.' }
}

const inputSummary = (input: MicDevice, channel: string) =>
  `${input.label} · ${channel} · ${input.sampleRate >= 1000 ? `${input.sampleRate / 1000} kHz` : `${input.sampleRate} Hz`}`

/** What scripture detection did with the last stretch of transcript, and how fast the last card came. */
function DetectionDebugView() {
  const { run, card } = useDetectionDebug()
  return (
    <div className="detection-debug" aria-label="Scripture detection debug">
      <p>
        <strong>Segment</strong> {run ? `(${run.source}, ${clockTime(run.at)})` : ''}: {run ? <q>{run.segment}</q> : 'nothing heard yet'}
      </p>
      {run && (
        <ol>
          {run.stages.map((stage, i) => (
            <li key={i}>
              <code>{stage.name}</code> {stage.ms} ms · {stage.result}
            </li>
          ))}
        </ol>
      )}
      <p>
        <strong>Last card</strong>:{' '}
        {card ? `${card.label}, from the ${card.stage}, ${card.latencyMs} ms after the words arrived (${clockTime(card.at)})` : 'none yet'}
      </p>
    </div>
  )
}

/** The active input's name and health, with what is wrong (if anything) as the tooltip and beneath. */
function InputLine({
  input,
  state,
  advice,
  channel,
  waitingFor,
}: {
  input: MicDevice | null
  state: MicState | null
  advice: SignalAdvice[]
  channel: string | number
  waitingFor: string | null
}) {
  const health = inputHealth(state, advice)
  const channelText = typeof channel === 'number' ? `channel ${channel}` : channel
  const name = state === 'waiting' ? (waitingFor ?? input?.label ?? 'The chosen input') : input ? inputSummary(input, channelText) : 'Opening the input'
  const shown = state && state !== 'open' ? [] : advice.filter((a) => a.level !== 'info')
  return (
    <div className="listener-input">
      <p>
        <span className="listener-input-name" title={name}>
          Input: {name}
        </span>
        <span className={`input-health ${health.tone}`} role="status" title={health.why} aria-label={`Input ${health.label}: ${health.why}`}>
          {health.label}
        </span>
      </p>
      {shown.length > 0 && (
        <ul className="mic-advice">
          {shown.map((item) => (
            <li key={item.text} className={item.level}>
              {item.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const clockTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Start and stop the sermon listener, and watch the live transcript: settled text in white, words still forming in grey. */
export function ListenerPanel() {
  const {
    status,
    error,
    finals,
    partial,
    performance,
    mode,
    modeReason,
    warning,
    restarting,
    notice,
    log,
    dropouts,
    input,
    inputState,
    reading,
    advice,
    start,
    stop,
    clear,
    dismissNotice,
  } = useListener()
  const micChannel = useOperatorStore((s) => s.settings.micChannel)
  const micDeviceName = useOperatorStore((s) => s.settings.micDeviceName)
  const openSettings = useOperatorStore((s) => s.openSettings)
  const saving = useOperatorStore((s) => s.settings.saveTranscripts)
  const speechEngine = useOperatorStore((s) => s.settings.speechEngine)
  const whisperModel = useOperatorStore((s) => s.settings.whisperModel)
  /** What is missing before listening can start, or null when ready. */
  const [notReady, setNotReady] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  /** Follow new text only while the operator has not scrolled up to read. */
  const following = useRef(true)
  /** Text selected in the transcript, and where its Send as Slide button sits (inside the scrolling transcript). */
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null)
  /** The words open in the quote editor. */
  const [quoting, setQuoting] = useState<string | null>(null)
  /** Shows what scripture detection is doing; off by default. */
  const [debugging, setDebugging] = useState(false)

  // Shows the floating button for a selection inside the transcript, and hides it when the selection goes.
  useEffect(() => {
    const onChange = () => {
      const el = scroller.current
      const picked = window.getSelection()
      const range = picked && !picked.isCollapsed && picked.rangeCount > 0 ? picked.getRangeAt(0) : null
      const text = picked?.toString().replace(/\s+/g, ' ').trim() ?? ''
      if (!el || !range || !text || !el.contains(range.commonAncestorContainer)) return setSelection(null)
      const box = range.getBoundingClientRect()
      const frame = el.getBoundingClientRect()
      const above = box.top - frame.top + el.scrollTop
      setSelection({
        text,
        // Above the selection, or below it when that would be off the top.
        top: above - 36 < el.scrollTop ? box.bottom - frame.top + el.scrollTop + 4 : above - 36,
        left: Math.min(Math.max(box.left - frame.left + box.width / 2, 70), el.clientWidth - 70),
      })
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])

  useEffect(() => {
    window.api.speech.status().then((s) => setNotReady(s.readyHint), console.error)
  }, [status, speechEngine, whisperModel])

  useLayoutEffect(() => {
    const el = scroller.current
    // Hold still while text is selected, so the selection does not scroll away.
    if (el && following.current && !selection) el.scrollTop = el.scrollHeight
  }, [finals, partial, selection])

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
        {running && <LevelMeter reading={reading} small />}
        {(running || dropouts > 0) && (
          <span
            className={`mic-dropouts${dropouts > 0 ? ' some' : ''}`}
            title="Times the system muted the microphone this session. Each gap is filled with silence, so listening carries on."
          >
            Mic dropouts: {dropouts}
          </span>
        )}
        {!running && finals.length > 0 && (
          <button type="button" className="icon-button" aria-label="Clear the transcript" title="Clear the transcript" onClick={clear}>
            <Eraser size={15} />
          </button>
        )}
      </div>
      {running && (input || inputState) && (
        <InputLine input={input} state={inputState} advice={advice} channel={micChannel} waitingFor={micDeviceName} />
      )}
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
        {selection && (
          <button
            type="button"
            className="button primary send-as-slide"
            style={{ top: selection.top, left: selection.left }}
            title="Edit the selected words, then show them as a quote slide in the preview"
            // Keep the selection while the button is pressed.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuoting(selection.text)
              window.getSelection()?.removeAllRanges()
            }}
          >
            <Quote size={13} aria-hidden="true" /> Send as Slide
          </button>
        )}
      </div>
      {quoting !== null && <QuoteModal text={quoting} onCancel={() => setQuoting(null)} onDone={() => setQuoting(null)} />}

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
      <label className="inline-check listener-debug-toggle">
        <input type="checkbox" checked={debugging} onChange={(e) => setDebugging(e.target.checked)} />
        Detection debug
      </label>
      {debugging && <DetectionDebugView />}
    </section>
  )
}
