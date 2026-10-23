// What a result row shows in its Scripture column: never empty while the verse has text.
import { describe, expect, it } from 'vitest'
import { resultSegments, type ResultItem } from './scripture'

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
