// The presentation library: imports originals, renders them into cached slide pictures, and re-renders a linked
// original when it is saved again. Nothing here touches Electron, so tests can run it with a stand-in converter
// and store.

import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NativeSlide, PresentationKind, PresentationMode, PresentationProgress, ThemeStyle } from '../../shared/types'
import { samePathKey, waitUntilReadable, watchSources, type SourceWatcher } from './watcher'

export interface SlideMeta {
  /** The PNG's file name in the presentation's cache folder. */
  file: string
  title: string
  text: string
  notes: string
  animated: boolean
}

export interface PresentationRecord {
  id: number
  title: string
  kind: PresentationKind
  sourcePath: string
  hash: string
  engine: string
  slides: SlideMeta[]
  updatedAt: string
  /** Live PowerPoint options (see Presentation); stores without them use the defaults. */
  livePowerPoint?: boolean
  useTimings?: boolean
  /** Image mode when absent. */
  mode?: PresentationMode
  /** Linked when absent: saving the original refreshes it. */
  linked?: boolean
  /** The native slides, one per slide, once Native mode was first used; null or absent before. */
  native?: NativeSlide[] | null
}

/** What to convert: one presentation file, or images in order. */
export interface PresentationSource {
  kind: PresentationKind
  title: string
  /** The file, or the folder the images came from. */
  sourcePath: string
  files: string[]
}

export interface ConvertResult {
  engine: string
  slides: SlideMeta[]
}

/** Writes slide-001.png, slide-002.png... into `outDir` and describes them. */
export type Converter = (
  source: PresentationSource,
  outDir: string,
  report: (message: string, done?: number, total?: number) => void,
) => Promise<ConvertResult>

export interface PresentationStore {
  list(): PresentationRecord[]
  get(id: number): PresentationRecord | undefined
  insert(record: Omit<PresentationRecord, 'id' | 'updatedAt'>): PresentationRecord
  update(id: number, patch: Partial<Pick<PresentationRecord, 'hash' | 'engine' | 'slides' | 'mode' | 'linked' | 'native'>>): PresentationRecord
  delete(id: number): boolean
}

export interface LibraryOptions {
  /** Where the slide pictures are cached, one folder per hash. */
  cacheDir: string
  store: PresentationStore
  convert: Converter
  /** Rebuilds a .pptx's slides for Native mode (see native.ts), one per slide picture. */
  buildNative?(source: PresentationSource, hash: string): Promise<NativeSlide[]>
  onProgress?(progress: PresentationProgress): void
  /** A linked original was saved and the presentation re-rendered. */
  onUpdated?(record: PresentationRecord): void
  /** A linked original was saved with new content; called before it is re-rendered. */
  onSourceChanged?(record: PresentationRecord): void
  /** Whether something besides the library (an older schedule item) still shows pictures from this hash. */
  hashInUse?(hash: string): boolean
  debounceMs?: number
}

export const PRESENTATION_EXTENSIONS = ['pptx', 'ppt', 'pdf']
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
/** Kinds whose original is one file the library can watch. */
const WATCHED_KINDS: PresentationKind[] = ['pptx', 'ppt', 'pdf']
const MANIFEST = 'manifest.json'

const extensionOf = (file: string) => path.extname(file).slice(1).toLowerCase()
const sourceOf = (record: PresentationRecord): PresentationSource => ({ kind: record.kind, title: record.title, sourcePath: record.sourcePath, files: [record.sourcePath] })
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Splits dropped or picked paths into presentations: each file or image folder is one; loose images make one. */
export async function groupSources(paths: string[]): Promise<PresentationSource[]> {
  const sources: PresentationSource[] = []
  const looseImages: string[] = []
  for (const given of paths) {
    const file = path.resolve(given)
    if ((await stat(file)).isDirectory()) {
      const images = (await readdir(file)).filter((name) => IMAGE_EXTENSIONS.includes(extensionOf(name)) && !name.startsWith('.')).sort(byName)
      if (images.length === 0) throw new Error(`${path.basename(file)} has no images in it`)
      sources.push({ kind: 'images', title: path.basename(file), sourcePath: file, files: images.map((name) => path.join(file, name)) })
    } else if (PRESENTATION_EXTENSIONS.includes(extensionOf(file))) {
      if (path.basename(file).startsWith('~$')) continue
      sources.push({ kind: extensionOf(file) as PresentationKind, title: path.basename(file, path.extname(file)), sourcePath: file, files: [file] })
    } else if (IMAGE_EXTENSIONS.includes(extensionOf(file))) {
      looseImages.push(file)
    } else {
      throw new Error(`${path.basename(file)} is not a presentation: use .pptx, .ppt, .pdf, images or a folder of images`)
    }
  }
  if (looseImages.length > 0) {
    looseImages.sort(byName)
    const folder = path.dirname(looseImages[0])
    const title = looseImages.length === 1 ? path.basename(looseImages[0], path.extname(looseImages[0])) : path.basename(folder)
    sources.push({ kind: 'images', title, sourcePath: folder, files: looseImages })
  }
  return sources
}

/** SHA-256 of the files' bytes, in order (with their names, for images). */
export async function hashFiles(files: string[]): Promise<string> {
  const hash = createHash('sha256')
  for (const file of files) {
    if (files.length > 1) hash.update(`${path.basename(file)}\0`)
    await new Promise<void>((resolve, reject) => {
      createReadStream(file)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', resolve)
        .on('error', reject)
    })
  }
  return hash.digest('hex')
}

export class PresentationLibrary {
  private readonly options: LibraryOptions
  private watcher: SourceWatcher | null = null
  /** Conversions run one at a time: PowerPoint and LibreOffice do not like being driven twice at once. */
  private queue: Promise<unknown> = Promise.resolve()
  private readonly refreshing = new Map<number, Promise<PresentationRecord | null>>()
  /** Saved again while refreshing; refreshed once more afterwards. */
  private readonly again = new Set<number>()

  constructor(options: LibraryOptions) {
    this.options = options
  }

  /** Starts watching every linked original. */
  start(): void {
    this.watcher = watchSources((file) => this.sourceChanged(file), this.options.debounceMs)
    this.syncWatches()
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }

  list(): PresentationRecord[] {
    return this.options.store.list()
  }

  cacheFolder(hash: string): string {
    return path.join(this.options.cacheDir, hash)
  }

  /**
   * Imports the paths (see groupSources), .pptx files in `mode`. An original already in the library (and still linked
   * to it) is refreshed and returned instead, switched to Native mode when that was asked for.
   */
  async import(paths: string[], mode: PresentationMode = 'image'): Promise<PresentationRecord[]> {
    const records: PresentationRecord[] = []
    for (const source of await groupSources(paths)) {
      const native = mode === 'native' && source.kind === 'pptx'
      const existing =
        source.kind !== 'images'
          ? this.list().find((r) => r.kind !== 'images' && r.linked !== false && samePathKey(r.sourcePath) === samePathKey(source.sourcePath))
          : undefined
      if (existing) {
        const refreshed = (await this.refresh(existing.id)) ?? existing
        records.push(native && refreshed.mode !== 'native' ? await this.setMode(existing.id, 'native') : refreshed)
        continue
      }
      const hash = await hashFiles(source.files)
      const result = await this.render(source, hash)
      // Without native slides (the error shows on the progress chip) it shows its pictures until switched again.
      const nativeSlides = native ? await this.native(source, hash, result.slides.length).catch(() => null) : null
      records.push(
        this.options.store.insert({ title: source.title, kind: source.kind, sourcePath: source.sourcePath, hash, ...result, mode: native ? 'native' : 'image', linked: true, native: nativeSlides }),
      )
    }
    this.syncWatches()
    return records
  }

  /** Switches a .pptx between Image and Native mode, building its native slides the first time. */
  async setMode(id: number, mode: PresentationMode): Promise<PresentationRecord> {
    const record = this.recordOf(id)
    if (mode === 'native' && record.kind !== 'pptx') throw new Error('Native mode needs a PowerPoint .pptx file')
    const native = mode === 'native' && !record.native ? await this.native(sourceOf(record), record.hash, record.slides.length) : record.native
    if (!this.options.store.get(id)) throw new Error('That presentation is no longer in the library')
    return this.options.store.update(id, { mode, native })
  }

  /** Shows one native slide as its picture, or natively again. */
  setSlideUseImage(id: number, index: number, useImage: boolean): PresentationRecord {
    return this.changeNative(id, index, (slide) => ({ ...slide, useImage }))
  }

  /** Saves an edited native slide; refreshing from a linked original replaces it. */
  updateNativeSlide(id: number, index: number, style: ThemeStyle): PresentationRecord {
    return this.changeNative(id, index, (slide) => ({ ...slide, style }))
  }

  /** Stops following the original: saving it no longer refreshes the slides, so edits made here stay. */
  detach(id: number): PresentationRecord {
    this.recordOf(id)
    const record = this.options.store.update(id, { linked: false })
    this.syncWatches()
    return record
  }

  private recordOf(id: number): PresentationRecord {
    const record = this.options.store.get(id)
    if (!record) throw new Error('That presentation is no longer in the library')
    return record
  }

  private changeNative(id: number, index: number, change: (slide: NativeSlide) => NativeSlide): PresentationRecord {
    const record = this.recordOf(id)
    const slide = record.native?.[index]
    if (!record.native || !slide) throw new Error('That slide has no native version')
    return this.options.store.update(id, { native: record.native.map((s, i) => (i === index ? change(slide) : s)) })
  }

  /** The native slides, one per slide picture: a slide the .pptx reader did not find shows its picture. */
  private async native(source: PresentationSource, hash: string, count: number): Promise<NativeSlide[] | null> {
    if (!this.options.buildNative) return null
    const report = (message: string, finished = false, error?: string) =>
      this.options.onProgress?.({ key: source.sourcePath, title: source.title, message, done: 0, total: 0, finished, ...(error ? { error } : {}) })
    report('Building native slides…')
    try {
      const slides = await this.options.buildNative(source, hash)
      report(`${count} native slides ready`, true)
      return Array.from({ length: count }, (_, i) => slides[i] ?? { style: null, warnings: [`Slide ${i + 1} shows its PowerPoint picture: it was not found in the file`], useImage: false })
    } catch (error) {
      report('Native mode failed', true, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  /**
   * Re-renders a presentation if its original changed since the last render (by hash). Resolves to the updated
   * record, or null when nothing changed. A save during a refresh is picked up by one more pass.
   */
  refresh(id: number): Promise<PresentationRecord | null> {
    const running = this.refreshing.get(id)
    if (running) {
      this.again.add(id)
      return running
    }
    const run = (async () => {
      let updated: PresentationRecord | null = null
      do {
        this.again.delete(id)
        updated = (await this.refreshOnce(id)) ?? updated
      } while (this.again.has(id))
      return updated
    })().finally(() => this.refreshing.delete(id))
    this.refreshing.set(id, run)
    return run
  }

  async remove(id: number): Promise<boolean> {
    const record = this.options.store.get(id)
    if (!record || !this.options.store.delete(id)) return false
    this.syncWatches()
    await this.dropCache(record.hash)
    return true
  }

  private syncWatches(): void {
    this.watcher?.setFiles(this.list().filter((r) => WATCHED_KINDS.includes(r.kind) && r.linked !== false).map((r) => r.sourcePath))
  }

  private sourceChanged(file: string): void {
    const key = samePathKey(file)
    for (const record of this.list()) {
      if (WATCHED_KINDS.includes(record.kind) && record.linked !== false && samePathKey(record.sourcePath) === key) {
        this.refresh(record.id).catch((error) => console.error(`Could not refresh ${record.title}:`, error))
      }
    }
  }

  private async refreshOnce(id: number): Promise<PresentationRecord | null> {
    const record = this.options.store.get(id)
    if (!record || record.kind === 'images' || record.linked === false) return null
    await waitUntilReadable(record.sourcePath)
    const hash = await hashFiles([record.sourcePath])
    if (hash === record.hash) return null
    this.options.onSourceChanged?.(record)
    const source = sourceOf(record)
    const result = await this.render(source, hash)
    // Native slides are read again from the saved file, replacing edits; the slides chosen to show their picture keep that.
    const rebuilt = record.mode === 'native' ? await this.native(source, hash, result.slides.length).catch(() => null) : null
    const native = rebuilt?.map((slide, i) => ({ ...slide, useImage: record.native?.[i]?.useImage ?? false })) ?? null
    // Deleted or detached while rendering.
    const current = this.options.store.get(id)
    if (!current || current.linked === false) return null
    const updated = this.options.store.update(id, { hash, ...result, native })
    // Listeners move schedule items onto the new pictures before the old ones go.
    this.options.onUpdated?.(updated)
    await this.dropCache(record.hash)
    return updated
  }

  /** The slide pictures for this hash: from the cache, or converted into it. */
  private async render(source: PresentationSource, hash: string): Promise<ConvertResult> {
    const folder = this.cacheFolder(hash)
    const cached = await readFile(path.join(folder, MANIFEST), 'utf8').then((json) => JSON.parse(json) as ConvertResult, () => null)
    if (cached) return cached

    const report = (message: string, done = 0, total = 0, finished = false, error?: string) =>
      this.options.onProgress?.({ key: source.sourcePath, title: source.title, message, done, total, finished, ...(error ? { error } : {}) })
    const task = this.queue.then(async () => {
      // Converted into a staging folder and moved into place whole, so a half-made cache is never used.
      const staging = `${folder}.tmp-${randomBytes(4).toString('hex')}`
      await mkdir(staging, { recursive: true })
      try {
        report('Starting…')
        const result = await this.options.convert(source, staging, report)
        if (result.slides.length === 0) throw new Error(`${source.title} has no slides`)
        await writeFile(path.join(staging, MANIFEST), JSON.stringify(result))
        await rm(folder, { recursive: true, force: true })
        await rename(staging, folder)
        report(`${result.slides.length} slides ready`, result.slides.length, result.slides.length, true)
        return result
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        report('Failed', 0, 0, true, error instanceof Error ? error.message : String(error))
        throw error
      }
    })
    this.queue = task.catch(() => undefined)
    return task
  }

  /** Deletes a hash's pictures once no presentation and nothing else uses them. */
  private async dropCache(hash: string): Promise<void> {
    if (this.list().some((r) => r.hash === hash) || this.options.hashInUse?.(hash)) return
    await rm(this.cacheFolder(hash), { recursive: true, force: true })
  }
}
