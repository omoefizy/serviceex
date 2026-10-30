// Plans: on the free plan a Pro feature stays visible with a lock, and asking for it opens the upgrade popover; it is
// never hidden, disabled with an error, or started. On the Pro plan nothing is locked. With enforcement off (a developer
// build) nothing is blocked, and what would have been is logged. Panels are rendered with every window.api call
// answering nothing, as in settingsPanel.test.
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

const { can, ENFORCE_ENTITLEMENTS, FEATURE_KEYS, FREE_FEATURES, FREE_PLAN, planChanged, planOf, PRO_FEATURES, setEntitlementEnforcement, setEntitlements, upgradeNote } =
  await import('../shared/features')
const { EMPTY_DESIGN, newDesignElement } = await import('../shared/designs')
const { newEffect } = await import('../shared/designEffects')
const { closeUpgrade, upgradeRequest } = await import('./lib/upgrade')
const { selectLowerThirdDisplay, selectOverlayLayers, selectOutputState, useOperatorStore } = await import('./store')
const { UpgradePopover } = await import('./components/Locked')
const { MoreMenuList, Toolbar } = await import('./components/Toolbar')
const { SettingsPanel } = await import('./components/SettingsPanel')
const { ImportModal } = await import('./components/ImportModal')
const { PresentationsPanel } = await import('./components/PresentationsPanel')
const { AiButton } = await import('./components/AiButton')

const initial = useOperatorStore.getState()

const useFree = () => setEntitlements({ plan: FREE_PLAN, features: FREE_FEATURES })
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
  closeUpgrade()
  setEntitlementEnforcement(ENFORCE_ENTITLEMENTS)
  setEntitlements(null)
  useOperatorStore.setState(initial, true)
  groups.clear()
})

const LOGO = { id: 'l1', name: 'Logo', url: 'wd-media://logo.png', anchor: 'top-right', x: 0, y: 0, size: 10, margin: 4, opacity: 1, enabled: true } as const

/** A lower third design that slides in, spins and has a light sweep: everything past a fade. */
function fancyDesign() {
  const rect = newDesignElement('rect', 'r1')
  const element = {
    ...rect,
    loop: 'spin' as const,
    effects: [newEffect('lightSweep', 'fx1')],
    animation: { ...rect.animation, in: { ...rect.animation.in, motion: 'slideLeft' as const }, out: { ...rect.animation.out, motion: 'wipe' as const } },
  }
  return { id: 7, name: 'Fancy', type: 'custom' as const, style: { ...EMPTY_DESIGN.lowerThird, elements: [element] } }
}

describe('a Pro feature on the free plan', () => {
  it('stays in the toolbar with a lock, never disabled', () => {
    useFree()
    const { toolbar } = render()
    for (const feature of ['stageDisplay', 'multiOutput', 'themes.editor'] as const) expect(toolbar, feature).toContain(`title="${note(feature)}"`)
    expect(toolbar).toContain('lock-icon')
    for (const label of ['Stage Display', 'Show Stream Output', 'Themes', 'Studio', 'Sermons']) {
      expect(toolbar, label).toContain(label)
      expect(toolbar, label).not.toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>(?:(?!</button>)[\\s\\S])*${label}`))
    }
  })

  it('is locked in place in Settings: idle layer, church brand, device sharing, library sync', () => {
    useFree()
    const { settings } = render()
    for (const feature of ['output.idle', 'brand.church', 'sharing.devices']) expect(settings, feature).toContain(`class="locked-feature block" data-feature="${feature}"`)
    // The controls are still there to see.
    expect(settings).toContain('Idle design')
    expect(settings).toContain('Church logo')
    expect(settings).toContain('Share with other ServiceEx computers on this network')
    expect(settings).toContain('data-feature="sharing.librarySync"')
    expect(settings.match(/<li class="off"/g)).toHaveLength(PRO_FEATURES.length)
  })

  it('leaves the free features alone', () => {
    useFree()
    const { importer, presentations, aiButton, settings } = render()
    expect(importer).toContain('Choose files')
    expect(presentations).not.toContain('not in your plan')
    expect(aiButton).not.toContain('locked-feature')
    expect(aiButton).not.toContain('disabled=""')
    expect(settings).not.toContain(note('listener.cloud'))
    expect(settings).not.toContain(note('listener.offline'))
  })

  it('asks for the plan from the store instead of starting, and the free features start', async () => {
    useFree()
    const st = useOperatorStore.getState()
    for (const [feature, ask] of [
      ['themes.editor', () => st.openThemeEditor(true)],
      ['multiOutput', () => st.openStreamPanel(true)],
      ['sermon.save', () => st.openSermons(true)],
      ['stageDisplay', () => st.toggleStage()],
      ['multiOutput', () => st.toggleStream()],
    ] as const) {
      closeUpgrade()
      await ask()
      expect(upgradeRequest()?.feature, feature).toBe(feature)
    }
    const after = useOperatorStore.getState()
    expect(after.themeEditorOpen).toBe(false)
    expect(after.streamPanelOpen).toBe(false)
    expect(after.sermonsOpen).toBe(false)
    expect(window.api.stage.open).not.toHaveBeenCalled()
    expect(window.api.stream.setOpen).not.toHaveBeenCalled()
    st.startAlerts([{ id: 'a', text: 'Car park is full', priority: false }])
    st.showLowerThirdLine({ headline: 'Pastor Sam', body: '' })
    expect(useOperatorStore.getState().live.alert).not.toBeNull()
    expect(useOperatorStore.getState().live.lowerThird).toMatchObject({ headline: 'Pastor Sam' })
  })

  it('plays lower thirds with a fade only, and leaves out the idle layer and the church brand', () => {
    useFree()
    const design = fancyDesign()
    useOperatorStore.setState((s) => ({
      designs: [design],
      settings: { ...s.settings, idleDesignId: design.id, lowerThirdAnimation: 'slide', logoUrl: 'wd-media://logo.png', logoLayerVisible: true, logoItems: [LOGO] },
      live: { ...s.live, mode: 'clear' },
    }))
    useOperatorStore.getState().showLowerThirdLine({ headline: 'Pastor Sam', body: '', designId: design.id })
    const s = useOperatorStore.getState()
    const shown = selectLowerThirdDisplay(s)!
    expect(shown.animation).toBe('fade')
    expect(shown.design!.elements[0]).toMatchObject({ loop: 'none', effects: [], animation: { in: { motion: 'fade' }, out: { motion: 'fade' } } })
    expect(selectOverlayLayers(s)).toMatchObject({ idle: null, logos: [] })
    expect(selectOutputState(s).logoUrl).toBeNull()
    // The design itself is not changed.
    expect(s.designs[0].style.elements[0].loop).toBe('spin')

    usePro()
    const pro = useOperatorStore.getState()
    expect(selectLowerThirdDisplay(pro)!.animation).toBe('slide')
    expect(selectLowerThirdDisplay(pro)!.design!.elements[0].loop).toBe('spin')
    expect(selectOverlayLayers(pro).idle).not.toBeNull()
    expect(selectOverlayLayers(pro).logos).toHaveLength(1)
  })
})

describe('the upgrade popover', () => {
  it('names the feature and the plan, with Manage plan', () => {
    useFree()
    useOperatorStore.getState().openThemeEditor(true)
    const html = renderToString(createElement(UpgradePopover))
    expect(html).toContain('Custom themes')
    expect(html).toContain('is in the Pro plan')
    expect(html).toContain('this computer is on the free plan')
    expect(html).toContain('Manage plan')
    expect(html).not.toContain('error')
  })

  it('says a plan bought during the service starts at the next start', () => {
    useFree()
    planChanged(planOf('pro_license'))
    useOperatorStore.getState().openThemeEditor(true)
    expect(renderToString(createElement(UpgradePopover))).toContain('Plan changes apply the next time ServiceEx starts')
  })

  it('is closed until a locked feature is asked for', () => {
    useFree()
    expect(renderToString(createElement(UpgradePopover))).toBe('')
  })
})

describe('the Pro plan', () => {
  it('includes every feature', () => {
    usePro()
    expect(FEATURE_KEYS.filter((feature) => !can(feature))).toEqual([])
  })

  it('shows no locks', () => {
    usePro()
    const html = Object.values(render()).join('\n')
    expect(html).not.toContain('locked-feature')
    expect(html).not.toContain('lock-icon')
    expect(html).not.toContain('upgrade-note')
    expect(html).not.toContain('<li class="off"')
    expect(html).toContain('Choose files')
  })

  it('starts each feature from the store', async () => {
    usePro()
    const st = useOperatorStore.getState()
    st.openThemeEditor(true)
    expect(useOperatorStore.getState().themeEditorOpen).toBe(true)
    await st.toggleStage()
    await st.toggleStream()
    expect(window.api.stage.open).toHaveBeenCalled()
    expect(window.api.stream.setOpen).toHaveBeenCalledWith(true)
    expect(upgradeRequest()).toBeNull()
  })

  it('is what an unset licence gives too, so a renderer that could not ask keeps everything', () => {
    setEntitlements(null)
    expect(FEATURE_KEYS.every(can)).toBe(true)
  })
})

describe('with enforcement off, in a developer build', () => {
  it('blocks nothing, and logs each feature it would have blocked once', () => {
    setEntitlementEnforcement(false)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      useFree()
      expect(FEATURE_KEYS.every(can)).toBe(true)
      const { toolbar } = render()
      expect(toolbar).not.toContain('lock-icon')
      // Asked again (every render asks), each feature is still logged only once.
      FEATURE_KEYS.forEach(can)
      expect(info).toHaveBeenCalledTimes(PRO_FEATURES.length)
      expect(info).toHaveBeenCalledWith(expect.stringContaining('the Free plan would block "themes.editor"'))
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
