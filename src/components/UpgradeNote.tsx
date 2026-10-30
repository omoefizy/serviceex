import { Lock } from 'lucide-react'
import { FEATURES, planNameOf, type FeatureKey } from '../../shared/features'
import { askUpgrade } from '../lib/upgrade'

/** Stands where a feature would be when the plan does not include it; clicking it opens the upgrade popover. */
export function UpgradeNote({ feature }: { feature: FeatureKey }) {
  return (
    <button type="button" className="hint upgrade-note" data-feature={feature} aria-haspopup="dialog" onClick={(e) => askUpgrade(feature, e.currentTarget)}>
      <Lock size={13} aria-hidden="true" /> {FEATURES[feature].label} is in the {planNameOf(feature)} plan
    </button>
  )
}
