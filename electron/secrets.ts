// API keys, encrypted with Electron's safeStorage (Keychain on macOS, DPAPI on Windows, the keyring on Linux) and
// kept as <userData>/<name>.enc. Main process only: keys are never sent to the renderer, never read from the
// environment or a plain file, and never live in the repository.

import { app, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type SecretName = 'anthropic-key' | 'deepgram-key'

const secretFile = (name: SecretName) => path.join(app.getPath('userData'), `${name}.enc`)

/** True when keys can be stored encrypted. Linux without a keyring falls back to plain text, which we refuse. */
export function encryptionAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  return !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
}

export function hasSecret(name: SecretName): boolean {
  return existsSync(secretFile(name))
}

export async function saveSecret(name: SecretName, value: string): Promise<void> {
  if (!encryptionAvailable()) throw new Error('This system cannot encrypt the key')
  await writeFile(secretFile(name), safeStorage.encryptString(value), { mode: 0o600 })
}

/** The decrypted key, or null when none is saved or it can no longer be decrypted. */
export async function readSecret(name: SecretName): Promise<string | null> {
  if (!hasSecret(name) || !encryptionAvailable()) return null
  try {
    return safeStorage.decryptString(await readFile(secretFile(name)))
  } catch {
    return null
  }
}

export async function clearSecret(name: SecretName): Promise<void> {
  await rm(secretFile(name), { force: true })
}
