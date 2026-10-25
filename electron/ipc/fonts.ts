import { BrowserWindow, dialog, ipcMain } from 'electron'
import { FONT_EXTENSIONS, importFontFiles, listImportedFonts } from '../fonts'

export function registerFontIpc(): void {
  ipcMain.handle('fonts:list', () => listImportedFonts())

  ipcMain.handle('fonts:import', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Import fonts',
      message: 'Only import fonts your church is licensed to use.',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts (TTF, OTF, WOFF2)', extensions: FONT_EXTENSIONS }],
    }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return { fonts: [], skipped: [] }
    const result = await importFontFiles(filePaths)
    // Every window draws slides, so each loads the new fonts.
    if (result.fonts.length > 0) for (const other of BrowserWindow.getAllWindows()) other.webContents.send('fonts:changed')
    return result
  })
}
