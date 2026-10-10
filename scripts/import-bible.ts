// Downloads the public domain KJV and WEB Bibles and loads them into the WorshipDeck database.
//
//   npm run import:bible                 imports into the app's database
//   npm run import:bible -- --db <path>  imports into another database file
//   npm run import:bible -- --refresh    downloads again instead of using data/bible/
//
// Runs with Node's built-in TypeScript support (Node 22.18 or later).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { initSchema, rebuildVerseIndex } from '../electron/db/schema.ts'

interface GetBibleTranslation {
  translation: string
  books: {
    name: string
    chapters: { chapter: number; verses: { verse: number; text: string }[] }[]
  }[]
}

/** Both texts come from getbible.net, which serves each translation as a single JSON file. */
const VERSIONS = [
  { code: 'KJV', url: 'https://api.getbible.net/v2/kjv.json' },
  { code: 'WEB', url: 'https://api.getbible.net/v2/web.json' },
]

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = path.join(ROOT, 'data', 'bible')

/** Where Electron's app.getPath('userData') points for an app named "worshipdeck". */
function defaultDbPath(): string {
  const home = os.homedir()
  const base =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'))
  return path.join(base, 'worshipdeck', 'worshipdeck.db')
}

function parseArgs(argv: string[]): { dbPath: string; refresh: boolean } {
  const dbIndex = argv.indexOf('--db')
  if (dbIndex !== -1 && !argv[dbIndex + 1]) throw new Error('--db needs a file path')
  return {
    dbPath: dbIndex === -1 ? defaultDbPath() : path.resolve(argv[dbIndex + 1]),
    refresh: argv.includes('--refresh'),
  }
}

async function loadTranslation(code: string, url: string, refresh: boolean): Promise<GetBibleTranslation> {
  const file = path.join(CACHE_DIR, `${code.toLowerCase()}.json`)
  if (refresh || !existsSync(file)) {
    console.log(`Downloading ${code} from ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Downloading ${code} failed: ${response.status} ${response.statusText}`)
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(file, await response.text())
  } else {
    console.log(`Using cached ${path.relative(ROOT, file)}`)
  }

  const data = JSON.parse(readFileSync(file, 'utf8')) as GetBibleTranslation
  if (typeof data.translation !== 'string' || !Array.isArray(data.books) || data.books.length === 0) {
    throw new Error(`${file} is not a getbible.net translation; delete it or run with --refresh`)
  }
  return data
}

function importTranslation(db: Database.Database, code: string, data: GetBibleTranslation): number {
  const { id } = db
    .prepare(
      `INSERT INTO bible_versions (code, name) VALUES (?, ?)
       ON CONFLICT (code) DO UPDATE SET name = excluded.name
       RETURNING id`,
    )
    .get(code, data.translation) as { id: number }

  db.prepare('DELETE FROM verses WHERE version_id = ?').run(id)
  const insert = db.prepare('INSERT INTO verses (version_id, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)')

  let count = 0
  for (const book of data.books) {
    for (const chapter of book.chapters) {
      for (const verse of chapter.verses) {
        // The source pads some verses with runs of spaces and leading indentation.
        const text = verse.text.replace(/\s+/g, ' ').trim()
        if (text === '') continue
        insert.run(id, book.name, chapter.chapter, verse.verse, text)
        count++
      }
    }
  }
  return count
}

async function main(): Promise<void> {
  const { dbPath, refresh } = parseArgs(process.argv.slice(2))

  const translations = []
  for (const { code, url } of VERSIONS) {
    translations.push({ code, data: await loadTranslation(code, url, refresh) })
  }

  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  initSchema(db)

  console.log(`Importing into ${dbPath}`)
  for (const { code, data } of translations) {
    const count = db.transaction(() => importTranslation(db, code, data))()
    console.log(`  ${code}  ${data.translation}: ${count} verses`)
  }
  // Keyword search reads from this index, which does not follow changes to verses on its own.
  console.log('Building the verse search index')
  rebuildVerseIndex(db)
  db.close()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
