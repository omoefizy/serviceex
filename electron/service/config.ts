// Where the ServiceEx server is, and the key its licences are signed with. This is the only place either is set.
//
// The server address is fixed when the app is built: SERVICEEX_API_URL in the environment of `vite build` becomes
// __SERVICEEX_API_URL__ (see vite.config.ts). Developer builds may point elsewhere at run time with the same variable,
// such as SERVICEEX_API_URL=http://localhost:3000 for a local server.

import { developerMode } from '../keys'

declare const __SERVICEEX_API_URL__: string | undefined

const BUILD_API_URL = typeof __SERVICEEX_API_URL__ === 'string' ? __SERVICEEX_API_URL__ : ''

/**
 * The Ed25519 public key licence tokens are checked with, as served by GET /.well-known/license-key (public_key_pem).
 * Developer builds check with the key the server serves instead when it differs, so they work against a local server.
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxuDBNVVVtmbRycGSk4AzrHBxWctznn4TwEUEdAOXYRI=
-----END PUBLIC KEY-----
`

/** Salt for the machine id, so the id sent to the server cannot be matched to the computer's own identifiers. */
export const MACHINE_ID_SALT = 'serviceex.desktop.machine-id.v1'

const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/** The server's base URL without a trailing slash, or null when this build has none (or it is not https). */
export function apiBaseUrl(): string | null {
  const override = developerMode() ? process.env.SERVICEEX_API_URL?.trim() : ''
  const raw = (override || BUILD_API_URL).trim().replace(/\/+$/, '')
  if (!raw) return null
  try {
    const url = new URL(raw)
    // Plain http only to this computer, for a local development server.
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) return null
    return raw
  } catch {
    return null
  }
}
