import { ipcMain } from 'electron'
import type {
  AnnouncementPayload,
  PresentationPayload,
  ScripturePayload,
  ServiceItemPayload,
  ServiceItemType,
} from '../../shared/types'
import {
  addItem,
  createService,
  deleteService,
  getService,
  listServices,
  removeItem,
  reorderItems,
} from '../db/services'

// Arguments arrive from the renderer, so check their shape before they reach the database.

const ITEM_TYPES: ServiceItemType[] = ['song', 'scripture', 'announcement', 'presentation']
const MAX_PRESENTATION_PAGES = 500

function assertId(value: unknown, name = 'Id'): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value as number
}

function assertName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('Service needs a non-empty name')
  return value.trim()
}

function assertDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('Service date must be YYYY-MM-DD or null')
  }
  return value
}

function assertTitle(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('Item needs a non-empty title')
  return value.trim()
}

function assertScripture(value: unknown): ScripturePayload {
  const payload = value as Partial<ScripturePayload> | null
  if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.verses) || payload.verses.length === 0) {
    throw new TypeError('Scripture needs a title and at least one verse')
  }
  const verses = payload.verses.map((verse) => {
    if (typeof verse?.text !== 'string' || typeof verse.caption !== 'string') {
      throw new TypeError('Each verse needs text and a caption')
    }
    return { text: verse.text, caption: verse.caption }
  })
  return { title: assertTitle(payload.title), verses }
}

function assertAnnouncement(value: unknown): AnnouncementPayload {
  const payload = value as Partial<AnnouncementPayload> | null
  if (typeof payload !== 'object' || payload === null || typeof payload.body !== 'string') {
    throw new TypeError('Announcement needs a title and body text')
  }
  if (payload.titleSlide !== undefined && typeof payload.titleSlide !== 'boolean') {
    throw new TypeError('titleSlide must be true or false')
  }
  const quote = payload.quote as unknown
  if (quote !== undefined && (typeof quote !== 'object' || quote === null || typeof (quote as { speaker?: unknown }).speaker !== 'string')) {
    throw new TypeError('A quote needs a speaker name (which may be empty)')
  }
  return {
    title: assertTitle(payload.title),
    body: payload.body,
    ...(payload.titleSlide ? { titleSlide: true } : {}),
    ...(payload.quote ? { quote: { speaker: payload.quote.speaker.trim().slice(0, 100) } } : {}),
  }
}

function assertPresentation(value: unknown): PresentationPayload {
  const payload = value as Partial<PresentationPayload> | null
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray(payload.pages) ||
    payload.pages.length === 0 ||
    payload.pages.length > MAX_PRESENTATION_PAGES ||
    !payload.pages.every((page) => typeof page === 'string' && page.startsWith('wd-media://'))
  ) {
    throw new TypeError(`A presentation needs a title and 1 to ${MAX_PRESENTATION_PAGES} page images`)
  }
  // The library presentation it came from, so the item follows saves of the original (and Live PowerPoint finds it).
  const linked = Number.isInteger(payload.presentationId) && (payload.presentationId as number) > 0 ? { presentationId: payload.presentationId } : {}
  return { title: assertTitle(payload.title), pages: payload.pages, ...linked }
}

/** Songs take a song id and no payload; scripture and announcements take a payload and no id. */
function assertItem(
  type: unknown,
  refId: unknown,
  payload: unknown,
): { type: ServiceItemType; refId: number | null; payload: ServiceItemPayload | null } {
  if (!ITEM_TYPES.includes(type as ServiceItemType)) {
    throw new TypeError(`Item type must be one of ${ITEM_TYPES.join(', ')}`)
  }
  if (type === 'song') {
    if (payload !== null && payload !== undefined) throw new TypeError('Song items have no payload')
    return { type, refId: assertId(refId, 'Song id'), payload: null }
  }
  if (refId !== null && refId !== undefined) throw new TypeError(`${type} items have no refId`)
  if (type === 'scripture') return { type, refId: null, payload: assertScripture(payload) }
  if (type === 'presentation') return { type, refId: null, payload: assertPresentation(payload) }
  return { type: 'announcement', refId: null, payload: assertAnnouncement(payload) }
}

export function registerServiceIpc(): void {
  ipcMain.handle('services:create', (_event, name: unknown, date: unknown) =>
    createService(assertName(name), assertDate(date)),
  )

  ipcMain.handle('services:list', () => listServices())

  ipcMain.handle('services:get', (_event, id: unknown) => getService(assertId(id, 'Service id')))

  ipcMain.handle('services:delete', (_event, id: unknown) => deleteService(assertId(id, 'Service id')))

  ipcMain.handle('services:addItem', (_event, serviceId: unknown, type: unknown, refId: unknown, payload: unknown) => {
    const item = assertItem(type, refId, payload)
    return addItem(assertId(serviceId, 'Service id'), item.type, item.refId, item.payload)
  })

  ipcMain.handle('services:removeItem', (_event, itemId: unknown) => removeItem(assertId(itemId, 'Item id')))

  ipcMain.handle('services:reorderItems', (_event, serviceId: unknown, orderedItemIds: unknown) => {
    if (!Array.isArray(orderedItemIds)) throw new TypeError('Item ids must be an array')
    return reorderItems(
      assertId(serviceId, 'Service id'),
      orderedItemIds.map((id) => assertId(id, 'Item id')),
    )
  })
}
