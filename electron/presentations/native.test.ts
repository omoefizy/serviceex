// Builds a small .pptx with invented content (a full-slide video made with ffmpeg's lavfi test source, a logo, text
// boxes and a table) and checks what Native mode makes of it: the video becomes the background and goes into the
// media library once, text boxes land where PowerPoint put them, slides sharing the video share one playing video
// element, and the slide with a table shows its picture with a warning. Needs ffmpeg; skipped without it.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NativeSlide, ThemeElement, ThemeStyle } from '../../shared/types'
import { backdropKey } from '../../src/components/themedSlideLayers'
import { findFfmpeg } from './ffmpeg'
import { readNativeSlides, resolveNativeMedia, type NativeDeck, type NativeMediaStore } from './native'

const ffmpeg = findFfmpeg()
/** pptxgenjs's 16:9 layout is 10 by 5.625 inches. */
const WIDTH_IN = 10
const HEIGHT_IN = 5.625

/** A media store that keeps everything in memory and counts what went into the library. */
function memoryMediaStore() {
  const videos = new Map<string, string>()
  const added: { hash: string; name: string; bytes: number }[] = []
  const images = new Set<string>()
  const store: NativeMediaStore = {
    async image(bytes, extension) {
      const url = `wd-media://deck/test/native/${createHash('sha256').update(bytes).digest('hex')}.${extension}`
      images.add(url)
      return url
    },
    findVideo: (hash) => videos.get(hash) ?? null,
    async addVideo(hash, file, name) {
      added.push({ hash, name, bytes: (await readFile(file)).length })
      const url = `wd-media://local/${hash}${path.extname(file)}`
      videos.set(hash, url)
      return url
    },
  }
  return { store, added, images }
}

const elementsOf = (style: ThemeStyle | null, kind: ThemeElement['kind']) => (style?.elements ?? []).filter((e) => e.kind === kind)

describe.skipIf(!ffmpeg)('Native mode', () => {
  let work: string
  let file: string
  let deck: NativeDeck
  let slides: NativeSlide[]
  let media: ReturnType<typeof memoryMediaStore>

  beforeAll(async () => {
    work = await mkdtemp(path.join(os.tmpdir(), 'worshipdeck-native-'))
    const video = path.join(work, 'motion.mp4')
    const logo = path.join(work, 'logo.png')
    execFileSync(ffmpeg!, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15', '-t', '2', '-pix_fmt', 'yuv420p', video])
    execFileSync(ffmpeg!, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xd4a017:size=128x128', '-frames:v', '1', logo])

    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_16x9'
    const first = pptx.addSlide()
    first.addMedia({ type: 'video', path: video, x: 0, y: 0, w: WIDTH_IN, h: HEIGHT_IN })
    first.addText('Welcome to Grace Fellowship', { x: 1, y: 1, w: 8, h: 1.5, fontSize: 40, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Georgia' })
    first.addImage({ path: logo, x: 8.5, y: 0.2, w: 1, h: 1 })
    const second = pptx.addSlide()
    second.addMedia({ type: 'video', path: video, x: 0, y: 0, w: WIDTH_IN, h: HEIGHT_IN })
    second.addText('Coffee after the service', { x: 0.5, y: 3.5, w: 9, h: 1, fontSize: 28, color: 'FFCC00', align: 'left' })
    const third = pptx.addSlide()
    third.background = { color: '1A2B3C' }
    third.addText('Prayer list', { x: 1, y: 0.5, w: 8, h: 1, fontSize: 32, color: 'FFFFFF' })
    third.addTable([[{ text: 'Name' }, { text: 'Request' }], [{ text: 'Sam' }, { text: 'Travel' }]], { x: 1, y: 2, w: 8 })

    file = path.join(work, 'Sunday welcome.pptx')
    const bytes = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
    await writeFile(file, bytes)
    deck = await readNativeSlides(new Uint8Array(bytes), file)
    media = memoryMediaStore()
    slides = await resolveNativeMedia(deck, { store: media.store, ffmpeg, workDir: path.join(work, 'scratch'), title: 'Sunday welcome' })
  }, 60_000)

  afterAll(async () => {
    await rm(work, { recursive: true, force: true })
  })

  it('detects the full-slide video as the background and extracts it to the media library once', () => {
    expect(deck.slides[0].videos).toEqual([expect.objectContaining({ target: 'background' })])
    expect(slides[0].style?.background).toEqual({ kind: 'video', src: expect.stringMatching(/^wd-media:\/\/local\//) })
    expect(elementsOf(slides[0].style, 'video')).toEqual([])
    // pptxgenjs embeds the clip once per slide; the copies have the same hash, so the library gets one.
    expect(media.added).toHaveLength(1)
    expect(media.added[0].bytes).toBeGreaterThan(0)
    expect(media.added[0].name).toBe('Sunday welcome · media-1-1')
  })

  it('places text boxes where PowerPoint has them, with their look', () => {
    const [text] = elementsOf(slides[0].style, 'text')
    if (text?.kind !== 'text') throw new Error('no text box')
    // PowerPoint insets text 0.1" left and right and 0.05" top and bottom; the box keeps the smaller inset as
    // padding and moves its left and right edges in by the difference, 0.05".
    const inset = (0.05 / WIDTH_IN) * 100
    expect(text.box.x).toBeCloseTo((1 / WIDTH_IN) * 100 + inset, 2)
    expect(text.box.y).toBeCloseTo((1 / HEIGHT_IN) * 100, 2)
    expect(text.box.width).toBeCloseTo((8 / WIDTH_IN) * 100 - 2 * inset, 2)
    expect(text.box.height).toBeCloseTo((1.5 / HEIGHT_IN) * 100, 2)
    expect(text.text.padding).toBeCloseTo((0.05 / HEIGHT_IN) * 100, 2)
    // 40 pt on a 5.625" (405 pt) slide.
    expect(text.text.fontSize).toBeCloseTo((40 / 405) * 100, 2)
    expect(text.text).toMatchObject({ fontFamily: 'Georgia', fontWeight: 700, color: '#ffffff', align: 'center', sizeMode: 'fixed' })
    expect(text.paragraphs?.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['Welcome to Grace Fellowship'])

    const [second] = elementsOf(slides[1].style, 'text')
    expect(second?.box.y).toBeCloseTo((3.5 / HEIGHT_IN) * 100, 2)
    expect(second?.kind === 'text' && second.text).toMatchObject({ color: '#ffcc00', align: 'left' })
  })

  it('keeps the logo as an image element', () => {
    const [logo] = elementsOf(slides[0].style, 'image')
    expect(logo?.kind === 'image' && logo.src).toMatch(/^wd-media:\/\/deck\//)
    expect(logo?.box.x).toBeCloseTo((8.5 / WIDTH_IN) * 100, 2)
    expect(logo?.box.width).toBeCloseTo((1 / WIDTH_IN) * 100, 2)
  })

  it('gives slides that share a video one background, so one video element keeps playing', () => {
    const [first, second, third] = slides.map((slide) => slide.style)
    expect(first?.background).toEqual(second?.background)
    // The output window keeps one backdrop frame (and its video) for as long as this key stays the same.
    expect(backdropKey(first!)).toBe(backdropKey(second!))
    expect(JSON.stringify(first?.elements)).not.toBe(JSON.stringify(second?.elements))
    expect(third).toBeNull()
  })

  it('falls back to the picture for a slide with a table, with a warning', () => {
    expect(slides[2]).toEqual({ style: null, useImage: false, warnings: [expect.stringContaining('Slide 3 shows its PowerPoint picture')] })
    expect(slides[2].warnings[0]).toContain('tables')
    expect(slides[0].warnings).toEqual([])
  })

  it('converts a clip that cannot play, or warns with the slide number without ffmpeg', async () => {
    const wmv = path.join(work, 'old.wmv')
    execFileSync(ffmpeg!, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-t', '1', '-c:v', 'wmv2', wmv])
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_16x9'
    pptx.addSlide().addMedia({ type: 'video', path: wmv, x: 0, y: 0, w: WIDTH_IN, h: HEIGHT_IN })
    const old = await readNativeSlides(new Uint8Array((await pptx.write({ outputType: 'nodebuffer' })) as Buffer), file)

    const converted = memoryMediaStore()
    const [withFfmpeg] = await resolveNativeMedia(old, { store: converted.store, ffmpeg, workDir: path.join(work, 'convert'), title: 'Old' })
    expect(withFfmpeg.style?.background).toEqual({ kind: 'video', src: expect.stringMatching(/\.mp4$/) })
    expect(withFfmpeg.warnings).toEqual([])

    const [without] = await resolveNativeMedia(old, { store: memoryMediaStore().store, ffmpeg: null, workDir: path.join(work, 'no-ffmpeg'), title: 'Old' })
    expect(without.warnings).toEqual([expect.stringMatching(/^Slide 1: the video .*\(WMV\) cannot play.*Install ffmpeg/)])
    expect(without.style?.background.kind).toBe('image')
  }, 30_000)

  it('reads a slide with a solid background natively', async () => {
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_16x9'
    const slide = pptx.addSlide()
    slide.background = { color: '1A2B3C' }
    slide.addShape('rect', { x: 0, y: 4.5, w: 10, h: 1.125, fill: { color: '2255AA' } })
    slide.addText('Announcements', { x: 1, y: 0.5, w: 8, h: 1, fontSize: 32, color: 'FFFFFF', shadow: { type: 'outer', blur: 3, offset: 2, angle: 45, color: '000000' } })
    const plain = await readNativeSlides(new Uint8Array((await pptx.write({ outputType: 'nodebuffer' })) as Buffer), file)
    const [style] = plain.slides.map((s) => s.style)
    expect(style?.background).toEqual({ kind: 'solid', color: '#1a2b3c' })
    expect(elementsOf(style, 'shape')).toEqual([expect.objectContaining({ color: '#2255aa', box: { x: 0, y: 80, width: 100, height: 20 } })])
    const [text] = elementsOf(style, 'text')
    expect(text?.kind === 'text' && text.text.shadow.enabled).toBe(true)
  })
})
