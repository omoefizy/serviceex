import { Film, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MediaItem } from '../../shared/types'
import { matchesSearch, MEDIA_DRAG_TYPE } from '../lib/media'
import { useMediaLibrary } from '../lib/useMediaLibrary'

interface GridProps {
  items: MediaItem[]
  selectedId?: number | null
  onSelect(item: MediaItem): void
  /** Lets items be dragged onto slides. */
  draggable?: boolean
}

export function MediaGrid({ items, selectedId = null, onSelect, draggable = false }: GridProps) {
  return (
    <ul className="media-grid">
      {items.map((item) => (
        <li key={item.id}>
          <button
            className={`media-tile${item.id === selectedId ? ' selected' : ''}`}
            title={item.name}
            draggable={draggable}
            onDragStart={(e) => {
              e.dataTransfer.setData(MEDIA_DRAG_TYPE, String(item.id))
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onSelect(item)}
          >
            <span className="media-thumb">
              {item.thumbUrl || item.kind === 'image' ? (
                <img src={item.thumbUrl ?? item.url} alt="" draggable={false} loading="lazy" />
              ) : (
                <Film className="media-thumb-placeholder" size={20} aria-hidden="true" />
              )}
              {item.kind === 'video' && <span className="media-badge">Video</span>}
            </span>
            <span className="media-tile-name">{item.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

interface PickerProps {
  kind: 'image' | 'video'
  onPick(item: MediaItem): void
  onCancel(): void
  /** The heading; "Choose a background image" (or video) by default. */
  title?: string
}

/** Chooses a library image or video, for a theme background or an image element. */
export function MediaPickerModal({ kind, onPick, onCancel, title = `Choose a background ${kind}` }: PickerProps) {
  const { items, error, importFiles } = useMediaLibrary()
  const [search, setSearch] = useState('')
  const shown = items.filter((item) => item.kind === kind && matchesSearch(item, search))

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  async function handleImport() {
    const added = (await importFiles()).filter((item) => item.kind === kind)
    if (added.length === 1) onPick(added[0])
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal media-picker" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="media-toolbar">
          <input className="input" type="search" placeholder="Search name or tag" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <button className="button" onClick={handleImport}>
            <Upload size={15} aria-hidden="true" /> Import…
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {shown.length > 0 ? (
          <MediaGrid items={shown} onSelect={onPick} />
        ) : (
          <p className="empty">{items.some((i) => i.kind === kind) ? `No ${kind}s match.` : `No ${kind}s in the library yet. Import one.`}</p>
        )}
        <footer className="modal-actions">
          <button className="button" onClick={onCancel}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  )
}
