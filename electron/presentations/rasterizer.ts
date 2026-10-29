// Drives the hidden rasterizer window (the renderer at #/rasterize), which draws PDF pages with pdf.js and fits
// images onto 1920x1080 with a canvas. It is its own renderer process, so a long PDF never stalls the operator
// window, and needs no native code. Each page comes back twice: first a small JPEG for the slide grid (every page
// before any full picture), then the full PNG. Both are written here as they arrive.

import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RasterJob } from '../../shared/types'
import type { RasterPage, RasterWork, Rasterizer } from './convert'
import { ImportCancelledError } from './library'

const MAX_PAGES = 500
const MAX_PNG_BYTES = 40 * 1024 * 1024

interface Job {
  id: number
  outDir: string
  pages: RasterPage[]
  writes: Promise<void>[]
  work: RasterWork
  resolve(pages: RasterPage[]): void
  reject(error: Error): void
}

export const slideFile = (index: number) => `slide-${String(index + 1).padStart(3, '0')}.png`
export const thumbFile = (index: number) => `thumb-${String(index + 1).padStart(3, '0')}.jpg`

const isIndex = (index: unknown): index is number => Number.isInteger(index) && (index as number) >= 0 && (index as number) < MAX_PAGES

export function createWindowRasterizer(createWindow: () => BrowserWindow): Rasterizer & { close(): void } {
  let win: BrowserWindow | null = null
  let ready: Promise<void> = Promise.resolve()
  let markReady = () => {}
  let nextId = 1
  const jobs = new Map<number, Job>()

  const fromWindow = (event: IpcMainEvent) => win !== null && !win.isDestroyed() && event.sender === win.webContents
  const jobOf = (event: IpcMainEvent, id: unknown) => (fromWindow(event) && typeof id === 'number' ? jobs.get(id) : undefined)

  const failAll = (message: string) => {
    for (const job of jobs.values()) job.reject(new Error(message))
    jobs.clear()
  }

  /** Writes a file of the job; the work hears of it once it is on disk, so its URL loads. */
  const write = (job: Job, file: string, bytes: Uint8Array, then: () => void) => {
    job.writes.push(
      writeFile(path.join(job.outDir, file), bytes).then(() => {
        if (jobs.get(job.id) === job) then()
      }),
    )
  }

  ipcMain.on('rasterize:ready', (event) => {
    if (fromWindow(event)) markReady()
  })

  ipcMain.on('rasterize:thumb', (event, id: unknown, index: unknown, total: unknown, jpeg: unknown, text: unknown) => {
    const job = jobOf(event, id)
    if (!job || !isIndex(index) || typeof total !== 'number') return
    if (!(jpeg instanceof Uint8Array) || jpeg.length === 0 || jpeg.length > MAX_PNG_BYTES) return
    const page = { file: slideFile(index), thumb: thumbFile(index), text: typeof text === 'string' ? text : '' }
    job.pages[index] = page
    write(job, page.thumb, jpeg, () => job.work.onThumb?.(index, total, page))
  })

  ipcMain.on('rasterize:page', (event, id: unknown, index: unknown, total: unknown, png: unknown) => {
    const job = jobOf(event, id)
    if (!job || !isIndex(index) || typeof total !== 'number') return
    if (!(png instanceof Uint8Array) || png.length === 0 || png.length > MAX_PNG_BYTES) return
    job.pages[index] ??= { file: slideFile(index), thumb: thumbFile(index), text: '' }
    write(job, slideFile(index), png, () => job.work.onPage(index, total))
  })

  ipcMain.on('rasterize:done', (event, id: unknown) => {
    const job = jobOf(event, id)
    if (!job) return
    Promise.all(job.writes).then(() => {
      jobs.delete(id as number)
      job.resolve(job.pages.filter(Boolean))
    }, job.reject)
  })

  ipcMain.on('rasterize:fail', (event, id: unknown, message: unknown) => {
    const job = jobOf(event, id)
    if (!job) return
    jobs.delete(id as number)
    job.reject(new Error(typeof message === 'string' ? message : 'Could not draw the slides'))
  })

  function ensureWindow(): Promise<BrowserWindow> {
    if (!win || win.isDestroyed()) {
      const created = createWindow()
      win = created
      ready = new Promise((resolve) => (markReady = resolve))
      created.on('closed', () => {
        if (win === created) win = null
        failAll('The slide renderer closed')
      })
      created.webContents.on('render-process-gone', () => {
        failAll('The slide renderer stopped')
        if (!created.isDestroyed()) created.destroy()
      })
    }
    const current = win
    return ready.then(() => current)
  }

  async function send(job: { kind: 'pdf'; data: Uint8Array } | { kind: 'images'; images: Uint8Array[] }, outDir: string, work: RasterWork): Promise<RasterPage[]> {
    if (work.signal?.aborted) throw new ImportCancelledError()
    const target = await ensureWindow()
    const id = nextId++
    return new Promise((resolve, reject) => {
      const stop = () => {
        if (!jobs.delete(id)) return
        if (!target.isDestroyed()) target.webContents.send('rasterize:cancel', id)
        reject(new ImportCancelledError())
      }
      work.signal?.addEventListener('abort', stop, { once: true })
      const settle = <T>(then: (value: T) => void) => (value: T) => {
        work.signal?.removeEventListener('abort', stop)
        then(value)
      }
      jobs.set(id, { id, outDir, pages: [], writes: [], work, resolve: settle(resolve), reject: settle(reject) })
      work.setWant?.((index) => {
        if (jobs.has(id) && !target.isDestroyed()) target.webContents.send('rasterize:want', id, index)
      })
      target.webContents.send('rasterize:job', { ...job, id } satisfies RasterJob)
    })
  }

  return {
    pdf: (data, outDir, work) => send({ kind: 'pdf', data }, outDir, work),
    images: (images, outDir, work) => send({ kind: 'images', images }, outDir, work),
    close() {
      if (win && !win.isDestroyed()) win.destroy()
      win = null
    },
  }
}
