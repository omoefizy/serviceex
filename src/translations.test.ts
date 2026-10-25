// Switching translations: the same verses in other words, on the preview or the live output, with a second
// translation on the slide, a note for verses a translation lacks, and highlights dropped with the old words.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_THEME_STYLE } from '../shared/themes'
import type { Verse } from '../shared/types'

/** John 3 in two versions; the WEB lacks verse 17 here, as a translation might lack or merge a verse. */
const BIBLE: Record<string, Verse[]> = {
  KJV: [16, 17].map((verse) => ({ book: 'John', chapter: 3, verse, text: `KJV ${verse}` })),
  WEB: [16, 18].map((verse) => ({ book: 'John', chapter: 3, verse, text: `WEB ${verse}` })),
  ASV: [16, 17, 18].map((verse) => ({ book: 'John', chapter: 3, verse, text: `ASV ${verse}` })),
}

vi.stubGlobal('window', {
  api: {
    media: { getSlideBackgrounds: async () => ({}) },
    settings: { set: async () => ({}) },
    bible: {
      getRange: async (version: string, book: string, chapter: number, from: number, to: number) =>
        (BIBLE[version] ?? []).filter((v) => v.book === book && v.chapter === chapter && v.verse >= from && v.verse <= to),
    },
  },
})

const { selectOutputState, selectDefaultTranslation, slideTheme, useOperatorStore } = await import('./store')
const { dualTheme, retitle } = await import('./lib/translations')
const { parseVerseCaption } = await import('./lib/slides')

const st = () => useOperatorStore.getState()
const versions = ['KJV', 'WEB', 'ASV'].map((code) => ({ code, name: code, verses: 0, bundled: false }))

beforeEach(() => {
  useOperatorStore.setState((s) => ({
    bibleVersions: versions,
    translationNote: null,
    liveHistory: [],
    settings: { ...s.settings, scriptureSwitchLiveImmediately: true, scriptureDual: { enabled: false, second: 'WEB', layout: 'stacked' } },
  }))
  st().selectScripture('John 3:16 KJV', [{ text: 'KJV 16', caption: 'John 3:16 KJV', rich: { paragraphs: [{ spans: [{ text: 'KJV 16', highlight: '#ffff00' }] }] } }])
})

describe('parseVerseCaption', () => {
  it('reads both versions of a slide showing two', () => {
    expect(parseVerseCaption('John 3:16 KJV · WEB')).toEqual({ book: 'John', chapter: 3, verse: 16, version: 'KJV', second: 'WEB' })
  })
})

describe('retitle', () => {
  it('replaces the version after each reference', () => {
    expect(retitle('John 3:16-18 KJV', 'WEB')).toBe('John 3:16-18 WEB')
    expect(retitle('John 3:16 KJV; Psalm 23:1 KJV · WEB', 'ASV')).toBe('John 3:16 ASV; Psalm 23:1 ASV')
    expect(retitle('John 3:16 KJV; Psalm 23:1 KJV and 2 more', 'WEB')).toBe('John 3:16 WEB; Psalm 23:1 WEB and 2 more')
  })
})

describe('switchTranslation', () => {
  it('changes the preview at once, clearing highlights with a note', async () => {
    await st().switchTranslation('preview', 'WEB')
    expect(st().slides[0]).toEqual({ text: 'WEB 16', caption: 'John 3:16 WEB' })
    expect(st().deckTitle).toBe('John 3:16 WEB')
    expect(st().translationNote).toMatchObject({ where: 'preview', error: false })
    expect(st().translationNote?.text).toMatch(/Highlights were cleared/)
  })

  it('sends the live verse in the new translation straight to the output, and Go Back returns the old one', async () => {
    st().goLive(0)
    await st().switchTranslation('live', 'ASV')
    expect(selectOutputState(st()).text).toBe('ASV 16')
    expect(st().live.title).toBe('John 3:16 ASV')
    expect(st().slides[0].text).toBe('ASV 16')
    st().goBack()
    expect(selectOutputState(st()).text).toBe('KJV 16')
  })

  it('stages the live change in the preview for a resend when Switch live immediately is off', async () => {
    useOperatorStore.setState((s) => ({ settings: { ...s.settings, scriptureSwitchLiveImmediately: false } }))
    st().goLive(0)
    await st().switchTranslation('live', 'ASV')
    expect(selectOutputState(st()).text).toBe('KJV 16')
    expect(st().live.stale).toBe(true)
    expect(st().slides[0].text).toBe('ASV 16')
    await st().resendLive()
    expect(selectOutputState(st()).text).toBe('ASV 16')
  })

  it('keeps the current translation and names a verse the other lacks', async () => {
    st().selectScripture('John 3:17 KJV', [{ text: 'KJV 17', caption: 'John 3:17 KJV' }])
    await st().switchTranslation('preview', 'WEB')
    expect(st().slides[0].text).toBe('KJV 17')
    expect(st().translationNote).toMatchObject({ error: true })
    expect(st().translationNote?.text).toMatch(/John 3:17 WEB/)
  })

  it('keeps the translation when stepping to the next verse', async () => {
    st().selectScripture('John 3:16 ASV', [{ text: 'ASV 16', caption: 'John 3:16 ASV' }])
    st().goLive(0)
    st().nextSlide()
    await vi.waitFor(() => expect(selectOutputState(st()).text).toBe('ASV 17'))
  })
})

describe('two translations', () => {
  it('puts the second translation on the slide, in the caption, and in a second text box', async () => {
    await st().setDualTranslation('preview', { enabled: true, second: 'ASV', layout: 'sideBySide' })
    const slide = st().slides[0]
    expect(slide).toMatchObject({ text: 'KJV 16', caption: 'John 3:16 KJV · ASV', second: { text: 'ASV 16', layout: 'sideBySide' } })
    expect(st().deckTitle).toBe('John 3:16 KJV · ASV')
    const boxes = slideTheme(DEFAULT_THEME_STYLE, slide).elements.filter((e) => e.kind === 'text')
    expect(boxes).toHaveLength(2)
    expect(boxes[1]).toMatchObject({ paragraphs: [{ runs: [{ text: 'ASV 16' }] }] })
    expect(boxes[0].box.y).toBe(boxes[1].box.y)
  })

  it('uses a theme’s own second text box', () => {
    const main = DEFAULT_THEME_STYLE.elements.find((e) => e.kind === 'text')
    if (!main) throw new Error('no text box')
    const theme = { ...DEFAULT_THEME_STYLE, elements: [...DEFAULT_THEME_STYLE.elements, { ...main, id: 'below' }] }
    const look = dualTheme(theme, { text: 'Second', layout: 'stacked' })
    expect(look.elements).toHaveLength(theme.elements.length)
    expect(look.elements.at(-1)).toMatchObject({ id: 'below', paragraphs: [{ runs: [{ text: 'Second' }] }] })
  })
})

describe('selectDefaultTranslation', () => {
  it('uses the service’s own translation over the default', () => {
    useOperatorStore.setState((s) => ({
      service: { id: 4, name: 'Sunday', date: null, items: [] },
      settings: { ...s.settings, scriptureDefaultVersion: 'WEB', scriptureServiceVersions: { 4: 'ASV' } },
    }))
    expect(selectDefaultTranslation(st())).toBe('ASV')
    useOperatorStore.setState({ service: null })
    expect(selectDefaultTranslation(st())).toBe('WEB')
  })
})
