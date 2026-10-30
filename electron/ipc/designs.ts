import { ipcMain } from 'electron'
import { normalizeDesign } from '../../shared/designs'
import { createDesign, deleteDesign, listDesigns, updateDesign } from '../db/designs'
import { mediaUrl, writeMedia } from '../media'

// Arguments arrive from the renderer, so check their shape before they reach the database.

function assertId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new TypeError('Design id must be a positive integer')
  return value as number
}

/** The picture types an import may store, by the extension they are saved with. */
const ASSET_TYPES = new Set(['png', 'jpg', 'webp', 'gif', 'svg'])
/** A picture larger than this is not a lower third's. */
const MAX_ASSET_BYTES = 30 * 1024 * 1024

function assertAsset(bytes: unknown, extension: unknown): { bytes: Uint8Array; extension: string } {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) throw new TypeError('Picture must be up to 30 MB of bytes')
  if (typeof extension !== 'string' || !ASSET_TYPES.has(extension)) throw new TypeError('Picture must be PNG, JPEG, WebP, GIF or SVG')
  return { bytes, extension }
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

  ipcMain.handle('designs:saveAsset', async (_event, bytes: unknown, extension: unknown) => {
    const asset = assertAsset(bytes, extension)
    return mediaUrl(await writeMedia(asset.bytes, 'design', `.${asset.extension}`))
  })
}
