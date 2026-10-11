import { app } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ensureVerseIndex, initSchema } from './schema'

const dbPath = path.join(app.getPath('userData'), 'worshipdeck.db')

/** The KJV and WEB the installers ship, from `npm run import:bible -- --bundle`. */
const bundledBiblePath = app.isPackaged
  ? path.join(process.resourcesPath, 'bible', 'bible.db')
  : path.join(app.getAppPath(), 'vendor', 'bible', 'bible.db')

export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
initSchema(db)
installBundledBible(db)
ensureVerseIndex(db)

/** Copies each bundled translation the database does not have yet, as on first run. Leaves existing ones alone. */
function installBundledBible(db: Database.Database): void {
  if (!existsSync(bundledBiblePath)) return
  const bundle = new Database(bundledBiblePath, { readonly: true, fileMustExist: true })
  try {
    const have = new Set((db.prepare('SELECT code FROM bible_versions').all() as { code: string }[]).map((v) => v.code))
    const versions = (bundle.prepare('SELECT id, code, name FROM bible_versions').all() as { id: number; code: string; name: string }[])
      .filter((v) => !have.has(v.code))
    if (versions.length === 0) return
    const addVersion = db.prepare('INSERT INTO bible_versions (code, name) VALUES (?, ?) RETURNING id')
    const addVerse = db.prepare('INSERT INTO verses (version_id, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)')
    const readVerses = bundle.prepare('SELECT book, chapter, verse, text FROM verses WHERE version_id = ? ORDER BY id').raw()
    db.transaction(() => {
      for (const version of versions) {
        const { id } = addVersion.get(version.code, version.name) as { id: number }
        for (const [book, chapter, verse, text] of readVerses.iterate(version.id) as Iterable<[string, number, number, string]>) {
          addVerse.run(id, book, chapter, verse, text)
        }
      }
    })()
  } catch (error) {
    // The app still works without scripture; the Bible can be imported later.
    console.error('Could not install the bundled Bible:', error)
  } finally {
    bundle.close()
  }
}
