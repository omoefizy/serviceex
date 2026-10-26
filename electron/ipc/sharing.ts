// Local network sharing between ServiceEx computers: discovery, pairing, sending and the Inbox. Off until it is
// turned on in Settings; while off nothing listens and nothing is announced. Received items wait in the Inbox and
// never go live by themselves.

import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { formatBytes, safeFileName, shareProblem } from '../../shared/sharing'
import type {
  AcceptResult,
  AppSettings,
  ConflictChoice,
  InboxItem,
  PairedDevice,
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
import { completePairing, hello, ping, requestPairing, sendFile, TROUBLESHOOTING, type Endpoint, type PeerTarget } from '../sharing/client'
import { randomId } from '../sharing/crypto'
import { Discovery } from '../sharing/discovery'
import { Inbox } from '../sharing/inbox'
import { acceptItem, buildPackage, canAutoAccept, conflictsOf, mediaSource, presentationSource, previewItem, type PackageSelection } from '../sharing/library'
import { readPackage } from '../sharing/package'
import { PeerStore } from '../sharing/peers'
import { ID_PATTERN } from '../sharing/protocol'
import { ShareServer } from '../sharing/server'

/** Tried first so firewall rules and remembered addresses keep working; any free port if it is taken. */
const PREFERRED_PORT = 47820
const MAX_SOURCES = 200

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
    for (const device of peers.list()) list.set(device.id, { id: device.id, name: device.name, online: false, paired: true, trusted: device.trusted })
    for (const found of discovery.list()) {
      const paired = list.get(found.id)
      list.set(found.id, { id: found.id, name: found.name, online: true, paired: !!paired, trusted: paired?.trusted ?? false })
      // Remember the latest name and address of paired devices.
      if (paired) peers.update(found.id, { name: found.name, host: found.host, port: found.port }).catch(console.error)
    }
    return [...list.values()].sort((a, b) => Number(b.paired) - Number(a.paired) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  }

  const discovery = new Discovery(() => emit({ type: 'peers', peers: peerList() }))

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
    } catch (error) {
      startError = `Sharing could not start: ${errorText(error)}`
      console.error(startError)
    }
    emit({ type: 'status', status: status() })
    emit({ type: 'peers', peers: peerList() })
  }

  async function stop(): Promise<void> {
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

  if (getAppSettings().sharingEnabled) start().catch(console.error)

  return {
    settingsChanged(before, after) {
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
