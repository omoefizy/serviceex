import { useEffect, useRef } from 'react'
import { openSettingsAt } from '../lib/shell'
import { Button } from './ui'

/** Stepped paths rising to the right over the gradient, the brightest ending in a dot. */
function SteppedPaths() {
  const paths = [
    { d: 'M-20 820 L140 820 L140 700 L300 700 L300 560 L460 560 L460 420 L620 420 L620 280 L760 280', width: 3, opacity: 0.95 },
    { d: 'M-20 860 L180 860 L180 740 L340 740 L340 600 L500 600 L500 460 L660 460 L660 320 L760 320', width: 2, opacity: 0.5 },
    { d: 'M-20 900 L220 900 L220 780 L380 780 L380 640 L540 640 L540 500 L700 500 L700 360 L760 360', width: 1.5, opacity: 0.28 },
    { d: 'M-20 780 L100 780 L100 660 L260 660 L260 520 L420 520 L420 380 L580 380 L580 240 L760 240', width: 1.5, opacity: 0.28 },
  ]
  return (
    <svg className="welcome-paths" viewBox="0 0 720 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="var(--welcome-line)" strokeLinecap="round" strokeLinejoin="round">
        {paths.map((p) => (
          <path key={p.d} d={p.d} strokeWidth={p.width} opacity={p.opacity} />
        ))}
      </g>
      <circle cx="620" cy="280" r="9" fill="var(--welcome-dot)" />
      <circle cx="620" cy="280" r="22" fill="none" stroke="var(--welcome-line)" strokeWidth="2" opacity="0.5" />
    </svg>
  )
}

/**
 * The first run: a split screen, the brand on the left and the three ways in on the right. Create a free account and
 * Log in both go to Settings, Account and plan, where the email code sign in makes an account for a new email.
 */
export function WelcomeScreen({ onAccount, onContinue }: { onAccount(): void; onContinue(): void }) {
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => primary.current?.focus(), [])

  const toAccount = () => {
    onAccount()
    openSettingsAt('Account', '#account-email')
  }

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-art">
        <SteppedPaths />
        <div className="welcome-brand">
          <svg width="32" height="32" viewBox="0 0 28 28" aria-hidden="true">
            <rect width="28" height="28" rx="8" fill="var(--accent)" />
            <path d="M8 19l5-5 3 3 5-6" fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="welcome-wordmark">ServiceEx</span>
        </div>
        <div className="welcome-caption">For the people behind the screen</div>
      </div>
      <div className="welcome-body">
        <div className="welcome-content">
          <h1 id="welcome-title" className="welcome-title">
            Run your whole service from one screen.
          </h1>
          <p className="welcome-text">Listen to the sermon, find the verse and put it on screen. Start free with 2 hours of cloud listening. No card needed.</p>
          <Button ref={primary} variant="primary" className="welcome-primary" onClick={toAccount}>
            Create a free account
          </Button>
          <Button className="welcome-secondary" onClick={toAccount}>
            Log in
          </Button>
          <Button variant="ghost" className="welcome-skip" onClick={onContinue}>
            Continue without an account
          </Button>
          <p className="welcome-note">Your songs and slides stay on this computer. Offline listening always works.</p>
        </div>
      </div>
    </div>
  )
}
