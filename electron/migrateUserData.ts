// Imported first by main.ts, before ./db opens the database: moves WorshipDeck's data folder into ServiceEx's on the
// first launch after the rename (see ./userDataMigration). finishUserDataMigration then re-seals the encrypted keys
// once the app is ready, before anything reads them (see ./legacySecrets).

import { app, safeStorage } from 'electron'
import { legacyKeychainPassword, rekeyLegacySecrets } from './legacySecrets'
import { encryptionAvailable } from './secrets'
import { migrateUserData, readMarker, writeMarker } from './userDataMigration'

try {
  migrateUserData({ appData: app.getPath('appData'), newDir: app.getPath('userData') })
} catch (error) {
  // migrateUserData never throws; this only guards the app's start.
  console.error('Data folder migration failed', error)
}

/** Re-seals the old keys under the new name, once. Never throws; what cannot be carried over is entered again. */
export async function finishUserDataMigration(): Promise<void> {
  try {
    const folder = app.getPath('userData')
    const marker = readMarker(folder)
    if (marker?.outcome !== 'migrated' || marker.secrets !== 'pending') return
    if (!encryptionAvailable()) return
    const answer = await legacyKeychainPassword()
    if (answer === 'unavailable') {
      console.error('Could not read the WorshipDeck Keychain item; the saved keys will be carried over next launch.')
      return
    }
    if (answer !== 'missing') {
      const { rekeyed, failed } = rekeyLegacySecrets({
        folder,
        since: Date.parse(marker.at),
        password: answer.password,
        seal: (plain) => safeStorage.encryptString(plain),
      })
      console.info(`Carried over ${rekeyed.length} saved keys${failed.length ? `; ${failed.length} need entering again` : ''}.`)
    }
    writeMarker(folder, { ...marker, secrets: 'done' })
  } catch (error) {
    console.error('Could not carry over the saved keys', error)
  }
}
