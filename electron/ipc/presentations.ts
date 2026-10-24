import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import type { Presentation, PresentationEngineId } from '../../shared/types'
import { presentationStore, scheduleUsesHash, setLinkedPages, setLiveOptions } from '../db/presentations'
import { getAppSettings } from '../db/settings'
import { presentationImageUrl, presentationsDir } from '../media'
import { createConverter } from '../presentations/convert'
import { engineStatus } from '../presentations/engines'
import { IMAGE_EXTENSIONS, PRESENTATION_EXTENSIONS, PresentationLibrary, type PresentationRecord } from '../presentations/library'
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
    slides: record.slides.map((slide) => ({
      image: presentationImageUrl(record.hash, slide.file),
      title: slide.title,
      text: slide.text,
      notes: slide.notes,
      animated: slide.animated,
    })),
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
  const convert: typeof converter = (source, outDir, report) =>
    whileShowCovered && (source.kind === 'pptx' || source.kind === 'ppt') ? whileShowCovered(() => converter(source, outDir, report)) : converter(source, outDir, report)
  const send = (channel: string, value: unknown) => {
    const win = getOperatorWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, value)
  }
  const library = new PresentationLibrary({
    cacheDir: presentationsDir(),
    store: presentationStore,
    convert,
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
  })
  library.start()

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

  ipcMain.handle('presentations:import', async (_event, paths: unknown) => (await library.import(assertPaths(paths))).map(toPresentation))

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
