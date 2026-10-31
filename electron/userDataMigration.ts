// The one time move from WorshipDeck's data folder to ServiceEx's. Renaming the product changed app.name, and with it
// app.getPath('userData') (<appData>/worshipdeck before, <appData>/ServiceEx now), so on the first launch after the
// update the old folder is copied (database, settings, fonts, imported media, licence, device id, paired devices,
// transcripts, everything but Chromium's caches) into the new one. The copy is made beside the new folder, its
// database is opened and checked, and only then is it put in place, so a failed copy never leaves a half-filled
// folder that would count as in use. The old folder is never changed or deleted: it stays as a fallback.
//
// No Electron here, so the tests run it against temporary folders; ./migrateUserData calls it before the database opens.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/** What app.name was before the rename: the package name in every build so far, and the old productName. */
export const LEGACY_APP_NAMES = ['worshipdeck', 'WorshipDeck'] as const
export const DB_FILE = 'serviceex.db'
export const LEGACY_DB_FILE = 'worshipdeck.db'
/** Written into the new folder once the migration ran (or failed), so it runs once. */
export const MIGRATION_MARKER = 'migrated-from-worshipdeck.json'

/** Chromium's caches, rebuilt on demand, and lock and process files that belong to a running WorshipDeck. */
const SKIPPED = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
  'Crashpad',
  'DevToolsActivePort',
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'whisper-server.pids',
])

export interface MigrationMarker {
  from: string
  at: string
  outcome: 'migrated' | 'failed'
  error?: string
  /**
   * The safeStorage keys: on macOS the old blobs were sealed with the "worshipdeck Safe Storage" Keychain item, so
   * they are re-sealed under ServiceEx's once the app is ready (see ./legacySecrets). Windows keeps the key in the
   * copied Local State file, so nothing is needed there.
   */
  secrets: 'pending' | 'done' | 'not-needed'
}

export type MigrationResult =
  | { status: 'not-needed'; reason: 'in-use' | 'no-old-folder' }
  | { status: 'migrated'; from: string }
  | { status: 'failed'; from: string; error: string }

export interface MigrationLog {
  info(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface MigrationOptions {
  /** app.getPath('appData'), where both folders live. */
  appData: string
  /** app.getPath('userData') under the new name. */
  newDir: string
  platform?: NodeJS.Platform
  log?: MigrationLog
  now?: () => Date
}

/** Whether the new folder already holds ServiceEx's data (or a record of a migration), in which case it is kept. */
export function inUse(dir: string): boolean {
  return existsSync(path.join(dir, DB_FILE)) || existsSync(path.join(dir, MIGRATION_MARKER))
}

export function readMarker(dir: string): MigrationMarker | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, MIGRATION_MARKER), 'utf8')) as MigrationMarker
  } catch {
    return null
  }
}

export function writeMarker(dir: string, marker: MigrationMarker): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, MIGRATION_MARKER), JSON.stringify(marker, null, 2))
}

const isDir = (dir: string) => {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** The old folder to copy, preferring one with a database (on Linux both spellings can exist). */
function findOldDir(appData: string, newDir: string): string | null {
  const candidates = LEGACY_APP_NAMES.map((name) => path.join(appData, name)).filter(
    (dir) => path.resolve(dir).toLowerCase() !== path.resolve(newDir).toLowerCase() && isDir(dir),
  )
  return candidates.find((dir) => existsSync(path.join(dir, LEGACY_DB_FILE))) ?? candidates[0] ?? null
}

/** Opens the copied database (which replays its WAL), checks it and folds the WAL in. Throws when it is unusable. */
export function verifyDatabase(file: string): void {
  const db = new Database(file, { fileMustExist: true })
  try {
    const check = db.pragma('quick_check') as { quick_check: string }[]
    if (check.length !== 1 || check[0].quick_check !== 'ok') throw new Error(`Database check failed: ${check.map((r) => r.quick_check).join('; ')}`)
    const { tables } = db.prepare("SELECT count(*) AS tables FROM sqlite_master WHERE type = 'table'").get() as { tables: number }
    if (tables === 0) throw new Error('The database has no tables')
    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

/** Runs the migration when it is due. Never throws: on any failure it logs, records it and leaves a fresh start. */
export function migrateUserData({ appData, newDir, platform = process.platform, log = console, now = () => new Date() }: MigrationOptions): MigrationResult {
  if (inUse(newDir)) return { status: 'not-needed', reason: 'in-use' }
  const oldDir = findOldDir(appData, newDir)
  if (!oldDir) return { status: 'not-needed', reason: 'no-old-folder' }

  const started = Date.now()
  const staging = `${newDir}.migrating-${process.pid}`
  try {
    rmSync(staging, { recursive: true, force: true })
    cpSync(oldDir, staging, {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(oldDir, source)
        return relative === '' || relative.includes(path.sep) || !SKIPPED.has(relative)
      },
    })
    // The database takes the new name; its WAL and shared memory files go with it, as SQLite finds them by name.
    if (existsSync(path.join(staging, LEGACY_DB_FILE))) {
      for (const suffix of ['', '-wal', '-shm']) {
        const from = path.join(staging, LEGACY_DB_FILE + suffix)
        if (existsSync(from)) renameSync(from, path.join(staging, DB_FILE + suffix))
      }
    }
    if (existsSync(path.join(staging, DB_FILE))) verifyDatabase(path.join(staging, DB_FILE))

    if (!existsSync(newDir)) {
      renameSync(staging, newDir)
    } else {
      // Electron may have made the folder already; what it holds is kept and the copy fills in the rest.
      for (const entry of readdirSync(staging)) {
        if (!existsSync(path.join(newDir, entry))) renameSync(path.join(staging, entry), path.join(newDir, entry))
      }
      rmSync(staging, { recursive: true, force: true })
    }
    writeMarker(newDir, { from: oldDir, at: now().toISOString(), outcome: 'migrated', secrets: platform === 'darwin' ? 'pending' : 'not-needed' })
    log.info(`Moved the WorshipDeck data from ${oldDir} to ${newDir} in ${Date.now() - started} ms. The old folder is kept.`)
    return { status: 'migrated', from: oldDir }
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)
    log.error(
      `Could not move the WorshipDeck data from ${oldDir}; starting with an empty ServiceEx folder. The old folder is ` +
        `unchanged. To try again, quit ServiceEx and delete ${path.join(newDir, MIGRATION_MARKER)}.`,
      cause,
    )
    try {
      rmSync(staging, { recursive: true, force: true })
      writeMarker(newDir, { from: oldDir, at: now().toISOString(), outcome: 'failed', error, secrets: 'not-needed' })
    } catch (markerError) {
      log.error('Could not record the failed migration', markerError)
    }
    return { status: 'failed', from: oldDir, error }
  }
}
