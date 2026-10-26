// What the two ends of a transfer say to each other. Shared by server.ts and client.ts.

export const PROTOCOL_VERSION = 1
/** The mDNS service type: _serviceex._tcp. */
export const SERVICE_TYPE = 'serviceex'
/** Bytes per chunk of a transfer. */
export const CHUNK_BYTES = 1024 * 1024
/** The largest request body the server reads: a chunk and its envelope, with room to spare. */
export const MAX_BODY_BYTES = 4 * CHUNK_BYTES
/** A device id: 32 hex characters. */
export const ID_PATTERN = /^[0-9a-f]{32}$/
/** The header naming the sending device on sealed requests. */
export const FROM_HEADER = 'x-serviceex-from'

export const requestAad = (fromId: string, toId: string) => `serviceex/${PROTOCOL_VERSION} request ${fromId}>${toId}`
export const responseAad = (fromId: string, toId: string, nonce: string) => `serviceex/${PROTOCOL_VERSION} response ${fromId}>${toId} ${nonce}`

/** Operations on the sealed channel, with what each sends and gets back. */
export interface SecureOps {
  ping: { request: Record<string, never>; response: { name: string } }
  /** Offers a file. The answer is how many bytes the receiver already has, to carry on from. */
  offer: { request: { transferId: string; name: string; size: number; sha256: string }; response: { offset: number } }
  /** Bytes at `offset`; the body holds them. */
  chunk: { request: { transferId: string; offset: number }; response: { offset: number } }
  /** All bytes sent: the receiver checks the hash and puts the file in its Inbox. */
  finish: { request: { transferId: string }; response: { received: true } }
}

export type SecureOp = keyof SecureOps

/** Every sealed request carries these besides its own fields. */
export interface SealedHeader {
  op: SecureOp
  /** Random, never reused: the receiver refuses a nonce it has seen. */
  nonce: string
  /** Milliseconds since 1970 on the sender's clock. */
  ts: number
}

/** A sealed answer: the operation's response, or an error to show. */
export type SealedResponse<T> = ({ ok: true } & T) | { ok: false; error: string; code: 'type' | 'size' | 'offset' | 'hash' | 'unknown' | 'bad' }
