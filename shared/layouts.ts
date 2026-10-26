// Layouts: which panels this computer shows, saved under a name. Any computer can switch layout at any time; none
// is tied to a job. A layout can also set defaults: the theme for each kind of content, the output background
// shown when nothing is live, and whether the shared service list starts on this computer's own items.

import type { Layout, LayoutPanel, ThemeContentType } from './types'

/** Every panel a layout can show, in the order the layout editor lists them. */
export const LAYOUT_PANELS: readonly { id: LayoutPanel; label: string }[] = [
  { id: 'songs', label: 'Songs' },
  { id: 'scripture', label: 'Scripture' },
  { id: 'presentations', label: 'Presentations' },
  { id: 'media', label: 'Media' },
  { id: 'slides', label: 'Slides' },
  { id: 'live', label: 'Live and preview' },
  { id: 'points', label: 'Points (lower third)' },
  { id: 'listener', label: 'Listener' },
  { id: 'schedule', label: 'Schedule' },
]

const PANEL_IDS = new Set<string>(LAYOUT_PANELS.map((p) => p.id))
const THEME_TYPES: ThemeContentType[] = ['song', 'scripture', 'announcement', 'quote', 'lowerThird', 'logo']

export const MAX_LAYOUTS = 30
const MAX_NAME = 40

const preset = (id: string, name: string, panels: LayoutPanel[], itemFilter: Layout['itemFilter'] = 'all'): Layout => ({
  id,
  name,
  panels,
  itemFilter,
  themeDefaults: {},
  outputBackground: null,
})

/** The layouts every install starts with. They can be renamed, changed or deleted like any other. */
export const PRESET_LAYOUTS: readonly Layout[] = [
  preset('full', 'Full', LAYOUT_PANELS.map((p) => p.id)),
  preset('songs', 'Songs only', ['songs', 'slides', 'live', 'schedule'], 'mine'),
  preset('scripture', 'Scripture only', ['scripture', 'slides', 'live', 'listener', 'schedule'], 'mine'),
  preset('points', 'Points only', ['slides', 'live', 'points', 'schedule'], 'mine'),
  preset('minimal', 'Minimal', ['live', 'schedule']),
]

export const DEFAULT_LAYOUT_ID = 'full'

const cleanName = (value: unknown): string =>
  // eslint-disable-next-line no-control-regex
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME) : ''

/** One layout with every field checked, or null when it has no usable id or name. */
export function cleanLayout(value: unknown): Layout | null {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof Layout, unknown>>
  if (typeof v.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(v.id)) return null
  const name = cleanName(v.name)
  if (!name) return null
  const panels = Array.isArray(v.panels) ? [...new Set(v.panels.filter((p): p is LayoutPanel => typeof p === 'string' && PANEL_IDS.has(p)))] : []
  const themeDefaults: Layout['themeDefaults'] = {}
  const defaults = (typeof v.themeDefaults === 'object' && v.themeDefaults !== null ? v.themeDefaults : {}) as Record<string, unknown>
  for (const type of THEME_TYPES) {
    const id = defaults[type]
    if (Number.isInteger(id) && (id as number) > 0) themeDefaults[type] = id as number
  }
  return {
    id: v.id,
    name,
    panels,
    itemFilter: v.itemFilter === 'mine' ? 'mine' : 'all',
    themeDefaults,
    outputBackground: v.outputBackground === 'black' || v.outputBackground === 'logo' ? v.outputBackground : null,
  }
}

/** Saved layouts with a usable shape, ids unique; the presets when none are usable. */
export function cleanLayouts(value: unknown): Layout[] {
  const layouts: Layout[] = []
  for (const item of Array.isArray(value) ? value.slice(0, MAX_LAYOUTS) : []) {
    const layout = cleanLayout(item)
    if (layout && !layouts.some((l) => l.id === layout.id)) layouts.push(layout)
  }
  return layouts.length > 0 ? layouts : PRESET_LAYOUTS.map((l) => ({ ...l, panels: [...l.panels], themeDefaults: {} }))
}

/** The layout with this id, else the first one. */
export const layoutById = (layouts: Layout[], id: string): Layout => layouts.find((l) => l.id === id) ?? layouts[0] ?? PRESET_LAYOUTS[0]

const newId = (layouts: Layout[]) => {
  for (let n = layouts.length + 1; ; n++) if (!layouts.some((l) => l.id === `layout-${n}`)) return `layout-${n}`
}

/** A name not already taken: "Songs only 2", "Songs only 3". */
function freeName(layouts: Layout[], name: string): string {
  const base = cleanName(name) || 'Layout'
  if (!layouts.some((l) => l.name === base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, MAX_NAME - String(n).length - 1)} ${n}`
    if (!layouts.some((l) => l.name === candidate)) return candidate
  }
}

/** Adds a layout showing every panel. */
export function createLayout(layouts: Layout[], name: string): { layouts: Layout[]; layout: Layout } {
  if (layouts.length >= MAX_LAYOUTS) throw new Error(`Up to ${MAX_LAYOUTS} layouts`)
  const layout: Layout = { ...PRESET_LAYOUTS[0], panels: [...PRESET_LAYOUTS[0].panels], themeDefaults: {}, id: newId(layouts), name: freeName(layouts, name) }
  return { layouts: [...layouts, layout], layout }
}

export function duplicateLayout(layouts: Layout[], id: string): { layouts: Layout[]; layout: Layout } {
  const source = layouts.find((l) => l.id === id)
  if (!source) throw new Error('That layout no longer exists')
  if (layouts.length >= MAX_LAYOUTS) throw new Error(`Up to ${MAX_LAYOUTS} layouts`)
  const layout: Layout = { ...source, panels: [...source.panels], themeDefaults: { ...source.themeDefaults }, id: newId(layouts), name: freeName(layouts, `${source.name} copy`) }
  const at = layouts.indexOf(source) + 1
  return { layouts: [...layouts.slice(0, at), layout, ...layouts.slice(at)], layout }
}

export function renameLayout(layouts: Layout[], id: string, name: string): Layout[] {
  const clean = cleanName(name)
  if (!clean) throw new Error('A layout needs a name')
  return layouts.map((l) => (l.id === id ? { ...l, name: clean } : l))
}

export function updateLayout(layouts: Layout[], id: string, patch: Partial<Omit<Layout, 'id'>>): Layout[] {
  return layouts.map((l) => (l.id === id ? (cleanLayout({ ...l, ...patch, id }) ?? l) : l))
}

/** Removes a layout; the last one stays, so there is always something to show. */
export function deleteLayout(layouts: Layout[], id: string): Layout[] {
  if (layouts.length <= 1) throw new Error('Keep at least one layout')
  return layouts.filter((l) => l.id !== id)
}

export const showsPanel = (layout: Layout, panel: LayoutPanel) => layout.panels.includes(panel)
