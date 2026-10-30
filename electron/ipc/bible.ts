import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { canAddTranslation, requireFeature } from '../../shared/features'
import { BOOK_NAMES } from '../../shared/parseReference'
import type { BibleImportResult, BibleVersionCode, Testament, VerseSearchParams } from '../../shared/types'
import {
  bookStructure,
  getRange,
  getVerse,
  listBooks,
  listVersions,
  matchQuote,
  removeVersion,
  searchText,
  searchVerses,
  storeVersion,
} from '../db/bible'
import { mergeBibles, parseBibleFile } from '../db/bibleImport'

// Arguments arrive from the renderer, so check their shape before they reach the database.

/** Version codes are short: letters, digits and dashes, such as "KJV" or "NIV-84". */
const VERSION_CODE = /^[A-Z0-9][A-Z0-9-]{0,11}$/

const isVersionCode = (value: unknown): value is BibleVersionCode => typeof value === 'string' && VERSION_CODE.test(value)

function assertVersion(value: unknown): BibleVersionCode {
  if (!isVersionCode(value)) throw new TypeError('Bible version must be a code such as KJV')
  return value
}

function assertVersionName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 100) {
    throw new TypeError('The version needs a name of up to 100 characters')
  }
  return value.trim()
}

/** Asks for the files, reads them and stores the verses. Resolves to null if the picker is cancelled. */
async function importVersion(window: BrowserWindow | null, code: BibleVersionCode, name: string): Promise<BibleImportResult | null> {
  const options: Electron.OpenDialogOptions = {
    title: `Import ${code}`,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Bible files (Zefania, OSIS, USFM)', extensions: ['xml', 'osis', 'usfm', 'sfm', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  }
  const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || picked.filePaths.length === 0) return null
  const parts = []
  for (const file of picked.filePaths) {
    try {
      parts.push(parseBibleFile(await readFile(file, 'utf8')))
    } catch (error) {
      throw new Error(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const bible = mergeBibles(parts)
  if (bible.verses.length === 0) throw new Error('No verses were found in the chosen files')
  const verses = storeVersion(code, name, bible.verses)
  return { code, name, verses, skippedBooks: bible.skippedBooks }
}

function assertBook(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('Book must be a non-empty string')
  return value
}

function assertNumber(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value as number
}

export function registerBibleIpc(): void {
  ipcMain.handle('bible:getVerse', (_event, version: unknown, book: unknown, chapter: unknown, verse: unknown) =>
    getVerse(assertVersion(version), assertBook(book), assertNumber(chapter, 'Chapter'), assertNumber(verse, 'Verse')),
  )

  ipcMain.handle(
    'bible:getRange',
    (_event, version: unknown, book: unknown, chapter: unknown, verseStart: unknown, verseEnd: unknown) =>
      getRange(
        assertVersion(version),
        assertBook(book),
        assertNumber(chapter, 'Chapter'),
        assertNumber(verseStart, 'First verse'),
        assertNumber(verseEnd, 'Last verse'),
      ),
  )

  ipcMain.handle('bible:searchText', (_event, version: unknown, query: unknown) =>
    searchText(assertVersion(version), typeof query === 'string' ? query : ''),
  )

  ipcMain.handle('bible:listBooks', () => listBooks())

  ipcMain.handle('bible:listVersions', () => listVersions())

  ipcMain.handle('bible:importVersion', (event, code: unknown, name: unknown) => {
    const version = assertVersion(code)
    // Replacing a translation already installed is not one more.
    if (!canAddTranslation(listVersions().filter((v) => v.code !== version).length)) requireFeature('bible.extraVersions')
    return importVersion(BrowserWindow.fromWebContents(event.sender), version, assertVersionName(name))
  })

  ipcMain.handle('bible:removeVersion', (_event, code: unknown) => removeVersion(assertVersion(code)))

  ipcMain.handle('bible:search', (_event, params: unknown) => searchVerses(assertSearchParams(params)))

  ipcMain.handle('bible:bookStructure', (_event, book: unknown) => bookStructure(assertBook(book)))

  ipcMain.handle('bible:matchQuote', (_event, text: unknown) =>
    typeof text === 'string' && text.length <= 2000 ? matchQuote(text) : [],
  )
}

const TESTAMENTS: Testament[] = ['all', 'old', 'new']

function assertSearchParams(value: unknown): VerseSearchParams {
  const p = value as Partial<VerseSearchParams> | null
  if (typeof p !== 'object' || p === null || typeof p.query !== 'string' || p.query.length > 500) {
    throw new TypeError('Search needs a query of up to 500 characters')
  }
  if (!Array.isArray(p.versions) || !p.versions.every(isVersionCode)) throw new TypeError('Unknown Bible version')
  if (!TESTAMENTS.includes(p.testament as Testament)) throw new TypeError('Testament must be all, old or new')
  if (p.book !== null && !BOOK_NAMES.includes(p.book as string)) throw new TypeError('Unknown book')
  const whole = (n: unknown, max: number) => (Number.isInteger(n) && (n as number) >= 0 ? Math.min(n as number, max) : 0)
  return {
    query: p.query,
    versions: [...new Set(p.versions)],
    testament: p.testament as Testament,
    book: p.book as string | null,
    offset: whole(p.offset, 100_000),
    limit: Math.max(1, whole(p.limit, 100)),
  }
}
