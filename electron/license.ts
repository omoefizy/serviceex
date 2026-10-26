// The licence file, <userData>/license.json. It is read once at startup and what it allows stays fixed until the app
// restarts, so a feature never turns off during a service. A missing file is written with the Founder plan; a file
// that cannot be read or makes no sense also gives the Founder plan, so a licence problem never stops the app.

import { app, ipcMain } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setEntitlements } from '../shared/features'
import { cleanLicense, entitlementsOf, evaluateLicense, FOUNDER_LICENSE, type License, type LicenseStatus } from '../shared/license'

/** Reads the licence in `folder`, writing the Founder licence there first when there is none. Never throws. */
export function readLicense(folder: string): License {
  const file = path.join(folder, 'license.json')
  try {
    if (!existsSync(file)) {
      writeFileSync(file, `${JSON.stringify(FOUNDER_LICENSE, null, 2)}\n`)
      return FOUNDER_LICENSE
    }
    const license = cleanLicense(JSON.parse(readFileSync(file, 'utf8')))
    if (license) return license
    console.error('license.json is not a licence; using the Founder plan')
  } catch (error) {
    console.error('Could not read license.json; using the Founder plan', error)
  }
  return FOUNDER_LICENSE
}

let status: LicenseStatus | null = null

/** Decides this run's features from the licence. Called once, before anything that checks a feature starts. */
export function loadLicense(folder = app.getPath('userData')): LicenseStatus {
  try {
    status = evaluateLicense(readLicense(folder))
  } catch (error) {
    console.error('Could not check the licence; using the Founder plan', error)
    status = evaluateLicense(FOUNDER_LICENSE)
  }
  setEntitlements(entitlementsOf(status))
  return status
}

export function registerLicenseIpc(): void {
  ipcMain.handle('license:status', () => status ?? loadLicense())
  // Asked synchronously as the operator window starts, so its first render already knows its features.
  ipcMain.on('license:entitlements', (event) => {
    event.returnValue = entitlementsOf(status ?? loadLicense())
  })
}
