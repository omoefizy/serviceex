import { useEffect, useState } from 'react'
import { isActiveTransfer, NO_DEVICES_HINT_MS, showNoDevicesHint, useSharingStore } from './sharing'

/** One empty list for every render: a new `[]` from a store selector re-renders forever. */
const NO_NETWORKS: string[] = []

/** When no other computer has been online, or null while one is; it starts again when Sharing is turned on. */
function useQuietSince(enabled: boolean, anyOnline: boolean): number | null {
  const [since, setSince] = useState<number | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    setSince(enabled && !anyOnline ? Date.now() : null)
    if (!enabled || anyOnline) return
    // Renders again once the hint is due.
    const timer = setTimeout(() => tick((n) => n + 1), NO_DEVICES_HINT_MS)
    return () => clearTimeout(timer)
  }, [enabled, anyOnline])
  return since
}

/** What the toolbar's status button says about sharing: who is online, how far transfers are, and any network trouble. */
export function useSharingSummary() {
  const enabled = useSharingStore((s) => s.status?.enabled ?? false)
  const peers = useSharingStore((s) => s.peers)
  const transfers = useSharingStore((s) => s.transfers)
  const incoming = useSharingStore((s) => s.incoming)
  const publicNetworks = useSharingStore((s) => s.status?.publicNetworks ?? NO_NETWORKS)
  const online = peers.filter((p) => p.online && !p.disconnected).length
  const quietSince = useQuietSince(enabled, online > 0)
  const sending = transfers.filter(isActiveTransfer)
  const receiving = incoming.filter((t) => t.state === 'receiving' || t.state === 'stalled')
  const size = sending.reduce((n, t) => n + t.size, 0) + receiving.reduce((n, t) => n + t.size, 0)
  const done = sending.reduce((n, t) => n + t.sent, 0) + receiving.reduce((n, t) => n + t.received, 0)
  return {
    enabled,
    online,
    /** Every transfer under way, as one percentage; null when none is. */
    percent: sending.length + receiving.length > 0 ? size > 0 ? Math.floor((done / size) * 100) : 0 : null,
    failed: transfers.some((t) => t.state === 'failed'),
    noDevices: showNoDevicesHint(quietSince, Date.now()),
    publicNetworks,
  }
}
