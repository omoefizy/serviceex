// Sermon exports in the main process: a PDF printed from the HTML page in shared/sermons by a hidden window, and a
// PowerPoint file made with pptxgenjs. Everything stays on this computer; the hidden window loads nothing remote.

import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { fitFontSize, sermonFooter, sermonHtml, type DeckSlide } from '../../shared/sermons'
import type { Sermon, SermonExportOptions } from '../../shared/types'

/** The bundled OFL font the PDF is set in (see public/fonts/LICENSES.txt). */
const PDF_FONT = 'SourceSans3-Variable.woff2'

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
}

/** A data URL of a file, or null when it is missing, unreadable or not a picture, so the export goes on without it. */
export async function fileDataUrl(file: string | null, types: Record<string, string> = IMAGE_TYPES): Promise<string | null> {
  if (!file) return null
  const type = types[path.extname(file).toLowerCase()]
  if (!type || !existsSync(file)) return null
  try {
    return `data:${type};base64,${(await readFile(file)).toString('base64')}`
  } catch (error) {
    console.error('Could not read a file for the sermon export', error)
    return null
  }
}

const fontFile = () => path.join(process.env.VITE_PUBLIC ?? path.join(app.getAppPath(), 'public'), 'fonts', PDF_FONT)

/** The PDF of a sermon, A4, with page numbers and the footer line on every page. */
export async function renderSermonPdf(sermon: Sermon, options: SermonExportOptions, logoFile: string | null, footerLine: string): Promise<Buffer> {
  const [logoUrl, fontUrl] = await Promise.all([fileDataUrl(logoFile), fileDataUrl(fontFile(), { '.woff2': 'font/woff2' })])
  const html = sermonHtml(sermon, options, { logoUrl, fontUrl })
  return printHtml(html, footerLine)
}

/** Prints a page to PDF from a temporary file in a hidden, sandboxed window that may not navigate anywhere. */
export async function printHtml(html: string, footerLine: string): Promise<Buffer> {
  const file = path.join(app.getPath('temp'), `serviceex-sermon-${process.pid}-${Date.now()}.html`)
  await writeFile(file, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, spellcheck: false },
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await win.loadFile(file)
    // The bundled font is a data URL; wait until it is ready so the first page is not set in the fallback font.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true)
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: sermonFooter(footerLine),
      margins: { top: 0.7, bottom: 0.8, left: 0.75, right: 0.75 },
      generateDocumentOutline: true,
    })
  } finally {
    win.destroy()
    await rm(file, { force: true }).catch(() => undefined)
  }
}

/** Width and height in pixels of a PNG, JPEG or GIF, read from its header; null for anything else. */
export function imageSize(data: Buffer): { width: number; height: number } | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  if (data.length > 10 && data.toString('latin1', 0, 3) === 'GIF') return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    // Walk the JPEG segments to the frame header (SOF0 to SOF15, except DHT, JPG and DAC).
    let at = 2
    while (at + 9 < data.length && data[at] === 0xff) {
      const marker = data[at + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5) }
      }
      at += 2 + data.readUInt16BE(at + 2)
    }
  }
  return null
}

/** The church logo for the title slide, when it is a PNG, JPEG or GIF that can be read. */
async function readLogo(file: string | null): Promise<{ data: string; width: number; height: number } | null> {
  const url = await fileDataUrl(file, { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' })
  if (!url) return null
  const size = imageSize(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
  return size && size.width > 0 && size.height > 0 ? { data: url.replace(/^data:/, ''), ...size } : null
}

/**
 * A 16:9 PowerPoint deck from sermonDeck: one slide per idea, the church logo on the title slide when there is one.
 * Each text's size is chosen so it fits its box (see fitFontSize), with PowerPoint's shrink-to-fit on as well.
 */
export async function renderSermonPptx(title: string, slides: DeckSlide[], logoFile: string | null): Promise<Buffer> {
  const deck = new PptxGenJS()
  deck.layout = 'LAYOUT_16x9'
  deck.title = title
  const logo = await readLogo(logoFile)
  const background = { color: '101418' }
  const base = { fontFace: 'Calibri', color: 'FFFFFF', align: 'center' as const, valign: 'middle' as const, fit: 'shrink' as const, margin: 0 }
  /** Text sized to fit a box of w by h inches, from `max` points down. */
  const add = (slide: PptxGenJS.Slide, text: string, box: { x: number; y: number; w: number; h: number }, max: number, extra: PptxGenJS.TextPropsOptions = {}) =>
    slide.addText(text, { ...base, ...box, fontSize: fitFontSize(text, box.w, box.h, max, 12), ...extra })

  for (const item of slides) {
    const slide = deck.addSlide()
    slide.background = background
    switch (item.kind) {
      case 'title': {
        // The logo sits above the title, at most 3 by 1 inches, keeping its shape.
        let top = 1.0
        if (logo) {
          const scale = Math.min(3 / logo.width, 1 / logo.height)
          const w = logo.width * scale
          const h = logo.height * scale
          slide.addImage({ data: logo.data, x: (10 - w) / 2, y: 0.4, w, h })
          top = 1.6
        }
        add(slide, item.title, { x: 0.6, y: top, w: 8.8, h: 1.9 }, 44, { bold: true })
        if (item.lines.length > 0) add(slide, item.lines.join('\n'), { x: 0.6, y: top + 2.05, w: 8.8, h: 5.2 - top - 2.05 }, 24, { color: 'C8CCD2' })
        break
      }
      case 'scripture':
        if (item.text) {
          add(slide, item.text, { x: 0.6, y: 0.5, w: 8.8, h: 3.8 }, 36)
          add(slide, item.reference, { x: 0.6, y: 4.45, w: 8.8, h: 0.7 }, 24, { color: 'FFD400' })
        } else {
          add(slide, item.reference, { x: 0.6, y: 1.2, w: 8.8, h: 3.2 }, 48, { color: 'FFD400', bold: true })
        }
        break
      case 'statement':
        add(slide, `“${item.text}”`, { x: 0.8, y: 0.6, w: 8.4, h: 4.4 }, 40, { italic: true })
        break
      case 'point':
        add(slide, item.text, { x: 0.6, y: 0.6, w: 8.8, h: 4.4 }, 40)
        break
      case 'closing':
        add(slide, item.text, { x: 0.6, y: 1.4, w: 8.8, h: 1.6 }, 40, { bold: true })
        if (item.lines.length > 0) add(slide, item.lines.join('\n'), { x: 0.6, y: 3.1, w: 8.8, h: 1.0 }, 24, { color: 'C8CCD2' })
        break
    }
  }
  return (await deck.write({ outputType: 'nodebuffer' })) as Buffer
}
