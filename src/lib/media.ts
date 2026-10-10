// The legacy build carries polyfills: the modern one needs JavaScript newer than Electron's Chromium has.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { MediaItem } from '../../shared/types'

GlobalWorkerOptions.workerSrc = workerUrl

/** Drag-and-drop type for a library item; the data is its id. */
export const MEDIA_DRAG_TYPE = 'application/x-worshipdeck-media'

/** Filters by name or tag. */
export function matchesSearch(item: MediaItem, search: string): boolean {
  const q = search.trim().toLowerCase()
  return !q || item.name.toLowerCase().includes(q) || item.tags.some((tag) => tag.toLowerCase().includes(q))
}

const THUMB_WIDTH = 320
/** PDF pages are drawn this wide, enough for a 1080p screen. */
const PAGE_WIDTH = 1920
export const MAX_PDF_PAGES = 500

function canvasBytes(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png'): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject) : reject(new Error('Could not encode image'))),
      type,
      0.82,
    ),
  )
}

function once(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(event, () => resolve(), { once: true })
    target.addEventListener('error', () => reject(new Error('Could not load media')), { once: true })
  })
}

/** Draws a small JPEG of an image, or of a frame a little into a video (the poster frame). */
async function drawThumbnail(item: MediaItem): Promise<Uint8Array> {
  let source: HTMLImageElement | HTMLVideoElement
  let width: number
  let height: number
  if (item.kind === 'image') {
    const image = new Image()
    // wd-media:// answers with CORS headers; without crossOrigin the canvas could not be exported.
    image.crossOrigin = 'anonymous'
    image.src = item.url
    await image.decode()
    ;[source, width, height] = [image, image.naturalWidth, image.naturalHeight]
  } else {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'
    video.src = item.url
    await once(video, 'loadeddata')
    // Skip a likely black first frame.
    video.currentTime = Math.min(1, (video.duration || 0) / 10)
    await once(video, 'seeked')
    ;[source, width, height] = [video, video.videoWidth, video.videoHeight]
  }
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_WIDTH
  canvas.height = Math.max(1, Math.round((THUMB_WIDTH * height) / Math.max(1, width)))
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvasBytes(canvas, 'image/jpeg')
}

/** Items whose thumbnail is being made, so two views of the library do not make it twice. */
const inProgress = new Set<number>()

/** Makes and stores thumbnails for items that lack one, one at a time; calls back with each updated item. */
export async function ensureThumbnails(items: MediaItem[], onUpdate: (item: MediaItem) => void): Promise<void> {
  for (const item of items.filter((i) => !i.thumbUrl && !inProgress.has(i.id))) {
    inProgress.add(item.id)
    try {
      const updated = await window.api.media.saveThumbnail(item.id, await drawThumbnail(item))
      if (updated) onUpdate(updated)
    } catch (err) {
      // The grid falls back to the file itself or a placeholder.
      console.error(`No thumbnail for ${item.name}`, err)
    } finally {
      inProgress.delete(item.id)
    }
  }
}

/** Draws each page of a PDF as a PNG, stores it in the media folder and resolves to the page URLs in order. */
export async function renderPdfPages(data: Uint8Array, onProgress: (page: number, total: number) => void): Promise<string[]> {
  const task = getDocument({ data })
  try {
    const pdf = await task.promise
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`The PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}`)
    const pages: string[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress(n, pdf.numPages)
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: PAGE_WIDTH / page.getViewport({ scale: 1 }).width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas is not available')
      // Pages without a background are transparent; slides need white paper behind them.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      // The print intent draws in one go; the display intent waits on requestAnimationFrame, which stalls
      // while the window is hidden (say the operator switches away during a long PDF).
      await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise
      pages.push(await window.api.media.saveImage(await canvasBytes(canvas, 'image/png')))
      page.cleanup()
    }
    return pages
  } finally {
    await task.destroy()
  }
}
