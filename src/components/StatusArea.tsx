import { AlertTriangle, ChevronDown, CircleUser, Wifi, WifiOff } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { openPlans, useAccount } from '../lib/account'
import { canDropOnDevice, SHARED_ITEM_DRAG_TYPE } from '../lib/sharing'
import { openSettingsAt } from '../lib/shell'
import { useDismiss } from '../lib/useDismiss'
import { useSharingSummary } from '../lib/useSharingSummary'
import { SharingBar, SharingDetails } from './SharingBar'
import { Button } from './ui'

/**
 * The toolbar's status: one compact button for sharing, the other computers and the account, with the details in a
 * popover. Dragging files or a shared item over it opens the popover, so they can be dropped on a device chip.
 */
export function StatusArea() {
  const [open, setOpen] = useState(false)
  const [hintHidden, setHintHidden] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  const sharing = useSharingSummary()
  const account = useAccount()

  const warning = (!hintHidden && sharing.enabled && (sharing.noDevices || sharing.publicNetworks.length > 0)) || sharing.failed || !!account?.notice
  const parts = [
    sharing.enabled ? `Sharing on, ${sharing.online} computer${sharing.online === 1 ? '' : 's'} online` : 'Sharing off',
    ...(sharing.percent !== null ? [`transfers ${sharing.percent}%`] : []),
    account?.signedIn ? `signed in, ${account.license.plan}` : 'not signed in',
    ...(warning ? ['needs attention'] : []),
  ]
  const summary = parts.join(', ')
  const SharingIcon = sharing.enabled ? Wifi : WifiOff

  return (
    <div className="status-area" ref={ref}>
      <button
        type="button"
        className={`status-button${warning ? ' warning' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Status: ${summary}`}
        title={summary}
        onClick={() => setOpen(!open)}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes(SHARED_ITEM_DRAG_TYPE) || canDropOnDevice(e)) setOpen(true)
        }}
      >
        <SharingIcon size={15} aria-hidden="true" />
        {sharing.enabled && <span className="status-count">{sharing.online}</span>}
        {sharing.percent !== null && <span className="status-progress">{sharing.percent}%</span>}
        <CircleUser size={15} aria-hidden="true" className={account?.signedIn ? 'status-signed-in' : undefined} />
        {warning && <AlertTriangle size={13} className="status-warning" aria-hidden="true" />}
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="status-popover" role="dialog" aria-label="Status">
          <section className="status-section">
            <h3>Account</h3>
            {!account ? (
              <p className="hint">Checking…</p>
            ) : account.signedIn ? (
              <p className="status-line">
                <strong>{account.license.plan}</strong> · {account.email}
              </p>
            ) : (
              <p className="status-line">{account.configured ? 'Not signed in' : 'Accounts are not available in this build'}</p>
            )}
            {account?.notice && <p className="hint">{account.notice}</p>}
            <div className="status-actions">
              <Button
                size="sm"
                onClick={() => {
                  setOpen(false)
                  openSettingsAt('Account')
                }}
              >
                Account
              </Button>
              {account?.configured && (
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                    openPlans(true)
                  }}
                >
                  Plans and Credits
                </Button>
              )}
            </div>
          </section>
          <section className="status-section">
            <h3>Sharing</h3>
            {!sharing.enabled && <p className="status-line">Sharing is off. Other ServiceEx computers cannot see this one.</p>}
            <SharingDetails noDevices={sharing.noDevices} hintHidden={hintHidden} onHideHint={() => setHintHidden(true)} />
            <div className="status-actions">
              <Button
                size="sm"
                onClick={() => {
                  setOpen(false)
                  openSettingsAt('Sharing')
                }}
              >
                Sharing settings
              </Button>
            </div>
          </section>
        </div>
      )}
      <SharingBar />
    </div>
  )
}
