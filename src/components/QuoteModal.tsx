import { Eye, ListPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { quotePayload, quoteSlide } from '../lib/slides'
import { useOperatorStore } from '../store'

interface Props {
  /** The words to start from: a selection in the transcript, or a statement card. */
  text: string
  /** Called with the edited words once they went to the preview or the schedule. */
  onDone(text: string, sentTo: 'preview' | 'schedule'): void
  onCancel(): void
}

/**
 * Edits a sermon statement (fix spelling, trim words) and the speaker line before it becomes a quote slide. It goes
 * to the preview only; Enter or Go Live sends it live from there. Add to Schedule saves it as a quote item.
 */
export function QuoteModal({ text: initial, onDone, onCancel }: Props) {
  const defaultSpeaker = useOperatorStore((s) => s.settings.quoteSpeakerName)
  const service = useOperatorStore((s) => s.service)
  const selectQuote = useOperatorStore((s) => s.selectQuote)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const [text, setText] = useState(initial.trim())
  const [speaker, setSpeaker] = useState(defaultSpeaker)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const slide = quoteSlide(text, speaker)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function handlePreview(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    selectQuote(text, speaker)
    onDone(text.trim(), 'preview')
  }

  async function handleSchedule() {
    setSaving(true)
    setError(null)
    try {
      await addToSchedule('announcement', null, quotePayload(text, speaker))
      onDone(text.trim(), 'schedule')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form className="modal quote-modal" onSubmit={handlePreview} onMouseDown={(e) => e.stopPropagation()} aria-label="Send as slide">
        <h2>Send as slide</h2>
        <label className="field">
          <span>
            Words{' '}
            <small>
              {words} word{words === 1 ? '' : 's'} · fix spelling or trim, keeping what was said
            </small>
          </span>
          <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>
            Speaker <small>The line under the quote; empty for none. The default is set in Settings.</small>
          </span>
          <input className="input" value={speaker} maxLength={100} onChange={(e) => setSpeaker(e.target.value)} />
        </label>
        <div className="quote-sample" aria-label="How the slide reads">
          <p>{text.trim() ? slide.text : '“…”'}</p>
          {slide.caption && <small>{slide.caption}</small>}
        </div>
        {error && <p className="error">{error}</p>}
        <footer className="modal-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          {/* Disabled buttons show no tooltip, so the reason sits on a wrapper. */}
          <span title={service ? `Save it to ${service.name} as a quote, to use again` : 'Create or pick a service first'}>
            <button type="button" className="button" disabled={!service || saving || !text.trim()} onClick={handleSchedule}>
              <ListPlus size={15} aria-hidden="true" /> {saving ? 'Adding…' : 'Add to Schedule'}
            </button>
          </span>
          <button type="submit" className="button primary" disabled={!text.trim()} title="Show it in the preview; it goes live only when you send it">
            <Eye size={15} aria-hidden="true" /> Send to Preview
          </button>
        </footer>
      </form>
    </div>
  )
}
