// Local network sharing end to end on this machine: a real receiving server on localhost, and the sending client.
// Covers pairing with the 6 digit code, the file type allow list, the size limit, a transfer that is cut off and
// carries on where it stopped (even after the receiver restarts), the hash check, and refusing unpaired devices;
// pairing by a typed address, cancelling and declining a transfer, the incoming progress, and old partial files.
import { createHash, getDiffieHellman, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shareKindOf, shareProblem } from '../../shared/sharing'
import type { IncomingTransfer, InboxItem, PairRequest } from '../../shared/types'
import {
  CancelledError,
  completePairing,
  DeclinedError,
  hello,
  ping,
  RefusedError,
  requestPairing,
  secureRequest,
  sendFile,
  sha256File,
  transferIdFor,
  type PeerTarget,
} from './client'
import { channelKey, PAIRING_PRIME_HEX, randomId, seal } from './crypto'
import { FROM_HEADER, requestAad } from './protocol'
import { Inbox } from './inbox'
import { emptyContents, extractFile, packagePath, readPackage, writePackage } from './package'
import { PeerStore } from './peers'
import { ShareServer } from './server'
import { makeTempDir, removeTemp } from '../tempDir.test-helper'

const plainCodec = { encrypt: (b: Buffer) => b, decrypt: (b: Buffer) => b }

interface Receiver {
  folder: string
  peers: PeerStore
  inbox: Inbox
  server: ShareServer
  port: number
  requests: PairRequest[]
  ended: { pairingId: string; paired: boolean }[]
  received: InboxItem[]
  incoming: IncomingTransfer[]
  limitMb: number
}

let work: string
const receivers: Receiver[] = []
const stores: PeerStore[] = []

/** A store for `folder`, waited on after each test so no write is still going when the folder is removed. */
function peerStore(folder: string): PeerStore {
  const peers = new PeerStore(folder, plainCodec)
  stores.push(peers)
  return peers
}

/** A receiving computer with its own folder, listening on a free localhost port. */
async function startReceiver(folder?: string, limitMb = 2048): Promise<Receiver> {
  const dir = folder ?? (await mkdtemp(path.join(work, 'receiver-')))
  const receiver = {
    folder: dir,
    peers: peerStore(dir),
    inbox: new Inbox(path.join(dir, 'inbox')),
    requests: [],
    ended: [],
    received: [],
    incoming: [],
    limitMb,
  } as unknown as Receiver
  receiver.server = new ShareServer({
    peers: receiver.peers,
    inbox: receiver.inbox,
    deviceName: () => 'Sanctuary booth',
    limitMb: () => receiver.limitMb,
    onPairRequest: (request) => receiver.requests.push(request),
    onPairEnded: (pairingId, device) => receiver.ended.push({ pairingId, paired: device !== null }),
    onReceived: (item) => receiver.received.push(item),
    onIncoming: (transfer) => receiver.incoming.push(transfer),
  })
  receiver.port = await receiver.server.listen(0, '127.0.0.1')
  receivers.push(receiver)
  return receiver
}

/** A sending computer: its own identity and store. */
async function makeSender(): Promise<{ peers: PeerStore; me: { id: string; name: string; port: null } }> {
  const peers = peerStore(await mkdtemp(path.join(work, 'sender-')))
  return { peers, me: { id: peers.deviceId, name: 'Youth room', port: null } }
}

/** Pairs a sender with a receiver over HTTP, typing the code the receiver shows. */
async function pair(receiver: Receiver, sender: Awaited<ReturnType<typeof makeSender>>): Promise<PeerTarget> {
  const endpoint = { host: '127.0.0.1', port: receiver.port }
  const { pairingId } = await requestPairing(endpoint, 'Sanctuary booth', sender.me)
  const code = receiver.requests.at(-1)!.code
  const secret = await completePairing(endpoint, { id: receiver.peers.deviceId, name: 'Sanctuary booth' }, sender.me, pairingId, code)
  await sender.peers.add({ id: receiver.peers.deviceId, name: 'Sanctuary booth', secret })
  return { id: receiver.peers.deviceId, name: 'Sanctuary booth', secret, ...endpoint }
}

async function randomFile(name: string, bytes: number): Promise<string> {
  const file = path.join(work, name)
  await writeFile(file, randomBytes(bytes))
  return file
}

beforeEach(async () => {
  work = await makeTempDir('serviceex-sharing-test-')
})

afterEach(async () => {
  await Promise.all(receivers.splice(0).map((r) => r.server.close()))
  await Promise.all(stores.splice(0).map((s) => s.flushed()))
  await removeTemp(work)
})

describe('pairing', () => {
  it('uses the RFC 3526 group', () => {
    expect(PAIRING_PRIME_HEX).toBe(getDiffieHellman('modp14').getPrime('hex'))
  })

  it('shows a 6 digit code and stores the same key on both computers once it is typed', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)

    expect(receiver.requests).toHaveLength(1)
    expect(receiver.requests[0].code).toMatch(/^\d{6}$/)
    expect(receiver.requests[0].deviceName).toBe('Youth room')
    expect(receiver.ended).toEqual([{ pairingId: receiver.requests[0].pairingId, paired: true }])
    const stored = receiver.peers.get(sender.me.id)
    expect(stored?.name).toBe('Youth room')
    expect(stored?.secret.equals(target.secret)).toBe(true)
    // The key works for the sealed channel.
    expect(await ping(target, sender.me.id)).toBeGreaterThanOrEqual(0)
  })

  it('refuses a wrong code, and the code cannot be tried again', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const endpoint = { host: '127.0.0.1', port: receiver.port }
    const { pairingId } = await requestPairing(endpoint, 'Sanctuary booth', sender.me)
    const code = receiver.requests[0].code
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0')
    const peer = { id: receiver.peers.deviceId, name: 'Sanctuary booth' }

    await expect(completePairing(endpoint, peer, sender.me, pairingId, wrong)).rejects.toThrow(/did not match/)
    await expect(completePairing(endpoint, peer, sender.me, pairingId, code)).rejects.toThrow(/expired|closed|start pairing again/i)
    expect(receiver.peers.list()).toEqual([])
    expect(receiver.ended.at(-1)).toEqual({ pairingId, paired: false })
  })

  it('remembers the identity and paired devices across restarts, and forgets on request', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    await pair(receiver, sender)
    const reopened = peerStore(receiver.folder)
    expect(reopened.deviceId).toBe(receiver.peers.deviceId)
    expect(reopened.get(sender.me.id)?.secret.equals(receiver.peers.get(sender.me.id)!.secret)).toBe(true)
    await reopened.forget(sender.me.id)
    expect(new PeerStore(receiver.folder, plainCodec).list()).toEqual([])
  })

  it('pairs with a computer at a typed address and remembers where it was reached', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const endpoint = { host: '127.0.0.1', port: receiver.port }
    // As Add by IP address does: ask who is there, then pair with that id and name.
    const who = await hello(endpoint)
    expect(who).toEqual({ id: receiver.peers.deviceId, name: 'Sanctuary booth', v: 1 })
    const { pairingId } = await requestPairing(endpoint, who.name, { ...sender.me, port: 47820 })
    const secret = await completePairing(endpoint, who, sender.me, pairingId, receiver.requests[0].code)
    await sender.peers.add({ id: who.id, name: who.name, secret, ...endpoint })
    await sender.peers.flushed()
    // Both sides keep the address, for when the other cannot be found on the network.
    expect(new PeerStore(receiver.folder, plainCodec).get(sender.me.id)).toMatchObject({ host: '127.0.0.1', port: 47820 })
    expect(sender.peers.get(who.id)).toMatchObject({ host: '127.0.0.1', port: receiver.port })
    expect(await ping({ id: who.id, name: who.name, secret, ...endpoint }, sender.me.id)).toBeGreaterThanOrEqual(0)
  })

  it('refuses an address where something other than ServiceEx answers, or nothing does', async () => {
    const other = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>Router login</html>'))
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve))
    const port = (other.address() as AddressInfo).port
    try {
      await expect(hello({ host: '127.0.0.1', port })).rejects.toThrow(/not ServiceEx/)
    } finally {
      await new Promise((resolve) => other.close(resolve))
    }
    // Closed now: it cannot be reached, with what to check.
    await expect(hello({ host: '127.0.0.1', port })).rejects.toThrow(/firewall/)
  })

  it('saves overlapping changes one at a time and keeps the latest on disk', async () => {
    const folder = await mkdtemp(path.join(work, 'store-'))
    // A new store writes its identity straight away; these changes land while that write and each other are still going.
    const peers = peerStore(folder)
    const [booth, stage] = [randomId(), randomId()]
    await Promise.all([
      peers.add({ id: booth, name: 'Booth', secret: Buffer.alloc(32, 1) }),
      peers.update(booth, { alias: 'First' }),
      peers.add({ id: stage, name: 'Stage', secret: Buffer.alloc(32, 2) }),
      peers.update(booth, { alias: 'Last' }),
      peers.forget(stage),
    ])
    await peers.flushed()
    const reopened = new PeerStore(folder, plainCodec)
    expect(reopened.deviceId).toBe(peers.deviceId)
    expect(reopened.list().map((d) => [d.id, d.alias])).toEqual([[booth, 'Last']])
  })
})

describe('unpaired devices', () => {
  it('are refused on every sealed request', async () => {
    const receiver = await startReceiver()
    const stranger: PeerTarget = { id: receiver.peers.deviceId, name: 'Sanctuary booth', secret: randomBytes(32), host: '127.0.0.1', port: receiver.port }
    await expect(ping(stranger, randomId())).rejects.toThrow(/not paired/)
    const file = await randomFile('Welcome.png', 1000)
    await expect(sendFile(stranger, randomId(), file, { name: 'Welcome.png', limitMb: 10 })).rejects.toBeInstanceOf(RefusedError)
    expect(receiver.received).toEqual([])
    expect(await readdir(receiver.folder)).not.toContain('inbox')
  })

  it('are refused when they claim a paired id without its key, and once forgotten', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    await expect(ping({ ...target, secret: randomBytes(32) }, sender.me.id)).rejects.toThrow(/could not verify/)
    await receiver.peers.forget(sender.me.id)
    await expect(ping(target, sender.me.id)).rejects.toThrow(/not paired/)
  })

  it('may still ask who a computer is, which reveals nothing secret', async () => {
    const receiver = await startReceiver()
    expect(await hello({ host: '127.0.0.1', port: receiver.port })).toEqual({ id: receiver.peers.deviceId, name: 'Sanctuary booth', v: 1 })
  })
})

describe('allowed types', () => {
  it('lists packages, presentations, images, video, audio, text and OpenLyrics only', () => {
    for (const name of ['Sunday.serviceex', 'Talk.pptx', 'Old.ppt', 'Notes.pdf', 'a.jpg', 'a.JPEG', 'a.png', 'a.gif', 'a.webp', 'Loop.mp4', 'Loop.webm', 'Click.mp3', 'Click.wav', 'Lyrics.txt', 'Song.xml']) {
      expect(shareKindOf(name), name).not.toBeNull()
    }
    for (const name of ['setup.exe', 'run.bat', 'script.js', 'page.html', 'archive.zip', 'macro.pptm', 'image.svg', 'Talk.pptx.exe', 'README', '.xml', 'app.dmg', 'tool.sh']) {
      expect(shareKindOf(name), name).toBeNull()
    }
  })

  it('are enforced by the receiver even when a paired sender skips its own check', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const answer = await secureRequest(target, sender.me.id, 'offer', { transferId: randomId(), name: 'setup.exe', size: 10, sha256: 'a'.repeat(64) })
    expect(answer).toMatchObject({ ok: false, code: 'type' })
    // A sneaky folder in the name is dropped, and the type still decides.
    const sneaky = await secureRequest(target, sender.me.id, 'offer', { transferId: randomId(), name: '../../evil.sh', size: 10, sha256: 'a'.repeat(64) })
    expect(sneaky).toMatchObject({ ok: false, code: 'type' })
  })

  it('are checked by the sender before anything is sent', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const file = await randomFile('tool.js', 100)
    await expect(sendFile(target, sender.me.id, file, { name: 'tool.js', limitMb: 10 })).rejects.toThrow(/not a type that can be shared/)
  })
})

describe('size limit', () => {
  it('defaults to 2 GB and refuses anything larger', () => {
    expect(shareProblem('Loop.mp4', 2 * 1024 ** 3, 2048)).toBeNull()
    expect(shareProblem('Loop.mp4', 2 * 1024 ** 3 + 1, 2048)).toMatch(/over the 2.0 GB limit/)
  })

  it('is enforced by the receiver with its own setting', async () => {
    const receiver = await startReceiver(undefined, 1)
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const file = await randomFile('Loop.mp4', 1024 * 1024 + 1)
    // The sender allows it, the receiver does not.
    await expect(sendFile(target, sender.me.id, file, { name: 'Loop.mp4', limitMb: 2048 })).rejects.toThrow(/over the 1.0 MB limit/)
    // Nor can more bytes be pushed than were offered.
    const transferId = randomId()
    expect(await secureRequest(target, sender.me.id, 'offer', { transferId, name: 'Small.png', size: 10, sha256: 'a'.repeat(64) })).toMatchObject({ ok: true, offset: 0 })
    expect(await secureRequest(target, sender.me.id, 'chunk', { transferId, offset: 0 }, randomBytes(11))).toMatchObject({ ok: false, code: 'size' })
    expect(receiver.received).toEqual([])
  })
})

describe('transfers', () => {
  it('arrive whole in the Inbox, with the sender and the name they were sent with', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const file = await randomFile('Easter.pptx', 300_000)
    await sendFile(target, sender.me.id, file, { name: 'Easter.pptx', limitMb: 10, chunkBytes: 64 * 1024 })

    expect(receiver.received).toHaveLength(1)
    const [item] = receiver.received
    expect(item).toMatchObject({ name: 'Easter.pptx', size: 300_000, kind: 'presentation', senderId: sender.me.id, senderName: 'Youth room' })
    expect(await sha256File(receiver.inbox.filePath(item))).toBe(await sha256File(file))
    expect(receiver.inbox.list().map((i) => i.id)).toEqual([item.id])
  })

  it('carry on where they stopped, even after the receiver restarts', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const size = 1024 * 1024 + 123
    const file = await randomFile('Worship loop.mp4', size)
    const chunkBytes = 128 * 1024

    // Cut off after a few chunks.
    const cut = new Error('Cable pulled')
    await expect(
      sendFile(target, sender.me.id, file, {
        name: 'Worship loop.mp4',
        limitMb: 10,
        chunkBytes,
        onProgress: (sent) => {
          if (sent >= 3 * chunkBytes) throw cut
        },
      }),
    ).rejects.toBe(cut)
    expect(receiver.received).toEqual([])

    // The receiving computer restarts on another port, with what it had kept.
    await receiver.server.close()
    const restarted = await startReceiver(receiver.folder)
    const progress: number[] = []
    await sendFile({ ...target, port: restarted.port }, sender.me.id, file, {
      name: 'Worship loop.mp4',
      limitMb: 10,
      chunkBytes,
      onProgress: (sent) => progress.push(sent),
    })
    // It started from the bytes already there, not from zero.
    expect(progress[0]).toBe(3 * chunkBytes)
    expect(progress.at(-1)).toBe(size)
    expect(restarted.received).toHaveLength(1)
    expect(await sha256File(restarted.inbox.filePath(restarted.received[0]))).toBe(await sha256File(file))
    // Nothing partial is left behind.
    expect(await readdir(restarted.inbox.partialFolder)).toEqual([])
  })

  it('retry when the receiver is briefly unreachable', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const file = await randomFile('Announcements.pdf', 500_000)
    let restarted = false
    await sendFile(target, sender.me.id, file, {
      name: 'Announcements.pdf',
      limitMb: 10,
      chunkBytes: 100_000,
      retryDelayMs: 20,
      onProgress: (sent, _size, retrying) => {
        // Drop the server once mid-transfer and bring it back on the same port while the sender retries.
        if (sent >= 200_000 && !restarted && !retrying) {
          restarted = true
          receiver.server.close().then(() => receiver.server.listen(target.port, '127.0.0.1'))
        }
      },
    })
    expect(restarted).toBe(true)
    expect(receiver.received).toHaveLength(1)
    expect(await sha256File(receiver.inbox.filePath(receiver.received[0]))).toBe(await sha256File(file))
  })

  it('are refused when the bytes do not match their hash', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const bytes = randomBytes(1000)
    const transferId = transferIdFor(sender.me.id, target.id, 'x', 'Logo.png', 1000)
    const claimed = createHash('sha256').update(Buffer.from('something else')).digest('hex')
    await secureRequest(target, sender.me.id, 'offer', { transferId, name: 'Logo.png', size: 1000, sha256: claimed })
    await secureRequest(target, sender.me.id, 'chunk', { transferId, offset: 0 }, bytes)
    expect(await secureRequest(target, sender.me.id, 'finish', { transferId })).toMatchObject({ ok: false, code: 'hash' })
    expect(receiver.received).toEqual([])
    expect(existsSync(path.join(receiver.inbox.partialFolder, `${sender.me.id}-${transferId}.part`))).toBe(false)
  })

  it('cannot be replayed', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    // The same sealed request, sent twice as someone on the network could.
    const envelope = seal(channelKey(target.secret, sender.me.id, target.id, 'request'), requestAad(sender.me.id, target.id), {
      op: 'ping',
      nonce: randomId(),
      ts: Date.now(),
    })
    const post = () =>
      fetch(`http://127.0.0.1:${receiver.port}/v1/secure`, { method: 'POST', headers: { [FROM_HEADER]: sender.me.id }, body: new Uint8Array(envelope) }).then((r) => r.status)
    expect(await post()).toBe(200)
    expect(await post()).toBe(401)
  })
})

describe('.serviceex packages', () => {
  it('carry the schedule and files, and refuse damaged or foreign content', async () => {
    const picture = await randomFile('bg.png', 5000)
    const deck = await randomFile('talk.pptx', 7000)
    const contents = { ...emptyContents(), service: { name: 'Sunday', date: '2026-11-01', items: [] } }
    const sources = new Map([
      [packagePath('media', 0, 'png'), picture],
      [packagePath('presentations', 0, 'pptx'), deck],
    ])
    const file = path.join(work, 'Sunday.serviceex')
    await writePackage(file, contents, sources)

    const opened = await readPackage(file)
    expect(opened.manifest.contents.service?.name).toBe('Sunday')
    const out = path.join(work, 'out.pptx')
    await extractFile(file, opened, 'presentations/0.pptx', out)
    expect(await sha256File(out)).toBe(await sha256File(deck))

    // A flipped byte in a file fails its hash; a cut-off package does not add up.
    const bytes = await readFile(file)
    bytes[bytes.length - 1] ^= 0xff
    await writeFile(file, bytes)
    await expect(extractFile(file, await readPackage(file), 'presentations/0.pptx', out)).rejects.toThrow(/damaged/)
    await writeFile(file, bytes.subarray(0, bytes.length - 10))
    await expect(readPackage(file)).rejects.toThrow(/incomplete|damaged/)
    // Only media and presentations may be inside.
    await expect(writePackage(path.join(work, 'bad.serviceex'), contents, new Map([['media/0.exe', picture]]))).rejects.toThrow(/may not/)
    await writeFile(path.join(work, 'fake.serviceex'), 'PK not a package')
    await expect(readPackage(path.join(work, 'fake.serviceex'))).rejects.toThrow(/not a ServiceEx package/)
  })
})

describe('stopping a transfer', () => {
  it('reports progress to the receiver: who from, what, and how far', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const file = await randomFile('Easter.pptx', 300_000)
    await sendFile(target, sender.me.id, file, { name: 'Easter.pptx', limitMb: 10, chunkBytes: 100_000 })

    const ids = new Set(receiver.incoming.map((t) => t.id))
    expect(ids.size).toBe(1)
    expect(receiver.incoming[0]).toMatchObject({ senderId: sender.me.id, senderName: 'Youth room', name: 'Easter.pptx', size: 300_000, received: 0, state: 'receiving' })
    expect(receiver.incoming.map((t) => t.received)).toEqual([0, 100_000, 200_000, 300_000, 300_000])
    expect(receiver.incoming.at(-1)?.state).toBe('done')
  })

  it('cancelled by the sender, stops and the receiver deletes what arrived', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const file = await randomFile('Worship loop.mp4', 1_000_000)
    const controller = new AbortController()
    const sent: number[] = []
    await expect(
      sendFile(target, sender.me.id, file, {
        name: 'Worship loop.mp4',
        limitMb: 10,
        chunkBytes: 100_000,
        signal: controller.signal,
        onProgress: (n) => {
          sent.push(n)
          if (n >= 300_000) controller.abort()
        },
      }),
    ).rejects.toBeInstanceOf(CancelledError)

    expect(sent.at(-1)).toBe(300_000)
    expect(receiver.received).toEqual([])
    expect(receiver.incoming.at(-1)).toMatchObject({ name: 'Worship loop.mp4', state: 'cancelled' })
    expect(await readdir(receiver.inbox.partialFolder)).toEqual([])
  })

  it('cancelled before it starts, sends nothing', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const file = await randomFile('Logo.png', 1000)
    const controller = new AbortController()
    controller.abort()
    await expect(sendFile(target, sender.me.id, file, { name: 'Logo.png', limitMb: 10, signal: controller.signal })).rejects.toBeInstanceOf(CancelledError)
    expect(receiver.incoming).toEqual([])
  })

  it('cancelled while waiting to retry, stops at once', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const file = await randomFile('Logo.png', 1000)
    await receiver.server.close()
    const controller = new AbortController()
    const started = Date.now()
    const sending = sendFile(target, sender.me.id, file, {
      name: 'Logo.png',
      limitMb: 10,
      retryDelayMs: 10_000,
      signal: controller.signal,
      onProgress: (_sent, _size, retrying) => retrying && controller.abort(),
    })
    await expect(sending).rejects.toBeInstanceOf(CancelledError)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('declined by the receiver, stops the sender, deletes what arrived, and may be sent again', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const file = await randomFile('Big video.mp4', 1_000_000)
    let declined: Promise<void> | null = null
    const sending = sendFile(target, sender.me.id, file, {
      name: 'Big video.mp4',
      limitMb: 10,
      chunkBytes: 100_000,
      onProgress: (n) => {
        if (n >= 200_000 && !declined) declined = receiver.server.decline(receiver.incoming[0].id)
      },
    })
    await expect(sending).rejects.toBeInstanceOf(DeclinedError)
    await expect(sending).rejects.toThrow('Sanctuary booth declined the file.')
    await declined
    expect(receiver.incoming.at(-1)).toMatchObject({ name: 'Big video.mp4', state: 'declined' })
    expect(receiver.received).toEqual([])
    expect(await readdir(receiver.inbox.partialFolder)).toEqual([])

    // Sending it again is asking again; it starts from nothing.
    const progress: number[] = []
    await sendFile(target, sender.me.id, file, { name: 'Big video.mp4', limitMb: 10, chunkBytes: 500_000, onProgress: (n) => progress.push(n) })
    expect(progress[0]).toBe(0)
    expect(receiver.received).toHaveLength(1)
  })

  it('leaves no partial file when a decline lands while a chunk is on its way, and refuses the rest', async () => {
    const receiver = await startReceiver()
    const sender = await makeSender()
    const target = await pair(receiver, sender)
    const transferId = randomId()
    await secureRequest(target, sender.me.id, 'offer', { transferId, name: 'Loop.mp4', size: 2_000_000, sha256: 'a'.repeat(64) })
    const id = `${sender.me.id}-${transferId}`
    // Whichever lands first, nothing is left on disk.
    await Promise.all([secureRequest(target, sender.me.id, 'chunk', { transferId, offset: 0 }, randomBytes(1_000_000)), receiver.server.decline(id)])
    expect(await readdir(receiver.inbox.partialFolder)).toEqual([])
    expect(await secureRequest(target, sender.me.id, 'chunk', { transferId, offset: 0 }, randomBytes(1000))).toMatchObject({ ok: false, code: 'declined' })
  })
})

describe('old partial files', () => {
  it('are deleted once a week old, or when half of the pair is gone; recent ones stay to carry on from', async () => {
    const receiver = await startReceiver()
    const folder = receiver.inbox.partialFolder
    const { mkdir } = await import('node:fs/promises')
    await mkdir(folder, { recursive: true })
    const [old, recent, orphan] = [randomId(), randomId(), randomId()]
    for (const id of [old, recent]) {
      await writeFile(path.join(folder, `${id}.part`), 'bytes')
      await writeFile(path.join(folder, `${id}.json`), '{}')
    }
    await writeFile(path.join(folder, `${orphan}.part`), 'bytes')
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(path.join(folder, `${old}.part`), eightDaysAgo, eightDaysAgo)

    await receiver.server.prunePartials()
    expect((await readdir(folder)).sort()).toEqual([`${recent}.json`, `${recent}.part`])
  })
})
