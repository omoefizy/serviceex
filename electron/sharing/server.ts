// The receiving side of local network sharing: an HTTP server on the local network that pairs with other
// ServiceEx computers and takes files from paired ones only, over sealed envelopes (see crypto.ts). Files arrive
// in chunks into a partial file, so an interrupted transfer carries on where it stopped, and only reach the Inbox
// once their SHA-256 matches. Nothing here touches Electron, so tests can run a real server.

import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { limitBytes, safeFileName, shareProblem } from '../../shared/sharing'
import type { IncomingTransfer, InboxItem, PairedDevice, PairRequest } from '../../shared/types'
import { channelKey, open, pairingCode, respondToPairing, sameBytes, seal, type PairingKeys } from './crypto'
import type { Inbox } from './inbox'
import type { PeerStore } from './peers'
import {
  FROM_HEADER,
  ID_PATTERN,
  MAX_BODY_BYTES,
  PROTOCOL_VERSION,
  requestAad,
  responseAad,
  type SealedHeader,
  type SealedResponse,
  type SecureOp,
  type SecureOps,
  type SecureReply,
} from './protocol'

/** Operations the server leaves to its owner: presence, cues, the shared service and library sync. */
export type ExtraOp = Exclude<SecureOp, 'ping' | 'offer' | 'chunk' | 'finish' | 'cancel'>

export interface ServerOptions {
  peers: PeerStore
  inbox: Inbox
  deviceName(): string
  /** The size limit for received files, in MB. */
  limitMb(): number
  /** Show this code until the other computer has typed it. */
  onPairRequest(request: PairRequest): void
  /** A pairing finished (with the device), failed or timed out. */
  onPairEnded(pairingId: string, device: PairedDevice | null): void
  onReceived(item: InboxItem): void
  /** A file is arriving, has got further, or has stopped arriving: for the incoming chip. */
  onIncoming?(transfer: IncomingTransfer): void
  /** How long a code stays good: 2 minutes by default. */
  pairingTimeoutMs?: number
  /** Answers the other sealed operations; the request was opened and checked, and comes from a paired device. */
  handle?(op: ExtraOp, from: { id: string; name: string }, header: Record<string, unknown>, body: Buffer): Promise<object | SecureReply>
}

interface PairingSession {
  pairingId: string
  fromId: string
  fromName: string
  host: string | null
  port: number | null
  code: string
  expires: number
  /** Set once the one allowed guess has been made. */
  keys: PairingKeys | null
  timer: NodeJS.Timeout
}

interface PartialMeta {
  fromId: string
  name: string
  size: number
  sha256: string
}

/** Partial files not added to for this long are deleted when the server starts: their sender gave up. */
export const PARTIAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Sealed requests older or newer than this are refused; nonces are remembered for as long. */
const CLOCK_WINDOW_MS = 60 * 60 * 1000
const MAX_NONCES = 50_000

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    req.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length > limit) {
        reject(new HttpError(413, 'Request too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length })
  res.end(body)
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

const remoteHost = (req: IncomingMessage) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '') || null

export class ShareServer {
  private readonly options: ServerOptions
  private server: http.Server | null = null
  private session: PairingSession | null = null
  private readonly nonces = new Map<string, number>()
  /** Transfers with a chunk being written, so two never write at once. */
  private readonly busy = new Set<string>()
  /** Transfers declined here, by incoming id, refused until the sender offers the file again. */
  private readonly declined = new Set<string>()

  constructor(options: ServerOptions) {
    this.options = options
  }

  get port(): number | null {
    const address = this.server?.address()
    return address && typeof address === 'object' ? (address as AddressInfo).port : null
  }

  /** Starts listening on every local network interface. Port 0 picks a free one. Resolves to the port. */
  listen(port = 0, host = '0.0.0.0'): Promise<number> {
    if (this.server) return Promise.resolve(this.port as number)
    this.prunePartials().catch((error: unknown) => console.error('Could not clear old partial transfers', error))
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        const status = error instanceof HttpError ? error.status : 500
        if (!(error instanceof HttpError)) console.error('Sharing request failed', error)
        if (!res.headersSent) sendJson(res, status, { error: error instanceof Error && status < 500 ? error.message : 'Something went wrong on the receiving computer' })
        else res.destroy()
      })
    })
    server.requestTimeout = 60_000
    this.server = server
    return new Promise((resolve, reject) => {
      server.once('error', (error) => {
        this.server = null
        reject(error)
      })
      server.listen(port, host, () => resolve(this.port as number))
    })
  }

  async close(): Promise<void> {
    this.endSession(false)
    const server = this.server
    this.server = null
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  /** Deletes partial transfers that have not grown for a week, and any half of a pair whose other half is gone. */
  async prunePartials(maxAgeMs = PARTIAL_MAX_AGE_MS): Promise<void> {
    const folder = this.options.inbox.partialFolder
    let names: string[]
    try {
      names = await readdir(folder)
    } catch {
      return
    }
    const now = Date.now()
    const bases = new Set(names.map((name) => name.replace(/\.(part|json)$/, '')))
    for (const base of bases) {
      if (this.busy.has(path.join(folder, `${base}.part`))) continue
      const part = path.join(folder, `${base}.part`)
      const meta = path.join(folder, `${base}.json`)
      const [partTime, metaTime] = await Promise.all([part, meta].map((file) => stat(file).then((s) => s.mtimeMs, () => null)))
      if (partTime === null || metaTime === null || now - partTime > maxAgeMs) {
        await rm(part, { force: true })
        await rm(meta, { force: true })
      }
    }
  }

  /** The operator declined a file arriving here: the sender is refused, and what arrived is deleted. */
  async decline(incomingId: string): Promise<void> {
    const match = /^([0-9a-f]{32})-([0-9a-f]{32})$/.exec(incomingId)
    if (!match) throw new Error('Bad incoming id')
    const [, fromId, transferId] = match
    const { part, meta } = this.partialPaths(fromId, transferId)
    // Refuse the sender before anything else is awaited: chunks and the finish keep arriving meanwhile, and one that
    // slips past would let the sender finish as if nothing had happened.
    this.declined.add(incomingId)
    const info = await this.readMeta(meta)
    if (info) this.report(fromId, transferId, info, 0, 'declined')
    await this.discard(part, meta)
  }

  private async discard(part: string, meta: string): Promise<void> {
    await rm(part, { force: true })
    await rm(meta, { force: true })
  }

  private report(fromId: string, transferId: string, info: PartialMeta, received: number, state: IncomingTransfer['state']): void {
    this.options.onIncoming?.({
      id: `${fromId}-${transferId}`,
      senderId: fromId,
      senderName: this.options.peers.get(fromId)?.name ?? 'Another computer',
      name: info.name,
      size: info.size,
      received,
      state,
    })
  }

  /** The operator closed the code without pairing. */
  dismissPairing(pairingId: string): void {
    if (this.session?.pairingId === pairingId) this.endSession(false)
  }

  private endSession(paired: boolean, device: PairedDevice | null = null): void {
    const session = this.session
    if (!session) return
    clearTimeout(session.timer)
    this.session = null
    this.options.onPairEnded(session.pairingId, paired ? device : null)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/v1/hello') {
      sendJson(res, 200, { id: this.options.peers.deviceId, name: this.options.deviceName(), v: PROTOCOL_VERSION })
      return
    }
    if (req.method !== 'POST') throw new HttpError(404, 'Not found')
    switch (url.pathname) {
      case '/v1/pair/request':
        return this.pairRequest(req, res)
      case '/v1/pair/exchange':
        return this.pairExchange(req, res)
      case '/v1/pair/confirm':
        return this.pairConfirm(req, res)
      case '/v1/secure':
        return this.secure(req, res)
      default:
        throw new HttpError(404, 'Not found')
    }
  }

  // ---------- Pairing ----------

  private async readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    try {
      const value: unknown = JSON.parse((await readBody(req, 64 * 1024)).toString())
      if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
    } catch (error) {
      if (error instanceof HttpError) throw error
    }
    throw new HttpError(400, 'Expected JSON')
  }

  private sessionFor(body: Record<string, unknown>): PairingSession {
    const session = this.session
    if (!session || session.pairingId !== body.pairingId || Date.now() > session.expires) {
      throw new HttpError(410, 'That pairing code has expired or was closed. Start pairing again.')
    }
    return session
  }

  private async pairRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req)
    const { pairingId, fromId, fromName, port } = body
    if (typeof pairingId !== 'string' || !ID_PATTERN.test(pairingId) || typeof fromId !== 'string' || !ID_PATTERN.test(fromId)) {
      throw new HttpError(400, 'Bad pairing request')
    }
    if (fromId === this.options.peers.deviceId) throw new HttpError(400, 'A computer cannot pair with itself')
    // One code on screen at a time; a second computer waits until it is done.
    if (this.session && Date.now() <= this.session.expires && this.session.fromId !== fromId) {
      throw new HttpError(429, 'The other computer is already pairing with another device. Try again in a minute.')
    }
    this.endSession(false)
    const name = safeFileName(typeof fromName === 'string' ? fromName : '').slice(0, 40) || 'Unknown device'
    const timeout = this.options.pairingTimeoutMs ?? 120_000
    const session: PairingSession = {
      pairingId,
      fromId,
      fromName: name,
      host: remoteHost(req),
      port: Number.isInteger(port) && (port as number) > 0 && (port as number) < 65536 ? (port as number) : null,
      code: pairingCode(),
      expires: Date.now() + timeout,
      keys: null,
      timer: setTimeout(() => this.dismissPairing(pairingId), timeout),
    }
    this.session = session
    this.options.onPairRequest({ pairingId, deviceName: name, code: session.code })
    sendJson(res, 200, { id: this.options.peers.deviceId, name: this.options.deviceName() })
  }

  private async pairExchange(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req)
    const session = this.sessionFor(body)
    // One guess per code: a second exchange ends the pairing.
    if (session.keys) {
      this.endSession(false)
      throw new HttpError(410, 'That pairing code was already used. Start pairing again.')
    }
    if (typeof body.message !== 'string') throw new HttpError(400, 'Bad pairing message')
    let answer: ReturnType<typeof respondToPairing>
    try {
      answer = respondToPairing(session.fromId, this.options.peers.deviceId, session.code, Buffer.from(body.message, 'base64'))
    } catch {
      this.endSession(false)
      throw new HttpError(400, 'Bad pairing message')
    }
    session.keys = answer.keys
    sendJson(res, 200, { message: answer.message.toString('base64'), confirm: answer.keys.responderConfirm.toString('base64') })
  }

  private async pairConfirm(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req)
    const session = this.sessionFor(body)
    const keys = session.keys
    if (!keys || typeof body.confirm !== 'string' || !sameBytes(Buffer.from(body.confirm, 'base64'), keys.initiatorConfirm)) {
      this.endSession(false)
      throw new HttpError(403, 'The code did not match. Start pairing again.')
    }
    const device = await this.options.peers.add({ id: session.fromId, name: session.fromName, secret: keys.secret, host: session.host, port: session.port })
    this.endSession(true, device)
    sendJson(res, 200, { paired: true })
  }

  // ---------- Sealed requests from paired devices ----------

  private async secure(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const fromId = req.headers[FROM_HEADER]
    const peer = typeof fromId === 'string' && ID_PATTERN.test(fromId) ? this.options.peers.get(fromId) : undefined
    if (!peer) {
      req.resume()
      throw new HttpError(401, 'This computer is not paired with yours. Pair them first.')
    }
    const myId = this.options.peers.deviceId
    const envelope = await readBody(req, MAX_BODY_BYTES)
    let opened: { header: SealedHeader & Record<string, unknown>; body: Buffer }
    try {
      opened = open<SealedHeader & Record<string, unknown>>(channelKey(peer.secret, peer.id, myId, 'request'), requestAad(peer.id, myId), envelope)
    } catch {
      // Sealed with another key: the pairing was forgotten on this side, or it is not that device at all.
      throw new HttpError(401, 'This computer could not verify yours. Forget the device on both computers and pair again.')
    }
    const { header, body } = opened
    if (typeof header.nonce !== 'string' || header.nonce.length < 16 || header.nonce.length > 64 || typeof header.ts !== 'number') {
      throw new HttpError(400, 'Bad request')
    }
    this.checkFresh(`${peer.id}:${header.nonce}`, header.ts)
    // Remember where it was reached from, for when mDNS cannot find it.
    const host = remoteHost(req)
    if (host && host !== peer.host) this.options.peers.update(peer.id, { host }).catch(console.error)

    const answer: object | SecureReply = peer.disconnected
      ? ({ ok: false, error: `${this.options.deviceName()} has disconnected from this computer in its Settings.`, code: 'disconnected' } satisfies SealedResponse<object>)
      : await this.run(peer.id, peer.name, header, body)
    const reply = 'body' in answer && Buffer.isBuffer(answer.body) ? (answer as SecureReply) : { response: answer, body: Buffer.alloc(0) }
    const sealed = seal(channelKey(peer.secret, peer.id, myId, 'response'), responseAad(peer.id, myId, header.nonce), reply.response, reply.body)
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': sealed.length })
    res.end(sealed)
  }

  /** Refuses replays: a nonce seen before, or a request outside the clock window. */
  private checkFresh(key: string, ts: number): void {
    const now = Date.now()
    if (Math.abs(now - ts) > CLOCK_WINDOW_MS) {
      throw new HttpError(401, 'The two computers disagree about the time by more than an hour. Check their clocks.')
    }
    if (this.nonces.has(key)) throw new HttpError(401, 'Request already seen')
    if (this.nonces.size >= MAX_NONCES) {
      for (const [old, seen] of this.nonces) if (now - seen > CLOCK_WINDOW_MS) this.nonces.delete(old)
      if (this.nonces.size >= MAX_NONCES) throw new HttpError(503, 'Too many requests')
    }
    this.nonces.set(key, now)
  }

  private async run(fromId: string, fromName: string, header: SealedHeader & Record<string, unknown>, body: Buffer): Promise<object | SecureReply> {
    switch (header.op) {
      case 'ping':
        return { ok: true, name: this.options.deviceName() } satisfies SealedResponse<SecureOps['ping']['response']>
      case 'offer':
        return this.offer(fromId, header)
      case 'chunk':
        return this.chunk(fromId, header, body)
      case 'finish':
        return this.finish(fromId, fromName, header)
      case 'cancel':
        return this.cancel(fromId, header)
      case 'presence':
      case 'cue':
      case 'serviceJoin':
      case 'serviceSync':
      case 'libraryIndex':
      case 'libraryChunk':
        if (this.options.handle) return this.options.handle(header.op, { id: fromId, name: fromName }, header, body)
        return { ok: false, error: 'That is not turned on here', code: 'off' } satisfies SealedResponse<object>
      default:
        return { ok: false, error: 'Unknown request', code: 'bad' } satisfies SealedResponse<object>
    }
  }

  private partialPaths(fromId: string, transferId: unknown): { part: string; meta: string } {
    if (typeof transferId !== 'string' || !ID_PATTERN.test(transferId)) throw new HttpError(400, 'Bad transfer id')
    const base = path.join(this.options.inbox.partialFolder, `${fromId}-${transferId}`)
    return { part: `${base}.part`, meta: `${base}.json` }
  }

  private async readMeta(file: string): Promise<PartialMeta | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as PartialMeta
    } catch {
      return null
    }
  }

  private async offer(fromId: string, header: Record<string, unknown>): Promise<SealedResponse<SecureOps['offer']['response']>> {
    const { part, meta } = this.partialPaths(fromId, header.transferId)
    const name = typeof header.name === 'string' ? safeFileName(header.name) : ''
    const size = header.size as number
    const sha256 = header.sha256
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, error: 'Bad offer', code: 'bad' }
    // A sender finding out where to carry on from, mid transfer, is not asking again.
    if (header.resume === true && this.declined.has(`${fromId}-${header.transferId as string}`)) return this.declinedAnswer()
    const problem = shareProblem(name, size, this.options.limitMb())
    if (problem) return { ok: false, error: problem, code: problem.includes('limit') ? 'size' : 'type' }

    const transferId = header.transferId as string
    const incomingId = `${fromId}-${transferId}`
    const info: PartialMeta = { fromId, name, size, sha256 }
    const existing = await this.readMeta(meta)
    const same = existing && existing.name === name && existing.size === size && existing.sha256 === sha256 && existsSync(part)
    if (same && !this.declined.has(incomingId)) {
      // Carry on from what arrived before the interruption.
      const have = (await stat(part)).size
      if (have <= size) {
        this.report(fromId, transferId, info, have, 'receiving')
        return { ok: true, offset: have }
      }
    }
    // Offering the file again is asking again, after a decline too.
    this.declined.delete(incomingId)
    await mkdir(this.options.inbox.partialFolder, { recursive: true })
    await writeFile(part, Buffer.alloc(0))
    await writeFile(meta, JSON.stringify(info))
    this.report(fromId, transferId, info, 0, 'receiving')
    return { ok: true, offset: 0 }
  }

  private async chunk(fromId: string, header: Record<string, unknown>, body: Buffer): Promise<SealedResponse<SecureOps['chunk']['response']>> {
    const { part, meta } = this.partialPaths(fromId, header.transferId)
    const incomingId = `${fromId}-${header.transferId as string}`
    if (this.declined.has(incomingId)) return this.declinedAnswer()
    const info = await this.readMeta(meta)
    // Declined while the meta was read: its files are gone, but the sender must hear it was declined.
    if (this.declined.has(incomingId)) return this.declinedAnswer()
    if (!info || !existsSync(part)) return { ok: false, error: 'Offer the file first', code: 'unknown' }
    const key = part
    if (this.busy.has(key)) return { ok: false, error: 'A chunk is already being written', code: 'offset' }
    this.busy.add(key)
    try {
      // Declined, or cancelled, since this chunk arrived: its file is already gone.
      const have = await stat(part).then((info) => info.size, () => null)
      if (this.declined.has(incomingId)) return this.declinedAnswer()
      if (have === null) return { ok: false, error: 'Offer the file first', code: 'unknown' }
      // Only the next bytes in order; anything else tells the sender where to carry on from.
      if (header.offset !== have) return { ok: false, error: `Expected offset ${have}`, code: 'offset' }
      if (have + body.length > info.size || have + body.length > limitBytes(this.options.limitMb())) {
        return { ok: false, error: 'More bytes than were offered', code: 'size' }
      }
      await appendFile(part, body)
      // Declined while this chunk was being written: the append made the file again.
      if (this.declined.has(incomingId)) {
        await this.discard(part, meta)
        return this.declinedAnswer()
      }
      this.report(fromId, header.transferId as string, info, have + body.length, 'receiving')
      return { ok: true, offset: have + body.length }
    } finally {
      this.busy.delete(key)
    }
  }

  private async finish(fromId: string, fromName: string, header: Record<string, unknown>): Promise<SealedResponse<SecureOps['finish']['response']>> {
    const { part, meta } = this.partialPaths(fromId, header.transferId)
    const transferId = header.transferId as string
    const incomingId = `${fromId}-${transferId}`
    if (this.declined.has(incomingId)) return this.declinedAnswer()
    const info = await this.readMeta(meta)
    if (this.declined.has(incomingId)) return this.declinedAnswer()
    if (!info || !existsSync(part)) return { ok: false, error: 'Offer the file first', code: 'unknown' }
    const have = await stat(part).then((s) => s.size, () => null)
    // Declined while this was checked, or the hash read: the decline wins until the sender has been answered.
    if (this.declined.has(incomingId)) return this.declinedAnswer()
    if (have === null) return { ok: false, error: 'Offer the file first', code: 'unknown' }
    if (have !== info.size) return { ok: false, error: `Only ${have} of ${info.size} bytes arrived`, code: 'offset' }
    const hash = await sha256File(part)
    if (this.declined.has(incomingId)) return this.declinedAnswer()
    if (hash !== info.sha256) {
      await this.discard(part, meta)
      this.report(fromId, transferId, info, 0, 'failed')
      return { ok: false, error: 'The file was damaged on the way (its checksum does not match). Send it again.', code: 'hash' }
    }
    const item = await this.options.inbox.add(part, info.name, info.size, { id: fromId, name: fromName })
    if (this.declined.has(incomingId)) {
      // Declined while the file was moved in: take it back out.
      await this.options.inbox.remove(item.id)
      await this.discard(part, meta)
      this.report(fromId, transferId, info, 0, 'declined')
      return this.declinedAnswer()
    }
    await rm(meta, { force: true })
    this.report(fromId, transferId, info, info.size, 'done')
    this.options.onReceived(item)
    return { ok: true, received: true }
  }

  /** The sender stopped: what arrived is deleted. */
  private async cancel(fromId: string, header: Record<string, unknown>): Promise<SealedResponse<SecureOps['cancel']['response']>> {
    const { part, meta } = this.partialPaths(fromId, header.transferId)
    // A chunk still being written finds this and deletes what it wrote; offering the file again clears it. Set before
    // anything is awaited, so nothing arriving meanwhile slips through.
    this.declined.add(`${fromId}-${header.transferId as string}`)
    const info = await this.readMeta(meta)
    await this.discard(part, meta)
    if (info) this.report(fromId, header.transferId as string, info, 0, 'cancelled')
    return { ok: true, cancelled: true }
  }

  private declinedAnswer(): { ok: false; error: string; code: 'declined' } {
    return { ok: false, error: `${this.options.deviceName()} declined the file.`, code: 'declined' }
  }
}
