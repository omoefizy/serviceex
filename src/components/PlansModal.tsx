import { ExternalLink, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatHours, formatNaira, NEEDS_REVIEW_MESSAGE, ORDER_STATES, type Order, type Product, type ProductKind } from '../../shared/account'
import { shortDate } from '../../shared/serviceErrors'
import { openPlans, useAccount } from '../lib/account'

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
  const [products, setProducts] = useState<Product[] | null>(null)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buying, setBuying] = useState<string | null>(null)
  const checkout = account?.checkout ?? null

  useEffect(() => window.api.account.warmUp(), [])

  useEffect(() => {
    window.api.account.products().then((answer) => (answer?.ok ? setProducts(answer.value) : setError(answer?.error.message ?? null)), console.error)
  }, [])

  // The order history, again whenever a purchase finishes.
  useEffect(() => {
    if (!account?.signedIn) return
    window.api.account.orders().then((answer) => answer?.ok && setOrders(answer.value), console.error)
  }, [account?.signedIn, checkout?.state])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && openPlans(false)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function buy(product: Product) {
    setError(null)
    setBuying(product.id)
    const started = await window.api.account.buy(product.id)
    setBuying(null)
    if (!started.ok) setError(started.error.message)
  }

  const waiting = checkout?.state === 'waiting'
  return (
    <div className="modal-backdrop" onMouseDown={() => openPlans(false)}>
      <div className="modal plans-modal" role="dialog" aria-label="Plans and Credits" onMouseDown={(e) => e.stopPropagation()}>
        <header className="panel-header">
          <h2>Plans and Credits</h2>
          <button className="icon-button" aria-label="Close" title="Close" onClick={() => openPlans(false)}>
            <X size={18} />
          </button>
        </header>

        {!account?.signedIn && <p className="hint">Sign in in Settings, Account to buy. Prices are shown for reference.</p>}
        {/* After 3 minutes the checks stop quietly; the order keeps its status in Order history. */}
        {checkout && checkout.state !== 'timed_out' && (
          <p className={checkout.state === 'failed' ? 'listener-warning' : 'hint'} role="status">
            {waiting && <Loader2 size={14} className="spin" aria-hidden="true" />} <strong>{checkout.productName}:</strong> {checkout.message}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {products === null && !error && <p className="hint">Loading prices…</p>}
        {products &&
          GROUPS.map(({ kind, title }) => {
            const list = products.filter((p) => p.kind === kind)
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
                        disabled={!account?.signedIn || waiting || buying !== null || (kind === 'updates_renewal' && !account?.license.licenseId)}
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

        {account?.signedIn && (
          <section className="plans-group">
            <h3>Order history</h3>
            {!orders || orders.length === 0 ? (
              <p className="hint">{orders ? 'No orders yet.' : 'Loading…'}</p>
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
                  {orders.map((o) => (
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
            {orders?.some((o) => o.status === 'needs_review') && checkout?.state !== 'needs_review' && <p className="hint">{NEEDS_REVIEW_MESSAGE}</p>}
          </section>
        )}
      </div>
    </div>
  )
}
