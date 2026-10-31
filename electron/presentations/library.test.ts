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
import { PresentationLibrary, plainImportError, type Converter, type PresentationRecord, type PresentationStore } from './library'
import type { PresentationProgress } from '../../shared/types'
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
    root = await makeTempDir('serviceex-library-')
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

  describe('streaming imports', () => {
    /** A converter that writes three slides, a thumbnail of each first, then the full pictures when let go. */
    function streamingLibrary() {
      const progress: PresentationProgress[] = []
      let release = () => {}
      const released = new Promise<void>((resolve) => (release = resolve))
      const wanted: number[] = []
      const streaming: Converter = async (_source, outDir, report, job) => {
        job?.setWant?.((index) => wanted.push(index))
        const files = [0, 1, 2].map((i) => ({ file: `slide-00${i + 1}.png`, thumb: `thumb-00${i + 1}.jpg`, text: `Slide ${i + 1}` }))
        for (const [i, page] of files.entries()) {
          await writeFile(path.join(outDir, page.thumb), 'jpg')
          job?.onSlide?.(i, 3, page)
        }
        await Promise.race([
          released,
          new Promise((_, reject) => job?.signal?.addEventListener('abort', () => reject(new Error('stopped')))),
        ])
        for (const [i, page] of files.entries()) {
          await writeFile(path.join(outDir, page.file), 'png')
          job?.onFull?.(i)
          report(`Importing ${i + 1} of 3…`, i + 1, 3)
        }
        return { engine: 'test', slides: files.map((f) => ({ ...f, title: '', notes: '', animated: false })) }
      }
      const lib = new PresentationLibrary({
        cacheDir: path.join(root, 'stream-cache'),
        store: memoryStore(),
        convert: streaming,
        onProgress: (p) => progress.push(p),
        fileUrl: (hash, file) => `wd-media://deck/${hash}/${file}`,
      })
      return { lib, progress, release, wanted }
    }

    it('shows slides before the import finishes and draws a wanted slide next', async () => {
      const { lib, progress, release, wanted } = streamingLibrary()
      const file = path.join(root, 'Psalms.pdf')
      await writeFile(file, 'pdf')
      const importing = lib.import([file])
      await until(() => progress.some((p) => p.slides?.length === 3))
      const shown = progress.find((p) => p.slides?.length === 3) as PresentationProgress
      expect(shown.cancellable).toBe(true)
      expect(shown.slides?.[0].thumb).toMatch(/^wd-media:\/\/deck\/[0-9a-f]{64}\/thumb-001\.jpg$/)
      const hash = /deck\/([0-9a-f]{64})\//.exec(shown.slides?.[2].image ?? '')?.[1] as string

      // The thumbnail is on disk; the full picture is asked for and waited on.
      expect(lib.whenWritten(hash, 'thumb-003.jpg')).toBeNull()
      const full = lib.whenWritten(hash, 'slide-003.png')
      expect(full).not.toBeNull()
      expect(wanted).toEqual([2])
      release()
      await full
      expect(existsSync(path.join(lib.cacheFolder(hash), 'slide-003.png'))).toBe(true)

      const [record] = await importing
      expect(record.slides.map((s) => s.thumb)).toEqual(['thumb-001.jpg', 'thumb-002.jpg', 'thumb-003.jpg'])
      const messages = progress.map((p) => p.message)
      expect(messages).toEqual(expect.arrayContaining(['Importing 1 of 3…', 'Importing 2 of 3…', 'Finishing full size 0 of 3…', 'Finishing full size 3 of 3…']))
      expect(progress.at(-1)).toMatchObject({ finished: true, message: '3 slides ready' })
      expect(progress.at(-1)?.slides).toBeUndefined()
    })

    it('cancels an import, leaving nothing behind and importing the rest', async () => {
      const { lib, progress, release } = streamingLibrary()
      const first = path.join(root, 'Hymns.pdf')
      const second = path.join(root, 'Notices.pdf')
      await writeFile(first, 'first')
      await writeFile(second, 'second')
      const importing = lib.import([first, second])
      await until(() => progress.some((p) => p.key === first && p.slides?.length === 3))
      const hash = /deck\/([0-9a-f]{64})\//.exec(progress.find((p) => p.slides?.length)?.slides?.[0].image ?? '')?.[1] as string
      expect(lib.cancel(first)).toBe(true)
      await until(() => progress.some((p) => p.key === second && p.slides?.length === 3))
      release()
      const records = await importing
      expect(records.map((r) => r.title)).toEqual(['Notices'])
      expect(progress.find((p) => p.key === first && p.finished)).toMatchObject({ cancelled: true, message: 'Import cancelled' })
      expect(progress.find((p) => p.key === first && p.finished)?.error).toBeUndefined()
      expect(existsSync(lib.cacheFolder(hash))).toBe(false)
      expect(lib.cancel(first)).toBe(false)
    })

    it('imports the same file from another place from the cache, at once', async () => {
      const { lib, progress, release } = streamingLibrary()
      release()
      const file = path.join(root, 'Advent.pdf')
      const copy = path.join(root, 'Advent copy.pdf')
      await writeFile(file, 'advent')
      await writeFile(copy, 'advent')
      const [first] = await lib.import([file])
      const count = progress.length
      const [again] = await lib.import([copy])
      expect(again.hash).toBe(first.hash)
      expect(again.id).not.toBe(first.id)
      // No conversion: no progress at all.
      expect(progress).toHaveLength(count)
    })
  })

  it('says what went wrong in plain words', () => {
    const missing = Object.assign(new Error('ENOENT: no such file or directory, open /x/Easter.pptx'), { code: 'ENOENT' })
    expect(plainImportError(missing, 'Easter')).toBe('Easter could not be found. It may have been moved or deleted.')
    expect(plainImportError(new Error('Invalid PDF structure.'), 'Easter')).toBe('Easter is damaged or is not a PDF ServiceEx can read.')
    expect(plainImportError(new Error('The slide renderer stopped'), 'Easter')).toBe('Drawing the slides stopped unexpectedly. Try importing again.')
    expect(plainImportError(new Error('PowerPoint took longer than 5 minutes to export the slides.'), 'Easter')).toBe(
      'PowerPoint took longer than 5 minutes to export the slides.',
    )
  })
})
