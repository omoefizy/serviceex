import { CloudOff, ExternalLink, Loader2, ReceiptText, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatHours, formatNaira, NEEDS_REVIEW_MESSAGE, ORDER_STATES, type Product, type ProductKind } from '../../shared/account'
import { shortDate } from '../../shared/serviceErrors'
import { openPlans, useAccount } from '../lib/account'
import { reportError, type FriendlyError } from '../lib/errors'
import { useServerRequest } from '../lib/useServerRequest'
import { ServerProblem } from './ServerProblem'
import { EmptyState, ErrorNote, Skeleton } from './ui'

const GROUPS: { kind: ProductKind; title: string }[] = [
  { kind: 'listening_credits', title: 'Cloud listening hours' },
  { kind: 'license', title: 'Licences' },
  { kind: 'updates_renewal', title: 'Updates renewal' },
]

/** What a product gives, in a few words. */
function productDetail(p: Product): string {
  const parts: string[] = []
  if (p.seats) parts.push(`${p.seats} computer${p.seats === 1 ? '' : 's'}`)
  if (p.updatesMonths) parts.push(`${p.updatesMonths} months of updates`)
  if (p.listeningSeconds) parts.push(`${formatHours(p.listeningSeconds)} of cloud listening`)
  return parts.join(' · ')
}

/**
 * Plans and Credits: the products with their prices exactly as the server sends them, buying through Paystack in the
 * browser, and the order history. The payment is confirmed in the main process; this shows its progress.
 */
export function PlansModal() {
  const account = useAccount()
  const [error, setError] = useState<FriendlyError | null>(null)
  const [buying, setBuying] = useState<string | null>(null)
  const checkout = account?.checkout ?? null
  const configured = account?.configured !== false

  useEffect(() => window.api.account.warmUp(), [])

  const products = useServerRequest('Plans and Credits', () => window.api.account.products(), { enabled: configured })
  // The order history, again whenever a purchase finishes.
  const orders = useServerRequest('Order history', () => window.api.account.orders(), {
    enabled: configured && Boolean(account?.signedIn),
    key: checkout?.state ?? '',
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && openPlans(false)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function buy(product: Product) {
    setError(null)
    setBuying(product.id)
    try {
      const started = await window.api.account.buy(product.id)
      if (!started.ok) setError(reportError('Plans and Credits', started.error))
    } catch (err) {
      setError(reportError('Plans and Credits', err))
    } finally {
      setBuying(null)
    }
  }

  const waiting = checkout?.state === 'waiting'
  const productList = products.state.status === 'done' ? products.state.value : null
  return (
    <div className="modal-backdrop" onMouseDown={() => openPlans(false)}>
      <div className="modal plans-modal" role="dialog" aria-label="Plans and Credits" onMouseDown={(e) => e.stopPropagation()}>
        <header className="panel-header">
          <h2>Plans and Credits</h2>
          <button className="icon-button" aria-label="Close" title="Close" onClick={() => openPlans(false)}>
            <X size={18} />
          </button>
        </header>

        {configured && !account?.signedIn && <p className="hint">Sign in in Settings, Account to buy. Prices are shown for reference.</p>}
        {/* After 3 minutes the checks stop quietly; the order keeps its status in Order history. */}
        {checkout && checkout.state !== 'timed_out' && (
          <p className={checkout.state === 'failed' ? 'listener-warning' : 'hint'} role="status">
            {waiting && <Loader2 size={14} className="spin" aria-hidden="true" />} <strong>{checkout.productName}:</strong> {checkout.message}
          </p>
        )}
        <ErrorNote error={error} />
        {productList && !products.online && (
          <p className="listener-warning" role="status">
            This computer is offline. These prices are as last loaded; buying needs the internet.
          </p>
        )}

        {!configured ? (
          <EmptyState
            compact
            icon={<CloudOff size={20} />}
            title="Plans are not available in this build"
            description="This build of ServiceEx is not set up to connect to ServiceEx. Everything offline works as usual."
          />
        ) : productList ? null : products.state.status === 'loading' && products.online ? (
          <Skeleton rows={4} tall label="Loading prices" />
        ) : (
          <ServerProblem
            problem={!products.online ? 'offline' : products.state.status === 'error' ? products.state.error : 'timeout'}
            what="Prices"
            onRetry={products.retry}
          />
        )}
        {productList &&
          GROUPS.map(({ kind, title }) => {
            const list = productList.filter((p) => p.kind === kind)
            if (list.length === 0) return null
            return (
              <section key={kind} className="plans-group">
                <h3>{title}</h3>
                <ul className="plans-list">
                  {list.map((p) => (
                    <li key={p.id}>
                      <div>
                        <strong>{p.name}</strong>
                        <span className="hint">{productDetail(p)}</span>
                      </div>
                      <span className="plans-price">{formatNaira(p.priceKobo, p.currency)}</span>
                      <button
                        type="button"
                        className="button primary"
                        disabled={!account?.signedIn || !products.online || waiting || buying !== null || (kind === 'updates_renewal' && !account?.license.licenseId)}
                        title={kind === 'updates_renewal' && !account?.license.licenseId ? 'Renews the licence this computer is activated on' : 'Pay with Paystack in your browser'}
                        onClick={() => void buy(p)}
                      >
                        <ExternalLink size={14} aria-hidden="true" /> Buy
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

        {configured && account?.signedIn && (
          <section className="plans-group">
            <h3>Order history</h3>
            {orders.state.status === 'loading' && orders.online ? (
              <Skeleton rows={2} label="Loading your orders" />
            ) : orders.state.status !== 'done' && !orders.online ? (
              // The offline explanation is already above, with the prices.
              <p className="hint">Your orders show once this computer is back on the internet.</p>
            ) : orders.state.status !== 'done' ? (
              <ServerProblem
                problem={orders.state.status === 'error' ? orders.state.error : 'timeout'}
                what="Your orders"
                onRetry={orders.retry}
              />
            ) : orders.state.value.length === 0 ? (
              <EmptyState compact icon={<ReceiptText size={20} />} title="No orders yet" description="What you buy here is listed with its receipt number." />
            ) : (
              <table className="plans-orders">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Item</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.state.value.map((o) => (
                    <tr key={o.id}>
                      <td>{shortDate(o.paidAt ?? o.createdAt)}</td>
                      <td>{o.productName}</td>
                      <td>{formatNaira(o.amountKobo, o.currency)}</td>
                      <td>{ORDER_STATES[o.status] ?? o.status}</td>
                      <td>{o.status === 'paid' || o.status === 'needs_review' ? (o.receiptNumber ?? '—') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {orders.state.status === 'done' && orders.state.value.some((o) => o.status === 'needs_review') && checkout?.state !== 'needs_review' && <p className="hint">{NEEDS_REVIEW_MESSAGE}</p>}
          </section>
        )}
      </div>
    </div>
  )
}
