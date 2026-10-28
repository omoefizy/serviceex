// Checks a licence token offline: a compact JWS signed with Ed25519, the same check as the server's reference
// verifier. A token is only used when its signature matches, it was made for this computer, and its 14 days offline
// have not run out (see ../../shared/license for what an expired one still shows).

import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import type { LicenseTokenPayload, TokenCheck } from '../../shared/license'

/** The payload without checking anything, or null when it cannot be read. For display and for the license id only. */
export function readPayload(token: string): LicenseTokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as LicenseTokenPayload
    return payload && typeof payload === 'object' && payload.typ === 'serviceex-license' ? payload : null
  } catch {
    return null
  }
}

export function publicKeyFromPem(pem: string): KeyObject | null {
  try {
    const key = createPublicKey(pem.trim())
    return key.asymmetricKeyType === 'ed25519' ? key : null
  } catch {
    return null
  }
}

export function verifyLicenseToken(token: string, publicKey: KeyObject | null, opts: { now?: Date; machineId: string }): TokenCheck {
  const parts = token.split('.')
  const payload = readPayload(token)
  if (parts.length !== 3 || !payload) return { valid: false, reason: 'malformed', payload: null }
  let header: { alg?: unknown }
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  } catch {
    return { valid: false, reason: 'malformed', payload: null }
  }
  if (header.alg !== 'EdDSA') return { valid: false, reason: 'malformed', payload: null }
  if (!publicKey) return { valid: false, reason: 'no_key', payload: null }
  let signed = false
  try {
    signed = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'))
  } catch {
    signed = false
  }
  // A token that fails its signature is never read further: none of its claims count.
  if (!signed) return { valid: false, reason: 'bad_signature', payload: null }
  if (payload.machine_id !== opts.machineId) return { valid: false, reason: 'wrong_machine', payload: null }
  const now = opts.now ?? new Date()
  const until = Date.parse(payload.offline_valid_until)
  if (Number.isNaN(until) || now.getTime() > until) return { valid: false, reason: 'expired', payload }
  return { valid: true, payload }
}
