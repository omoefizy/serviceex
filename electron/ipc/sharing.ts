// Local network sharing between ServiceEx computers: discovery, pairing, sending and the Inbox. Off until it is
// turned on in Settings; while off nothing listens and nothing is announced. Received items wait in the Inbox and
// never go live by themselves.

import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cleanCue, MAX_CUES } from '../../shared/cues'
import { hasFeature, requireFeature } from '../../shared/features'
import { formatBytes, safeFileName, shareProblem } from '../../shared/sharing'
import type {
  AcceptResult,
  AppSettings,
  ConflictChoice,
  Cue,
  InboxItem,
  LibrarySyncFile,
  LibrarySyncStatus,
  PairedDevice,
  SharedItemInput,
  SharedItemPatch,
  SharePeer,
  ShareSource,
  SharingEvent,
  SharingStatus,
  TransferProgress,
} from '../../shared/types'
import { getAppSettings } from '../db/settings'
import { getService } from '../db/services'
import { setInboxResolver } from '../media'
import { encryptionAvailable } from '../secrets'
import { completePairing, hello, ping, RefusedError, requestPairing, secureRequest, sendFile, TROUBLESHOOTING, type Endpoint, type PeerTarget } from '../sharing/client'
import { randomId } from '../sharing/crypto'
import { Discovery } from '../sharing/discovery'
import { Inbox } from '../sharing/inbox'
import { acceptItem, buildPackage, canAutoAccept, conflictsOf, mediaSource, presentationSource, previewItem, type PackageSelection } from '../sharing/library'
import { cleanEntries, fetchEntry, LARGE_BYTES, planFetch, readEntry, type IndexedEntry } from '../sharing/librarySync'
import { libraryIndex, saveEntry } from '../sharing/libraryStore'
import { readPackage } from '../sharing/package'
import { PeerStore } from '../sharing/peers'
import { ID_PATTERN, type PresenceInfo, type SecureOp, type SecureOps } from '../sharing/protocol'
import { ShareServer } from '../sharing/server'
import { SharedServiceSession } from '../sharing/sharedService'

/** Tried first so firewall rules and remembered addresses keep working; any free port if it is taken. */
const PREFERRED_PORT = 47820
const MAX_SOURCES = 200
/** Presence goes out about once a second; a device not heard from for this long shows offline. */
const PRESENCE_MS = 1000
const PRESENCE_STALE_MS = 3500
/** Library sync runs on its own this often while it is on, besides Sync now. */
const LIBRARY_SYNC_MS = 5 * 60 * 1000

interface Transfer {
  progress: TransferProgress
  peerId: string
  file: string
  name: string
  /** A package written for this transfer, deleted once it has gone. */
  temp: string | null
}

/** Arguments arrive from the renderer, so check their shape. */
function assertId(value: unknown, what = 'Device id'): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`${what} must be 32 hex characters`)
  return value
}

function assertSources(value: unknown): ShareSource[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SOURCES) throw new TypeError(`Send 1 to ${MAX_SOURCES} items`)
  return value.map((source) => {
    const s = source as Partial<Record<string, unknown>> | null
    const positive = (v: unknown) => Number.isInteger(v) && (v as number) > 0
    if (s?.type === 'file' && typeof s.path === 'string' && path.isAbsolute(s.path)) return { type: 'file', path: s.path }
    if (s?.type === 'announcement' && positive(s.itemId)) return { type: 'announcement', itemId: s.itemId as number }
    if ((s?.type === 'song' || s?.type === 'service' || s?.type === 'theme' || s?.type === 'media' || s?.type === 'presentation') && positive(s.id)) {
      return { type: s.type, id: s.id as number }
    }
    throw new TypeError('Unknown item to send')
  })
}

function assertChoices(value: unknown): Record<string, ConflictChoice> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Choices must be an object')
  const choices: Record<string, ConflictChoice> = {}
  for (const [key, choice] of Object.entries(value)) {
    if (key.length > 64 || (choice !== 'replace' && choice !== 'keepBoth' && choice !== 'skip')) throw new TypeError('Each choice is replace, keepBoth or skip')
    choices[key] = choice
  }
  return choices
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The computer's own name, as other computers see it when none is set. */
const computerName = () => os.hostname().replace(/\.local$/i, '').slice(0, 40) || 'ServiceEx'

export interface SharingHandle {
  settingsChanged(before: AppSettings, after: AppSettings): void
  stop(): Promise<void>
}

export function registerSharingIpc(getOperatorWindow: () => BrowserWindow | null): SharingHandle {
  const folder = path.join(app.getPath('userData'), 'sharing')
  // Shared keys are kept encrypted like the API keys (see secrets.ts).
  const peers = new PeerStore(folder, {
    encrypt(plain) {
      if (!encryptionAvailable()) throw new Error('This system cannot store the pairing key securely')
      return safeStorage.encryptString(plain.toString('base64'))
    },
    decrypt: (sealed) => Buffer.from(safeStorage.decryptString(sealed), 'base64'),
  })
  const inbox = new Inbox(path.join(folder, 'inbox'))
  setInboxResolver((id) => {
    const item = inbox.get(id)
    return item ? inbox.filePath(item) : null
  })

  const transfers = new Map<string, Transfer>()
  /** Pairings this computer started, waiting for the code. */
  const pairings = new Map<string, { peerId: string; name: string; endpoint: Endpoint }>()
  let startError: string | null = null
  let queue: Promise<void> = Promise.resolve()

  const deviceName = () => getAppSettings().sharingDeviceName || computerName()

  const emit = (event: SharingEvent) => {
    const win = getOperatorWindow()
    if (win && !win.isDestroyed()) win.webContents.send('sharing:event', event)
  }

  /** A system notification that does not take focus. */
  const notify = (title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  }

  function peerList(): SharePeer[] {
    const list = new Map<string, SharePeer>()
    const now = Date.now()
    for (const device of peers.list()) {
      const heard = presence.get(device.id)
      const fresh = !device.disconnected && !!heard && now - heard.seenAt < PRESENCE_STALE_MS
      list.set(device.id, {
        id: device.id,
        name: device.alias || device.name,
        online: fresh,
        paired: true,
        trusted: device.trusted,
        disconnected: device.disconnected,
        liveTitle: fresh ? heard.liveTitle : null,
        hosting: fresh ? heard.hosting : null,
      })
    }
    for (const found of discovery.list()) {
      const paired = list.get(found.id)
      const device = peers.get(found.id)
      list.set(found.id, paired ? { ...paired, name: device?.alias || found.name, online: true } : { id: found.id, name: found.name, online: true, paired: false, trusted: false, disconnected: false, liveTitle: null, hosting: null })
      // Remember the latest name and address of paired devices.
      if (paired) peers.update(found.id, { name: found.name, host: found.host, port: found.port }).catch(console.error)
    }
    return [...list.values()].sort((a, b) => Number(b.paired) - Number(a.paired) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  }

  const discovery = new Discovery(() => emit({ type: 'peers', peers: peerList() }))

  // ---------- Presence, cues, the shared service and library sync ----------

  /** What each paired device last said about itself. */
  const presence = new Map<string, PresenceInfo & { seenAt: number }>()
  /** What this computer has live, from the renderer. */
  let live: { title: string | null; slideLive: boolean } = { title: null, slideLive: false }
  let cues: Cue[] = []

  const nameOf = (id: string) => {
    const device = peers.get(id)
    return device ? device.alias || device.name : 'Another computer'
  }

  const myPresence = (): PresenceInfo => ({
    liveTitle: hasFeature('sharing.presence') && getAppSettings().sharingDeviceChips ? live.title : null,
    hosting: hasFeature('sharing.sharedService') ? session.hosting() : null,
  })

  const cleanPresence = (value: Record<string, unknown>): PresenceInfo => {
    const hosting = value.hosting as Partial<{ id: unknown; name: unknown }> | null
    return {
      liveTitle: typeof value.liveTitle === 'string' ? value.liveTitle.slice(0, 200) : null,
      hosting:
        hosting && typeof hosting.id === 'string' && ID_PATTERN.test(hosting.id) && typeof hosting.name === 'string' ? { id: hosting.id, name: hosting.name.slice(0, 120) } : null,
    }
  }

  /** A sealed request to a paired device that is not disconnected; resolves to its answer or throws its error. */
  async function call<Op extends SecureOp>(peerId: string, op: Op, fields: SecureOps[Op]['request'], timeoutMs?: number): Promise<SecureOps[Op]['response']> {
    const device = peers.get(peerId)
    if (device?.disconnected) throw new RefusedError(`${nameOf(peerId)} is disconnected. Connect it again in Settings, Devices.`)
    const answer = await secureRequest(target(peerId), peers.deviceId, op, fields, undefined, timeoutMs)
    if (!answer.ok) throw new RefusedError(answer.error)
    return answer
  }

  const session = new SharedServiceSession({
    file: path.join(folder, 'shared-service.json'),
    deviceId: peers.deviceId,
    deviceName,
    transport: {
      join: (hostId) => call(hostId, 'serviceJoin', {}, 10_000),
      sync: (hostId, request) => call(hostId, 'serviceSync', request, 5_000),
    },
    onChange: (state) => emit({ type: 'sharedService', state }),
  })

  let lastPeers = ''
  const inFlight = new Set<string>()
  let presenceTimer: NodeJS.Timeout | null = null

  function presenceTick(): void {
    for (const device of peers.list()) {
      if (device.disconnected || inFlight.has(device.id)) continue
      let to: PeerTarget
      try {
        to = target(device.id)
      } catch {
        continue
      }
      inFlight.add(device.id)
      secureRequest(to, peers.deviceId, 'presence', myPresence(), undefined, 1500)
        .then((answer) => {
          if (answer.ok) presence.set(device.id, { ...cleanPresence(answer as unknown as Record<string, unknown>), seenAt: Date.now() })
        })
        .catch(() => {})
        .finally(() => inFlight.delete(device.id))
    }
    // The chips change every second at most: titles, and devices going offline.
    const list = peerList()
    const json = JSON.stringify(list)
    if (json !== lastPeers) {
      lastPeers = json
      emit({ type: 'peers', peers: list })
    }
  }

  // Library sync.
  let library: LibrarySyncStatus = { enabled: false, running: false, paused: null, files: [], lastRunAt: null, error: null }
  let served: { at: number; entries: Map<string, IndexedEntry> } | null = null
  let libraryTimer: NodeJS.Timeout | null = null
  let lastLibraryEmit = 0
  let libraryStop = false

  const pauseReason = () => (live.slideLive ? 'Waiting while a slide is live' : null)
  const libraryOn = () => getAppSettings().sharingEnabled && getAppSettings().sharingLibrarySync && hasFeature('sharing.librarySync')

  function emitLibrary(force = true): void {
    library = { ...library, enabled: libraryOn(), paused: library.running ? pauseReason() : null }
    if (!force && Date.now() - lastLibraryEmit < 250) return
    lastLibraryEmit = Date.now()
    emit({ type: 'library', status: library })
  }

  /** This computer's index for other computers, kept for half a minute so chunk requests find their entry. */
  async function servedIndex(): Promise<Map<string, IndexedEntry>> {
    if (!served || Date.now() - served.at > 30_000) served = { at: Date.now(), entries: new Map((await libraryIndex()).map((e) => [e.sha256, e])) }
    return served.entries
  }

  async function runLibrarySync(): Promise<void> {
    if (library.running || !libraryOn()) return
    libraryStop = false
    library = { ...library, running: true, files: [], error: null }
    emitLibrary()
    const changed = new Set<'songs' | 'themes' | 'media' | 'fonts'>()
    const presentations: string[] = []
    const problems: string[] = []
    try {
      const local = await libraryIndex()
      const remotes: { peerId: string; peerName: string; entries: ReturnType<typeof cleanEntries> }[] = []
      for (const peer of peerList().filter((p) => p.paired && p.online && !p.disconnected)) {
        try {
          const answer = await call(peer.id, 'libraryIndex', {}, 30_000)
          remotes.push({ peerId: peer.id, peerName: peer.name, entries: cleanEntries(answer.entries) })
        } catch (error) {
          problems.push(`${peer.name}: ${errorText(error)}`)
        }
      }
      library = { ...library, files: planFetch(local, remotes) }
      emitLibrary()
      const temp = await mkdtemp(path.join(os.tmpdir(), 'serviceex-sync-'))
      try {
        for (const file of library.files) {
          if (libraryStop) break
          const update = (patch: Partial<LibrarySyncFile>, force = true) => {
            library = { ...library, files: library.files.map((f) => (f.sha256 === file.sha256 ? { ...f, ...patch } : f)) }
            emitLibrary(force)
          }
          update({ state: 'transferring' })
          const dest = path.join(temp, file.sha256)
          try {
            await fetchEntry(target(file.peerId), peers.deviceId, file, dest, {
              bandwidthKbps: () => getAppSettings().sharingBandwidthKbps,
              pauseReason,
              cancelled: () => libraryStop || !libraryOn(),
              onProgress: (received) => update({ received }, false),
            })
            const saved = await saveEntry(file.kind, file.name, dest)
            if (saved.changed) changed.add(saved.changed)
            if (saved.presentation) presentations.push(saved.presentation)
            update({ state: 'done', received: file.size })
          } catch (error) {
            update({ state: 'failed', error: errorText(error) })
          } finally {
            await rm(dest, { force: true })
          }
        }
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
    } catch (error) {
      problems.push(errorText(error))
    }
    served = null
    library = { ...library, running: false, lastRunAt: new Date().toISOString(), error: problems.length > 0 ? problems.join(' ') : null }
    emitLibrary()
    if (changed.size > 0 || presentations.length > 0) emit({ type: 'librarySaved', presentations, changed: [...changed] })
  }

  function scheduleLibrarySync(): void {
    if (libraryTimer) clearInterval(libraryTimer)
    libraryTimer = null
    libraryStop = !libraryOn()
    emitLibrary()
    if (!libraryOn()) return
    libraryTimer = setInterval(() => runLibrarySync().catch(console.error), LIBRARY_SYNC_MS)
    // A first run once the other computers have had a moment to be found.
    setTimeout(() => runLibrarySync().catch(console.error), 10_000)
  }

  /** Answers the sealed requests for presence, cues, the shared service and library sync. */
  async function handleSecure(op: string, from: { id: string; name: string }, header: Record<string, unknown>): Promise<object> {
    const off = (error: string) => ({ ok: false, error, code: 'off' as const })
    switch (op) {
      case 'presence':
        presence.set(from.id, { ...cleanPresence(header), seenAt: Date.now() })
        return { ok: true, ...myPresence() }
      case 'cue': {
        if (!hasFeature('sharing.send')) return off(`Cues are not available on ${deviceName()}`)
        const draft = cleanCue(header.cue)
        if (!draft) return { ok: false, error: 'That cue is empty or not valid', code: 'bad' }
        const cue: Cue = { ...draft, id: randomId(), fromId: from.id, fromName: nameOf(from.id), receivedAt: new Date().toISOString() }
        cues = [cue, ...cues].slice(0, MAX_CUES)
        emit({ type: 'cues', cues, arrived: cue })
        return { ok: true, received: true }
      }
      case 'serviceJoin':
      case 'serviceSync': {
        if (!hasFeature('sharing.sharedService')) return off(`Shared services are not available on ${deviceName()}`)
        try {
          if (op === 'serviceJoin') return { ok: true, ...session.snapshot(from.id, nameOf(from.id)) }
          return { ok: true, ...session.receive(from.id, nameOf(from.id), header as unknown as SecureOps['serviceSync']['request']) }
        } catch (error) {
          return { ok: false, error: errorText(error), code: 'unknown' }
        }
      }
      case 'libraryIndex':
        if (!libraryOn()) return off(`Library sync is off on ${deviceName()}`)
        return { ok: true, entries: [...(await servedIndex()).values()].map(({ sha256, kind, name, size }) => ({ sha256, kind, name, size })) }
      default:
        return { ok: false, error: 'Unknown request', code: 'bad' }
    }
  }

  const server = new ShareServer({
    peers,
    inbox,
    deviceName,
    limitMb: () => getAppSettings().sharingMaxSizeMb,
    onPairRequest(request) {
      emit({ type: 'pairRequest', request })
      notify('Pairing request', `${request.deviceName} wants to pair. The code is showing in ServiceEx.`)
    },
    onPairEnded(pairingId, device) {
      emit({ type: 'pairEnded', pairingId, paired: device !== null })
      if (device) emit({ type: 'peers', peers: peerList() })
    },
    onReceived(item) {
      emit({ type: 'inbox', items: inbox.list(), arrived: item })
      notify(`Received from ${item.senderName}`, `${item.name} (${formatBytes(item.size)}) is in the Inbox.`)
      autoAccept(item).catch((error) => console.error('Auto accept failed; the item stays in the Inbox', error))
    },
    async handle(op, from, header) {
      if (op !== 'libraryChunk') return handleSecure(op, from, header)
      if (!libraryOn()) return { ok: false, error: `Library sync is off on ${deviceName()}`, code: 'off' }
      const entry = typeof header.sha256 === 'string' ? (await servedIndex()).get(header.sha256) : undefined
      if (!entry) return { ok: false, error: 'That item is no longer in the library there', code: 'unknown' }
      // No large transfers while a slide is live here either: the other computer waits and asks again.
      if (entry.size > LARGE_BYTES && live.slideLive) return { ok: false, error: 'A slide is live', code: 'busy' }
      const body = await readEntry(entry, Number(header.offset), Number(header.length))
      return { response: { ok: true, size: entry.size }, body }
    },
  })

  function status(): SharingStatus {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal)
      .map((a) => a.address)
    return { enabled: getAppSettings().sharingEnabled, deviceId: peers.deviceId, deviceName: deviceName(), port: server.port, addresses, error: startError }
  }

  async function start(): Promise<void> {
    try {
      let port: number
      try {
        port = await server.listen(PREFERRED_PORT)
      } catch {
        port = await server.listen(0)
      }
      discovery.start({ id: peers.deviceId, name: deviceName(), port })
      startError = null
      presenceTimer ??= setInterval(presenceTick, PRESENCE_MS)
      if (session.role === 'member') session.start()
      scheduleLibrarySync()
    } catch (error) {
      startError = `Sharing could not start: ${errorText(error)}`
      console.error(startError)
    }
    emit({ type: 'status', status: status() })
    emit({ type: 'peers', peers: peerList() })
  }

  async function stop(): Promise<void> {
    if (presenceTimer) clearInterval(presenceTimer)
    presenceTimer = null
    presence.clear()
    session.stop()
    scheduleLibrarySync()
    discovery.stop()
    await server.close()
    pairings.clear()
    emit({ type: 'status', status: status() })
    emit({ type: 'peers', peers: peerList() })
  }

  function requireOn(): void {
    if (!getAppSettings().sharingEnabled) throw new Error('Turn on Sharing in Settings first')
  }

  /** Where a paired device can be reached: where mDNS sees it now, else where it was last reached. */
  function target(peerId: string): PeerTarget {
    const record = peers.get(peerId)
    if (!record) throw new Error('That device is not paired. Pair it first.')
    const found = discovery.get(peerId)
    const host = found?.host ?? record.host
    const port = found?.port ?? record.port
    if (!host || !port) throw new Error(`${record.name} is not on the network right now. ${TROUBLESHOOTING}`)
    return { id: record.id, name: record.name, secret: record.secret, host, port }
  }

  function setProgress(transfer: Transfer, patch: Partial<TransferProgress>): void {
    transfer.progress = { ...transfer.progress, ...patch }
    emit({ type: 'progress', transfer: transfer.progress })
  }

  async function run(transfer: Transfer): Promise<void> {
    try {
      setProgress(transfer, { state: 'sending', error: undefined })
      await sendFile(target(transfer.peerId), peers.deviceId, transfer.file, {
        name: transfer.name,
        limitMb: getAppSettings().sharingMaxSizeMb,
        onProgress: (sent, size, retrying) => setProgress(transfer, { sent, size, state: retrying ? 'retrying' : 'sending' }),
      })
      setProgress(transfer, { state: 'done', sent: transfer.progress.size })
      if (transfer.temp) await rm(transfer.temp, { recursive: true, force: true })
      transfers.delete(transfer.progress.id)
    } catch (error) {
      setProgress(transfer, { state: 'failed', error: errorText(error) })
    }
  }

  /** Turns an item into a file to send: the file itself, or a package written for it. */
  async function prepare(source: ShareSource): Promise<{ file: string; name: string; temp: string | null }> {
    const packaged = async (selection: PackageSelection) => {
      const temp = await mkdtemp(path.join(os.tmpdir(), 'serviceex-send-'))
      const file = path.join(temp, 'package.serviceex')
      const name = await buildPackage(selection, file)
      return { file, name: `${safeFileName(name)}.serviceex`, temp }
    }
    switch (source.type) {
      case 'file':
        return { file: source.path, name: path.basename(source.path), temp: null }
      case 'media':
        return { ...mediaSource(source.id), temp: null }
      case 'presentation':
        return { ...presentationSource(source.id), temp: null }
      case 'service':
        return packaged({ serviceId: source.id })
      case 'song':
        return packaged({ songIds: [source.id], themeIds: [], announcementItemIds: [] })
      case 'theme':
        return packaged({ songIds: [], themeIds: [source.id], announcementItemIds: [] })
      case 'announcement':
        return packaged({ songIds: [], themeIds: [], announcementItemIds: [source.itemId] })
    }
  }

  async function send(peerId: string, sources: ShareSource[]): Promise<void> {
    requireOn()
    const peer = target(peerId)
    const limitMb = getAppSettings().sharingMaxSizeMb
    // Dropped files are checked before anything starts, so a wrong type is refused at once.
    for (const source of sources) {
      if (source.type !== 'file') continue
      if (!existsSync(source.path) || !(await stat(source.path)).isFile()) throw new Error(`${path.basename(source.path)} is not a file that can be sent`)
      const problem = shareProblem(path.basename(source.path), (await stat(source.path)).size, limitMb)
      if (problem) throw new Error(problem)
    }
    for (const source of sources) {
      const id = randomId()
      const placeholder: Transfer = {
        progress: { id, peerId, peerName: peer.name, name: source.type === 'file' ? path.basename(source.path) : 'Preparing…', sent: 0, size: 0, state: 'preparing' },
        peerId,
        file: '',
        name: '',
        temp: null,
      }
      transfers.set(id, placeholder)
      emit({ type: 'progress', transfer: placeholder.progress })
      // One transfer at a time, in order.
      queue = queue.then(async () => {
        try {
          const prepared = await prepare(source)
          Object.assign(placeholder, prepared)
          setProgress(placeholder, { name: prepared.name, size: (await stat(prepared.file)).size })
        } catch (error) {
          setProgress(placeholder, { state: 'failed', error: errorText(error) })
          return
        }
        await run(placeholder)
      })
    }
  }

  async function autoAccept(item: InboxItem): Promise<void> {
    const settings = getAppSettings()
    const file = inbox.filePath(item)
    if (!settings.sharingAutoAccept || !peers.get(item.senderId)?.trusted || !(await canAutoAccept(item, file))) return
    // Never replaces anything: whatever has the same name is kept beside it.
    const choices = Object.fromEntries((await conflictsOf(item, file)).map((c) => [c.key, 'keepBoth' as const]))
    const result = await acceptItem(item, file, choices, null)
    if (result.status !== 'done') return
    await inbox.remove(item.id)
    emit({ type: 'accepted', item, result })
    emit({ type: 'inbox', items: inbox.list(), arrived: null })
  }

  async function openDialog(event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions): Promise<string | null> {
    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return canceled || filePaths.length === 0 ? null : filePaths[0]
  }

  ipcMain.handle('sharing:status', () => status())

  ipcMain.handle('sharing:peers', () => {
    discovery.refresh()
    return peerList()
  })

  ipcMain.handle('sharing:paired', (): PairedDevice[] => peers.list())

  ipcMain.handle('sharing:setTrusted', async (_event, id: unknown, trusted: unknown) => {
    await peers.update(assertId(id), { trusted: trusted === true })
    emit({ type: 'peers', peers: peerList() })
    return peers.list()
  })

  ipcMain.handle('sharing:forget', async (_event, id: unknown) => {
    presence.delete(id as string)
    await peers.forget(assertId(id))
    emit({ type: 'peers', peers: peerList() })
    return peers.list()
  })

  ipcMain.handle('sharing:startPairing', async (_event, peerId: unknown) => {
    requireOn()
    const id = assertId(peerId)
    const found = discovery.get(id)
    if (!found) throw new Error(`That computer is not on the network right now. ${TROUBLESHOOTING}`)
    const endpoint = { host: found.host, port: found.port }
    const { pairingId } = await requestPairing(endpoint, found.name, { id: peers.deviceId, name: deviceName(), port: server.port })
    pairings.set(pairingId, { peerId: id, name: found.name, endpoint })
    return { pairingId }
  })

  ipcMain.handle('sharing:finishPairing', async (_event, pairingId: unknown, code: unknown) => {
    const pending = pairings.get(assertId(pairingId, 'Pairing id'))
    if (!pending) throw new Error('That pairing has ended. Start pairing again.')
    if (typeof code !== 'string') throw new TypeError('The code is 6 digits')
    try {
      const secret = await completePairing(pending.endpoint, { id: pending.peerId, name: pending.name }, { id: peers.deviceId, name: deviceName(), port: server.port }, pairingId as string, code.trim())
      const device = await peers.add({ id: pending.peerId, name: pending.name, secret, host: pending.endpoint.host, port: pending.endpoint.port })
      emit({ type: 'peers', peers: peerList() })
      return device
    } finally {
      // One try per code, as on the other side.
      pairings.delete(pairingId as string)
    }
  })

  ipcMain.handle('sharing:dismissPairing', (_event, pairingId: unknown) => server.dismissPairing(assertId(pairingId, 'Pairing id')))

  ipcMain.handle('sharing:testConnection', async (_event, peerId: unknown) => {
    try {
      requireOn()
      const id = assertId(peerId)
      if (peers.get(id)) return { ok: true, ms: await ping(target(id), peers.deviceId) }
      const found = discovery.get(id)
      if (!found) throw new Error(`That computer is not on the network right now. ${TROUBLESHOOTING}`)
      const started = Date.now()
      await hello({ host: found.host, port: found.port }, found.name)
      return { ok: true, ms: Date.now() - started }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  })

  ipcMain.handle('sharing:send', (_event, peerId: unknown, sources: unknown) => send(assertId(peerId), assertSources(sources)))

  ipcMain.handle('sharing:retry', (_event, transferId: unknown) => {
    const transfer = transfers.get(assertId(transferId, 'Transfer id'))
    if (!transfer || transfer.progress.state !== 'failed') return
    if (!transfer.file) throw new Error('That item could not be prepared; send it again.')
    queue = queue.then(() => run(transfer))
  })

  ipcMain.handle('sharing:inbox', () => inbox.list())

  ipcMain.handle('sharing:preview', (_event, id: unknown) => {
    const item = inbox.get(assertId(id, 'Inbox id'))
    if (!item) throw new Error('That item is no longer in the Inbox')
    return previewItem(item, inbox.filePath(item))
  })

  ipcMain.handle('sharing:accept', async (_event, id: unknown, options: unknown): Promise<AcceptResult> => {
    const item = inbox.get(assertId(id, 'Inbox id'))
    if (!item) throw new Error('That item is no longer in the Inbox')
    const o = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>
    const serviceId = Number.isInteger(o.serviceId) && (o.serviceId as number) > 0 && getService(o.serviceId as number) ? (o.serviceId as number) : null
    const result = await acceptItem(item, inbox.filePath(item), assertChoices(o.choices), serviceId)
    if (result.status === 'done') {
      await inbox.remove(item.id)
      emit({ type: 'inbox', items: inbox.list(), arrived: null })
    }
    return result
  })

  ipcMain.handle('sharing:reject', async (_event, id: unknown) => {
    await inbox.remove(assertId(id, 'Inbox id'))
    emit({ type: 'inbox', items: inbox.list(), arrived: null })
    return inbox.list()
  })

  ipcMain.handle('sharing:exportPackage', async (event, serviceId: unknown) => {
    if (!Number.isInteger(serviceId) || (serviceId as number) < 1) throw new TypeError('Service id must be a positive integer')
    const service = getService(serviceId as number)
    if (!service) throw new Error('That service no longer exists')
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'Export service package',
      defaultPath: `${safeFileName(service.name)}${service.date ? ` ${service.date}` : ''}.serviceex`,
      filters: [{ name: 'ServiceEx package', extensions: ['serviceex'] }],
    }
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (canceled || !filePath) return null
    await mkdir(path.dirname(filePath), { recursive: true })
    await buildPackage({ serviceId: service.id }, filePath)
    return filePath
  })

  ipcMain.handle('sharing:importPackage', async (event) => {
    const file = await openDialog(event, {
      title: 'Import service package',
      properties: ['openFile'],
      filters: [{ name: 'ServiceEx package', extensions: ['serviceex'] }],
    })
    if (!file) return null
    // Checked before it goes in, so a damaged or foreign file is refused here.
    await readPackage(file)
    const item = await inbox.add(file, path.basename(file), (await stat(file)).size, { id: 'local', name: 'Imported file' }, true)
    emit({ type: 'inbox', items: inbox.list(), arrived: null })
    return item
  })

  ipcMain.handle('sharing:setAlias', async (_event, id: unknown, alias: unknown) => {
    if (typeof alias !== 'string') throw new TypeError('The name must be text')
    // eslint-disable-next-line no-control-regex
    await peers.update(assertId(id), { alias: alias.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) })
    emit({ type: 'peers', peers: peerList() })
    return peers.list()
  })

  ipcMain.handle('sharing:setDisconnected', async (_event, id: unknown, disconnected: unknown) => {
    const peerId = assertId(id)
    await peers.update(peerId, { disconnected: disconnected === true })
    presence.delete(peerId)
    emit({ type: 'peers', peers: peerList() })
    return peers.list()
  })

  ipcMain.handle('sharing:testSync', async (_event, peerId: unknown) => {
    try {
      requireOn()
      const id = assertId(peerId)
      const started = Date.now()
      const answer = await call(id, 'presence', myPresence(), 5_000)
      presence.set(id, { ...cleanPresence(answer as unknown as Record<string, unknown>), seenAt: Date.now() })
      if (session.role === 'member' && session.hostId === id) {
        await session.sync()
        const state = session.state()
        if (!state.connected) throw new Error(state.error ?? 'The shared service did not sync')
      }
      return { ok: true, ms: Date.now() - started }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  })

  ipcMain.on('sharing:setLive', (_event, info: unknown) => {
    const i = (typeof info === 'object' && info !== null ? info : {}) as Record<string, unknown>
    live = { title: typeof i.title === 'string' && i.title.trim() ? i.title.trim().slice(0, 200) : null, slideLive: i.slideLive === true }
  })

  ipcMain.handle('sharing:sendCue', async (_event, peerId: unknown, cue: unknown) => {
    requireOn()
    requireFeature('sharing.send')
    const draft = cleanCue(cue)
    if (!draft) throw new TypeError('A cue needs some text')
    await call(assertId(peerId), 'cue', { cue: draft }, 10_000)
  })

  ipcMain.handle('sharing:cues', () => cues)

  ipcMain.handle('sharing:dismissCue', (_event, id: unknown) => {
    cues = cues.filter((cue) => cue.id !== assertId(id, 'Cue id'))
    emit({ type: 'cues', cues, arrived: null })
    return cues
  })

  /** Items from the renderer: their payloads are checked again by the session. */
  function assertInputs(value: unknown): SharedItemInput[] {
    if (!Array.isArray(value) || value.length > 500) throw new TypeError('Send up to 500 items')
    return value.filter((v): v is SharedItemInput => typeof v === 'object' && v !== null && typeof (v as SharedItemInput).type === 'string')
  }

  ipcMain.handle('sharing:sharedService', () => session.state())

  ipcMain.handle('sharing:hostService', async (_event, name: unknown, items: unknown) => {
    requireOn()
    requireFeature('sharing.sharedService')
    session.stop()
    return session.host(typeof name === 'string' ? name : '', assertInputs(items))
  })

  ipcMain.handle('sharing:joinService', async (_event, peerId: unknown) => {
    requireOn()
    requireFeature('sharing.sharedService')
    const state = await session.join(assertId(peerId))
    session.start()
    return state
  })

  ipcMain.handle('sharing:leaveService', async () => {
    session.stop()
    return session.leave()
  })

  ipcMain.handle('sharing:addSharedItems', (_event, items: unknown) => {
    requireFeature('sharing.sharedService')
    const state = session.add(assertInputs(items))
    session.sync().catch(console.error)
    return state
  })

  ipcMain.handle('sharing:updateSharedItem', (_event, id: unknown, patch: unknown) => {
    requireFeature('sharing.sharedService')
    if (typeof patch !== 'object' || patch === null) throw new TypeError('A change must be an object')
    const state = session.update(assertId(id, 'Item id'), patch as SharedItemPatch)
    session.sync().catch(console.error)
    return state
  })

  ipcMain.handle('sharing:librarySync', () => {
    emitLibrary()
    return library
  })

  ipcMain.handle('sharing:syncLibraryNow', async () => {
    requireOn()
    requireFeature('sharing.librarySync')
    if (!getAppSettings().sharingLibrarySync) throw new Error('Turn on Library sync in Settings first')
    runLibrarySync().catch(console.error)
    // Resolves once the run has started; progress comes as events.
    await new Promise((resolve) => setTimeout(resolve, 50))
    return library
  })

  if (getAppSettings().sharingEnabled) start().catch(console.error)

  return {
    settingsChanged(before, after) {
      if (before.sharingLibrarySync !== after.sharingLibrarySync && after.sharingEnabled === before.sharingEnabled) scheduleLibrarySync()
      if (before.sharingEnabled !== after.sharingEnabled) {
        const change = after.sharingEnabled ? start() : stop()
        change.catch(console.error)
      } else if (after.sharingEnabled && before.sharingDeviceName !== after.sharingDeviceName && server.port) {
        // A new name is announced again.
        discovery.start({ id: peers.deviceId, name: deviceName(), port: server.port })
        emit({ type: 'status', status: status() })
      }
    },
    stop,
  }
}
