import { useEffect, useRef } from 'react'
import { openSettingsAt } from '../lib/shell'
import { Button } from './ui'

/** Stepped lines rising to the right, in the bright accent, over the gradient. */
function RisingPaths() {
  const steps = [
    { y: 300, opacity: 0.9 },
    { y: 360, opacity: 0.55 },
    { y: 420, opacity: 0.3 },
  ]
  return (
    <svg className="welcome-paths" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {steps.map(({ y, opacity }) => (
        <path
          key={y}
          d={`M-20 ${y + 200}H90V${y + 120}H200V${y + 40}H310V${y - 40}H420V${y - 120}H530V${y - 200}H640`}
          fill="none"
          stroke="var(--accent-bright)"
          strokeOpacity={opacity}
          strokeWidth="3"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

/** The first run: a split screen, the brand on the left and the three ways in on the right. */
export function WelcomeScreen({ onDone }: { onDone(): void }) {
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => primary.current?.focus(), [])

  const toAccount = () => {
    onDone()
    openSettingsAt('Account')
  }

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-art">
        <RisingPaths />
        <div className="welcome-brand">
          <svg width="40" height="40" viewBox="0 0 28 28" aria-hidden="true">
            <rect width="28" height="28" rx="8" fill="var(--ink)" />
            <path d="M7 19.5h4.5v-4h4.5v-4h4.5" fill="none" stroke="var(--accent-bright)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="welcome-wordmark">ServiceEx</span>
        </div>
      </div>
      <div className="welcome-body">
        <div className="welcome-content">
          <h1 id="welcome-title" className="welcome-title">
            Run your whole service from one screen.
          </h1>
          <p className="welcome-text">Songs, scripture, slides and the sermon as it is preached, on the screens and the stream, from one laptop.</p>
          <div className="welcome-actions">
            <Button ref={primary} variant="primary" size="xl" onClick={toAccount}>
              Create a free account
            </Button>
            <Button size="xl" onClick={toAccount}>
              Log in
            </Button>
            <Button variant="ghost" size="lg" className="welcome-skip" onClick={onDone}>
              Continue without an account
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
