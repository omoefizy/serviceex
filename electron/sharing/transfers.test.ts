// The sending queue: one at a time and in order, Cancel on a waiting, preparing or running transfer, Retry after a
// failure, and packages written for a transfer deleted once it is over. The network is a stand-in here; the real
// transfer is covered in sharing.test.ts.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ShareSource, TransferProgress } from '../../shared/types'
import { CancelledError, DeclinedError } from './client'
import { clearOldPackages, SEND_TEMP_PREFIX, TransferQueue, type PreparedFile, type TransferQueueOptions } from './transfers'
import { makeTempDir, removeTemp } from '../tempDir.test-helper'

let work: string

beforeEach(async () => {
  work = await makeTempDir('serviceex-queue-test-')
})

afterEach(async () => {
  await removeTemp(work)
})

/** A send the test finishes, fails or watches being cancelled. */
interface Pending {
  peerId: string
  prepared: PreparedFile
  signal: AbortSignal
  progress(sent: number): void
  finish(): void
  fail(error: Error): void
}

function harness(prepare?: TransferQueueOptions['prepare']) {
  const events: TransferProgress[] = []
  const sends: Pending[] = []
  let waiting: ((p: Pending) => void) | null = null
  const queue = new TransferQueue({
    prepare:
      prepare ??
      (async (source) => {
        // Every item gets a package of its own, as songs and services do.
        const temp = await mkdtemp(path.join(work, SEND_TEMP_PREFIX))
        const file = path.join(temp, 'package.serviceex')
        await writeFile(file, 'x'.repeat(100))
        return { file, name: `${source.type}.serviceex`, temp }
      }),
    send: (peerId, prepared, signal, onProgress) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new CancelledError()), { once: true })
        const pending: Pending = { peerId, prepared, signal, progress: (sent) => onProgress(sent, 100, false), finish: resolve, fail: reject }
        sends.push(pending)
        waiting?.(pending)
      }),
    size: async () => 100,
    emit: (progress) => events.push(progress),
  })
  /** The next send to start. */
  const nextSend = () => new Promise<Pending>((resolve) => (waiting = resolve))
  const states = (id: string) => events.filter((e) => e.id === id).map((e) => e.state)
  return { queue, events, sends, nextSend, states }
}

const song: ShareSource = { type: 'song', id: 1 }
const service: ShareSource = { type: 'service', id: 2 }

describe('the sending queue', () => {
  it('sends one at a time, in order, and deletes each package once sent', async () => {
    const { queue, sends, nextSend, states } = harness()
    let started = nextSend()
    const first = queue.add('peer', 'Booth', song)
    const second = queue.add('peer', 'Booth', service)
    const one = await started
    expect(sends).toHaveLength(1)
    started = nextSend()
    one.progress(50)
    one.finish()
    const two = await started
    expect(two.prepared.name).toBe('service.serviceex')
    two.finish()
    await queue.idle()

    expect(states(first)).toEqual(['preparing', 'preparing', 'sending', 'sending', 'done'])
    expect(states(second).at(-1)).toBe('done')
    expect(existsSync(one.prepared.temp!)).toBe(false)
    expect(existsSync(two.prepared.temp!)).toBe(false)
    expect(queue.list()).toEqual([])
  })

  it('cancels a running transfer: the send is aborted, its package deleted, and the next one starts', async () => {
    const { queue, nextSend, states } = harness()
    let started = nextSend()
    const first = queue.add('peer', 'Booth', song)
    queue.add('peer', 'Booth', service)
    const one = await started
    started = nextSend()
    await queue.cancel(first)
    expect(one.signal.aborted).toBe(true)
    const two = await started
    expect(states(first).at(-1)).toBe('cancelled')
    expect(existsSync(one.prepared.temp!)).toBe(false)
    two.finish()
    await queue.idle()
  })

  it('takes a waiting transfer out of the queue without preparing or sending it', async () => {
    let prepared = 0
    const { queue, sends, nextSend, states } = harness(async (source) => {
      prepared++
      return { file: path.join(work, 'a.png'), name: `${source.type}.png`, temp: null }
    })
    const started = nextSend()
    queue.add('peer', 'Booth', song)
    const waiting = queue.add('peer', 'Booth', service)
    const one = await started
    await queue.cancel(waiting)
    one.finish()
    await queue.idle()
    expect(prepared).toBe(1)
    expect(sends).toHaveLength(1)
    expect(states(waiting)).toEqual(['preparing', 'cancelled'])
    expect(queue.list()).toEqual([])
  })

  it('deletes a package made for a transfer cancelled while it was being prepared', async () => {
    let release: () => void = () => {}
    let temp = ''
    const { queue, sends } = harness(async () => {
      temp = await mkdtemp(path.join(work, SEND_TEMP_PREFIX))
      await new Promise<void>((resolve) => (release = resolve))
      return { file: path.join(temp, 'package.serviceex'), name: 'Sunday.serviceex', temp }
    })
    const id = queue.add('peer', 'Booth', service)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await queue.cancel(id)
    release()
    await queue.idle()
    expect(sends).toEqual([])
    expect(existsSync(temp)).toBe(false)
  })

  it('keeps a failed transfer and its package for Retry, and deletes both once cleared', async () => {
    const { queue, nextSend, states } = harness()
    let started = nextSend()
    const id = queue.add('peer', 'Booth', service)
    const first = await started
    first.fail(new Error('Booth did not answer in time.'))
    await queue.idle()
    expect(queue.list()).toEqual([expect.objectContaining({ id, state: 'failed', error: 'Booth did not answer in time.' })])
    expect(existsSync(first.prepared.temp!)).toBe(true)

    // Retry sends the same package again.
    started = nextSend()
    queue.retry(id)
    const again = await started
    expect(again.prepared.file).toBe(first.prepared.file)
    again.fail(new Error('Still no answer'))
    await queue.idle()

    // Dismissing the failed chip clears it.
    await queue.cancel(id)
    expect(queue.list()).toEqual([])
    expect(existsSync(first.prepared.temp!)).toBe(false)
    expect(states(id).at(-1)).toBe('failed')
  })

  it('ends a declined transfer with the reason and deletes its package', async () => {
    const { queue, nextSend, events } = harness()
    const started = nextSend()
    const id = queue.add('peer', 'Booth', service)
    const send = await started
    send.fail(new DeclinedError('Booth declined the file.'))
    await queue.idle()
    expect(events.at(-1)).toMatchObject({ id, state: 'declined', error: 'Booth declined the file.' })
    expect(existsSync(send.prepared.temp!)).toBe(false)
    expect(queue.list()).toEqual([])
  })

  it('cancels everything when Sharing is turned off', async () => {
    const { queue, nextSend, sends } = harness()
    const started = nextSend()
    queue.add('peer', 'Booth', song)
    queue.add('peer', 'Booth', service)
    const one = await started
    await queue.stop()
    expect(one.signal.aborted).toBe(true)
    expect(sends).toHaveLength(1)
    expect(queue.list()).toEqual([])
    expect(await readdir(work)).toEqual([])
  })
})

describe('leftover packages', () => {
  it('are deleted when over an hour old; newer ones and other folders stay', async () => {
    const old = path.join(work, `${SEND_TEMP_PREFIX}old`)
    const recent = path.join(work, `${SEND_TEMP_PREFIX}recent`)
    const other = path.join(work, 'someone-else')
    for (const dir of [old, recent, other]) {
      await mkdir(dir)
      await writeFile(path.join(dir, 'package.serviceex'), 'x')
    }
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await utimes(old, twoHoursAgo, twoHoursAgo)
    await utimes(other, twoHoursAgo, twoHoursAgo)
    await clearOldPackages(work)
    expect((await readdir(work)).sort()).toEqual([`${SEND_TEMP_PREFIX}recent`, 'someone-else'])
  })
})
