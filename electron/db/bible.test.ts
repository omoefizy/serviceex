// Every way the Scripture tab fills its list must return the verse text with each row, for each version: the rows
// show it in the Scripture column without another lookup.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from './index'
import { getRange, getVerse, searchText, searchVerses } from './bible'
import { rebuildVerseIndex } from './schema'

// A throwaway database in place of the app's.
vi.mock('./index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { initSchema } = await import('./schema')
  const db = new Database(':memory:')
  initSchema(db)
  return { db }
})

const VERSES: Record<string, [string, number, number, string][]> = {
  KJV: [
    ['Genesis', 1, 1, 'In the beginning God created the heaven and the earth.'],
    ['John', 1, 1, 'In the beginning was the Word, and the Word was with God, and the Word was God.'],
    ['John', 3, 16, 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'],
    ['John', 3, 17, 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.'],
    ['Proverbs', 1, 7, 'The fear of the LORD is the beginning of knowledge: but fools despise wisdom and instruction.'],
    ['Proverbs', 9, 10, 'The fear of the LORD is the beginning of wisdom: and the knowledge of the holy is understanding.'],
  ],
  WEB: [
    ['Genesis', 1, 1, 'In the beginning, God created the heavens and the earth.'],
    ['John', 1, 1, 'In the beginning was the Word, and the Word was with God, and the Word was God.'],
    ['John', 3, 16, 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.'],
    ['John', 3, 17, 'For God didn’t send his Son into the world to judge the world, but that the world should be saved through him.'],
    ['Proverbs', 1, 7, 'The fear of the Lord is the beginning of knowledge; but the foolish despise wisdom and instruction.'],
    ['Proverbs', 9, 10, 'The fear of the Lord is the beginning of wisdom. The knowledge of the Holy One is understanding.'],
  ],
}
const BOTH = ['KJV', 'WEB']

beforeAll(() => {
  const insert = db.prepare('INSERT INTO verses (version_id, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)')
  for (const [code, verses] of Object.entries(VERSES)) {
    const id = db.prepare('INSERT INTO bible_versions (code, name) VALUES (?, ?)').run(code, code).lastInsertRowid
    for (const [book, chapter, verse, text] of verses) insert.run(id, book, chapter, verse, text)
  }
  rebuildVerseIndex(db)
})

/** Fails on any row without text, naming it. */
function expectText(rows: { book: string; chapter: number; verse: number; text: string }[]) {
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) expect(row.text.trim(), `${row.book} ${row.chapter}:${row.verse}`).not.toBe('')
}

describe('every result row carries its verse text', () => {
  it('keyword search, in each version, with the matches marked and the whole verse kept', () => {
    for (const versions of [['KJV'], ['WEB'], BOTH]) {
      const { hits } = searchVerses({ query: 'fear of the lord', versions, testament: 'all', book: null, offset: 0, limit: 30 })
      expectText(hits)
      expect(new Set(hits.map((hit) => hit.version))).toEqual(new Set(versions))
      for (const hit of hits) {
        expect(hit.segments.map((s) => s.text).join('')).toBe(hit.text)
        expect(hit.segments.some((s) => s.match)).toBe(true)
      }
    }
  })

  it('keyword search while the last word is still being typed', () => {
    const { hits } = searchVerses({ query: 'fear of the lo', versions: BOTH, testament: 'old', book: null, offset: 0, limit: 30 })
    expectText(hits)
  })

  it('book list: each book’s first verse, in each version', () => {
    for (const version of BOTH) {
      for (const book of ['Genesis', 'John']) expectText(getRange(version, book, 1, 1, 1))
    }
  })

  it('chapter list: every verse of the chapter, in each version', () => {
    for (const version of BOTH) {
      const rows = getRange(version, 'John', 3, 1, 999)
      expect(rows.map((row) => row.verse)).toEqual([16, 17])
      expectText(rows)
    }
  })

  it('verse and range references, in each version', () => {
    for (const version of BOTH) {
      expectText(getRange(version, 'John', 3, 16, 17))
      expectText([getVerse(version, 'Proverbs', 9, 10)!])
    }
  })

  it('plain text search, in each version', () => {
    for (const version of BOTH) expectText(searchText(version, 'beginning'))
  })
})
