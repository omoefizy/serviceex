import { BUILTIN_DEFAULTS, BUILTIN_THEMES, CATEGORY_OF, isLegacyTheme, normalizeTheme, THEME_CONTENT_TYPES } from '../../shared/themes'
import type { Theme, ThemeCategory, ThemeContentType, ThemeDefaults, ThemeStyle } from '../../shared/types'
import { db } from './index'

interface ThemeRow {
  id: number
  name: string
  type: 'builtin' | 'custom'
  json: string
}

/**
 * A stored theme in the element layout. One saved before the layout editor is migrated as it is read, and only
 * written back in the new form when it is next saved; it is listed under the type it is a default for, else Song.
 */
function parseStyle(json: string, id?: number): ThemeStyle {
  let value: unknown = null
  try {
    value = JSON.parse(json)
  } catch {
    // Falls back to the default theme below.
  }
  return normalizeTheme(value, id !== undefined && isLegacyTheme(value) ? legacyCategory(id) : 'song')
}

function legacyCategory(id: number): ThemeCategory {
  const rows = db.prepare("SELECT key FROM settings WHERE key LIKE 'theme.default.%' AND value = ?").all(String(id)) as { key: string }[]
  const types = rows.map((row) => row.key.slice('theme.default.'.length) as ThemeContentType).filter((type) => type in CATEGORY_OF)
  const type = types.includes('song') ? 'song' : types[0]
  return type ? CATEGORY_OF[type] : 'song'
}

const toTheme = (row: ThemeRow): Theme => ({ id: row.id, name: row.name, type: row.type, style: parseStyle(row.json, row.id) })

/** Adds the built-in themes, and refreshes their styles so changes in shared/themes.ts reach existing installs. */
export const seedBuiltinThemes = db.transaction(() => {
  const find = db.prepare("SELECT id FROM themes WHERE type = 'builtin' AND name = ?")
  const insert = db.prepare("INSERT INTO themes (name, type, json) VALUES (?, 'builtin', ?)")
  const update = db.prepare('UPDATE themes SET json = ? WHERE id = ?')
  for (const { name, style } of BUILTIN_THEMES) {
    const row = find.get(name) as { id: number } | undefined
    if (row) update.run(JSON.stringify(style), row.id)
    else insert.run(name, JSON.stringify(style))
  }
})

export function listThemes(): Theme[] {
  return (db.prepare("SELECT id, name, type, json FROM themes ORDER BY type = 'custom', id").all() as ThemeRow[]).map(
    toTheme,
  )
}

export function createTheme(name: string, style: ThemeStyle): Theme {
  const json = JSON.stringify(normalizeTheme(style))
  const result = db.prepare("INSERT INTO themes (name, type, json) VALUES (?, 'custom', ?)").run(name, json)
  return { id: Number(result.lastInsertRowid), name, type: 'custom', style: parseStyle(json) }
}

/** Custom themes only; returns false for a built-in or missing theme. */
export function updateTheme(id: number, name: string, style: ThemeStyle): boolean {
  return (
    db
      .prepare("UPDATE themes SET name = ?, json = ? WHERE id = ? AND type = 'custom'")
      .run(name, JSON.stringify(normalizeTheme(style)), id).changes > 0
  )
}

/** Custom themes only. Songs using it go back to the song default; defaults using it go back to the built-in ones. */
export const deleteTheme = db.transaction((id: number): boolean => {
  if (db.prepare("DELETE FROM themes WHERE id = ? AND type = 'custom'").run(id).changes === 0) return false
  db.prepare('UPDATE songs SET theme_id = NULL WHERE theme_id = ?').run(id)
  db.prepare("DELETE FROM settings WHERE key LIKE 'theme.default.%' AND value = ?").run(String(id))
  return true
})

const defaultKey = (type: ThemeContentType) => `theme.default.${type}`

export function getThemeDefaults(): ThemeDefaults {
  const exists = db.prepare('SELECT 1 FROM themes WHERE id = ?')
  const builtin = db.prepare("SELECT id FROM themes WHERE type = 'builtin' AND name = ?")
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?')
  const defaults = {} as ThemeDefaults
  for (const type of THEME_CONTENT_TYPES) {
    const chosen = Number((setting.get(defaultKey(type)) as { value: string } | undefined)?.value)
    defaults[type] =
      Number.isInteger(chosen) && exists.get(chosen)
        ? chosen
        : (builtin.get(BUILTIN_DEFAULTS[type]) as { id: number }).id
  }
  return defaults
}

export function setThemeDefault(type: ThemeContentType, themeId: number): void {
  if (!db.prepare('SELECT 1 FROM themes WHERE id = ?').get(themeId)) throw new Error(`Theme ${themeId} does not exist`)
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
    defaultKey(type),
    String(themeId),
  )
}
