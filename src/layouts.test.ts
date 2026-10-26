// Layouts: the presets every install starts with, saving and loading through the settings store the main process
// uses (a throwaway database), and creating, renaming, duplicating and deleting them.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanLayouts, createLayout, deleteLayout, duplicateLayout, layoutById, PRESET_LAYOUTS, renameLayout, updateLayout } from '../shared/layouts'
import type { Layout } from '../shared/types'

vi.mock('../electron/db/index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { initSchema } = await import('../electron/db/schema')
  const db = new Database(':memory:')
  initSchema(db)
  return { db }
})

const { db } = await import('../electron/db/index')
const { getAppSettings, setAppSettings } = await import('../electron/db/settings')

beforeEach(() => {
  db.exec('DELETE FROM settings')
})

describe('layouts', () => {
  it('start with the presets, none tied to a computer', () => {
    const settings = getAppSettings()
    expect(settings.layouts.map((l) => l.name)).toEqual(['Full', 'Songs only', 'Scripture only', 'Points only', 'Minimal'])
    expect(settings.activeLayoutId).toBe('full')
    expect(layoutById(settings.layouts, settings.activeLayoutId).panels).toContain('schedule')
  })

  it('save and load, with their panels and defaults', () => {
    let layouts: Layout[] = getAppSettings().layouts
    const created = createLayout(layouts, 'Lyrics desk')
    layouts = updateLayout(created.layouts, created.layout.id, {
      panels: ['songs', 'slides', 'live'],
      itemFilter: 'mine',
      themeDefaults: { song: 3 },
      outputBackground: 'logo',
    })
    layouts = renameLayout(layouts, created.layout.id, 'Lyrics booth')
    const copy = duplicateLayout(layouts, created.layout.id)
    layouts = deleteLayout(copy.layouts, 'minimal')
    setAppSettings({ layouts, activeLayoutId: created.layout.id })

    const loaded = getAppSettings()
    expect(loaded.layouts).toEqual(layouts)
    expect(loaded.activeLayoutId).toBe(created.layout.id)
    const mine = layoutById(loaded.layouts, loaded.activeLayoutId)
    expect(mine).toEqual({ id: created.layout.id, name: 'Lyrics booth', panels: ['songs', 'slides', 'live'], itemFilter: 'mine', themeDefaults: { song: 3 }, outputBackground: 'logo' })
    expect(loaded.layouts.find((l) => l.id === copy.layout.id)).toMatchObject({ name: 'Lyrics booth copy', panels: ['songs', 'slides', 'live'] })
    expect(loaded.layouts.some((l) => l.id === 'minimal')).toBe(false)
  })

  it('drop broken entries when loading, and fall back to the presets when nothing is usable', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'layouts.list',
      JSON.stringify([
        { id: 'ok', name: '  Front ', panels: ['live', 'nonsense', 'live'], itemFilter: 'sideways', themeDefaults: { song: -1, scripture: 4 }, outputBackground: 'red' },
        { id: 'BAD ID', name: 'x', panels: [] },
        { id: 'ok', name: 'Duplicate id', panels: [] },
        'not a layout',
      ]),
    )
    expect(getAppSettings().layouts).toEqual([{ id: 'ok', name: 'Front', panels: ['live'], itemFilter: 'all', themeDefaults: { scripture: 4 }, outputBackground: null }])
    expect(cleanLayouts([])).toEqual(PRESET_LAYOUTS)
    expect(cleanLayouts('nothing')).toEqual(PRESET_LAYOUTS)
  })

  it('keep at least one, and need a name', () => {
    const one = [PRESET_LAYOUTS[0]]
    expect(() => deleteLayout(one, 'full')).toThrow(/at least one/)
    expect(() => renameLayout(one, 'full', '   ')).toThrow(/name/)
    // Names stay unique.
    expect(createLayout(one, 'Full').layout.name).toBe('Full 2')
  })
})
