// The ServiceEx account as the renderer sees it. The main process holds the session tokens (encrypted with
// safeStorage) and makes every request; the renderer only gets this state and the results of its actions.

import type { LicenseStatus } from './license'
import type { ServiceErrorCode } from './serviceErrors'

/** Below this, the listener panel and Settings warn that cloud listening hours are running low. */
export const LOW_BALANCE_SECONDS = 30 * 60

export interface ListeningBalance {
  totalSeconds: number
  /** The batch of hours that expires first, and how much of it is left. */
  nearestExpiry: { expiresAt: string; seconds: number } | null
  /** When the server last said this (ISO time). */
  updatedAt: string
}

/** One pool of AI tokens: what it holds in all and what is left of it. */
export interface AiPool {
  tokens: number
  remainingTokens: number
}

/**
 * The AI uses an account has, in two pools: the one time trial (never resets) and the monthly allowance of its
 * licences. The server draws on the monthly pool first. remainingTokens is what both pools have left together.
 */
export interface AiAllowance {
  trial: AiPool
  monthly: AiPool
  remainingTokens: number
  /** When the monthly allowance starts again; null when no licence gives one. */
  resetsAt: string | null
}

/** All the tokens the allowance holds: the trial granted plus the monthly allowance, the same parts as remainingTokens. */
export function allowanceTotalTokens(allowance: AiAllowance): number {
  return allowance.trial.tokens + allowance.monthly.tokens
}

function percentOf(remaining: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)))
}

/** The share of the whole allowance left, as a whole percentage from 0 to 100. */
export function allowancePercentLeft(allowance: AiAllowance): number {
  return percentOf(allowance.remainingTokens, allowanceTotalTokens(allowance))
}

/** The share of one pool left, as a whole percentage from 0 to 100. */
export function poolPercentLeft(pool: AiPool): number {
  return percentOf(pool.remainingTokens, pool.tokens)
}

/** The allowance after an AI answer reports what is left in all; the monthly pool is used first, as on the server. */
export function withRemainingTokens(allowance: AiAllowance, tokens: number): AiAllowance {
  const left = Math.max(0, tokens)
  const monthlyLeft = Math.min(allowance.monthly.tokens, Math.max(0, left - allowance.trial.remainingTokens))
  return {
    ...allowance,
    remainingTokens: left,
    monthly: { ...allowance.monthly, remainingTokens: monthlyLeft },
    trial: { ...allowance.trial, remainingTokens: Math.min(allowance.trial.tokens, left - monthlyLeft) },
  }
}

/** What each order status means to the person who paid. */
export const ORDER_STATES: Record<string, string> = {
  pending: 'Waiting for payment',
  needs_review: 'Payment received, checking',
  expired: 'Expired',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
}

export const NEEDS_REVIEW_MESSAGE =
  'We received your payment and are checking it. If your license does not appear within an hour, contact support with your receipt number.'

export type ProductKind = 'license' | 'updates_renewal' | 'listening_credits'

/** A product from GET /products. Prices are in kobo, exactly as the server sends them. */
export interface Product {
  id: string
  name: string
  priceKobo: number
  currency: string
  kind: ProductKind
  seats: number | null
  listeningSeconds: number | null
  updatesMonths: number | null
}

export interface Order {
  id: string
  productName: string
  amountKobo: number
  currency: string
  status: string
  reference: string
  receiptNumber: string | null
  createdAt: string
  paidAt: string | null
}

/**
 * A purchase after the Paystack page has opened: waiting for the payment, then paid, being checked, failed, or no
 * longer polled (timed_out), in which case the order simply stays in Order history.
 */
export interface CheckoutProgress {
  reference: string
  productName: string
  state: 'waiting' | 'paid' | 'needs_review' | 'failed' | 'timed_out'
  message: string
}

export interface AccountState {
  /** This build knows the server's address. */
  configured: boolean
  /** The OS can encrypt the session (Keychain, DPAPI or a keyring); without it, signing in is refused. */
  encryptionAvailable: boolean
  signedIn: boolean
  email: string | null
  license: LicenseStatus
  balance: ListeningBalance | null
  allowance: AiAllowance | null
  /** The last purchase, while it is being confirmed and once it has finished. */
  checkout: CheckoutProgress | null
  /** Something about the account the operator should know, such as a refresh that failed. */
  notice: string | null
}

export interface AccountError {
  code: ServiceErrorCode
  message: string
}

export type AccountResult<T> = { ok: true; value: T } | { ok: false; error: AccountError }

export interface AccountApi {
  state(): Promise<AccountState>
  /** Emails a 6 digit code. */
  requestCode(email: string): Promise<AccountResult<null>>
  /** Signs in with the code, then activates this computer. */
  verifyCode(email: string, code: string): Promise<AccountResult<AccountState>>
  signOut(): Promise<AccountState>
  /** Asks the server for the licence, listening hours and AI allowance again. */
  refresh(): Promise<AccountResult<AccountState>>
  /** Frees this computer's seat on the licence. Counts as one of the licence's moves. */
  deactivate(): Promise<AccountResult<AccountState>>
  products(): Promise<AccountResult<Product[]>>
  orders(): Promise<AccountResult<Order[]>>
  /** Opens Paystack in the browser, then checks the payment for up to 3 minutes; progress arrives in the state. */
  buy(productId: string): Promise<AccountResult<null>>
  onChanged(listener: (state: AccountState) => void): () => void
}

/** Naira from kobo, exactly as the server priced it: ₦150,000 or ₦1,250.50. */
export function formatNaira(kobo: number, currency = 'NGN'): string {
  const amount = kobo / 100
  const digits = Number.isInteger(amount) ? 0 : 2
  if (currency !== 'NGN') return `${currency} ${amount.toLocaleString('en-NG', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`
}

/** "12 h 30 min", "45 min" or "0 min". */
export function formatHours(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export const isLowBalance = (balance: ListeningBalance | null): boolean =>
  balance !== null && balance.totalSeconds > 0 && balance.totalSeconds <= LOW_BALANCE_SECONDS
