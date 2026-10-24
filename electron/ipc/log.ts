import { app, ipcMain } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { PanelErrorReport } from '../../shared/types'

const MAX_FIELD = 20_000

const field = (value: unknown, fallback = '') => (typeof value === 'string' ? value.slice(0, MAX_FIELD) : fallback)

/** Panel errors caught by the renderer's error boundaries go to logs/panel-errors.log in the app data folder. */
export function registerLogIpc(): void {
  ipcMain.handle('log:panelError', async (_event, value: unknown) => {
    const report = (typeof value === 'object' && value !== null ? value : {}) as Partial<PanelErrorReport>
    const dir = path.join(app.getPath('userData'), 'logs')
    const entry = [
      `[${new Date().toISOString()}] Panel "${field(report.panel, 'unknown')}" had a problem: ${field(report.message)}`,
      field(report.stack),
      field(report.componentStack) && `Component stack:${field(report.componentStack)}`,
    ]
      .filter(Boolean)
      .join('\n')
    await mkdir(dir, { recursive: true })
    await appendFile(path.join(dir, 'panel-errors.log'), `${entry}\n\n`, 'utf8')
    console.error(entry)
  })
}
