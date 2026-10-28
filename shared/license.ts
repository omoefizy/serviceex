// The licence on this computer: a token the ServiceEx server signs (Ed25519) when the computer is activated, checked
// here with the public key built into the app (see electron/service/licenseToken). It holds the plan, the seats and
// two dates:
//  - offline_valid_until, 14 days after it was issued. The app refreshes the token whenever it is online; a computer
//    kept offline longer than that falls back to the free features until it next connects.
//  - updates_until. Past it, the installed version keeps working with everything it had; only newer updates stop.
//
// What a licence allows is decided once at startup (see electron/license), so a feature never turns off during a
// service. Nothing here touches the output windows.

import { FREE_FEATURES, FREE_PLAN, planOf, type Entitlements, type FeatureKey } from './features'

/** The signed part of a licence token, as the server writes it. */
export interface LicenseTokenPayload {
  typ: 'serviceex-license'
  license_id: string
  account_id: string
  product_id: string
  seats: number
  machine_id: string
  updates_until: string
  updates_expired: boolean
  issued_at: string
  offline_valid_until: string
  iat: number
  exp: number
}

/** Why a token was not accepted. */
export type TokenProblem = 'malformed' | 'bad_signature' | 'expired' | 'wrong_machine' | 'no_key'

export type TokenCheck = { valid: true; payload: LicenseTokenPayload } | { valid: false; reason: TokenProblem; payload: LicenseTokenPayload | null }

/**
 * - none: no licence on this computer (free features).
 * - active: a valid token.
 * - offline_expired: a genuine token whose 14 days offline ran out; free features until the app is online again.
 * - invalid: a token that failed its check (tampered, for another computer, or no key to check it with).
 * - revoked: the server said the licence was revoked or refunded.
 */
export type LicenseState = 'none' | 'active' | 'offline_expired' | 'invalid' | 'revoked'

export interface LicenseStatus {
  state: LicenseState
  plan: string
  productId: string | null
  licenseId: string | null
  /** Computers the licence allows, and how many are activated (as of the last time the app was online). */
  seats: number | null
  seatsUsed: number | null
  updatesUntil: string | null
  /** Past updates_until: the app keeps working; only newer updates are not included. */
  updatesExpired: boolean
  issuedAt: string | null
  offlineValidUntil: string | null
  /** What this run of the app allows: fixed at startup. */
  features: FeatureKey[]
  /** A sentence for Settings, Account, when something needs attention. */
  message: string | null
}

/** What is saved beside the token: details the server sent for display only. They are not signed and decide nothing. */
export interface StoredLicense {
  token: string
  seatsUsed: number | null
  /** The last time the server confirmed the licence (ISO time). */
  checkedAt: string | null
}

export const NO_LICENSE: LicenseStatus = {
  state: 'none',
  plan: FREE_PLAN,
  productId: null,
  licenseId: null,
  seats: null,
  seatsUsed: null,
  updatesUntil: null,
  updatesExpired: false,
  issuedAt: null,
  offlineValidUntil: null,
  features: [...FREE_FEATURES],
  message: null,
}

const PROBLEMS: Record<TokenProblem, string> = {
  malformed: 'The licence saved on this computer could not be read. Sign in again to restore it.',
  bad_signature: 'The licence saved on this computer failed its signature check, so it was not used. Sign in again to restore it.',
  wrong_machine: 'The licence saved here belongs to another computer. Sign in again to activate this one.',
  expired: 'This computer has been offline for more than 14 days, so the licence needs checking. Connect to the internet and it will refresh by itself.',
  no_key: 'This build has no licence key to check licences with.',
}

/** What a checked token allows, at `now`. A token that fails its check gives the free features, never an error. */
export function licenseStatusOf(check: TokenCheck, stored: Pick<StoredLicense, 'seatsUsed'> | null, now = new Date()): LicenseStatus {
  const p = check.payload
  if (!p || (!check.valid && check.reason !== 'expired')) {
    return { ...NO_LICENSE, state: 'invalid', message: PROBLEMS[check.valid ? 'malformed' : check.reason] }
  }
  const { plan, features } = planOf(p.product_id)
  const updatesExpired = p.updates_expired || Date.parse(p.updates_until) <= now.getTime()
  const base: LicenseStatus = {
    state: check.valid ? 'active' : 'offline_expired',
    plan,
    productId: p.product_id,
    licenseId: p.license_id,
    seats: p.seats,
    seatsUsed: stored?.seatsUsed ?? null,
    updatesUntil: p.updates_until,
    updatesExpired,
    issuedAt: p.issued_at,
    offlineValidUntil: p.offline_valid_until,
    features: check.valid ? [...features] : [...FREE_FEATURES],
    message: null,
  }
  if (!check.valid) return { ...base, message: PROBLEMS.expired }
  if (updatesExpired) return { ...base, message: 'Updates expired, app keeps working. Renew updates in Plans and Credits to get newer versions.' }
  return base
}

export const entitlementsOf = (status: LicenseStatus): Entitlements => ({ plan: status.plan, features: status.features })

/** Today as an ISO date, in local time like the dates the operator sees. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
