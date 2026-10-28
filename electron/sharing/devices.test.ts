// Device sharing on this machine: the shared service (filters, last write wins with a logical clock, offline edits
// that resync), library sync deduplication, and the new sealed operations refusing a device that is not paired.
// Servers run for real on localhost; nothing here touches Electron.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanCue } from '../../shared/cues'
import { compareStamps, LamportClock, mergeItems, newItem, visibleItems } from '../../shared/sharedService'
import type { SharedItem, SharedServiceState } from '../../shared/types'
import { completePairing, RefusedError, requestPairing, secureRequest, type PeerTarget } from './client'
import { channelKey, randomId, seal } from './crypto'
import { Inbox } from './inbox'
import { fetchEntry, planFetch, readEntry, sha256Of, type IndexedEntry } from './librarySync'
import { PeerStore } from './peers'
import { FROM_HEADER, requestAad, type LibraryEntry } from './protocol'
import { ShareServer } from './server'
import { SharedServiceSession, type ServiceTransport } from './sharedService'
import { makeTempDir, removeTemp } from '../tempDir.test-helper'

const plainCodec = { encrypt: (b: Buffer) => b, decrypt: (b: Buffer) => b }
const id = (n: number) => n.toString(16).padStart(32, '0')

let work: string
const servers: ShareServer[] = []
const stores: PeerStore[] = []

beforeEach(async () => {
  work = await makeTempDir('serviceex-devices-')
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
  // Writes still going (a new store's identity, a remembered address) would race the folder's removal.
  await Promise.all(stores.splice(0).map((s) => s.flushed()))
  await removeTemp(work)
})

// ---------- Shared service ----------

const note = (title: string) => ({ type: 'note' as const, payload: { title, text: '' } })

/** A transport that calls a host session directly, and can be cut off like a host going offline. */
function directTransport(host: () => SharedServiceSession, member: { id: string; name: string }) {
  const link = { online: true }
  const transport: ServiceTransport = {
    async join() {
      if (!link.online) throw new Error('Host offline')
      return host().snapshot(member.id, member.name)
    },
    async sync(_hostId, request) {
      if (!link.online) throw new Error('Host offline')
      // Through JSON, as over the network.
      return JSON.parse(JSON.stringify(host().receive(member.id, member.name, JSON.parse(JSON.stringify(request)))))
    },
  }
  return { transport, link }
}

function makeSession(deviceId: string, name: string, transport: ServiceTransport, file: string | null = null) {
  const states: SharedServiceState[] = []
  const session = new SharedServiceSession({ file, deviceId, deviceName: () => name, transport, onChange: (s) => states.push(s) })
  return { session, states }
}

const titles = (items: SharedItem[]) => visibleItems(items, { kind: 'all' }, '').map((i) => i.payload.title)

describe('shared service', () => {
  it('lists an item tagged to a device under that device, and under My items only on that device', async () => {
    const hostId = id(1)
    const memberId = id(2)
    const { session: host } = makeSession(hostId, 'Front', { join: async () => Promise.reject(), sync: async () => Promise.reject() })
    await host.host('Sunday', [note('Welcome'), note('Offering')])
    const offering = host.state().items.find((i) => i.payload.title === 'Offering')!
    host.update(offering.id, { ownerDevice: memberId })

    const items = host.state().items
    expect(visibleItems(items, { kind: 'device', deviceId: memberId }, hostId).map((i) => i.payload.title)).toEqual(['Offering'])
    expect(visibleItems(items, { kind: 'mine' }, memberId).map((i) => i.payload.title)).toEqual(['Offering'])
    expect(visibleItems(items, { kind: 'mine' }, hostId)).toEqual([])
    expect(titles(items)).toEqual(['Welcome', 'Offering'])
    // Removed items leave every filter.
    host.update(offering.id, { deleted: true })
    expect(visibleItems(host.state().items, { kind: 'device', deviceId: memberId }, hostId)).toEqual([])
  })

  it('keeps the last write per item by logical clock, whatever the wall clocks say', () => {
    const a = id(10)
    const b = id(11)
    const clockA = new LamportClock()
    const clockB = new LamportClock(500)
    const base = newItem(id(99), 'note', { title: 'Base', text: '' }, 1, clockA, a)
    // B has seen A's item; B's later change wins even though A's clock is far behind.
    clockB.observe(base.updatedAt)
    const fromB = { ...base, payload: { title: 'From B', text: '' }, updatedAt: clockB.tick(), updatedBy: b }
    const fromA = { ...base, payload: { title: 'From A', text: '' }, updatedAt: base.updatedAt + 1, updatedBy: a }
    expect(mergeItems([base], [fromA, fromB]).items[0].payload.title).toBe('From B')
    expect(mergeItems([base], [fromB, fromA]).items[0].payload.title).toBe('From B')
    // An older change arriving late changes nothing.
    expect(mergeItems([fromB], [fromA]).changed).toEqual([])
    // Equal clocks settle the same way on every computer.
    const tieA = { ...base, updatedAt: 7, updatedBy: a, payload: { title: 'A', text: '' } }
    const tieB = { ...base, updatedAt: 7, updatedBy: b, payload: { title: 'B', text: '' } }
    expect(compareStamps(tieB, tieA)).toBeGreaterThan(0)
    expect(mergeItems([tieA], [tieB]).items[0].payload.title).toBe(mergeItems([tieB], [tieA]).items[0].payload.title)
  })

  it('resolves two members editing one item: the later change wins on every computer', async () => {
    const { session: host } = makeSession(id(1), 'Front', { join: async () => Promise.reject(), sync: async () => Promise.reject() })
    await host.host('Sunday', [note('Song')])
    const m1 = directTransport(() => host, { id: id(2), name: 'Booth' })
    const m2 = directTransport(() => host, { id: id(3), name: 'Stage' })
    const { session: one } = makeSession(id(2), 'Booth', m1.transport)
    const { session: two } = makeSession(id(3), 'Stage', m2.transport)
    await one.join(id(1))
    await two.join(id(1))
    const item = host.state().items[0]

    one.update(item.id, { payload: { title: 'First', text: '' } })
    await one.sync()
    await two.sync()
    // Two has now seen One's change, so its own edit is later and wins.
    two.update(item.id, { payload: { title: 'Second', text: '' } })
    await two.sync()
    await one.sync()
    for (const session of [host, one, two]) expect(titles(session.state().items)).toEqual(['Second'])
    expect(one.state().items[0].updatedBy).toBe(id(3))
  })

  it('keeps working while the host is offline and resyncs without losing changes', async () => {
    const { session: host } = makeSession(id(1), 'Front', { join: async () => Promise.reject(), sync: async () => Promise.reject() })
    await host.host('Sunday', [note('Welcome')])
    const file = path.join(work, 'member.json')
    const link = directTransport(() => host, { id: id(2), name: 'Booth' })
    let { session: member } = makeSession(id(2), 'Booth', link.transport, file)
    await member.join(id(1))

    link.link.online = false
    member.add([note('Added offline')])
    member.update(member.state().items.find((i) => i.payload.title === 'Welcome')!.id, { ownerDevice: id(2) })
    await member.sync()
    expect(member.state()).toMatchObject({ connected: false, pending: 2 })
    // The host carries on too.
    host.add([note('Added on host')])

    // The member restarts while offline: its changes are on disk.
    await member.flushed()
    member = makeSession(id(2), 'Booth', link.transport, file).session
    expect(member.state().pending).toBe(2)

    link.link.online = true
    await member.sync()
    expect(member.state()).toMatchObject({ connected: true, pending: 0 })
    for (const session of [host, member]) {
      expect([...titles(session.state().items)].sort()).toEqual(['Added offline', 'Added on host', 'Welcome'])
      expect(session.state().items.find((i) => i.payload.title === 'Welcome')!.ownerDevice).toBe(id(2))
    }
    // Both were added at the end at the same time; they come out in the same order on both computers.
    expect(titles(member.state().items)).toEqual(titles(host.state().items))
    await member.flushed()
    expect(JSON.parse(await readFile(file, 'utf8')).dirty).toEqual([])
  })
})

// ---------- Over the network ----------

interface Computer {
  folder: string
  peers: PeerStore
  server: ShareServer
  port: number
  requests: string[]
  cues: unknown[]
  library: Map<string, IndexedEntry>
  session: SharedServiceSession
}

async function startComputer(name: string): Promise<Computer> {
  const folder = await mkdtemp(path.join(work, 'computer-'))
  const peers = new PeerStore(folder, plainCodec)
  stores.push(peers)
  const computer = { folder, peers, requests: [], cues: [], library: new Map() } as unknown as Computer
  computer.session = new SharedServiceSession({
    file: null,
    deviceId: peers.deviceId,
    deviceName: () => name,
    transport: { join: async () => Promise.reject(), sync: async () => Promise.reject() },
    onChange: () => {},
  })
  computer.server = new ShareServer({
    peers,
    inbox: new Inbox(path.join(folder, 'inbox')),
    deviceName: () => name,
    limitMb: () => 100,
    onPairRequest: (request) => computer.requests.push(request.code),
    onPairEnded: () => {},
    onReceived: () => {},
    // The cue and shared service answers, as electron/ipc/sharing.ts gives them.
    async handle(op, from, header) {
      if (op === 'cue') {
        const cue = cleanCue(header.cue)
        if (!cue) return { ok: false, error: 'Empty cue', code: 'bad' }
        computer.cues.push(cue)
        return { ok: true, received: true }
      }
      if (op === 'serviceJoin') return { ok: true, ...computer.session.snapshot(from.id, from.name) }
      if (op === 'serviceSync') return { ok: true, ...computer.session.receive(from.id, from.name, header as never) }
      if (op === 'libraryIndex') return { ok: true, entries: [...computer.library.values()].map(({ sha256, kind, name, size }) => ({ sha256, kind, name, size })) }
      if (op === 'libraryChunk') {
        const entry = computer.library.get(header.sha256 as string)
        if (!entry) return { ok: false, error: 'Gone', code: 'unknown' }
        return { response: { ok: true, size: entry.size }, body: await readEntry(entry, Number(header.offset), Number(header.length)) }
      }
      return { ok: true, liveTitle: null, hosting: null }
    },
  })
  computer.port = await computer.server.listen(0, '127.0.0.1')
  servers.push(computer.server)
  return computer
}

/** Pairs `from` with `to` as the app does, and returns how `from` reaches `to`. */
async function pair(to: Computer, from: Computer, name = 'Front'): Promise<PeerTarget> {
  const endpoint = { host: '127.0.0.1', port: to.port }
  const me = { id: from.peers.deviceId, name: 'Booth', port: from.port }
  const { pairingId } = await requestPairing(endpoint, name, me)
  const secret = await completePairing(endpoint, { id: to.peers.deviceId, name }, me, pairingId, to.requests.at(-1)!)
  await from.peers.add({ id: to.peers.deviceId, name, secret, host: '127.0.0.1', port: to.port })
  return { id: to.peers.deviceId, name, secret, ...endpoint }
}

describe('sealed device operations', () => {
  it('joins and syncs a shared service hosted by a paired computer', async () => {
    const front = await startComputer('Front')
    const booth = await startComputer('Booth')
    const toFront = await pair(front, booth)
    await front.session.host('Sunday', [note('Welcome')])
    const call = async (op: 'serviceJoin' | 'serviceSync', fields: object) => {
      const answer = await secureRequest(toFront, booth.peers.deviceId, op, fields as never)
      if (!answer.ok) throw new RefusedError(answer.error)
      return answer as never
    }
    const member = new SharedServiceSession({
      file: null,
      deviceId: booth.peers.deviceId,
      deviceName: () => 'Booth',
      transport: { join: () => call('serviceJoin', {}), sync: (_host, request) => call('serviceSync', request) },
      onChange: () => {},
    })
    await member.join(front.peers.deviceId)
    member.add([note('From the booth')])
    await member.sync()
    expect(titles(front.session.state().items)).toEqual(['Welcome', 'From the booth'])
    expect(front.session.state().items[1].updatedBy).toBe(booth.peers.deviceId)
  })

  it('refuses cues, shared service and library requests from a computer that is not paired', async () => {
    const front = await startComputer('Front')
    const stranger = await startComputer('Stranger')
    await front.session.host('Sunday', [note('Welcome')])
    front.library.set('x', { sha256: 'x'.repeat(64), kind: 'song', name: 'Song', size: 2, bytes: Buffer.from('{}') })
    // A made-up key: the stranger never paired, so the receiver has no key for it at all.
    const fake: PeerTarget = { id: front.peers.deviceId, name: 'Front', secret: Buffer.alloc(32, 7), host: '127.0.0.1', port: front.port }
    for (const [op, fields] of [
      ['cue', { cue: { kind: 'text', title: 'Hi', text: 'Hello' } }],
      ['serviceJoin', {}],
      ['serviceSync', { id: randomId(), since: 0, changes: [], clock: 0 }],
      ['libraryIndex', {}],
      ['libraryChunk', { sha256: 'x'.repeat(64), offset: 0, length: 10 }],
      ['presence', { liveTitle: 'Spy', hosting: null }],
    ] as const) {
      await expect(secureRequest(fake, stranger.peers.deviceId, op, fields as never), op).rejects.toThrow(/not paired/)
    }
    expect(front.cues).toEqual([])

    // A paired computer whose pairing was forgotten here is refused the same way, even with the right header.
    const booth = await startComputer('Booth')
    const toFront = await pair(front, booth)
    await front.peers.forget(booth.peers.deviceId)
    await expect(secureRequest(toFront, booth.peers.deviceId, 'cue', { cue: { kind: 'note', title: 'Note', text: 'x' } })).rejects.toThrow(/not paired/)

    // A forged envelope under a paired device's id, sealed with the wrong key, is refused too.
    const again = await pair(front, booth)
    const envelope = seal(channelKey(Buffer.alloc(32, 1), booth.peers.deviceId, front.peers.deviceId, 'request'), requestAad(booth.peers.deviceId, front.peers.deviceId), {
      op: 'cue',
      nonce: randomId(),
      ts: Date.now(),
      cue: { kind: 'text', title: 'Forged', text: 'Forged' },
    })
    const res = await fetch(`http://127.0.0.1:${front.port}/v1/secure`, { method: 'POST', headers: { [FROM_HEADER]: booth.peers.deviceId }, body: new Uint8Array(envelope) })
    expect(res.status).toBe(401)
    expect(front.cues).toEqual([])
    // The real pairing still works.
    expect(await secureRequest(again, booth.peers.deviceId, 'cue', { cue: { kind: 'text', title: 'Text', text: '  Exactly this  ' } })).toMatchObject({ ok: true })
    expect(front.cues).toEqual([{ kind: 'text', title: 'Text', text: '  Exactly this  ' }])
  })

  it('refuses everything from a paired device that was disconnected here', async () => {
    const front = await startComputer('Front')
    const booth = await startComputer('Booth')
    const toFront = await pair(front, booth)
    await front.peers.update(booth.peers.deviceId, { disconnected: true })
    expect(await secureRequest(toFront, booth.peers.deviceId, 'cue', { cue: { kind: 'note', title: 'Note', text: 'x' } })).toMatchObject({ ok: false, code: 'disconnected' })
    expect(front.cues).toEqual([])
  })
})

describe('library sync', () => {
  const entry = (sha: string, name: string, kind: LibraryEntry['kind'] = 'media', size = 10): LibraryEntry => ({ sha256: sha.repeat(64).slice(0, 64), kind, name, size })

  it('fetches only content this computer does not have, once, whatever it is called', () => {
    const local = [entry('a', 'Logo.png'), entry('b', 'Amazing Grace', 'song')]
    const plan = planFetch(local, [
      { peerId: id(2), peerName: 'Booth', entries: [entry('a', 'Logo renamed.png'), entry('c', 'Background.mp4', 'media', 5000), entry('d', 'How Great', 'song', 300)] },
      // The same video on a third computer, and something new.
      { peerId: id(3), peerName: 'Stage', entries: [entry('c', 'Copy of Background.mp4', 'media', 5000), entry('b', 'Amazing Grace', 'song'), entry('e', 'Inter.woff2', 'font', 900)] },
    ])
    expect(plan.map((f) => [f.name, f.peerName])).toEqual([
      ['How Great', 'Booth'],
      ['Inter.woff2', 'Stage'],
      ['Background.mp4', 'Booth'],
    ])
    expect(new Set(plan.map((f) => f.sha256)).size).toBe(plan.length)
    // Once fetched, nothing is planned again.
    expect(planFetch([...local, ...plan], [{ peerId: id(2), peerName: 'Booth', entries: plan }])).toEqual([])
  })

  it('pulls a file from a paired computer, checks its hash, and waits while a slide is live', async () => {
    const front = await startComputer('Front')
    const booth = await startComputer('Booth')
    const toFront = await pair(front, booth)
    const bytes = Buffer.alloc(3 * 1024 * 1024 + 17, 3)
    const source = path.join(front.folder, 'video.mp4')
    await writeFile(source, bytes)
    const shared: IndexedEntry = { sha256: sha256Of(bytes), kind: 'media', name: 'video.mp4', size: bytes.length, file: source }
    front.library.set(shared.sha256, shared)

    const answer = await secureRequest(toFront, booth.peers.deviceId, 'libraryIndex', {})
    const plan = planFetch([], [{ peerId: front.peers.deviceId, peerName: 'Front', entries: answer.ok ? answer.entries : [] }])
    expect(plan).toHaveLength(1)

    let live = true
    let waits = 0
    const progress: number[] = []
    const dest = path.join(booth.folder, 'fetched')
    const done = fetchEntry(toFront, booth.peers.deviceId, plan[0], dest, {
      bandwidthKbps: () => 0,
      pauseReason: () => {
        if (live) waits++
        // The slide comes off the output after a few checks.
        if (waits >= 3) live = false
        return live ? 'A slide is live' : null
      },
      onProgress: (received) => progress.push(received),
      cancelled: () => false,
      waitMs: 5,
    })
    await done
    expect(waits).toBeGreaterThanOrEqual(3)
    // Nothing moved until the slide was off.
    expect(progress[0]).toBeGreaterThan(0)
    expect((await readFile(dest)).equals(bytes)).toBe(true)
  })
})
