// Local network sharing in the operator window: devices, the Inbox, transfers and pairing, kept apart from the
// operator store since none of it touches what is on screen. Received items never go live.

import type { DragEvent } from 'react'
import { create } from 'zustand'
import { hasFeature } from '../../shared/features'
import { layoutById } from '../../shared/layouts'
import { shareKindOf } from '../../shared/sharing'
import type {
  AcceptResult,
  Cue,
  CueDraft,
  InboxItem,
  ItemFilter,
  LibrarySyncStatus,
  PairRequest,
  ServiceItem,
  ServiceItemPayload,
  ServiceItemType,
  SharedItem,
  SharedItemInput,
  SharedNotePayload,
  SharedServiceState,
  SharedSongPayload,
  SharePeer,
  ShareSource,
  SharingEvent,
  SharingStatus,
  TransferProgress,
} from '../../shared/types'
import { setScheduleTarget, useOperatorStore } from '../store'

/** Drag data for library and schedule items that can be dropped on a device chip. */
export const SHARE_DRAG_TYPE = 'application/x-serviceex-share'

/** Drag data for a shared service item: dropped on a device chip, it tags the item with that device. */
export const SHARED_ITEM_DRAG_TYPE = 'application/x-serviceex-shared-item'

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
  /** The Send to menu, at the pointer: files and items to copy, a cue for the tray, or both. */
  sendMenu: { x: number; y: number; sources: ShareSource[]; cue?: CueDraft } | null
  /** A short message for the device bar: what went wrong, or what happened. */
  message: { text: string; error: boolean } | null
  /** Cues received, newest first. None of them is live. */
  cues: Cue[]
  cueTrayOpen: boolean
  unseenCues: number
  /** Set when a cue arrives with the flash alert on, so the tray button flashes. */
  cueFlash: number
  shared: SharedServiceState | null
  /** Which shared service items the schedule lists here. */
  itemFilter: ItemFilter
  library: LibrarySyncStatus | null
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
  cues: [],
  cueTrayOpen: false,
  unseenCues: 0,
  cueFlash: 0,
  shared: null,
  itemFilter: { kind: 'all' },
  library: null,
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
    case 'cues':
      // Only the tray changes: a cue never touches the preview or the output.
      set((s) => ({ cues: event.cues, unseenCues: event.arrived && !s.cueTrayOpen ? s.unseenCues + 1 : s.unseenCues }))
      if (event.arrived) cueAlert()
      break
    case 'sharedService':
      set({ shared: event.state })
      break
    case 'library':
      set({ library: event.status })
      break
    case 'librarySaved': {
      const st = useOperatorStore.getState()
      if (event.changed.includes('songs')) st.songsChanged()
      if (event.changed.includes('media')) st.mediaChanged()
      if (event.changed.includes('themes')) st.loadThemes().catch(console.error)
      if (event.presentations.length > 0) {
        st.importPresentations(event.presentations)
          .then(() => st.loadPresentations())
          .catch(console.error)
      }
      break
    }
  }
}

/** The attention a new cue gets, as set in Settings: none (the default), a short tone, or a flash of the tray button. */
function cueAlert(): void {
  const alert = useOperatorStore.getState().settings.sharingCueAlert
  if (alert === 'flash') set({ cueFlash: Date.now() })
  if (alert !== 'sound') return
  try {
    const context = new AudioContext()
    const tone = context.createOscillator()
    const gain = context.createGain()
    tone.frequency.value = 880
    gain.gain.setValueAtTime(0.15, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4)
    tone.connect(gain).connect(context.destination)
    tone.start()
    tone.stop(context.currentTime + 0.4)
    tone.onended = () => context.close().catch(() => {})
  } catch {
    // No audio output: the tray badge is enough.
  }
}

/** Loads the current state and listens for changes. Returns a function that stops listening. */
export function startSharing(): () => void {
  const api = window.api.sharing
  api.status().then((status) => set({ status }), console.error)
  api.peers().then((peers) => set({ peers }), console.error)
  api.inbox().then((inbox) => set({ inbox }), console.error)
  api.cues().then((cues) => set({ cues }), console.error)
  api.sharedService().then((shared) => set({ shared }), console.error)
  api.librarySync().then((library) => set({ library }), console.error)
  const settings = useOperatorStore.getState().settings
  set({ itemFilter: layoutById(settings.layouts, settings.activeLayoutId).itemFilter === 'mine' ? { kind: 'mine' } : { kind: 'all' } })
  setScheduleTarget(addToShared)
  const off = api.onEvent(onEvent)
  return () => {
    setScheduleTarget(null)
    off()
  }
}

// ---------- Cues ----------

/** Sends a cue to a paired device's tray. */
export async function sendCueTo(peer: SharePeer, cue: CueDraft): Promise<void> {
  if (!peer.paired) {
    await beginPairing(peer)
    showMessage(`Pair with ${peer.name} first, then send the cue again.`)
    return
  }
  try {
    await window.api.sharing.sendCue(peer.id, cue)
    showMessage(`Sent to ${peer.name}.`)
  } catch (error) {
    showMessage(errorText(error), true)
  }
}

/** Opens the Send to device menu for a cue at the pointer or under a button; `sources` adds Send a copy. */
export function openCueMenu(e: { clientX: number; clientY: number; preventDefault(): void }, cue: CueDraft, sources: ShareSource[] = []): void {
  e.preventDefault()
  set({ sendMenu: { x: e.clientX, y: e.clientY, sources, cue } })
}

/** Right-click on a song: send it as a cue with its words, or a copy of it to the other computer's Inbox. */
export function openSongMenu(e: { clientX: number; clientY: number; preventDefault(): void }, songId: number): void {
  e.preventDefault()
  const at = { clientX: e.clientX, clientY: e.clientY, preventDefault() {} }
  const sources: ShareSource[] = [{ type: 'song', id: songId }]
  if (!hasFeature('sharing.send')) return openSendMenu(at, sources)
  window.api.songs.get(songId).then((song) => {
    if (!song) return openSendMenu(at, sources)
    const payload: SharedSongPayload = { title: song.title, author: song.author, copyright: song.copyright, lyrics: song.lyrics, arrangement: song.arrangement }
    openCueMenu(at, { kind: 'song', title: song.title, text: song.lyrics, song: payload }, sources)
  }, console.error)
}

/** Whether Send to device is shown at all. */
export const canSendCues = () => hasFeature('sharing.send') && (get().status?.enabled ?? false)

/** A cue's slides for the grid. */
const cueVerses = (cue: Cue) => (cue.verses && cue.verses.length > 0 ? cue.verses : [{ text: cue.text, caption: cue.title }])

async function localSongId(title: string): Promise<number | null> {
  const same = (await window.api.songs.list(title)).find((song) => song.title.trim().toLowerCase() === title.trim().toLowerCase())
  return same?.id ?? null
}

/** Shows a cue in the grid and preview, or for a point in the lower third draft. It never goes live. */
export async function previewCue(cue: Cue): Promise<void> {
  const st = useOperatorStore.getState()
  st.showGrid()
  switch (cue.kind) {
    case 'verse':
      st.selectScripture(cue.title, cueVerses(cue))
      return
    case 'song': {
      const id = await localSongId(cue.song?.title ?? cue.title)
      const song = id === null ? null : ((await window.api.songs.get(id)) ?? null)
      if (song) st.selectSong(song)
      else st.selectScripture(cue.title, [{ text: cue.song?.lyrics || cue.text, caption: cue.title }])
      return
    }
    case 'point':
      st.setLowerThirdDraft({ headline: cue.text || cue.title, body: '' })
      return
    case 'note':
    case 'text':
      st.selectQuote(cue.text || cue.title, '')
  }
}

/** Adds a cue to the schedule (the shared service when one is open) and takes it out of the tray. */
export async function addCueToSchedule(cue: Cue): Promise<void> {
  const st = useOperatorStore.getState()
  if (cue.kind === 'verse') await st.addToSchedule('scripture', null, { title: cue.title, verses: cueVerses(cue) })
  else if (cue.kind === 'song') {
    const id = await localSongId(cue.song?.title ?? cue.title)
    if (id !== null) await st.addToSchedule('song', id, null)
    else if (cue.song) {
      // Not in this library: added to it with its words, like an imported song.
      const song = await window.api.songs.create({ ...cue.song, tags: [], themeId: null })
      st.songsChanged()
      await st.addToSchedule('song', song.id, null)
    } else await st.addToSchedule('announcement', null, { title: cue.title, body: cue.text })
  } else await st.addToSchedule('announcement', null, { title: cue.title, body: cue.text })
  set({ cues: await window.api.sharing.dismissCue(cue.id) })
}

// ---------- Shared service ----------

export const inSharedService = () => (get().shared?.role ?? 'none') !== 'none'

/** A schedule item as shared: songs carry their words so any computer can show them. */
export async function sharedInput(type: ServiceItemType, refId: number | null, payload: ServiceItemPayload | null): Promise<SharedItemInput | null> {
  if (type === 'song') {
    const song = refId === null ? undefined : await window.api.songs.get(refId)
    if (!song) return null
    const shared: SharedSongPayload = { title: song.title, author: song.author, copyright: song.copyright, lyrics: song.lyrics, arrangement: song.arrangement }
    return { type, payload: shared }
  }
  return payload ? { type, payload } : null
}

/** Who a new item belongs to: the device the list is filtered to, else nobody in particular. */
function newOwner(): string | null {
  const filter = get().itemFilter
  return filter.kind === 'mine' ? (get().status?.deviceId ?? null) : filter.kind === 'device' ? filter.deviceId : null
}

/** The store's Add to schedule while a shared service is open. */
async function addToShared(type: ServiceItemType, refId: number | null, payload: ServiceItemPayload | null): Promise<boolean> {
  if (!inSharedService()) return false
  const input = await sharedInput(type, refId, payload)
  if (!input) throw new Error('That item could not be added to the shared service')
  set({ shared: await window.api.sharing.addSharedItems([{ ...input, ownerDevice: newOwner() }]) })
  return true
}

/** Hosts a shared service starting with the open service's items. */
export async function hostOpenService(): Promise<void> {
  const service = useOperatorStore.getState().service
  const inputs: SharedItemInput[] = []
  for (const item of service?.items ?? []) {
    const input = await sharedInput(item.type, item.ref_id, item.payload)
    if (input) inputs.push(input)
  }
  set({ shared: await window.api.sharing.hostService(service?.name ?? 'Shared service', inputs) })
}

/** Shared items get negative numbers in the operator store, so they never clash with saved schedule items. */
const numericIds = new Map<string, number>()
export function sharedNumericId(id: string): number {
  let n = numericIds.get(id)
  if (n === undefined) {
    n = -(numericIds.size + 1)
    numericIds.set(id, n)
  }
  return n
}

/** A shared item as a schedule item this computer can load: songs from the library when it has them. */
export async function toServiceItem(item: SharedItem): Promise<ServiceItem> {
  const fields = { id: sharedNumericId(item.id), service_id: -1, order: item.order, title: item.payload.title }
  switch (item.type) {
    case 'song': {
      const song = item.payload as SharedSongPayload
      const id = await localSongId(song.title)
      if (id !== null) return { ...fields, type: 'song', ref_id: id, payload: null }
      return { ...fields, type: 'announcement', ref_id: null, payload: { title: song.title, body: song.lyrics } }
    }
    case 'note':
      return { ...fields, type: 'announcement', ref_id: null, payload: { title: item.payload.title, body: (item.payload as SharedNotePayload).text } }
    case 'scripture':
    case 'announcement':
    case 'presentation':
      return { ...fields, type: item.type, ref_id: null, payload: item.payload } as ServiceItem
  }
}

/** Loads a shared item into the grid and preview, as clicking a schedule item does. Nothing goes live. */
export async function loadSharedItem(item: SharedItem): Promise<boolean> {
  return useOperatorStore.getState().loadItem(await toServiceItem(item))
}

export async function updateShared(id: string, patch: Parameters<typeof window.api.sharing.updateSharedItem>[1]): Promise<void> {
  try {
    set({ shared: await window.api.sharing.updateSharedItem(id, patch) })
  } catch (error) {
    showMessage(errorText(error), true)
  }
}

/** The name to show for a device id: this computer, a paired one, or one the shared service knows. */
export function deviceLabel(id: string | null): string {
  if (!id) return 'Anyone'
  const s = get()
  if (id === s.status?.deviceId) return 'This computer'
  return s.peers.find((p) => p.id === id)?.name ?? s.shared?.names[id] ?? 'Another computer'
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
