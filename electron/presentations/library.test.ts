// Imports a small generated .pptx, saves it again with another slide, and checks that the watcher re-renders it
// and the slide count follows. The engines need PowerPoint or LibreOffice, so a stand-in converter draws the
// pictures; it counts slides with the real .pptx reader.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ThemeElement } from '../../shared/types'
import { makeTempDir, removeTemp } from '../tempDir.test-helper'
import { PresentationLibrary, type Converter, type PresentationRecord, type PresentationStore } from './library'
import { readNativeSlides, resolveNativeMedia } from './native'
import { readPptx } from './pptx'

/** A deck with one slide per title, with invented text and notes. */
async function makeDeck(titles: string[]): Promise<Buffer> {
  const deck = new PptxGenJS()
  deck.layout = 'LAYOUT_16x9'
  for (const title of titles) {
    const slide = deck.addSlide()
    slide.addText(title, { x: 1, y: 1, w: 8, h: 1, fontSize: 36 })
    slide.addNotes(`Remember to smile during ${title}`)
  }
  return (await deck.write({ outputType: 'nodebuffer' })) as Buffer
}

function memoryStore(): PresentationStore {
  const rows = new Map<number, PresentationRecord>()
  let nextId = 1
  return {
    list: () => [...rows.values()].reverse(),
    get: (id) => rows.get(id),
    insert(record) {
      const row = { ...record, id: nextId++, updatedAt: new Date().toISOString() }
      rows.set(row.id, row)
      return row
    },
    update(id, patch) {
      const row = { ...(rows.get(id) as PresentationRecord), ...patch, updatedAt: new Date().toISOString() }
      rows.set(id, row)
      return row
    },
    delete: (id) => rows.delete(id),
  }
}

/** Waits for `check` to hold, polling, or fails after `timeoutMs`. */
async function until(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('PresentationLibrary', () => {
  let root: string
  let library: PresentationLibrary
  let conversions: number
  let updates: PresentationRecord[]

  /** Draws a placeholder picture per visible slide, with the text and notes from the .pptx. */
  const convert: Converter = async (source, outDir) => {
    conversions++
    const slides = readPptx(new Uint8Array(await readFile(source.files[0]))).filter((slide) => !slide.hidden)
    return {
      engine: 'test',
      slides: await Promise.all(
        slides.map(async (slide, index) => {
          const file = `slide-${String(index + 1).padStart(3, '0')}.png`
          await writeFile(path.join(outDir, file), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
          return { file, title: slide.title, text: slide.text, notes: slide.notes, animated: slide.animated }
        }),
      ),
    }
  }

  beforeEach(async () => {
    root = await makeTempDir('worshipdeck-library-')
    conversions = 0
    updates = []
    library = new PresentationLibrary({
      cacheDir: path.join(root, 'cache'),
      store: memoryStore(),
      convert,
      // Native slides from the real reader; these decks have no pictures or clips to store.
      buildNative: async (source) =>
        resolveNativeMedia(await readNativeSlides(new Uint8Array(await readFile(source.sourcePath)), source.sourcePath), {
          store: { image: async () => 'wd-media://deck/test/native/x.png', findVideo: () => null, addVideo: async () => 'wd-media://local/x.mp4' },
          ffmpeg: null,
          workDir: path.join(root, 'native-work'),
          title: source.title,
        }),
      onUpdated: (record) => updates.push(record),
      debounceMs: 300,
    })
  })

  afterEach(async () => {
    await library.close()
    await removeTemp(root)
  })

  it('re-renders a linked file when it is saved again and follows the new slide count', async () => {
    const folder = path.join(root, 'Sunday')
    await mkdir(folder)
    const file = path.join(folder, 'Welcome.pptx')
    await writeFile(file, await makeDeck(['Welcome to Maple Hall', 'Lantern night is Friday']))

    const [imported] = await library.import([file])
    expect(imported.title).toBe('Welcome')
    expect(imported.slides).toHaveLength(2)
    expect(imported.slides[0].text).toBe('Welcome to Maple Hall')
    expect(imported.slides[1].notes).toBe('Remember to smile during Lantern night is Friday')
    expect(conversions).toBe(1)
    const firstCache = library.cacheFolder(imported.hash)
    expect(await readdir(firstCache)).toEqual(expect.arrayContaining(['slide-001.png', 'slide-002.png', 'manifest.json']))

    library.start()
    // Let the folder watch settle before touching anything.
    await sleep(500)

    // PowerPoint's lock file next to the original is not a save.
    await writeFile(path.join(folder, '~$Welcome.pptx'), 'lock')
    await sleep(800)
    expect(conversions).toBe(1)
    expect(updates).toHaveLength(0)

    // An atomic save, as PowerPoint does it: a temporary file renamed over the original.
    const temporary = path.join(folder, 'Welcome.tmp')
    await writeFile(temporary, await makeDeck(['Welcome to Maple Hall', 'Lantern night is Friday', 'Soup supper after']))
    await rename(temporary, file)

    await until(() => updates.length === 1)
    const [updated] = updates
    expect(updated.id).toBe(imported.id)
    expect(updated.slides).toHaveLength(3)
    expect(updated.slides[2].text).toBe('Soup supper after')
    expect(updated.hash).not.toBe(imported.hash)
    expect(conversions).toBe(2)
    expect(library.list()[0].slides).toHaveLength(3)
    // The old pictures go once nothing uses them, just after listeners have heard of the new ones.
    await until(() => !existsSync(firstCache))
    expect(existsSync(library.cacheFolder(updated.hash))).toBe(true)

    // Saving the same bytes again changes nothing.
    await writeFile(file, await readFile(file))
    await sleep(1200)
    expect(conversions).toBe(2)
    expect(updates).toHaveLength(1)
  }, 20_000)

  it('rebuilds native slides on save, replacing edits but keeping slides set to their picture, until detached', async () => {
    const file = path.join(root, 'Notices.pptx')
    await writeFile(file, await makeDeck(['Choir practice moved to Thursday', 'Bring a friend']))
    const words = (record: PresentationRecord, index: number) =>
      (record.native?.[index]?.style?.elements ?? [])
        .flatMap((e: ThemeElement) => (e.kind === 'text' ? (e.paragraphs ?? []) : []))
        .map((p) => p.runs.map((r) => r.text).join(''))

    const [imported] = await library.import([file], 'native')
    expect(imported.mode).toBe('native')
    expect(words(imported, 0)).toEqual(['Choir practice moved to Thursday'])

    const style = imported.native![0].style!
    const edited = {
      ...style,
      elements: style.elements.map((e) => (e.kind === 'text' ? { ...e, paragraphs: [{ runs: [{ text: 'Edited here' }] }] } : e)),
    }
    expect(words(library.updateNativeSlide(imported.id, 0, edited), 0)).toEqual(['Edited here'])
    expect(library.setSlideUseImage(imported.id, 1, true).native?.[1].useImage).toBe(true)

    library.start()
    await sleep(500)
    await writeFile(file, await makeDeck(['Choir practice moved to Friday', 'Bring a friend', 'Tea at four']))
    await until(() => updates.length === 1)
    const [refreshed] = updates
    expect(refreshed.native).toHaveLength(3)
    expect(words(refreshed, 0)).toEqual(['Choir practice moved to Friday'])
    expect(refreshed.native?.map((slide) => slide.useImage)).toEqual([false, true, false])

    // Detached, a save changes nothing, so edits stay.
    expect(library.detach(imported.id).linked).toBe(false)
    library.updateNativeSlide(imported.id, 0, edited)
    await writeFile(file, await makeDeck(['Choir practice cancelled']))
    await sleep(1200)
    expect(updates).toHaveLength(1)
    expect(words(library.list()[0], 0)).toEqual(['Edited here'])
    // Image mode keeps the native slides for switching back.
    const image = await library.setMode(imported.id, 'image')
    expect(image.mode).toBe('image')
    expect(image.native).toHaveLength(3)
  }, 20_000)

  it('imports the same original once', async () => {
    const file = path.join(root, 'Notices.pptx')
    await writeFile(file, await makeDeck(['Choir practice moved to Thursday']))
    const [first] = await library.import([file])
    const [again] = await library.import([file])
    expect(again.id).toBe(first.id)
    expect(library.list()).toHaveLength(1)
    expect(conversions).toBe(1)
  })
})
