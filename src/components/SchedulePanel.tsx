import {
  BookOpen,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ListPlus,
  Megaphone,
  Music,
  Package,
  PackageOpen,
  Plus,
  Presentation,
  ScrollText,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState, type DragEvent } from 'react'
import type { AnnouncementPayload, Service, ServiceItem, ServiceItemType, ShareSource } from '../../shared/types'
import { droppedPaths, isFileDrag } from '../lib/presentations'
import { errorText, openSendMenu, SERVICES_CHANGED_EVENT, setShareDrag, showMessage, useSharingStore } from '../lib/sharing'
import { MOD } from '../lib/shortcuts'
import { useOperatorStore } from '../store'
import { AnnouncementModal } from './AnnouncementModal'
import { NewServiceModal } from './NewServiceModal'
import { PresentationJobs } from './PresentationsPanel'
import { SermonModal } from './SermonModal'
import { SharedItemList, SharedServiceBar } from './SharedServicePanel'
import { Button, EmptyState, IconButton, PanelHeader, Select } from './ui'

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

/** What Send to sends for a schedule item: the song, the announcement or the library presentation. */
function shareSourceOf(item: ServiceItem): ShareSource | null {
  if (item.type === 'song') return { type: 'song', id: item.ref_id }
  if (item.type === 'announcement') return { type: 'announcement', itemId: item.id }
  if (item.type === 'presentation' && item.payload.presentationId) return { type: 'presentation', id: item.payload.presentationId }
  return null
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
  /** Presentations being imported for the schedule; progress shows in the chips. */
  const [importing, setImporting] = useState(false)
  /** Files are being dragged over the schedule. */
  const [fileOver, setFileOver] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  /** Where the dragged item would land, as an index into the items before the move. */
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const service = useOperatorStore((s) => s.service)
  const sharedOpen = useSharingStore((s) => (s.shared?.role ?? 'none') !== 'none')
  const activeItemId = useOperatorStore((s) => s.activeItemId)
  const liveItemId = useOperatorStore((s) => s.live.scheduleItemId)
  const openService = useOperatorStore((s) => s.openService)
  const loadItem = useOperatorStore((s) => s.loadItem)
  const addToSchedule = useOperatorStore((s) => s.addToSchedule)
  const removeFromSchedule = useOperatorStore((s) => s.removeFromSchedule)
  const reorderSchedule = useOperatorStore((s) => s.reorderSchedule)
  const bibleVersions = useOperatorStore((s) => s.bibleVersions)
  const defaultVersion = useOperatorStore((s) => s.settings.scriptureDefaultVersion)
  const serviceVersions = useOperatorStore((s) => s.settings.scriptureServiceVersions)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const items = service?.items ?? []
  const serviceVersion = service ? (serviceVersions[String(service.id)] ?? '') : ''

  /** The open service's own default translation; empty uses the one in Settings. */
  function setServiceVersion(code: string) {
    if (!service) return
    const next = { ...serviceVersions }
    if (code) next[String(service.id)] = code
    else delete next[String(service.id)]
    run(() => updateSettings({ scriptureServiceVersions: next }))
  }

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

  // A service received from another computer joins the list; the open one stays open.
  useEffect(() => {
    const reload = () => run(async () => setServices(await window.api.services.list()))
    window.addEventListener(SERVICES_CHANGED_EVENT, reload)
    return () => window.removeEventListener(SERVICES_CHANGED_EVENT, reload)
  }, [run])

  /** Writes the open service, its songs, themes, media and presentations as one .serviceex file. */
  function exportPackage() {
    if (!service) return
    run(async () => {
      const file = await window.api.sharing.exportPackage(service.id)
      if (file) showMessage(`Saved ${file}`)
    })
  }

  /** Puts a .serviceex file in the Inbox, where it is previewed and accepted like a received one. */
  function importPackage() {
    window.api.sharing.importPackage().then(
      (item) => item && useSharingStore.setState({ inboxOpen: true, unseen: 0 }),
      (err) => setError(errorText(err)),
    )
  }

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

  /** Imports into the Presentations library, then adds each to the end of the schedule. */
  function importPresentations(paths: string[]) {
    if (paths.length === 0) return
    run(async () => {
      try {
        setImporting(true)
        const { importPresentations, addPresentationToSchedule } = useOperatorStore.getState()
        for (const presentation of await importPresentations(paths)) await addPresentationToSchedule(presentation)
      } finally {
        setImporting(false)
      }
    })
  }

  function handleDragOver(e: DragEvent<HTMLLIElement>, index: number) {
    if (dragId === null || isFileDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const box = e.currentTarget.getBoundingClientRect()
    setDropIndex(e.clientY < box.top + box.height / 2 ? index : index + 1)
  }

  function handleDrop(e: DragEvent) {
    if (isFileDrag(e)) return
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
        <button className="panel-rail-toggle" aria-expanded={false} title="Show the schedule" onClick={() => onCollapsedChange(false)}>
          <ChevronLeft size={16} aria-hidden="true" />
          <span className="panel-rail-label">Schedule</span>
        </button>
      </aside>
    )
  }

  return (
    <aside
      className={`panel schedule${fileOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (!isFileDrag(e) || !service) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setFileOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false)
      }}
      onDrop={(e) => {
        if (!isFileDrag(e) || !service) return
        e.preventDefault()
        setFileOver(false)
        importPresentations(droppedPaths(e))
      }}
    >
      <PanelHeader
        title="Schedule"
        actions={
          <>
            {service && bibleVersions.length > 0 && (
              <label className="schedule-translation" title="The translation references open in during this service">
                <BookOpen size={13} aria-hidden="true" />
                <Select aria-label="Translation for this service" value={serviceVersion} onChange={(e) => setServiceVersion(e.target.value)}>
                  <option value="">Default ({defaultVersion})</option>
                  {bibleVersions.map((v) => (
                    <option key={v.code} value={v.code} title={v.name}>
                      {v.code}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <IconButton label="Hide schedule" icon={<ChevronRight size={16} />} aria-expanded={true} onClick={() => onCollapsedChange(true)} />
          </>
        }
      />

      <div className="schedule-picker">
        <Select
          aria-label="Service"
          title="Right-click to send this service to another computer"
          onContextMenu={(e) => service && openSendMenu(e, [{ type: 'service', id: service.id }])}
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
        </Select>
        <div className="schedule-picker-actions">
          <Button icon={<Plus size={15} aria-hidden="true" />} onClick={() => setCreating(true)}>
            New service
          </Button>
          <IconButton
            label="Export package"
            tooltip="Export package: this service as one .serviceex file, for a USB drive"
            icon={<Package size={16} />}
            disabled={!service}
            onClick={exportPackage}
          />
          <IconButton label="Import package" tooltip="Import package: open a .serviceex file" icon={<PackageOpen size={16} />} onClick={importPackage} />
        </div>
      </div>

      <SharedServiceBar />

      {error && <p className="error">{error}</p>}

      {sharedOpen ? (
        <SharedItemList />
      ) : (
        <ol className="schedule-items">
          {items.map((item, index) => (
            <li
              key={item.id}
              draggable
              className={[
                'schedule-item',
                item.id === activeItemId && 'active',
                item.id === liveItemId && 'on-air',
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
                // It can also be dropped on a device chip to send it.
                const source = shareSourceOf(item)
                if (source) setShareDrag(e, source)
              }}
              onContextMenu={(e) => {
                const source = shareSourceOf(item)
                if (source) openSendMenu(e, [source])
              }}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={handleDrop}
              onDragEnd={() => {
                setDragId(null)
                setDropIndex(null)
              }}
            >
              <button
                className="schedule-item-main"
                title="Click to preview, double-click to go live"
                onClick={() => run(() => loadItem(item))}
                onDoubleClick={() =>
                  run(async () => {
                    if (await loadItem(item)) useOperatorStore.getState().goLive(0)
                  })
                }
              >
                {item.type === 'presentation' && item.payload.pages[0] ? (
                  // Its first slide; the picture changes when the original is saved again.
                  <img className="schedule-item-thumb" src={item.payload.pages[0]} alt="Presentation" />
                ) : (
                  <ItemIcon type={item.type} />
                )}
                <span className="schedule-item-title">{item.title}</span>
              </button>
              <IconButton
                label={`Remove ${item.title} from schedule`}
                tooltip="Remove from schedule"
                icon={<X size={14} />}
                onClick={() => run(() => removeFromSchedule(item.id))}
              />
            </li>
          ))}
          {service && items.length === 0 && (
            <li>
              <EmptyState
                compact
                icon={<ListPlus size={20} />}
                title="Nothing in this service yet"
                description="Add songs and scripture with their + buttons, or add an announcement below."
              />
            </li>
          )}
          {!service && (
            <li>
              <EmptyState compact icon={<CalendarPlus size={20} />} title="No service open" description="Create a service to start a run list." />
            </li>
          )}
        </ol>
      )}

      <footer className="schedule-footer">
        <Button icon={<Megaphone size={15} aria-hidden="true" />} disabled={!service} onClick={() => setAnnouncing(true)}>
          Announcement
        </Button>
        <Button
          icon={<Presentation size={15} aria-hidden="true" />}
          disabled={!service || importing}
          onClick={() => window.api.presentations.pick('files').then(importPresentations, console.error)}
          title="PowerPoint, PDF or images, one slide per page; or drop files and folders on the schedule"
        >
          Presentation
        </Button>
        <Button
          icon={<ScrollText size={15} aria-hidden="true" />}
          disabled={!service}
          onClick={() => setSermonOpen(true)}
          title="Turn a sermon outline into points and scripture"
        >
          Sermon
        </Button>
        <span className="hint">{MOD}↓ next item</span>
      </footer>
      <PresentationJobs />

      {creating && <NewServiceModal onSave={handleCreate} onCancel={() => setCreating(false)} />}
      {announcing && <AnnouncementModal onSave={handleAnnouncement} onCancel={() => setAnnouncing(false)} />}
      {sermonOpen && <SermonModal onClose={() => setSermonOpen(false)} />}
    </aside>
  )
}
