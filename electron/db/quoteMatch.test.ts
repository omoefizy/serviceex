// A small Bible (a few KJV verses, public domain) in a throwaway database, and invented sermon sentences.
import Database from 'better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'
import { findQuote } from './quoteMatch'
import { initSchema, rebuildVerseIndex } from './schema'

const VERSES: [string, number, number, string][] = [
  ['John', 3, 16, 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'],
  ['John', 3, 17, 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.'],
  ['Proverbs', 3, 5, 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.'],
  ['Proverbs', 3, 6, 'In all thy ways acknowledge him, and he shall direct thy paths.'],
  ['Psalms', 23, 1, 'The LORD is my shepherd; I shall not want.'],
  ['Philippians', 4, 13, 'I can do all things through Christ which strengtheneth me.'],
  ['Romans', 8, 28, 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.'],
]

let db: Database.Database

beforeAll(() => {
  db = new Database(':memory:')
  initSchema(db)
  const { lastInsertRowid } = db.prepare("INSERT INTO bible_versions (code, name) VALUES ('KJV', 'King James Version')").run()
  const insert = db.prepare('INSERT INTO verses (version_id, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)')
  for (const [book, chapter, verse, text] of VERSES) insert.run(lastInsertRowid, book, chapter, verse, text)
  rebuildVerseIndex(db)
})

describe('findQuote', () => {
  it('finds a verse the speaker quotes without naming it', () => {
    const match = findQuote(db, 'and remember, we know that all things work together for good to them that love God')
    expect(match).toMatchObject({ book: 'Romans', chapter: 8, verse: 28, version: 'KJV' })
    expect(match!.confidence).toBeLessThan(0.8)
  })

  it('picks the right verse among neighbours that share words', () => {
    expect(findQuote(db, 'for God sent not his son into the world to condemn the world')).toMatchObject({ book: 'John', verse: 17 })
  })

  it('finds nothing in a short phrase', () => {
    expect(findQuote(db, 'the Lord is my shepherd')).toBeNull()
  })

  it('finds nothing in ordinary talk', () => {
    expect(findQuote(db, 'after the service there will be coffee and cake in the hall for everyone')).toBeNull()
  })
})
