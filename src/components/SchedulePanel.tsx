import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Music,
  Plus,
  Presentation,
  ScrollText,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState, type DragEvent } from 'react'
import type { AnnouncementPayload, Service, ServiceItemType } from '../../shared/types'
import { renderPdfPages } from '../lib/media'
import { MOD } from '../lib/shortcuts'
import { useOperatorStore } from '../store'
import { AnnouncementModal } from './AnnouncementModal'
import { NewServiceModal } from './NewServiceModal'
import { SermonModal } from './SermonModal'

const TYPE_LABELS: Record<ServiceItemType, string> = {
  song: 'Song',
  scripture: 'Scripture',
  announcement: 'Announcement',
  presentation: 'Presentation',
}

const TYPE_ICONS: Record<ServiceItemType, LucideIcon> = {
  song: Music,
  scripture: BookOpen,
  announcement: Megaphone,
  presentation: Presentation,
}

function ItemIcon({ type }: { type: ServiceItemType }) {
  const Icon = TYPE_ICONS[type]
  return <Icon className="item-icon" size={16} role="img" aria-label={TYPE_LABELS[type]} />
}

interface Props {
  collapsed: boolean
  onCollapsedChange(collapsed: boolean): void
}

/** The run list. Its collapsed state belongs to App, which lays out the panel columns. */
export function SchedulePanel({ collapsed, onCollapsedChange }: Props) {
  const [services, setServices] = useState<Service[]>([])
  const [creating, setCreating] = useState(false)
  const [announcing, setAnnouncing] = useState(false)
  const [sermonOpen, setSermonOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Progress while a presentation is imported, such as "Rendering page 3 of 12…". */
  const [progress, setProgress] = useState<string | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  /** Where the dragged item would land, as an index into the items before the move. */
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const service = useOperatorStore((s) => s.service)
  const activeItemId = useOperatorStore((s) => s.activeItemId)
  const openService = useOperatorStore((s) => s.openService)
  const loadItem = useOperatorStore((s) => s.loadItem)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const removeFromSchedule = useOperatorStore((s) => s.removeFromSchedule)
  const reorderSchedule = useOperatorStore((s) => s.reorderSchedule)
  const items = service?.items ?? []

  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Open the newest service on start.
  useEffect(() => {
    run(async () => {
      const list = await window.api.services.list()
      setServices(list)
      if (list.length > 0 && !useOperatorStore.getState().service) await openService(list[0].id)
    })
  }, [run, openService])

  async function handleCreate(name: string, date: string | null) {
    const created = await window.api.services.create(name, date)
    setServices(await window.api.services.list())
    await openService(created.id)
    setCreating(false)
  }

  async function handleAnnouncement(payload: AnnouncementPayload) {
    await addToSchedule('announcement', null, payload)
    setAnnouncing(false)
  }

  /** Images become pages as they are; a PDF is drawn page by page here, then saved. */
  function handlePresentation() {
    run(async () => {
      try {
        setProgress('Choosing files…')
        const source = await window.api.media.pickPresentation()
        if (!source) return
        const pages =
          source.kind === 'images'
            ? source.pages
            : await renderPdfPages(source.data, (page, total) => setProgress(`Rendering page ${page} of ${total}…`))
        setProgress('Adding to the schedule…')
        await addToSchedule('presentation', null, { title: source.title, pages })
      } finally {
        setProgress(null)
      }
    })
  }

  function handleDragOver(e: DragEvent<HTMLLIElement>, index: number) {
    if (dragId === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const box = e.currentTarget.getBoundingClientRect()
    setDropIndex(e.clientY < box.top + box.height / 2 ? index : index + 1)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    const from = items.findIndex((item) => item.id === dragId)
    if (from !== -1 && dropIndex !== null) {
      const ids = items.map((item) => item.id)
      const [moved] = ids.splice(from, 1)
      ids.splice(dropIndex > from ? dropIndex - 1 : dropIndex, 0, moved)
      if (ids.some((id, i) => id !== items[i].id)) run(() => reorderSchedule(ids))
    }
    setDragId(null)
    setDropIndex(null)
  }

  if (collapsed) {
    return (
      <aside className="schedule collapsed">
        <button className="schedule-toggle" aria-expanded={false} onClick={() => onCollapsedChange(false)}>
          <ChevronLeft size={16} aria-hidden="true" />
          <span className="schedule-toggle-label">Schedule</span>
        </button>
      </aside>
    )
  }

  return (
    <aside className="panel schedule">
      <header className="panel-header">
        <h2>Schedule</h2>
        <button
          className="icon-button"
          aria-label="Hide schedule"
          aria-expanded={true}
          title="Hide schedule"
          onClick={() => onCollapsedChange(true)}
        >
          <ChevronRight size={16} />
        </button>
      </header>

      <div className="schedule-picker">
        <select
          className="input"
          aria-label="Service"
          value={service?.id ?? ''}
          onChange={(e) => run(() => openService(Number(e.target.value)))}
          disabled={services.length === 0}
        >
          {services.length === 0 && <option value="">No services yet</option>}
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.date ? `${s.name} · ${s.date}` : s.name}
            </option>
          ))}
        </select>
        <button className="button" onClick={() => setCreating(true)}>
          <Plus size={15} aria-hidden="true" /> New service
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <ol className="schedule-items">
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable
            className={[
              'schedule-item',
              item.id === activeItemId && 'active',
              item.id === dragId && 'dragging',
              dropIndex === index && 'drop-before',
              dropIndex === items.length && index === items.length - 1 && 'drop-after',
            ]
              .filter(Boolean)
              .join(' ')}
            onDragStart={(e) => {
              setDragId(item.id)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(item.id))
            }}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={handleDrop}
            onDragEnd={() => {
              setDragId(null)
              setDropIndex(null)
            }}
          >
            <button className="schedule-item-main" onClick={() => run(() => loadItem(item))}>
              <ItemIcon type={item.type} />
              <span className="schedule-item-title">{item.title}</span>
            </button>
            <button
              className="icon-button"
              aria-label={`Remove ${item.title} from schedule`}
              title="Remove from schedule"
              onClick={() => run(() => removeFromSchedule(item.id))}
            >
              <X size={14} />
            </button>
          </li>
        ))}
        {service && items.length === 0 && (
          <li className="empty">Add songs and scripture with their + buttons, or add an announcement below.</li>
        )}
        {!service && <li className="empty">Create a service to start a run list.</li>}
      </ol>

      <footer className="schedule-footer">
        <button className="button" disabled={!service} onClick={() => setAnnouncing(true)}>
          <Megaphone size={15} aria-hidden="true" /> Announcement
        </button>
        <button className="button" disabled={!service || progress !== null} onClick={handlePresentation} title="Images or a PDF, one slide per page">
          <Presentation size={15} aria-hidden="true" /> Presentation
        </button>
        <button className="button" disabled={!service} onClick={() => setSermonOpen(true)} title="Turn a sermon outline into points and scripture">
          <ScrollText size={15} aria-hidden="true" /> Sermon
        </button>
        <span className="hint">{MOD}↓ next item</span>
      </footer>
      {progress && <p className="hint">{progress}</p>}

      {creating && <NewServiceModal onSave={handleCreate} onCancel={() => setCreating(false)} />}
      {announcing && <AnnouncementModal onSave={handleAnnouncement} onCancel={() => setAnnouncing(false)} />}
      {sermonOpen && <SermonModal onClose={() => setSermonOpen(false)} />}
    </aside>
  )
}
