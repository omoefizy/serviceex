import { BookOpen, CloudOff, Megaphone, Music, Presentation, StickyNote, Users, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { hasFeature } from '../../shared/features'
import { orderBetween, visibleItems } from '../../shared/sharedService'
import type { ItemFilter, SharedItem, SharedItemType } from '../../shared/types'
import {
  deviceLabel,
  errorText,
  hostOpenService,
  loadSharedItem,
  SHARED_ITEM_DRAG_TYPE,
  sharedNumericId,
  showMessage,
  updateShared,
  useSharingStore,
} from '../lib/sharing'
import { useOperatorStore } from '../store'
import { Button, IconButton, Select } from './ui'

const ICONS: Record<SharedItemType, LucideIcon> = { song: Music, scripture: BookOpen, announcement: Megaphone, presentation: Presentation, note: StickyNote }

const filterValue = (filter: ItemFilter) => (filter.kind === 'device' ? `device:${filter.deviceId}` : filter.kind)
const parseFilter = (value: string): ItemFilter => (value.startsWith('device:') ? { kind: 'device', deviceId: value.slice(7) } : value === 'mine' ? { kind: 'mine' } : { kind: 'all' })

/** Host, join or leave a shared service, and choose which of its items to list. */
export function SharedServiceBar() {
  const shared = useSharingStore((s) => s.shared)
  const enabled = useSharingStore((s) => s.status?.enabled ?? false)
  const peers = useSharingStore((s) => s.peers)
  const filter = useSharingStore((s) => s.itemFilter)
  const myId = useSharingStore((s) => s.status?.deviceId ?? '')
  const service = useOperatorStore((s) => s.service)
  const [busy, setBusy] = useState(false)

  if (!hasFeature('sharing.sharedService') || (!enabled && (shared?.role ?? 'none') === 'none')) return null

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      showMessage(errorText(error), true)
    } finally {
      setBusy(false)
    }
  }

  if (!shared || shared.role === 'none') {
    const hosts = peers.filter((p) => p.paired && p.online && p.hosting)
    return (
      <div className="shared-bar">
        <Button
          disabled={busy}
          title="Let paired computers join this service and edit it together. Changes sync within about a second."
          onClick={() => run(hostOpenService)}
        >
          <Users size={14} aria-hidden="true" />
          <span className="shared-bar-label">Host {service ? `“${service.name}”` : 'a shared service'}</span>
        </Button>
        {hosts.map((peer) => (
          <Button
            key={peer.id}
            disabled={busy}
            title={`Join ${peer.hosting!.name} on ${peer.name}`}
            onClick={() => run(async () => useSharingStore.setState({ shared: await window.api.sharing.joinService(peer.id) }))}
          >
            <span className="shared-bar-label">
              Join {peer.hosting!.name} on {peer.name}
            </span>
          </Button>
        ))}
      </div>
    )
  }

  const owners = [...new Set(shared.items.filter((i) => !i.deleted && i.ownerDevice && i.ownerDevice !== myId).map((i) => i.ownerDevice as string))]
  const status =
    shared.role === 'host'
      ? 'Hosting'
      : shared.connected
        ? `Joined ${shared.hostName}`
        : `${shared.hostName} is offline: working here${shared.pending > 0 ? `, ${shared.pending} change${shared.pending === 1 ? '' : 's'} to send` : ''}`
  return (
    <div className={`shared-bar active${shared.connected ? '' : ' offline'}`}>
      <span className="shared-status" title={shared.error ?? undefined}>
        {shared.connected ? <Users size={14} aria-hidden="true" /> : <CloudOff size={14} aria-hidden="true" />}
        <strong>{shared.name}</strong> · {status}
      </span>
      <Select aria-label="Show items" value={filterValue(filter)} onChange={(e) => useSharingStore.setState({ itemFilter: parseFilter(e.target.value) })}>
        <option value="all">All items</option>
        <option value="mine">My items</option>
        {owners.map((id) => (
          <option key={id} value={`device:${id}`}>
            {deviceLabel(id)}
          </option>
        ))}
      </Select>
      <Button
        disabled={busy}
        title={shared.role === 'host' ? 'Stop sharing; joined computers keep their own copy' : 'Leave; the shared service goes on for the others'}
        onClick={() => run(async () => useSharingStore.setState({ shared: await window.api.sharing.leaveService() }))}
      >
        {shared.role === 'host' ? 'Stop sharing' : 'Leave'}
      </Button>
    </div>
  )
}

/** The menu for a shared item: whose it is, and removing it. */
function OwnerMenu({ item, at, onClose }: { item: SharedItem; at: { x: number; y: number }; onClose(): void }) {
  const peers = useSharingStore((s) => s.peers)
  const myId = useSharingStore((s) => s.status?.deviceId ?? '')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [onClose])
  const owners = [null, myId, ...peers.filter((p) => p.paired).map((p) => p.id)]
  const choose = (ownerDevice: string | null) => {
    onClose()
    updateShared(item.id, { ownerDevice }).catch(console.error)
  }
  return (
    <div ref={ref} className="live-menu-list send-menu" role="menu" aria-label="Owner" style={{ left: Math.min(at.x, window.innerWidth - 240), top: Math.min(at.y, window.innerHeight - 260) }}>
      <div className="send-menu-title">Belongs to</div>
      {owners.map((id) => (
        <button key={id ?? 'anyone'} type="button" role="menuitemradio" aria-checked={item.ownerDevice === id} onClick={() => choose(id)}>
          <span>{deviceLabel(id)}</span>
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose()
          updateShared(item.id, { deleted: true }).catch(console.error)
        }}
      >
        <span>Remove from shared service</span>
      </button>
    </div>
  )
}

/** The shared service's items as the schedule list, filtered as chosen. */
export function SharedItemList() {
  const shared = useSharingStore((s) => s.shared)
  const filter = useSharingStore((s) => s.itemFilter)
  const myId = useSharingStore((s) => s.status?.deviceId ?? '')
  const activeItemId = useOperatorStore((s) => s.activeItemId)
  const liveItemId = useOperatorStore((s) => s.live.scheduleItemId)
  const [menu, setMenu] = useState<{ item: SharedItem; x: number; y: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  if (!shared) return null
  const items = visibleItems(shared.items, filter, myId)

  const load = (item: SharedItem, live = false) =>
    loadSharedItem(item).then(
      (loaded) => {
        if (loaded && live) useOperatorStore.getState().goLive(0)
      },
      (error) => showMessage(errorText(error), true),
    )

  function drop() {
    const moved = items.find((i) => i.id === dragId)
    if (moved && dropIndex !== null) {
      const from = items.indexOf(moved)
      const rest = items.filter((i) => i.id !== moved.id)
      const at = Math.min(dropIndex > from ? dropIndex - 1 : dropIndex, rest.length)
      if (at !== from) updateShared(moved.id, { order: orderBetween(rest[at - 1]?.order, rest[at]?.order) }).catch(console.error)
    }
    setDragId(null)
    setDropIndex(null)
  }

  return (
    <>
      <ol className="schedule-items shared-items">
        {items.map((item, index) => {
          const Icon = ICONS[item.type]
          const numeric = sharedNumericId(item.id)
          return (
            <li
              key={item.id}
              draggable
              className={[
                'schedule-item',
                numeric === activeItemId && 'active',
                numeric === liveItemId && 'on-air',
                item.id === dragId && 'dragging',
                dropIndex === index && 'drop-before',
                dropIndex === items.length && index === items.length - 1 && 'drop-after',
              ]
                .filter(Boolean)
                .join(' ')}
              onDragStart={(e) => {
                setDragId(item.id)
                e.dataTransfer.effectAllowed = 'linkMove'
                e.dataTransfer.setData(SHARED_ITEM_DRAG_TYPE, item.id)
              }}
              onDragOver={(e) => {
                if (dragId === null) return
                e.preventDefault()
                const box = e.currentTarget.getBoundingClientRect()
                setDropIndex(e.clientY < box.top + box.height / 2 ? index : index + 1)
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop()
              }}
              onDragEnd={() => {
                setDragId(null)
                setDropIndex(null)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ item, x: e.clientX, y: e.clientY })
              }}
            >
              <button className="schedule-item-main" title="Click to preview, double-click to go live. Right-click to choose whose it is." onClick={() => load(item)} onDoubleClick={() => load(item, true)}>
                <Icon className="item-icon" size={16} aria-hidden="true" />
                <span className="schedule-item-title">
                  {item.payload.title}
                  <span className="shared-item-meta">
                    {item.ownerDevice && <span className="shared-owner">{deviceLabel(item.ownerDevice)}</span>}
                    {item.updatedBy !== myId && <span className="hint">changed by {deviceLabel(item.updatedBy)}</span>}
                  </span>
                </span>
              </button>
              <IconButton
                label={`Remove ${item.payload.title}`}
                tooltip="Remove from shared service"
                icon={<X size={14} />}
                onClick={() => updateShared(item.id, { deleted: true })}
              />
            </li>
          )
        })}
        {items.length === 0 && (
          <li className="empty">{filter.kind === 'all' ? 'Add songs and scripture with their + buttons; they join the shared service.' : 'No items here yet. Drag an item onto a device chip, or right-click it, to give it to a device.'}</li>
        )}
      </ol>
      {menu && <OwnerMenu item={menu.item} at={menu} onClose={() => setMenu(null)} />}
    </>
  )
}
