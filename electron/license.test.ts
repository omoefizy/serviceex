// The licence on this computer: a token signed by the (fake) ServiceEx server, checked offline. A genuine token works
// for 14 days offline; a tampered one, one for another computer, or a broken file is never used and gives the free
// plan; expired updates keep every feature. The ids, dates and keys are invented.
import { generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTempDirSync, removeTempSync } from './tempDir.test-helper'

const electron = vi.hoisted(() => ({ app: { isPackaged: true, getPath: () => '/nowhere' }, ipcMain: { handle: () => undefined, on: () => undefined } }))
vi.mock('electron', () => electron)
vi.mock('./keys', () => ({ developerMode: () => false }))
const machine = vi.hoisted(() => ({ id: 'wd1-machine-of-grace-chapel-0001' }))
vi.mock('./service/machineId', () => ({ machineId: async () => machine.id }))
// The fake server's key stands in for the one built into the app.
const keyHolder = vi.hoisted(() => ({ pem: '' }))
vi.mock('./service/config', () => ({
  get LICENSE_PUBLIC_KEY_PEM() {
    return keyHolder.pem
  },
  MACHINE_ID_SALT: 'test-salt',
}))

const { FakeServiceServer } = await import('./service/fakeServer.test-helper')
const server = new FakeServiceServer()
keyHolder.pem = server.publicKeyPem

const { can, FEATURE_KEYS, FREE_FEATURES, includes, setEntitlements } = await import('../shared/features')
const { licenseStatusOf } = await import('../shared/license')
const { keyIdOf, verifyLicenseToken, publicKeyFromPem } = await import('./service/licenseToken')
const { loadLicense } = await import('./license')

const DAY = 24 * 3600 * 1000
const issued = new Date('2026-10-01T10:00:00.000Z')
let folder: string
let license: ReturnType<typeof server.addLicense>

beforeAll(() => {
  license = server.addLicense('pro_license', 1)
})

beforeEach(() => {
  folder = makeTempDirSync('worshipdeck-license-')
})

afterEach(() => {
  removeTempSync(folder)
  setEntitlements(null)
})

const check = (token: string, now: Date, machineId = machine.id) => verifyLicenseToken(token, server.publicKey, { now, machineId })

describe('offline grace', () => {
  it('keeps a genuine token working for 14 days offline, then falls back to the free features until it is refreshed', () => {
    const token = server.tokenFor(license, machine.id, issued)
    const day13 = new Date(issued.getTime() + 13 * DAY)
    const day15 = new Date(issued.getTime() + 15 * DAY)

    const within = licenseStatusOf(check(token, day13), { seatsUsed: 1 }, day13)
    expect(within).toMatchObject({ state: 'active', plan: 'Pro', seats: 1, seatsUsed: 1, offlineValidUntil: '2026-10-15T10:00:00.000Z' })
    expect(within.features).toEqual(FEATURE_KEYS)

    const after = licenseStatusOf(check(token, day15), { seatsUsed: 1 }, day15)
    expect(check(token, day15)).toMatchObject({ valid: false, reason: 'expired' })
    expect(after).toMatchObject({ state: 'offline_expired', plan: 'Pro', features: [...FREE_FEATURES] })
    expect(after.message).toMatch(/offline for more than 14 days/)
  })
})

describe('a token that fails its check', () => {
  it('is rejected when its payload is changed, even with a plausible signature', () => {
    const token = server.tokenFor(license, machine.id, issued)
    const [header, body, signature] = token.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    // More seats and ten more years of updates, keeping the original signature.
    const forged = Buffer.from(JSON.stringify({ ...payload, seats: 50, updates_until: '2036-10-01T00:00:00.000Z' })).toString('base64url')
    const tampered = `${header}.${forged}.${signature}`

    expect(check(tampered, issued)).toEqual({ valid: false, reason: 'bad_signature', payload: null })
    const status = licenseStatusOf(check(tampered, issued), null, issued)
    expect(status).toMatchObject({ state: 'invalid', plan: 'Free', seats: null, updatesUntil: null })
    expect(status.message).toMatch(/failed its signature check/)
  })

  it('is rejected when signed with another key, made for another computer, or not a token at all', () => {
    const stranger = generateKeyPairSync('ed25519').privateKey
    const payload = JSON.parse(Buffer.from(server.tokenFor(license, machine.id, issued).split('.')[1], 'base64url').toString('utf8'))
    expect(check(server.signToken(payload, stranger), issued).valid).toBe(false)
    expect(check(server.tokenFor(license, 'wd1-another-computer-0002', issued), issued)).toMatchObject({ valid: false, reason: 'wrong_machine' })
    expect(check('not.a.token', issued)).toMatchObject({ valid: false, reason: 'malformed' })
    expect(verifyLicenseToken(server.tokenFor(license, machine.id, issued), null, { now: issued, machineId: machine.id })).toMatchObject({ reason: 'no_key' })
    expect(publicKeyFromPem('-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----')).toBeNull()
  })
})

describe('expired updates', () => {
  it('keep every feature and say the app keeps working', () => {
    const lapsed = { ...license, updates_until: '2026-09-01T00:00:00.000Z' }
    const status = licenseStatusOf(check(server.tokenFor(lapsed, machine.id, issued), issued), null, issued)
    expect(status).toMatchObject({ state: 'active', updatesExpired: true, features: FEATURE_KEYS })
    expect(status.message).toMatch(/^Updates expired, app keeps working/)
  })
})

describe('at startup', () => {
  it('fixes this run’s features from a valid saved token', async () => {
    writeFileSync(path.join(folder, 'serviceex-license.json'), JSON.stringify({ token: server.tokenFor(license, machine.id), seatsUsed: 1, checkedAt: null }))
    const status = await loadLicense(folder)
    expect(status).toMatchObject({ state: 'active', plan: 'Pro' })
    expect(FEATURE_KEYS.every(includes)).toBe(true)
  })

  it('gives the free plan for no licence, a broken file or a tampered token, and still blocks nothing', async () => {
    expect(await loadLicense(folder)).toMatchObject({ state: 'none', plan: 'Free' })
    writeFileSync(path.join(folder, 'serviceex-license.json'), '{not json')
    expect(await loadLicense(folder)).toMatchObject({ state: 'none', plan: 'Free' })
    const [h, , s] = server.tokenFor(license, machine.id).split('.')
    writeFileSync(path.join(folder, 'serviceex-license.json'), JSON.stringify({ token: `${h}.${Buffer.from('{"typ":"serviceex-license"}').toString('base64url')}.${s}` }))
    expect(await loadLicense(folder)).toMatchObject({ state: 'invalid', plan: 'Free' })
    expect(includes('themes.editor')).toBe(false)
    // ENFORCE_ENTITLEMENTS is false: nothing is blocked.
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    expect(can('themes.editor')).toBe(true)
    info.mockRestore()
  })

  it('asks for an update when a token names a key this version does not know', async () => {
    const payload = JSON.parse(Buffer.from(server.tokenFor(license, machine.id).split('.')[1], 'base64url').toString('utf8'))
    const token = server.signToken(payload, server.keys.privateKey, 'ed25519-aNewerKey012')
    writeFileSync(path.join(folder, 'serviceex-license.json'), JSON.stringify({ token, seatsUsed: 1, checkedAt: null }))
    const status = await loadLicense(folder)
    expect(status).toMatchObject({ state: 'invalid', plan: 'Free' })
    expect(status.message).toMatch(/Update WorshipDeck/)
  })
})

describe('the built-in key', () => {
  it('is the production Ed25519 key, with the id the server gives it', async () => {
    const config = await vi.importActual<typeof import('./service/config')>('./service/config')
    const key = publicKeyFromPem(config.LICENSE_PUBLIC_KEY_PEM)
    expect(key).not.toBeNull()
    expect(keyIdOf(key!)).toBe('ed25519-xuDBNVVVtmbR')
  })
})
