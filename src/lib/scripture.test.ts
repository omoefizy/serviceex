// What a result row shows in its Scripture column: never empty while the verse has text.
import { describe, expect, it } from 'vitest'
import { passageSlides, passagesOf, resultSegments, type ResultItem } from './scripture'

const verse = { book: 'Proverbs', chapter: 9, verse: 10, text: 'The fear of the LORD is the beginning of wisdom.' }
const item = (segments?: ResultItem['segments']): ResultItem => ({
  key: 'KJV:Proverbs:9:10',
  version: 'KJV',
  book: 'Proverbs',
  chapter: 9,
  verseStart: 10,
  verseEnd: 10,
  verses: [verse],
  segments,
})

describe('resultSegments', () => {
  it('shows a listing row’s verse text', () => {
    expect(resultSegments(item())).toEqual([{ text: verse.text, match: false }])
  })

  it('keeps a keyword row’s highlighted matches', () => {
    const segments = [
      { text: 'The ', match: false },
      { text: 'fear', match: true },
      { text: ' of the LORD is the beginning of wisdom.', match: false },
    ]
    expect(resultSegments(item(segments))).toBe(segments)
  })

  it('falls back to the verse text when a keyword row has no segments', () => {
    expect(resultSegments(item([]))).toEqual([{ text: verse.text, match: false }])
    expect(resultSegments(item([{ text: ' ', match: false }]))).toEqual([{ text: verse.text, match: false }])
  })
})

describe('passageSlides', () => {
  const eph = (verse: number, text: string) => ({ book: 'Ephesians', chapter: 1, verse, text })
  const v19 = eph(19, 'And what is the exceeding greatness of his power to us-ward who believe, according to the working of his mighty power,')
  const v20 = eph(20, 'Which he wrought in Christ, when he raised him from the dead, and set him at his own right hand in the heavenly places,')

  it('cuts a single verse to its part, keeping the whole verse to move the split', () => {
    const [slide] = passageSlides([v19], 'KJV', { verseStart: 19, verseEnd: 19, startPart: 'b', endPart: 'b' })
    expect(slide.text).toBe('according to the working of his mighty power,')
    expect(slide.caption).toBe('Ephesians 1:19b KJV')
    expect(slide.source).toBe(v19.text)
    expect(slide.part?.which).toBe('b')
  })

  it('cuts the first and last verse of a range', () => {
    const slides = passageSlides([v19, v20], 'KJV', { verseStart: 19, verseEnd: 20, startPart: 'b', endPart: 'a' })
    expect(slides.map((s) => s.caption)).toEqual(['Ephesians 1:19b KJV', 'Ephesians 1:20a KJV'])
    expect(slides[1].text).toBe('Which he wrought in Christ, when he raised him from the dead,')
  })

  it('leaves whole verses as before', () => {
    expect(passageSlides([v19], 'KJV', { verseStart: 19, verseEnd: 19 })).toEqual([{ text: v19.text, caption: 'Ephesians 1:19 KJV' }])
  })
})

describe('passagesOf', () => {
  const row = (book: string, chapter: number, n: number, version = 'KJV'): ResultItem => ({
    key: `${version}:${book}:${chapter}:${n}`,
    version,
    book,
    chapter,
    verseStart: n,
    verseEnd: n,
    verses: [{ book, chapter, verse: n, text: `${book} ${chapter}:${n}` }],
  })

  it('joins neighbouring verses into ranges, across chapters and books', () => {
    const passages = passagesOf([row('John', 3, 16), row('John', 3, 17), row('John', 3, 18), row('John', 5, 1), row('Romans', 5, 8)])
    expect(passages.map((p) => p.reference)).toEqual(['John 3:16-18', 'John 5:1', 'Romans 5:8'])
    expect(passages[0].verses).toHaveLength(3)
  })

  it('keeps different versions apart', () => {
    expect(passagesOf([row('John', 3, 16), row('John', 3, 17, 'WEB')]).map((p) => `${p.reference} ${p.version}`)).toEqual(['John 3:16 KJV', 'John 3:17 WEB'])
  })
})
