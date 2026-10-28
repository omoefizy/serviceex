// The ServiceEx account in the main process: signing in with an emailed code, this computer's licence, the cloud
// listening hours, the AI allowance and purchases. Everything Electron-specific comes in through AccountDeps (see
// ../ipc/account), so this runs the same against a fake server in tests.
//
// The licence token is saved only after it passes the same check as at startup (signature, this computer). What it
// allows takes effect the next time the app starts; here it is only shown.

import type { KeyObject } from 'node:crypto'
import { NEEDS_REVIEW_MESSAGE, type AccountResult, type AccountState, type AiAllowance, type CheckoutProgress, type ListeningBalance, type Order, type Product, type ProductKind } from '../../shared/account'
import { licenseStatusOf, NO_ACCOUNT_LICENSE, NO_LICENSE, type LicenseStatus, type StoredLicense } from '../../shared/license'
import { serviceErrorMessage } from '../../shared/serviceErrors'
import { isServiceError, ServiceError, type ServiceClient } from './client'
import { readPayload, verifyLicenseToken } from './licenseToken'

/** How long a purchase is checked for after the Paystack page opens, and how often. */
export const CHECKOUT_POLL_MS = 3 * 60_000
export const CHECKOUT_POLL_EVERY_MS = 5000

export interface LicenseStore {
  load(): Promise<StoredLicense | null>
  save(license: StoredLicense): Promise<void>
  clear(): Promise<void>
}

export interface AccountDeps {
  client: ServiceClient
  licenses: LicenseStore
  machineId(): Promise<string>
  platform: 'windows' | 'macos' | 'linux'
  appVersion: string
  /** The key licence tokens are checked with, or null when this build has none. */
  publicKey(): KeyObject | null
  /** The id tokens must name for that key (packaged builds), or null to accept any. */
  keyId?(): string | null
  /** Compares the server's published key with the one the app checks with (and, in developer builds, may adopt it). */
  checkServerKey?(pem: string): string | null
  configured(): boolean
  encryptionAvailable(): boolean
  openExternal(url: string): Promise<void>
  onChange(state: AccountState): void
  now?(): Date
  sleep?(ms: number): Promise<void>
}

interface LicenseView {
  id: string
  product_id: string
  seats: number
  active_seats: number
  updates_until: string
  updates_expired: boolean
}

interface LicenseAnswer {
  license: LicenseView
  license_token: string
}

const ok = <T>(value: T): AccountResult<T> => ({ ok: true, value })

/** Any failure as a result for the renderer: a code and a sentence, nothing technical. */
function failure(error: unknown): { ok: false; error: { code: ServiceError['code']; message: string } } {
  if (isServiceError(error)) return { ok: false, error: { code: error.code, message: error.message } }
  console.error('Account action failed', error)
  return { ok: false, error: { code: 'unavailable', message: serviceErrorMessage('unavailable') } }
}

/** A problem worded for the operator, such as a licence that failed its check. */
class AccountNotice extends Error {}

const noticeOf = (error: unknown) => (isServiceError(error) || error instanceof AccountNotice ? error.message : serviceErrorMessage('unavailable'))

const KINDS: ProductKind[] = ['license', 'updates_renewal', 'listening_credits']

export class AccountService {
  private signedIn = false
  private email: string | null = null
  private license: LicenseStatus = NO_LICENSE
  private balance: ListeningBalance | null = null
  private allowance: AiAllowance | null = null
  private checkout: CheckoutProgress | null = null
  private notice: string | null = null
  /** Bumped by each purchase, so an older purchase's checks stop when a new one starts. */
  private checkoutRun = 0
  private productCache: Product[] | null = null
  /**
   * Whether activating is worth asking for when the server cannot list the account's licences: once per sign in (or
   * app start signed in) and per successful purchase, so an account without a licence is not asked about repeatedly.
   */
  private activationDue = false

  constructor(private readonly deps: AccountDeps) {}

  private now() {
    return this.deps.now?.() ?? new Date()
  }

  private sleep(ms: number) {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  state(): AccountState {
    return {
      configured: this.deps.configured(),
      encryptionAvailable: this.deps.encryptionAvailable(),
      signedIn: this.signedIn,
      email: this.email,
      license: this.license,
      balance: this.balance,
      allowance: this.allowance,
      checkout: this.checkout,
      notice: this.notice,
    }
  }

  private changed() {
    this.deps.onChange(this.state())
  }

  isSignedIn(): boolean {
    return this.signedIn
  }

  /** Reads the saved session and licence; then, when signed in, checks everything with the server in the background. */
  async init(): Promise<void> {
    const session = await this.deps.client.currentSession()
    this.signedIn = session !== null
    this.email = session?.email ?? null
    this.activationDue = this.signedIn
    this.license = await this.checkSavedLicense()
    this.changed()
    if (this.signedIn) void this.refresh()
  }

  /** The server rejected the session (see ServiceClient's onSignedOut). */
  signedOut(): void {
    this.signedIn = false
    this.email = null
    this.balance = null
    this.allowance = null
    this.notice = serviceErrorMessage('unauthorized')
    this.changed()
  }

  /** The saved licence token, checked as at startup. */
  async checkSavedLicense(): Promise<LicenseStatus> {
    const stored = await this.deps.licenses.load().catch(() => null)
    if (!stored) return NO_LICENSE
    const check = verifyLicenseToken(stored.token, this.deps.publicKey(), { machineId: await this.deps.machineId(), now: this.now(), keyId: this.deps.keyId?.() })
    return licenseStatusOf(check, stored, this.now())
  }

  // ---------- Signing in ----------

  async requestCode(email: unknown): Promise<AccountResult<null>> {
    const address = typeof email === 'string' ? email.trim() : ''
    if (!address || address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return { ok: false, error: { code: 'validation_error', message: 'Enter a valid email address.' } }
    }
    try {
      await this.deps.client.request('POST', '/auth/request-code', { body: { email: address }, auth: false })
      return ok(null)
    } catch (error) {
      return failure(error)
    }
  }

  async verifyCode(email: unknown, code: unknown): Promise<AccountResult<AccountState>> {
    const address = typeof email === 'string' ? email.trim() : ''
    const digits = typeof code === 'string' ? code.replace(/\s+/g, '') : ''
    if (!/^\d{6}$/.test(digits)) return { ok: false, error: { code: 'validation_error', message: 'Enter the 6 digit code from the email.' } }
    if (!this.deps.encryptionAvailable()) {
      return { ok: false, error: { code: 'validation_error', message: 'This computer cannot store the sign in securely (no keychain or keyring), so signing in is not possible here.' } }
    }
    try {
      const answer = await this.deps.client.request<{ access_token: string; refresh_token: string; expires_in: number; account: { email: string } }>(
        'POST',
        '/auth/verify',
        // The machine id claims this computer's one free listening grant.
        { body: { email: address, code: digits, machine_id: await this.deps.machineId() }, auth: false },
      )
      await this.deps.client.setSession({
        accessToken: answer.access_token,
        refreshToken: answer.refresh_token,
        expiresAt: this.now().getTime() + answer.expires_in * 1000,
        email: answer.account?.email ?? address,
      })
    } catch (error) {
      return failure(error)
    }
    this.signedIn = true
    this.activationDue = true
    this.email = (await this.deps.client.currentSession())?.email ?? address
    this.notice = null
    this.changed()
    await this.refresh()
    return ok(this.state())
  }

  async signOut(): Promise<AccountState> {
    this.checkoutRun++
    await this.deps.client.request('POST', '/auth/logout').catch(() => undefined)
    await this.deps.client.clearSession()
    this.signedIn = false
    this.email = null
    this.balance = null
    this.allowance = null
    this.checkout = null
    this.notice = null
    this.activationDue = false
    // The licence stays on this computer and keeps working offline; the seat is freed only by Deactivate.
    this.changed()
    return this.state()
  }

  // ---------- Refreshing ----------

  /** The licence, hours and allowance from the server. Offline, the last confirmed values stay. */
  async refresh(): Promise<AccountResult<AccountState>> {
    if (!this.signedIn) {
      this.license = await this.checkSavedLicense()
      this.changed()
      return ok(this.state())
    }
    const results = await Promise.allSettled([this.syncLicense(), this.refreshBalance(), this.refreshAllowance(), this.checkKey()])
    const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
    const offline = errors.find((e) => isServiceError(e) && e.code === 'offline')
    const other = errors.find((e) => !(isServiceError(e) && (e.code === 'offline' || e.code === 'unauthorized')))
    if (other) this.notice = noticeOf(other)
    else if (offline) this.notice = `${serviceErrorMessage('offline')} Showing what was last confirmed.`
    else if (this.signedIn) this.notice = null
    this.changed()
    if (errors.length > 0 && errors.length === results.length) {
      const first = other ?? offline ?? errors[0]
      return { ok: false, error: { code: isServiceError(first) ? first.code : 'unavailable', message: noticeOf(first) } }
    }
    return ok(this.state())
  }

  private async checkKey() {
    if (!this.deps.checkServerKey) return
    const answer = await this.deps.client.request<{ public_key_pem: string }>('GET', '/.well-known/license-key', { auth: false })
    const problem = typeof answer?.public_key_pem === 'string' ? this.deps.checkServerKey(answer.public_key_pem) : null
    if (problem) throw new AccountNotice(problem)
  }

  /**
   * Refreshes this computer's licence token, or activates the computer when the account has a licence. An account
   * without one is the free plan, not a problem: nothing is logged or shown as an error.
   */
  async syncLicense(): Promise<void> {
    const machineId = await this.deps.machineId()
    const stored = await this.deps.licenses.load().catch(() => null)
    const licenseId = stored ? readPayload(stored.token)?.license_id : undefined
    try {
      if (licenseId) {
        try {
          return await this.keep(
            await this.deps.client.request<LicenseAnswer>('GET', '/licenses/refresh', {
              query: { license_id: licenseId, machine_id: machineId, app_version: this.deps.appVersion },
            }),
          )
        } catch (error) {
          // Not activated any more, or a licence of another account: activate afresh below.
          if (!isServiceError(error) || !(error.code === 'not_found' || (error.code === 'seat_limit' && error.details.reason === 'not_activated'))) throw error
        }
      }
      if (!(await this.accountHasLicense())) return await this.noLicense()
      this.activationDue = false
      await this.keep(
        await this.deps.client.request<LicenseAnswer>('POST', '/licenses/activate', {
          body: { machine_id: machineId, platform: this.deps.platform, app_version: this.deps.appVersion },
          quiet: ['not_found'],
        }),
      )
    } catch (error) {
      if (!isServiceError(error)) throw error
      if (error.code === 'not_found') return await this.noLicense()
      if (error.code === 'license_revoked') {
        await this.deps.licenses.clear()
        this.license = { ...NO_LICENSE, state: 'revoked', message: error.message }
        return
      }
      if (error.code === 'seat_limit') {
        // Every seat is taken elsewhere. Nothing is blocked: the free features stay, with the reason shown.
        await this.deps.licenses.clear()
        this.license = { ...NO_LICENSE, message: error.message }
        return
      }
      throw error
    }
  }

  /** From the account's licence list; a server without the list leaves it to activationDue. */
  private async accountHasLicense(): Promise<boolean> {
    try {
      const answer = await this.deps.client.request<{ licenses?: unknown[] }>('GET', '/licenses', { quiet: ['not_found'] })
      if (Array.isArray(answer?.licenses)) return answer.licenses.length > 0
    } catch (error) {
      if (!isServiceError(error) || error.code !== 'not_found') throw error
    }
    return this.activationDue
  }

  /** The account has no licence: the free plan. */
  private async noLicense() {
    await this.deps.licenses.clear()
    this.license = NO_ACCOUNT_LICENSE
  }

  /** Saves a token from the server, but only one that passes the same check as at startup. */
  private async keep(answer: LicenseAnswer): Promise<void> {
    const check = verifyLicenseToken(answer.license_token, this.deps.publicKey(), { machineId: await this.deps.machineId(), now: this.now(), keyId: this.deps.keyId?.() })
    if (!check.valid) {
      console.error('The licence token from the server did not pass its check', check.reason)
      throw new AccountNotice(
        check.reason === 'no_key'
          ? 'This build has no licence key to check licences with.'
          : check.reason === 'unknown_key'
            ? 'This licence was signed with a newer key than this version of WorshipDeck knows. Update WorshipDeck to use it.'
            : 'The licence from ServiceEx could not be checked, so it was not saved.',
      )
    }
    const stored: StoredLicense = { token: answer.license_token, seatsUsed: answer.license.active_seats, checkedAt: this.now().toISOString() }
    await this.deps.licenses.save(stored)
    this.license = licenseStatusOf(check, stored, this.now())
  }

  async refreshBalance(): Promise<void> {
    const b = await this.deps.client.request<{ total_seconds: number; nearest_expiry: { expires_at: string; seconds: number } | null }>('GET', '/listening/balance')
    this.balance = {
      totalSeconds: b.total_seconds,
      nearestExpiry: b.nearest_expiry ? { expiresAt: b.nearest_expiry.expires_at, seconds: b.nearest_expiry.seconds } : null,
      updatedAt: this.now().toISOString(),
    }
  }

  async refreshAllowance(): Promise<void> {
    const a = await this.deps.client.request<{ monthly_tokens: number; used_tokens: number; remaining_tokens: number; resets_at: string | null; one_time?: boolean }>(
      'GET',
      '/ai/allowance',
    )
    // A one time trial says so, or comes without a reset date.
    const oneTime = a.one_time === true || !a.resets_at
    this.allowance = {
      monthlyTokens: a.monthly_tokens,
      usedTokens: a.used_tokens,
      remainingTokens: a.remaining_tokens,
      resetsAt: oneTime ? null : a.resets_at,
      oneTime,
    }
  }

  /** The hours left, as a listening heartbeat reports them. */
  setBalanceSeconds(seconds: number): void {
    const nearest = this.balance?.nearestExpiry ?? null
    this.balance = {
      totalSeconds: Math.max(0, seconds),
      nearestExpiry: nearest ? { ...nearest, seconds: Math.min(nearest.seconds, Math.max(0, seconds)) } : null,
      updatedAt: this.now().toISOString(),
    }
    this.changed()
  }

  /** The tokens left this month, as an AI answer reports them. */
  setAllowanceRemaining(tokens: number): void {
    if (!this.allowance) return
    this.allowance = { ...this.allowance, remainingTokens: tokens, usedTokens: Math.max(this.allowance.usedTokens, this.allowance.monthlyTokens - tokens) }
    this.changed()
  }

  /** Re-reads the balance after listening, quietly. */
  async balanceChanged(): Promise<void> {
    if (!this.signedIn) return
    await this.refreshBalance().then(() => this.changed(), () => undefined)
  }

  // ---------- Deactivating ----------

  async deactivate(): Promise<AccountResult<AccountState>> {
    if (!this.signedIn) return { ok: false, error: { code: 'unauthorized', message: serviceErrorMessage('unauthorized') } }
    const stored = await this.deps.licenses.load().catch(() => null)
    const licenseId = stored ? readPayload(stored.token)?.license_id : undefined
    if (!licenseId) return { ok: false, error: { code: 'not_found', message: 'This computer is not activated on a licence.' } }
    try {
      await this.deps.client.request('POST', '/licenses/deactivate', { body: { license_id: licenseId, machine_id: await this.deps.machineId() } })
    } catch (error) {
      return failure(error)
    }
    await this.deps.licenses.clear()
    this.license = { ...NO_LICENSE, message: 'This computer was deactivated. Its seat is free for another computer.' }
    this.changed()
    return ok(this.state())
  }

  // ---------- Buying ----------

  async products(): Promise<AccountResult<Product[]>> {
    try {
      const answer = await this.deps.client.request<{ products: { id: string; name: string; price_kobo: number; currency: string; grant: Record<string, unknown> }[] }>(
        'GET',
        '/products',
        { auth: false },
      )
      const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
      this.productCache = answer.products
        .filter((p) => KINDS.includes(p.grant?.kind as ProductKind))
        .map((p) => ({
          id: p.id,
          name: p.name,
          priceKobo: p.price_kobo,
          currency: p.currency,
          kind: p.grant.kind as ProductKind,
          seats: number(p.grant.seats),
          listeningSeconds: number(p.grant.listeningSeconds),
          updatesMonths: number(p.grant.updatesMonths),
        }))
      return ok(this.productCache)
    } catch (error) {
      return failure(error)
    }
  }

  async orders(): Promise<AccountResult<Order[]>> {
    try {
      const answer = await this.deps.client.request<{
        orders: { id: string; product_name: string; amount_kobo: number; currency: string; status: string; reference: string; receipt_number: string | null; created_at: string; paid_at: string | null }[]
      }>('GET', '/orders')
      return ok(
        answer.orders.map((o) => ({
          id: o.id,
          productName: o.product_name,
          amountKobo: o.amount_kobo,
          currency: o.currency,
          status: o.status,
          reference: o.reference,
          receiptNumber: o.receipt_number,
          createdAt: o.created_at,
          paidAt: o.paid_at,
        })),
      )
    } catch (error) {
      return failure(error)
    }
  }

  /** Starts a purchase: opens Paystack in the browser, then checks for the payment in the background. */
  async buy(productId: unknown): Promise<AccountResult<null>> {
    if (typeof productId !== 'string' || !productId) return { ok: false, error: { code: 'validation_error', message: 'Choose something to buy.' } }
    if (!this.signedIn) return { ok: false, error: { code: 'unauthorized', message: 'Sign in first, in Settings, Account.' } }
    if (!this.productCache) await this.products()
    const product = this.productCache?.find((p) => p.id === productId)
    // A renewal extends the licence this computer is activated on.
    const licenseId = product?.kind === 'updates_renewal' ? (this.license.licenseId ?? undefined) : undefined
    if (product?.kind === 'updates_renewal' && !licenseId) {
      return { ok: false, error: { code: 'validation_error', message: 'Updates can be renewed once this computer is activated on a licence.' } }
    }
    let started: { reference: string; authorization_url: string }
    try {
      started = await this.deps.client.request('POST', '/checkout/start', { body: { product_id: productId, ...(licenseId ? { license_id: licenseId } : {}) } })
    } catch (error) {
      return failure(error)
    }
    const run = ++this.checkoutRun
    this.checkout = {
      reference: started.reference,
      productName: product?.name ?? productId,
      state: 'waiting',
      message: 'Finish paying on the Paystack page in your browser. This updates by itself once the payment is confirmed.',
    }
    this.changed()
    try {
      await this.deps.openExternal(started.authorization_url)
    } catch (error) {
      console.error('Could not open the payment page', error)
      this.finishCheckout(run, 'failed', 'The payment page could not be opened in the browser. Try again.')
      return { ok: false, error: { code: 'unavailable', message: 'The payment page could not be opened in the browser.' } }
    }
    void this.pollCheckout(run, started.reference)
    return ok(null)
  }

  /**
   * Asks the server to confirm the payment every few seconds for up to 3 minutes; on success, reloads everything. With
   * no answer by then it stops quietly: the order stays in Order history with its status.
   */
  async pollCheckout(run: number, reference: string): Promise<void> {
    const until = this.now().getTime() + CHECKOUT_POLL_MS
    while (run === this.checkoutRun && this.now().getTime() < until) {
      await this.sleep(CHECKOUT_POLL_EVERY_MS)
      if (run !== this.checkoutRun) return
      try {
        const answer = await this.deps.client.request<{ result: string; order: { status: string } }>('POST', '/checkout/verify', { body: { reference } })
        if (answer.order.status === 'paid') {
          this.finishCheckout(run, 'paid', 'Payment received. Thank you.')
          this.activationDue = true
          await this.refresh()
          return
        }
        if (answer.order.status === 'needs_review') {
          this.finishCheckout(run, 'needs_review', NEEDS_REVIEW_MESSAGE)
          return
        }
        if (answer.order.status === 'expired') {
          this.finishCheckout(run, 'failed', 'This order expired before a payment arrived. Buy again to start a new one.')
          return
        }
        if (answer.order.status === 'failed' || answer.order.status === 'refunded') {
          this.finishCheckout(run, 'failed', 'The payment did not go through. Nothing was charged for this order.')
          return
        }
      } catch (error) {
        // Paystack not done yet, or a dropped connection: keep checking. A lost session ends the checks.
        if (isServiceError(error) && error.code === 'unauthorized') {
          this.finishCheckout(run, 'failed', error.message)
          return
        }
      }
    }
    if (run === this.checkoutRun) {
      this.finishCheckout(run, 'timed_out', 'Its status is in Order history.')
    }
  }

  private finishCheckout(run: number, state: CheckoutProgress['state'], message: string) {
    if (run !== this.checkoutRun || !this.checkout) return
    this.checkout = { ...this.checkout, state, message }
    this.changed()
  }
}
