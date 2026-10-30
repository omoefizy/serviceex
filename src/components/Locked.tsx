import { Lock } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { can, currentPlan, FEATURES, FREE_PLAN, pendingPlan, planNameOf, type FeatureKey } from '../../shared/features'
import { openPlans } from '../lib/account'
import { askUpgrade, closeUpgrade, useUpgradeRequest } from '../lib/upgrade'
import { useDismiss } from '../lib/useDismiss'
import { Button } from './ui'

/**
 * A control the plan may leave out. Included: the control as it is. Left out: the control stays where it is, dimmed
 * with a small lock, and clicking it opens the upgrade popover instead of using it. `locked` decides instead of the
 * plan alone, for a limit such as one saved lower third design.
 */
export function Locked({ feature, children, block = false, locked = !can(feature) }: { feature: FeatureKey; children: ReactNode; block?: boolean; locked?: boolean }) {
  if (!locked) return <>{children}</>
  return (
    <LockedControl feature={feature} block={block}>
      {children}
    </LockedControl>
  )
}

function LockedControl({ feature, children, block }: { feature: FeatureKey; children: ReactNode; block: boolean }) {
  const content = useRef<HTMLElement>(null)
  const Box = block ? 'div' : 'span'
  // Inert keeps the control out of the tab order and away from the pointer; the lock button stands in for it.
  useEffect(() => {
    if (content.current) content.current.inert = true
  }, [])
  const { label } = FEATURES[feature]
  return (
    <Box className={`locked-feature${block ? ' block' : ''}`} data-feature={feature}>
      <Box className="locked-feature-content" ref={content as never} aria-hidden="true">
        {children}
      </Box>
      <button
        type="button"
        className="locked-feature-hit"
        aria-haspopup="dialog"
        aria-label={`${label}, in the ${planNameOf(feature)} plan`}
        title={`${label} is in the ${planNameOf(feature)} plan`}
        onClick={(e) => askUpgrade(feature, e.currentTarget)}
      >
        <Lock size={10} strokeWidth={2.5} className="locked-feature-icon" aria-hidden="true" />
      </button>
    </Box>
  )
}

/** A small lock beside a feature's name, for a list, a menu or a tab. */
export function LockIcon({ feature }: { feature: FeatureKey }) {
  return can(feature) ? null : <Lock size={11} strokeWidth={2.5} className="lock-icon" aria-label={`In the ${planNameOf(feature)} plan`} />
}

const GAP = 6
const MARGIN = 16

/**
 * The upgrade popover: names the locked feature and the plan it is in, with Manage plan. Opened by askUpgrade from any
 * locked control; mounted once, in App.
 */
export function UpgradePopover() {
  const request = useUpgradeRequest()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const close = useCallback(() => closeUpgrade(), [])
  useDismiss(request !== null, ref, close)

  useLayoutEffect(() => {
    const el = ref.current
    if (!request || !el) return setPosition(null)
    const { width, height } = el.getBoundingClientRect()
    const a = request.anchor
    const room = (n: number, size: number, total: number) => Math.max(MARGIN, Math.min(n, total - size - MARGIN))
    if (!a) return setPosition({ top: room(80, height, window.innerHeight), left: room((window.innerWidth - width) / 2, width, window.innerWidth) })
    const below = a.bottom + GAP + height <= window.innerHeight - MARGIN
    setPosition({ top: room(below ? a.bottom + GAP : a.top - GAP - height, height, window.innerHeight), left: room(a.left, width, window.innerWidth) })
  }, [request])

  if (!request) return null
  const { label, description } = FEATURES[request.feature]
  const plan = planNameOf(request.feature)
  const next = pendingPlan()
  const waiting = next?.features.includes(request.feature) ?? false
  const manage = () => {
    closeUpgrade()
    openPlans(true)
  }
  return (
    <div
      ref={ref}
      className="status-popover upgrade-popover"
      role="dialog"
      aria-label={`${label} is in the ${plan} plan`}
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
    >
      <h3 className="plan-popover-title">
        <Lock size={13} strokeWidth={2.5} aria-hidden="true" /> {label}
      </h3>
      <p className="status-line">
        {description} {label} is in the {plan} plan{currentPlan() && currentPlan() !== plan ? `; this computer is on ${currentPlan() === FREE_PLAN ? 'the free plan' : `the ${currentPlan()} plan`}` : ''}.
      </p>
      {waiting && <p className="hint">Your {next!.plan} plan includes it. Plan changes apply the next time ServiceEx starts, so nothing on air changes now.</p>}
      <div className="status-actions">
        <Button size="sm" variant="primary" onClick={manage}>
          Manage plan
        </Button>
      </div>
    </div>
  )
}
