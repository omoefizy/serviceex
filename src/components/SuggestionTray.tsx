import { BookOpen, Eye, ListPlus, Pencil, PanelBottom, Pin, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { pinStatement, useListener } from '../lib/listener'
import { useSuggestions, type ScriptureSuggestion, type StatementSuggestion } from '../lib/scriptureDetection'
import { canSendCues, openCueMenu, useSharingStore } from '../lib/sharing'
import { focusLowerThirdHeadline } from '../lib/shortcuts'
import { quotePayload } from '../lib/slides'
import { useOperatorStore } from '../store'
import { QuoteModal } from './QuoteModal'

/** A heard verse as a cue: its passage, word for word. */
const verseCue = (s: ScriptureSuggestion) => ({ kind: 'verse' as const, title: s.passage.title, text: s.passage.verses.map((v) => v.text).join('\n'), verses: s.passage.verses })

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/** "12 s ago", "3 min ago". */
function agoOf(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds} s ago` : `${Math.floor(seconds / 60)} min ago`
}

/**
 * Verses heard in the live transcript, and statements the AI picked from it, newest first. A suggestion goes to
 * the preview, never live; Enter or Go Live then sends it. Verses disappear after two minutes and statements after
 * three, or when dismissed.
 */
export function SuggestionTray() {
  const { suggestions, previewedId, flashKey, preview, dismiss, editStatement } = useSuggestions()
  const service = useOperatorStore((s) => s.service)
  const speaker = useOperatorStore((s) => s.settings.quoteSpeakerName)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const setLowerThirdDraft = useOperatorStore((s) => s.setLowerThirdDraft)
  const [flashing, setFlashing] = useState(false)
  const [editing, setEditing] = useState<StatementSuggestion | null>(null)
  /** Statements saved to the schedule this session, so the button says so. */
  const [scheduled, setScheduled] = useState<Set<number>>(new Set())
  /** Statements pinned to the sermon being recorded, so the button says so. */
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const recording = useListener((st) => st.sermon)
  const [error, setError] = useState<string | null>(null)
  // Re-renders when sharing turns on or off, for Send to device.
  useSharingStore((st) => st.status?.enabled)
  const sendable = canSendCues()
  /** Ticks each second while there are cards, for "seconds ago". */
  const [now, setNow] = useState(() => Date.now())
  const showing = suggestions.length > 0

  useEffect(() => {
    if (!showing) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [showing])

  useEffect(() => {
    if (flashKey === 0) return
    setFlashing(true)
    const timer = setTimeout(() => setFlashing(false), 1200)
    return () => clearTimeout(timer)
  }, [flashKey])

  async function schedule(s: StatementSuggestion) {
    setError(null)
    try {
      await addToSchedule('announcement', null, quotePayload(s.text, speaker))
      setScheduled((current) => new Set(current).add(s.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (suggestions.length === 0) return null

  return (
    <div className={`suggestion-tray${flashing ? ' flash' : ''}`} role="region" aria-label="Scripture and statements heard in the sermon">
      <span className="suggestion-tray-title">
        <BookOpen size={14} aria-hidden="true" /> Heard
      </span>
      {error && <p className="error">{error}</p>}
      <ul className="suggestion-list">
        {suggestions.map((s) =>
          s.type === 'scripture' ? (
            <li key={s.id} className={`suggestion${s.id === previewedId ? ' previewed' : ''}${s.kind === 'reference' ? '' : ` ${s.kind}`}`}>
              <button
                type="button"
                className="suggestion-main"
                title={`Heard: "${s.heard}" · ${Math.round(s.confidence * 100)}% sure. Click to preview; Enter or Go Live sends it.`}
                onClick={(e) => {
                  preview(s.id)
                  // Hand the keyboard back to the page, so the next Enter sends the preview live.
                  e.currentTarget.blur()
                }}
              >
                <span className="suggestion-head">
                  <strong className="suggestion-label">{s.label}</strong>
                  {s.kind === 'quote' && <span className="suggestion-tag">Possible quote{s.version !== 'KJV' ? ` · ${s.version}` : ''}</span>}
                  {s.kind === 'ai' && <span className="suggestion-tag ai">AI suggested</span>}
                  <span className="suggestion-time" title={`Heard at ${timeOf(s.heardAt)}`}>
                    {agoOf(now - s.heardAt)}
                  </span>
                </span>
                <span className="suggestion-text">
                  {s.highlight
                    ? s.highlight.map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))
                    : s.text}
                </span>
              </button>
              {s.alternatives.length > 0 && (
                <div className="suggestion-alternatives" role="group" aria-label={`Other readings of ${s.label}`}>
                  <span>or</span>
                  {s.alternatives.map((alt, i) => (
                    <button
                      key={alt.label}
                      type="button"
                      className="suggestion-chip"
                      title={`${alt.label}, ${Math.round(alt.confidence * 100)}% sure: ${alt.passage.verses[0]?.text ?? ''} Click to preview.`}
                      onClick={(e) => {
                        preview(s.id, i)
                        e.currentTarget.blur()
                      }}
                    >
                      {alt.label}
                    </button>
                  ))}
                </div>
              )}
              {sendable && (
                <button
                  type="button"
                  className="suggestion-send"
                  aria-label={`Send ${s.label} to another computer`}
                  title="Send to device: a cue in that computer's tray. It does not go live there."
                  onClick={(e) => openCueMenu(e, verseCue(s))}
                >
                  <Send size={12} aria-hidden="true" />
                </button>
              )}
              <button type="button" className="suggestion-dismiss" aria-label={`Dismiss ${s.label}`} title="Dismiss" onClick={() => dismiss(s.id)}>
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ) : (
            <li key={s.id} className={`suggestion statement${s.id === previewedId ? ' previewed' : ''}`}>
              <div className="suggestion-main" title={`Said at ${timeOf(s.heardAt)}, picked by AI from the transcript word for word.`}>
                <span className="suggestion-head">
                  <strong>Statement</strong>
                  <span className="suggestion-time">{timeOf(s.heardAt)}</span>
                </span>
                <span className="suggestion-text">“{s.text}”</span>
              </div>
              <div className="suggestion-actions">
                <button
                  type="button"
                  className="button"
                  title="Show it as a quote slide in the preview; Enter or Go Live sends it"
                  onClick={(e) => {
                    preview(s.id)
                    e.currentTarget.blur()
                  }}
                >
                  <Eye size={13} aria-hidden="true" /> Preview
                </button>
                <button type="button" className="button" title="Fix spelling or trim words first" onClick={() => setEditing(s)}>
                  <Pencil size={13} aria-hidden="true" /> Edit
                </button>
                <button
                  type="button"
                  className="button"
                  title="Put it in the Lower Third fields; press Enter there to show it"
                  onClick={() => {
                    // Fills the fields only: it goes live when the operator presses Enter.
                    setLowerThirdDraft({ headline: s.text, body: speaker })
                    focusLowerThirdHeadline()
                  }}
                >
                  <PanelBottom size={13} aria-hidden="true" /> Send to Lower Third
                </button>
                <span title={service ? `Save it to ${service.name} as a quote, to use again` : 'Create or pick a service first'}>
                  <button type="button" className="button" disabled={!service || scheduled.has(s.id)} onClick={() => schedule(s)}>
                    <ListPlus size={13} aria-hidden="true" /> {scheduled.has(s.id) ? 'Added' : 'Add to Schedule'}
                  </button>
                </span>
                {recording && (
                  <button
                    type="button"
                    className="button"
                    disabled={pinned.has(s.id)}
                    title={`Pin it to the sermon “${recording.title}”, for its slides and exports`}
                    onClick={() => {
                      pinStatement(s.text)
                      setPinned((ids) => new Set(ids).add(s.id))
                    }}
                  >
                    <Pin size={13} aria-hidden="true" /> {pinned.has(s.id) ? 'Pinned' : 'Pin to Sermon'}
                  </button>
                )}
                {sendable && (
                  <button
                    type="button"
                    className="button"
                    title="Send to device: the exact words as a cue in that computer's tray. It does not go live there."
                    onClick={(e) => openCueMenu(e, { kind: 'text', title: 'Statement', text: s.text })}
                  >
                    <Send size={13} aria-hidden="true" /> Send to device
                  </button>
                )}
              </div>
              <button type="button" className="suggestion-dismiss" aria-label="Dismiss statement" title="Dismiss" onClick={() => dismiss(s.id)}>
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ),
        )}
      </ul>
      {editing && (
        <QuoteModal
          text={editing.text}
          onCancel={() => setEditing(null)}
          onDone={(text, sentTo) => {
            editStatement(editing.id, text)
            if (sentTo === 'preview') useSuggestions.setState({ previewedId: editing.id })
            else setScheduled((current) => new Set(current).add(editing.id))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
