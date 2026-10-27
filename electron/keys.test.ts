// Keys only in developer builds: packaged without SERVICEEX_DEV, a saved key is never read and AI and cloud listening
// say the account is not connected yet. Older saved providers move to the new values. The key below is invented.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: true, getPath: () => '/nowhere' }, net: { isOnline: () => true } }))
vi.mock('electron', () => electron)

vi.mock('./db/index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { initSchema } = await import('./db/schema')
  const db = new Database(':memory:')
  initSchema(db)
  return { db }
})

vi.mock('./secrets', () => ({
  encryptionAvailable: () => true,
  hasSecret: () => true,
  readSecret: async () => 'test-key-invented-0000',
  saveSecret: async () => undefined,
  clearSecret: async () => undefined,
}))

const { AI_NOT_CONNECTED, CLOUD_NOT_CONNECTED } = await import('../shared/features')
const { db } = await import('./db/index')
const { getAppSettings, setAppSettings } = await import('./db/settings')
const { developerMode, hasProviderKey, keyProvider, missingKeyMessage, readProviderKey } = await import('./keys')
const { readyClient } = await import('./ai/client')

beforeEach(() => {
  db.exec('DELETE FROM settings')
  electron.app.isPackaged = true
  vi.stubEnv('SERVICEEX_DEV', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('a packaged build without SERVICEEX_DEV', () => {
  it('is not a developer build, and uses the account service whatever is saved', () => {
    setAppSettings({ aiKeyProvider: 'developer_key', speechKeyProvider: 'developer_key' })
    expect(developerMode()).toBe(false)
    expect(keyProvider('anthropic')).toBe('service')
    expect(keyProvider('deepgram')).toBe('service')
  })

  it('never reads a saved key', async () => {
    expect(hasProviderKey('deepgram')).toBe(false)
    expect(await readProviderKey('deepgram')).toBeNull()
    expect(await readProviderKey('anthropic')).toBeNull()
  })

  it('says the account is not connected yet instead of asking for a key', async () => {
    expect(missingKeyMessage('deepgram')).toBe(CLOUD_NOT_CONNECTED)
    expect(missingKeyMessage('anthropic')).toBe(AI_NOT_CONNECTED)
    expect(await readyClient()).toEqual({ ok: false, error: { code: 'no_key', message: AI_NOT_CONNECTED } })
  })
})

describe('a developer build', () => {
  it('is SERVICEEX_DEV=1, or running unpackaged', () => {
    vi.stubEnv('SERVICEEX_DEV', '1')
    expect(developerMode()).toBe(true)
    vi.stubEnv('SERVICEEX_DEV', '')
    electron.app.isPackaged = false
    expect(developerMode()).toBe(true)
  })

  it('uses the saved key with the developer key provider, and none with the account service', async () => {
    vi.stubEnv('SERVICEEX_DEV', '1')
    expect(keyProvider('deepgram')).toBe('developer_key')
    expect(await readProviderKey('deepgram')).toBe('test-key-invented-0000')
    setAppSettings({ speechKeyProvider: 'service' })
    expect(await readProviderKey('deepgram')).toBeNull()
    expect(missingKeyMessage('deepgram')).toBe(CLOUD_NOT_CONNECTED)
  })
})

describe('settings', () => {
  it('start offline on a first run', () => {
    expect(getAppSettings().speechEngine).toBe('whisper')
  })

  it('move providers saved by older versions to the new values, and drop unknown ones', () => {
    const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    put.run('ai.keyProvider', '"own"')
    put.run('speech.keyProvider', '"plan"')
    expect(getAppSettings()).toMatchObject({ aiKeyProvider: 'developer_key', speechKeyProvider: 'service' })
    db.exec('DELETE FROM settings')
    put.run('speech.keyProvider', '"someone_else"')
    expect(getAppSettings().speechKeyProvider).toBe('developer_key')
  })
})
