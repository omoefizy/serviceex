// The presentation library: imports originals, renders them into cached slide pictures, and re-renders a linked
// original when it is saved again. Nothing here touches Electron, so tests can run it with a stand-in converter
// and store.

import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PresentationKind, PresentationProgress } from '../../shared/types'
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
  update(id: number, patch: Pick<PresentationRecord, 'hash' | 'engine' | 'slides'>): PresentationRecord
  delete(id: number): boolean
}

export interface LibraryOptions {
  /** Where the slide pictures are cached, one folder per hash. */
  cacheDir: string
  store: PresentationStore
  convert: Converter
  onProgress?(progress: PresentationProgress): void
  /** A linked original was saved and the presentation re-rendered. */
  onUpdated?(record: PresentationRecord): void
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

  /** Imports the paths (see groupSources). An original already in the library is refreshed and returned instead. */
  async import(paths: string[]): Promise<PresentationRecord[]> {
    const records: PresentationRecord[] = []
    for (const source of await groupSources(paths)) {
      const existing =
        source.kind !== 'images' ? this.list().find((r) => r.kind !== 'images' && samePathKey(r.sourcePath) === samePathKey(source.sourcePath)) : undefined
      if (existing) {
        records.push((await this.refresh(existing.id)) ?? existing)
        continue
      }
      const hash = await hashFiles(source.files)
      const result = await this.render(source, hash)
      records.push(this.options.store.insert({ title: source.title, kind: source.kind, sourcePath: source.sourcePath, hash, ...result }))
    }
    this.syncWatches()
    return records
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
    this.watcher?.setFiles(this.list().filter((r) => WATCHED_KINDS.includes(r.kind)).map((r) => r.sourcePath))
  }

  private sourceChanged(file: string): void {
    const key = samePathKey(file)
    for (const record of this.list()) {
      if (WATCHED_KINDS.includes(record.kind) && samePathKey(record.sourcePath) === key) {
        this.refresh(record.id).catch((error) => console.error(`Could not refresh ${record.title}:`, error))
      }
    }
  }

  private async refreshOnce(id: number): Promise<PresentationRecord | null> {
    const record = this.options.store.get(id)
    if (!record || record.kind === 'images') return null
    await waitUntilReadable(record.sourcePath)
    const hash = await hashFiles([record.sourcePath])
    if (hash === record.hash) return null
    const source: PresentationSource = { kind: record.kind, title: record.title, sourcePath: record.sourcePath, files: [record.sourcePath] }
    const result = await this.render(source, hash)
    // Deleted while rendering.
    if (!this.options.store.get(id)) return null
    const updated = this.options.store.update(id, { hash, ...result })
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
