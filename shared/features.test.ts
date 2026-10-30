// Free and Pro: which features each plan has, the single can() check, the free plan's limits, and the live service
// exception: what a run starts with it keeps until the app restarts, whatever happens to the plan meanwhile.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  can,
  canAddTranslation,
  canSaveLowerThirdDesign,
  canUseTheme,
  ENFORCE_ENTITLEMENTS,
  FEATURE_KEYS,
  FREE_FEATURES,
  FREE_PLAN,
  markOnAir,
  pendingPlan,
  planChanged,
  planOf,
  PRO_FEATURES,
  setEntitlementEnforcement,
  setEntitlements,
  tierOf,
  upgradeNote,
} from './features'

const FREE = { plan: FREE_PLAN, features: FREE_FEATURES }
const PRO = planOf('pro_license')

afterEach(() => {
  setEntitlementEnforcement(ENFORCE_ENTITLEMENTS)
  setEntitlements(null)
})

describe('the feature lists', () => {
  it('put every feature in exactly one of Free and Pro', () => {
    expect([...FREE_FEATURES, ...PRO_FEATURES].sort()).toEqual([...FEATURE_KEYS].sort())
    expect(FREE_FEATURES.filter((f) => PRO_FEATURES.includes(f))).toEqual([])
  })

  it('keep the free plan to what it names, with cloud listening and AI limited by the server', () => {
    expect(FREE_FEATURES).toEqual(expect.arrayContaining(['scripture', 'songs', 'import.slides', 'schedule', 'output.main', 'listener.offline', 'listener.cloud', 'themes.builtIn', 'lowerThirds']))
    expect(PRO_FEATURES).toEqual(
      expect.arrayContaining([
        'output.overlay',
        'output.keyFill',
        'output.chroma',
        'output.idle',
        'multiOutput',
        'lowerThirds.designs',
        'effects.animations',
        'designs.figmaImport',
        'fonts.import',
        'themes.editor',
        'scripture.combine',
        'scripture.editText',
        'stageDisplay',
        'remote.mobile',
        'sharing.devices',
        'sermon.save',
        'sermon.export.pdf',
        'sermon.ai.cleanup',
        'brand.church',
      ]),
    )
    expect(tierOf('listener.cloud')).toBe('free')
    expect(tierOf('stageDisplay')).toBe('pro')
  })

  it('give Pro, Team and the Pro trial every feature', () => {
    for (const product of ['pro_license', 'team_license', 'pro_trial']) expect(planOf(product).features).toEqual(FEATURE_KEYS)
    expect(planOf('pro_trial').plan).toBe('Pro')
  })
})

describe('can()', () => {
  it('is on by default, in release builds and developer builds alike', () => {
    expect(ENFORCE_ENTITLEMENTS).toBe(true)
  })

  it('allows everything before the licence is known, so a window that could not ask keeps working', () => {
    expect(FEATURE_KEYS.every(can)).toBe(true)
  })

  it('allows the free features and locks the Pro ones on the free plan', () => {
    setEntitlements(FREE)
    expect(FREE_FEATURES.every(can)).toBe(true)
    expect(PRO_FEATURES.filter(can)).toEqual([])
  })

  it('allows everything on Pro', () => {
    setEntitlements(PRO)
    expect(FEATURE_KEYS.every(can)).toBe(true)
  })

  it('takes the enforcement the main process decided', () => {
    setEntitlements({ ...FREE, enforce: false })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      expect(can('stageDisplay')).toBe(true)
      expect(can('stageDisplay')).toBe(true)
      // Logged once per feature, however often it is asked.
      expect(info).toHaveBeenCalledTimes(1)
      expect(info).toHaveBeenCalledWith(expect.stringContaining('the Free plan would block "stageDisplay"'))
    } finally {
      info.mockRestore()
    }
    setEntitlements({ ...FREE, enforce: true })
    expect(can('stageDisplay')).toBe(false)
  })

  it('names the plan a locked feature is in', () => {
    expect(upgradeNote('stageDisplay')).toBe('Stage display is in the Pro plan. See Settings, Account.')
    expect(upgradeNote('songs')).toBe('Songs is not included in this plan. See Settings, Account.')
  })
})

describe('the free plan’s limits', () => {
  it('keeps one saved lower third design', () => {
    setEntitlements(FREE)
    expect(canSaveLowerThirdDesign(0)).toBe(true)
    expect(canSaveLowerThirdDesign(1)).toBe(false)
    setEntitlements(PRO)
    expect(canSaveLowerThirdDesign(12)).toBe(true)
  })

  it('keeps four translations', () => {
    setEntitlements(FREE)
    expect(canAddTranslation(3)).toBe(true)
    expect(canAddTranslation(4)).toBe(false)
    setEntitlements(PRO)
    expect(canAddTranslation(9)).toBe(true)
  })

  it('picks from two built-in slide themes, with the lower third templates and the Logo theme', () => {
    const theme = (name: string, category = 'song', type: 'builtin' | 'custom' = 'builtin') => ({ name, type, style: { category } })
    setEntitlements(FREE)
    expect(canUseTheme(theme('Blue Smoke'))).toBe(true)
    expect(canUseTheme(theme('Classic Black'))).toBe(true)
    expect(canUseTheme(theme('Warm Sunset'))).toBe(false)
    expect(canUseTheme(theme('Classic Bar', 'lowerThird'))).toBe(true)
    expect(canUseTheme(theme('Logo', 'logo'))).toBe(true)
    expect(canUseTheme(theme('Our theme', 'song', 'custom'))).toBe(false)
    setEntitlements(PRO)
    expect(canUseTheme(theme('Warm Sunset'))).toBe(true)
    expect(canUseTheme(theme('Our theme', 'song', 'custom'))).toBe(true)
  })
})

describe('a live service is never interrupted', () => {
  it('keeps the plan the run started with when the licence changes or expires, and applies the change at the next start', () => {
    setEntitlements(PRO)
    // Refunded, expired or a trial that ended, while the app is open.
    planChanged(FREE)
    expect(FEATURE_KEYS.every(can)).toBe(true)
    expect(pendingPlan()).toMatchObject({ plan: FREE_PLAN })
    // The next start.
    setEntitlements(FREE)
    expect(can('stageDisplay')).toBe(false)
    expect(pendingPlan()).toBeNull()
  })

  it('does not unlock a newly bought plan mid-run either, and forgets a change back to the same plan', () => {
    setEntitlements(FREE)
    planChanged(PRO)
    expect(can('multiOutput')).toBe(false)
    expect(pendingPlan()).toMatchObject({ plan: 'Pro' })
    planChanged(FREE)
    expect(pendingPlan()).toBeNull()
  })

  it('keeps a Pro feature that is on air working, even if the run’s entitlements are set again', () => {
    setEntitlements(PRO)
    markOnAir('multiOutput')
    setEntitlements(FREE)
    expect(can('multiOutput')).toBe(true)
    expect(can('stageDisplay')).toBe(false)
    // A restart (null starts over) forgets it.
    setEntitlements(null)
    setEntitlements(FREE)
    expect(can('multiOutput')).toBe(false)
  })

  it('never marks a feature the plan does not include as on air', () => {
    setEntitlements(FREE)
    markOnAir('stageDisplay')
    expect(can('stageDisplay')).toBe(false)
  })
})
