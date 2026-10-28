// Every feature that a plan can include, by key. Each feature asks can() where it starts, in the main process and in
// the renderer, so a plan can switch any of them off in one place. The licence (see ./license) decides which keys are
// on, once at startup; until setEntitlements is called, every feature is available.
//
// Nothing is blocked yet: while ENFORCE_ENTITLEMENTS is false, can() always answers true and logs, once per feature,
// what the plan would have blocked, so the gating can be checked before it is turned on.

export const FEATURES = {
  'sharing.send': { label: 'Send to device', description: 'Cues: send a verse, song, point, note or free text to another computer.' },
  'sharing.sharedService': { label: 'Shared services', description: 'Host or join a service shared between computers.' },
  'sharing.librarySync': { label: 'Library sync', description: 'Sync songs, themes, fonts, media and presentations between computers.' },
  'sharing.presence': { label: 'Device chips', description: 'See what each paired computer has live.' },
  'sharing.layouts': { label: 'Layouts', description: 'Named layouts of panels.' },
  'ai.lyricsCleaner': { label: 'AI lyrics cleaner', description: 'Clean Lyrics in the song editor.' },
  'ai.scriptureSearch': { label: 'AI scripture search', description: 'Find passages by meaning, and the listener’s AI fallback for references.' },
  'ai.sermonPoints': { label: 'AI sermon points', description: 'Find points and verses in a sermon outline.' },
  'ai.announcements': { label: 'AI announcements', description: 'Build announcement slides from a message.' },
  'ai.statements': { label: 'AI sermon statements', description: 'Pick quotable statements while the listener runs.' },
  'sermon.save': { label: 'Sermon recording', description: 'Save listening sessions as sermons with their transcript, scriptures and statements.' },
  'sermon.export.text': { label: 'Sermon text export', description: 'Export a sermon as plain text or Markdown.' },
  'sermon.export.pdf': { label: 'Sermon PDF export', description: 'Export a sermon as a PDF with the church profile.' },
  'sermon.export.slides': { label: 'Sermon slides', description: 'Turn a sermon into slides in the schedule, or a PowerPoint file.' },
  'sermon.ai.cleanup': { label: 'AI sermon cleanup', description: 'Clean a sermon transcript and write its summary and key points.' },
  'listener.cloud': { label: 'Cloud listener', description: 'Sermon listener with Deepgram in the cloud.' },
  'listener.offline': { label: 'Offline listener', description: 'Sermon listener with whisper.cpp on this computer.' },
  'themes.editor': { label: 'Theme editor', description: 'Create and edit themes.' },
  'powerpoint.native': { label: 'Native PowerPoint', description: 'Rebuild PowerPoint slides as editable themes (Native mode).' },
  alerts: { label: 'Alerts', description: 'The alert ticker on the output.' },
  lowerThirds: { label: 'Lower thirds', description: 'Lower thirds on the Stream output.' },
  stageDisplay: { label: 'Stage display', description: 'The stage display for the worship leader.' },
  multiOutput: { label: 'Stream output', description: 'A second output for the livestream, with its own layers and key.' },
  mediaLibrary: { label: 'Media library', description: 'The Media tab: pictures and videos for backgrounds.' },
  'import.songs': { label: 'Song import', description: 'Import songs from files and other apps.' },
  'bible.extraVersions': { label: 'Extra Bible versions', description: 'Import Bible versions beyond the included ones.' },
} as const satisfies Record<string, { label: string; description: string }>

export type FeatureKey = keyof typeof FEATURES

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[]

export const isFeatureKey = (value: unknown): value is FeatureKey => typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEATURES, value)

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
 * The single switch for plan gating. False: can() never blocks anything, and logs what it would have blocked. Turn it
 * on only once those logs show the gating is right.
 */
export const ENFORCE_ENTITLEMENTS = false

/** The plan of a computer with no licence (or one that could not be checked). */
export const FREE_PLAN = 'Free'

/**
 * What the free plan includes. PLACEHOLDER, set before turning ENFORCE_ENTITLEMENTS on. Cloud listening and AI are
 * here because the server already limits them by listening hours and the monthly AI allowance.
 */
export const FREE_FEATURES: readonly FeatureKey[] = [
  'listener.offline',
  'listener.cloud',
  'ai.lyricsCleaner',
  'ai.scriptureSearch',
  'ai.announcements',
  'ai.sermonPoints',
  'sermon.save',
  'sermon.export.text',
  'stageDisplay',
  'mediaLibrary',
  'import.songs',
]

/** Each licence product's plan name and features. Unknown products get every feature under their own id. */
const PLANS: Record<string, { plan: string; features: readonly FeatureKey[] }> = {
  pro_license: { plan: 'Pro', features: FEATURE_KEYS },
  team_license: { plan: 'Team', features: FEATURE_KEYS },
}

export const planOf = (productId: string): { plan: string; features: readonly FeatureKey[] } => PLANS[productId] ?? { plan: productId, features: FEATURE_KEYS }

/** What the licence allows for this run of the app. */
export interface Entitlements {
  plan: string
  features: readonly FeatureKey[]
}

let current: { plan: string; features: ReadonlySet<FeatureKey> } | null = null
let enforcing = ENFORCE_ENTITLEMENTS
/** Features already logged as "would block", so a render loop logs each one once. */
const reported = new Set<FeatureKey>()

/** Called once at startup with what the licence allows; null makes every feature available again. */
export function setEntitlements(next: Entitlements | null): void {
  current = next ? { plan: next.plan, features: new Set(next.features) } : null
  reported.clear()
}

/** For tests of the gating itself; the app always runs with ENFORCE_ENTITLEMENTS. */
export function setEntitlementEnforcement(on: boolean): void {
  enforcing = on
}

/** Whether the plan includes a feature, whether or not that is enforced. Settings shows this. */
export function includes(feature: FeatureKey): boolean {
  return current ? current.features.has(feature) : true
}

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

/** The sentence shown where a feature would be: hidden or disabled features say why. */
export function upgradeNote(feature: FeatureKey): string {
  const plan = current?.plan
  return `${FEATURES[feature].label} is not included in ${plan ? `the ${plan} plan` : 'your plan'}. See Settings, Account.`
}

/** Throws a plain message when a feature is not included. */
export function requireFeature(feature: FeatureKey): void {
  if (!can(feature)) throw new Error(upgradeNote(feature))
}
