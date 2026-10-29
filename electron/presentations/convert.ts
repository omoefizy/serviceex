// Turns a presentation source into 1920x1080 slide pictures plus text, notes and animation flags. Images and PDFs
// need no engine; PowerPoint files go through the active engine (see engines.ts). Slide text, notes and the
// animation and transition flags of a .pptx always come from its XML, whichever engine drew it.

import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { PresentationEngineId, PresentationEngineSetting } from '../../shared/types'
import { engineStatus, exportWithLibreOffice, exportWithMacPowerPoint, exportWithWindowsPowerPoint } from './engines'
import { ImportCancelledError, type ConvertJob, type Converter, type SlideMeta } from './library'
import { readPptx, type PptxSlideInfo } from './pptx'

/**
 * Pictures written into a folder as slide-001.png, slide-002.png..., each with a small thumb-001.jpg... and the
 * text found on the page.
 */
export interface RasterPage {
  file: string
  thumb: string
  text: string
}

/** What a rasterizer reports while it draws, and how it is stopped or steered. */
export interface RasterWork {
  /** A page's thumbnail is written. Every page gets one before any full picture is drawn. */
  onThumb?(index: number, total: number, page: RasterPage): void
  /** A page's full picture is written. */
  onPage(index: number, total: number): void
  signal?: AbortSignal
  /** Receives a function that has a page's full picture drawn next. */
  setWant?(want: (index: number) => void): void
}

/** Draws pictures in a hidden renderer: PDF pages, or images fitted onto a black 16:9 slide. */
export interface Rasterizer {
  pdf(data: Uint8Array, outDir: string, work: RasterWork): Promise<RasterPage[]>
  images(images: Uint8Array[], outDir: string, work: RasterWork): Promise<RasterPage[]>
}

export interface ConverterOptions {
  rasterizer: Rasterizer
  engineSetting(): PresentationEngineSetting
  /** The bundled scripts' path by file name. */
  script(name: string): string
}

const ENGINE_NAMES: Record<PresentationEngineId, string> = {
  'powerpoint-windows': 'PowerPoint',
  'powerpoint-mac': 'PowerPoint',
  libreoffice: 'LibreOffice',
}

/** Pairs pictures with what the .pptx says about the visible slides, by position. */
function describe(pages: RasterPage[], info: Omit<PptxSlideInfo, 'hidden' | 'steps' | 'clickMs'>[] | null): SlideMeta[] {
  return pages.map((page, index) => {
    const slide = info?.[index]
    return {
      file: page.file,
      thumb: page.thumb,
      title: slide?.title ?? '',
      text: slide?.text ?? page.text,
      notes: slide?.notes ?? '',
      animated: slide?.animated ?? false,
    }
  })
}

export function createConverter({ rasterizer, engineSetting, script }: ConverterOptions): Converter {
  return async (source, outDir, report, job: ConvertJob = {}) => {
    const signal = job.signal
    let full = 0
    const work = (): RasterWork => ({
      signal,
      setWant: job.setWant,
      onThumb(index, total, page) {
        job.onSlide?.(index, total, page)
      },
      onPage(index, total) {
        full++
        job.onFull?.(index)
        report(`Importing ${full} of ${total}…`, full, total)
      },
    })
    const check = () => {
      if (signal?.aborted) throw new ImportCancelledError()
    }

    if (source.kind === 'images') {
      report('Reading images…', 0, source.files.length)
      const images = await Promise.all(source.files.map(async (file) => new Uint8Array(await readFile(file))))
      return { engine: 'images', slides: describe(await rasterizer.images(images, outDir, work()), null) }
    }

    const file = source.files[0]
    if (source.kind === 'pdf') {
      report('Reading PDF…')
      const pages = await rasterizer.pdf(new Uint8Array(await readFile(file)), outDir, work())
      return { engine: 'pdf', slides: describe(pages, null) }
    }

    check()
    const status = await engineStatus(engineSetting())
    if (!status.active) throw new Error(status.message ?? 'No presentation engine is available')
    const engine = status.active
    let info: PptxSlideInfo[] | null = null
    if (source.kind === 'pptx') {
      try {
        info = readPptx(new Uint8Array(await readFile(file)))
      } catch (error) {
        // The pictures still work; the slides just have no text or notes.
        console.error(`Could not read the slides of ${path.basename(file)}:`, error)
      }
    }
    const visible = info?.filter((slide) => !slide.hidden) ?? null

    report(`Opening in ${ENGINE_NAMES[engine]}…`)
    if (engine === 'powerpoint-windows') {
      // PowerPoint writes its pictures at the slide's shape, then they are fitted onto 1920x1080 like images.
      const exportDir = path.join(outDir, 'export')
      await mkdir(exportDir, { recursive: true })
      const com = await exportWithWindowsPowerPoint(file, exportDir, script('powerpoint-export.ps1'), signal)
      check()
      const images = await Promise.all(com.map(async (slide) => new Uint8Array(await readFile(path.join(exportDir, slide.file)))))
      const pages = await rasterizer.images(images, outDir, work())
      await rm(exportDir, { recursive: true, force: true })
      const fromCom = com.map((slide) => ({
        title: slide.title ?? '',
        text: slide.text ?? '',
        notes: slide.notes ?? '',
        animated: slide.animations > 0 || slide.transition === true,
      }))
      return { engine, slides: describe(pages, visible ?? fromCom) }
    }

    const pdf =
      engine === 'powerpoint-mac'
        ? await exportWithMacPowerPoint(file, script('powerpoint-export.applescript'), signal)
        : await exportWithLibreOffice(file, status.libreOffice as string, signal)
    check()
    const pages = await rasterizer.pdf(pdf, outDir, work())
    return { engine, slides: describe(pages, visible) }
  }
}
