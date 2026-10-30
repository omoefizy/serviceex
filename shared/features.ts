// Every feature that a plan can include, by key, and which plan includes it. Each feature asks can() where it starts,
// in the main process and in the renderer, so a plan can switch any of them off in one place. The licence (see
// ./license) decides which keys are on, once at startup; until setEntitlements is called, every feature is available.
//
// A feature the plan leaves out stays visible with a lock, and asking for it opens a short upgrade popover; it is never
// hidden and never an error. What a run starts with it keeps until the app restarts, so a service is never interrupted
// by a plan that changes, expires or ends its trial while the app is open (see planChanged and markOnAir).

export type PlanTier = 'free' | 'pro'

export const FEATURES = {
  // Free
  scripture: { label: 'Scripture', description: 'Four translations, search and verse parts.' },
  songs: { label: 'Songs', description: 'The song library and editor.' },
  'import.songs': { label: 'Song import', description: 'Import songs from files and other apps.' },
  'import.slides': { label: 'Slide and PowerPoint import', description: 'Import slides and PowerPoint files.' },
  'powerpoint.native': { label: 'Native PowerPoint', description: 'Rebuild PowerPoint slides as editable themes (Native mode).' },
  schedule: { label: 'Schedule', description: 'The order of service.' },
  'output.main': { label: 'Main output', description: 'One main output for the projector.' },
  'listener.offline': { label: 'Offline listener', description: 'Sermon listener with whisper.cpp on this computer.' },
  'listener.cloud': { label: 'Cloud listener', description: 'Sermon listener in the cloud, as far as the listening hours go.' },
  'ai.lyricsCleaner': { label: 'AI lyrics cleaner', description: 'Clean Lyrics in the song editor.' },
  'ai.scriptureSearch': { label: 'AI scripture search', description: 'Find passages by meaning, and the listener’s AI fallback for references.' },
  'ai.sermonPoints': { label: 'AI sermon points', description: 'Find points and verses in a sermon outline.' },
  'ai.announcements': { label: 'AI announcements', description: 'Build announcement slides from a message.' },
  'ai.statements': { label: 'AI sermon statements', description: 'Pick quotable statements while the listener runs.' },
  'themes.builtIn': { label: 'Built-in themes', description: 'Two of the built-in themes.' },
  lowerThirds: { label: 'Lower thirds', description: 'One saved lower third design, fading in and out.' },
  alerts: { label: 'Alerts', description: 'The alert ticker on the output.' },
  mediaLibrary: { label: 'Media library', description: 'The Media tab: pictures and videos for backgrounds.' },
  'sharing.layouts': { label: 'Layouts', description: 'Named layouts of panels.' },
  // Pro
  multiOutput: { label: 'More than one output', description: 'The Stream output beside the main output, with its own layers.' },
  'output.overlay': { label: 'Overlay output', description: 'A Stream output with just the overlays, never the slides.' },
  'output.keyFill': { label: 'Key and Fill output', description: 'A fill output and a key output for the vision mixer.' },
  'output.chroma': { label: 'Chroma output', description: 'A chroma key color behind the graphics.' },
  'output.idle': { label: 'Idle layer', description: 'A design on every output whenever the main content is cleared.' },
  'lowerThirds.designs': { label: 'More lower third designs', description: 'More than one saved lower third design.' },
  'effects.animations': { label: 'Animations and effects', description: 'Every animation, loop and light effect, beyond fade in and out.' },
  'designs.figmaImport': { label: 'Figma import', description: 'Import designs from Figma as SVG, or drop and paste them.' },
  'fonts.import': { label: 'Imported fonts', description: 'Add your own fonts.' },
  'themes.editor': { label: 'Custom themes', description: 'Every built-in theme, and creating and editing your own.' },
  'scripture.combine': { label: 'Combined scriptures', description: 'Put several passages together on one slide.' },
  'scripture.editText': { label: 'Verse text editing', description: 'Edit a verse’s words, with an ellipsis where text is left out.' },
  'bible.extraVersions': { label: 'More translations', description: 'More than four Bible translations.' },
  stageDisplay: { label: 'Stage display', description: 'The stage display for the worship leader.' },
  'remote.mobile': { label: 'Mobile remote', description: 'Control the service from a phone.' },
  'sharing.devices': { label: 'Device sharing', description: 'Pair computers on the network and share between them.' },
  'sharing.send': { label: 'Send to device', description: 'Cues: send a verse, song, point, note or free text to another computer.' },
  'sharing.sharedService': { label: 'Shared services', description: 'Host or join a service shared between computers.' },
  'sharing.librarySync': { label: 'Library sync', description: 'Sync songs, themes, fonts, media and presentations between computers.' },
  'sharing.presence': { label: 'Device chips', description: 'See what each paired computer has live.' },
  'sermon.save': { label: 'Sermon library', description: 'Save listening sessions as sermons with their transcript, scriptures and statements.' },
  'sermon.export.text': { label: 'Sermon text export', description: 'Export a sermon as plain text or Markdown.' },
  'sermon.export.pdf': { label: 'Sermon PDF export', description: 'Export a sermon as a PDF with the church brand.' },
  'sermon.export.slides': { label: 'Sermon slides', description: 'Turn a sermon into slides in the schedule, or a PowerPoint file.' },
  'sermon.ai.cleanup': { label: 'AI cleanup and notes', description: 'Clean a sermon transcript and write its summary and key points.' },
  'brand.church': { label: 'Church brand', description: 'The church name, logo and footer, and the logo layer on the outputs.' },
} as const satisfies Record<string, { label: string; description: string }>

export type FeatureKey = keyof typeof FEATURES

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[]

export const isFeatureKey = (value: unknown): value is FeatureKey => typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEATURES, value)

/**
 * What the free plan includes. Cloud listening and AI are here because the server stays authoritative for them: it
 * limits them by the one time free listening hours and AI allowance, then by what the account has bought. Alerts, the
 * media library and layouts are named in neither list, so they stay free.
 */
export const FREE_FEATURES: readonly FeatureKey[] = [
  'scripture',
  'songs',
  'import.songs',
  'import.slides',
  'powerpoint.native',
  'schedule',
  'output.main',
  'listener.offline',
  'listener.cloud',
  'ai.lyricsCleaner',
  'ai.scriptureSearch',
  'ai.sermonPoints',
  'ai.announcements',
  'ai.statements',
  'themes.builtIn',
  'lowerThirds',
  'alerts',
  'mediaLibrary',
  'sharing.layouts',
]

/** What Pro adds to the free plan. */
export const PRO_FEATURES: readonly FeatureKey[] = [
  'multiOutput',
  'output.overlay',
  'output.keyFill',
  'output.chroma',
  'output.idle',
  'lowerThirds.designs',
  'effects.animations',
  'designs.figmaImport',
  'fonts.import',
  'themes.editor',
  'scripture.combine',
  'scripture.editText',
  'bible.extraVersions',
  'stageDisplay',
  'remote.mobile',
  'sharing.devices',
  'sharing.send',
  'sharing.sharedService',
  'sharing.librarySync',
  'sharing.presence',
  'sermon.save',
  'sermon.export.text',
  'sermon.export.pdf',
  'sermon.export.slides',
  'sermon.ai.cleanup',
  'brand.church',
]

/** The plan that includes a feature, for the upgrade popover. */
export const tierOf = (feature: FeatureKey): PlanTier => (PRO_FEATURES.includes(feature) ? 'pro' : 'free')

/** How far the free plan's limited features go. */
export const FREE_LIMITS = {
  /** Bible translations installed, the bundled ones included. */
  translations: 4,
  /** Saved designs in the lower third category. */
  lowerThirdDesigns: 1,
} as const

/** The two built-in slide themes the free plan can pick. Lower third templates and the Logo theme are not counted. */
export const FREE_THEME_NAMES: readonly string[] = ['Blue Smoke', 'Classic Black']

export const isFreeTheme = (theme: { name: string; type: 'builtin' | 'custom'; style: { category: string } }): boolean =>
  theme.type === 'builtin' && (FREE_THEME_NAMES.includes(theme.name) || theme.style.category === 'lowerThird' || theme.style.category === 'logo')

/** Whether this run may pick a theme. */
export const canUseTheme = (theme: Parameters<typeof isFreeTheme>[0]): boolean => isFreeTheme(theme) || can('themes.editor')

/** Whether one more lower third design may be saved, with `saved` of them already. */
export const canSaveLowerThirdDesign = (saved: number): boolean => saved < FREE_LIMITS.lowerThirdDesigns || can('lowerThirds.designs')

/** Whether one more Bible translation may be installed, with `installed` of them already. */
export const canAddTranslation = (installed: number): boolean => installed < FREE_LIMITS.translations || can('bible.extraVersions')

/**
 * Where AI features and cloud listening get their access. "developer_key": a key saved on this computer, offered only
 * in developer builds (SERVICEEX_DEV=1, or running unpackaged). "service": through the ServiceEx account (Settings,
 * Account): listening hours and the monthly AI allowance.
 */
export type KeyProvider = 'developer_key' | 'service'

export const isKeyProvider = (value: unknown): value is KeyProvider => value === 'developer_key' || value === 'service'

export const CLOUD_NOT_CONNECTED = 'Sign in to ServiceEx in Settings, Account, to listen in the cloud. Offline listening works without an account.'
export const AI_NOT_CONNECTED = 'Sign in to ServiceEx in Settings, Account, to use AI features.'

/**
 * Plan gating is on. Release builds always enforce; a developer build (running unpackaged) can turn it off with
 * SERVICEEX_ENFORCE_ENTITLEMENTS=0, and the main process passes its answer to every window (see electron/license).
 * Off, can() never blocks anything and logs what it would have blocked.
 */
export const ENFORCE_ENTITLEMENTS = true

/**
 * The optional Pro trial: the server flags each account it offers one to, once, and signs a licence for it with
 * trial_ends_at (see ./license). Off, a trial licence gives the free plan.
 */
export const PRO_TRIAL = { enabled: true, days: 14 } as const

/** The plan of a computer with no licence (or one that could not be checked). */
export const FREE_PLAN = 'Free'
export const PRO_PLAN = 'Pro'

/** Each licence product's plan name and features. Unknown products get every feature under their own id. */
const PLANS: Record<string, { plan: string; features: readonly FeatureKey[] }> = {
  pro_license: { plan: PRO_PLAN, features: FEATURE_KEYS },
  team_license: { plan: 'Team', features: FEATURE_KEYS },
  pro_trial: { plan: PRO_PLAN, features: FEATURE_KEYS },
}

export const planOf = (productId: string): { plan: string; features: readonly FeatureKey[] } => PLANS[productId] ?? { plan: productId, features: FEATURE_KEYS }

/** What the licence allows for this run of the app. */
export interface Entitlements {
  plan: string
  features: readonly FeatureKey[]
  /** Whether the plan is enforced; left out, the setting stays as it is. The main process decides it for every window. */
  enforce?: boolean
}

let current: { plan: string; features: ReadonlySet<FeatureKey> } | null = null
let enforcing = ENFORCE_ENTITLEMENTS
/** A plan the licence changed to while the app runs; it applies at the next start. */
let pending: Entitlements | null = null
/** Features that went on air this run: they keep working whatever happens to the plan, until the app restarts. */
const onAir = new Set<FeatureKey>()
/** Features already logged as "would block", so a render loop logs each one once. */
const reported = new Set<FeatureKey>()

/**
 * Called once at startup with what the licence allows; null makes every feature available again (and is how tests
 * start over). A later call during the same run never takes away a feature that is on air.
 */
export function setEntitlements(next: Entitlements | null): void {
  current = next ? { plan: next.plan, features: new Set(next.features) } : null
  if (next?.enforce !== undefined) enforcing = next.enforce
  pending = null
  reported.clear()
  if (!next) onAir.clear()
}

/**
 * The licence changed while the app runs: bought, renewed, refunded, expired, or a trial that ended. This run keeps
 * what it started with, so nothing on air stops; the new plan is remembered for the upgrade popover and applies at the
 * next start.
 */
export function planChanged(next: Entitlements): void {
  const same = current !== null && next.plan === current.plan && next.features.length === current.features.size && next.features.every((f) => current!.features.has(f))
  pending = same ? null : { plan: next.plan, features: [...next.features] }
}

/** The plan this computer moves to at the next start, or null when it stays the same. */
export const pendingPlan = (): Entitlements | null => pending

/** A feature went on air. Until the app restarts it stays available, even if the plan no longer includes it. */
export function markOnAir(feature: FeatureKey): void {
  if (includes(feature)) onAir.add(feature)
}

/** For tests of the gating itself; the app takes it from the main process (see Entitlements.enforce). */
export function setEntitlementEnforcement(on: boolean): void {
  enforcing = on
}

export const enforcingEntitlements = (): boolean => enforcing

/** The plan this run started with. */
export const currentPlan = (): string | null => current?.plan ?? null

/** Whether the plan includes a feature, whether or not that is enforced. Settings shows this. */
export function includes(feature: FeatureKey): boolean {
  return current ? current.features.has(feature) || onAir.has(feature) : true
}

/** The single check the UI and the main process use: whether this run may use a feature. */
export function can(feature: FeatureKey): boolean {
  if (includes(feature) || enforcing) return includes(feature)
  if (!reported.has(feature)) {
    reported.add(feature)
    console.info(`[entitlements] Not enforced: the ${current?.plan ?? 'current'} plan would block "${feature}" (${FEATURES[feature].label}).`)
  }
  return true
}

/** The name sharing has always asked with; the same as can. */
export const hasFeature = can

/** The plan that includes a feature, as the operator reads it. */
export const planNameOf = (feature: FeatureKey): string => (tierOf(feature) === 'pro' ? PRO_PLAN : FREE_PLAN)

/** The sentence for a locked feature: the plan it is in (or that this plan leaves it out), and where to change the plan. */
export function upgradeNote(feature: FeatureKey): string {
  const { label } = FEATURES[feature]
  return tierOf(feature) === 'pro' ? `${label} is in the ${PRO_PLAN} plan. See Settings, Account.` : `${label} is not included in this plan. See Settings, Account.`
}

/**
 * The main process's backstop when a locked feature is asked for anyway (the UI shows a lock instead of calling). It
 * throws, so nothing is changed; the renderer never gets here from a locked control.
 */
export function requireFeature(feature: FeatureKey): void {
  if (!can(feature)) throw new Error(upgradeNote(feature))
}
