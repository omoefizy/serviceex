import type { PresentationKind, PresentationPayload } from '../../shared/types'
import type { PresentationRecord, PresentationStore, SlideMeta } from '../presentations/library'
import { db } from './index'

interface PresentationRow {
  id: number
  title: string
  kind: PresentationKind
  source_path: string
  hash: string
  engine: string
  slides: string
  updated_at: string
}

function toRecord(row: PresentationRow): PresentationRecord {
  let slides: unknown = []
  try {
    slides = JSON.parse(row.slides)
  } catch {
    // Treat unreadable slides as none.
  }
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    sourcePath: row.source_path,
    hash: row.hash,
    engine: row.engine,
    slides: Array.isArray(slides) ? (slides as SlideMeta[]) : [],
    updatedAt: row.updated_at,
  }
}

const SELECT = 'SELECT id, title, kind, source_path, hash, engine, slides, updated_at FROM presentations'

export const presentationStore: PresentationStore = {
  /** Newest first. */
  list: () => (db.prepare(`${SELECT} ORDER BY id DESC`).all() as PresentationRow[]).map(toRecord),

  get(id) {
    const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as PresentationRow | undefined
    return row && toRecord(row)
  },

  insert(record) {
    const result = db
      .prepare('INSERT INTO presentations (title, kind, source_path, hash, engine, slides) VALUES (?, ?, ?, ?, ?, ?)')
      .run(record.title, record.kind, record.sourcePath, record.hash, record.engine, JSON.stringify(record.slides))
    return presentationStore.get(Number(result.lastInsertRowid)) as PresentationRecord
  },

  update(id, patch) {
    db.prepare("UPDATE presentations SET hash = ?, engine = ?, slides = ?, updated_at = datetime('now') WHERE id = ?").run(
      patch.hash,
      patch.engine,
      JSON.stringify(patch.slides),
      id,
    )
    return presentationStore.get(id) as PresentationRecord
  },

  delete: (id) => db.prepare('DELETE FROM presentations WHERE id = ?').run(id).changes > 0,
}

/** Gives schedule items made from a presentation its new pages. Returns the ids of the services changed. */
export const setLinkedPages = db.transaction((presentationId: number, pages: string[]): number[] => {
  const rows = db.prepare("SELECT id, service_id, payload FROM service_items WHERE type = 'presentation'").all() as {
    id: number
    service_id: number
    payload: string | null
  }[]
  const update = db.prepare('UPDATE service_items SET payload = ? WHERE id = ?')
  const services = new Set<number>()
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload ?? '{}') as PresentationPayload
      if (payload.presentationId !== presentationId) continue
      update.run(JSON.stringify({ ...payload, pages }), row.id)
      services.add(row.service_id)
    } catch {
      // An unreadable item cannot be linked to it either.
    }
  }
  return [...services]
})

/** Whether a schedule item still shows pictures from this cache folder. */
export function scheduleUsesHash(hash: string): boolean {
  return !!db.prepare("SELECT 1 FROM service_items WHERE type = 'presentation' AND instr(payload, ?) > 0").get(`/${hash}/`)
}
