// Every feature that a plan can include, by key. Each feature asks can() where it starts, in the main process and in
// the renderer, so a plan can switch any of them off in one place. The licence (see ./license) decides which keys are
// on, once at startup; until setEntitlements is called, every feature is available.

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

/** What the licence allows for this run of the app. */
export interface Entitlements {
  plan: string
  features: readonly FeatureKey[]
}

let current: { plan: string; features: ReadonlySet<FeatureKey> } | null = null

/** Called once at startup with what the licence allows; null makes every feature available again. */
export function setEntitlements(next: Entitlements | null): void {
  current = next ? { plan: next.plan, features: new Set(next.features) } : null
}

export function can(feature: FeatureKey): boolean {
  return current ? current.features.has(feature) : true
}

/** The name sharing has always asked with; the same as can. */
export const hasFeature = can

/** The sentence shown where a feature would be: hidden or disabled features say why. */
export function upgradeNote(feature: FeatureKey): string {
  const plan = current?.plan
  return `${FEATURES[feature].label} is not included in ${plan ? `the ${plan} plan` : 'your plan'}. See Settings, Plan.`
}

/** Throws a plain message when a feature is not included. */
export function requireFeature(feature: FeatureKey): void {
  if (!can(feature)) throw new Error(upgradeNote(feature))
}
