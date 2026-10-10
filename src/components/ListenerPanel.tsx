import { Eraser, Mic, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useListener, type ListenerStatus } from '../lib/listener'
import { meterFraction } from '../lib/mic'
import { useOperatorStore } from '../store'

const STATUS_LABELS: Record<ListenerStatus, string> = {
  idle: 'Not listening',
  starting: 'Opening microphone',
  connecting: 'Connecting',
  listening: 'Listening',
  stopping: 'Stopping',
  error: 'Stopped with an error',
}

/** Start and stop the sermon listener, and watch the live transcript: settled text in white, words still forming in grey. */
export function ListenerPanel() {
  const { status, error, finals, partial, level, start, stop, clear } = useListener()
  const openSettings = useOperatorStore((s) => s.openSettings)
  const saving = useOperatorStore((s) => s.settings.saveTranscripts)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  /** Follow new text only while the operator has not scrolled up to read. */
  const following = useRef(true)

  useEffect(() => {
    window.api.speech.status().then((s) => setHasKey(s.hasKey), console.error)
  }, [status])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && following.current) el.scrollTop = el.scrollHeight
  }, [finals, partial])

  const running = status === 'starting' || status === 'connecting' || status === 'listening'

  return (
    <section className="panel listener-panel" aria-label="Sermon listener">
      <header className="panel-header">
        <h2>Listener</h2>
        <span className={`listener-status ${status}`} role="status">
          <span className="listener-dot" aria-hidden="true" />
          {STATUS_LABELS[status]}
        </span>
      </header>

      <div className="settings-row">
        {running ? (
          <button type="button" className="button" onClick={() => stop().catch(console.error)}>
            <Square size={14} aria-hidden="true" /> Stop
          </button>
        ) : (
          <button type="button" className="button primary" disabled={status === 'stopping' || hasKey === false} onClick={() => start()}>
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
      {hasKey === false && (
        <p className="hint">
          Add a Deepgram API key in{' '}
          <button type="button" className="link-button" onClick={() => openSettings(true)}>
            Settings
          </button>{' '}
          to transcribe the sermon.
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
    </section>
  )
}
