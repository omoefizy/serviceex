import { createCipheriv, pbkdf2Sync } from 'node:crypto'
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { legacyKeychainPassword, openMacSafeStorage, rekeyLegacySecrets } from './legacySecrets'
import { makeTempDirSync, removeTempSync } from './tempDir.test-helper'

const OLD_PASSWORD = 'old-keychain-password'

/** Seals as Chromium's OSCrypt does on macOS (what WorshipDeck's safeStorage wrote). */
function macSeal(plain: string, password: string): Buffer {
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain, 'utf8'), cipher.final()])
}

/** Stands in for safeStorage under the new name. */
const newSeal = (plain: string) => Buffer.from(`new:${plain}`)

describe('openMacSafeStorage', () => {
  it('opens what the old name sealed', () => {
    expect(openMacSafeStorage(macSeal('{"refresh":"abc"}', OLD_PASSWORD), OLD_PASSWORD)).toBe('{"refresh":"abc"}')
  })

  it('refuses a wrong password and anything that is not a v10 blob', () => {
    const blob = macSeal('sk-ant-1234567890', OLD_PASSWORD)
    for (let i = 0; i < 50; i++) expect(() => openMacSafeStorage(blob, `wrong-${i}`)).toThrow()
    expect(() => openMacSafeStorage(Buffer.from('v11abcdefabcdefabcdef'), OLD_PASSWORD)).toThrow()
  })
})

describe('legacyKeychainPassword', () => {
  it('reads the old Safe Storage item', async () => {
    const run = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes('worshipdeck Safe Storage')) return `${OLD_PASSWORD}\n`
      throw Object.assign(new Error('not found'), { code: 44 })
    })
    expect(await legacyKeychainPassword(run)).toEqual({ password: OLD_PASSWORD })
    expect(run).toHaveBeenCalledWith('/usr/bin/security', ['find-generic-password', '-w', '-s', 'worshipdeck Safe Storage'])
  })

  it('tells a missing item from one it was not allowed to read', async () => {
    expect(await legacyKeychainPassword(async () => Promise.reject(Object.assign(new Error('not found'), { code: 44 })))).toBe('missing')
    expect(await legacyKeychainPassword(async () => Promise.reject(Object.assign(new Error('denied'), { code: 51 })))).toBe('unavailable')
  })
})

describe('rekeyLegacySecrets', () => {
  let folder: string
  const migratedAt = Date.parse('2026-10-31T12:00:00Z')
  const log = { info: vi.fn(), error: vi.fn() }
  const age = (file: string, ms: number) => utimesSync(file, new Date(ms), new Date(ms))

  beforeEach(() => {
    folder = makeTempDirSync('serviceex-secrets-')
    log.error.mockClear()
  })
  afterEach(() => removeTempSync(folder))

  it('seals the old keys again under the new name, the paired devices included', () => {
    writeFileSync(path.join(folder, 'serviceex-session.enc'), macSeal('{"session":"s"}', OLD_PASSWORD))
    writeFileSync(path.join(folder, 'anthropic-key.enc'), macSeal('sk-ant-123', OLD_PASSWORD))
    mkdirSync(path.join(folder, 'sharing'))
    const peers = path.join(folder, 'sharing', 'peers.json')
    writeFileSync(peers, JSON.stringify({ deviceId: 'device-1', peers: [{ id: 'p1', name: 'Booth', secret: macSeal('c2VjcmV0', OLD_PASSWORD).toString('base64') }] }))
    for (const file of ['serviceex-session.enc', 'anthropic-key.enc', 'sharing/peers.json']) age(path.join(folder, file), migratedAt - 1000)

    const result = rekeyLegacySecrets({ folder, since: migratedAt, password: OLD_PASSWORD, seal: newSeal, log })

    expect({ ...result, rekeyed: [...result.rekeyed].sort() }).toEqual({ rekeyed: ['anthropic-key.enc', 'serviceex-session.enc', 'sharing/peers.json'], failed: [] })
    expect(readFileSync(path.join(folder, 'serviceex-session.enc'), 'utf8')).toBe('new:{"session":"s"}')
    expect(readFileSync(path.join(folder, 'anthropic-key.enc'), 'utf8')).toBe('new:sk-ant-123')
    const stored = JSON.parse(readFileSync(peers, 'utf8'))
    expect(stored.deviceId).toBe('device-1')
    expect(stored.peers[0]).toMatchObject({ id: 'p1', name: 'Booth' })
    expect(Buffer.from(stored.peers[0].secret, 'base64').toString()).toBe('new:c2VjcmV0')
  })

  it('leaves files written since the move, and blobs that will not open', () => {
    const fresh = path.join(folder, 'deepgram-key.enc')
    writeFileSync(fresh, 'sealed by ServiceEx')
    age(fresh, migratedAt + 60_000)
    const broken = path.join(folder, 'anthropic-key.enc')
    writeFileSync(broken, macSeal('sk', 'some other password'))
    age(broken, migratedAt - 1000)

    const result = rekeyLegacySecrets({ folder, since: migratedAt, password: OLD_PASSWORD, seal: newSeal, log })

    expect(result).toEqual({ rekeyed: [], failed: ['anthropic-key.enc'] })
    expect(readFileSync(fresh, 'utf8')).toBe('sealed by ServiceEx')
    expect(log.error).toHaveBeenCalledOnce()
  })
})
