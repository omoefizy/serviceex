import { useEffect, useState, type FormEvent } from 'react'
import type { AnnouncementPayload } from '../../shared/types'
import { announcementSlides } from '../lib/slides'

interface Props {
  onSave(payload: AnnouncementPayload): Promise<void>
  onCancel(): void
}

export function AnnouncementModal({ onSave, onCancel }: Props) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slideCount = title.trim() ? announcementSlides({ title, body }).length : 0

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ title: title.trim(), body })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Add announcement"
      >
        <h2>Add announcement</h2>

        <label className="field">
          <span>
            Title <small>Shown under each slide</small>
          </span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>

        <label className="field">
          <span>
            Body <small>Leave a blank line between slides · {slideCount} slide{slideCount === 1 ? '' : 's'}</small>
          </span>
          <textarea className="input lyrics" value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
        </label>

        {error && <p className="error">{error}</p>}

        <footer className="modal-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving || !title.trim()}>
            {saving ? 'Adding…' : 'Add to schedule'}
          </button>
        </footer>
      </form>
    </div>
  )
}
