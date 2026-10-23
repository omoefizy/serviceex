import { describe, expect, it } from 'vitest'
import { readScriptureQuery } from './referenceSuggestions'

describe('readScriptureQuery', () => {
  it('lists the eight books that start with 1, in Bible order', () => {
    expect(readScriptureQuery('1')).toEqual({
      kind: 'books',
      books: ['1 Samuel', '1 Kings', '1 Chronicles', '1 Corinthians', '1 Thessalonians', '1 Timothy', '1 Peter', '1 John'],
      words: false,
    })
  })

  it('lists 1 Chronicles and 1 Corinthians for "1 c"', () => {
    expect(readScriptureQuery('1 c')).toEqual({ kind: 'books', books: ['1 Chronicles', '1 Corinthians'], words: false })
  })

  it('lists book prefixes in Bible order', () => {
    const jo = readScriptureQuery('jo')
    expect(jo.kind === 'books' && jo.books).toEqual(['Joshua', 'Job', 'Joel', 'Jonah', 'John', '1 John', '2 John', '3 John'])
  })

  it('reads "1 pe 2" as the whole of 1 Peter 2', () => {
    expect(readScriptureQuery('1 pe 2')).toEqual({
      kind: 'chapter',
      ref: { book: '1 Peter', chapter: 2, verseStart: null, verseEnd: null },
      words: false,
    })
    expect(readScriptureQuery('1 peter 2 ')).toMatchObject({ kind: 'chapter', ref: { book: '1 Peter', chapter: 2, verseStart: null } })
  })

  it('shows chapter 1 for a whole book name', () => {
    expect(readScriptureQuery('1 peter')).toMatchObject({ kind: 'chapter', ref: { book: '1 Peter', chapter: 1, verseStart: null } })
  })

  it('highlights verse 4 for "1 peter 2:4" and "1 peter 2 4"', () => {
    const marked = { kind: 'chapter', ref: { book: '1 Peter', chapter: 2, verseStart: 4, verseEnd: 4 } }
    expect(readScriptureQuery('1 peter 2:4')).toMatchObject(marked)
    expect(readScriptureQuery('1 peter 2 4')).toMatchObject(marked)
    expect(readScriptureQuery('jn 3 16')).toMatchObject({ ref: { book: 'John', chapter: 3, verseStart: 16, verseEnd: 16 } })
  })

  it('highlights a range', () => {
    expect(readScriptureQuery('john 3:16-18')).toMatchObject({ kind: 'chapter', ref: { book: 'John', chapter: 3, verseStart: 16, verseEnd: 18 } })
  })

  it('offers a word search for book names that are also words', () => {
    expect(readScriptureQuery('job')).toMatchObject({ kind: 'chapter', ref: { book: 'Job', chapter: 1 }, words: true })
    expect(readScriptureQuery('mark')).toMatchObject({ kind: 'chapter', words: true })
  })

  it('searches the words of anything else', () => {
    expect(readScriptureQuery('fear of the lord')).toEqual({ kind: 'text', query: 'fear of the lord' })
    expect(readScriptureQuery('')).toEqual({ kind: 'none' })
  })
})
