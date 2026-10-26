// What the two ends of a transfer say to each other. Shared by server.ts and client.ts.

import type { CueDraft, LibraryKind, SharedItem } from '../../shared/types'

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
  /** Each computer tells the other, about once a second, the title of what it has live and the service it hosts. */
  presence: { request: PresenceInfo; response: PresenceInfo }
  /** A cue for the tray. It never goes live by itself. */
  cue: { request: { cue: CueDraft }; response: { received: true } }
  /** Joins the shared service this computer hosts: the whole document. */
  serviceJoin: { request: Record<string, never>; response: ServiceSnapshot }
  /** Sends changes made since the last sync and gets back everything changed on the host since revision `since`. */
  serviceSync: {
    request: { id: string; since: number; changes: SharedItem[]; clock: number }
    response: { rev: number; items: SharedItem[]; clock: number; names: Record<string, string> }
  }
  /** What the library holds, by content hash. Refused while library sync is off there. */
  libraryIndex: { request: Record<string, never>; response: { entries: LibraryEntry[] } }
  /** Bytes of a library entry at `offset`; the response body holds them. */
  libraryChunk: { request: { sha256: string; offset: number; length: number }; response: { size: number } }
}

export interface PresenceInfo {
  /** The title of what is live, title only; null for nothing, or when the device chips are turned off. */
  liveTitle: string | null
  hosting: { id: string; name: string } | null
}

export interface ServiceSnapshot {
  id: string
  name: string
  hostId: string
  hostName: string
  items: SharedItem[]
  rev: number
  clock: number
  names: Record<string, string>
}

/** Something in a library, by the SHA-256 of its content: a file, or a song or theme written as JSON. */
export interface LibraryEntry {
  sha256: string
  kind: LibraryKind
  name: string
  size: number
}

/** An answer with bytes after it, for libraryChunk. */
export interface SecureReply {
  response: object
  body: Buffer
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
export type SealedResponse<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code: 'type' | 'size' | 'offset' | 'hash' | 'unknown' | 'bad' | 'off' | 'busy' | 'disconnected' }
