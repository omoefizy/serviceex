import { BadgeCheck, Check, CreditCard, Lock, LogIn, LogOut, Mail, MonitorX, RefreshCw, UserRound, WifiOff } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { allowancePercentLeft, allowanceTotalTokens, formatHours, isLowBalance, poolPercentLeft, type AccountState, type AiAllowance, type AiPool } from '../../shared/account'
import { ENFORCE_ENTITLEMENTS, FEATURE_KEYS, FEATURES, includes } from '../../shared/features'
import type { LicenseStatus } from '../../shared/license'
import { shortDate } from '../../shared/serviceErrors'
import { openPlans, reloadAccount, setAccountState, useAccount } from '../lib/account'
import { reportError, type FriendlyError } from '../lib/errors'
import { SERVER_TIMEOUT_MS, useOnline, withServerTimeout } from '../lib/useServerRequest'
import { ServerProblem } from './ServerProblem'
import { Button, Card, ErrorNote, Input, Skeleton } from './ui'

const LICENSE_STATES: Record<LicenseStatus['state'], string> = {
  none: 'No licence on this computer',
  active: 'Active',
  offline_expired: 'Needs checking online',
  invalid: 'Not valid',
  revoked: 'Revoked',
}

/** Email, then the 6 digit code from it. */
function SignInForm({ encryptionAvailable }: { encryptionAvailable: boolean }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const sent = await withServerTimeout(window.api.account.requestCode(email.trim()))
      if (sent.ok) setSentTo(email.trim())
      else setError(reportError('Sign in', sent.error))
    } catch (err) {
      setError(reportError('Sign in', err))
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (!sentTo) return
    setBusy(true)
    setError(null)
    try {
      const signedIn = await withServerTimeout(window.api.account.verifyCode(sentTo, code))
      if (signedIn.ok) {
        setAccountState(signedIn.value)
        setCode('')
      } else setError(reportError('Sign in', signedIn.error))
    } catch (err) {
      setError(reportError('Sign in', err))
    } finally {
      setBusy(false)
    }
  }

  if (!encryptionAvailable) {
    return <p className="error">This computer cannot store the sign in securely (no keychain or keyring), so signing in is not possible here.</p>
  }
  return (
    <>
      {sentTo === null ? (
        <form className="field" onSubmit={sendCode}>
          <label htmlFor="account-email">Email</label>
          <div className="settings-row">
            <Input
              id="account-email"
              type="email"
              autoComplete="email"
              placeholder="you@church.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button variant="primary" type="submit" disabled={busy || !email.trim()}>
              <Mail size={15} aria-hidden="true" /> Send code
            </Button>
          </div>
          <span className="hint">A 6 digit code is emailed to you. No password is needed.</span>
        </form>
      ) : (
        <form className="field" onSubmit={verify}>
          <label htmlFor="account-code">Code sent to {sentTo}</label>
          <div className="settings-row">
            <Input
              id="account-code"
              className="account-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <Button variant="primary" type="submit" disabled={busy || code.length !== 6}>
              <LogIn size={15} aria-hidden="true" /> Sign in
            </Button>
            <Button disabled={busy} onClick={() => (setSentTo(null), setCode(''), setError(null))}>
              Use another email
            </Button>
          </div>
          <span className="hint">Signing in also activates this computer on your licence, if you have one.</span>
        </form>
      )}
      <ErrorNote error={error} />
    </>
  )
}

/** The licence on this computer as it is now, with Deactivate. */
function LicenseDetails({ account }: { account: AccountState }) {
  const license = account.license
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)

  async function deactivate() {
    setBusy(true)
    setError(null)
    try {
      const done = await withServerTimeout(window.api.account.deactivate())
      if (done.ok) setAccountState(done.value)
      else setError(reportError('Account', done.error))
    } catch (err) {
      setError(reportError('Account', err))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const seats = license.seats === null ? null : `${license.seatsUsed ?? '?'} of ${license.seats} in use`
  return (
    <>
      <dl className="plan-summary">
        <dt>Plan</dt>
        <dd>{license.plan}</dd>
        <dt>Licence</dt>
        <dd>{LICENSE_STATES[license.state]}</dd>
        {seats && (
          <>
            <dt>Computers</dt>
            <dd>{seats}</dd>
          </>
        )}
        {license.updatesUntil && (
          <>
            <dt>Updates until</dt>
            <dd>{shortDate(license.updatesUntil)}</dd>
          </>
        )}
        {license.offlineValidUntil && (
          <>
            <dt>Offline valid until</dt>
            <dd>{shortDate(license.offlineValidUntil)}</dd>
          </>
        )}
      </dl>
      {license.updatesExpired && (
        <p className="hint" role="status">
          Updates expired, app keeps working.
        </p>
      )}
      {license.message && !license.updatesExpired && <p className={license.state === 'invalid' || license.state === 'revoked' ? 'error' : 'hint'}>{license.message}</p>}
      {license.licenseId && account.signedIn && (
        <div className="settings-row">
          {confirming ? (
            <>
              <span className="hint">
                Deactivate this computer? Its seat is freed for another computer, and it counts as one of the licence&apos;s moves (3 every 12
                months).
              </span>
              <Button variant="danger" disabled={busy} onClick={() => void deactivate()}>
                <MonitorX size={15} aria-hidden="true" /> Deactivate
              </Button>
              <Button disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirming(true)}>
              <MonitorX size={15} aria-hidden="true" /> Deactivate this computer
            </Button>
          )}
        </div>
      )}
      <ErrorNote error={error} />
    </>
  )
}

/** Cloud listening hours left and the AI allowance, as last confirmed. */
export function BalanceLines({ account }: { account: AccountState }) {
  const { balance, allowance } = account
  return (
    <>
      <p className="hint account-balance">
        Cloud listening hours: {balance ? formatHours(balance.totalSeconds) : 'not checked yet'}
        {balance?.nearestExpiry && ` · ${formatHours(balance.nearestExpiry.seconds)} of them expire on ${shortDate(balance.nearestExpiry.expiresAt)}`}
      </p>
      {isLowBalance(balance) && (
        <p className="listener-warning" role="status">
          Less than 30 minutes of cloud listening left. Buy more hours in Plans and Credits; listening carries on offline when they run out.
        </p>
      )}
      {allowance && <AllowanceLines allowance={allowance} />}
    </>
  )
}

/** The AI trial and the monthly AI uses, each as a bar and a percentage; the exact counts only in developer mode. */
function AllowanceLines({ allowance }: { allowance: AiAllowance }) {
  const [developerMode, setDeveloperMode] = useState(false)
  useEffect(() => {
    window.api.ai.status().then((s) => setDeveloperMode(s.developerMode), console.error)
  }, [])

  const { trial, monthly } = allowance
  if (trial.tokens <= 0 && monthly.tokens <= 0) return <p className="hint">AI uses: none included</p>
  return (
    <>
      {trial.tokens > 0 && <PoolLine label="AI trial (one time)" pool={trial} developerMode={developerMode} />}
      {monthly.tokens > 0 && (
        <PoolLine label="Monthly AI uses" pool={monthly} when={allowance.resetsAt ? `resets on ${shortDate(allowance.resetsAt)}` : null} developerMode={developerMode} />
      )}
      {developerMode && (
        <p className="hint">
          AI tokens in all: {allowance.remainingTokens.toLocaleString()} of {allowanceTotalTokens(allowance).toLocaleString()} ({allowancePercentLeft(allowance)} percent left)
        </p>
      )}
    </>
  )
}

function PoolLine({ label, pool, when = null, developerMode }: { label: string; pool: AiPool; when?: string | null; developerMode: boolean }) {
  const percent = poolPercentLeft(pool)
  return (
    <div className="allowance-line">
      <span className="allowance-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="hint">
        {label}: {percent} percent left{when && `, ${when}`}
        {developerMode && ` · ${pool.remainingTokens.toLocaleString()} of ${pool.tokens.toLocaleString()} tokens`}
      </span>
    </div>
  )
}

/** Settings, Account: signing in, this computer's licence, the hours and allowance, and what the plan includes. */
export function AccountSection() {
  const account = useAccount()
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  /** The main process has not said what the account is within SERVER_TIMEOUT_MS. */
  const [stuck, setStuck] = useState(false)

  useEffect(() => window.api.account.warmUp(), [])

  useEffect(() => {
    if (account || stuck) return
    const timer = setTimeout(() => {
      reportError('Account', new Error(`No account state within ${SERVER_TIMEOUT_MS / 1000} seconds`))
      setStuck(true)
    }, SERVER_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [account, stuck])

  async function signOut() {
    setBusy(true)
    setError(null)
    try {
      setAccountState(await window.api.account.signOut())
    } catch (err) {
      setError(reportError('Account', err))
    } finally {
      setBusy(false)
    }
  }

  async function refresh() {
    setBusy(true)
    setError(null)
    try {
      const done = await withServerTimeout(window.api.account.refresh())
      if (done?.ok) setAccountState(done.value)
      else if (done) setError(reportError('Account', done.error))
    } catch (err) {
      setError(reportError('Account', err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="settings-section" icon={<UserRound size={16} aria-hidden="true" />} title="Account">
      {!account && !stuck && <Skeleton rows={3} label="Loading the account" />}
      {!account && stuck && (
        <ServerProblem
          problem="timeout"
          what="The account"
          onRetry={() => {
            setStuck(false)
            reloadAccount()
          }}
        />
      )}
      {account?.configured && !online && (
        <p className="listener-warning account-offline" role="status">
          <WifiOff size={14} aria-hidden="true" /> This computer is offline. The licence, hours and allowance below are as last confirmed, and
          ServiceEx keeps working. Signing in, Refresh and buying need the internet.
        </p>
      )}
      {!account ? null : !account.configured ? (
        <p className="hint">This build of ServiceEx is not set up to connect to ServiceEx. Everything offline works as usual.</p>
      ) : account.signedIn ? (
        <div className="settings-row">
          <span>
            Signed in as <strong>{account.email}</strong>
          </span>
          <Button disabled={busy || !online} onClick={() => void refresh()} title="Check the licence, hours and allowance again">
            <RefreshCw size={15} aria-hidden="true" /> {busy ? 'Checking…' : 'Refresh'}
          </Button>
          <Button disabled={busy} onClick={() => void signOut()}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </Button>
        </div>
      ) : (
        <SignInForm encryptionAvailable={account.encryptionAvailable} />
      )}
      <ErrorNote error={error} />
      {account?.notice && <p className="hint" role="status">{account.notice}</p>}

      {account && (
        <>
          <h4 className="settings-subheading">
            <BadgeCheck size={14} aria-hidden="true" /> Licence
          </h4>
          <LicenseDetails account={account} />
          {account.signedIn && <BalanceLines account={account} />}
          {account.signedIn && (
            <div className="settings-row">
              <Button onClick={() => openPlans(true)}>
                <CreditCard size={15} aria-hidden="true" /> Plans and Credits
              </Button>
            </div>
          )}
        </>
      )}

      <ul className="plan-features" aria-label="Features">
        {FEATURE_KEYS.map((feature) => (
          <li key={feature} className={includes(feature) ? '' : 'off'} title={FEATURES[feature].description}>
            {includes(feature) ? <Check size={13} aria-label="Included" /> : <Lock size={13} aria-label="Not included" />}
            {FEATURES[feature].label}
          </li>
        ))}
      </ul>
      <p className="hint">
        {ENFORCE_ENTITLEMENTS ? '' : 'Plan limits are not enforced yet: every feature works. '}A change to the plan takes effect the next time
        ServiceEx starts, never during a service.
      </p>
    </Card>
  )
}
