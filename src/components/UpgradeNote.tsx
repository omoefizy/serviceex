import { Lock } from 'lucide-react'
import { upgradeNote, type FeatureKey } from '../../shared/features'

/** Stands where a feature would be when the plan does not include it. */
export function UpgradeNote({ feature }: { feature: FeatureKey }) {
  return (
    <p className="hint upgrade-note" data-feature={feature}>
      <Lock size={13} aria-hidden="true" /> {upgradeNote(feature)}
    </p>
  )
}
