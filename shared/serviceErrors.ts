// The error codes the ServiceEx server answers with ({ error: { code, message, details } }), and the sentence the
// operator sees for each. The server's own message and details are never shown as they are: a sentence here is
// always chosen instead, so nothing technical (and never a stack trace) reaches the screen.

export type ServiceErrorCode =
  | 'no_credit'
  | 'license_expired'
  | 'license_revoked'
  | 'seat_limit'
  | 'offline'
  | 'rate_limited'
  | 'ai_quota_exceeded'
  | 'validation_error'
  | 'unauthorized'
  | 'invalid_code'
  | 'not_found'
  | 'conflict'
  | 'payment_error'
  | 'upstream_error'
  | 'payload_too_large'
  /** This build has no server address (see electron/service/config). */
  | 'not_configured'
  /** Anything else the server or the network did, such as a 500 or a reply that is not JSON. */
  | 'unavailable'

const KNOWN: ReadonlySet<string> = new Set<ServiceErrorCode>([
  'no_credit',
  'license_expired',
  'license_revoked',
  'seat_limit',
  'offline',
  'rate_limited',
  'ai_quota_exceeded',
  'validation_error',
  'unauthorized',
  'invalid_code',
  'not_found',
  'conflict',
  'payment_error',
  'upstream_error',
  'payload_too_large',
  'not_configured',
  'unavailable',
])

export const isServiceErrorCode = (value: unknown): value is ServiceErrorCode => typeof value === 'string' && KNOWN.has(value)

/** A date from the server (ISO), as the operator reads dates. */
export function shortDate(iso: unknown): string | null {
  if (typeof iso !== 'string') return null
  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

const issuePaths = (details: Record<string, unknown> | undefined): string[] =>
  Array.isArray(details?.issues) ? details.issues.map((i) => String((i as { path?: unknown })?.path ?? '')) : []

/** The sentence for an error code, using only the details that are safe and useful to show. */
export function serviceErrorMessage(code: ServiceErrorCode, details?: Record<string, unknown>): string {
  switch (code) {
    case 'no_credit':
      return 'There are no cloud listening hours left. Listening carries on offline on this computer; buy more hours in Plans and Credits.'
    case 'license_expired':
      return 'Your license updates have expired, so this needs a renewal. WorshipDeck keeps working as it is.'
    case 'license_revoked':
      return 'This license has been revoked or refunded. WorshipDeck keeps working; contact ServiceEx if this is a mistake.'
    case 'seat_limit': {
      if (details?.reason === 'move_limit') {
        const next = shortDate(details.next_move_available_at)
        return `This license has used all its computer moves for the last 12 months.${next ? ` The next move is possible on ${next}.` : ''}`
      }
      if (details?.reason === 'not_activated') return 'This computer is no longer activated on the license. Sign in again to activate it.'
      const seats = typeof details?.seats === 'number' ? details.seats : null
      return `${seats === null ? 'Every computer' : seats === 1 ? 'The one computer' : `All ${seats} computers`} on this license ${seats === 1 ? 'is' : 'are'} in use. Deactivate another computer first, in Settings, Account on that computer.`
    }
    case 'offline':
      return 'ServiceEx could not be reached. Check the internet connection; everything offline keeps working.'
    case 'rate_limited': {
      const wait = typeof details?.retry_after_seconds === 'number' ? Math.ceil(details.retry_after_seconds) : null
      return wait ? `Too many requests. Try again in ${wait} seconds.` : 'Too many requests. Wait a minute and try again.'
    }
    case 'ai_quota_exceeded': {
      const resets = shortDate(details?.resets_at)
      return `This month's AI allowance is used up.${resets ? ` It resets on ${resets}.` : ''}`
    }
    case 'validation_error': {
      const paths = issuePaths(details)
      if (paths.includes('email')) return 'Enter a valid email address.'
      if (paths.includes('code')) return 'Enter the 6 digit code from the email.'
      return 'ServiceEx did not accept that request. Check what was entered and try again.'
    }
    case 'unauthorized':
      return 'You are signed out of ServiceEx. Sign in again in Settings, Account.'
    case 'invalid_code':
      return 'That code is wrong or has expired. Check the email, or ask for a new code.'
    case 'not_found':
      return 'ServiceEx could not find that.'
    case 'conflict':
      return 'That changed on ServiceEx in the meantime. Try again.'
    case 'payment_error':
      return 'Paystack could not confirm the payment yet. If you paid, it will show here once Paystack confirms it.'
    case 'upstream_error':
      return 'ServiceEx is having trouble right now. Try again shortly.'
    case 'payload_too_large':
      return 'That text is too long to send in one request.'
    case 'not_configured':
      return 'This build of WorshipDeck is not set up to connect to ServiceEx.'
    case 'unavailable':
      return 'ServiceEx is not answering properly right now. Try again shortly.'
  }
}
