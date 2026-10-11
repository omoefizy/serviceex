// A small Bible in a throwaway database: a few KJV and World English Bible verses (both public domain), padded with
// invented filler sentences of everyday words so word rarity behaves as it does in a whole Bible. The spoken lines
// are invented sermon sentences.
import Database from 'better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'
import { findQuotes } from './quoteMatch'
import { initSchema, rebuildVerseIndex } from './schema'

const KJV: [string, number, number, string][] = [
  ['John', 1, 5, 'And the light shineth in darkness; and the darkness comprehended it not.'],
  ['John', 3, 16, 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'],
  ['John', 3, 17, 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.'],
  ['Proverbs', 3, 5, 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.'],
  ['Proverbs', 3, 6, 'In all thy ways acknowledge him, and he shall direct thy paths.'],
  ['Psalms', 23, 1, 'The LORD is my shepherd; I shall not want.'],
  ['Philippians', 4, 13, 'I can do all things through Christ which strengtheneth me.'],
  ['Romans', 8, 28, 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.'],
]
const WEB: [string, number, number, string][] = [
  ['John', 1, 5, 'The light shines in the darkness, and the darkness hasn’t overcome it.'],
  ['John', 3, 16, 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.'],
]

/** Invented sentences of common words, so "lord", "people" and "said" are as frequent here as in a Bible. */
const POOL = 'and the lord said to people of land go up them that they shall come house day king son men all children in for his'.split(' ')
const filler = (n: number) => Array.from({ length: 12 }, (_, k) => POOL[(n * 7 + k * 3) % POOL.length]).join(' ')

let db: Database.Database

beforeAll(() => {
  db = new Database(':memory:')
  initSchema(db)
  const insert = db.prepare('INSERT INTO verses (version_id, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)')
  const version = (code: string, name: string) => db.prepare('INSERT INTO bible_versions (code, name) VALUES (?, ?)').run(code, name).lastInsertRowid
  const kjv = version('KJV', 'King James Version')
  const web = version('WEB', 'World English Bible')
  for (const [book, chapter, verse, text] of KJV) insert.run(kjv, book, chapter, verse, text)
  for (const [book, chapter, verse, text] of WEB) insert.run(web, book, chapter, verse, text)
  for (let n = 1; n <= 300; n++) insert.run(kjv, 'Numbers', Math.ceil(n / 30), ((n - 1) % 30) + 1, filler(n))
  rebuildVerseIndex(db)
})

const top = (text: string) => findQuotes(db, text)[0]

describe('findQuotes', () => {
  it('finds a verse the speaker quotes without naming it', () => {
    const match = top('and remember, we know that all things work together for good to them that love God')
    expect(match).toMatchObject({ book: 'Romans', chapter: 8, verse: 28, version: 'KJV' })
    expect(match.confidence).toBeLessThanOrEqual(0.8)
  })

  it('picks the right verse among neighbours that share words', () => {
    expect(top('for God sent not his son into the world to condemn the world')).toMatchObject({ book: 'John', verse: 17 })
  })

  it('matches the modern wording against the WEB', () => {
    expect(top('the light shines in the darkness and the darkness has not overcome it')).toMatchObject({ book: 'John', chapter: 1, verse: 5, version: 'WEB' })
  })

  it('matches the KJV wording too', () => {
    expect(top('the light shineth in darkness and the darkness comprehended it not')).toMatchObject({ book: 'John', verse: 5, version: 'KJV' })
  })

  it('finds the verse that contains a short, distinctive part of it', () => {
    expect(top('so whatever this week holds, remember the light shines in darkness')).toMatchObject({ book: 'John', chapter: 1, verse: 5 })
  })

  it('highlights the matched words', () => {
    const match = top('the light shines in the darkness and the darkness has not overcome it')
    expect(match.highlight.map((h) => h.text).join('')).toBe('The light shines in the darkness, and the darkness hasn’t overcome it.')
    expect(match.highlight.every((h) => h.match)).toBe(true)
  })

  it('returns at most three verses, each once', () => {
    const matches = findQuotes(db, 'for God so loved the world that he gave his only begotten son that whosoever believeth in him')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches.length).toBeLessThanOrEqual(3)
    expect(matches[0]).toMatchObject({ book: 'John', chapter: 3, verse: 16 })
    expect(new Set(matches.map((m) => `${m.book} ${m.chapter}:${m.verse}`)).size).toBe(matches.length)
  })

  it('needs more than a few common words', () => {
    expect(findQuotes(db, 'the lord is my shepherd')).toEqual([])
  })

  it('finds nothing in ordinary talk', () => {
    expect(findQuotes(db, 'after the service there will be coffee and cake in the hall for everyone')).toEqual([])
    expect(findQuotes(db, 'the lord said to the people that the children of the land shall come up')).toEqual([])
  })
})
