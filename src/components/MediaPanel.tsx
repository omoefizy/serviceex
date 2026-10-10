import { Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { MediaItem } from '../../shared/types'
import { matchesSearch } from '../lib/media'
import { useMediaLibrary } from '../lib/useMediaLibrary'
import { useOperatorStore } from '../store'
import { MediaGrid } from './MediaGrid'

function MediaDetails({ item, onClose }: { item: MediaItem; onClose(): void }) {
  const [name, setName] = useState(item.name)
  const [tags, setTags] = useState(item.tags.join(', '))
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mediaChanged = useOperatorStore((s) => s.mediaChanged)
  const dirty = name.trim() !== item.name || tags !== item.tags.join(', ')

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      setError(null)
      mediaChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="media-details">
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Tags <small>Comma separated</small>
        </span>
        <input className="input" placeholder="loops, christmas" value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      {confirmingDelete && <p className="hint">Slides and custom themes using it go back to their theme’s background.</p>}
      <div className="media-details-actions">
        {confirmingDelete ? (
          <>
            <button className="button" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
            <button
              className="button danger"
              onClick={() =>
                run(async () => {
                  await window.api.media.delete(item.id)
                  // Slides and custom themes that used it changed in the database; show that.
                  const { refreshSlideBackgrounds, loadThemes } = useOperatorStore.getState()
                  await Promise.all([refreshSlideBackgrounds(), loadThemes()])
                  onClose()
                })
              }
            >
              Delete
            </button>
          </>
        ) : (
          <button className="button" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={15} aria-hidden="true" /> Delete…
          </button>
        )}
        <button
          className="button primary"
          disabled={!dirty || !name.trim()}
          onClick={() =>
            run(() =>
              window.api.media.update(
                item.id,
                name.trim(),
                tags.split(',').map((t) => t.trim()).filter(Boolean),
              ),
            )
          }
        >
          Save
        </button>
      </div>
    </div>
  )
}

export function MediaPanel() {
  const { items, error, importFiles } = useMediaLibrary()
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const tags = [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b))
  const shown = items.filter((item) => matchesSearch(item, search) && (tag === null || item.tags.includes(tag)))
  const selected = items.find((item) => item.id === selectedId) ?? null

  return (
    <section className="panel media-panel">
      <header className="panel-header">
        <h2>Media</h2>
        <button className="button primary" onClick={() => importFiles()}>
          <Upload size={15} aria-hidden="true" /> Import…
        </button>
      </header>

      <input className="input" type="search" placeholder="Search name or tag" value={search} onChange={(e) => setSearch(e.target.value)} />

      {tags.length > 0 && (
        <div className="chips">
          {tags.map((t) => (
            <button key={t} className={`chip add${tag === t ? ' active' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="media-scroll">
        {shown.length > 0 ? (
          <MediaGrid items={shown} selectedId={selectedId} onSelect={(item) => setSelectedId(item.id === selectedId ? null : item.id)} draggable />
        ) : (
          <p className="empty">{items.length === 0 ? 'Import images or MP4/WebM loops to use as backgrounds.' : 'Nothing matches.'}</p>
        )}
      </div>

      {items.length > 0 && <p className="hint">Drag onto a slide to give that slide its own background.</p>}
      {selected && <MediaDetails key={selected.id} item={selected} onClose={() => setSelectedId(null)} />}
    </section>
  )
}
