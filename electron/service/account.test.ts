// The account against a fake ServiceEx server on this computer: signing in with a code activates the computer and
// saves a checked licence; tokens renew by themselves; server errors read as plain sentences, never the server's own
// text; a purchase is confirmed by polling. Emails, ids and amounts are invented.
import type { KeyObject } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { allowancePercentLeft, allowanceTotalTokens, poolPercentLeft, type AccountState } from '../../shared/account'
import type { StoredLicense } from '../../shared/license'
import { AccountService, CHECKOUT_POLL_EVERY_MS, CHECKOUT_POLL_MS, type LicenseStore } from './account'
import { ServiceClient, type StoredSession } from './client'
import { FAKE_CODE, FakeServiceServer } from './fakeServer.test-helper'

const MACHINE = 'wd1-fellowship-hall-laptop-0001'
const server = new FakeServiceServer()

let saved: StoredSession | null
let licenseFile: StoredLicense | null
let states: AccountState[]
let opened: string[]
let client: ServiceClient
let account: AccountService
let key: KeyObject | null
/** What the Privacy setting gives: the install id while sharing is on, null while off. */
let installId: string | null

function setUp(now = () => Date.now(), sleep: (ms: number) => Promise<void> = async () => undefined) {
  saved = null
  licenseFile = null
  states = []
  opened = []
  key = server.publicKey
  installId = null
  client = new ServiceClient({
    baseUrl: () => server.url,
    fetch: (url, init) => fetch(url, init),
    store: { load: async () => saved, save: async (s) => void (saved = s), clear: async () => void (saved = null) },
    onSignedOut: () => account.signedOut(),
    now,
  })
  const licenses: LicenseStore = { load: async () => licenseFile, save: async (l) => void (licenseFile = l), clear: async () => void (licenseFile = null) }
  account = new AccountService({
    client,
    licenses,
    machineId: async () => MACHINE,
    platform: 'macos',
    appVersion: '1.4.0',
    installId: async () => installId,
    publicKey: () => key,
    configured: () => true,
    encryptionAvailable: () => true,
    openExternal: async (url) => void opened.push(url),
    onChange: (state) => states.push(state),
    now: () => new Date(now()),
    // Checks a purchase without waiting in real time.
    sleep,
  })
}

beforeAll(async () => {
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

beforeEach(() => {
  server.requests.length = 0
  server.licenses = []
  server.orders = []
  server.balanceSeconds = 2 * 3600
  server.aiTrialTokens = 0
  server.aiTrialRemaining = 0
  server.failWith = null
  server.expireAccessToken = false
  server.listsLicenses = true
  setUp()
})

const signIn = async () => {
  expect(await account.requestCode(server.email)).toEqual({ ok: true, value: null })
  return account.verifyCode(server.email, FAKE_CODE)
}

describe('signing in', () => {
  it('emails a code, signs in with it, activates this computer and loads the hours and allowance', async () => {
    const license = server.addLicense('team_license', 3)
    const result = await signIn()
    expect(result.ok).toBe(true)
    const state = account.state()
    expect(state).toMatchObject({ signedIn: true, email: server.email, notice: null })
    expect(state.license).toMatchObject({ state: 'active', plan: 'Team', seats: 3, seatsUsed: 1, licenseId: license.id })
    expect(state.balance).toMatchObject({ totalSeconds: 7200, nearestExpiry: { expiresAt: '2027-03-01T00:00:00.000Z', seconds: 7200 } })
    expect(state.allowance).toMatchObject({ remainingTokens: 20_000 })
    // The machine id goes with the code (for the free grant) and the activation; the tokens stay in the store.
    expect(server.calls('/auth/verify')[0].body).toEqual({ email: server.email, code: FAKE_CODE, machine_id: MACHINE, platform: 'macos', app_version: '1.4.0' })
    expect(server.calls('/licenses/activate')[0].body).toEqual({ machine_id: MACHINE, platform: 'macos', app_version: '1.4.0' })
    expect(saved?.email).toBe(server.email)
    expect(JSON.stringify(state)).not.toContain(saved!.accessToken)
    expect(licenseFile?.token.split('.')).toHaveLength(3)
  })

  it('sends the install id with the code only while sharing the install count', async () => {
    installId = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b'
    expect((await signIn()).ok).toBe(true)
    expect(server.calls('/auth/verify')[0].body).toMatchObject({ platform: 'macos', app_version: '1.4.0', install_id: installId })
  })

  it('counts the trial in the total when more is left than the licence allowance', async () => {
    server.addLicense()
    server.aiTrialTokens = 20_000
    server.aiTrialRemaining = 14_200
    await signIn()
    const allowance = account.state().allowance!
    expect(allowance).toEqual({
      trial: { tokens: 20_000, remainingTokens: 14_200 },
      monthly: { tokens: 20_000, remainingTokens: 20_000 },
      remainingTokens: 34_200,
      resetsAt: '2026-11-01T00:00:00.000Z',
    })
    expect(allowance.remainingTokens).toBeGreaterThan(allowance.monthly.tokens)
    expect(allowanceTotalTokens(allowance)).toBe(40_000)
    expect(allowancePercentLeft(allowance)).toBe(86)
    expect(poolPercentLeft(allowance.trial)).toBe(71)
    expect(poolPercentLeft(allowance.monthly)).toBe(100)
  })

  it('is the free plan when the account has no licence', async () => {
    await signIn()
    expect(account.state().license).toMatchObject({ state: 'none', plan: 'Free', message: 'No license on this account yet. Buy one in Plans and Credits.' })
    expect(licenseFile).toBeNull()
  })

  it('says a wrong code plainly, without the server’s own text', async () => {
    const result = await account.verifyCode(server.email, '000000')
    expect(result).toEqual({ ok: false, error: { code: 'invalid_code', message: 'That code is wrong or has expired. Check the email, or ask for a new code.' } })
    expect(account.state().signedIn).toBe(false)
  })

  it('never saves a licence token that fails its check', async () => {
    server.addLicense()
    // A key that is not the server's: every token fails its signature check.
    const { generateKeyPairSync } = await import('node:crypto')
    setUp()
    key = generateKeyPairSync('ed25519').publicKey
    await signIn()
    expect(licenseFile).toBeNull()
    expect(account.state().notice).toBe('The licence from ServiceEx could not be checked, so it was not saved.')
  })
})

describe('tokens', () => {
  it('renew by themselves when the server rejects the access token, and the request goes through', async () => {
    await signIn()
    const before = saved!.accessToken
    server.expireAccessToken = true
    expect((await account.refresh()).ok).toBe(true)
    expect(saved!.accessToken).not.toBe(before)
    expect(server.calls('/auth/refresh')).toHaveLength(1)
  })

  it('renew before they expire', async () => {
    let clock = Date.now()
    setUp(() => clock)
    await signIn()
    clock += 3600 * 1000
    await account.refresh()
    expect(server.calls('/auth/refresh')).toHaveLength(1)
  })

  it('sign out when the refresh token is rejected too', async () => {
    await signIn()
    // A restart with a session the server no longer knows.
    setUp()
    saved = { accessToken: 'invented-stale-access', refreshToken: 'invented-stale-refresh-0000000000', expiresAt: Date.now() + 3600_000, email: server.email }
    await account.init()
    await vi.waitFor(() => expect(account.state().signedIn).toBe(false))
    expect(saved).toBeNull()
    expect(account.state().notice).toBe('You are signed out of ServiceEx. Sign in again in Settings, Account.')
  })
})

describe('errors', () => {
  it('turn each server code into a sentence, never the server’s message or a stack trace', async () => {
    await signIn()
    const cases: [number, string, Record<string, unknown> | undefined, RegExp][] = [
      [402, 'no_credit', undefined, /no cloud listening hours left/],
      [403, 'license_expired', undefined, /updates have expired.*keeps working/],
      [403, 'license_revoked', undefined, /revoked or refunded/],
      [409, 'seat_limit', { seats: 3 }, /All 3 computers on this license are in use/],
      [409, 'seat_limit', { reason: 'move_limit', next_move_available_at: '2027-02-14T09:00:00.000Z' }, /used all its computer moves.*2027/],
      [503, 'offline', undefined, /could not be reached/],
      [429, 'rate_limited', { retry_after_seconds: 60 }, /Try again in 60 seconds/],
      [429, 'ai_quota_exceeded', { resets_at: '2026-11-01T00:00:00.000Z' }, /allowance is used up\. It resets on/],
      [400, 'validation_error', { issues: [{ path: 'email', message: 'Invalid email' }] }, /Enter a valid email address/],
      [401, 'unauthorized', undefined, /signed out/],
    ]
    for (const [status, code, details, message] of cases) {
      server.failWith = { status, code, details }
      const result = await account.orders()
      expect(result.ok, code).toBe(false)
      if (result.ok) continue
      expect(result.error.code, code).toBe(code)
      expect(result.error.message, code).toMatch(message)
      expect(result.error.message, code).not.toMatch(/server says|src\/|at Object/)
    }
  })

  it('call a server that cannot be reached offline', async () => {
    const down = new ServiceClient({ baseUrl: () => 'http://127.0.0.1:9', fetch: (url, init) => fetch(url, init), store: { load: async () => null, save: async () => undefined, clear: async () => undefined } })
    await expect(down.request('GET', '/products', { auth: false })).rejects.toMatchObject({ code: 'offline' })
  })
})

describe('an account without a licence', () => {
  const NO_LICENSE_YET = 'No license on this account yet. Buy one in Plans and Credits.'

  it('reads the licence list and never asks to activate', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await signIn()
    await account.refresh()
    expect(server.calls('/licenses/activate')).toHaveLength(0)
    expect(account.state()).toMatchObject({ notice: null, license: { state: 'none', plan: 'Free', message: NO_LICENSE_YET } })
    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
  })

  it('treats a 404 from activate as the free plan, asking once per sign in and again after a purchase', async () => {
    // A server without the licence list: activate is the only way to find out, and it answers 404 not_found.
    server.listsLicenses = false
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await signIn()).ok).toBe(true)
    expect(server.calls('/licenses/activate')).toHaveLength(1)
    expect(account.state()).toMatchObject({ notice: null, license: { state: 'none', plan: 'Free', message: NO_LICENSE_YET } })
    expect(logged).not.toHaveBeenCalled()

    expect(await account.refresh()).toMatchObject({ ok: true })
    expect(await account.refresh()).toMatchObject({ ok: true })
    expect(server.calls('/licenses/activate')).toHaveLength(1)
    expect(account.state()).toMatchObject({ notice: null, license: { message: NO_LICENSE_YET } })

    // A licence bought: the confirmed purchase activates this computer.
    const bought = server.addLicense()
    const paid = new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (server.orders[0]?.status === 'pending') {
          server.orders[0].status = 'paid'
          clearInterval(timer)
          resolve()
        }
      }, 5)
    })
    await account.buy('pro_license')
    await paid
    await vi.waitFor(() => expect(account.state().license).toMatchObject({ state: 'active', licenseId: bought.id }))
    expect(server.calls('/licenses/activate')).toHaveLength(2)
    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
  })
})

describe('deactivating', () => {
  it('frees the seat and removes the licence from this computer', async () => {
    const license = server.addLicense()
    await signIn()
    const result = await account.deactivate()
    expect(result.ok).toBe(true)
    expect(license.active).toEqual([])
    expect(licenseFile).toBeNull()
    expect(account.state().license).toMatchObject({ state: 'none', message: expect.stringMatching(/deactivated/) })
  })

  it('explains the move limit with the date the next move is possible', async () => {
    const license = server.addLicense()
    await signIn()
    license.moves = 3
    const result = await account.deactivate()
    expect(result).toMatchObject({ ok: false, error: { code: 'seat_limit', message: expect.stringMatching(/computer moves for the last 12 months\. The next move is possible on/) } })
    expect(licenseFile).not.toBeNull()
  })
})

describe('buying', () => {
  it('lists products with prices exactly as the server sends them', async () => {
    const products = await account.products()
    expect(products).toMatchObject({ ok: true, value: [{ id: 'listening_10h', priceKobo: 1_500_000, currency: 'NGN', kind: 'listening_credits', listeningSeconds: 36000 }, { id: 'pro_license', kind: 'license', seats: 1 }] })
  })

  it('opens Paystack, polls until the payment is confirmed, then reloads the hours', async () => {
    await signIn()
    const verified = new Promise<void>((resolve) => {
      // After two checks the order is paid, with ten more hours.
      const timer = setInterval(() => {
        if (server.calls('/checkout/verify').length >= 2 && server.orders[0]?.status === 'pending') {
          server.orders[0].status = 'paid'
          server.balanceSeconds += 36_000
          clearInterval(timer)
          resolve()
        }
      }, 5)
    })
    expect(await account.buy('listening_10h')).toEqual({ ok: true, value: null })
    expect(opened).toEqual([`https://checkout.paystack.com/${server.orders[0].reference}`])
    expect(account.state().checkout).toMatchObject({ state: 'waiting', productName: 'Cloud listening, 10 hours' })
    await verified
    await vi.waitFor(() => expect(account.state().checkout?.state).toBe('paid'))
    await vi.waitFor(() => expect(account.state().balance?.totalSeconds).toBe(7200 + 36_000))
  })

  it('stops checking quietly after 3 minutes', async () => {
    let clock = Date.now()
    // Each wait between checks moves the clock on by the poll interval.
    setUp(() => clock, async (ms) => void (clock += ms))
    await signIn()
    await account.buy('listening_10h')
    await vi.waitFor(() => expect(account.state().checkout?.state).toBe('timed_out'))
    // Every 5 seconds for 3 minutes.
    expect(server.calls('/checkout/verify')).toHaveLength(CHECKOUT_POLL_MS / CHECKOUT_POLL_EVERY_MS)
    expect(account.state().checkout?.message).not.toMatch(/not been confirmed/)
  })
})
