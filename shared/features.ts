// Feature keys for device sharing. Every sharing capability asks here before it runs, in the main process and in
// the renderer, so a licence or plan can switch any of them off in one place. There is no entitlements module yet:
// until one registers itself with setEntitlements, every feature is available.

export const SHARING_FEATURES = [
  /** Cues: Send to device for a verse, song, point, note or free text. */
  'sharing.send',
  /** Hosting and joining a shared service. */
  'sharing.sharedService',
  /** Library sync of songs, themes, fonts, media and presentations. */
  'sharing.librarySync',
  /** Device chips with what each computer has live. */
  'sharing.presence',
  /** Named layouts of panels. */
  'sharing.layouts',
] as const

export type SharingFeature = (typeof SHARING_FEATURES)[number]

/** Answers whether a feature is included; the entitlements module provides it. */
export type EntitlementCheck = (feature: SharingFeature) => boolean

let check: EntitlementCheck | null = null

/** Called by the entitlements module, when there is one, to decide which features are available. */
export function setEntitlements(next: EntitlementCheck | null): void {
  check = next
}

export function hasFeature(feature: SharingFeature): boolean {
  return check ? check(feature) : true
}

/** Throws a plain message when a feature is not included. */
export function requireFeature(feature: SharingFeature): void {
  if (!hasFeature(feature)) throw new Error(`This feature (${feature}) is not included in your plan`)
}
