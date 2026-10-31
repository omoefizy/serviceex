import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTempDirSync, removeTempSync } from './tempDir.test-helper'
import { DB_FILE, LEGACY_DB_FILE, MIGRATION_MARKER, migrateUserData, readMarker } from './userDataMigration'

let appData: string
let oldDir: string
let newDir: string
const log = { info: vi.fn(), error: vi.fn() }

/** Every file under a folder with a hash of its bytes, to show the old folder is never changed. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else out[path.relative(dir, full)] = createHash('sha256').update(readFileSync(full)).digest('hex')
    }
  }
  walk(dir)
  return out
}

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

/** A WorshipDeck data folder as the app leaves it. */
function makeOldFolder(dir = oldDir): void {
  mkdirSync(dir, { recursive: true })
  const db = new Database(path.join(dir, LEGACY_DB_FILE))
  db.pragma('journal_mode = WAL')
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('theme', 'dark')")
  db.exec("CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO songs (title) VALUES ('Amazing Grace')")
  db.close()
  write(path.join(dir, 'fonts', 'Brand.ttf'), 'font bytes')
  write(path.join(dir, 'media', 'background.jpg'), 'jpeg bytes')
  write(path.join(dir, 'serviceex-license.json'), '{"licence":"signed"}')
  write(path.join(dir, 'sharing', 'peers.json'), '{"deviceId":"device-123","peers":[]}')
  write(path.join(dir, 'serviceex-session.enc'), 'v10sealed')
  write(path.join(dir, 'Local Storage', 'leveldb', '000003.log'), 'renderer settings')
  write(path.join(dir, 'Cache', 'Cache_Data', 'index'), 'cache')
  write(path.join(dir, 'GPUCache', 'data_0'), 'gpu cache')
  write(path.join(dir, 'whisper-server.pids'), '[1234]')
}

const run = (platform: NodeJS.Platform = 'darwin') => migrateUserData({ appData, newDir, platform, log, now: () => new Date('2026-10-31T12:00:00Z') })

beforeEach(() => {
  appData = makeTempDirSync('serviceex-migration-')
  oldDir = path.join(appData, 'worshipdeck')
  newDir = path.join(appData, 'ServiceEx')
  log.info.mockClear()
  log.error.mockClear()
})

afterEach(() => removeTempSync(appData))

describe('migrateUserData', () => {
  it('copies the old folder into the new one, renames the database and checks it opens', () => {
    makeOldFolder()
    const before = snapshot(oldDir)

    expect(run()).toEqual({ status: 'migrated', from: oldDir })

    const db = new Database(path.join(newDir, DB_FILE), { readonly: true, fileMustExist: true })
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('theme')).toEqual({ value: 'dark' })
    expect(db.prepare('SELECT title FROM songs').all()).toEqual([{ title: 'Amazing Grace' }])
    db.close()
    expect(existsSync(path.join(newDir, LEGACY_DB_FILE))).toBe(false)
    expect(readFileSync(path.join(newDir, 'fonts', 'Brand.ttf'), 'utf8')).toBe('font bytes')
    expect(readFileSync(path.join(newDir, 'media', 'background.jpg'), 'utf8')).toBe('jpeg bytes')
    expect(readFileSync(path.join(newDir, 'serviceex-license.json'), 'utf8')).toBe('{"licence":"signed"}')
    expect(JSON.parse(readFileSync(path.join(newDir, 'sharing', 'peers.json'), 'utf8')).deviceId).toBe('device-123')
    expect(readFileSync(path.join(newDir, 'serviceex-session.enc'), 'utf8')).toBe('v10sealed')
    expect(existsSync(path.join(newDir, 'Local Storage', 'leveldb', '000003.log'))).toBe(true)
    // Caches and the old app's process files stay behind.
    expect(existsSync(path.join(newDir, 'Cache'))).toBe(false)
    expect(existsSync(path.join(newDir, 'GPUCache'))).toBe(false)
    expect(existsSync(path.join(newDir, 'whisper-server.pids'))).toBe(false)
    expect(readMarker(newDir)).toEqual({ from: oldDir, at: '2026-10-31T12:00:00.000Z', outcome: 'migrated', secrets: 'pending' })
    // Nothing is left beside the new folder, and the old one is exactly as it was.
    expect(readdirSync(appData).sort()).toEqual(['ServiceEx', 'worshipdeck'])
    expect(snapshot(oldDir)).toEqual(before)
  })

  it('carries rows that are still only in the WAL', () => {
    makeOldFolder()
    // An open connection keeps its WAL; the row below has not been folded into the database file.
    const open = new Database(path.join(oldDir, LEGACY_DB_FILE))
    open.pragma('wal_autocheckpoint = 0')
    open.prepare('INSERT INTO songs (title) VALUES (?)').run('How Great Thou Art')
    expect(statSync(path.join(oldDir, `${LEGACY_DB_FILE}-wal`)).size).toBeGreaterThan(0)
    try {
      expect(run().status).toBe('migrated')
    } finally {
      open.close()
    }
    const db = new Database(path.join(newDir, DB_FILE), { readonly: true })
    expect(db.prepare('SELECT title FROM songs ORDER BY id').all()).toEqual([{ title: 'Amazing Grace' }, { title: 'How Great Thou Art' }])
    db.close()
  })

  it('keeps the new folder when both exist', () => {
    makeOldFolder()
    write(path.join(newDir, DB_FILE), 'the ServiceEx database')
    write(path.join(newDir, 'serviceex-license.json'), '{"licence":"new"}')
    const newBefore = snapshot(newDir)
    const oldBefore = snapshot(oldDir)

    expect(run()).toEqual({ status: 'not-needed', reason: 'in-use' })
    expect(snapshot(newDir)).toEqual(newBefore)
    expect(snapshot(oldDir)).toEqual(oldBefore)
  })

  it('logs a corrupted old database and starts fresh without throwing', () => {
    makeOldFolder()
    writeFileSync(path.join(oldDir, LEGACY_DB_FILE), 'this is not a SQLite database at all, just some bytes '.repeat(200))
    const before = snapshot(oldDir)

    const result = run()

    expect(result).toMatchObject({ status: 'failed', from: oldDir })
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('starting with an empty ServiceEx folder'), expect.anything())
    // None of the copy is put in place: the app makes a new database as on a first install.
    expect(readdirSync(newDir)).toEqual([MIGRATION_MARKER])
    expect(readMarker(newDir)).toMatchObject({ outcome: 'failed', from: oldDir, secrets: 'not-needed' })
    expect(readdirSync(appData).sort()).toEqual(['ServiceEx', 'worshipdeck'])
    expect(snapshot(oldDir)).toEqual(before)
    // It is not tried again on every launch.
    expect(run()).toEqual({ status: 'not-needed', reason: 'in-use' })
  })

  it('starts fresh when the old database is cut short', () => {
    makeOldFolder()
    const file = path.join(oldDir, LEGACY_DB_FILE)
    const db = new Database(file)
    db.pragma('journal_mode = DELETE')
    db.exec(`INSERT INTO songs (title) SELECT 'Song ' || value FROM json_each('[${Array.from({ length: 2000 }, (_, i) => i).join(',')}]')`)
    db.close()
    writeFileSync(file, readFileSync(file).subarray(0, 6000))

    expect(run().status).toBe('failed')
    expect(existsSync(path.join(newDir, DB_FILE))).toBe(false)
  })

  it('does nothing when there is no old folder', () => {
    expect(run()).toEqual({ status: 'not-needed', reason: 'no-old-folder' })
    expect(existsSync(newDir)).toBe(false)
  })

  it('fills in a new folder Electron already made, keeping what is there', () => {
    makeOldFolder()
    write(path.join(newDir, 'Preferences'), '{"made":"by electron"}')

    expect(run().status).toBe('migrated')
    expect(readFileSync(path.join(newDir, 'Preferences'), 'utf8')).toBe('{"made":"by electron"}')
    expect(existsSync(path.join(newDir, DB_FILE))).toBe(true)
    expect(existsSync(path.join(newDir, 'media', 'background.jpg'))).toBe(true)
    expect(readdirSync(appData).sort()).toEqual(['ServiceEx', 'worshipdeck'])
  })

  it('finds the old folder under the old product name too, and needs no key step on Windows', () => {
    oldDir = path.join(appData, 'WorshipDeck')
    makeOldFolder(oldDir)

    const result = run('win32')

    // On a case-insensitive disk the two spellings are one folder; either way it is found.
    expect(result.status).toBe('migrated')
    expect(readMarker(newDir)?.secrets).toBe('not-needed')
  })

  it('copies an old folder without a database', () => {
    mkdirSync(oldDir, { recursive: true })
    write(path.join(oldDir, 'serviceex-license.json'), '{}')

    expect(run().status).toBe('migrated')
    expect(existsSync(path.join(newDir, 'serviceex-license.json'))).toBe(true)
    expect(run()).toEqual({ status: 'not-needed', reason: 'in-use' })
  })
})
