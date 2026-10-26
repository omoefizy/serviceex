import { Sparkles } from 'lucide-react'
import { can, upgradeNote, type FeatureKey } from '../../shared/features'
import { useOperatorStore } from '../store'

interface Props {
  /** The plan feature this action belongs to; when the plan leaves it out, the button says so. */
  feature: FeatureKey
  label: string
  busyLabel: string
  busy: boolean
  /** Why the button cannot be used yet, such as "Type a topic first"; null when it can. AI being off is added here. */
  disabledReason: string | null
  /** What the button does, shown when it is enabled. */
  tooltip: string
  onClick?(): void
  type?: 'button' | 'submit'
}

/** A button for an AI action. Disabled buttons show no tooltip, so the reason sits on a wrapper. */
export function AiButton({ feature, label, busyLabel, busy, disabledReason, tooltip, onClick, type = 'button' }: Props) {
  const aiEnabled = useOperatorStore((s) => s.settings.aiEnabled)
  const reason = !can(feature) ? upgradeNote(feature) : aiEnabled ? disabledReason : 'AI features are turned off in Settings'
  return (
    <span title={reason ?? tooltip}>
      <button type={type} className="button" disabled={reason !== null || busy} onClick={onClick}>
        <Sparkles size={15} aria-hidden="true" /> {busy ? busyLabel : label}
      </button>
    </span>
  )
}
