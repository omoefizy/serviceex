// Plans: once plan limits are enforced, a feature the plan leaves out is hidden, or disabled with a note saying it is
// not included; on the Pro plan everything is available and no such note appears. While ENFORCE_ENTITLEMENTS is false
// (as shipped) nothing is blocked, and what would have been is logged. Panels are rendered with every window.api call answering
// nothing, as in settingsPanel.test.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../electron/db/index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { initSchema } = await import('../electron/db/schema')
  const db = new Database(':memory:')
  initSchema(db)
  return { db }
})

const groups = new Map<PropertyKey, Record<string, unknown>>()
const answerNothing = () => new Proxy({} as Record<string, unknown>, { get: (target, name: string) => (target[name] ??= vi.fn(async () => undefined)) })
const api: unknown = new Proxy({}, { get: (_target, group) => groups.get(group) ?? groups.set(group, answerNothing()).get(group) })
vi.stubGlobal('window', { api })

const { can, ENFORCE_ENTITLEMENTS, FEATURE_KEYS, planOf, setEntitlementEnforcement, setEntitlements, upgradeNote } = await import('../shared/features')
const { useOperatorStore } = await import('./store')
const { MoreMenuList, Toolbar } = await import('./components/Toolbar')
const { SettingsPanel } = await import('./components/SettingsPanel')
const { ImportModal } = await import('./components/ImportModal')
const { PresentationsPanel } = await import('./components/PresentationsPanel')
const { AiButton } = await import('./components/AiButton')

const initial = useOperatorStore.getState()

/** A plan with none of the features. */
const usePlanWithNothing = () => setEntitlements({ plan: 'Basic', features: [] })
const usePro = () => setEntitlements(planOf('pro_license'))

/** React writes quotes in attributes as &quot; and keeps the rest of the note as it is. */
const note = (feature: Parameters<typeof upgradeNote>[0]) => upgradeNote(feature).replace(/"/g, '&quot;')

function render() {
  return {
    // The screens used less often are in the toolbar's More menu, which renders closed.
    toolbar: renderToString(createElement(Toolbar)) + renderToString(createElement(MoreMenuList, { onChoose: () => undefined })),
    settings: renderToString(createElement(SettingsPanel)),
    importer: renderToString(createElement(ImportModal, { onClose: () => undefined })),
    presentations: renderToString(createElement(PresentationsPanel)),
    aiButton: renderToString(
      createElement(AiButton, { feature: 'ai.scriptureSearch', label: 'By meaning', busyLabel: '', busy: false, disabledReason: null, tooltip: 'Ask the AI' }),
    ),
  }
}

beforeEach(() => setEntitlementEnforcement(true))

afterEach(() => {
  setEntitlementEnforcement(ENFORCE_ENTITLEMENTS)
  setEntitlements(null)
  useOperatorStore.setState(initial, true)
  groups.clear()
})

describe('a feature the plan does not include', () => {
  it('is disabled with an upgrade note in the toolbar', () => {
    usePlanWithNothing()
    const { toolbar } = render()
    for (const feature of ['alerts', 'stageDisplay', 'multiOutput', 'themes.editor'] as const) {
      expect(toolbar, feature).toContain(`title="${note(feature)}"`)
    }
    expect(upgradeNote('alerts')).toBe('Alerts is not included in the Basic plan. See Settings, Account.')
    expect(toolbar).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Stage Display/)
    expect(toolbar).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Themes/)
    expect(toolbar).toMatch(/<button[^>]*mode-alert[^>]*disabled=""/)
  })

  it('shows a note instead of song import, and disables Native mode and AI actions', () => {
    usePlanWithNothing()
    const { importer, presentations, aiButton } = render()
    expect(importer).toContain(note('import.songs'))
    expect(importer).not.toContain('Choose files')
    // Export is not part of the import feature and stays.
    expect(importer).toContain('Export all songs')
    expect(presentations).toMatch(/<option value="native" disabled="">Native mode \(not in your plan\)<\/option>/)
    expect(aiButton).toContain(`title="${note('ai.scriptureSearch')}"`)
    expect(aiButton).toContain('disabled=""')
  })

  it('is marked in Settings, Account, and the listener engines it needs are disabled with a note', () => {
    usePlanWithNothing()
    const { settings } = render()
    expect(settings).toContain('Account</h3>')
    expect(settings.match(/<li class="off"/g)).toHaveLength(FEATURE_KEYS.length)
    expect(settings).toContain(note('listener.cloud'))
    expect(settings).toContain(note('listener.offline'))
    expect(settings).toMatch(/role="radio"[^>]*disabled=""[^>]*>.*Cloud/)
    expect(settings).toMatch(/role="radio"[^>]*disabled=""[^>]*>.*Offline/)
  })

  it('does not start from the store', async () => {
    usePlanWithNothing()
    const st = useOperatorStore.getState()
    st.openThemeEditor(true)
    st.startAlerts([{ id: 'a', text: 'Car park is full', priority: false }])
    st.showLowerThirdLine({ headline: 'Pastor Sam', body: '' })
    await st.toggleStage()
    await st.toggleStream()
    const after = useOperatorStore.getState()
    expect(after.themeEditorOpen).toBe(false)
    expect(after.live.alert).toBeNull()
    expect(after.live.lowerThird).toBeNull()
    expect(window.api.stage.open).not.toHaveBeenCalled()
    expect(window.api.stream.setOpen).not.toHaveBeenCalled()
  })
})

describe('the Pro plan', () => {
  it('includes every feature', () => {
    usePro()
    expect(FEATURE_KEYS.filter((feature) => !can(feature))).toEqual([])
  })

  it('shows no upgrade notes and nothing disabled for the plan', () => {
    usePro()
    const html = Object.values(render()).join('\n')
    expect(html).not.toContain('not included in')
    expect(html).not.toContain('upgrade-note')
    expect(html).not.toContain('not in your plan')
    expect(html).not.toContain('<li class="off"')
    expect(html).toContain('Choose files')
    expect(html).not.toMatch(/<button[^>]*aria-label="(Stage display|Themes|Stream)"[^>]*disabled=""/)
  })

  it('starts each feature from the store', async () => {
    usePro()
    const st = useOperatorStore.getState()
    st.openThemeEditor(true)
    expect(useOperatorStore.getState().themeEditorOpen).toBe(true)
    st.startAlerts([{ id: 'a', text: 'Car park is full', priority: false }])
    expect(useOperatorStore.getState().live.alert).not.toBeNull()
    st.stopAlerts()
    st.showLowerThirdLine({ headline: 'Pastor Sam', body: '' })
    expect(useOperatorStore.getState().live.lowerThird).toMatchObject({ headline: 'Pastor Sam' })
    st.hideLowerThird()
    await st.toggleStage()
    await st.toggleStream()
    expect(window.api.stage.open).toHaveBeenCalled()
    expect(window.api.stream.setOpen).toHaveBeenCalledWith(true)
  })

  it('is what an unset licence gives too, so a renderer that could not ask keeps everything', () => {
    setEntitlements(null)
    expect(FEATURE_KEYS.every(can)).toBe(true)
  })
})

describe('with ENFORCE_ENTITLEMENTS off, as shipped', () => {
  it('blocks nothing, and logs each feature it would have blocked once', () => {
    setEntitlementEnforcement(false)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      usePlanWithNothing()
      expect(FEATURE_KEYS.every(can)).toBe(true)
      const { toolbar } = render()
      expect(toolbar).not.toContain('not included in')
      expect(toolbar).not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*(Stage Display|Themes)/)
      // Asked again (every render asks), each feature is still logged only once.
      FEATURE_KEYS.forEach(can)
      expect(info).toHaveBeenCalledTimes(FEATURE_KEYS.length)
      expect(info).toHaveBeenCalledWith(expect.stringContaining('the Basic plan would block "themes.editor"'))
    } finally {
      info.mockRestore()
    }
  })

  it('logs nothing for a plan that includes the feature', () => {
    setEntitlementEnforcement(false)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      usePro()
      expect(FEATURE_KEYS.every(can)).toBe(true)
      expect(info).not.toHaveBeenCalled()
    } finally {
      info.mockRestore()
    }
  })
})
