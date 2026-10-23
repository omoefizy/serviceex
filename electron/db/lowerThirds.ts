import { BUILTIN_LOWER_THIRDS, normalizeLowerThirdStyle } from '../../shared/lowerThirds'
import type { LowerThirdStyle, LowerThirdTemplate } from '../../shared/types'
import { db } from './index'

interface TemplateRow {
  id: number
  name: string
  type: 'builtin' | 'custom'
  json: string
}

function parseStyle(json: string): LowerThirdStyle {
  try {
    return normalizeLowerThirdStyle(JSON.parse(json))
  } catch {
    return normalizeLowerThirdStyle(null)
  }
}

const toTemplate = (row: TemplateRow): LowerThirdTemplate => ({ id: row.id, name: row.name, type: row.type, style: parseStyle(row.json) })

/** Adds the built-in templates, and refreshes them so changes in shared/lowerThirds.ts reach existing installs. */
export const seedBuiltinLowerThirds = db.transaction(() => {
  const find = db.prepare("SELECT id FROM lower_third_templates WHERE type = 'builtin' AND name = ?")
  const insert = db.prepare("INSERT INTO lower_third_templates (name, type, json) VALUES (?, 'builtin', ?)")
  const update = db.prepare('UPDATE lower_third_templates SET json = ? WHERE id = ?')
  for (const { name, style } of BUILTIN_LOWER_THIRDS) {
    const row = find.get(name) as { id: number } | undefined
    if (row) update.run(JSON.stringify(style), row.id)
    else insert.run(name, JSON.stringify(style))
  }
})

/** Built-in templates first, in the order they ship, then custom ones. */
export function listLowerThirds(): LowerThirdTemplate[] {
  return (
    db.prepare("SELECT id, name, type, json FROM lower_third_templates ORDER BY type = 'custom', id").all() as TemplateRow[]
  ).map(toTemplate)
}

export function createLowerThird(name: string, style: LowerThirdStyle): LowerThirdTemplate {
  const json = JSON.stringify(normalizeLowerThirdStyle(style))
  const result = db.prepare("INSERT INTO lower_third_templates (name, type, json) VALUES (?, 'custom', ?)").run(name, json)
  return { id: Number(result.lastInsertRowid), name, type: 'custom', style: parseStyle(json) }
}

/** Custom templates only; returns false for a built-in or missing one. */
export function updateLowerThird(id: number, name: string, style: LowerThirdStyle): boolean {
  return (
    db
      .prepare("UPDATE lower_third_templates SET name = ?, json = ? WHERE id = ? AND type = 'custom'")
      .run(name, JSON.stringify(normalizeLowerThirdStyle(style)), id).changes > 0
  )
}

/** Custom templates only. If it was in use, the setting falls back to the first built-in template on its own. */
export function deleteLowerThird(id: number): boolean {
  return db.prepare("DELETE FROM lower_third_templates WHERE id = ? AND type = 'custom'").run(id).changes > 0
}
