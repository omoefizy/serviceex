// A shared service on this computer, as its host or as a member. Kept in <userData>/sharing/shared-service.json so
// it survives a restart, and so a member keeps working when the host goes away: changes made meanwhile wait in
// `dirty` and go to the host on the next sync, where the newer change wins per item (see shared/sharedService.ts).
//
// Members ask the host about once a second, sending what changed here and getting what changed there since the
// host revision they last saw. The host numbers every change it accepts, so a change made offline with an older
// clock still reaches members who synced in the meantime. Nothing here touches Electron.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cleanPayload, cleanSharedItems, editItem, LamportClock, mergeItems, newItem, orderBetween, visibleItems } from '../../shared/sharedService'
import type { SharedItem, SharedItemInput, SharedItemPatch, SharedServiceState } from '../../shared/types'
import { randomId } from './crypto'
import type { SecureOps, ServiceSnapshot } from './protocol'

/** How a member reaches the host: the sealed requests, answering ok or throwing. */
export interface ServiceTransport {
  join(hostId: string): Promise<ServiceSnapshot>
  sync(hostId: string, request: SecureOps['serviceSync']['request']): Promise<SecureOps['serviceSync']['response']>
}

interface Stored {
  role: 'none' | 'host' | 'member'
  id: string | null
  name: string
  hostId: string | null
  hostName: string
  items: SharedItem[]
  clock: number
  names: Record<string, string>
  /** Member: the host revision it has everything up to. Host: its latest revision. */
  rev: number
  /** Host: the revision each item last changed at. */
  itemRevs: Record<string, number>
  /** Member: items changed here that the host has not confirmed. */
  dirty: string[]
  lastSyncAt: string | null
}

const EMPTY: Stored = { role: 'none', id: null, name: '', hostId: null, hostName: '', items: [], clock: 0, names: {}, rev: 0, itemRevs: {}, dirty: [], lastSyncAt: null }

export interface SessionOptions {
  /** The file it is kept in; null keeps it in memory only. */
  file: string | null
  deviceId: string
  deviceName(): string
  transport: ServiceTransport
  onChange(state: SharedServiceState): void
}

export class SharedServiceSession {
  private readonly options: SessionOptions
  private stored: Stored
  private readonly clock: LamportClock
  private connected = true
  private error: string | null = null
  private syncing: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(options: SessionOptions) {
    this.options = options
    this.stored = { ...EMPTY }
    try {
      if (options.file && existsSync(options.file)) {
        const raw = JSON.parse(readFileSync(options.file, 'utf8')) as Partial<Stored>
        this.stored = {
          ...EMPTY,
          ...raw,
          items: cleanSharedItems(raw.items),
          names: typeof raw.names === 'object' && raw.names !== null ? raw.names : {},
          itemRevs: typeof raw.itemRevs === 'object' && raw.itemRevs !== null ? raw.itemRevs : {},
          dirty: Array.isArray(raw.dirty) ? raw.dirty.filter((id) => typeof id === 'string') : [],
        }
      }
    } catch (error) {
      console.error('Could not read the shared service; starting without one.', error)
    }
    this.clock = new LamportClock(this.stored.clock)
    for (const item of this.stored.items) this.clock.observe(item.updatedAt)
  }

  get role() {
    return this.stored.role
  }

  get hostId() {
    return this.stored.hostId
  }

  state(): SharedServiceState {
    const s = this.stored
    return {
      role: s.role,
      id: s.id,
      name: s.name,
      hostId: s.hostId,
      hostName: s.hostName,
      items: s.items,
      names: { ...s.names, [this.options.deviceId]: this.options.deviceName() },
      connected: s.role === 'host' || this.connected,
      pending: s.dirty.length,
      lastSyncAt: s.lastSyncAt,
      error: this.error,
    }
  }

  /** What other computers see in presence: the service this one hosts. */
  hosting(): { id: string; name: string } | null {
    return this.stored.role === 'host' && this.stored.id ? { id: this.stored.id, name: this.stored.name } : null
  }

  // ---------- Starting and leaving ----------

  async host(name: string, inputs: SharedItemInput[]): Promise<SharedServiceState> {
    const id = randomId()
    this.stored = { ...EMPTY, role: 'host', id, name: name.trim().slice(0, 120) || 'Shared service', hostId: this.options.deviceId, hostName: this.options.deviceName() }
    this.connected = true
    this.error = null
    this.insert(inputs)
    return this.changed()
  }

  async join(hostId: string): Promise<SharedServiceState> {
    const snapshot = await this.options.transport.join(hostId)
    const items = cleanSharedItems(snapshot.items)
    // Joining the same service again (after a restart, say) keeps changes made here meanwhile.
    const again = this.stored.role === 'member' && this.stored.id === snapshot.id
    const merged = again ? mergeItems(items, this.stored.items.filter((item) => this.stored.dirty.includes(item.id))).items : items
    this.clock.observe(snapshot.clock)
    for (const item of items) this.clock.observe(item.updatedAt)
    this.stored = {
      ...EMPTY,
      role: 'member',
      id: snapshot.id,
      name: snapshot.name,
      hostId: snapshot.hostId,
      hostName: snapshot.hostName,
      items: merged,
      names: snapshot.names,
      rev: snapshot.rev,
      dirty: again ? this.stored.dirty : [],
      lastSyncAt: new Date().toISOString(),
    }
    this.connected = true
    this.error = null
    return this.changed()
  }

  async leave(): Promise<SharedServiceState> {
    this.stored = { ...EMPTY }
    this.connected = true
    this.error = null
    return this.changed()
  }

  // ---------- Changes made here ----------

  /** Adds items after the last one. */
  add(inputs: SharedItemInput[]): SharedServiceState {
    if (this.stored.role === 'none') throw new Error('Host or join a shared service first')
    this.insert(inputs)
    return this.changed()
  }

  update(id: string, patch: SharedItemPatch): SharedServiceState {
    const item = this.stored.items.find((i) => i.id === id)
    if (!item) throw new Error('That item is no longer in the shared service')
    const clean: SharedItemPatch = {}
    if (typeof patch.order === 'number' && Number.isFinite(patch.order)) clean.order = patch.order
    if (patch.ownerDevice === null || (typeof patch.ownerDevice === 'string' && /^[0-9a-f]{32}$/.test(patch.ownerDevice))) clean.ownerDevice = patch.ownerDevice
    if (typeof patch.deleted === 'boolean') clean.deleted = patch.deleted
    if (patch.payload !== undefined) {
      const payload = cleanPayload(item.type, patch.payload)
      if (!payload) throw new Error('That change is not valid for this item')
      clean.payload = payload
    }
    this.local([editItem(item, clean, this.clock, this.options.deviceId)])
    return this.changed()
  }

  private insert(inputs: SharedItemInput[]): void {
    let order = visibleItems(this.stored.items, { kind: 'all' }, this.options.deviceId).at(-1)?.order
    const created: SharedItem[] = []
    for (const input of inputs) {
      const payload = cleanPayload(input.type, input.payload)
      if (!payload) continue
      order = orderBetween(order, undefined)
      created.push(newItem(randomId(), input.type, payload, order, this.clock, this.options.deviceId, input.ownerDevice ?? null))
    }
    this.local(created)
  }

  private local(items: SharedItem[]): void {
    const { items: merged, changed } = mergeItems(this.stored.items, items)
    this.stored.items = merged
    if (this.stored.role === 'host') this.bump(changed)
    else for (const item of changed) if (!this.stored.dirty.includes(item.id)) this.stored.dirty.push(item.id)
  }

  /** Host: numbers accepted changes so members can ask for what changed since. */
  private bump(changed: SharedItem[]): void {
    for (const item of changed) {
      this.stored.rev += 1
      this.stored.itemRevs[item.id] = this.stored.rev
    }
  }

  // ---------- Host side ----------

  snapshot(fromId: string, fromName: string): ServiceSnapshot {
    if (this.stored.role !== 'host' || !this.stored.id) throw new Error('This computer is not hosting a shared service')
    this.stored.names[fromId] = fromName
    return {
      id: this.stored.id,
      name: this.stored.name,
      hostId: this.options.deviceId,
      hostName: this.options.deviceName(),
      items: this.stored.items,
      rev: this.stored.rev,
      clock: this.clock.now,
      names: this.state().names,
    }
  }

  /** Host: takes a member's changes and answers with everything changed since its revision. */
  receive(fromId: string, fromName: string, request: SecureOps['serviceSync']['request']): SecureOps['serviceSync']['response'] {
    if (this.stored.role !== 'host' || this.stored.id !== request.id) throw new Error('That shared service has ended on the host')
    const incoming = cleanSharedItems(request.changes)
    this.clock.observe(request.clock)
    for (const item of incoming) this.clock.observe(item.updatedAt)
    const { items, changed } = mergeItems(this.stored.items, incoming)
    this.stored.items = items
    this.bump(changed)
    const knew = this.stored.names[fromId] === fromName
    this.stored.names[fromId] = fromName
    if (changed.length > 0 || !knew) this.changed()
    const since = Number.isSafeInteger(request.since) ? request.since : 0
    return {
      rev: this.stored.rev,
      items: this.stored.items.filter((item) => (this.stored.itemRevs[item.id] ?? 0) > since),
      clock: this.clock.now,
      names: this.state().names,
    }
  }

  // ---------- Member side ----------

  /** Member: one round trip with the host. Failing leaves everything here as it was, to send next time. */
  sync(): Promise<void> {
    if (this.stored.role !== 'member' || !this.stored.hostId || !this.stored.id) return Promise.resolve()
    this.syncing ??= this.syncOnce().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async syncOnce(): Promise<void> {
    const { hostId, id } = this.stored
    const sent = this.stored.items.filter((item) => this.stored.dirty.includes(item.id))
    try {
      const answer = await this.options.transport.sync(hostId as string, { id: id as string, since: this.stored.rev, changes: sent, clock: this.clock.now })
      // Left or joined something else meanwhile.
      if (this.stored.id !== id) return
      const incoming = cleanSharedItems(answer.items)
      this.clock.observe(answer.clock)
      for (const item of incoming) this.clock.observe(item.updatedAt)
      const before = JSON.stringify(this.stored.items)
      this.stored.items = mergeItems(this.stored.items, incoming).items
      // Confirmed unless changed again while the request was out.
      const sentStamps = new Map(sent.map((item) => [item.id, item.updatedAt]))
      this.stored.dirty = this.stored.dirty.filter((itemId) => this.stored.items.find((i) => i.id === itemId)?.updatedAt !== sentStamps.get(itemId))
      this.stored.rev = Math.max(this.stored.rev, answer.rev)
      this.stored.names = answer.names
      this.stored.lastSyncAt = new Date().toISOString()
      const news = !this.connected || this.error !== null || sent.length > 0 || JSON.stringify(this.stored.items) !== before
      this.connected = true
      this.error = null
      if (news) this.changed()
      else this.save()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.connected || this.error !== message) {
        this.connected = false
        this.error = message
        this.changed()
      }
    }
  }

  /** Syncs about once a second while this computer is a member. */
  start(intervalMs = 1000): void {
    this.stop()
    this.timer = setInterval(() => {
      this.sync().catch(console.error)
    }, intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // ---------- Keeping it ----------

  private changed(): SharedServiceState {
    this.stored.clock = this.clock.now
    this.save()
    const state = this.state()
    this.options.onChange(state)
    return state
  }

  private save(): void {
    const file = this.options.file
    if (!file) return
    this.stored.clock = this.clock.now
    const json = JSON.stringify(this.stored)
    // One write at a time, in order, each over a temporary file so a crash never leaves half of one.
    this.saving = this.saving
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(`${file}.tmp`, json)
        await rename(`${file}.tmp`, file)
      })
      .catch((error) => console.error('Could not save the shared service', error))
  }

  /** Resolves once everything is on disk; for tests and quitting. */
  flushed(): Promise<void> {
    return this.saving
  }
}
