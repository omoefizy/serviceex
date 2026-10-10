import { ipcMain } from 'electron'
import { getAppSettings, setAppSettings } from '../db/settings'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => getAppSettings())

  ipcMain.handle('settings:set', (_event, settings: unknown) => {
    const fadeMs = (settings as { fadeMs?: unknown } | null)?.fadeMs
    if (fadeMs !== undefined && (typeof fadeMs !== 'number' || !Number.isFinite(fadeMs))) {
      throw new TypeError('fadeMs must be a number of milliseconds')
    }
    return setAppSettings({ fadeMs: fadeMs as number | undefined })
  })
}
