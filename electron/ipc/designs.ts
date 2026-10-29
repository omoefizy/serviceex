import { ipcMain } from 'electron'
import { normalizeDesign } from '../../shared/designs'
import { createDesign, deleteDesign, listDesigns, updateDesign } from '../db/designs'

// Arguments arrive from the renderer, so check their shape before they reach the database.

function assertId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new TypeError('Design id must be a positive integer')
  return value as number
}

function assertName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('Design needs a non-empty name')
  return value.trim().slice(0, 100)
}

export function registerDesignIpc(): void {
  ipcMain.handle('designs:list', () => listDesigns())

  ipcMain.handle('designs:create', (_event, name: unknown, style: unknown) => createDesign(assertName(name), normalizeDesign(style)))

  ipcMain.handle('designs:update', (_event, id: unknown, name: unknown, style: unknown) => updateDesign(assertId(id), assertName(name), normalizeDesign(style)))

  ipcMain.handle('designs:delete', (_event, id: unknown) => deleteDesign(assertId(id)))
}
