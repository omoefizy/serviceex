// Local network sharing in the operator window: devices, the Inbox, transfers and pairing, kept apart from the
// operator store since none of it touches what is on screen. Received items never go live.

import type { DragEvent } from 'react'
import { create } from 'zustand'
import { shareKindOf } from '../../shared/sharing'
import type { AcceptResult, InboxItem, PairRequest, SharePeer, ShareSource, SharingEvent, SharingStatus, TransferProgress } from '../../shared/types'
import { useOperatorStore } from '../store'

/** Drag data for library and schedule items that can be dropped on a device chip. */
export const SHARE_DRAG_TYPE = 'application/x-serviceex-share'

/** Fired on window when a service was added, so the schedule's service list reloads. */
export const SERVICES_CHANGED_EVENT = 'serviceex:services-changed'

interface SenderPairing {
  peerId: string
  peerName: string
  /** Null until the other computer has shown its code. */
  pairingId: string | null
  busy: boolean
  error: string | null
  /** Items to send once paired, when pairing started from a drop or Send to. */
  pending: ShareSource[]
}

interface SharingState {
  status: SharingStatus | null
  peers: SharePeer[]
  inbox: InboxItem[]
  transfers: TransferProgress[]
  /** The code to show while another computer pairs with this one. */
  pairRequest: PairRequest | null
  /** This computer pairing with another. */
  pairing: SenderPairing | null
  inboxOpen: boolean
  /** Items that arrived since the Inbox was last opened. */
  unseen: number
  /** The Send to menu, at the pointer. */
  sendMenu: { x: number; y: number; sources: ShareSource[] } | null
  /** A short message for the device bar: what went wrong, or what happened. */
  message: { text: string; error: boolean } | null
}

export const useSharingStore = create<SharingState>(() => ({
  status: null,
  peers: [],
  inbox: [],
  transfers: [],
  pairRequest: null,
  pairing: null,
  inboxOpen: false,
  unseen: 0,
  sendMenu: null,
  message: null,
}))

const set = useSharingStore.setState
const get = useSharingStore.getState

export const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')

export function showMessage(text: string, error = false): void {
  set({ message: { text, error } })
}

/** Reloads the views a received item changed, imports its presentations and shows what happened. */
export async function applyAcceptResult(result: Extract<AcceptResult, { status: 'done' }>): Promise<void> {
  const st = useOperatorStore.getState()
  if (result.changed.includes('songs')) st.songsChanged()
  if (result.changed.includes('media')) st.mediaChanged()
  if (result.changed.includes('themes')) await st.loadThemes()
  if (result.changed.includes('services')) window.dispatchEvent(new Event(SERVICES_CHANGED_EVENT))
  // Only the schedule list is refreshed; nothing is loaded into the preview or sent live.
  if (result.changed.includes('schedule') && st.service) await st.openService(st.service.id)
  if (result.presentations.length > 0) {
    await st.importPresentations(result.presentations.map((p) => p.path))
    for (const { replaceId } of result.presentations) if (replaceId !== null) await window.api.presentations.delete(replaceId)
    await st.loadPresentations()
  }
}

function onEvent(event: SharingEvent): void {
  switch (event.type) {
    case 'status':
      set({ status: event.status })
      break
    case 'peers':
      set({ peers: event.peers })
      break
    case 'inbox':
      set((s) => ({ inbox: event.items, unseen: event.arrived && !s.inboxOpen ? s.unseen + 1 : s.unseen }))
      break
    case 'progress': {
      const { transfer } = event
      set((s) => ({ transfers: [...s.transfers.filter((t) => t.id !== transfer.id), transfer] }))
      // Finished transfers leave the bar after a moment.
      if (transfer.state === 'done') setTimeout(() => set((s) => ({ transfers: s.transfers.filter((t) => t.id !== transfer.id) })), 4000)
      break
    }
    case 'pairRequest':
      set({ pairRequest: event.request })
      break
    case 'pairEnded':
      if (get().pairRequest?.pairingId === event.pairingId) set({ pairRequest: null })
      if (event.paired) showMessage('Paired.')
      break
    case 'accepted':
      applyAcceptResult(event.result).catch(console.error)
      showMessage(`From ${event.item.senderName}: ${event.result.message}`)
      break
  }
}

/** Loads the current state and listens for changes. Returns a function that stops listening. */
export function startSharing(): () => void {
  const api = window.api.sharing
  api.status().then((status) => set({ status }), console.error)
  api.peers().then((peers) => set({ peers }), console.error)
  api.inbox().then((inbox) => set({ inbox }), console.error)
  return api.onEvent(onEvent)
}

/** Marks an item draggable onto a device chip, alongside whatever else the drag carries. */
export function setShareDrag(e: DragEvent, source: ShareSource): void {
  e.dataTransfer.setData(SHARE_DRAG_TYPE, JSON.stringify(source))
  if (e.dataTransfer.effectAllowed === 'uninitialized' || e.dataTransfer.effectAllowed === 'none') e.dataTransfer.effectAllowed = 'copy'
  else if (e.dataTransfer.effectAllowed === 'move') e.dataTransfer.effectAllowed = 'copyMove'
}

/** Opens the Send to menu at the pointer, for a right click on an item. */
export function openSendMenu(e: { clientX: number; clientY: number; preventDefault(): void }, sources: ShareSource[]): void {
  e.preventDefault()
  set({ sendMenu: { x: e.clientX, y: e.clientY, sources } })
}

/** Starts pairing with a device; the code goes in the dialog that opens. */
export async function beginPairing(peer: SharePeer, pending: ShareSource[] = []): Promise<void> {
  set({ pairing: { peerId: peer.id, peerName: peer.name, pairingId: null, busy: true, error: null, pending } })
  try {
    const { pairingId } = await window.api.sharing.startPairing(peer.id)
    set((s) => (s.pairing?.peerId === peer.id ? { pairing: { ...s.pairing, pairingId, busy: false } } : {}))
  } catch (error) {
    set((s) => (s.pairing?.peerId === peer.id ? { pairing: { ...s.pairing, busy: false, error: errorText(error) } } : {}))
  }
}

/** Sends items to a device, pairing with it first when needed. */
export async function sendTo(peer: SharePeer, sources: ShareSource[]): Promise<void> {
  if (sources.length === 0) return
  if (!peer.paired) {
    await beginPairing(peer, sources)
    return
  }
  try {
    await window.api.sharing.send(peer.id, sources)
  } catch (error) {
    showMessage(errorText(error), true)
  }
}

/** The items a drop on a device chip carries: files from outside, or a library or schedule item. */
export function droppedSources(e: DragEvent): { sources: ShareSource[]; refused: string[] } {
  const item = e.dataTransfer.getData(SHARE_DRAG_TYPE)
  if (item) {
    try {
      return { sources: [JSON.parse(item) as ShareSource], refused: [] }
    } catch {
      return { sources: [], refused: [] }
    }
  }
  const sources: ShareSource[] = []
  const refused: string[] = []
  for (const file of e.dataTransfer.files) {
    const path = window.api.sharing.pathForFile(file)
    if (path && shareKindOf(file.name)) sources.push({ type: 'file', path })
    else refused.push(file.name)
  }
  return { sources, refused }
}

/** Whether a drag can be dropped on a device chip. */
export const canDropOnDevice = (e: DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(SHARE_DRAG_TYPE)
