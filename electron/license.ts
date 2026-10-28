// This computer's licence: the token the ServiceEx server signed when the computer was activated, kept as
// <userData>/serviceex-license.json. It is checked once at startup (signature, this computer, 14 days offline) and what
// it allows stays fixed until the app restarts, so a feature never turns off during a service. A missing, broken or
// tampered file gives the free plan; while ENFORCE_ENTITLEMENTS is false that blocks nothing.

import { app, ipcMain } from 'electron'
import type { KeyObject } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setEntitlements } from '../shared/features'
import { entitlementsOf, licenseStatusOf, NO_LICENSE, type LicenseStatus, type StoredLicense } from '../shared/license'
import { developerMode } from './keys'
import type { LicenseStore } from './service/account'
import { LICENSE_PUBLIC_KEY_PEM } from './service/config'
import { publicKeyFromPem, verifyLicenseToken } from './service/licenseToken'
import { machineId } from './service/machineId'

const licenseFile = (folder: string) => path.join(folder, 'serviceex-license.json')
/** Developer builds without a built-in key keep the server's key here (see adoptServerKey). */
const devKeyFile = (folder: string) => path.join(folder, 'license-key.dev.pem')

const isStored = (value: unknown): value is StoredLicense =>
  !!value && typeof (value as StoredLicense).token === 'string' && (value as StoredLicense).token.length < 8192

/** The licence file in `folder`. Not secret: the token is signed, so changing it only makes it fail its check. */
export function licenseStore(folder = app.getPath('userData')): LicenseStore {
  return {
    async load() {
      try {
        const parsed: unknown = JSON.parse(await readFile(licenseFile(folder), 'utf8'))
        return isStored(parsed) ? { token: parsed.token, seatsUsed: typeof parsed.seatsUsed === 'number' ? parsed.seatsUsed : null, checkedAt: parsed.checkedAt ?? null } : null
      } catch {
        return null
      }
    },
    save: (license) => writeFile(licenseFile(folder), `${JSON.stringify(license, null, 2)}\n`),
    clear: () => rm(licenseFile(folder), { force: true }),
  }
}

const bundledKey = publicKeyFromPem(LICENSE_PUBLIC_KEY_PEM)
let devKey: KeyObject | null | undefined

/** The key tokens are checked with: the one built into the app, or in developer builds without one, the server's. */
export function licensePublicKey(folder = app.getPath('userData')): KeyObject | null {
  if (bundledKey) return bundledKey
  if (!developerMode()) return null
  if (devKey === undefined) {
    const file = devKeyFile(folder)
    devKey = existsSync(file) ? publicKeyFromPem(readFileSync(file, 'utf8')) : null
  }
  return devKey
}

/**
 * Compares the key the server publishes with the one the app checks with. Returns a sentence when they differ. A
 * developer build without a built-in key adopts the server's key instead.
 */
export function adoptServerKey(pem: string, folder = app.getPath('userData')): string | null {
  const served = publicKeyFromPem(pem)
  if (!served) return null
  const same = (a: KeyObject, b: KeyObject) => a.export({ format: 'der', type: 'spki' }).equals(b.export({ format: 'der', type: 'spki' }))
  if (bundledKey) {
    if (same(bundledKey, served)) return null
    console.error('The licence key ServiceEx publishes does not match the one built into this app')
    return 'The licence key ServiceEx uses does not match this version of WorshipDeck, so licences cannot be checked. Update WorshipDeck.'
  }
  if (!developerMode()) return null
  if (!devKey || !same(devKey, served)) {
    devKey = served
    writeFile(devKeyFile(folder), served.export({ format: 'pem', type: 'spki' }).toString()).catch(console.error)
  }
  return null
}

let status: LicenseStatus | null = null

/** Decides this run's features from the saved licence. Called once, before anything that checks a feature starts. */
export async function loadLicense(folder = app.getPath('userData')): Promise<LicenseStatus> {
  try {
    const stored = await licenseStore(folder).load()
    status = stored
      ? licenseStatusOf(verifyLicenseToken(stored.token, licensePublicKey(folder), { machineId: await machineId(folder) }), stored)
      : NO_LICENSE
  } catch (error) {
    console.error('Could not check the licence; using the free plan', error)
    status = NO_LICENSE
  }
  setEntitlements(entitlementsOf(status))
  return status
}

/** What this run allows; the licence as it is now (which may have changed since startup) is in the account state. */
export const startupLicense = (): LicenseStatus => status ?? NO_LICENSE

export function registerLicenseIpc(): void {
  ipcMain.handle('license:status', () => startupLicense())
  // Asked synchronously as the operator window starts, so its first render already knows its features.
  ipcMain.on('license:entitlements', (event) => {
    event.returnValue = entitlementsOf(startupLicense())
  })
}
