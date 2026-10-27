// The Sermons screen, the Start Sermon dialog and the app around them render with every window.api call answering
// nothing (as on a first run), so opening Sermons never blanks the app. As in settingsPanel.test.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../electron/db/index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { initSchema } = await import('../electron/db/schema')
  const db = new Database(':memory:')
  initSchema(db)
  return { db }
})

const groups = new Map<PropertyKey, Record<string, unknown>>()
const answerNothing = () => new Proxy({} as Record<string, unknown>, { get: (target, name: string) => (target[name] ??= async () => undefined) })
const api: unknown = new Proxy({}, { get: (_target, group) => groups.get(group) ?? groups.set(group, answerNothing()).get(group) })
vi.stubGlobal('window', { api, addEventListener: () => undefined, removeEventListener: () => undefined })

const { useOperatorStore } = await import('./store')
const { useListener } = await import('./lib/listener')
const { SermonsPanel } = await import('./components/SermonsPanel')
const { StartSermonModal } = await import('./components/StartSermonModal')
const { ListenerPanel } = await import('./components/ListenerPanel')
const { Toolbar } = await import('./components/Toolbar')
const { default: App } = await import('./App')

/** Rendering outside a browser reads zustand's initial state (see settingsPanel.test), so the change goes there too. */
function withState<S extends object>(store: { getInitialState(): S; setState(s: Partial<S>): void }, patch: Partial<S>, run: () => void) {
  const before = { ...store.getInitialState() }
  Object.assign(store.getInitialState(), patch)
  store.setState(patch)
  try {
    run()
  } finally {
    Object.assign(store.getInitialState(), before)
    store.setState(before)
  }
}

describe('Sermons screen', () => {
  it('renders empty, with search', () => {
    const html = renderToString(createElement(SermonsPanel))
    expect(html).toContain('Sermons')
    expect(html).toContain('Search sermons')
    expect(html).toContain('Choose a sermon')
  })

  it('opens in the centre of the app from the toolbar', () => {
    expect(renderToString(createElement(Toolbar))).toContain('aria-label="Sermons"')
    withState(useOperatorStore, { sermonsOpen: true }, () => {
      const html = renderToString(createElement(App))
      expect(html).toContain('sermons-panel')
      // The rest of the app is still there.
      expect(html).toContain('Schedule')
      expect(html).not.toContain('This panel had a problem')
    })
  })

  it('keeps Settings in the toolbar, pinned after the screens list that scrolls', () => {
    const html = renderToString(createElement(Toolbar))
    const nav = /<nav class="toolbar-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)
    expect(nav).not.toBeNull()
    // Every screen added so far is in the list.
    for (const label of ['Stage display', 'Stream', 'Sermons', 'Themes']) expect(nav![1]).toContain(`aria-label="${label}"`)
    // Settings is not inside the scrolling list but right after it, and says its shortcut.
    expect(nav![1]).not.toContain('aria-label="Settings"')
    const after = html.slice(html.indexOf('</nav>'))
    expect(after).toMatch(/^<\/nav><button[^>]*toolbar-settings[^>]*aria-label="Settings"/)
    expect(after).toMatch(/title="Settings \((⌘|Ctrl\+),\)"/)
  })

  it('asks for the sermon with optional fields and a Skip button', () => {
    const html = renderToString(createElement(StartSermonModal, { onStart: () => undefined, onCancel: () => undefined }))
    for (const text of ['Start sermon', 'Title', 'Preacher', 'Series', 'Date', 'Skip', 'Start Listening']) expect(html).toContain(text)
    // Dated today; no preacher or role is filled in until one has been used.
    expect(html).toMatch(/type="date"[^>]*value="\d{4}-\d{2}-\d{2}"/)
  })

  it('shows the listener saving to a sermon', () => {
    withState(useListener, { status: 'listening', sermon: { id: 4, title: 'Wells and Rivers' } }, () => {
      expect(renderToString(createElement(ListenerPanel))).toContain('Wells and Rivers')
    })
  })
})
