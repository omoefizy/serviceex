import type { NativeSlide, PresentationKind, PresentationMode, PresentationPayload } from '../../shared/types'
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
  live_powerpoint: number
  use_timings: number
  mode: string
  linked: number
  native: string | null
}

function parseJson(value: string | null): unknown {
  if (value === null) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function toRecord(row: PresentationRow): PresentationRecord {
  // Unreadable slides count as none.
  const slides = parseJson(row.slides)
  const native = parseJson(row.native)
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    sourcePath: row.source_path,
    hash: row.hash,
    engine: row.engine,
    slides: Array.isArray(slides) ? (slides as SlideMeta[]) : [],
    updatedAt: row.updated_at,
    livePowerPoint: row.live_powerpoint !== 0,
    useTimings: row.use_timings !== 0,
    mode: (row.mode === 'native' ? 'native' : 'image') as PresentationMode,
    linked: row.linked !== 0,
    native: Array.isArray(native) ? (native as NativeSlide[]) : null,
  }
}

const SELECT = 'SELECT id, title, kind, source_path, hash, engine, slides, updated_at, live_powerpoint, use_timings, mode, linked, native FROM presentations'
const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value))

export const presentationStore: PresentationStore = {
  /** Newest first. */
  list: () => (db.prepare(`${SELECT} ORDER BY id DESC`).all() as PresentationRow[]).map(toRecord),

  get(id) {
    const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as PresentationRow | undefined
    return row && toRecord(row)
  },

  insert(record) {
    const result = db
      .prepare('INSERT INTO presentations (title, kind, source_path, hash, engine, slides, mode, linked, native) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        record.title,
        record.kind,
        record.sourcePath,
        record.hash,
        record.engine,
        JSON.stringify(record.slides),
        record.mode ?? 'image',
        record.linked === false ? 0 : 1,
        json(record.native),
      )
    return presentationStore.get(Number(result.lastInsertRowid)) as PresentationRecord
  },

  /** Changes the fields given; a new render (hash) also updates the time. */
  update(id, patch) {
    const columns: [string, unknown][] = []
    if (patch.hash !== undefined) columns.push(['hash', patch.hash], ['updated_at', null])
    if (patch.engine !== undefined) columns.push(['engine', patch.engine])
    if (patch.slides !== undefined) columns.push(['slides', JSON.stringify(patch.slides)])
    if (patch.mode !== undefined) columns.push(['mode', patch.mode])
    if (patch.linked !== undefined) columns.push(['linked', patch.linked ? 1 : 0])
    if (patch.native !== undefined) columns.push(['native', json(patch.native)])
    if (columns.length > 0) {
      const sets = columns.map(([column]) => (column === 'updated_at' ? "updated_at = datetime('now')" : `${column} = ?`))
      const values = columns.filter(([column]) => column !== 'updated_at').map(([, value]) => value)
      db.prepare(`UPDATE presentations SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    }
    return presentationStore.get(id) as PresentationRecord
  },

  delete: (id) => db.prepare('DELETE FROM presentations WHERE id = ?').run(id).changes > 0,
}

/** Saves a presentation's Live PowerPoint options; fields left out keep their value. */
export function setLiveOptions(id: number, options: { livePowerPoint?: boolean; useTimings?: boolean }): PresentationRecord | undefined {
  const flag = (value: boolean | undefined) => (value === undefined ? null : value ? 1 : 0)
  db.prepare('UPDATE presentations SET live_powerpoint = coalesce(?, live_powerpoint), use_timings = coalesce(?, use_timings) WHERE id = ?').run(
    flag(options.livePowerPoint),
    flag(options.useTimings),
    id,
  )
  return presentationStore.get(id)
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
