// Formatted slides as the screens draw them: ThemedSlide draws exactly the stored spans (and nothing stale), and the
// formatting reaches the output, the stage display, the Stream output and the ticker while the text stays plain.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { plainText } from '../shared/richText'
import { DEFAULT_THEME_STYLE } from '../shared/themes'
import type { RichText, ServiceItem, Song } from '../shared/types'

vi.stubGlobal('window', { api: { media: { getSlideBackgrounds: async () => ({}) } } })

// Rendering to a string runs no layout effects (the fit), which React notes once per render; nothing else is hidden.
const consoleError = console.error
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) consoleError(...args)
})

const { ThemedSlide } = await import('./components/ThemedSlide')
const { selectAlertDisplay, selectOutputState, selectStageState, selectStreamState, useOperatorStore } = await import('./store')

const st = () => useOperatorStore.getState()

const RICH: RichText = {
  paragraphs: [
    { align: 'right', verticalAlign: 'top', spans: [{ text: 'Amazing ' }, { text: 'grace', bold: true, color: '#ffd400', size: 1.5 }] },
    { lineHeight: 1.5, spans: [{ text: 'How ', italic: true }, { text: 'sweet', underline: true, strike: true, highlight: '#003366' }, { text: ' the sound', textCase: 'upper', font: 'Inter' }] },
  ],
}
const TEXT = plainText(RICH)

const render = (text: string, rich: RichText | null) => renderToStaticMarkup(createElement(ThemedSlide, { theme: DEFAULT_THEME_STYLE, text, rich }))

/** The innermost styled spans of the markup, in order: what each run of words draws as. */
function drawnSpans(markup: string): { text: string; style: string }[] {
  return [...markup.matchAll(/<span(?: style="([^"]*)")?>([^<]*)<\/span>/g)].map(([, style = '', text]) => ({ style, text }))
}

describe('ThemedSlide with formatting', () => {
  it('draws each stored span with its marks, in order', () => {
    const spans = drawnSpans(render(TEXT, RICH))
    expect(spans.map((s) => s.text)).toEqual(RICH.paragraphs.flatMap((p) => p.spans.map((span) => span.text)))
    const [, grace, how, sweet, sound] = spans
    expect(grace.style).toContain('font-weight:700')
    expect(grace.style).toContain('color:#ffd400')
    // Sizes are relative to the box, so auto fit scales them with the rest of the words.
    expect(grace.style).toContain('font-size:1.5em')
    expect(how.style).toContain('font-style:italic')
    expect(sweet.style).toContain('text-decoration-line:underline line-through')
    expect(sweet.style).toContain('background-color:#003366')
    expect(sound.style).toContain('text-transform:uppercase')
    expect(sound.style).toContain('font-family:')
  })

  it('draws paragraph alignment, line spacing and the slide’s vertical alignment over the theme’s', () => {
    const markup = render(TEXT, RICH)
    expect(markup).toContain('class="themed-line text" style="text-align:right"')
    expect(markup).toContain('class="themed-line text" style="line-height:1.5"')
    expect(markup).toContain('justify-content:flex-start')
    // Aligned paragraphs line up across the whole box.
    expect(markup).toContain('class="themed-text fixed"')
  })

  it('ignores formatting whose words no longer match the slide, drawing the plain text', () => {
    const markup = render('Different words', RICH)
    expect(markup).not.toContain('grace')
    expect(markup).toContain('Different words')
    expect(drawnSpans(markup).filter((s) => s.style)).toEqual([])
  })

  it('keeps translation and reference lines working inside formatted text', () => {
    const rich: RichText = { paragraphs: [{ spans: [{ text: 'Grace', bold: true }] }, { spans: [{ text: '[' }, { text: 'Gracia', italic: true }, { text: ']' }] }] }
    const markup = render('Grace\n[Gracia]', rich)
    expect(markup).toContain('class="themed-line translation"')
    expect(drawnSpans(markup).map((s) => s.text)).toEqual(['Grace', 'Gracia'])
  })
})

describe('formatting on the screens', () => {
  it('goes live with a formatted song slide; the text stays plain', async () => {
    const song: Song = {
      id: 7,
      title: 'Amazing Grace',
      author: null,
      copyright: null,
      tags: [],
      arrangement: { order: [], linesPerSlide: null },
      themeId: null,
      lyrics: `${TEXT}\n\nI once was lost`,
      formatting: { [TEXT]: RICH },
    }
    useOperatorStore.setState({ selectedSong: song, deckType: 'song', deckKey: 'song:7' })
    await st().songSaved(song)
    expect(st().slides.map((s) => s.text)).toEqual([TEXT, 'I once was lost'])
    expect(st().slides[0].rich).toEqual(RICH)
    expect(st().slides[1].rich).toBeUndefined()

    st().goLive(0)
    expect(selectOutputState(st())).toMatchObject({ text: TEXT, rich: RICH })
    expect(selectStreamState(st())).toMatchObject({ text: TEXT, rich: RICH })
    expect(selectStageState(st()).current).toEqual({ text: TEXT, caption: 'Amazing Grace', rich: RICH })
    expect(selectStageState(st()).next).toEqual({ text: 'I once was lost', caption: '', rich: null })
  })

  it('loads an announcement item with its slides’ formatting', async () => {
    const coffee: RichText = { paragraphs: [{ spans: [{ text: 'Coffee', bold: true }, { text: ' after church' }] }] }
    const item: ServiceItem = {
      id: 3,
      service_id: 1,
      order: 0,
      title: 'Welcome',
      type: 'announcement',
      ref_id: null,
      payload: { title: 'Welcome', body: 'Coffee after church\n\nKids club', formats: { 'Coffee after church': coffee } },
    }
    await st().loadItem(item)
    expect(st().slides).toEqual([
      { text: 'Coffee after church', caption: 'Welcome', rich: coffee },
      { text: 'Kids club', caption: 'Welcome' },
    ])
  })

  it('scrolls an alert in its formatting', () => {
    const rich: RichText = { paragraphs: [{ spans: [{ text: 'Parents', bold: true }, { text: ' to the nursery' }] }] }
    st().startAlerts([{ id: 'a', text: ' Parents to the nursery ', priority: false, rich: { paragraphs: [{ spans: [{ text: ' ' }, ...rich.paragraphs[0].spans, { text: ' ' }] }] } }])
    expect(selectAlertDisplay(st())).toMatchObject({ texts: ['Parents to the nursery'], riches: [rich] })
    st().stopAlerts()
  })
})
