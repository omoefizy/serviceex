import { ipcMain } from 'electron'
import { normalizeLowerThirdStyle } from '../../shared/lowerThirds'
import { createLowerThird, deleteLowerThird, listLowerThirds, updateLowerThird } from '../db/lowerThirds'

// Arguments arrive from the renderer, so check their shape before they reach the database.

function assertId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new TypeError('Template id must be a positive integer')
  return value as number
}

function assertName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('Template needs a non-empty name')
  return value.trim().slice(0, 100)
}

export function registerLowerThirdIpc(): void {
  ipcMain.handle('lowerThirds:list', () => listLowerThirds())

  ipcMain.handle('lowerThirds:create', (_event, name: unknown, style: unknown) =>
    createLowerThird(assertName(name), normalizeLowerThirdStyle(style)),
  )

  ipcMain.handle('lowerThirds:update', (_event, id: unknown, name: unknown, style: unknown) =>
    updateLowerThird(assertId(id), assertName(name), normalizeLowerThirdStyle(style)),
  )

  ipcMain.handle('lowerThirds:delete', (_event, id: unknown) => deleteLowerThird(assertId(id)))
}
