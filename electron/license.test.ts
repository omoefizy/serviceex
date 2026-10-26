// The licence on this computer: the Founder plan by default, the grace period after expiry, and a licence file that
// is missing or broken never stopping the app.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, ipcMain: { handle: vi.fn(), on: vi.fn() } }))

const { can, FEATURE_KEYS, setEntitlements } = await import('../shared/features')
const { cleanLicense, evaluateLicense, FOUNDER_LICENSE } = await import('../shared/license')
const { loadLicense, readLicense } = await import('./license')

let folder: string

beforeEach(() => {
  folder = mkdtempSync(path.join(os.tmpdir(), 'worshipdeck-license-'))
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
  setEntitlements(null)
})

const basic = { ...FOUNDER_LICENSE, plan: 'Basic', features: ['alerts', 'stageDisplay'], expiresAt: '2026-06-30', graceDays: 30 }

describe('licence', () => {
  it('is the Founder plan with every feature when there is no licence file, and writes one to the app data folder', () => {
    const status = loadLicense(folder)
    expect(status.plan).toBe('Founder')
    expect(status.state).toBe('active')
    expect(status.expiresAt).toBeNull()
    expect(status.features).toEqual(FEATURE_KEYS)
    expect(FEATURE_KEYS.every(can)).toBe(true)
    const saved = JSON.parse(readFileSync(path.join(folder, 'license.json'), 'utf8'))
    expect(saved).toMatchObject({ plan: 'Founder', seats: 1, organization: '', graceDays: 30, signature: null })
    expect(saved.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('falls back to the Founder plan when the licence file is broken', () => {
    writeFileSync(path.join(folder, 'license.json'), '{not json')
    expect(readLicense(folder)).toEqual(FOUNDER_LICENSE)
    writeFileSync(path.join(folder, 'license.json'), '"a string"')
    expect(loadLicense(folder).plan).toBe('Founder')
    expect(FEATURE_KEYS.every(can)).toBe(true)
  })

  it('switches off the features a plan leaves out, at load', () => {
    writeFileSync(path.join(folder, 'license.json'), JSON.stringify({ ...basic, expiresAt: null, organization: 'Grace Church', seats: 3 }))
    const status = loadLicense(folder)
    expect(status).toMatchObject({ plan: 'Basic', organization: 'Grace Church', seats: 3, features: ['alerts', 'stageDisplay'] })
    expect(can('alerts')).toBe(true)
    expect(can('themes.editor')).toBe(false)
  })

  it('keeps every feature through the grace period after expiry, then turns plan features off', () => {
    const license = cleanLicense(basic)!
    expect(evaluateLicense(license, '2026-06-30')).toMatchObject({ state: 'active', features: ['alerts', 'stageDisplay'], message: null })
    const grace = evaluateLicense(license, '2026-07-30')
    expect(grace).toMatchObject({ state: 'grace', features: ['alerts', 'stageDisplay'], graceEndsAt: '2026-07-30' })
    expect(grace.message).toContain('keeps working until 2026-07-30')
    expect(evaluateLicense(license, '2026-07-31')).toMatchObject({ state: 'expired', features: [] })
  })

  it('gives the Founder plan every feature, even ones its saved list is missing', () => {
    expect(evaluateLicense({ ...FOUNDER_LICENSE, features: [] }).features).toEqual(FEATURE_KEYS)
  })

  it('checks every field read from disk', () => {
    expect(cleanLicense(null)).toBeNull()
    expect(cleanLicense({ plan: '' })).toBeNull()
    expect(cleanLicense({ plan: 'Basic', features: ['alerts', 'teleport', 7], seats: -2, graceDays: 9999, expiresAt: 'soon', signature: '' })).toEqual({
      ...FOUNDER_LICENSE,
      plan: 'Basic',
      features: ['alerts'],
      seats: 1,
      graceDays: 365,
      expiresAt: null,
      signature: null,
    })
  })
})
