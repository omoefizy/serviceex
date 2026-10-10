import { BookOpen, Eye, ListPlus, Pencil, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSuggestions, type StatementSuggestion } from '../lib/scriptureDetection'
import { quotePayload } from '../lib/slides'
import { useOperatorStore } from '../store'
import { QuoteModal } from './QuoteModal'

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

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
  const [flashing, setFlashing] = useState(false)
  const [editing, setEditing] = useState<StatementSuggestion | null>(null)
  /** Statements saved to the schedule this session, so the button says so. */
  const [scheduled, setScheduled] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

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
            <li key={s.id} className={`suggestion${s.id === previewedId ? ' previewed' : ''}${s.kind === 'quote' ? ' quote' : ''}`}>
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
                  <strong>{s.label}</strong>
                  {s.kind === 'quote' && <span className="suggestion-tag">Possible quote</span>}
                  <span className="suggestion-time">{timeOf(s.heardAt)}</span>
                </span>
                <span className="suggestion-text">{s.text}</span>
              </button>
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
                <span title={service ? `Save it to ${service.name} as a quote, to use again` : 'Create or pick a service first'}>
                  <button type="button" className="button" disabled={!service || scheduled.has(s.id)} onClick={() => schedule(s)}>
                    <ListPlus size={13} aria-hidden="true" /> {scheduled.has(s.id) ? 'Added' : 'Add to Schedule'}
                  </button>
                </span>
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
