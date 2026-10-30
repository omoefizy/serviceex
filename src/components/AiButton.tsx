import { Sparkles } from 'lucide-react'
import type { FeatureKey } from '../../shared/features'
import { useOperatorStore } from '../store'
import { Locked } from './Locked'
import { Button } from './ui'

interface Props {
  /** The plan feature this action belongs to; when the plan leaves it out, the button is locked. */
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

/**
 * A button for an AI action. Disabled buttons show no tooltip, so the reason sits on a wrapper. One the plan leaves out
 * is locked, and opens the upgrade popover.
 */
export function AiButton({ feature, label, busyLabel, busy, disabledReason, tooltip, onClick, type = 'button' }: Props) {
  const aiEnabled = useOperatorStore((s) => s.settings.aiEnabled)
  const reason = aiEnabled ? disabledReason : 'AI features are turned off in Settings'
  return (
    <Locked feature={feature}>
      <span title={reason ?? tooltip}>
        <Button type={type} icon={<Sparkles size={15} aria-hidden="true" />} disabled={reason !== null || busy} onClick={onClick}>
          {busy ? busyLabel : label}
        </Button>
      </span>
    </Locked>
  )
}
