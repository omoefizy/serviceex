import { app } from 'electron'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ensureVerseIndex, initSchema } from './schema'

const dbPath = path.join(app.getPath('userData'), 'worshipdeck.db')

export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
initSchema(db)
ensureVerseIndex(db)
