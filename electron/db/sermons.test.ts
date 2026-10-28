// Sermons in the database: lines saved as they are heard survive a crash and a restart, older databases gain the
// tables without losing anything, and search finds title, preacher and transcript words. All text is invented.
import Database from 'better-sqlite3'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTempDirSync, removeTempSync } from '../tempDir.test-helper'
import { initSchema } from './schema'

/** The database the module under test uses; replaced by each test, and again to simulate a restart. */
const holder: { db: Database.Database } = { db: new Database(':memory:') }
vi.mock('./index', () => ({
  get db() {
    return holder.db
  },
}))

const sermons = await import('./sermons')

let folder: string
let file: string
/** Every connection a test opened, including ones left open on purpose to simulate a crash. */
const connections: Database.Database[] = []

/** Opens the database file as the app does at startup. */
function open(): Database.Database {
  const db = new Database(file)
  connections.push(db)
  db.pragma('journal_mode = WAL')
  initSchema(db)
  return db
}

beforeEach(() => {
  folder = makeTempDirSync('sermons-test-')
  file = path.join(folder, 'test.db')
  holder.db = open()
})

afterEach(() => {
  // Windows cannot delete the file (or its -wal and -shm files) while any connection still holds it.
  for (const db of connections.splice(0)) if (db.open) db.close()
  removeTempSync(folder)
})

describe('recording', () => {
  it('keeps every saved line through a crash and a restart, and finishes the sermon at startup', () => {
    const sermon = sermons.createSermon({ title: 'Seeds in Winter', preacher: 'Rowan Ellery', series: 'Quiet Seasons' }, 'Harbour Lane Fellowship')
    expect(sermon.status).toBe('recording')
    sermons.appendSegment(sermon.id, 'The ground looks bare in the cold months.')
    sermons.appendSegment(sermon.id, 'Yet the seed is busy where nobody can see it.')
    sermons.addScripture(sermon.id, 'Mark 4:26-29', 'detected')
    sermons.addStatement(sermon.id, 'Waiting is not the same as nothing happening.', true)

    // A crash: the process ends without finishing the sermon or closing the database cleanly.
    holder.db = open()
    expect(sermons.getSermon(sermon.id)?.status).toBe('recording')
    expect(sermons.recoverRecordings()).toBe(1)

    const after = sermons.getSermon(sermon.id)!
    expect(after.status).toBe('saved')
    expect(after.segments.map((s) => s.text)).toEqual(['The ground looks bare in the cold months.', 'Yet the seed is busy where nobody can see it.'])
    expect(after.segments.every((s) => s.isFinal)).toBe(true)
    expect(after.scriptures).toMatchObject([{ reference: 'Mark 4:26-29', source: 'detected' }])
    expect(after.statements).toMatchObject([{ text: 'Waiting is not the same as nothing happening.', pinned: true }])
    expect(after.churchName).toBe('Harbour Lane Fellowship')
  })

  it('removes an untitled sermon that recorded nothing, and keeps one with words', () => {
    const empty = sermons.createSermon({}, '')
    const spoken = sermons.createSermon({}, '')
    sermons.appendSegment(spoken.id, 'A single line was heard.')
    sermons.finishSermon(empty.id)
    sermons.finishSermon(spoken.id)
    expect(sermons.getSermon(empty.id)).toBeNull()
    expect(sermons.getSermon(spoken.id)?.status).toBe('saved')
  })

  it('dates a sermon today unless told otherwise and keeps no preset names', () => {
    const sermon = sermons.createSermon({ date: 'not a date' }, '')
    expect(sermon.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(sermon).toMatchObject({ title: '', preacher: '', series: '', churchName: '' })
  })

  it('saves a reference once and pins a statement saved earlier', () => {
    const { id } = sermons.createSermon({ title: 'Lanterns' }, '')
    sermons.addScripture(id, 'Psalm 119:105', 'detected')
    sermons.addScripture(id, 'Psalm 119:105', 'detected')
    sermons.addStatement(id, 'Enough light for the next step.', false)
    sermons.addStatement(id, 'Enough light for the next step.', true)
    const sermon = sermons.getSermon(id)!
    expect(sermon.scriptures).toHaveLength(1)
    expect(sermon.statements).toMatchObject([{ pinned: true }])
  })

  it('remembers past preachers, most recent first, without repeats', () => {
    sermons.createSermon({ preacher: 'Imani Castell' }, '')
    sermons.createSermon({ preacher: 'Teo Marsh' }, '')
    sermons.createSermon({ preacher: 'imani castell' }, '')
    expect(sermons.listPreachers()).toHaveLength(2)
    expect(sermons.listPreachers()[1]).toBe('Teo Marsh')
  })
})

describe('search', () => {
  beforeEach(() => {
    const a = sermons.createSermon({ title: 'Bread for the Road', preacher: 'Nadia Okonjo', date: '2026-09-06' }, '')
    sermons.appendSegment(a.id, 'Every traveller packs differently, but nobody leaves without water.')
    const b = sermons.createSermon({ title: 'The Unfinished Bridge', preacher: 'Elias Brandt', date: '2026-09-13' }, '')
    sermons.appendSegment(b.id, 'The carpenter left the last plank for his apprentice to lay.')
    sermons.createSermon({ title: '100% Honest', date: '2026-09-20' }, '')
  })

  it('finds words in the transcript, title and preacher', () => {
    expect(sermons.searchSermons('apprentice').map((s) => s.title)).toEqual(['The Unfinished Bridge'])
    expect(sermons.searchSermons('bread').map((s) => s.title)).toEqual(['Bread for the Road'])
    expect(sermons.searchSermons('okonjo').map((s) => s.title)).toEqual(['Bread for the Road'])
  })

  it('needs every word, in any field', () => {
    expect(sermons.searchSermons('brandt plank').map((s) => s.title)).toEqual(['The Unfinished Bridge'])
    expect(sermons.searchSermons('brandt water')).toEqual([])
  })

  it('matches % and _ as typed', () => {
    expect(sermons.searchSermons('100%').map((s) => s.title)).toEqual(['100% Honest'])
    expect(sermons.searchSermons('_')).toEqual([])
  })

  it('lists newest date first', () => {
    expect(sermons.listSermons().map((s) => s.date)).toEqual(['2026-09-20', '2026-09-13', '2026-09-06'])
  })
})

describe('migration', () => {
  it('adds the sermon tables to a database from an older version without touching its data', () => {
    holder.db.close()
    removeTempSync(file)
    const old = new Database(file)
    old.exec("CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, lyrics TEXT); INSERT INTO songs (title, lyrics) VALUES ('Morning Song', 'la la')")
    old.close()

    holder.db = open()
    // Twice, as on every start.
    initSchema(holder.db)
    expect(holder.db.prepare('SELECT title FROM songs').all()).toEqual([{ title: 'Morning Song' }])
    const { id } = sermons.createSermon({ title: 'After the Upgrade' }, '')
    sermons.appendSegment(id, 'Old songs and new sermons live side by side.')
    expect(sermons.getSermon(id)?.segments).toHaveLength(1)
  })

  it('deletes a sermon with its lines, scripture and statements', () => {
    const { id } = sermons.createSermon({ title: 'Gone' }, '')
    sermons.appendSegment(id, 'Words to be removed.')
    sermons.addScripture(id, 'John 1:5', 'manual')
    sermons.addStatement(id, 'A line to be removed.', false)
    sermons.deleteSermon(id)
    for (const table of ['sermon_segments', 'sermon_scriptures', 'sermon_statements']) {
      expect(holder.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    }
  })
})
