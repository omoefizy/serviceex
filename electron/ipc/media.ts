import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { PresentationSource } from '../../shared/types'
import {
  deleteMedia,
  getMedia,
  getSlideBackgrounds,
  insertMedia,
  listMedia,
  setMediaThumb,
  setSlideBackground,
  updateMedia,
} from '../db/media'
import { copyIntoMedia, mediaUrl, removeMedia, writeMedia } from '../media'

// Arguments arrive from the renderer, so check their shape before they reach the disk or the database.

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
const VIDEO_EXTENSIONS = ['mp4', 'webm']
const MAX_PDF_BYTES = 200 * 1024 * 1024
const MAX_GENERATED_BYTES = 20 * 1024 * 1024

async function openDialog(event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return canceled ? [] : filePaths
}

const extensionOf = (file: string) => path.extname(file).slice(1).toLowerCase()

function assertId(value: unknown, name = 'Media id'): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new TypeError(`${name} must be a positive integer`)
  return value as number
}

function assertDeckKey(value: unknown): string {
  if (typeof value !== 'string' || !/^(song|item|scripture):.+/.test(value) || value.length > 300) {
    throw new TypeError('Deck key must look like song:<id>, item:<id> or scripture:<reference>')
  }
  return value
}

function assertBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0 || value.length > MAX_GENERATED_BYTES) {
    throw new TypeError('Expected image bytes up to 20 MB')
  }
  return value
}

export function registerMediaIpc(): void {
  ipcMain.handle('media:list', () => listMedia())

  ipcMain.handle('media:import', async (event) => {
    const files = await openDialog(event, {
      title: 'Import backgrounds',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images and videos', extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] },
        { name: 'Images', extensions: IMAGE_EXTENSIONS },
        { name: 'Videos (MP4, WebM)', extensions: VIDEO_EXTENSIONS },
      ],
    })
    const items = []
    for (const file of files) {
      const extension = extensionOf(file)
      const kind = VIDEO_EXTENSIONS.includes(extension) ? 'video' : IMAGE_EXTENSIONS.includes(extension) ? 'image' : null
      if (!kind) continue
      items.push(insertMedia(path.basename(file, path.extname(file)), kind, await copyIntoMedia(file)))
    }
    return items
  })

  ipcMain.handle('media:update', (_event, id: unknown, name: unknown, tags: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Media needs a name')
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) throw new TypeError('Tags must be strings')
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
    return updateMedia(assertId(id), name.trim(), clean)
  })

  ipcMain.handle('media:delete', async (_event, id: unknown) => {
    const row = deleteMedia(assertId(id))
    if (!row) return false
    await removeMedia(row.file)
    await removeMedia(row.thumb)
    return true
  })

  ipcMain.handle('media:saveThumbnail', async (_event, id: unknown, jpeg: unknown) => {
    const mediaId = assertId(id)
    if (!getMedia(mediaId)) return undefined
    const thumb = await writeMedia(assertBytes(jpeg), `thumb-${mediaId}`, '.jpg')
    await removeMedia(setMediaThumb(mediaId, thumb) ?? null)
    return getMedia(mediaId)
  })

  ipcMain.handle('media:getSlideBackgrounds', (_event, deckKey: unknown) => getSlideBackgrounds(assertDeckKey(deckKey)))

  ipcMain.handle('media:setSlideBackground', (_event, deckKey: unknown, slideIndex: unknown, mediaId: unknown) => {
    if (!Number.isInteger(slideIndex) || (slideIndex as number) < 0) throw new TypeError('Slide index must be 0 or more')
    setSlideBackground(assertDeckKey(deckKey), slideIndex as number, mediaId === null ? null : assertId(mediaId))
  })

  ipcMain.handle('media:pickPresentation', async (event): Promise<PresentationSource | null> => {
    const files = await openDialog(event, {
      title: 'Choose images or a PDF',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images or PDF', extensions: [...IMAGE_EXTENSIONS, 'pdf'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Images', extensions: IMAGE_EXTENSIONS },
      ],
    })
    if (files.length === 0) return null

    // One PDF goes to the renderer to be drawn page by page; images are copied in as they are.
    const pdf = files.find((file) => extensionOf(file) === 'pdf')
    if (pdf) {
      if (files.length > 1) throw new Error('Choose one PDF, or images only')
      if ((await stat(pdf)).size > MAX_PDF_BYTES) throw new Error('The PDF is larger than 200 MB')
      return { kind: 'pdf', title: path.basename(pdf, path.extname(pdf)), data: new Uint8Array(await readFile(pdf)) }
    }
    const images = files.filter((file) => IMAGE_EXTENSIONS.includes(extensionOf(file))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (images.length === 0) throw new Error('Choose images or a PDF')
    const pages = []
    for (const image of images) pages.push(mediaUrl(await copyIntoMedia(image)))
    const title = images.length === 1 ? path.basename(images[0], path.extname(images[0])) : path.basename(path.dirname(images[0]))
    return { kind: 'images', title, pages }
  })

  ipcMain.handle('media:saveImage', async (_event, png: unknown) => mediaUrl(await writeMedia(assertBytes(png), 'page', '.png')))
}
