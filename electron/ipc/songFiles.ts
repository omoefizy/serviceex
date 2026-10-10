import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import type { ExportFormat, ExportResult } from '../../shared/types'
import { createSongs } from '../db/songs'
import {
  EXPORT_EXTENSIONS,
  scanSongFiles,
  songsForExport,
  suggestedFileName,
  writeSongFile,
  writeSongFolder,
} from '../songFiles/files'
import { assertSongInput } from './songs'

// Arguments arrive from the renderer, so check their shape before they reach the disk or the database.

const EXPORT_FORMATS: ExportFormat[] = ['openlyrics', 'text']

const IMPORT_FILTERS = [
  { name: 'Songs (text, OpenLyrics, OpenSong)', extensions: ['txt', 'xml'] },
  // OpenSong song files usually have no extension.
  { name: 'All files', extensions: ['*'] },
]

function windowOf(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined
}

function assertPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((p) => typeof p === 'string' && path.isAbsolute(p))) {
    throw new TypeError('Paths must be a non-empty list of absolute paths')
  }
  return value
}

function assertSongIds(value: unknown): number[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || !value.every((id) => Number.isInteger(id) && id > 0)) {
    throw new TypeError('Song ids must be a list of positive integers, or null for every song')
  }
  return value
}

function assertFormat(value: unknown): ExportFormat {
  if (!EXPORT_FORMATS.includes(value as ExportFormat)) {
    throw new TypeError(`Export format must be one of ${EXPORT_FORMATS.join(', ')}`)
  }
  return value as ExportFormat
}

export function registerSongFileIpc(): void {
  ipcMain.handle('songFiles:pickFiles', async (event) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Import songs',
      properties: ['openFile', 'multiSelections'],
      filters: IMPORT_FILTERS,
    }
    const win = windowOf(event)
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return canceled || filePaths.length === 0 ? null : scanSongFiles(filePaths)
  })

  ipcMain.handle('songFiles:pickFolder', async (event) => {
    const options: Electron.OpenDialogOptions = { title: 'Import a folder of songs', properties: ['openDirectory'] }
    const win = windowOf(event)
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return canceled || filePaths.length === 0 ? null : scanSongFiles(filePaths)
  })

  ipcMain.handle('songFiles:scan', (_event, paths: unknown) => scanSongFiles(assertPaths(paths)))

  ipcMain.handle('songFiles:import', (_event, songs: unknown) => {
    if (!Array.isArray(songs)) throw new TypeError('Songs must be a list')
    return createSongs(songs.map(assertSongInput))
  })

  ipcMain.handle(
    'songFiles:export',
    async (event, songIds: unknown, format: unknown): Promise<ExportResult | null> => {
      const ids = assertSongIds(songIds)
      const fileFormat = assertFormat(format)
      const songs = songsForExport(ids)
      if (songs.length === 0) throw new Error('There are no songs to export')
      const win = windowOf(event)

      // One song goes to a file of the user's choosing; several go into a folder, one file each.
      if (songs.length === 1 && ids !== null) {
        const options: Electron.SaveDialogOptions = {
          title: 'Export song',
          defaultPath: suggestedFileName(songs[0], fileFormat),
          filters: [{ name: fileFormat === 'openlyrics' ? 'OpenLyrics XML' : 'Text', extensions: [EXPORT_EXTENSIONS[fileFormat].slice(1)] }],
        }
        const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        if (canceled || !filePath) return null
        await writeSongFile(songs[0], fileFormat, filePath)
        return { written: 1, location: filePath }
      }

      const options: Electron.OpenDialogOptions = {
        title: `Choose a folder for ${songs.length} songs`,
        buttonLabel: 'Export here',
        properties: ['openDirectory', 'createDirectory'],
      }
      const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (canceled || filePaths.length === 0) return null
      return { written: await writeSongFolder(songs, fileFormat, filePaths[0]), location: filePaths[0] }
    },
  )
}
