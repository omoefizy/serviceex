import { useEffect, useState, type FormEvent } from 'react'
import type { SongInput } from '../../shared/types'
import { splitIntoSlides } from '../lib/slides'

interface Props {
  onSave(input: SongInput): Promise<void>
  onCancel(): void
}

export function AddSongModal({ onSave, onCancel }: Props) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slideCount = splitIntoSlides(lyrics).length

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
      await onSave({ title: title.trim(), author: author.trim() || null, lyrics })
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
        aria-label="Add song"
      >
        <h2>Add song</h2>

        <label className="field">
          <span>Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>

        <label className="field">
          <span>Author</span>
          <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>

        <label className="field">
          <span>
            Lyrics <small>Leave a blank line between slides · {slideCount} slide{slideCount === 1 ? '' : 's'}</small>
          </span>
          <textarea className="input lyrics" value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={12} />
        </label>

        {error && <p className="error">{error}</p>}

        <footer className="modal-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Save song'}
          </button>
        </footer>
      </form>
    </div>
  )
}
