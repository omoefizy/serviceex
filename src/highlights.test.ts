// Live word highlighting: a marked word changes only its own span, the marks reach the output, Esc and a slide change
// clear them, preview marks go live with the slide, and the colors stay legible and survive a luma key.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  contrastRatio,
  HIGHLIGHT_COLORS,
  highlightText,
  LUMA_KEY_FLOOR,
  luminance,
  markSlide,
  MIN_CONTRAST,
  sentenceAt,
  stylePatch,
  unmarkSlide,
  wordAt,
  wordsBetween,
  type MarkableSlide,
} from '../shared/highlights'
import { fromPlain } from '../shared/richText'
import type { HighlightStyle, RichText } from '../shared/types'

vi.stubGlobal('window', { api: { media: { getSlideBackgrounds: async () => ({}) } } })

const { selectOutputState, selectStageState, useOperatorStore } = await import('./store')
const { highlightKey } = await import('./lib/highlights')

const st = () => useOperatorStore.getState()
const YELLOW: HighlightStyle = { kind: 'highlight', color: 'yellow' }
const yellow = stylePatch(YELLOW)
const word = (p: number, start: number, end: number) => ({ start: { p, o: start }, end: { p, o: end } })
const key = (k: string, code = '') => ({ key: k, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })

const VERSE = 'For God so loved the world'
const liveRich = () => selectOutputState(st()).rich

beforeEach(() => {
  useOperatorStore.setState((s) => ({
    settings: { ...s.settings, highlightClearOnSlideChange: true, highlightKeepWithItem: false },
    highlightMode: false,
    highlightStyle: YELLOW,
    liveHistory: [],
    live: { ...s.live, mode: 'show' },
  }))
  st().selectScripture('John 3:16-17 KJV', [
    { text: VERSE, caption: 'John 3:16 KJV' },
    { text: 'that he gave his only begotten Son', caption: 'John 3:17 KJV' },
  ])
  st().goLive(0)
})

describe('marking words', () => {
  it('highlighting a word changes only that span', () => {
    const bold: RichText = { paragraphs: [{ spans: [{ text: 'For God', bold: true }, { text: ' so loved the world' }] }] }
    const marked = markSlide<MarkableSlide>({ text: VERSE, rich: bold }, word(0, 11, 16), YELLOW)
    expect(marked.rich?.paragraphs[0].spans).toEqual([
      { text: 'For God', bold: true },
      { text: ' so ' },
      { text: 'loved', ...yellow },
      { text: ' the world' },
    ])
    expect(marked.unmarked).toEqual(bold)
    // The same click again takes it off, back to the slide's own formatting.
    const again = markSlide(marked, word(0, 11, 16), YELLOW)
    expect(again).toEqual({ text: VERSE, rich: bold })
    expect(unmarkSlide(marked)).toEqual({ text: VERSE, rich: bold })
  })

  it('takes off only the word clicked inside a marked phrase, keeping its own color', () => {
    const colored: RichText = { paragraphs: [{ spans: [{ text: 'For God so ' }, { text: 'loved', color: '#ff0000' }, { text: ' the world' }] }] }
    const phrase = markSlide({ text: VERSE, rich: colored }, word(0, 4, 20), YELLOW)
    const one = markSlide(phrase, word(0, 11, 16), YELLOW)
    expect(one.rich?.paragraphs[0].spans).toEqual([
      { text: 'For ' },
      { text: 'God so ', ...yellow },
      { text: 'loved', color: '#ff0000' },
      { text: ' the', ...yellow },
      { text: ' world' },
    ])
  })

  it('finds the word clicked, the words dragged across and the sentence double clicked', () => {
    const rich = fromPlain('He said, “Peace be still.” And\nthe wind ceased. Then calm')
    expect(wordAt(rich, { p: 0, o: 1 })).toEqual(word(0, 0, 2))
    expect(wordAt(rich, { p: 0, o: 2 })).toEqual(word(0, 0, 2))
    expect(wordAt(rich, { p: 0, o: 8 })).toBeNull()
    expect(wordsBetween(rich, { p: 0, o: 13 }, { p: 0, o: 4 })).toEqual(word(0, 3, 15))
    expect(sentenceAt(rich, { p: 0, o: 12 })).toEqual(word(0, 0, 26))
    expect(sentenceAt(rich, { p: 1, o: 2 })).toEqual({ start: { p: 0, o: 27 }, end: { p: 1, o: 16 } })
  })

  it('uses highlight colors that read on their highlight and do not key out', () => {
    for (const color of HIGHLIGHT_COLORS) {
      const text = highlightText(color.fill)
      expect(contrastRatio(color.fill, text), color.id).toBeGreaterThanOrEqual(MIN_CONTRAST)
      for (const hex of [color.fill, color.ink, text]) expect(luminance(hex), `${color.id} ${hex}`).toBeGreaterThanOrEqual(LUMA_KEY_FLOOR)
    }
  })
})

describe('live highlighting', () => {
  it('sends a marked word on the live slide to the output and the stage display', () => {
    st().markWords('live', word(0, 11, 16))
    const spans = liveRich()?.paragraphs[0].spans
    expect(spans?.find((span) => span.text === 'loved')).toMatchObject(yellow)
    expect(spans?.filter((span) => span.highlight)).toHaveLength(1)
    expect(selectStageState(st()).current?.rich).toEqual(liveRich())
    // Marking is not a slide change: Go Back has nothing to go back to.
    expect(st().liveHistory).toEqual([])
  })

  it('clears the live slide with Esc', () => {
    expect(highlightKey(key('Escape'))).toBe(false)
    st().markWords('live', word(0, 11, 16))
    expect(highlightKey(key('Escape'))).toBe(true)
    expect(liveRich()).toBeNull()
  })

  it('toggles highlight mode with Cmd+H or Ctrl+H, and picks colors with 1 to 5 only in highlight mode', () => {
    expect(highlightKey(key('2', 'Digit2'))).toBe(false)
    expect(highlightKey({ ...key('h'), ctrlKey: true })).toBe(true)
    expect(st().highlightMode).toBe(true)
    expect(highlightKey(key('3', 'Digit3'))).toBe(true)
    expect(st().highlightStyle).toEqual({ kind: 'highlight', color: 'blue' })
    highlightKey({ ...key('h'), metaKey: true })
    expect(st().highlightMode).toBe(false)
  })

  it('clears the marks when the slide changes, unless the setting is off', () => {
    st().markWords('live', word(0, 11, 16))
    st().nextSlide()
    st().previousSlide()
    expect(liveRich()).toBeNull()

    useOperatorStore.setState((s) => ({ settings: { ...s.settings, highlightClearOnSlideChange: false } }))
    st().markWords('live', word(0, 11, 16))
    st().nextSlide()
    st().previousSlide()
    expect(liveRich()?.paragraphs[0].spans.some((span) => span.highlight)).toBe(true)
  })

  it('keeps marks made in the preview and sends them live with the slide', () => {
    st().setHighlight(1)
    st().markWords('preview', word(0, 5, 7))
    expect(liveRich()).toBeNull()
    st().goLiveHighlighted()
    expect(liveRich()?.paragraphs[0].spans.find((span) => span.text === 'he')).toMatchObject(yellow)
  })

  it('replaces the word of the first click with the sentence on a double click', () => {
    st().markWords('live', word(0, 4, 7))
    st().markWords('live', word(0, 0, VERSE.length), true)
    expect(liveRich()?.paragraphs[0].spans).toEqual([{ text: VERSE, ...yellow }])
  })
})
