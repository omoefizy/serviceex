// Sermon exports in the main process: a PDF printed from the HTML page in shared/sermons by a hidden window, and a
// PowerPoint file made with pptxgenjs. Everything stays on this computer; the hidden window loads nothing remote.

import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { sermonFooter, sermonHtml, sermonTitle } from '../../shared/sermons'
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
  const file = path.join(app.getPath('temp'), `worshipdeck-sermon-${process.pid}-${Date.now()}.html`)
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

/** A 16:9 PowerPoint deck: a title slide, then one slide per idea. The words are shrunk to fit their box. */
export async function renderSermonPptx(sermon: Sermon, slides: string[]): Promise<Buffer> {
  const deck = new PptxGenJS()
  deck.layout = 'LAYOUT_16x9'
  deck.title = sermonTitle(sermon)
  const background = { color: '101418' }
  const text = { fontFace: 'Calibri', color: 'FFFFFF', align: 'center' as const, valign: 'middle' as const, fit: 'shrink' as const }

  const first = deck.addSlide()
  first.background = background
  first.addText(sermonTitle(sermon), { ...text, x: 0.5, y: 1.4, w: 9, h: 1.8, fontSize: 44, bold: true })
  const byline = [sermon.preacher, sermon.series].map((s) => s.trim()).filter(Boolean).join(' · ')
  if (byline) first.addText(byline, { ...text, x: 0.5, y: 3.3, w: 9, h: 0.8, fontSize: 24, color: 'C8CCD2' })

  for (const slideText of slides) {
    const slide = deck.addSlide()
    slide.background = background
    // A {reference} line (see sermonSlideTexts) goes under the words in the reference color.
    const lines = slideText.split('\n')
    const reference = /^\{(.+)\}$/.exec(lines.at(-1) ?? '')
    const words = (reference ? lines.slice(0, -1) : lines).join('\n')
    slide.addText(words, { ...text, x: 0.6, y: 0.5, w: 8.8, h: reference ? 3.9 : 4.6, fontSize: 36 })
    if (reference) slide.addText(reference[1], { ...text, x: 0.6, y: 4.5, w: 8.8, h: 0.7, fontSize: 24, color: 'FFD400' })
  }
  return (await deck.write({ outputType: 'nodebuffer' })) as Buffer
}
