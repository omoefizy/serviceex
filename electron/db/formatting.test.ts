// Slide formatting is stored as JSON next to the plain text: it survives saving and reloading, the plain text (what
// search, the AI features and the speech matcher read) is never changed by it, and older databases gain it safely.
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ARRANGEMENT } from '../../shared/lyrics'
import type { RichText, SongInput } from '../../shared/types'
import { db } from './index'
import { initSchema } from './schema'
import { addItem, createService, getService, updateItemPayload } from './services'
import { createSong, getSong, listSongs, updateSong } from './songs'

// A throwaway database in place of the app's.
vi.mock('./index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { initSchema } = await import('./schema')
  const db = new Database(':memory:')
  initSchema(db)
  return { db }
})

const LYRICS = '[Verse 1]\nAmazing grace\nHow sweet the sound\n\n[Chorus]\nMy chains are gone'

const VERSE: RichText = {
  paragraphs: [
    { align: 'left', verticalAlign: 'top', lineHeight: 1.5, spans: [{ text: 'Amazing ' }, { text: 'grace', bold: true, color: '#ffd400', size: 1.5 }] },
    { spans: [{ text: 'How sweet the ', italic: true }, { text: 'sound', underline: true, strike: true, highlight: '#003366', font: 'Inter', textCase: 'upper' }] },
  ],
}

const song = (patch: Partial<SongInput> = {}): SongInput => ({
  title: 'Amazing Grace',
  author: 'John Newton',
  copyright: null,
  tags: [],
  arrangement: DEFAULT_ARRANGEMENT,
  themeId: null,
  lyrics: LYRICS,
  ...patch,
})

describe('song formatting', () => {
  it('survives save and reload, exactly as stored', () => {
    const { id } = createSong(song({ formatting: { 'Amazing grace\nHow sweet the sound': VERSE } }))
    expect(getSong(id)?.formatting).toEqual({ 'Amazing grace\nHow sweet the sound': VERSE })

    const changed = { ...VERSE, paragraphs: [{ ...VERSE.paragraphs[0], align: 'justify' as const }, VERSE.paragraphs[1]] }
    updateSong(id, song({ formatting: { 'Amazing grace\nHow sweet the sound': changed } }))
    expect(getSong(id)?.formatting).toEqual({ 'Amazing grace\nHow sweet the sound': changed })
  })

  it('leaves the lyrics, the slides table and search plain', () => {
    const { id } = createSong(song({ title: 'Plain check', formatting: { 'Amazing grace\nHow sweet the sound': VERSE } }))
    expect(getSong(id)?.lyrics).toBe(LYRICS)
    const slides = db.prepare('SELECT text FROM slides WHERE song_id = ? ORDER BY order_index').all(id) as { text: string }[]
    expect(slides.map((s) => s.text)).toEqual(['Amazing grace\nHow sweet the sound', 'My chains are gone'])
    // The formatting JSON is not searched: a color or mark name finds nothing.
    expect(listSongs('ffd400').map((s) => s.id)).not.toContain(id)
    expect(listSongs('sweet the sound').map((s) => s.id)).toContain(id)
  })

  it('drops formatting for slides the lyrics no longer have, and anything unsafe in it', () => {
    const { id } = createSong(
      song({
        title: 'Pruned',
        formatting: {
          'Gone slide': { paragraphs: [{ spans: [{ text: 'Gone slide', bold: true }] }] },
          'My chains are gone': { paragraphs: [{ spans: [{ text: 'My chains are gone', color: 'red;}', bold: true }] }] },
        },
      }),
    )
    expect(getSong(id)?.formatting).toEqual({ 'My chains are gone': { paragraphs: [{ spans: [{ text: 'My chains are gone', bold: true }] }] } })
  })

  it('keeps the formatting of sections left out of the play order', () => {
    const { id } = createSong(
      song({ title: 'Order', arrangement: { order: ['Chorus'], linesPerSlide: null }, formatting: { 'Amazing grace\nHow sweet the sound': VERSE } }),
    )
    expect(Object.keys(getSong(id)?.formatting ?? {})).toEqual(['Amazing grace\nHow sweet the sound'])
  })
})

describe('migration', () => {
  it('adds the formatting column to an older database, and its songs read with none', () => {
    const old = new Database(':memory:')
    old.exec(`CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, author TEXT, lyrics TEXT, copyright TEXT, tags TEXT, arrangement TEXT, theme_id INTEGER)`)
    old.prepare("INSERT INTO songs (title, lyrics) VALUES ('Old song', 'Line one')").run()
    initSchema(old)
    // Running it again is harmless.
    initSchema(old)
    const columns = (old.prepare('PRAGMA table_info(songs)').all() as { name: string }[]).map((c) => c.name)
    expect(columns).toContain('formatting')
    expect(old.prepare('SELECT lyrics, formatting FROM songs').get()).toEqual({ lyrics: 'Line one', formatting: null })
  })

  it('reads a song saved before formatting existed with none', () => {
    const { lastInsertRowid } = db.prepare("INSERT INTO songs (title, lyrics, formatting) VALUES ('Legacy', 'Hello', NULL)").run()
    expect(getSong(Number(lastInsertRowid))?.formatting).toEqual({})
    const broken = db.prepare("INSERT INTO songs (title, lyrics, formatting) VALUES ('Broken', 'Hello', '{not json')").run()
    expect(getSong(Number(broken.lastInsertRowid))?.formatting).toEqual({})
  })
})

describe('schedule item formatting', () => {
  it('survives save and reload for scripture and announcements', () => {
    const service = createService('Sunday', null)
    const verse = { text: 'For God so loved the world', caption: 'John 3:16 KJV' }
    const scripture = addItem(service.id, 'scripture', null, { title: 'John 3:16 KJV', verses: [verse] })
    const formats = { [verse.text]: { paragraphs: [{ spans: [{ text: 'For God so ' }, { text: 'loved', bold: true }, { text: ' the world' }] }] } }
    expect(updateItemPayload(scripture.id, { title: 'John 3:16 KJV', verses: [verse], formats })).toBe(true)

    const announcement = addItem(service.id, 'announcement', null, { title: 'Welcome', body: 'Coffee after church' })
    const coffee = { 'Coffee after church': { paragraphs: [{ align: 'center' as const, spans: [{ text: 'Coffee after church', italic: true }] }] } }
    updateItemPayload(announcement.id, { title: 'Welcome', body: 'Coffee after church', formats: coffee })

    const items = getService(service.id)?.items ?? []
    expect(items[0].payload).toEqual({ title: 'John 3:16 KJV', verses: [verse], formats })
    expect(items[1].payload).toEqual({ title: 'Welcome', body: 'Coffee after church', formats: coffee })
  })

  it('refuses a payload of the wrong kind for the item', () => {
    const service = createService('Evening', null)
    const item = addItem(service.id, 'announcement', null, { title: 'Notice', body: 'Hello' })
    expect(() => updateItemPayload(item.id, { title: 'x', verses: [] })).toThrow()
  })
})
