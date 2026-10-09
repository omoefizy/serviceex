import { ipcMain } from 'electron'
import type { BibleVersionCode } from '../../shared/types'
import { getRange, getVerse, listBooks, searchText } from '../db/bible'

// Arguments arrive from the renderer, so check their shape before they reach the database.

const VERSIONS: BibleVersionCode[] = ['KJV', 'WEB']

function assertVersion(value: unknown): BibleVersionCode {
  if (!VERSIONS.includes(value as BibleVersionCode)) {
    throw new TypeError(`Bible version must be one of ${VERSIONS.join(', ')}`)
  }
  return value as BibleVersionCode
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
}
