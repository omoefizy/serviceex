// The plan badge in the status bar: PRO for a paid plan, an amber dot once updates have ended, and a quiet FREE pill
// with Upgrade on the free plan. Click opens what the plan has left.
import { createElement } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AccountState } from '../shared/account'
import { NO_LICENSE } from '../shared/license'

vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })

const { PlanBadge } = await import('./components/PlanBadge')

const pro: AccountState = {
  configured: true,
  encryptionAvailable: true,
  signedIn: true,
  email: 'pastor@example.church',
  license: { ...NO_LICENSE, state: 'active', plan: 'Pro', seats: 3, seatsUsed: 2, updatesUntil: '2027-03-01T00:00:00Z', updatesExpired: false },
  balance: { totalSeconds: 12 * 3600 + 30 * 60, nearestExpiry: null, updatedAt: '2026-10-01T00:00:00Z' },
  allowance: { trial: { tokens: 0, remainingTokens: 0 }, monthly: { tokens: 500000, remainingTokens: 412000 }, remainingTokens: 412000, resetsAt: null },
  checkout: null,
  notice: null,
}

const textOf = (node: ReactTestInstance): string => node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('')

function open(account: AccountState) {
  const badge = create(createElement(PlanBadge, { account }))
  const button = badge.root.find((n) => n.type === 'button' && String(n.props.className).includes('plan-badge'))
  act(() => button.props.onClick())
  return { badge, button, popover: badge.root.find((n) => n.props.role === 'dialog') }
}

describe('the plan badge', () => {
  it('shows PRO, and the plan, listening hours, AI tokens, updates and devices in its popover', () => {
    const { button, popover } = open(pro)
    expect(textOf(button)).toBe('PRO')
    expect(button.props.className).toBe('plan-badge')
    const text = textOf(popover)
    expect(text).toContain('Pro plan')
    expect(text).toContain('12 h 30 min')
    expect(text).toContain((412000).toLocaleString())
    expect(text).toContain('2 of 3')
    expect(text).toContain('Manage plan')
    expect(text).not.toContain('Updates ended')
  })

  it('marks ended updates with an amber dot', () => {
    const { button, popover } = open({ ...pro, license: { ...pro.license, updatesExpired: true } })
    expect(button.findAll((n) => n.props.className === 'plan-badge-dot')).toHaveLength(1)
    expect(textOf(button)).toBe('PRO')
    expect(textOf(popover)).toContain('Updates ended')
  })

  it('shows a quiet FREE pill with Upgrade on the free plan', () => {
    const { badge, button, popover } = open({ ...pro, license: NO_LICENSE, balance: null, allowance: null })
    expect(textOf(button)).toBe('FREE')
    expect(button.props.className).toBe('plan-badge free')
    expect(badge.root.findAll((n) => n.type === 'button' && n.props.className === 'plan-upgrade')).toHaveLength(1)
    expect(textOf(popover)).toContain('Free plan')
    expect(textOf(popover)).not.toContain('Devices used')
  })
})
