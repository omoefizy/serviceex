import { BUILTIN_DESIGNS, normalizeDesign } from '../../shared/designs'
import type { Design, DesignStyle } from '../../shared/types'
import { db } from './index'

interface DesignRow {
  id: number
  name: string
  type: 'builtin' | 'custom'
  json: string
}

function parseStyle(json: string): DesignStyle {
  try {
    return normalizeDesign(JSON.parse(json))
  } catch {
    return normalizeDesign(null)
  }
}

const toDesign = (row: DesignRow): Design => ({ id: row.id, name: row.name, type: row.type, style: parseStyle(row.json) })

/** Adds the built-in designs, and refreshes them so changes in shared/designs.ts reach existing installs. */
export const seedBuiltinDesigns = db.transaction(() => {
  const find = db.prepare("SELECT id FROM designs WHERE type = 'builtin' AND name = ?")
  const insert = db.prepare("INSERT INTO designs (name, type, json) VALUES (?, 'builtin', ?)")
  const update = db.prepare('UPDATE designs SET json = ? WHERE id = ?')
  for (const { name, style } of BUILTIN_DESIGNS) {
    const row = find.get(name) as { id: number } | undefined
    if (row) update.run(JSON.stringify(style), row.id)
    else insert.run(name, JSON.stringify(style))
  }
})

/** Built-in designs first, in the order they ship, then custom ones. */
export function listDesigns(): Design[] {
  return (db.prepare("SELECT id, name, type, json FROM designs ORDER BY type = 'custom', id").all() as DesignRow[]).map(toDesign)
}

export function createDesign(name: string, style: DesignStyle): Design {
  const json = JSON.stringify(normalizeDesign(style))
  const result = db.prepare("INSERT INTO designs (name, type, json) VALUES (?, 'custom', ?)").run(name, json)
  return { id: Number(result.lastInsertRowid), name, type: 'custom', style: parseStyle(json) }
}

/** Custom designs only; returns false for a built-in or missing one. */
export function updateDesign(id: number, name: string, style: DesignStyle): boolean {
  return db.prepare("UPDATE designs SET name = ?, json = ? WHERE id = ? AND type = 'custom'").run(name, JSON.stringify(normalizeDesign(style)), id).changes > 0
}

/** Custom designs only. */
export function deleteDesign(id: number): boolean {
  return db.prepare("DELETE FROM designs WHERE id = ? AND type = 'custom'").run(id).changes > 0
}
