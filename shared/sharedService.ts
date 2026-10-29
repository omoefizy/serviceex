// The shared service: a document of items that paired computers edit together. Each item carries a logical
// (Lamport) clock and the device that last changed it, and the newer change wins per item. A logical clock rather
// than wall time means a computer whose clock is wrong cannot win or lose by it. Deleting sets a flag instead of
// removing the item, so a delete made offline still reaches everyone. Nothing here touches Electron or the DOM.

import { sanitizeScriptureGroup, sanitizeScriptureSlide } from './scriptureGroup'
import type { ItemFilter, SharedItem, SharedItemType, SharedPayload } from './types'

const ID = /^[0-9a-f]{32}$/
const TYPES: SharedItemType[] = ['song', 'scripture', 'announcement', 'presentation', 'note']
/** The most items one shared service holds. */
export const MAX_SHARED_ITEMS = 500
const MAX_TEXT = 100_000

/** A Lamport clock: ticks for each local change, and jumps past every stamp it sees. */
export class LamportClock {
  private value: number

  constructor(start = 0) {
    this.value = Number.isSafeInteger(start) && start > 0 ? start : 0
  }

  get now(): number {
    return this.value
  }

  tick(): number {
    this.value += 1
    return this.value
  }

  observe(stamp: number): void {
    if (Number.isSafeInteger(stamp) && stamp > this.value) this.value = stamp
  }
}

/** Positive when `a` is the newer change. Ties on the clock go to the larger device id, the same on every computer. */
export function compareStamps(a: Pick<SharedItem, 'updatedAt' | 'updatedBy'>, b: Pick<SharedItem, 'updatedAt' | 'updatedBy'>): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt
  return a.updatedBy < b.updatedBy ? -1 : a.updatedBy > b.updatedBy ? 1 : 0
}

/**
 * Merges incoming items into a list: for each id the newer change wins, last write wins. Returns the merged list
 * and the incoming items that won (the ones that changed something here).
 */
export function mergeItems(items: readonly SharedItem[], incoming: readonly SharedItem[]): { items: SharedItem[]; changed: SharedItem[] } {
  const byId = new Map(items.map((item) => [item.id, item]))
  const changed: SharedItem[] = []
  for (const item of incoming) {
    const current = byId.get(item.id)
    if (current && compareStamps(item, current) <= 0) continue
    if (!current && byId.size >= MAX_SHARED_ITEMS) continue
    byId.set(item.id, item)
    changed.push(item)
  }
  return { items: [...byId.values()], changed }
}

/** A local change to one item, stamped with the next clock value and this device. */
export function editItem(item: SharedItem, patch: Partial<Pick<SharedItem, 'payload' | 'order' | 'ownerDevice' | 'deleted'>>, clock: LamportClock, deviceId: string): SharedItem {
  return { ...item, ...patch, updatedAt: clock.tick(), updatedBy: deviceId }
}

export function newItem(
  id: string,
  type: SharedItemType,
  payload: SharedPayload,
  order: number,
  clock: LamportClock,
  deviceId: string,
  ownerDevice: string | null = null,
): SharedItem {
  return { id, type, payload, order, updatedAt: clock.tick(), updatedBy: deviceId, ownerDevice, deleted: false }
}

/** An order between two neighbours, for a drop between them; either may be missing at the ends. */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1
  if (before === undefined) return (after as number) - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

/** The items to list, in run order: deleted ones left out, then the filter applied. */
export function visibleItems(items: readonly SharedItem[], filter: ItemFilter, myId: string): SharedItem[] {
  return items
    .filter((item) => !item.deleted)
    .filter((item) => (filter.kind === 'all' ? true : filter.kind === 'mine' ? item.ownerDevice === myId : item.ownerDevice === filter.deviceId))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
}

// ---------- Checking items from the network ----------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max = MAX_TEXT) => (typeof value === 'string' ? value.slice(0, max) : '')
const strings = (value: unknown, limit: number, max = 2000) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, limit).map((v) => v.slice(0, max)) : [])

/** The payload of a type with only the fields it uses, checked. Formatting is left behind; the theme's look applies. */
export function cleanPayload(type: SharedItemType, value: unknown): SharedPayload | null {
  if (!isObject(value)) return null
  const title = text(value.title, 300).trim()
  if (!title) return null
  switch (type) {
    case 'song': {
      const arrangement = isObject(value.arrangement) ? value.arrangement : {}
      const lines = arrangement.linesPerSlide
      return {
        title,
        author: typeof value.author === 'string' ? value.author.slice(0, 300) : null,
        copyright: typeof value.copyright === 'string' ? value.copyright.slice(0, 500) : null,
        lyrics: text(value.lyrics),
        arrangement: { order: strings(arrangement.order, 200, 100), linesPerSlide: lines === 2 || lines === 3 || lines === 4 ? lines : null },
      }
    }
    case 'scripture': {
      // Parts, edits and a Scripture group's second column travel too; a group arrives ready to edit again.
      const group = sanitizeScriptureGroup(value.group)
      return {
        title,
        verses: (Array.isArray(value.verses) ? value.verses : [])
          .filter(isObject)
          .slice(0, 500)
          .map((verse) => sanitizeScriptureSlide({ ...verse, text: text(verse.text, 5000), caption: text(verse.caption, 300) }, 5000)!),
        ...(group ? { group } : {}),
      }
    }
    case 'announcement':
      return {
        title,
        body: text(value.body),
        ...(value.titleSlide === true ? { titleSlide: true } : {}),
        ...(isObject(value.quote) ? { quote: { speaker: text(value.quote.speaker, 200) } } : {}),
      }
    case 'presentation':
      // Pages are files on the computer that added it; another computer shows the title only.
      return { title, pages: strings(value.pages, 1000).filter((page) => page.startsWith('wd-media://')) }
    case 'note':
      return { title, text: text(value.text) }
  }
}

/** An item received from another computer, checked field by field; null when it is unusable. */
export function cleanSharedItem(value: unknown): SharedItem | null {
  if (!isObject(value)) return null
  const { id, type, order, updatedAt, updatedBy, ownerDevice } = value
  if (typeof id !== 'string' || !ID.test(id) || !TYPES.includes(type as SharedItemType)) return null
  if (typeof order !== 'number' || !Number.isFinite(order)) return null
  if (!Number.isSafeInteger(updatedAt) || (updatedAt as number) < 0 || typeof updatedBy !== 'string' || !ID.test(updatedBy)) return null
  const payload = cleanPayload(type as SharedItemType, value.payload)
  if (!payload) return null
  return {
    id,
    type: type as SharedItemType,
    payload,
    order,
    updatedAt: updatedAt as number,
    updatedBy,
    ownerDevice: typeof ownerDevice === 'string' && ID.test(ownerDevice) ? ownerDevice : null,
    deleted: value.deleted === true,
  }
}

export const cleanSharedItems = (value: unknown): SharedItem[] =>
  (Array.isArray(value) ? value.slice(0, MAX_SHARED_ITEMS) : []).map(cleanSharedItem).filter((item): item is SharedItem => item !== null)
