import { X } from 'lucide-react'
import { type ReactNode } from 'react'
import { cx } from './cx'

export type ChipTone = 'neutral' | 'accent' | 'live' | 'success' | 'warning' | 'error'

export interface ChipProps {
  tone?: ChipTone
  /** A small dot in the tone's color, before the label. */
  dot?: boolean
  icon?: ReactNode
  /** Makes the chip a button. It stays 24px tall, inside a 32px hit area. */
  onClick?(): void
  /** Adds a remove button, labelled `removeLabel`. */
  onRemove?(): void
  removeLabel?: string
  /** A toggle chip's state, as aria-pressed. */
  pressed?: boolean
  disabled?: boolean
  title?: string
  className?: string
  /** Shows a state without the pointer, for the dev UI kit: "hover", "focus" or "active". */
  'data-force'?: string
  children: ReactNode
}

/** A short label, status or filter. */
export function Chip({ tone = 'neutral', dot, icon, onClick, onRemove, removeLabel = 'Remove', pressed, disabled, title, className, children, ...props }: ChipProps) {
  const force = props['data-force']
  const content = (
    <>
      {dot && <span className="ui-chip-dot" aria-hidden="true" />}
      {icon}
      <span className="ui-chip-label">{children}</span>
    </>
  )
  const classes = cx('ui-chip', `ui-chip--${tone}`, className)

  if (onRemove) {
    return (
      <span className={cx(classes, 'has-remove')} title={title}>
        {onClick ? (
          <button type="button" className="ui-chip-main ui-hit" aria-pressed={pressed} disabled={disabled} data-force={force} onClick={onClick}>
            {content}
          </button>
        ) : (
          content
        )}
        <button type="button" className="ui-chip-remove ui-hit" aria-label={removeLabel} title={removeLabel} disabled={disabled} onClick={onRemove}>
          <X size={12} aria-hidden="true" />
        </button>
      </span>
    )
  }
  if (onClick) {
    return (
      <button type="button" className={cx(classes, 'ui-hit')} aria-pressed={pressed} disabled={disabled} title={title} data-force={force} onClick={onClick}>
        {content}
      </button>
    )
  }
  return (
    <span className={classes} title={title}>
      {content}
    </span>
  )
}
