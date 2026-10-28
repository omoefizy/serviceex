// Waking the server against a fake ServiceEx server: one bare GET /health at startup, nothing without a server address,
// a timeout that ends quietly, and the screens asking again only after 10 minutes.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FakeServiceServer } from './fakeServer.test-helper'
import { createWarmUp, WARM_UP_STALE_MS } from './warmUp'

const server = new FakeServiceServer()

beforeAll(() => server.start())
afterAll(() => server.stop())
beforeEach(() => {
  server.requests.length = 0
  server.healthDelayMs = 0
})

describe('the warm up', () => {
  it('sends one GET /health at startup with nothing about the account', async () => {
    await createWarmUp({ baseUrl: () => server.url }).ping()
    expect(server.requests).toEqual([{ method: 'GET', path: '/health', body: {}, auth: null }])
  })

  it('sends nothing when no server address is set', async () => {
    let fetched = 0
    await createWarmUp({ baseUrl: () => null, fetch: async () => (fetched++, new Response()) }).ping()
    expect(fetched).toBe(0)
    expect(server.requests).toHaveLength(0)
  })

  it('ends quietly when the server does not answer in time, without retrying', async () => {
    server.healthDelayMs = 500
    await expect(createWarmUp({ baseUrl: () => server.url, timeoutMs: 50 }).ping()).resolves.toBeUndefined()
    expect(server.calls('/health')).toHaveLength(1)
  })

  it('ends quietly when the server cannot be reached', async () => {
    await expect(createWarmUp({ baseUrl: () => 'http://127.0.0.1:9' }).ping()).resolves.toBeUndefined()
  })

  it('asks again from the screens only once the last answer is over 10 minutes old', async () => {
    let now = 1_000_000
    const warmUp = createWarmUp({ baseUrl: () => server.url, now: () => now })
    await warmUp.ping()
    now += WARM_UP_STALE_MS
    await warmUp.pingIfStale()
    expect(server.calls('/health')).toHaveLength(1)
    now += 1
    await warmUp.pingIfStale()
    expect(server.calls('/health')).toHaveLength(2)
  })

  it('sends one request while one is still waiting', async () => {
    server.healthDelayMs = 50
    const warmUp = createWarmUp({ baseUrl: () => server.url })
    await Promise.all([warmUp.ping(), warmUp.pingIfStale(), warmUp.pingIfStale()])
    expect(server.calls('/health')).toHaveLength(1)
  })
})
