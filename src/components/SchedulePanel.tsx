import {
  BookOpen,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ListPlus,
  Megaphone,
  Music,
  Package,
  PackageOpen,
  Plus,
  Presentation,
  ScrollText,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { AnnouncementPayload, Service, ServiceItem, ServiceItemType, ShareSource } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { droppedPaths, isFileDrag } from '../lib/presentations'
import { addSampleSong, SAMPLE_WELCOME, showLibraryTab } from '../lib/samples'
import { openSendMenu, SERVICES_CHANGED_EVENT, setShareDrag, showMessage, useSharingStore } from '../lib/sharing'
import { SHOW_SERVICE_PICKER_EVENT } from '../lib/shell'
import { MOD } from '../lib/shortcuts'
import { useDismiss } from '../lib/useDismiss'
import { selectDefaultTranslation, useOperatorStore } from '../store'
import { AnnouncementModal } from './AnnouncementModal'
import { NewServiceModal } from './NewServiceModal'
import { PresentationJobs } from './PresentationsPanel'
import { SermonModal } from './SermonModal'
import { SharedItemList, SharedServiceBar } from './SharedServicePanel'
import { Button, EmptyState, ErrorNote, IconButton, Select } from './ui'

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
  return <Icon className="item-icon" size={18} aria-hidden="true" />
}

/** The line under an item's title: its type, and how much is in it. */
function subtitleOf(item: ServiceItem): string {
  if (item.type === 'scripture') return `Scripture · ${item.payload.verses.length} verse${item.payload.verses.length === 1 ? '' : 's'}`
  if (item.type === 'presentation') return `Presentation · ${item.payload.pages.length} slide${item.payload.pages.length === 1 ? '' : 's'}`
  return TYPE_LABELS[item.type]
}

/** The header's Add menu: the items that are made here rather than found in the finder. */
function AddMenu({ disabled, importing, onAnnouncement, onPresentation, onSermon }: { disabled: boolean; importing: boolean; onAnnouncement(): void; onPresentation(): void; onSermon(): void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, ref, useCallback(() => setOpen(false), []))
  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  return (
    <div className="live-menu schedule-add" ref={ref}>
      <IconButton
        className="schedule-add-button"
        label="Add item"
        tooltip="Add an announcement, presentation, sermon outline, song or verse"
        icon={<Plus size={18} />}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="live-menu-list" role="menu" aria-label="Add to the order of service">
          <button type="button" role="menuitem" onClick={choose(() => showLibraryTab('songs'))}>
            <Music size={16} aria-hidden="true" />
            <span>Song…</span>
          </button>
          <button type="button" role="menuitem" onClick={choose(() => showLibraryTab('scripture'))}>
            <BookOpen size={16} aria-hidden="true" />
            <span>Verse…</span>
          </button>
          <button type="button" role="menuitem" onClick={choose(onAnnouncement)}>
            <Megaphone size={16} aria-hidden="true" />
            <span>Announcement</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={importing}
            title="PowerPoint, PDF or images, one slide per page; or drop files and folders on the order of service"
            onClick={choose(onPresentation)}
          >
            <Presentation size={16} aria-hidden="true" />
            <span>Presentation</span>
          </button>
          <button type="button" role="menuitem" title="Turn a sermon outline into points and scripture" onClick={choose(onSermon)}>
            <ScrollText size={16} aria-hidden="true" />
            <span>Sermon outline</span>
          </button>
        </div>
      )}
    </div>
  )
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
  const [error, setError] = useState<ErrorLike | null>(null)
  /** Presentations being imported for the schedule; progress shows in the chips. */
  const [importing, setImporting] = useState(false)
  /** Files are being dragged over the schedule. */
  const [fileOver, setFileOver] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  /** Where the dragged item would land, as an index into the items before the move. */
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  /** The service picker (choose, create, export and import a service) opens from the top bar's service button. */
  const [pickerOpen, setPickerOpen] = useState(false)

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
  const liveIndex = items.findIndex((item) => item.id === liveItemId)
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
      setError(reportError('Schedule', err))
    }
  }, [])

  useEffect(() => {
    const open = () => setPickerOpen(true)
    window.addEventListener(SHOW_SERVICE_PICKER_EVENT, open)
    return () => window.removeEventListener(SHOW_SERVICE_PICKER_EVENT, open)
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
      if (file) showMessage(`Saved ${file}`, 'success')
    })
  }

  /** Puts a .serviceex file in the Inbox, where it is previewed and accepted like a received one. */
  function importPackage() {
    window.api.sharing.importPackage().then(
      (item) => item && useSharingStore.setState({ inboxOpen: true, unseen: 0 }),
      (err) => setError(reportError('Schedule', err)),
    )
  }

  async function handleCreate(name: string, date: string | null) {
    const created = await window.api.services.create(name, date)
    setServices(await window.api.services.list())
    await openService(created.id)
    setCreating(false)
  }

  /** A service to try things with: a welcome slide, a public domain hymn and Psalm 23. */
  function createSampleService() {
    run(async () => {
      const created = await window.api.services.create('Sample service', new Date().toISOString().slice(0, 10))
      await window.api.services.addItem(created.id, 'announcement', null, SAMPLE_WELCOME)
      const song = await addSampleSong()
      if (song) await window.api.services.addItem(created.id, 'song', song.id, null)
      const version = selectDefaultTranslation(useOperatorStore.getState())
      const psalms = (await window.api.bible.listBooks()).find((b) => /^psalm/i.test(b))
      const verses = psalms ? await window.api.bible.getRange(version, psalms, 23, 1, 6).catch(() => []) : []
      if (verses.length > 0) {
        await window.api.services.addItem(created.id, 'scripture', null, {
          title: `Psalm 23 ${version}`,
          verses: verses.map((v) => ({ text: v.text, caption: `${v.book} ${v.chapter}:${v.verse} ${version}` })),
        })
      }
      setServices(await window.api.services.list())
      await openService(created.id)
      useOperatorStore.getState().songsChanged()
    })
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

  const stateOf = (item: ServiceItem, index: number) =>
    item.id === liveItemId ? ', on screen now' : item.id === activeItemId ? ', in preview' : liveIndex !== -1 && index === liveIndex + 1 ? ', next' : liveIndex !== -1 && index < liveIndex ? ', done' : ''

  // The rail: a 64 pixel column of item icons, when collapsed or in a window under 1280 pixels.
  if (collapsed) {
    return (
      <aside className="schedule collapsed" aria-label="Order of service">
        <IconButton label="Show the order of service" icon={<ChevronRight size={18} />} aria-expanded={false} onClick={() => onCollapsedChange(false)} />
        <ol className="schedule-rail-items">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className={['schedule-rail-item', item.id === activeItemId && 'active', item.id === liveItemId && 'on-air'].filter(Boolean).join(' ')}
                title={`${item.title}: click to preview, double-click to go live`}
                aria-label={`${item.title}${stateOf(item, index)}`}
                aria-current={item.id === activeItemId ? 'true' : undefined}
                onClick={() => run(() => loadItem(item))}
                onDoubleClick={() =>
                  run(async () => {
                    if (await loadItem(item)) useOperatorStore.getState().goLive(0)
                  })
                }
              >
                <ItemIcon type={item.type} />
              </button>
            </li>
          ))}
        </ol>
        <IconButton className="schedule-rail-add" label="Add song, slide or verse" icon={<Plus size={18} />} disabled={!service} onClick={() => showLibraryTab('songs')} />
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
      <header className="panel-header ui-panel-head schedule-head">
        <div className="schedule-head-text">
          <h2 className="ui-panel-title">Order of service</h2>
          {service && (
            <span className="ui-panel-meta schedule-count">
              {items.length} item{items.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="ui-panel-actions">
          <AddMenu
            disabled={!service}
            importing={importing}
            onAnnouncement={() => setAnnouncing(true)}
            onPresentation={() => window.api.presentations.pick('files').then(importPresentations, console.error)}
            onSermon={() => setSermonOpen(true)}
          />
          <IconButton
            className="schedule-collapse"
            label="Hide the order of service"
            icon={<ChevronLeft size={18} />}
            aria-expanded={true}
            onClick={() => onCollapsedChange(true)}
          />
        </div>
      </header>

      <div className="schedule-picker" hidden={!pickerOpen}>
        <div className="schedule-picker-head">
          <span className="schedule-picker-title">Service</span>
          <IconButton size="sm" label="Close the service picker" icon={<X size={14} />} onClick={() => setPickerOpen(false)} />
        </div>
        <Select
          aria-label="Service"
          title="Right-click to send this service to another computer"
          onContextMenu={(e) => service && openSendMenu(e, [{ type: 'service', id: service.id }])}
          value={service?.id ?? ''}
          onChange={(e) => run(async () => {
            await openService(Number(e.target.value))
            setPickerOpen(false)
          })}
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
          <Button size="sm" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>
            New service
          </Button>
          {service && bibleVersions.length > 0 && (
            <label className="schedule-translation" title="The translation references open in during this service">
              <BookOpen size={16} aria-hidden="true" />
              <Select size="sm" aria-label="Translation for this service" value={serviceVersion} onChange={(e) => setServiceVersion(e.target.value)}>
                <option value="">Default ({defaultVersion})</option>
                {bibleVersions.map((v) => (
                  <option key={v.code} value={v.code} title={v.name}>
                    {v.code}
                  </option>
                ))}
              </Select>
            </label>
          )}
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

      <ErrorNote error={error} />

      {sharedOpen ? (
        <SharedItemList />
      ) : (
        <ol className="schedule-items">
          {items.map((item, index) => {
            const done = liveIndex !== -1 && index < liveIndex
            const next = liveIndex !== -1 && index === liveIndex + 1
            return (
              <li
                key={item.id}
                draggable
                className={[
                  'schedule-item',
                  item.id === activeItemId && 'active',
                  item.id === liveItemId && 'on-air',
                  done && 'done',
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
                <span className="schedule-item-handle" title="Drag to reorder" aria-hidden="true">
                  <GripVertical size={14} />
                </span>
                <button
                  className="schedule-item-main"
                  title="Click to preview, double-click to go live"
                  aria-current={item.id === activeItemId ? 'true' : undefined}
                  onClick={() => run(() => loadItem(item))}
                  onDoubleClick={() =>
                    run(async () => {
                      if (await loadItem(item)) useOperatorStore.getState().goLive(0)
                    })
                  }
                >
                  <span className="schedule-item-type" title={TYPE_LABELS[item.type]}>
                    {item.type === 'presentation' && item.payload.pages[0] ? (
                      // Its first slide; the picture changes when the original is saved again.
                      <img className="schedule-item-thumb" src={item.payload.pages[0]} alt="" />
                    ) : (
                      <ItemIcon type={item.type} />
                    )}
                  </span>
                  <span className="schedule-item-text">
                    <span className="schedule-item-title">{item.title}</span>
                    <span className="schedule-item-subtitle">{subtitleOf(item)}</span>
                    <span className="visually-hidden">
                      {item.id === liveItemId ? ', on screen now' : item.id === activeItemId ? ', in preview' : next ? ', next' : done ? ', done' : ''}
                    </span>
                  </span>
                  {item.id === liveItemId ? (
                    <span className="schedule-item-state now" aria-hidden="true">
                      Now
                    </span>
                  ) : next ? (
                    <span className="schedule-item-state next" aria-hidden="true">
                      Next
                    </span>
                  ) : item.id === activeItemId ? (
                    <span className="schedule-item-state preview" aria-hidden="true">
                      Preview
                    </span>
                  ) : done ? (
                    <Check className="schedule-item-done" size={18} aria-hidden="true" />
                  ) : null}
                </button>
                <IconButton
                  label={`Remove ${item.title} from the order of service`}
                  tooltip="Remove from the order of service"
                  icon={<X size={14} />}
                  onClick={() => run(() => removeFromSchedule(item.id))}
                />
              </li>
            )
          })}
          {service && items.length === 0 && (
            <li className="schedule-empty">
              <EmptyState
                compact
                icon={<ListPlus size={20} />}
                title="Nothing in this service yet"
                description="Add songs and scripture from the library with their + buttons, or start with a welcome slide."
                action={
                  <Button variant="primary" icon={<Music size={15} aria-hidden="true" />} onClick={() => showLibraryTab('songs')}>
                    Browse songs
                  </Button>
                }
                secondaryAction={
                  <Button variant="ghost" icon={<Megaphone size={15} aria-hidden="true" />} onClick={() => run(() => addToSchedule('announcement', null, SAMPLE_WELCOME))}>
                    Add a welcome slide
                  </Button>
                }
              />
            </li>
          )}
          {!service && (
            <li className="schedule-empty">
              <EmptyState
                compact
                icon={<CalendarPlus size={20} />}
                title="No service yet"
                description="A service is the run list for one gathering: its songs, scripture and announcements in order."
                action={
                  <Button variant="primary" icon={<Plus size={15} aria-hidden="true" />} onClick={() => setCreating(true)}>
                    New service
                  </Button>
                }
                secondaryAction={
                  <Button variant="ghost" icon={<Sparkles size={15} aria-hidden="true" />} onClick={createSampleService}>
                    Create a sample service
                  </Button>
                }
              />
            </li>
          )}
        </ol>
      )}

      <footer className="schedule-footer">
        <Button
          size="lg"
          className="schedule-add-footer"
          icon={<Plus size={16} aria-hidden="true" />}
          disabled={!service}
          title={`Add from the finder. ${MOD}↓ runs the next item.`}
          onClick={() => showLibraryTab('songs')}
        >
          Add song, slide or verse
        </Button>
      </footer>
      <PresentationJobs />

      {creating && <NewServiceModal onSave={handleCreate} onCancel={() => setCreating(false)} />}
      {announcing && <AnnouncementModal onSave={handleAnnouncement} onCancel={() => setAnnouncing(false)} />}
      {sermonOpen && <SermonModal onClose={() => setSermonOpen(false)} />}
    </aside>
  )
}
