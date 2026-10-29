import { useEffect, useState, type FormEvent } from 'react'
import { reportError, type ErrorLike } from '../lib/errors'
import { ErrorNote } from './ui'

interface Props {
  onSave(name: string, date: string | null): Promise<void>
  onCancel(): void
}

/** Today as YYYY-MM-DD in local time, the format of <input type="date">. */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function NewServiceModal({ onSave, onCancel }: Props) {
  const [name, setName] = useState('Sunday Service')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ErrorLike | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave(name.trim(), date || null)
    } catch (err) {
      setError(reportError('New service', err))
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="New service"
      >
        <h2>New service</h2>

        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>

        <label className="field">
          <span>Date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <ErrorNote error={error} />

        <footer className="modal-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create service'}
          </button>
        </footer>
      </form>
    </div>
  )
}
