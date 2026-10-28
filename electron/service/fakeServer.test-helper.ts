// A fake ServiceEx server for tests, on 127.0.0.1 with a random port. It answers the routes the app uses with the
// real server's shapes and error format, signs licence tokens with its own throwaway Ed25519 key, and keeps every
// request so tests can check what was sent. All data is invented.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import type { AddressInfo } from 'node:net'

export const FAKE_CODE = '246810'
const DAY = 24 * 3600 * 1000

type Json = Record<string, unknown>

export interface FakeLicense {
  id: string
  product_id: string
  seats: number
  active: string[]
  updates_until: string
  status: 'active' | 'revoked'
  moves: number
}

export class FakeServiceServer {
  readonly keys = generateKeyPairSync('ed25519')
  private server: Server | null = null
  url = ''
  /** Every request, in order. */
  readonly requests: { method: string; path: string; body: Json; auth: string | null }[] = []

  // ---- What the account has; tests change these directly. ----
  email = 'deacon.ada@example.org'
  licenses: FakeLicense[] = []
  balanceSeconds = 2 * 3600
  nearestExpiry: { expires_at: string; seconds: number } | null = { expires_at: '2027-03-01T00:00:00.000Z', seconds: 7200 }
  aiRemaining = 20_000
  /** What /ai/run answers with, per task. */
  aiOutputs: Record<string, string> = {}
  /** Seconds billed for each heartbeat, whatever the client reports; null bills what it reports. */
  billPerHeartbeat: number | null = null
  /** Orders by reference; a test marks one paid to finish a checkout. */
  orders: Json[] = []
  /** Answers every request with this error while set (to test the client's handling). */
  failWith: { status: number; code: string; message?: string; details?: Json } | null = null
  /** When set, the next response with this access token says it expired, once. */
  expireAccessToken = false
  offlineDays = 14
  now = () => new Date()

  private accessTokens = new Set<string>()
  private refreshTokens = new Set<string>()
  readonly sessions = new Map<string, { status: 'active' | 'closed'; reason?: string; billed: number }>()

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
    return this
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()))
  }

  get publicKey(): KeyObject {
    return this.keys.publicKey
  }

  get publicKeyPem(): string {
    return this.keys.publicKey.export({ format: 'pem', type: 'spki' }).toString()
  }

  /** A licence token as the server signs it. */
  signToken(payload: Json, key: KeyObject = this.keys.privateKey): string {
    const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url')
    const header = b64(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'ed25519-fake' }))
    const body = b64(JSON.stringify(payload))
    return `${header}.${body}.${b64(sign(null, Buffer.from(`${header}.${body}`), key))}`
  }

  tokenFor(license: FakeLicense, machineId: string, issuedAt = this.now()): string {
    const until = new Date(issuedAt.getTime() + this.offlineDays * DAY)
    return this.signToken({
      typ: 'serviceex-license',
      license_id: license.id,
      account_id: 'acc0000000000000000000001',
      product_id: license.product_id,
      seats: license.seats,
      machine_id: machineId,
      updates_until: license.updates_until,
      updates_expired: Date.parse(license.updates_until) <= issuedAt.getTime(),
      issued_at: issuedAt.toISOString(),
      offline_valid_until: until.toISOString(),
      iat: Math.floor(issuedAt.getTime() / 1000),
      exp: Math.floor(until.getTime() / 1000),
    })
  }

  addLicense(productId = 'pro_license', seats = 1): FakeLicense {
    const license: FakeLicense = {
      id: randomBytes(12).toString('hex'),
      product_id: productId,
      seats,
      active: [],
      updates_until: new Date(this.now().getTime() + 365 * DAY).toISOString(),
      status: 'active',
      moves: 0,
    }
    this.licenses.push(license)
    return license
  }

  /** Requests to a path, such as '/listening/sessions/:id/heartbeat' matched by its ending. */
  calls(pathEnd: string) {
    return this.requests.filter((r) => r.path.endsWith(pathEnd) || r.path.split('?')[0].endsWith(pathEnd))
  }

  private issueSession() {
    const access = randomBytes(24).toString('hex')
    const refresh = randomBytes(24).toString('hex')
    this.accessTokens.add(access)
    this.refreshTokens.add(refresh)
    return { access_token: access, refresh_token: refresh, expires_in: 3600 }
  }

  private view(l: FakeLicense) {
    return {
      id: l.id,
      product_id: l.product_id,
      seats: l.seats,
      active_seats: l.active.length,
      updates_until: l.updates_until,
      updates_expired: Date.parse(l.updates_until) <= this.now().getTime(),
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = (raw ? JSON.parse(raw) : {}) as Json
    const url = new URL(req.url ?? '/', this.url)
    const auth = req.headers.authorization ?? null
    this.requests.push({ method: req.method ?? 'GET', path: url.pathname + url.search, body, auth })

    const send = (status: number, json: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(json))
    }
    // The real server's error shape. Its message is technical on purpose here, to check the app never shows it.
    const error = (status: number, code: string, details?: Json) =>
      send(status, { error: { code, message: `server says ${code} at Object.<anonymous> (src/routes/x.ts:1:1)`, ...(details ? { details } : {}) } })

    if (this.failWith) return error(this.failWith.status, this.failWith.code, this.failWith.details)

    const route = `${req.method} ${url.pathname}`
    const open = ['POST /auth/request-code', 'POST /auth/verify', 'POST /auth/refresh', 'GET /products', 'GET /.well-known/license-key']
    if (!open.includes(route)) {
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : ''
      if (!this.accessTokens.has(token)) return error(401, 'unauthorized')
      if (this.expireAccessToken) {
        this.expireAccessToken = false
        this.accessTokens.delete(token)
        return error(401, 'unauthorized')
      }
    }

    const session = /^\/listening\/sessions\/([a-f0-9]+)\/(heartbeat|end|token)$/.exec(url.pathname)
    if (session) return this.listening(session[1], session[2], body, send, error)

    switch (route) {
      case 'POST /auth/request-code':
        return send(202, { ok: true })
      case 'POST /auth/verify':
        if (body.code !== FAKE_CODE) return error(400, 'invalid_code')
        return send(200, { ...this.issueSession(), token_type: 'Bearer', account: { id: 'acc1', email: this.email, created: false }, free_grant: null })
      case 'POST /auth/refresh': {
        if (!this.refreshTokens.has(String(body.refresh_token))) return error(401, 'unauthorized')
        this.refreshTokens.delete(String(body.refresh_token))
        return send(200, { ...this.issueSession(), token_type: 'Bearer' })
      }
      case 'POST /auth/logout':
        return send(204, null)
      case 'GET /.well-known/license-key':
        return send(200, { alg: 'EdDSA', crv: 'Ed25519', kid: 'ed25519-fake', public_key_pem: this.publicKeyPem })
      case 'POST /licenses/activate': {
        const machine = String(body.machine_id)
        const license = this.licenses.find((l) => l.active.includes(machine)) ?? this.licenses.find((l) => l.status === 'active' && l.active.length < l.seats) ?? this.licenses[0]
        if (!license) return error(404, 'not_found')
        if (license.status === 'revoked') return error(403, 'license_revoked')
        if (!license.active.includes(machine)) {
          if (license.active.length >= license.seats) return error(409, 'seat_limit', { seats: license.seats })
          license.active.push(machine)
        }
        return send(200, { license: this.view(license), license_token: this.tokenFor(license, machine) })
      }
      case 'GET /licenses/refresh': {
        const license = this.licenses.find((l) => l.id === url.searchParams.get('license_id'))
        const machine = url.searchParams.get('machine_id') ?? ''
        if (!license) return error(404, 'not_found')
        if (license.status === 'revoked') return error(403, 'license_revoked')
        if (!license.active.includes(machine)) return error(409, 'seat_limit', { reason: 'not_activated' })
        return send(200, { license: this.view(license), license_token: this.tokenFor(license, machine) })
      }
      case 'POST /licenses/deactivate': {
        const license = this.licenses.find((l) => l.id === body.license_id)
        if (!license) return error(404, 'not_found')
        if (license.moves >= 3) return error(409, 'seat_limit', { reason: 'move_limit', next_move_available_at: '2027-02-14T09:00:00.000Z' })
        license.active = license.active.filter((m) => m !== body.machine_id)
        license.moves++
        return send(200, { license: this.view(license) })
      }
      case 'GET /listening/balance':
        return send(200, { total_seconds: this.balanceSeconds, total_hours: this.balanceSeconds / 3600, nearest_expiry: this.nearestExpiry, recent_sessions: [] })
      case 'POST /listening/sessions': {
        if (this.balanceSeconds <= 0) return error(402, 'no_credit', { fallback: 'offline_whisper' })
        const id = randomBytes(12).toString('hex')
        this.sessions.set(id, { status: 'active', billed: 0 })
        return send(201, {
          session_id: id,
          deepgram: { access_token: `dg-first-${id}`, expires_in: 60, url: 'wss://api.deepgram.com/v1/listen', auth_scheme: 'Bearer' },
          balance_seconds: this.balanceSeconds,
          heartbeat_interval_seconds: 30,
          heartbeat_timeout_seconds: 90,
          max_session_seconds: 21600,
        })
      }
      case 'GET /ai/allowance':
        return send(200, { monthly_tokens: 20_000, used_tokens: 20_000 - this.aiRemaining, remaining_tokens: this.aiRemaining, resets_at: '2026-11-01T00:00:00.000Z', has_lapsed_licenses: false })
      case 'POST /ai/run': {
        if (this.aiRemaining <= 0) return error(429, 'ai_quota_exceeded', { resets_at: '2026-11-01T00:00:00.000Z' })
        const output = this.aiOutputs[String(body.task)]
        if (output === undefined) return error(400, 'validation_error')
        this.aiRemaining = Math.max(0, this.aiRemaining - 500)
        return send(200, { task: body.task, output, truncated: false, usage: { input_tokens: 300, output_tokens: 200 }, allowance_remaining_tokens: this.aiRemaining })
      }
      case 'GET /products':
        return send(200, {
          products: [
            { id: 'listening_10h', name: 'Cloud listening, 10 hours', price_kobo: 1_500_000, currency: 'NGN', grant: { kind: 'listening_credits', listeningSeconds: 36000, expiresAfterMonths: 12 } },
            { id: 'pro_license', name: 'ServiceEx Pro (1 computer)', price_kobo: 15_000_000, currency: 'NGN', grant: { kind: 'license', seats: 1, updatesMonths: 12, listeningSeconds: 144000, aiMonthlyTokens: 300000 } },
          ],
        })
      case 'POST /checkout/start': {
        const reference = `sx-${randomBytes(6).toString('hex')}`
        const order = { id: randomBytes(12).toString('hex'), product_id: body.product_id, product_name: 'Cloud listening, 10 hours', amount_kobo: 1_500_000, currency: 'NGN', status: 'pending', reference, receipt_number: null, created_at: this.now().toISOString(), paid_at: null, refunded_at: null }
        this.orders.unshift(order)
        return send(201, { order_id: order.id, reference, amount_kobo: order.amount_kobo, currency: 'NGN', authorization_url: `https://checkout.paystack.com/${reference}` })
      }
      case 'POST /checkout/verify': {
        const order = this.orders.find((o) => o.reference === body.reference)
        if (!order) return error(404, 'not_found')
        return send(200, { result: order.status === 'paid' ? 'duplicate' : 'not_successful', order })
      }
      case 'GET /orders':
        return send(200, { orders: this.orders })
      default:
        return error(404, 'not_found')
    }
  }

  private listening(id: string, action: string, body: Json, send: (s: number, j: unknown) => void, error: (s: number, c: string, d?: Json) => void) {
    const s = this.sessions.get(id)
    if (!s) return error(404, 'not_found')
    if (action === 'token') {
      if (s.status !== 'active') return error(409, 'conflict', { reason: s.reason })
      return send(200, { deepgram: { access_token: `dg-again-${randomBytes(4).toString('hex')}`, expires_in: 60 } })
    }
    const stop = (reason: string) => {
      s.status = 'closed'
      s.reason = reason
      return send(200, { session_id: id, action: 'stop', reason, ...(reason === 'no_credit' ? { fallback: 'offline_whisper' } : {}), balance_seconds: this.balanceSeconds, billed_seconds_this_heartbeat: 0, session_billed_seconds: s.billed, next_heartbeat_seconds: 30 })
    }
    if (s.status !== 'active') return stop(s.reason ?? 'ended')
    const asked = typeof body.elapsed_seconds === 'number' ? body.elapsed_seconds : 0
    const wanted = this.billPerHeartbeat ?? asked
    const billed = Math.min(wanted, this.balanceSeconds)
    this.balanceSeconds -= billed
    s.billed += billed
    if (billed < wanted || this.balanceSeconds <= 0) return stop('no_credit')
    if (action === 'end') return stop('ended')
    return send(200, { session_id: id, action: 'continue', balance_seconds: this.balanceSeconds, billed_seconds_this_heartbeat: billed, session_billed_seconds: s.billed, next_heartbeat_seconds: 30 })
  }
}
