// The licence kept on this computer and what it allows. There are no payments and no online checks yet: the default
// licence is the Founder plan with every feature, and the signature is kept for when licences are issued and signed.
//
// Offline friendly: the licence is read once at startup (see electron/license), so a feature never turns off during a
// service. After the expiry date the plan keeps working for the grace period, so a renewal that could not be checked
// because of a poor connection never stops a service. Nothing here touches the output windows.

import { FEATURE_KEYS, isFeatureKey, type Entitlements, type FeatureKey } from './features'

export const FOUNDER_PLAN = 'Founder'

export const DEFAULT_GRACE_DAYS = 30
export const GRACE_DAYS_LIMITS = [0, 365] as const

export interface License {
  plan: string
  /** The features the plan includes. The Founder plan includes every feature, whatever is listed. */
  features: FeatureKey[]
  /** How many computers may use it. */
  seats: number
  organization: string
  /** ISO dates (YYYY-MM-DD); a null expiry never expires. */
  issuedAt: string
  expiresAt: string | null
  /** Days the plan keeps working after the expiry date. */
  graceDays: number
  /** For signed licences later; null for now. */
  signature: string | null
  /** The key typed in Settings, Plan, later; null for now. */
  licenseKey: string | null
}

export const FOUNDER_LICENSE: License = {
  plan: FOUNDER_PLAN,
  features: [...FEATURE_KEYS],
  seats: 1,
  organization: '',
  issuedAt: '2026-01-01',
  expiresAt: null,
  graceDays: DEFAULT_GRACE_DAYS,
  signature: null,
  licenseKey: null,
}

const isoDate = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : undefined

const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value.trim() : undefined)

/** A licence read from disk with each field checked; null when it is not a licence at all. Unknown features are dropped. */
export function cleanLicense(value: unknown): License | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const l = value as Record<string, unknown>
  const plan = text(l.plan, 60)
  if (!plan) return null
  const seats = typeof l.seats === 'number' && Number.isInteger(l.seats) && l.seats > 0 && l.seats <= 10_000 ? l.seats : 1
  const grace = typeof l.graceDays === 'number' && Number.isFinite(l.graceDays) ? Math.round(l.graceDays) : DEFAULT_GRACE_DAYS
  return {
    plan,
    features: Array.isArray(l.features) ? [...new Set(l.features.filter(isFeatureKey))] : [],
    seats,
    organization: text(l.organization, 200) ?? '',
    issuedAt: isoDate(l.issuedAt) ?? FOUNDER_LICENSE.issuedAt,
    expiresAt: isoDate(l.expiresAt) ?? null,
    graceDays: Math.min(GRACE_DAYS_LIMITS[1], Math.max(GRACE_DAYS_LIMITS[0], grace)),
    signature: text(l.signature, 4096) || null,
    licenseKey: text(l.licenseKey, 500) || null,
  }
}

/** Active, past expiry but within the grace period, or expired. */
export type LicenseState = 'active' | 'grace' | 'expired'

export interface LicenseStatus {
  plan: string
  organization: string
  seats: number
  issuedAt: string
  expiresAt: string | null
  graceDays: number
  /** The last day of the grace period, when there is an expiry date. */
  graceEndsAt: string | null
  state: LicenseState
  /** What this run of the app allows: fixed at startup. */
  features: FeatureKey[]
  hasLicenseKey: boolean
  /** A sentence for Settings, Plan, when something needs attention. */
  message: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Adds days to an ISO date. */
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

/** Today as an ISO date, in local time like the dates the operator sees. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * What a licence allows on `day`. The licence counts through its expiry date and the grace period after it; once
 * that has passed, only the core of the app (songs, scripture, slides and the output) works.
 */
export function evaluateLicense(license: License, day: string = today()): LicenseStatus {
  const graceEndsAt = license.expiresAt ? addDays(license.expiresAt, license.graceDays) : null
  const state: LicenseState = !license.expiresAt || day <= license.expiresAt ? 'active' : graceEndsAt && day <= graceEndsAt ? 'grace' : 'expired'
  const included = license.plan === FOUNDER_PLAN ? [...FEATURE_KEYS] : license.features
  return {
    plan: license.plan,
    organization: license.organization,
    seats: license.seats,
    issuedAt: license.issuedAt,
    expiresAt: license.expiresAt,
    graceDays: license.graceDays,
    graceEndsAt,
    state,
    features: state === 'expired' ? [] : included,
    hasLicenseKey: license.licenseKey !== null,
    message:
      state === 'grace'
        ? `The ${license.plan} plan expired on ${license.expiresAt}. Everything keeps working until ${graceEndsAt}.`
        : state === 'expired'
          ? `The ${license.plan} plan expired on ${license.expiresAt}. Plan features are off until it is renewed.`
          : null,
  }
}

export const entitlementsOf = (status: LicenseStatus): Entitlements => ({ plan: status.plan, features: status.features })
