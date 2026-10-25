import { describe, expect, it } from 'vitest'
import {
  applyMarks,
  applyParagraphStyle,
  applyStyleTo,
  clearFormatting,
  deleteRange,
  formatFor,
  fromPlain,
  hasFormatting,
  insertText,
  marksInRange,
  paragraphsFromRich,
  plainText,
  pruneFormats,
  renameFormat,
  richFromParagraphs,
  sanitizeRichText,
  sanitizeSlideFormats,
  setFormat,
  splitRichSlides,
  trimRich,
} from './richText'
import { DEFAULT_TEXT_PROPS } from './themes'
import type { RichText } from './types'

const at = (p: number, o: number) => ({ p, o })
const range = (sp: number, so: number, ep: number, eo: number) => ({ start: at(sp, so), end: at(ep, eo) })

/** "Amazing grace" with "grace" bold and the line centred, over "How sweet the sound". */
const SAMPLE: RichText = {
  paragraphs: [
    { align: 'center', spans: [{ text: 'Amazing ' }, { text: 'grace', bold: true, color: '#ffd400' }] },
    { spans: [{ text: 'How sweet the sound', italic: true }] },
  ],
}

describe('editing', () => {
  it('formats only the chosen words and keeps the plain text the same', () => {
    const rich = applyMarks(fromPlain('Amazing grace'), range(0, 8, 0, 13), { bold: true })
    expect(rich.paragraphs[0].spans).toEqual([{ text: 'Amazing ' }, { text: 'grace', bold: true }])
    expect(plainText(rich)).toBe('Amazing grace')
  })

  it('takes a mark off with null and merges the runs back together', () => {
    const rich = applyMarks(SAMPLE, range(0, 0, 0, 13), { bold: null, color: null })
    expect(rich.paragraphs[0].spans).toEqual([{ text: 'Amazing grace' }])
  })

  it('types in the look of the letter before the caret', () => {
    const { rich, caret } = insertText(SAMPLE, range(0, 13, 0, 13), '!')
    expect(rich.paragraphs[0].spans.at(-1)).toEqual({ text: 'grace!', bold: true, color: '#ffd400' })
    expect(caret).toEqual(at(0, 14))
  })

  it('splits a paragraph on a line break, both halves keeping its style', () => {
    const { rich, caret } = insertText(SAMPLE, range(0, 8, 0, 8), '\n')
    expect(plainText(rich)).toBe('Amazing \ngrace\nHow sweet the sound')
    expect(rich.paragraphs[1]).toEqual({ align: 'center', spans: [{ text: 'grace', bold: true, color: '#ffd400' }] })
    expect(caret).toEqual(at(1, 0))
  })

  it('deletes across paragraphs, joining them', () => {
    const { rich } = deleteRange(SAMPLE, range(0, 8, 1, 4))
    expect(plainText(rich)).toBe('Amazing sweet the sound')
    expect(rich.paragraphs).toHaveLength(1)
  })

  it('reports the marks a selection shares', () => {
    expect(marksInRange(SAMPLE, range(0, 8, 0, 13))).toEqual({ bold: true, color: '#ffd400' })
    expect(marksInRange(SAMPLE, range(0, 0, 0, 13))).toEqual({})
  })

  it('sets paragraph styles and clears all formatting', () => {
    const styled = applyParagraphStyle(SAMPLE, range(1, 0, 1, 0), { align: 'justify', lineHeight: 1.5 })
    expect(styled.paragraphs[1]).toMatchObject({ align: 'justify', lineHeight: 1.5 })
    const cleared = clearFormatting(styled, range(0, 0, 1, 19))
    expect(hasFormatting(cleared)).toBe(false)
    expect(plainText(cleared)).toBe(plainText(SAMPLE))
  })
})

describe('slides', () => {
  it('splits a formatted card on blank lines exactly as the plain text splits', () => {
    const card: RichText = {
      paragraphs: [{ spans: [{ text: '  Welcome', bold: true }] }, { spans: [] }, { spans: [{ text: '   ' }] }, { spans: [{ text: 'Coffee after ' }, { text: 'church', italic: true }] }],
    }
    const slides = splitRichSlides(card)
    expect(slides.map(plainText)).toEqual(['Welcome', 'Coffee after church'])
    expect(slides[0].paragraphs[0].spans).toEqual([{ text: 'Welcome', bold: true }])
  })

  it('keeps formatting only while its words match, and moves it with edited words', () => {
    let formats = setFormat({}, 'Amazing grace\nHow sweet the sound', SAMPLE)
    expect(formatFor(formats, 'Amazing grace\nHow sweet the sound')).toEqual(SAMPLE)
    expect(formatFor(formats, 'Amazing grace')).toBeUndefined()

    const edited = insertText(SAMPLE, range(1, 19, 1, 19), '!').rich
    formats = renameFormat(formats, plainText(SAMPLE), plainText(edited), edited, [plainText(edited)])
    expect(Object.keys(formats)).toEqual(['Amazing grace\nHow sweet the sound!'])
    expect(pruneFormats(formats, ['Something else'])).toEqual({})
  })

  it('applies one slide’s look to the others', () => {
    const formats = applyStyleTo({}, ['One', 'Two\nThree'], SAMPLE)
    expect(formats['Two\nThree']).toEqual({
      paragraphs: [
        { align: 'center', spans: [{ text: 'Two' }] },
        { align: 'center', spans: [{ text: 'Three' }] },
      ],
    })
  })

  it('stores a slide whose words read like an object key as an ordinary entry', () => {
    const formats = setFormat({}, '__proto__', applyMarks(fromPlain('__proto__'), range(0, 0, 0, 9), { bold: true }))
    expect(Object.getPrototypeOf(formats)).toBe(Object.prototype)
    expect(formatFor(formats, '__proto__')?.paragraphs[0].spans[0].bold).toBe(true)
    expect(formatFor({}, 'constructor')).toBeUndefined()
  })

  it('trims like String.trim', () => {
    expect(plainText(trimRich(fromPlain('  \n hello \n  ')))).toBe('hello')
  })
})

describe('sanitizing stored formatting', () => {
  it('drops unknown fields and unsafe values instead of storing them', () => {
    const rich = sanitizeRichText({
      paragraphs: [
        {
          align: 'middle',
          lineHeight: 99,
          onclick: 'alert(1)',
          spans: [{ text: 'Hi', bold: 'yes', color: 'red; background: url(x)', font: 'Inter; } body {', size: 50, html: '<b>x</b>', italic: true }],
        },
      ],
    })
    expect(rich).toEqual({ paragraphs: [{ lineHeight: 3, spans: [{ text: 'Hi', italic: true, size: 4 }] }] })
  })

  it('refuses anything that is not the schema', () => {
    expect(sanitizeRichText('<p><b>Hi</b></p>')).toBeNull()
    expect(sanitizeRichText({ paragraphs: [{ spans: [{ text: 'two\nlines' }] }] })).toBeNull()
  })

  it('drops slide formats that no longer match their slide', () => {
    expect(sanitizeSlideFormats({ 'Amazing grace\nHow sweet the sound': SAMPLE, Other: SAMPLE, Broken: 5 })).toEqual({
      'Amazing grace\nHow sweet the sound': SAMPLE,
    })
    expect(sanitizeSlideFormats(null)).toEqual({})
  })
})

describe('imported text boxes', () => {
  it('turns runs into spans and back, sizes relative to the box', () => {
    const props = { ...DEFAULT_TEXT_PROPS, fontSize: 4 }
    const paragraphs = [{ bullet: '•', align: 'left' as const, runs: [{ text: 'Big', fontSize: 8, bold: true }, { text: ' small' }] }]
    const rich = richFromParagraphs(paragraphs, props)
    expect(rich.paragraphs[0].spans[0]).toEqual({ text: 'Big', bold: true, size: 2 })
    const back = paragraphsFromRich(applyParagraphStyle(rich, range(0, 0, 0, 0), { verticalAlign: 'bottom' }), paragraphs, props)
    expect(back.paragraphs).toEqual(paragraphs)
    expect(back.verticalAlign).toBe('bottom')
  })
})
