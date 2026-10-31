// Keeps the encrypted keys readable across the rename. On macOS Electron's safeStorage seals with a password kept in the
// Keychain item "<app.name> Safe Storage", so after the rename it looks for "ServiceEx Safe Storage" and cannot open
// what WorshipDeck sealed (the API keys, the account session, the paired devices' keys). Once, after the data folder
// moved (see ./userDataMigration), the old password is read from the Keychain item "worshipdeck Safe Storage" (macOS
// may ask to allow it), each old blob is opened with it as Chromium's OSCrypt sealed it (v10: AES-128-CBC with a key
// made by PBKDF2 from that password), and sealed again with safeStorage under the new name. The old Keychain item is
// left alone. On Windows the key lives in the copied Local State file, so the blobs open as they are.
//
// No Electron here: the Keychain lookup and the new sealing are passed in, so the tests run it in Node.

import { execFile } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { LEGACY_APP_NAMES, type MigrationLog } from './userDataMigration'

/** Opens a blob WorshipDeck's safeStorage sealed on macOS. Throws when the password does not fit. */
export function openMacSafeStorage(blob: Buffer, password: string): string {
  if (blob.subarray(0, 3).toString('latin1') !== 'v10') throw new Error('Not a macOS safeStorage blob')
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  const plain = Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]).toString('utf8')
  // A wrong password can still pass the padding check now and then; every value sealed here is printable text.
  if (!/^[\x20-\x7e\t\r\n]*$/.test(plain)) throw new Error('The blob did not open with this password')
  return plain
}

export type KeychainAnswer = { password: string } | 'missing' | 'unavailable'

type Run = (file: string, args: string[]) => Promise<string>

const runSecurity: Run = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 120_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })

/**
 * The old safeStorage password from the Keychain. "missing" when no old item exists (nothing was ever sealed),
 * "unavailable" when it could not be read (access refused, timed out), to try again next launch.
 */
export async function legacyKeychainPassword(run: Run = runSecurity): Promise<KeychainAnswer> {
  let refused = false
  for (const name of LEGACY_APP_NAMES) {
    try {
      const password = (await run('/usr/bin/security', ['find-generic-password', '-w', '-s', `${name} Safe Storage`])).replace(/\n$/, '')
      if (password) return { password }
    } catch (error) {
      // 44 is errSecItemNotFound; anything else (a refused prompt, a timeout) may work another time.
      if ((error as { code?: unknown }).code !== 44) refused = true
    }
  }
  return refused ? 'unavailable' : 'missing'
}

export interface RekeyOptions {
  /** The new userData folder. */
  folder: string
  /** When the folder was copied: files changed after that were sealed by ServiceEx and are left alone. */
  since: number
  password: string
  /** safeStorage.encryptString under the new name. */
  seal: (plain: string) => Buffer
  log?: MigrationLog
}

function writeAtomic(file: string, data: Buffer | string): void {
  const temp = `${file}.tmp`
  writeFileSync(temp, data, { mode: 0o600 })
  renameSync(temp, file)
}

const untouchedSince = (file: string, since: number) => statSync(file).mtimeMs <= since

/** Re-seals every old blob it can open. A blob that will not open is left as it is (that key is entered again). */
export function rekeyLegacySecrets({ folder, since, password, seal, log = console }: RekeyOptions): { rekeyed: string[]; failed: string[] } {
  const rekeyed: string[] = []
  const failed: string[] = []

  for (const name of readdirSync(folder).filter((entry) => entry.endsWith('.enc'))) {
    const file = path.join(folder, name)
    if (!untouchedSince(file, since)) continue
    try {
      writeAtomic(file, seal(openMacSafeStorage(readFileSync(file), password)))
      rekeyed.push(name)
    } catch (error) {
      failed.push(name)
      log.error(`Could not carry over ${name}; it needs entering again.`, error)
    }
  }

  // The paired devices' keys, each sealed on its own inside peers.json.
  const peersFile = path.join(folder, 'sharing', 'peers.json')
  if (existsSync(peersFile) && untouchedSince(peersFile, since)) {
    try {
      const stored = JSON.parse(readFileSync(peersFile, 'utf8')) as { peers?: { secret?: unknown }[] }
      let changed = false
      for (const peer of Array.isArray(stored.peers) ? stored.peers : []) {
        if (typeof peer?.secret !== 'string') continue
        try {
          peer.secret = seal(openMacSafeStorage(Buffer.from(peer.secret, 'base64'), password)).toString('base64')
          changed = true
        } catch (error) {
          failed.push('sharing/peers.json')
          log.error('Could not carry over a paired device; it needs pairing again.', error)
        }
      }
      if (changed) {
        writeAtomic(peersFile, JSON.stringify(stored, null, 2))
        rekeyed.push('sharing/peers.json')
      }
    } catch (error) {
      failed.push('sharing/peers.json')
      log.error('Could not read the paired devices to carry them over.', error)
    }
  }
  return { rekeyed, failed }
}
