// Sermon exports: the header block, what each checkbox includes, paragraphs, the PDF page without a logo, slide texts
// and file names. Names and text are invented.
import { describe, expect, it } from 'vitest'
import {
  exportFileName,
  limitWords,
  rawParagraphs,
  sermonFooter,
  sermonHtml,
  deckSlideTexts,
  fitFontSize,
  sermonContentCount,
  sermonDeck,
  sermonText,
  transcriptChunks,
  UNTITLED_SERMON,
} from './sermons'
import type { Sermon } from './types'

const ALL = { summary: true, scriptures: true, transcript: true, cleaned: true }

function sermon(patch: Partial<Sermon> = {}): Sermon {
  return {
    id: 1,
    title: 'Salt and Light',
    preacher: 'Juno Halvorsen',
    date: '2026-10-18',
    series: 'Ordinary Days',
    status: 'saved',
    createdAt: '2026-10-18T09:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    churchName: 'Cedar Hill Gathering',
    notes: '',
    summary: 'A short talk about small acts that change a room.',
    keyPoints: ['Small things carry flavour.', 'Light is meant to be seen.'],
    cleanedTranscript: '',
    segments: [
      { id: 1, startMs: 0, text: 'Good morning everyone.', isFinal: true },
      { id: 2, startMs: 2000, text: 'Let us think about salt.', isFinal: true },
      { id: 3, startMs: 20_000, text: 'Now about lamps.', isFinal: true },
    ],
    scriptures: [
      { id: 1, reference: 'Matthew 5:13', atMs: 1000, source: 'detected' },
      { id: 2, reference: 'Matthew 5:14-16', atMs: 21_000, source: 'detected' },
    ],
    statements: [
      { id: 1, text: 'A pinch is enough to change the whole pot.', atMs: 3000, pinned: true },
      { id: 2, text: 'Not every line is a slide.', atMs: 5000, pinned: false },
    ],
    ...patch,
  }
}

describe('text export', () => {
  it('starts with a header block of the fields that have values', () => {
    const text = sermonText(sermon(), 'txt', ALL)
    expect(text.startsWith('Salt and Light\n')).toBe(true)
    expect(text).toContain('Preacher: Juno Halvorsen')
    expect(text).toContain('Series: Ordinary Days')
    expect(text).toContain('Church: Cedar Hill Gathering')
    expect(text).toMatch(/Date: .*2026/)
  })

  it('leaves out empty fields rather than inventing them', () => {
    const text = sermonText(sermon({ title: '', preacher: '', series: '', churchName: '' }), 'md', ALL)
    expect(text.startsWith(`# ${UNTITLED_SERMON}\n`)).toBe(true)
    expect(text).not.toMatch(/Preacher|Series|Church/)
  })

  it('includes only the parts ticked', () => {
    const none = sermonText(sermon(), 'md', { summary: false, scriptures: false, transcript: false, cleaned: false })
    expect(none).not.toContain('Summary')
    expect(none).not.toContain('Matthew 5:13')
    expect(none).not.toContain('Let us think about salt.')
    const all = sermonText(sermon(), 'md', ALL)
    expect(all).toContain('## Key points\n\n1. Small things carry flavour.\n2. Light is meant to be seen.')
    expect(all).toContain('- Matthew 5:13\n- Matthew 5:14-16')
    expect(all).toContain('## Transcript\n\nGood morning everyone. Let us think about salt.\n\nNow about lamps.')
  })

  it('uses the cleaned transcript when asked and there is one', () => {
    const cleaned = sermon({ cleanedTranscript: 'Good morning, everyone.\n\nLet us think about salt.' })
    expect(sermonText(cleaned, 'txt', ALL)).toContain('Good morning, everyone.\n\nLet us think about salt.')
    expect(sermonText(cleaned, 'txt', { ...ALL, cleaned: false })).toContain('Good morning everyone. Let us think about salt.')
  })
})

describe('raw paragraphs', () => {
  it('breaks at pauses and keeps paragraphs readable', () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ startMs: i * 1000, text: 'one two three four five six seven eight', isFinal: true }))
    const paragraphs = rawParagraphs(long)
    expect(paragraphs.length).toBeGreaterThan(2)
    expect(paragraphs.every((p) => p.split(' ').length <= 120)).toBe(true)
  })

  it('skips interim lines', () => {
    expect(rawParagraphs([{ startMs: 0, text: 'not yet', isFinal: false }, { startMs: 1, text: 'done', isFinal: true }])).toEqual(['done'])
  })
})

describe('PDF page', () => {
  it('works without a logo or a church name', () => {
    const html = sermonHtml(sermon({ churchName: '' }), ALL, { logoUrl: null, fontUrl: null })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('class="church"')
    expect(html).toContain('<h1>Salt and Light</h1>')
  })

  it('puts the logo and church name at the top, then scripture, summary and transcript in order', () => {
    const html = sermonHtml(sermon(), ALL, { logoUrl: 'data:image/png;base64,AAAA', fontUrl: 'data:font/woff2;base64,AAAA' })
    const order = ['class="logo"', 'Cedar Hill Gathering', '<h1>', 'Scripture references', 'Summary', 'Key points', 'Transcript'].map((s) => html.indexOf(s))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain("font-family: 'Sermon Sans'")
  })

  it('escapes what was said', () => {
    const html = sermonHtml(sermon({ title: '<script>x</script>', segments: [{ id: 1, startMs: 0, text: 'a < b & "c"', isFinal: true }] }), ALL, {
      logoUrl: null,
      fontUrl: null,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('a &lt; b &amp; &quot;c&quot;')
  })

  it('prints the footer line and page numbers', () => {
    const footer = sermonFooter('12 Example Road · example.org')
    expect(footer).toContain('12 Example Road · example.org')
    expect(footer).toContain('class="pageNumber"')
    expect(footer).toContain('class="totalPages"')
  })
})

describe('slides', () => {
  const passages = [
    { reference: 'Matthew 5:13 KJV', text: 'Short verse words.' },
    { reference: 'Matthew 5:14-16', text: null },
  ]

  it('makes a title slide, then scripture, pinned statements, key points and a closing slide', () => {
    const deck = sermonDeck(sermon(), passages)
    expect(deck.map((slide) => slide.kind)).toEqual(['title', 'scripture', 'scripture', 'statement', 'point', 'point', 'closing'])
    expect(deck[0]).toMatchObject({ title: 'Salt and Light', lines: ['Juno Halvorsen', expect.stringMatching(/2026/), 'Cedar Hill Gathering'] })
    expect(deckSlideTexts(deck)).toEqual([
      'Short verse words.\n{Matthew 5:13 KJV}',
      'Matthew 5:14-16',
      '“A pinch is enough to change the whole pot.”',
      'Small things carry flavour.',
      'Light is meant to be seen.',
      'Thank you for joining us\n{Cedar Hill Gathering}',
    ])
  })

  it('shows a long passage as its reference alone', () => {
    const deck = sermonDeck(sermon({ keyPoints: [], statements: [] }), [{ reference: 'Psalm 1', text: 'word '.repeat(80) }])
    expect(deck[1]).toEqual({ kind: 'scripture', reference: 'Psalm 1', text: null })
  })

  it('counts only the slides with something from the sermon on them', () => {
    expect(sermonContentCount(sermon())).toBe(5)
    expect(sermonContentCount(sermon({ keyPoints: [], scriptures: [], statements: [{ id: 1, text: 'Not pinned.', atMs: 0, pinned: false }] }))).toBe(0)
  })

  it('picks a font size that fits the box', () => {
    expect(fitFontSize('Short.', 8.8, 4.4, 40, 12)).toBe(40)
    const long = 'many words here '.repeat(60)
    const size = fitFontSize(long, 8.8, 4.4, 40, 12)
    expect(size).toBeLessThan(40)
    expect(size).toBeGreaterThanOrEqual(12)
  })
})

describe('helpers', () => {
  it('names files by date and title without unsafe characters', () => {
    expect(exportFileName(sermon({ title: 'What/Now? "Yes"' }), 'pdf')).toBe('2026-10-18 What Now Yes.pdf')
    expect(exportFileName(sermon({ title: '' }), 'md')).toBe(`2026-10-18 ${UNTITLED_SERMON}.md`)
  })

  it('cuts a summary to the word limit at a sentence end', () => {
    const text = `${'word '.repeat(70).trim()}. ${'more '.repeat(70).trim()}.`
    const cut = limitWords(text, 120)
    expect(cut.split(/\s+/).length).toBeLessThanOrEqual(120)
    expect(cut.endsWith('word.')).toBe(true)
  })

  it('splits a long transcript into pieces at sentence ends, losing nothing', () => {
    const text = Array.from({ length: 300 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const chunks = transcriptChunks(text, 200)
    expect(chunks.length).toBe(8)
    expect(chunks.every((c) => c.split(' ').length <= 200 && c.endsWith('.'))).toBe(true)
    expect(chunks.join(' ')).toBe(text)
  })

  it('cuts a run-on transcript without full stops between words, never past the limit', () => {
    const text = Array.from({ length: 450 }, (_, i) => `w${i}`).join(' ')
    const chunks = transcriptChunks(text, 200)
    expect(chunks.map((c) => c.split(' ').length)).toEqual([200, 200, 50])
    expect(chunks.join(' ')).toBe(text)
  })
})
