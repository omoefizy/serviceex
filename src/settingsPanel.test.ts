// Settings and Themes must open whatever the database holds: nothing yet (a first run), or what an older version
// saved (fewer keys, retired values, themes from before the layout editor). Settings come from a throwaway database
// through the main process code, and every Settings section is rendered with them.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../shared/types'

vi.mock('../electron/db/index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { initSchema } = await import('../electron/db/schema')
  const db = new Database(':memory:')
  initSchema(db)
  return { db }
})

// Every window.api call answers with nothing; the panels only call it from effects and handlers.
const groups = new Map<PropertyKey, Record<string, unknown>>()
const answerNothing = () => new Proxy({} as Record<string, unknown>, { get: (target, name: string) => (target[name] ??= async () => undefined) })
const api: unknown = new Proxy({}, { get: (_target, group) => groups.get(group) ?? groups.set(group, answerNothing()).get(group) })
vi.stubGlobal('window', { api })

const { db } = await import('../electron/db/index')
const { getAppSettings } = await import('../electron/db/settings')
const { getThemeDefaults, listThemes, seedBuiltinThemes } = await import('../electron/db/themes')
const { DEFAULT_SETTINGS, useOperatorStore } = await import('./store')
const { SettingsPanel } = await import('./components/SettingsPanel')
const { ThemeEditor } = await import('./components/ThemeEditor')

const SECTIONS = [
  'Plan',
  'Appearance',
  'Output',
  'Logo',
  'Default themes',
  'AI',
  'Sermon listener',
  'Scripture detection',
  'Sermon quotes',
  'Presentations',
  'Live PowerPoint diagnostics',
  'Live highlighting',
  'Sharing',
  'Devices',
  'Library sync',
  'Layouts',
  'Autosave and backups',
]

/** Settings saved by a version from before the stream, lower third and layout editor settings existed. */
function storeOldSettings() {
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  put.run('ui.appearance', '"dark"')
  put.run('output.fadeMs', '600')
  put.run('output.display', '"auto"')
  put.run('output.logoUrl', 'null')
  put.run('editor.autosaveDrafts', 'true')
  put.run('backup.folder', 'null')
  put.run('backup.intervalMinutes', '15')
  put.run('ai.enabled', 'true')
  put.run('ai.model', '"claude-sonnet-4-5"')
  put.run('alerts.messages', '"not a list"')
  put.run('speech.engine', '{broken json')
  // A custom theme in the flat style themes had before elements, set as the default for the four types there were.
  const { id } = db
    .prepare("INSERT INTO themes (name, type, json) VALUES ('Old custom', 'custom', ?) RETURNING id")
    .get(JSON.stringify({ fontFamily: 'Georgia', fontWeight: 700, color: '#ffeecc', margins: { top: 10, right: 10, bottom: 10, left: 10 }, background: { kind: 'solid', color: '#112233' } })) as { id: number }
  for (const type of ['song', 'scripture', 'announcement', 'quote']) put.run(`theme.default.${type}`, String(id))
}

/** Loads what the main process would answer into the store. Rendering outside a browser reads zustand's initial state, so it is set too. */
function loadIntoStore() {
  const state = { settings: getAppSettings(), themes: listThemes(), themeDefaults: getThemeDefaults() }
  Object.assign(useOperatorStore.getInitialState(), state)
  useOperatorStore.setState(state)
  return state
}

function expectPanelsToOpen(settings: AppSettings) {
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) expect(settings[key], key).not.toBeUndefined()
  const html = renderToString(createElement(SettingsPanel))
  for (const title of SECTIONS) expect(html, title).toContain(`${title}</h3>`)
  for (const type of ['songs', 'scripture', 'announcements', 'quotes', 'lower thirds', 'logos']) expect(html).toMatch(new RegExp(`Default for (<!-- -->)?${type}<`))
  expect(renderToString(createElement(ThemeEditor))).toContain('Themes</h2>')
}

beforeEach(() => {
  db.exec('DELETE FROM settings; DELETE FROM themes')
  seedBuiltinThemes()
})

describe('Settings', () => {
  it('opens every section with an empty settings store', () => {
    const { settings } = loadIntoStore()
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expectPanelsToOpen(settings)
  })

  it('opens every section with settings an older version saved', () => {
    storeOldSettings()
    const { settings, themes } = loadIntoStore()
    expect(settings.appearance).toBe('dark')
    expect(settings.fadeMs).toBe(600)
    // Retired or broken values fall back to the defaults.
    expect(settings.aiModel).toBe(DEFAULT_SETTINGS.aiModel)
    expect(settings.backupIntervalMinutes).toBe(0)
    expect(settings.alertMessages).toEqual([])
    expect(settings.speechEngine).toBe('auto')
    expect(themes.find((t) => t.name === 'Old custom')?.style.elements.length).toBeGreaterThan(0)
    expectPanelsToOpen(settings)
  })

  it('fills in keys the main process leaves out of its answer', async () => {
    window.api.settings.get = async () => ({ appearance: 'light' }) as AppSettings
    await useOperatorStore.getState().loadSettings()
    expect(useOperatorStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, appearance: 'light' })
  })
})
