import type {
  AnnouncementPayload,
  ScripturePayload,
  Service,
  ServiceItem,
  ServiceItemPayload,
  ServiceItemType,
  ServiceWithItems,
} from '../../shared/types'
import { db } from './index'

interface ItemRow {
  id: number
  service_id: number
  type: ServiceItemType
  ref_id: number | null
  order_index: number
  payload: string | null
  song_title: string | null
}

const SELECT_ITEMS = `
  SELECT i.id, i.service_id, i.type, i.ref_id, i.order_index, i.payload, s.title AS song_title
  FROM service_items i
  LEFT JOIN songs s ON i.type = 'song' AND s.id = i.ref_id`

function toItem(row: ItemRow): ServiceItem {
  const fields = { id: row.id, service_id: row.service_id, order: row.order_index }
  if (row.type === 'song') {
    // The song may have been deleted since it was scheduled.
    return { ...fields, type: 'song', ref_id: row.ref_id as number, payload: null, title: row.song_title ?? 'Missing song' }
  }
  if (row.type === 'scripture') {
    const payload = JSON.parse(row.payload ?? '{}') as ScripturePayload
    return { ...fields, type: 'scripture', ref_id: null, payload, title: payload.title }
  }
  const payload = JSON.parse(row.payload ?? '{}') as AnnouncementPayload
  return { ...fields, type: 'announcement', ref_id: null, payload, title: payload.title }
}

function getItem(id: number): ServiceItem | undefined {
  const row = db.prepare(`${SELECT_ITEMS} WHERE i.id = ?`).get(id) as ItemRow | undefined
  return row && toItem(row)
}

export function createService(name: string, date: string | null): Service {
  const result = db.prepare('INSERT INTO services (name, date) VALUES (?, ?)').run(name, date)
  return { id: Number(result.lastInsertRowid), name, date }
}

/** Newest date first; undated services last, newest first. */
export function listServices(): Service[] {
  return db
    .prepare('SELECT id, name, date FROM services ORDER BY date IS NULL, date DESC, id DESC')
    .all() as Service[]
}

export function getService(id: number): ServiceWithItems | undefined {
  const service = db.prepare('SELECT id, name, date FROM services WHERE id = ?').get(id) as Service | undefined
  if (!service) return undefined
  const rows = db.prepare(`${SELECT_ITEMS} WHERE i.service_id = ? ORDER BY i.order_index, i.id`).all(id) as ItemRow[]
  return { ...service, items: rows.map(toItem) }
}

/** Deletes a service; its items go with it via ON DELETE CASCADE. Returns false if not found. */
export function deleteService(id: number): boolean {
  return db.prepare('DELETE FROM services WHERE id = ?').run(id).changes > 0
}

/**
 * Appends an item to the end of a service. Songs are stored by id; scripture and announcements
 * store their content as JSON in `payload`. Callers check that `refId` and `payload` suit `type`.
 */
export const addItem = db.transaction(
  (serviceId: number, type: ServiceItemType, refId: number | null, payload: ServiceItemPayload | null): ServiceItem => {
    if (!db.prepare('SELECT 1 FROM services WHERE id = ?').get(serviceId)) {
      throw new Error(`Service ${serviceId} does not exist`)
    }
    if (type === 'song' && !db.prepare('SELECT 1 FROM songs WHERE id = ?').get(refId)) {
      throw new Error(`Song ${refId} does not exist`)
    }
    const { next } = db
      .prepare('SELECT COALESCE(MAX(order_index) + 1, 0) AS next FROM service_items WHERE service_id = ?')
      .get(serviceId) as { next: number }
    const result = db
      .prepare('INSERT INTO service_items (service_id, type, ref_id, order_index, payload) VALUES (?, ?, ?, ?, ?)')
      .run(serviceId, type, refId, next, payload === null ? null : JSON.stringify(payload))
    return getItem(Number(result.lastInsertRowid)) as ServiceItem
  },
)

export function removeItem(itemId: number): boolean {
  return db.prepare('DELETE FROM service_items WHERE id = ?').run(itemId).changes > 0
}

/** Puts a service's items in the given order. Returns false unless the ids are exactly that service's items. */
export const reorderItems = db.transaction((serviceId: number, orderedItemIds: number[]): boolean => {
  const current = new Set(
    (db.prepare('SELECT id FROM service_items WHERE service_id = ?').all(serviceId) as { id: number }[]).map(
      (row) => row.id,
    ),
  )
  const requested = new Set(orderedItemIds)
  if (
    requested.size !== orderedItemIds.length ||
    requested.size !== current.size ||
    orderedItemIds.some((id) => !current.has(id))
  ) {
    return false
  }

  const update = db.prepare('UPDATE service_items SET order_index = ? WHERE id = ?')
  orderedItemIds.forEach((id, index) => update.run(index, id))
  return true
})
