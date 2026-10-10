import { BrowserWindow, dialog, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import type { AppSettings, DisplayInfo } from '../../shared/types'
import { backupNow } from '../backup'
import { getAppSettings, setAppSettings } from '../db/settings'
import { copyIntoMedia, mediaUrl } from '../media'

async function openDialog(event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return canceled || filePaths.length === 0 ? null : filePaths[0]
}

/** `onChange` hears every saved change, so the main process can act on it (moving the output window, say). */
export function registerSettingsIpc(onChange: (before: AppSettings, after: AppSettings) => void): void {
  const save = (patch: Partial<AppSettings>) => {
    const before = getAppSettings()
    const after = setAppSettings(patch)
    onChange(before, after)
    return after
  }

  ipcMain.handle('settings:get', () => getAppSettings())

  ipcMain.handle('settings:set', (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) throw new TypeError('Settings must be an object')
    // Invalid fields are dropped by setAppSettings; the main process alone records backups.
    const rest: Partial<AppSettings> = { ...(patch as Partial<AppSettings>) }
    delete rest.lastBackupAt
    return save(rest)
  })

  ipcMain.handle('settings:listDisplays', (): DisplayInfo[] => {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.label || `Display ${index + 1}`,
      width: display.size.width,
      height: display.size.height,
      primary: display.id === primaryId,
    }))
  })

  ipcMain.handle('settings:pickBackupFolder', async (event) => {
    const folder = await openDialog(event, {
      title: 'Choose a backup folder',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    return folder ? save({ backupFolder: path.resolve(folder) }) : null
  })

  ipcMain.handle('settings:pickLogo', async (event) => {
    const file = await openDialog(event, {
      title: 'Choose a logo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    })
    return file ? save({ logoUrl: mediaUrl(await copyIntoMedia(file)) }) : null
  })

  ipcMain.handle('settings:backupNow', () => backupNow())
}
