// The sending queue: one transfer at a time, in order, each one cancellable whether it is waiting, being prepared or
// on its way. A package written for a transfer is deleted once the transfer is over: sent, cancelled or declined, or
// cleared after it failed (until then it is kept so Retry carries on where it stopped). Nothing here touches
// Electron, so tests can drive it.

import { readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ShareSource, TransferProgress } from '../../shared/types'
import { CancelledError, DeclinedError } from './client'
import { randomId } from './crypto'

/** Temporary folders for packages being sent start with this, in the system's temp folder. */
export const SEND_TEMP_PREFIX = 'serviceex-send-'

/** A file to send, and the temporary folder written for it, if any. */
export interface PreparedFile {
  file: string
  name: string
  temp: string | null
}

export interface TransferQueueOptions {
  /** Turns an item into a file to send: the file itself, or a package written for it. */
  prepare(source: ShareSource): Promise<PreparedFile>
  /** Sends the file; rejects with CancelledError once the signal aborts, DeclinedError when the receiver declines. */
  send(peerId: string, prepared: PreparedFile, signal: AbortSignal, onProgress: (sent: number, size: number, retrying: boolean) => void): Promise<void>
  size(file: string): Promise<number>
  emit(progress: TransferProgress): void
}

interface Transfer {
  progress: TransferProgress
  peerId: string
  prepared: PreparedFile | null
  /** Set while it is being sent. */
  controller: AbortController | null
  cancelled: boolean
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function removeTemp(prepared: PreparedFile | null): Promise<void> {
  if (prepared?.temp) await rm(prepared.temp, { recursive: true, force: true }).catch(console.error)
}

export class TransferQueue {
  private readonly options: TransferQueueOptions
  private readonly transfers = new Map<string, Transfer>()
  private queue: Promise<void> = Promise.resolve()

  constructor(options: TransferQueueOptions) {
    this.options = options
  }

  /** Transfers not yet cleared: waiting, on their way, or failed and waiting for Retry. */
  list(): TransferProgress[] {
    return [...this.transfers.values()].map((t) => t.progress)
  }

  /** Settles once everything queued so far has finished, failed or been cancelled. */
  idle(): Promise<void> {
    return this.queue
  }

  /** Queues an item for a device. Resolves to the transfer id at once; progress comes through emit. */
  add(peerId: string, peerName: string, source: ShareSource): string {
    const id = randomId()
    const transfer: Transfer = {
      progress: { id, peerId, peerName, name: source.type === 'file' ? path.basename(source.path) : 'Preparing…', sent: 0, size: 0, state: 'preparing' },
      peerId,
      prepared: null,
      controller: null,
      cancelled: false,
    }
    this.transfers.set(id, transfer)
    this.options.emit(transfer.progress)
    this.queue = this.queue.then(async () => {
      if (transfer.cancelled) return
      try {
        transfer.prepared = await this.options.prepare(source)
        if (transfer.cancelled) return this.end(transfer, 'cancelled')
        this.update(transfer, { name: transfer.prepared.name, size: await this.options.size(transfer.prepared.file) })
      } catch (error) {
        this.update(transfer, { state: 'failed', error: errorText(error) })
        return
      }
      await this.run(transfer)
    })
    return id
  }

  /** Sends a failed transfer again, carrying on from what the receiver already has. */
  retry(id: string): void {
    const transfer = this.transfers.get(id)
    if (!transfer || transfer.progress.state !== 'failed') return
    if (!transfer.prepared) throw new Error('That item could not be prepared; send it again.')
    transfer.cancelled = false
    this.update(transfer, { state: 'preparing', error: undefined })
    this.queue = this.queue.then(() => this.run(transfer))
  }

  /**
   * Stops a transfer. Waiting: it never starts. On its way: it stops, and the receiver deletes what arrived. Failed
   * or finished: it is cleared, with its package.
   */
  async cancel(id: string): Promise<void> {
    const transfer = this.transfers.get(id)
    if (!transfer) return
    transfer.cancelled = true
    if (transfer.controller) {
      // run() sees the abort and ends it.
      transfer.controller.abort()
      return
    }
    const { state } = transfer.progress
    if (state === 'failed' || state === 'done' || state === 'declined' || state === 'cancelled') {
      this.transfers.delete(id)
      await removeTemp(transfer.prepared)
      return
    }
    // Waiting in the queue, or being prepared: the queue step sees the flag (and deletes a package made meanwhile).
    if (!transfer.prepared) {
      this.update(transfer, { state: 'cancelled' })
      this.transfers.delete(id)
    }
  }

  /** Cancels everything, as when Sharing is turned off. */
  async stop(): Promise<void> {
    await Promise.all([...this.transfers.keys()].map((id) => this.cancel(id)))
    await this.queue
    // Failed ones keep their package for Retry, which is gone now too.
    await Promise.all([...this.transfers.keys()].map((id) => this.cancel(id)))
  }

  private update(transfer: Transfer, patch: Partial<TransferProgress>): void {
    transfer.progress = { ...transfer.progress, ...patch }
    this.options.emit(transfer.progress)
  }

  /** The transfer is over: its package goes, and it leaves the list. */
  private async end(transfer: Transfer, state: 'done' | 'cancelled' | 'declined', error?: string): Promise<void> {
    this.update(transfer, { state, error, ...(state === 'done' ? { sent: transfer.progress.size } : {}) })
    this.transfers.delete(transfer.progress.id)
    await removeTemp(transfer.prepared)
  }

  private async run(transfer: Transfer): Promise<void> {
    const prepared = transfer.prepared as PreparedFile
    if (transfer.cancelled) return this.end(transfer, 'cancelled')
    const controller = new AbortController()
    transfer.controller = controller
    try {
      this.update(transfer, { state: 'sending', error: undefined })
      await this.options.send(transfer.peerId, prepared, controller.signal, (sent, size, retrying) => {
        if (!controller.signal.aborted) this.update(transfer, { sent, size, state: retrying ? 'retrying' : 'sending' })
      })
      await this.end(transfer, 'done')
    } catch (error) {
      if (error instanceof CancelledError || transfer.cancelled) await this.end(transfer, 'cancelled')
      else if (error instanceof DeclinedError) await this.end(transfer, 'declined', error.message)
      else this.update(transfer, { state: 'failed', error: errorText(error) })
    } finally {
      transfer.controller = null
    }
  }
}

/**
 * Deletes package folders left in the temp folder by an earlier run that ended mid-transfer. Only ones older than
 * `minAgeMs`, so another window's transfer in progress is never touched.
 */
export async function clearOldPackages(folder = os.tmpdir(), minAgeMs = 60 * 60 * 1000): Promise<void> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return
  }
  const now = Date.now()
  for (const name of names.filter((n) => n.startsWith(SEND_TEMP_PREFIX))) {
    const dir = path.join(folder, name)
    const info = await stat(dir).catch(() => null)
    if (info?.isDirectory() && now - info.mtimeMs > minAgeMs) await rm(dir, { recursive: true, force: true }).catch(console.error)
  }
}
