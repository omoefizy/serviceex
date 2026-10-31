// The sending side of local network sharing: pairing with another computer, sealed requests to paired ones, and
// chunked file transfers that retry and carry on from what the receiver already has. Nothing here touches
// Electron, so tests can run it against a real server.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open as openFile, stat } from 'node:fs/promises'
import http from 'node:http'
import { safeFileName, shareProblem } from '../../shared/sharing'
import { channelKey, open, PairingInitiator, randomId, sameBytes, seal } from './crypto'
import { CHUNK_BYTES, FROM_HEADER, ID_PATTERN, PROTOCOL_VERSION, requestAad, responseAad, type SealedResponse, type SecureOp, type SecureOps } from './protocol'

/** Where another computer listens. */
export interface Endpoint {
  host: string
  port: number
}

/** A paired device to send to. */
export interface PeerTarget extends Endpoint {
  id: string
  name: string
  secret: Buffer
}

/** An answer the other computer gave that is final: retrying will not help. */
export class RefusedError extends Error {}

/** The other computer could not be reached; worth retrying. */
export class UnreachableError extends Error {}

/** The other computer declined the file. */
export class DeclinedError extends RefusedError {}

/** This computer stopped the transfer. */
export class CancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message)
  }
}

/** What to tell the operator when a device cannot be reached. */
export const TROUBLESHOOTING =
  'Check that both computers are on the same network and have Sharing turned on. Guest and public Wi-Fi often keep devices apart (client isolation); use the main network or a cable. On Windows, allow ServiceEx through the firewall on private networks.'

function unreachable(error: unknown, name: string): UnreachableError {
  const code = (error as NodeJS.ErrnoException | null)?.code
  const why =
    code === 'ECONNREFUSED'
      ? `${name} refused the connection; ServiceEx may be closed there or Sharing turned off.`
      : code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'TIMEOUT'
        ? `${name} did not answer in time.`
        : code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EHOSTDOWN'
          ? `${name} cannot be reached on this network.`
          : code === 'ECONNRESET' || code === 'EPIPE'
            ? `The connection to ${name} dropped.`
            : `${name} could not be reached (${code ?? (error instanceof Error ? error.message : String(error))}).`
  return new UnreachableError(`${why} ${TROUBLESHOOTING}`)
}

interface HttpAnswer {
  status: number
  body: Buffer
}

function request(
  endpoint: Endpoint,
  method: 'GET' | 'POST',
  path: string,
  body: Buffer | null,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HttpAnswer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: endpoint.host,
        port: endpoint.port,
        method,
        path,
        headers: { ...headers, ...(body ? { 'content-length': String(body.length) } : {}) },
        timeout: timeoutMs,
        signal,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('Timed out'), { code: 'TIMEOUT' })))
    req.on('error', reject)
    req.end(body ?? undefined)
  })
}

/** The error message in a plain JSON answer. */
function plainError(answer: HttpAnswer): string {
  try {
    const value = JSON.parse(answer.body.toString()) as { error?: unknown }
    if (typeof value.error === 'string') return value.error
  } catch {
    // Not JSON.
  }
  return `The other computer answered ${answer.status}`
}

async function postJson<T>(endpoint: Endpoint, name: string, path: string, value: object, timeoutMs = 15_000): Promise<T> {
  let answer: HttpAnswer
  try {
    answer = await request(endpoint, 'POST', path, Buffer.from(JSON.stringify(value)), { 'content-type': 'application/json' }, timeoutMs)
  } catch (error) {
    throw unreachable(error, name)
  }
  if (answer.status !== 200) throw new RefusedError(plainError(answer))
  return JSON.parse(answer.body.toString()) as T
}

/** Asks a computer who it is, without pairing. Refuses an answer that is not from ServiceEx. */
export async function hello(endpoint: Endpoint, name = 'The other computer'): Promise<{ id: string; name: string; v: number }> {
  let answer: HttpAnswer
  try {
    answer = await request(endpoint, 'GET', '/v1/hello', null, {}, 5_000)
  } catch (error) {
    throw unreachable(error, name)
  }
  const where = `${endpoint.host}:${endpoint.port}`
  const notServiceEx = new RefusedError(`Something answered at ${where}, but it is not ServiceEx. Check the address and port in the other computer's Settings, Sharing.`)
  if (answer.status !== 200) throw notServiceEx
  let value: Partial<{ id: unknown; name: unknown; v: unknown }>
  try {
    value = JSON.parse(answer.body.toString()) as typeof value
  } catch {
    throw notServiceEx
  }
  if (typeof value !== 'object' || value === null || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) throw notServiceEx
  if (value.v !== PROTOCOL_VERSION) throw new RefusedError(`ServiceEx at ${where} is a different version. Update both computers to the same version.`)
  return { id: value.id, name: (typeof value.name === 'string' ? value.name : '').slice(0, 40) || 'Unknown device', v: value.v }
}

// ---------- Pairing ----------

export interface Me {
  id: string
  name: string
  /** The port this computer listens on, so the other can send back. */
  port: number | null
}

/** Asks the other computer to show a code. */
export async function requestPairing(endpoint: Endpoint, peerName: string, me: Me): Promise<{ pairingId: string }> {
  const pairingId = randomId()
  await postJson(endpoint, peerName, '/v1/pair/request', { pairingId, fromId: me.id, fromName: me.name, port: me.port })
  return { pairingId }
}

/** Runs the exchange with the typed code. Resolves to the shared key once both sides have proved they know it. */
export async function completePairing(endpoint: Endpoint, peer: { id: string; name: string }, me: Me, pairingId: string, code: string): Promise<Buffer> {
  if (!/^\d{6}$/.test(code)) throw new RefusedError('The code is 6 digits')
  const initiator = new PairingInitiator(me.id, peer.id, code)
  const answer = await postJson<{ message: string; confirm: string }>(endpoint, peer.name, '/v1/pair/exchange', {
    pairingId,
    message: initiator.message.toString('base64'),
  })
  const keys = initiator.finish(Buffer.from(answer.message, 'base64'))
  if (!sameBytes(Buffer.from(answer.confirm, 'base64'), keys.responderConfirm)) {
    // Wrong code: tell the other computer so its code goes away.
    await postJson(endpoint, peer.name, '/v1/pair/confirm', { pairingId, confirm: '' }).catch(() => {})
    throw new RefusedError('The code did not match. Start pairing again to get a new code.')
  }
  await postJson(endpoint, peer.name, '/v1/pair/confirm', { pairingId, confirm: keys.initiatorConfirm.toString('base64') })
  return keys.secret
}

// ---------- Sealed requests ----------

export async function secureRequest<Op extends SecureOp>(
  target: PeerTarget,
  myId: string,
  op: Op,
  fields: SecureOps[Op]['request'],
  body?: Buffer,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<SealedResponse<SecureOps[Op]['response']>> {
  return (await secureCall(target, myId, op, fields, body, timeoutMs, signal)).header
}

/** A sealed request whose answer may carry bytes after it (libraryChunk). */
export async function secureCall<Op extends SecureOp>(
  target: PeerTarget,
  myId: string,
  op: Op,
  fields: SecureOps[Op]['request'],
  body?: Buffer,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<{ header: SealedResponse<SecureOps[Op]['response']>; body: Buffer }> {
  const nonce = randomId()
  const envelope = seal(channelKey(target.secret, myId, target.id, 'request'), requestAad(myId, target.id), { ...fields, op, nonce, ts: Date.now() }, body)
  let answer: HttpAnswer
  try {
    answer = await request(target, 'POST', '/v1/secure', envelope, { 'content-type': 'application/octet-stream', [FROM_HEADER]: myId }, timeoutMs, signal)
  } catch (error) {
    if (signal?.aborted) throw new CancelledError()
    throw unreachable(error, target.name)
  }
  if (answer.status >= 500) throw new UnreachableError(`${target.name} had a problem: ${plainError(answer)}`)
  if (answer.status !== 200) throw new RefusedError(plainError(answer))
  try {
    return open<SealedResponse<SecureOps[Op]['response']>>(channelKey(target.secret, myId, target.id, 'response'), responseAad(myId, target.id, nonce), answer.body)
  } catch {
    throw new RefusedError(`The answer from ${target.name} could not be verified. Forget the device on both computers and pair again.`)
  }
}

/** Round trip to a paired device over the sealed channel. */
export async function ping(target: PeerTarget, myId: string): Promise<number> {
  const started = Date.now()
  const answer = await secureRequest(target, myId, 'ping', {}, undefined, 8_000)
  if (!answer.ok) throw new RefusedError(answer.error)
  return Date.now() - started
}

// ---------- Transfers ----------

export async function sha256File(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) {
    if (signal?.aborted) throw new CancelledError()
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

/** The same file to the same device always gets the same id, so a retry carries on where it stopped. */
export const transferIdFor = (myId: string, peerId: string, sha256: string, name: string, size: number) =>
  createHash('sha256').update(`${myId}|${peerId}|${sha256}|${name}|${size}`).digest('hex').slice(0, 32)

export interface SendOptions {
  /** The name the receiver sees; the file's own name by default. */
  name: string
  /** The sender's own size limit check, in MB; the receiver checks its own too. */
  limitMb: number
  onProgress?(sent: number, size: number, retrying: boolean): void
  chunkBytes?: number
  /** Attempts per step before giving up; 5 by default. */
  attempts?: number
  /** First wait between attempts, doubling each time; 500 ms by default. */
  retryDelayMs?: number
  /** Precomputed SHA-256 of the file. */
  sha256?: string
  /** Stops the transfer; it then rejects with CancelledError, and the receiver is told to delete what arrived. */
  signal?: AbortSignal
}

/** Waits, or rejects with CancelledError as soon as the signal aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError())
    const done = () => {
      clearTimeout(timer)
      reject(new CancelledError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', done)
      resolve()
    }, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** Turns a refusal into the error to throw: declined by the receiver, or refused for another reason. */
const refusal = (answer: { error: string; code: string }) => (answer.code === 'declined' ? new DeclinedError(answer.error) : new RefusedError(answer.error))

/**
 * Sends a file in chunks. Network failures are retried, carrying on from the receiver's offset. Rejects with
 * DeclinedError when the receiver declines it, and CancelledError when the signal aborts.
 */
export async function sendFile(target: PeerTarget, myId: string, file: string, options: SendOptions): Promise<void> {
  const { signal } = options
  const stopped = () => {
    if (signal?.aborted) throw new CancelledError()
  }
  const name = safeFileName(options.name)
  const { size } = await stat(file)
  const problem = shareProblem(name, size, options.limitMb)
  if (problem) throw new RefusedError(problem)
  const sha256 = options.sha256 ?? (await sha256File(file, signal))
  stopped()
  const transferId = transferIdFor(myId, target.id, sha256, name, size)
  const chunkBytes = options.chunkBytes ?? CHUNK_BYTES
  const attempts = options.attempts ?? 5
  const delay = options.retryDelayMs ?? 500

  /** Runs a step, retrying when the other computer cannot be reached. */
  async function retrying<T>(step: () => Promise<T>, sent: number): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      stopped()
      try {
        return await step()
      } catch (error) {
        if (!(error instanceof UnreachableError) || attempt >= attempts) throw error
        options.onProgress?.(sent, size, true)
        await wait(delay * 2 ** (attempt - 1), signal)
      }
    }
  }

  /** The first offer asks; a later one (`resume`) only finds where to carry on from, and is refused once declined. */
  const offer = async (resume: boolean) => {
    const answer = await secureRequest(target, myId, 'offer', { transferId, name, size, sha256, ...(resume ? { resume } : {}) }, undefined, undefined, signal)
    if (!answer.ok) throw refusal(answer)
    return answer.offset
  }

  try {
    let offset = await retrying(() => offer(false), 0)
    options.onProgress?.(offset, size, false)
    const handle = await openFile(file, 'r')
    try {
      while (offset < size) {
        const length = Math.min(chunkBytes, size - offset)
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        if (bytesRead !== length) throw new RefusedError(`${name} changed while it was being sent`)
        const at = offset
        offset = await retrying(async () => {
          const answer = await secureRequest(target, myId, 'chunk', { transferId, offset: at }, buffer, undefined, signal)
          if (answer.ok) return answer.offset
          // Out of step (the chunk arrived but its answer was lost, say): ask where to carry on from.
          if (answer.code === 'offset' || answer.code === 'unknown') return offer(true)
          throw refusal(answer)
        }, at)
        options.onProgress?.(offset, size, false)
      }
    } finally {
      await handle.close()
    }
    const done = await retrying(() => secureRequest(target, myId, 'finish', { transferId }, undefined, 120_000, signal), size)
    if (!done.ok) throw refusal(done)
  } catch (error) {
    // Tell the receiver to delete what arrived. Best effort: it also clears old partial files on its own.
    if (error instanceof CancelledError) await secureRequest(target, myId, 'cancel', { transferId }, undefined, 5_000).catch(() => {})
    throw error
  }
}
