import { BookOpen, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSuggestions } from '../lib/scriptureDetection'

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/**
 * Verses heard in the live transcript, newest first. Clicking one puts it in the preview, never live; Enter or
 * Go Live then sends it. Each disappears after two minutes or when dismissed.
 */
export function SuggestionTray() {
  const { suggestions, previewedId, flashKey, preview, dismiss } = useSuggestions()
  const [flashing, setFlashing] = useState(false)

  useEffect(() => {
    if (flashKey === 0) return
    setFlashing(true)
    const timer = setTimeout(() => setFlashing(false), 1200)
    return () => clearTimeout(timer)
  }, [flashKey])

  if (suggestions.length === 0) return null

  return (
    <div className={`suggestion-tray${flashing ? ' flash' : ''}`} role="region" aria-label="Scripture heard in the sermon">
      <span className="suggestion-tray-title">
        <BookOpen size={14} aria-hidden="true" /> Heard
      </span>
      <ul className="suggestion-list">
        {suggestions.map((s) => (
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
        ))}
      </ul>
    </div>
  )
}
