// Importing fonts, from the file picker through the main process to an output window: the files are copied into the
// app's fonts folder under their real family names, a file that is not a font is reported in plain words, every window
// is told, and the output window registers the font and draws a design's text with it.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EMPTY_DESIGN, textElement } from '../shared/designs'
import type { Design, ImportedFont, OutputState } from '../shared/types'

const userData = mkdtempSync(path.join(os.tmpdir(), 'serviceex-font-test-'))
const picked: string[] = []
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
/** What each window was sent, as webContents.send would deliver it. */
const sent: string[] = []

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [{ webContents: { send: (channel: string) => sent.push(channel) } }] },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: picked }) },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) },
}))

// The output window: its document's fonts, and the preload's API reaching the handlers above.
class FakeFontFace {
  status = 'unloaded'
  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: FontFaceDescriptors,
  ) {}
  async load() {
    this.status = 'loaded'
    return this
  }
}
const documentFonts = new Set<FakeFontFace>()
let fontsChanged: (() => void) | undefined
let outputListener: ((state: OutputState) => void) | undefined
vi.stubGlobal('FontFace', FakeFontFace)
vi.stubGlobal('document', {
  baseURI: 'http://localhost/',
  fonts: Object.assign(documentFonts, { check: () => true, load: async () => [], addEventListener() {}, removeEventListener() {} }),
  head: { appendChild() {} },
  documentElement: { style: {} },
  body: { style: {} },
  createElement: () => ({ dataset: {}, getContext: () => null }),
  addEventListener() {},
  removeEventListener() {},
})
vi.stubGlobal('window', {
  screen: { width: 1920, height: 1080 },
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
  api: {
    media: { getSlideBackgrounds: async () => ({}) },
    fonts: {
      list: () => handlers.get('fonts:list')!({}),
      import: () => handlers.get('fonts:import')!({ sender: {} }),
      onChanged: (fn: () => void) => ((fontsChanged = fn), () => undefined),
    },
    output: { onState: (fn: (state: OutputState) => void) => ((outputListener = fn), () => (outputListener = undefined)) },
  },
})
vi.stubGlobal('devicePixelRatio', 1)

const { registerFontIpc } = await import('../electron/ipc/fonts')
const fonts = await import('./lib/fonts')
const { selectOutputState, useOperatorStore } = await import('./store')
const { OutputView } = await import('./components/OutputView')
registerFontIpc()

const FIXTURES = path.join(__dirname, '..', 'node_modules')
const TTF = path.join(FIXTURES, 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Regular.ttf')
const TTF_BOLD = path.join(FIXTURES, 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Bold.ttf')
const WOFF = path.join(FIXTURES, '@fontsource', 'bricolage-grotesque', 'files', 'bricolage-grotesque-latin-800-normal.woff')
const BROKEN = path.join(userData, 'Broken Font.ttf')
writeFileSync(BROKEN, 'this is not really a font')

afterAll(() => vi.unstubAllGlobals())

const textOf = (node: ReactTestInstance): string => node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('')

describe('font import', () => {
  it('imports fonts, lists them by their real family, and an output window draws with them', async () => {
    fonts.installFonts()
    await vi.waitFor(() => expect(handlers.has('fonts:list')).toBe(true))

    picked.push(TTF, TTF_BOLD, WOFF, BROKEN)
    const result = await fonts.importFonts()
    expect(result.families.sort()).toEqual(['Bricolage Grotesque', 'Liberation Sans'])
    expect(result.skipped).toEqual([{ file: 'Broken Font.ttf', reason: 'is not a TrueType, OpenType, WOFF or WOFF2 font' }])
    expect(fonts.importNote(result)).toContain('Broken Font.ttf is not a TrueType')

    // Copied into the app's own fonts folder, and every window told.
    expect((await readdir(path.join(userData, 'fonts'))).sort()).toEqual(['LiberationSans-Bold.ttf', 'LiberationSans-Regular.ttf', 'bricolage-grotesque-latin-800-normal.woff'])
    expect(sent).toContain('fonts:changed')
    const listed = (await handlers.get('fonts:list')!({})) as ImportedFont[]
    expect(listed.map((f) => [f.family, f.weight])).toEqual([
      ['Bricolage Grotesque', '800'],
      ['Liberation Sans', '700'],
      ['Liberation Sans', '400'],
    ])
    expect(fonts.importedFamilies()).toEqual(['Bricolage Grotesque', 'Liberation Sans'])
    expect(fonts.isFamilyAvailable('Liberation Sans')).toBe(true)

    // The output window, told fonts changed, registers each face from the fonts folder.
    fontsChanged?.()
    await vi.waitFor(() => expect([...documentFonts].map((f) => f.family)).toContain('Liberation Sans'))
    const regular = [...documentFonts].find((f) => f.family === 'Liberation Sans' && f.descriptors.weight === '400')
    expect(regular?.source).toBe('url("wd-media://font/LiberationSans-Regular.ttf")')

    // A lower third whose text uses the imported family, on the output.
    const design: Design = {
      id: 77,
      name: 'Imported font strap',
      type: 'custom',
      style: { ...EMPTY_DESIGN.lowerThird, elements: [textElement('name', 'Name', { x: 5, y: 80, width: 50, height: 8 }, { text: 'Name', field: 'headline', fontFamily: 'Liberation Sans' })] },
    }
    useOperatorStore.setState((s) => ({ designs: [design], live: { ...s.live, mode: 'show' } }))
    useOperatorStore.getState().showLowerThirdLine({ headline: 'Pastor Ada', body: '', designId: 77 })
    let output!: ReactTestRenderer
    act(() => {
      output = create(createElement(OutputView))
    })
    act(() => outputListener?.(selectOutputState(useOperatorStore.getState())))
    const words = output.root.findAll((n) => n.type === 'p' && textOf(n) === 'Pastor Ada')[0]
    expect(words.props.style.fontFamily).toMatch(/^"Liberation Sans", /)
    act(() => output.unmount())
  })

  it('removes an imported family, every file of it', async () => {
    window.api.fonts.remove = (files: string[]) => handlers.get('fonts:remove')!({}, files) as Promise<void>
    await fonts.removeImportedFamily('Liberation Sans')
    expect(await readdir(path.join(userData, 'fonts'))).toEqual(['bricolage-grotesque-latin-800-normal.woff'])
    expect(fonts.importedFamilies()).toEqual(['Bricolage Grotesque'])
  })
})
