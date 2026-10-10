import { BrowserWindow, dialog, ipcMain } from 'electron'
import { normalizeTheme, THEME_CONTENT_TYPES } from '../../shared/themes'
import type { ThemeContentType } from '../../shared/types'
import {
  createTheme,
  deleteTheme,
  getThemeDefaults,
  listThemes,
  setThemeDefault,
  updateTheme,
} from '../db/themes'
import { importMedia } from '../media'

// Arguments arrive from the renderer, so check their shape before they reach the database.

const MEDIA_FILTERS = {
  image: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
  video: [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'm4v'] }],
}

function assertId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new TypeError('Theme id must be a positive integer')
  return value as number
}

function assertName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('Theme needs a non-empty name')
  return value.trim()
}

function assertContentType(value: unknown): ThemeContentType {
  if (!THEME_CONTENT_TYPES.includes(value as ThemeContentType)) {
    throw new TypeError(`Content type must be one of ${THEME_CONTENT_TYPES.join(', ')}`)
  }
  return value as ThemeContentType
}

export function registerThemeIpc(): void {
  ipcMain.handle('themes:list', () => listThemes())

  ipcMain.handle('themes:create', (_event, name: unknown, style: unknown) =>
    createTheme(assertName(name), normalizeTheme(style)),
  )

  ipcMain.handle('themes:update', (_event, id: unknown, name: unknown, style: unknown) =>
    updateTheme(assertId(id), assertName(name), normalizeTheme(style)),
  )

  ipcMain.handle('themes:delete', (_event, id: unknown) => deleteTheme(assertId(id)))

  ipcMain.handle('themes:getDefaults', () => getThemeDefaults())

  ipcMain.handle('themes:setDefault', (_event, type: unknown, id: unknown) =>
    setThemeDefault(assertContentType(type), assertId(id)),
  )

  ipcMain.handle('themes:pickMedia', async (event, kind: unknown) => {
    if (kind !== 'image' && kind !== 'video') throw new TypeError('Media kind must be image or video')
    const options: Electron.OpenDialogOptions = {
      title: kind === 'image' ? 'Choose a background image' : 'Choose a background video',
      properties: ['openFile'],
      filters: MEDIA_FILTERS[kind],
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return canceled || filePaths.length === 0 ? null : importMedia(filePaths[0])
  })
}
