import { BrowserWindow, dialog, ipcMain } from 'electron'
import { requireFeature } from '../../shared/features'
import { FONT_EXTENSIONS, importFontFiles, listImportedFonts, removeFontFiles } from '../fonts'

/** Every window draws slides, so each loads the fonts again. */
export function announceFontsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('fonts:changed')
}

export function registerFontIpc(): void {
  ipcMain.handle('fonts:list', () => listImportedFonts())

  ipcMain.handle('fonts:import', async (event) => {
    requireFeature('fonts.import')
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Import fonts',
      message: 'Only import fonts your church is licensed to use.',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts (TTF, OTF, WOFF, WOFF2)', extensions: FONT_EXTENSIONS }],
    }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return { fonts: [], skipped: [] }
    const result = await importFontFiles(filePaths)
    if (result.fonts.length > 0) announceFontsChanged()
    return result
  })

  // Files dropped on a font picker, by their paths on disk.
  ipcMain.handle('fonts:importFiles', async (_event, paths: unknown) => {
    requireFeature('fonts.import')
    const files = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && p.length > 0).slice(0, 200) : []
    const result = await importFontFiles(files)
    if (result.fonts.length > 0) announceFontsChanged()
    return result
  })

  ipcMain.handle('fonts:remove', async (_event, names: unknown) => {
    const files = Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : []
    await removeFontFiles(files)
    announceFontsChanged()
  })
}
