import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { requireFeature } from '../../shared/features'
import { normalizeTheme } from '../../shared/themes'
import type { NativeSlide, Presentation, PresentationEngineId, PresentationMode } from '../../shared/types'
import { findMediaByHash, insertMedia } from '../db/media'
import { presentationStore, scheduleUsesHash, setLinkedPages, setLiveOptions } from '../db/presentations'
import { getAppSettings } from '../db/settings'
import { copyIntoMedia, presentationImageUrl, presentationsDir, setDeckWaiter } from '../media'
import { createConverter } from '../presentations/convert'
import { engineStatus } from '../presentations/engines'
import { findFfmpeg } from '../presentations/ffmpeg'
import { IMAGE_EXTENSIONS, PRESENTATION_EXTENSIONS, PresentationLibrary, type PresentationRecord, type PresentationSource } from '../presentations/library'
import { readNativeSlides, resolveNativeMedia } from '../presentations/native'
import { createWindowRasterizer } from '../presentations/rasterizer'

// Arguments arrive from the renderer, so check their shape before they reach the disk or the database.

const MAX_PATHS = 200

function assertId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new TypeError('Presentation id must be a positive integer')
  return value as number
}

function assertPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATHS || !value.every((p) => typeof p === 'string' && path.isAbsolute(p))) {
    throw new TypeError(`Expected 1 to ${MAX_PATHS} absolute paths`)
  }
  return value
}

function assertIndex(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new TypeError('Slide index must be a whole number from 0')
  return value as number
}

const assertMode = (value: unknown): PresentationMode => {
  if (value !== 'image' && value !== 'native') throw new TypeError("Mode must be 'image' or 'native'")
  if (value === 'native') requireFeature('powerpoint.native')
  return value
}

/**
 * Reads a .pptx into native slides. Its pictures go into the presentation's cache folder (native/<sha256>.<ext>, so
 * the same picture is stored once); its clips go into the media library, once per clip by hash.
 */
async function buildNative(source: PresentationSource, hash: string): Promise<NativeSlide[]> {
  const deck = await readNativeSlides(new Uint8Array(await readFile(source.sourcePath)), source.sourcePath)
  const folder = path.join(presentationsDir(), hash, 'native')
  return resolveNativeMedia(deck, {
    store: {
      async image(bytes, extension) {
        const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`
        await mkdir(folder, { recursive: true })
        if (!existsSync(path.join(folder, name))) await writeFile(path.join(folder, name), bytes)
        return presentationImageUrl(hash, `native/${name}`)
      },
      findVideo: (clipHash) => findMediaByHash(clipHash)?.url ?? null,
      async addVideo(clipHash, file, name) {
        return insertMedia(name, 'video', await copyIntoMedia(file), clipHash).url
      },
    },
    ffmpeg: findFfmpeg(),
    workDir: path.join(os.tmpdir(), `worshipdeck-native-${randomBytes(4).toString('hex')}`),
    title: source.title,
  })
}

export function toPresentation(record: PresentationRecord): Presentation {
  return {
    id: record.id,
    title: record.title,
    kind: record.kind,
    sourcePath: record.sourcePath,
    hash: record.hash,
    engine: record.engine as Presentation['engine'],
    updatedAt: record.updatedAt,
    livePowerPoint: record.livePowerPoint ?? true,
    useTimings: record.useTimings ?? false,
    mode: record.mode ?? 'image',
    linked: record.linked ?? true,
    slides: record.slides.map((slide, index) => {
      const native = record.native?.[index]
      return {
        image: presentationImageUrl(record.hash, slide.file),
        ...(slide.thumb ? { thumb: presentationImageUrl(record.hash, slide.thumb) } : {}),
        title: slide.title,
        text: slide.text,
        notes: slide.notes,
        animated: slide.animated,
        ...(native ? { native } : {}),
      }
    }),
  }
}

/** A two slide deck with invented text, for Test conversion. */
async function samplePresentation(file: string): Promise<void> {
  const deck = new PptxGenJS()
  deck.layout = 'LAYOUT_16x9'
  for (const [title, body] of [
    ['Test conversion', 'If you can read this, presentations import.'],
    ['Second slide', 'Notes and slide order come along too.'],
  ]) {
    const slide = deck.addSlide()
    slide.addText(title, { x: 0.5, y: 1.5, w: 9, h: 1, fontSize: 40, bold: true })
    slide.addText(body, { x: 0.5, y: 2.7, w: 9, h: 1, fontSize: 24 })
    slide.addNotes(`Speaker notes for ${title.toLowerCase()}`)
  }
  await writeFile(file, (await deck.write({ outputType: 'nodebuffer' })) as Buffer)
}

interface Options {
  /** The hidden window that draws slides (the renderer at #/rasterize). */
  createRasterWindow(): BrowserWindow
  getOperatorWindow(): BrowserWindow | null
  /** Where the bundled PowerShell and AppleScript files are. */
  resourcesDir: string
  /** A linked original was saved with new content (Live PowerPoint replaces its copy). */
  onSourceChanged?(presentationId: number): void
  /** Runs PowerPoint work only while Live PowerPoint's show is covered, since PowerPoint's windows can show over it. */
  whileShowCovered?<T>(task: () => Promise<T>): Promise<T>
}

/** Registers the Presentations IPC and starts watching linked originals. Returns a function that stops it. */
export function registerPresentationIpc({ createRasterWindow, getOperatorWindow, resourcesDir, onSourceChanged, whileShowCovered }: Options): () => Promise<void> {
  const rasterizer = createWindowRasterizer(createRasterWindow)
  const converter = createConverter({
    rasterizer,
    engineSetting: () => getAppSettings().presentationEngine,
    script: (name) => path.join(resourcesDir, name),
  })
  // PowerPoint files may be converted by PowerPoint, which opens windows; never over a live slide show.
  const convert: typeof converter = (source, outDir, report, job) =>
    whileShowCovered && (source.kind === 'pptx' || source.kind === 'ppt')
      ? whileShowCovered(() => converter(source, outDir, report, job))
      : converter(source, outDir, report, job)
  const send = (channel: string, value: unknown) => {
    const win = getOperatorWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, value)
  }
  const library = new PresentationLibrary({
    cacheDir: presentationsDir(),
    store: presentationStore,
    convert,
    buildNative,
    onProgress: (progress) => send('presentations:progress', progress),
    onUpdated: (record) => {
      const presentation = toPresentation(record)
      setLinkedPages(record.id, presentation.slides.map((slide) => slide.image))
      send('presentations:updated', presentation)
    },
    onSourceChanged: (record) => {
      send('presentations:changed', record.id)
      onSourceChanged?.(record.id)
    },
    hashInUse: scheduleUsesHash,
    fileUrl: presentationImageUrl,
  })
  library.start()
  setDeckWaiter((hash, file) => library.whenWritten(hash, file))

  ipcMain.handle('presentations:list', () => library.list().map(toPresentation))

  ipcMain.handle('presentations:pick', async (event, kind: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions =
      kind === 'folder'
        ? { title: 'Choose a folder of images', properties: ['openDirectory'] }
        : {
            title: 'Import presentations',
            properties: ['openFile', 'multiSelections'],
            filters: [
              { name: 'Presentations, PDFs and images', extensions: [...PRESENTATION_EXTENSIONS, ...IMAGE_EXTENSIONS] },
              { name: 'PowerPoint', extensions: ['pptx', 'ppt'] },
              { name: 'PDF', extensions: ['pdf'] },
              { name: 'Images', extensions: IMAGE_EXTENSIONS },
            ],
          }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return canceled ? [] : filePaths
  })

  ipcMain.handle('presentations:import', async (_event, paths: unknown, mode: unknown) =>
    (await library.import(assertPaths(paths), mode === undefined ? 'image' : assertMode(mode))).map(toPresentation),
  )

  ipcMain.handle('presentations:cancel', (_event, key: unknown) => {
    if (typeof key === 'string') library.cancel(key)
  })

  ipcMain.handle('presentations:setMode', async (_event, id: unknown, mode: unknown) => toPresentation(await library.setMode(assertId(id), assertMode(mode))))

  ipcMain.handle('presentations:setSlideUseImage', (_event, id: unknown, index: unknown, useImage: unknown) =>
    toPresentation(library.setSlideUseImage(assertId(id), assertIndex(index), useImage === true)),
  )

  ipcMain.handle('presentations:updateNativeSlide', (_event, id: unknown, index: unknown, style: unknown) =>
    toPresentation(library.updateNativeSlide(assertId(id), assertIndex(index), { ...normalizeTheme(style), category: 'presentation' })),
  )

  ipcMain.handle('presentations:detach', (_event, id: unknown) => toPresentation(library.detach(assertId(id))))

  ipcMain.handle('presentations:delete', (_event, id: unknown) => library.remove(assertId(id)))

  ipcMain.handle('presentations:openOriginal', async (_event, id: unknown) => {
    const record = presentationStore.get(assertId(id))
    if (!record) throw new Error('That presentation is no longer in the library')
    if (!existsSync(record.sourcePath)) throw new Error(`The original is no longer at ${record.sourcePath}`)
    const failure = await shell.openPath(record.sourcePath)
    if (failure) throw new Error(failure)
  })

  ipcMain.handle('presentations:setLiveOptions', (_event, id: unknown, options: unknown) => {
    const o = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>
    const flag = (value: unknown) => (typeof value === 'boolean' ? value : undefined)
    const record = setLiveOptions(assertId(id), { livePowerPoint: flag(o.livePowerPoint), useTimings: flag(o.useTimings) })
    if (!record) throw new Error('That presentation is no longer in the library')
    return toPresentation(record)
  })

  ipcMain.handle('presentations:engineStatus', () => engineStatus(getAppSettings().presentationEngine))

  ipcMain.handle('presentations:testConversion', async () => {
    const status = await engineStatus(getAppSettings().presentationEngine)
    if (!status.active) throw new Error(status.message ?? 'No presentation engine is available')
    const work = await mkdtemp(path.join(os.tmpdir(), 'worshipdeck-test-'))
    try {
      const file = path.join(work, 'Test conversion.pptx')
      await samplePresentation(file)
      const outDir = path.join(work, 'out')
      await mkdir(outDir)
      const started = Date.now()
      const result = await convert({ kind: 'pptx', title: 'Test conversion', sourcePath: file, files: [file] }, outDir, () => {})
      return { engine: result.engine as PresentationEngineId, slides: result.slides.length, ms: Date.now() - started }
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })

  return async () => {
    await library.close()
    rasterizer.close()
  }
}
