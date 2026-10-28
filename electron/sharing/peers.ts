// This computer's sharing identity and the devices it has paired with, kept in <userData>/sharing/peers.json.
// Shared keys are encrypted by the codec (Electron's safeStorage in the app); nothing here touches Electron.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PairedDevice } from '../../shared/types'
import { randomId } from './crypto'

/** Encrypts keys at rest. Throws when the system cannot. */
export interface SecretCodec {
  encrypt(plain: Buffer): Buffer
  decrypt(sealed: Buffer): Buffer
}

export interface PeerRecord extends PairedDevice {
  /** The shared key from pairing. */
  secret: Buffer
  /** Where it was last reached, for when mDNS does not find it. */
  host: string | null
  port: number | null
}

interface StoredPeer extends PairedDevice {
  secret: string
  host: string | null
  port: number | null
}

interface StoredFile {
  deviceId: string
  peers: StoredPeer[]
}

const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)

export class PeerStore {
  readonly deviceId: string
  private readonly file: string
  private readonly codec: SecretCodec
  private peers = new Map<string, PeerRecord>()
  /** The write in progress, if any; settles once the file holds everything saved so far. */
  private saving: Promise<void> = Promise.resolve()

  constructor(folder: string, codec: SecretCodec) {
    this.file = path.join(folder, 'peers.json')
    this.codec = codec
    let stored: Partial<StoredFile> = {}
    try {
      if (existsSync(this.file)) stored = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredFile>
    } catch (error) {
      console.error('Could not read the paired devices; pair them again.', error)
    }
    this.deviceId = isId(stored.deviceId) ? stored.deviceId : randomId()
    for (const peer of Array.isArray(stored.peers) ? stored.peers : []) {
      if (!isId(peer?.id) || typeof peer.secret !== 'string') continue
      try {
        this.peers.set(peer.id, {
          id: peer.id,
          name: typeof peer.name === 'string' ? peer.name : 'Unknown device',
          alias: typeof peer.alias === 'string' ? peer.alias.slice(0, 40) : '',
          trusted: peer.trusted === true,
          disconnected: peer.disconnected === true,
          pairedAt: typeof peer.pairedAt === 'string' ? peer.pairedAt : new Date(0).toISOString(),
          secret: codec.decrypt(Buffer.from(peer.secret, 'base64')),
          host: typeof peer.host === 'string' ? peer.host : null,
          port: Number.isInteger(peer.port) ? peer.port : null,
        })
      } catch {
        // A key that can no longer be decrypted (another user account, a reset keychain) means pairing again.
      }
    }
    if (!isId(stored.deviceId)) this.save().catch(console.error)
  }

  get(id: string): PeerRecord | undefined {
    return this.peers.get(id)
  }

  list(): PairedDevice[] {
    return [...this.peers.values()].map(({ id, name, alias, trusted, disconnected, pairedAt }) => ({ id, name, alias, trusted, disconnected, pairedAt }))
  }

  async add(peer: { id: string; name: string; secret: Buffer; host?: string | null; port?: number | null }): Promise<PairedDevice> {
    const existing = this.peers.get(peer.id)
    const record: PeerRecord = {
      id: peer.id,
      name: peer.name,
      alias: existing?.alias ?? '',
      trusted: existing?.trusted ?? false,
      // Pairing again connects a device that was disconnected.
      disconnected: false,
      pairedAt: new Date().toISOString(),
      secret: peer.secret,
      host: peer.host ?? existing?.host ?? null,
      port: peer.port ?? existing?.port ?? null,
    }
    this.peers.set(peer.id, record)
    await this.save()
    return { id: record.id, name: record.name, alias: record.alias, trusted: record.trusted, disconnected: record.disconnected, pairedAt: record.pairedAt }
  }

  async update(id: string, patch: Partial<Pick<PeerRecord, 'name' | 'alias' | 'trusted' | 'disconnected' | 'host' | 'port'>>): Promise<void> {
    const peer = this.peers.get(id)
    if (!peer) return
    const next = { ...peer, ...patch }
    if ((Object.keys(patch) as (keyof typeof patch)[]).every((key) => next[key] === peer[key])) return
    this.peers.set(id, next)
    await this.save()
  }

  async forget(id: string): Promise<void> {
    if (this.peers.delete(id)) await this.save()
  }

  /** Settles once every change so far is on disk, including the identity a new store writes on its own. */
  flushed(): Promise<void> {
    return this.saving
  }

  /**
   * Writes one at a time: two writes at once would share the temp file, so one rename finds it gone, and an older
   * state could land last. Each write takes the state when its turn comes, so the file always ends with the latest.
   */
  private save(): Promise<void> {
    const write = this.saving.then(() => this.write())
    this.saving = write.catch(() => {})
    return write
  }

  private async write(): Promise<void> {
    const stored: StoredFile = {
      deviceId: this.deviceId,
      peers: [...this.peers.values()].map((peer) => ({ ...peer, secret: this.codec.encrypt(peer.secret).toString('base64') })),
    }
    await mkdir(path.dirname(this.file), { recursive: true })
    // Written beside and renamed over, so a crash never leaves half a file.
    const temp = `${this.file}.tmp`
    await writeFile(temp, JSON.stringify(stored, null, 2), { mode: 0o600 })
    await rename(temp, this.file)
  }
}
