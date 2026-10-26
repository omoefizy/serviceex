// Library sync between paired computers: each lists its songs, themes, fonts, media and presentations by the
// SHA-256 of their content, and fetches what it does not have yet. Content it already has under any name is never
// fetched again, and the same content offered by two computers is fetched once. Transfers run in the background,
// keep to a bandwidth limit, and wait while a slide is live so they never compete with the show. Nothing here
// touches Electron; the main process supplies the library (libraryStore.ts).

import { createHash } from 'node:crypto'
import { appendFile, open as openFile, rm, writeFile } from 'node:fs/promises'
import type { LibrarySyncFile } from '../../shared/types'
import { RefusedError, secureCall, type PeerTarget } from './client'
import type { LibraryEntry } from './protocol'

/** Entries larger than this wait while a slide is live; songs and themes are far smaller and go through. */
export const LARGE_BYTES = 2 * 1024 * 1024
const CHUNK = 256 * 1024
const SHA = /^[0-9a-f]{64}$/

/** An entry here, with where its bytes are: a file, or JSON written for a song or theme. */
export interface IndexedEntry extends LibraryEntry {
  file?: string
  bytes?: Buffer
}

export const sha256Of = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

/** Bytes of an entry for libraryChunk. */
export async function readEntry(entry: IndexedEntry, offset: number, length: number): Promise<Buffer> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.size) throw new RangeError('Bad offset')
  const count = Math.max(0, Math.min(length, CHUNK, entry.size - offset))
  if (entry.bytes) return entry.bytes.subarray(offset, offset + count)
  if (!entry.file) return Buffer.alloc(0)
  const handle = await openFile(entry.file, 'r')
  try {
    const buffer = Buffer.alloc(count)
    const { bytesRead } = await handle.read(buffer, 0, count, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Checks an index from another computer: well formed entries only. */
export function cleanEntries(value: unknown): LibraryEntry[] {
  const kinds = ['song', 'theme', 'font', 'media', 'presentation']
  return (Array.isArray(value) ? value.slice(0, 20_000) : []).filter((e): e is LibraryEntry => {
    const entry = e as Partial<LibraryEntry> | null
    return (
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.sha256 === 'string' &&
      SHA.test(entry.sha256) &&
      kinds.includes(entry.kind as string) &&
      typeof entry.name === 'string' &&
      Number.isSafeInteger(entry.size) &&
      (entry.size as number) >= 0
    )
  })
}

/**
 * What to fetch: every entry another computer has whose content is not here, each content once, from the first
 * computer offering it. Deduplication is by hash only, so a renamed copy is not fetched again.
 */
export function planFetch(local: readonly LibraryEntry[], remotes: readonly { peerId: string; peerName: string; entries: readonly LibraryEntry[] }[]): LibrarySyncFile[] {
  const have = new Set(local.map((e) => e.sha256))
  const plan: LibrarySyncFile[] = []
  for (const remote of remotes) {
    for (const entry of remote.entries) {
      if (have.has(entry.sha256)) continue
      have.add(entry.sha256)
      plan.push({ sha256: entry.sha256, kind: entry.kind, name: entry.name, peerId: remote.peerId, peerName: remote.peerName, size: entry.size, received: 0, state: 'waiting' })
    }
  }
  // Small things first, so songs and themes arrive before a long video.
  return plan.sort((a, b) => a.size - b.size)
}

export interface FetchOptions {
  /** KB per second; 0 for no limit. */
  bandwidthKbps(): number
  /** Why a large transfer must wait now (a slide is live, say), or null. */
  pauseReason(): string | null
  onProgress(received: number): void
  /** Stops the transfer at the next chunk. */
  cancelled(): boolean
  /** How long to wait before asking again while paused or busy; 1 second by default. */
  waitMs?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Pulls one entry from another computer into `dest` and checks its hash. */
export async function fetchEntry(target: PeerTarget, myId: string, file: LibrarySyncFile, dest: string, options: FetchOptions): Promise<void> {
  const wait = options.waitMs ?? 1000
  await writeFile(dest, Buffer.alloc(0))
  const started = Date.now()
  let offset = 0
  try {
    while (offset < file.size || (offset === 0 && file.size === 0)) {
      if (options.cancelled()) throw new RefusedError('Library sync was stopped')
      if (file.size > LARGE_BYTES && options.pauseReason()) {
        await sleep(wait)
        continue
      }
      const limit = options.bandwidthKbps()
      const length = limit > 0 ? Math.max(4096, Math.min(CHUNK, limit * 1024)) : CHUNK
      const { header, body } = await secureCall(target, myId, 'libraryChunk', { sha256: file.sha256, offset, length })
      if (!header.ok) {
        // The other computer has a slide live: it asks to wait rather than refusing.
        if (header.code === 'busy') {
          await sleep(wait)
          continue
        }
        throw new RefusedError(header.error)
      }
      if (header.size !== file.size) throw new RefusedError(`${file.name} changed on ${target.name} while it was being copied`)
      if (body.length === 0) break
      await appendFile(dest, body)
      offset += body.length
      options.onProgress(offset)
      // Keep to the limit: wait until the bytes so far fit the time so far.
      if (limit > 0) {
        const due = (offset / (limit * 1024)) * 1000 - (Date.now() - started)
        if (due > 0) await sleep(due)
      }
      if (file.size === 0) break
    }
    const hash = createHash('sha256')
    const handle = await openFile(dest, 'r')
    try {
      for await (const chunk of handle.createReadStream()) hash.update(chunk as Buffer)
    } finally {
      await handle.close().catch(() => {})
    }
    if (hash.digest('hex') !== file.sha256) throw new RefusedError(`${file.name} was damaged on the way (its checksum does not match)`)
  } catch (error) {
    await rm(dest, { force: true })
    throw error
  }
}
