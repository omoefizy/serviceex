// Drives the hidden rasterizer window (the renderer at #/rasterize), which draws PDF pages with pdf.js and fits
// images onto 1920x1080 with a canvas. It is its own renderer process, so a long PDF never stalls the operator
// window, and needs no native code. Pages come back one at a time and are written here.

import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RasterJob } from '../../shared/types'
import type { RasterPage, Rasterizer } from './convert'

const MAX_PAGES = 500
const MAX_PNG_BYTES = 40 * 1024 * 1024

interface Job {
  outDir: string
  pages: RasterPage[]
  writes: Promise<void>[]
  onPage(done: number, total: number): void
  resolve(pages: RasterPage[]): void
  reject(error: Error): void
}

export const slideFile = (index: number) => `slide-${String(index + 1).padStart(3, '0')}.png`

export function createWindowRasterizer(createWindow: () => BrowserWindow): Rasterizer & { close(): void } {
  let win: BrowserWindow | null = null
  let ready: Promise<void> = Promise.resolve()
  let markReady = () => {}
  let nextId = 1
  const jobs = new Map<number, Job>()

  const fromWindow = (event: IpcMainEvent) => win !== null && !win.isDestroyed() && event.sender === win.webContents

  const failAll = (message: string) => {
    for (const job of jobs.values()) job.reject(new Error(message))
    jobs.clear()
  }

  ipcMain.on('rasterize:ready', (event) => {
    if (fromWindow(event)) markReady()
  })

  ipcMain.on('rasterize:page', (event, id: unknown, index: unknown, total: unknown, png: unknown, text: unknown) => {
    const job = typeof id === 'number' ? jobs.get(id) : undefined
    if (!fromWindow(event) || !job) return
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= MAX_PAGES || typeof total !== 'number') return
    if (!(png instanceof Uint8Array) || png.length === 0 || png.length > MAX_PNG_BYTES) return
    const file = slideFile(index as number)
    job.writes.push(writeFile(path.join(job.outDir, file), png))
    job.pages[index as number] = { file, text: typeof text === 'string' ? text : '' }
    job.onPage((index as number) + 1, total)
  })

  ipcMain.on('rasterize:done', (event, id: unknown) => {
    const job = typeof id === 'number' ? jobs.get(id) : undefined
    if (!fromWindow(event) || !job) return
    jobs.delete(id as number)
    Promise.all(job.writes).then(() => job.resolve(job.pages.filter(Boolean)), job.reject)
  })

  ipcMain.on('rasterize:fail', (event, id: unknown, message: unknown) => {
    const job = typeof id === 'number' ? jobs.get(id) : undefined
    if (!fromWindow(event) || !job) return
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

  async function send(job: { kind: 'pdf'; data: Uint8Array } | { kind: 'images'; images: Uint8Array[] }, outDir: string, onPage: Job['onPage']): Promise<RasterPage[]> {
    const target = await ensureWindow()
    const id = nextId++
    return new Promise((resolve, reject) => {
      jobs.set(id, { outDir, pages: [], writes: [], onPage, resolve, reject })
      target.webContents.send('rasterize:job', { ...job, id } satisfies RasterJob)
    })
  }

  return {
    pdf: (data, outDir, onPage) => send({ kind: 'pdf', data }, outDir, onPage),
    images: (images, outDir, onPage) => send({ kind: 'images', images }, outDir, onPage),
    close() {
      if (win && !win.isDestroyed()) win.destroy()
      win = null
    },
  }
}
