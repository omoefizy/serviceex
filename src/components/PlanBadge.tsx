import { Sparkle } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { formatHours, type AccountState } from '../../shared/account'
import { FREE_PLAN, pendingPlan } from '../../shared/features'
import { trialLabel } from '../../shared/license'
import { shortDate } from '../../shared/serviceErrors'
import { openPlans } from '../lib/account'
import { useDismiss } from '../lib/useDismiss'
import { Button } from './ui'

/** The plan's short name for the badge: "Pro" becomes PRO. */
const badgeName = (plan: string) => plan.replace(/\s+plan$/i, '').trim().toUpperCase() || 'PRO'

/**
 * The plan at the bottom right of the status bar: a PRO badge (an amber dot once updates have ended), or a quiet FREE
 * pill with Upgrade. Click opens what the plan has left, with Manage plan, and how long a Pro trial has to go.
 */
export function PlanBadge({ account }: { account: AccountState }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  const { license, balance, allowance } = account
  const free = !account.signedIn || license.state === 'none' || license.plan === FREE_PLAN
  const trial = license.trial
  const ended = !free && !trial && license.updatesExpired
  const name = free ? 'FREE' : badgeName(license.plan)
  const plans = () => {
    setOpen(false)
    openPlans(true)
  }

  return (
    <div className="plan-badge-area" ref={ref}>
      <button
        type="button"
        className={`plan-badge${free ? ' free' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${free ? 'Free' : license.plan} plan${ended ? ', updates ended' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {!free && <Sparkle size={11} strokeWidth={2.25} className="plan-badge-icon" aria-hidden="true" />}
        <span className="plan-badge-name">{name}</span>
        {ended && <span className="plan-badge-dot" aria-hidden="true" />}
      </button>
      {free && account.configured && (
        <button type="button" className="plan-upgrade" onClick={plans}>
          Upgrade
        </button>
      )}
      {open && (
        <div className="status-popover plan-popover" role="dialog" aria-label="Plan">
          <h3 className="plan-popover-title">{free ? 'Free plan' : `${license.plan.replace(/\s+plan$/i, '')} plan`}</h3>
          {trial && <p className="status-line plan-trial">{trial.ended ? 'Trial ended' : trialLabel(trial.endsAt)}</p>}
          <dl className="plan-popover-list">
            <dt>Cloud listening left</dt>
            <dd>{balance ? formatHours(balance.totalSeconds) : 'None'}</dd>
            <dt>AI tokens left</dt>
            <dd>{allowance ? allowance.remainingTokens.toLocaleString() : 'None'}</dd>
            {!free && !trial && (
              <>
                <dt>Updates valid until</dt>
                <dd className={ended ? 'plan-ended' : undefined}>
                  {ended ? (
                    <>
                      <span className="plan-badge-dot" aria-hidden="true" /> Updates ended{license.updatesUntil ? ` ${shortDate(license.updatesUntil)}` : ''}
                    </>
                  ) : (
                    (shortDate(license.updatesUntil) ?? 'Not set')
                  )}
                </dd>
                <dt>Devices used</dt>
                <dd>{license.seats === null ? (license.seatsUsed ?? 'Not known') : `${license.seatsUsed ?? '?'} of ${license.seats}`}</dd>
              </>
            )}
          </dl>
          {ended && <p className="hint">The app keeps working. Renew to get newer updates.</p>}
          {pendingPlan() && <p className="hint">Plan changes apply the next time ServiceEx starts, so nothing on air changes now.</p>}
          {account.configured && (
            <div className="status-actions">
              <Button size="sm" variant={free ? 'primary' : 'secondary'} onClick={plans}>
                {free ? 'Upgrade' : 'Manage plan'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
