import { Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { BibleVersion } from '../../shared/types'

interface Props {
  versions: BibleVersion[]
  /** Called after a version is imported or removed, so the version list reloads. */
  onChanged(): void
  onClose(): void
}

/** Imports a Bible version the church owns from Zefania XML, OSIS XML or USFM files, and removes imported ones. */
export function BibleImportModal({ versions, onChanged, onClose }: Props) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const imported = versions.filter((v) => !v.bundled)
  const cleanCode = code.trim().toUpperCase()
  const replacing = imported.some((v) => v.code === cleanCode)
  const bundledCode = versions.some((v) => v.bundled && v.code === cleanCode)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, busy])

  async function run(action: () => Promise<string | null>) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const done = await action()
      if (done) {
        setMessage(done)
        onChanged()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      const result = await window.api.bible.importVersion(cleanCode, name.trim() || cleanCode)
      if (!result) return null
      setCode('')
      setName('')
      const skipped = result.skippedBooks.length > 0 ? ` Left out books it does not know: ${result.skippedBooks.join(', ')}.` : ''
      return `Imported ${result.verses.toLocaleString()} verses as ${result.code}.${skipped}`
    })
  }

  const remove = (version: BibleVersion) =>
    run(async () => ((await window.api.bible.removeVersion(version.code)) ? `Removed ${version.code}.` : null))

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <form className="modal bible-import-modal" onSubmit={handleSubmit} onMouseDown={(e) => e.stopPropagation()} aria-label="Import a Bible version">
        <h2>Import a Bible version</h2>

        <p className="notice">
          Only import versions your church holds a license to display. WorshipDeck does not check licensing; making sure
          you have permission is your responsibility.
        </p>

        <p className="hint">
          Zefania XML, OSIS XML or USFM. For USFM, choose every book file at once. Notes, cross references and headings
          are left out.
        </p>

        <div className="bible-import-fields">
          <label className="field">
            <span>Code</span>
            <input
              className="input"
              value={code}
              maxLength={12}
              placeholder="NIV"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
              autoFocus
              required
            />
          </label>
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} maxLength={100} placeholder="New International Version" onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        {bundledCode && <p className="error">{cleanCode} ships with WorshipDeck; choose another code.</p>}
        {replacing && !bundledCode && <p className="hint">This replaces the {cleanCode} you imported before.</p>}

        {imported.length > 0 && (
          <ul className="bible-import-list" aria-label="Imported versions">
            {imported.map((v) => (
              <li key={v.code}>
                <strong>{v.code}</strong>
                <span>{v.name}</span>
                <span className="hint">{v.verses.toLocaleString()} verses</span>
                <button type="button" className="icon-button" aria-label={`Remove ${v.code}`} title={`Remove ${v.code}`} disabled={busy} onClick={() => remove(v)}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {message && <p className="hint" role="status">{message}</p>}
        {error && <p className="error">{error}</p>}

        <footer className="modal-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button type="submit" className="button primary" disabled={busy || !cleanCode || bundledCode}>
            {busy ? 'Importing…' : 'Choose files…'}
          </button>
        </footer>
      </form>
    </div>
  )
}
