import { cx } from './cx'

export type StatusTone = 'success' | 'warning' | 'error' | 'live' | 'accent' | 'neutral'

export interface StatusDotProps {
  tone?: StatusTone
  /** Pulses, for something happening now (listening, on air). */
  pulse?: boolean
  /** Read out instead of hidden, when the dot is the only sign of the state. */
  label?: string
  className?: string
}

/** An 8px dot in a status color. */
export function StatusDot({ tone = 'neutral', pulse, label, className }: StatusDotProps) {
  return (
    <span
      className={cx('ui-status-dot', `ui-status-dot--${tone}`, pulse && 'is-pulsing', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
