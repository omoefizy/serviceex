import { BellRing, Copy, Inbox as InboxIcon, Laptop, Lock, RotateCw, Send, Unplug, Wifi, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { formatBytes } from '../../shared/sharing'
import type { SharePeer, TransferProgress } from '../../shared/types'
import {
  beginPairing,
  canDropOnDevice,
  droppedSources,
  errorText,
  sendCueTo,
  sendTo,
  SHARED_ITEM_DRAG_TYPE,
  showMessage,
  startSharing,
  updateShared,
  useSharingStore,
} from '../lib/sharing'
import { useOperatorStore } from '../store'
import { CueTray } from './CueTray'
import { InboxPanel } from './InboxPanel'

/**
 * A device on the network: drop files or items on it to send them, or a shared service item to make it that
 * device's; click an unpaired one to pair. It shows the title of what that computer has live.
 */
function DeviceChip({ peer }: { peer: SharePeer }) {
  const [over, setOver] = useState(false)
  const status = peer.disconnected
    ? 'Disconnected in Settings'
    : peer.online
      ? peer.paired
        ? 'Online'
        : 'Not paired yet: click to pair'
      : 'Offline'
  const live = peer.liveTitle ? ` Live: ${peer.liveTitle}.` : ''
  return (
    <button
      type="button"
      className={`device-chip${peer.paired ? ' paired' : ''}${peer.online ? '' : ' offline'}${over ? ' drag-over' : ''}`}
      title={`${peer.name}: ${status}.${live} Drop files or items here to send them, or a shared service item to give it to this device.`}
      onClick={() => {
        if (!peer.paired && peer.online) beginPairing(peer).catch(console.error)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(SHARED_ITEM_DRAG_TYPE) && peer.paired) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'link'
          setOver(true)
          return
        }
        if (!canDropOnDevice(e) || !peer.online) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const shared = e.dataTransfer.getData(SHARED_ITEM_DRAG_TYPE)
        if (shared && peer.paired) {
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          updateShared(shared, { ownerDevice: peer.id }).then(() => showMessage(`Given to ${peer.name}.`), console.error)
          return
        }
        if (!canDropOnDevice(e) || !peer.online) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const { sources, refused } = droppedSources(e)
        if (refused.length > 0) showMessage(`Not sent (type not allowed): ${refused.join(', ')}`, true)
        sendTo(peer, sources).catch(console.error)
      }}
    >
      <span className={`device-dot${peer.online ? ' online' : ''}`} aria-hidden="true" />
      <Laptop size={13} aria-hidden="true" />
      <span className="device-name">{peer.name}</span>
      {peer.disconnected ? <Unplug size={11} aria-label="Disconnected" /> : peer.paired && <Lock size={11} aria-label="Paired" />}
      {peer.liveTitle && <span className="device-live">{peer.liveTitle}</span>}
    </button>
  )
}

function TransferChip({ transfer }: { transfer: TransferProgress }) {
  const percent = transfer.size > 0 ? Math.floor((transfer.sent / transfer.size) * 100) : 0
  const dismiss = () => useSharingStore.setState((s) => ({ transfers: s.transfers.filter((t) => t.id !== transfer.id) }))
  const label =
    transfer.state === 'preparing'
      ? 'Preparing'
      : transfer.state === 'retrying'
        ? `Reconnecting ${percent}%`
        : transfer.state === 'done'
          ? 'Sent'
          : transfer.state === 'failed'
            ? 'Failed'
            : `${percent}%`
  return (
    <span className={`transfer-chip ${transfer.state}`} role="status" title={transfer.error ?? `${transfer.name} to ${transfer.peerName}, ${formatBytes(transfer.size)}`}>
      <Send size={11} aria-hidden="true" />
      <span className="transfer-name">{transfer.name}</span>
      <span className="transfer-state">{label}</span>
      {transfer.state === 'failed' && (
        <button
          type="button"
          className="transfer-action"
          title="Send again, carrying on from what already arrived"
          onClick={() => window.api.sharing.retry(transfer.id).catch((error) => showMessage(errorText(error), true))}
        >
          <RotateCw size={11} aria-hidden="true" /> Retry
        </button>
      )}
      {(transfer.state === 'failed' || transfer.state === 'done') && (
        <button type="button" className="transfer-action" aria-label="Dismiss" onClick={dismiss}>
          <X size={11} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

/** This computer pairing with another: type the code the other one shows. */
function PairDialog() {
  const pairing = useSharingStore((s) => s.pairing)
  const [code, setCode] = useState('')
  if (!pairing) return null
  const close = () => {
    useSharingStore.setState({ pairing: null })
    setCode('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!pairing?.pairingId) return
    useSharingStore.setState({ pairing: { ...pairing, busy: true, error: null } })
    try {
      const device = await window.api.sharing.finishPairing(pairing.pairingId, code)
      const pending = pairing.pending
      close()
      showMessage(`Paired with ${device.name}.`)
      if (pending.length > 0) await window.api.sharing.send(device.id, pending)
    } catch (error) {
      // One try per code: a new code is needed.
      useSharingStore.setState({ pairing: { ...pairing, busy: false, pairingId: null, error: errorText(error) } })
      setCode('')
    }
  }

  const again = () => {
    const peer = useSharingStore.getState().peers.find((p) => p.id === pairing.peerId)
    if (peer) beginPairing(peer, pairing.pending).catch(console.error)
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form className="modal pair-dialog" role="dialog" aria-label={`Pair with ${pairing.peerName}`} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Pair with {pairing.peerName}</h2>
        {pairing.pairingId ? (
          <>
            <p>Type the 6 digit code now showing on {pairing.peerName}.</p>
            <input
              className="input pair-code-input"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              pattern="\d{6}"
              aria-label="Pairing code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
            />
          </>
        ) : (
          pairing.busy && <p className="hint">Asking {pairing.peerName} to show a code…</p>
        )}
        {pairing.error && <p className="error">{pairing.error}</p>}
        <p className="hint">Pairing happens once. After that, files between the two computers are encrypted, and only paired computers can send.</p>
        <footer className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          {!pairing.pairingId && !pairing.busy ? (
            <button type="button" className="button primary" onClick={again}>
              Get a new code
            </button>
          ) : (
            <button type="submit" className="button primary" disabled={pairing.busy || code.length !== 6}>
              {pairing.busy && pairing.pairingId ? 'Pairing…' : 'Pair'}
            </button>
          )}
        </footer>
      </form>
    </div>
  )
}

/** Another computer pairing with this one: show the code to type there. */
function PairCode() {
  const request = useSharingStore((s) => s.pairRequest)
  if (!request) return null
  const close = () => {
    useSharingStore.setState({ pairRequest: null })
    window.api.sharing.dismissPairing(request.pairingId).catch(console.error)
  }
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal pair-dialog" role="dialog" aria-label="Pairing code" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{request.deviceName} wants to pair</h2>
        <p>Type this code on {request.deviceName}:</p>
        <p className="pair-code" aria-live="polite">
          {request.code.slice(0, 3)} {request.code.slice(3)}
        </p>
        <p className="hint">Only pair with computers you know. Close this to refuse. The code is good for 2 minutes and one try.</p>
        <footer className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}

/** The Send to menu for a right-clicked item. */
function SendMenu() {
  const menu = useSharingStore((s) => s.sendMenu)
  const peers = useSharingStore((s) => s.peers)
  const enabled = useSharingStore((s) => s.status?.enabled ?? false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) useSharingStore.setState({ sendMenu: null })
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  if (!menu) return null
  const online = peers.filter((p) => p.online && !p.disconnected)
  const choose = (peer: SharePeer) => {
    useSharingStore.setState({ sendMenu: null })
    sendTo(peer, menu.sources).catch(console.error)
  }
  const chooseCue = (peer: SharePeer) => {
    useSharingStore.setState({ sendMenu: null })
    if (menu.cue) sendCueTo(peer, menu.cue).catch(console.error)
  }
  const devices = (onChoose: (peer: SharePeer) => void) =>
    online.map((peer) => (
      <button key={peer.id} type="button" role="menuitem" onClick={() => onChoose(peer)}>
        <Laptop size={15} aria-hidden="true" />
        <span>{peer.name}</span>
        {peer.paired ? <Lock size={12} aria-label="Paired" /> : <span className="hint">pair first</span>}
      </button>
    ))
  return (
    <div
      ref={ref}
      className="live-menu-list send-menu"
      role="menu"
      aria-label="Send to"
      style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 200) }}
    >
      <div className="send-menu-title">
        <Send size={13} aria-hidden="true" /> {menu.cue ? 'Send to device' : 'Send to'}
      </div>
      {!enabled ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            useSharingStore.setState({ sendMenu: null })
            useOperatorStore.getState().openSettings(true)
          }}
        >
          <span>Turn on Sharing in Settings…</span>
        </button>
      ) : online.length === 0 ? (
        <span className="send-menu-empty">No other ServiceEx computers found on this network</span>
      ) : menu.cue && menu.sources.length > 0 ? (
        <>
          <div className="send-menu-group">
            <BellRing size={12} aria-hidden="true" /> As a cue, to their tray
          </div>
          {devices(chooseCue)}
          <div className="send-menu-group">
            <Copy size={12} aria-hidden="true" /> A copy, to their Inbox
          </div>
          {devices(choose)}
        </>
      ) : (
        devices(menu.cue ? chooseCue : choose)
      )}
    </div>
  )
}

/** The toolbar's sharing controls: device chips, the Inbox, transfers, and the pairing and Send to popups. */
export function SharingBar() {
  const enabled = useSharingStore((s) => s.status?.enabled ?? false)
  const peers = useSharingStore((s) => s.peers)
  const inboxCount = useSharingStore((s) => s.inbox.length)
  const unseen = useSharingStore((s) => s.unseen)
  const inboxOpen = useSharingStore((s) => s.inboxOpen)
  const transfers = useSharingStore((s) => s.transfers)
  const message = useSharingStore((s) => s.message)
  const chips = useOperatorStore((s) => s.settings.sharingDeviceChips)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => startSharing(), [])

  // Status messages clear themselves; errors stay a little longer.
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => useSharingStore.setState({ message: null }), message.error ? 12000 : 5000)
    return () => clearTimeout(timer)
  }, [message])

  useEffect(() => {
    if (!inboxOpen) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      // Dialogs opened from the Inbox (conflicts) are outside it but belong to it.
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.modal-backdrop')) {
        useSharingStore.setState({ inboxOpen: false })
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [inboxOpen])

  const shown = peers.filter((p) => p.online || p.paired)

  return (
    <>
      {enabled && chips && (
        <div className="device-bar" role="group" aria-label="Computers on the local network">
          <Wifi size={14} className="device-bar-icon" aria-label="Local network sharing is on" />
          {shown.length === 0 ? (
            <span className="device-bar-empty" title="Other computers appear here when ServiceEx is open with Sharing on, on the same network">
              No devices found
            </span>
          ) : (
            shown.map((peer) => <DeviceChip key={peer.id} peer={peer} />)
          )}
        </div>
      )}
      {transfers.map((t) => (
        <TransferChip key={t.id} transfer={t} />
      ))}
      {message && (
        <span className={`sharing-message${message.error ? ' error' : ''}`} role={message.error ? 'alert' : 'status'} title={message.text}>
          {message.text}
        </span>
      )}
      {(enabled || inboxCount > 0) && (
        <div className="alerts-control" ref={ref}>
          <button
            type="button"
            className={`icon-button toolbar-icon${inboxOpen ? ' active' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={inboxOpen}
            aria-label={`Inbox, ${inboxCount} item${inboxCount === 1 ? '' : 's'}`}
            title="Inbox: items received from other computers"
            onClick={() => useSharingStore.setState({ inboxOpen: !inboxOpen, unseen: 0 })}
          >
            <InboxIcon size={18} />
            {inboxCount > 0 && <span className={`inbox-badge${unseen > 0 ? ' new' : ''}`}>{inboxCount}</span>}
          </button>
          {inboxOpen && <InboxPanel />}
        </div>
      )}
      <CueTray />
      <PairDialog />
      <PairCode />
      <SendMenu />
    </>
  )
}
