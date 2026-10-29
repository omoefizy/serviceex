// The legacy build carries polyfills: the modern one needs JavaScript newer than Electron's Chromium has.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { MediaItem } from '../../shared/types'
import { CONTENT_COLORS } from '../styles/contentColors'

GlobalWorkerOptions.workerSrc = workerUrl

/** Drag-and-drop type for a library item; the data is its id. */
export const MEDIA_DRAG_TYPE = 'application/x-worshipdeck-media'

/** Filters by name or tag. */
export function matchesSearch(item: MediaItem, search: string): boolean {
  const q = search.trim().toLowerCase()
  return !q || item.name.toLowerCase().includes(q) || item.tags.some((tag) => tag.toLowerCase().includes(q))
}

const THUMB_WIDTH = 320
/** Presentation slides are drawn this size, a 1080p screen. */
const SLIDE_WIDTH = 1920
const SLIDE_HEIGHT = 1080
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

/** A black slide to draw on, 1920x1080 unless smaller is asked for. */
function slideCanvas(width = SLIDE_WIDTH, height = SLIDE_HEIGHT): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available')
  context.fillStyle = CONTENT_COLORS.black
  context.fillRect(0, 0, width, height)
  return [canvas, context]
}

/** Where a picture of this shape sits on a slide of this size: scaled to fit, centred. */
function fitBox(width: number, height: number, slideWidth = SLIDE_WIDTH, slideHeight = SLIDE_HEIGHT) {
  const scale = Math.min(slideWidth / width, slideHeight / height)
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  return { x: Math.round((slideWidth - w) / 2), y: Math.round((slideHeight - h) / 2), w, h, scale }
}

/** The slide grid's pictures: a fifth of a 1080p slide, as JPEG. */
export const SLIDE_THUMB_WIDTH = 384
export const SLIDE_THUMB_HEIGHT = 216

/** Encodes full slide pictures as PNG in a few workers, as many at once as there are workers. */
class PngEncoder {
  private readonly workers: Worker[]
  private readonly idle: Worker[]
  private readonly waiting: (() => void)[] = []
  private readonly pending = new Map<number, { resolve(png: Uint8Array): void; reject(error: Error): void }>()
  private nextId = 1

  constructor(size: number) {
    this.workers = Array.from({ length: size }, () => {
      const worker = new Worker(new URL('./pngWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ id: number; png?: Uint8Array; error?: string }>) => {
        const job = this.pending.get(event.data.id)
        this.pending.delete(event.data.id)
        this.release(worker)
        if (event.data.png) job?.resolve(event.data.png)
        else job?.reject(new Error(event.data.error ?? 'Could not encode the slide'))
      }
      return worker
    })
    this.idle = [...this.workers]
  }

  /** Resolves once a worker is free, so drawing never runs far ahead of encoding. */
  async free(): Promise<void> {
    if (this.idle.length === 0) await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  /** Encodes the canvas on a free worker (call free() first). */
  async encode(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    const bitmap = await createImageBitmap(canvas)
    await this.free()
    const worker = this.idle.pop() as Worker
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, bitmap }, [bitmap])
    })
  }

  private release(worker: Worker) {
    this.idle.push(worker)
    this.waiting.shift()?.()
  }

  close() {
    for (const worker of this.workers) worker.terminate()
    for (const job of this.pending.values()) job.reject(new Error('Stopped'))
    this.pending.clear()
  }
}

const encoderSize = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))

/** What drawSlides reports, and how it is stopped and steered. */
export interface SlideDrawing {
  /** A page's small JPEG and its text. Every page gets one before any full picture is drawn. */
  onThumb(index: number, total: number, jpeg: Uint8Array, text: string): void
  /** A page's full 1920x1080 PNG. */
  onPage(index: number, total: number, png: Uint8Array): void
  signal: AbortSignal
  /** Receives a function that moves a page's full picture to the front of the queue. */
  setWant(want: (index: number) => void): void
}

/** A source of slides that can draw any of its pages onto a canvas of any size. */
interface PageSource {
  count: number
  /** Draws the page fitted onto a black slide of this size. */
  draw(index: number, width: number, height: number): Promise<HTMLCanvasElement>
  text(index: number): Promise<string>
}

/**
 * Draws every page twice: first small for the slide grid (all of them, in order, so the grid fills quickly), then
 * at 1920x1080, in order unless a page is wanted sooner, encoded as PNG on workers while the next page is drawn.
 */
async function drawSlides(source: PageSource, drawing: SlideDrawing): Promise<void> {
  const { count, draw } = source
  const stopped = () => drawing.signal.aborted
  for (let index = 0; index < count && !stopped(); index++) {
    const canvas = await draw(index, SLIDE_THUMB_WIDTH, SLIDE_THUMB_HEIGHT)
    drawing.onThumb(index, count, await canvasBytes(canvas, 'image/jpeg'), await source.text(index))
  }
  const queue = Array.from({ length: count }, (_, i) => i)
  drawing.setWant((index) => {
    const at = queue.indexOf(index)
    if (at > 0) queue.unshift(...queue.splice(at, 1))
  })
  const encoder = new PngEncoder(encoderSize())
  const encodes: Promise<void>[] = []
  try {
    while (queue.length > 0 && !stopped()) {
      await encoder.free()
      const index = queue.shift() as number
      const canvas = await draw(index, SLIDE_WIDTH, SLIDE_HEIGHT)
      encodes.push(encoder.encode(canvas).then((png) => (stopped() ? undefined : drawing.onPage(index, count, png))))
    }
    await Promise.all(encodes)
  } finally {
    encoder.close()
  }
}

/**
 * Draws each page of a PDF fitted onto a black 1920x1080 slide, with a small thumbnail of each first (see
 * drawSlides).
 */
export async function drawPdfSlides(data: Uint8Array, drawing: SlideDrawing): Promise<void> {
  const task = getDocument({ data })
  const stop = () => task.destroy()
  drawing.signal.addEventListener('abort', stop, { once: true })
  try {
    const pdf = await task.promise
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`The PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}`)
    await drawSlides(
      {
        count: pdf.numPages,
        async draw(index, width, height) {
          const page = await pdf.getPage(index + 1)
          const base = page.getViewport({ scale: 1 })
          const box = fitBox(base.width, base.height, width, height)
          const viewport = page.getViewport({ scale: box.scale, offsetX: box.x, offsetY: box.y })
          const [canvas, context] = slideCanvas(width, height)
          // Pages without a background are transparent; slides need white paper behind them.
          context.fillStyle = CONTENT_COLORS.white
          context.fillRect(box.x, box.y, box.w, box.h)
          // The print intent draws in one go; the display intent waits on requestAnimationFrame, which stalls in a
          // hidden window.
          await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise
          return canvas
        },
        async text(index) {
          const page = await pdf.getPage(index + 1)
          const content = await page.getTextContent()
          return content.items
            .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
            .join('')
            .replace(/[ \t]+/g, ' ')
            .replace(/ *\n */g, '\n')
            .trim()
        },
      },
      drawing,
    )
  } finally {
    drawing.signal.removeEventListener('abort', stop)
    await task.destroy()
  }
}

/** Fits images onto black 1920x1080 slides, with a small thumbnail of each first (see drawSlides). */
export async function fitImageSlides(images: Uint8Array[], drawing: SlideDrawing): Promise<void> {
  await drawSlides(
    {
      count: images.length,
      async draw(index, width, height) {
        const bitmap = await createImageBitmap(new Blob([images[index] as BlobPart]))
        try {
          const [canvas, context] = slideCanvas(width, height)
          const box = fitBox(bitmap.width, bitmap.height, width, height)
          context.imageSmoothingQuality = 'high'
          context.drawImage(bitmap, box.x, box.y, box.w, box.h)
          return canvas
        } finally {
          bitmap.close()
        }
      },
      text: async () => '',
    },
    drawing,
  )
}
