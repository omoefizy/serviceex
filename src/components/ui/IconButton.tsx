import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { ControlSize } from './Button'
import { cx } from './cx'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> {
  /** What it does, for screen readers; also the tooltip unless `tooltip` is given. */
  label: string
  icon: ReactNode
  /** A longer tooltip than the label. */
  tooltip?: string
  size?: ControlSize
  /** A toggle button's state, as aria-pressed. */
  pressed?: boolean
  /** Why it is disabled. Disabled buttons show no tooltip, so this sits on a wrapper. */
  disabledTooltip?: string
}

/** A square button with only an icon, drawn at 32 to 44px inside an invisible 40px hit area, with a tooltip and aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tooltip, size = 'md', pressed, disabledTooltip, className, type = 'button', children, ...props },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      className={cx('ui-icon-button', `ui-icon-button--${size}`, className)}
      aria-label={label}
      aria-pressed={pressed}
      title={props.disabled ? undefined : (tooltip ?? label)}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
  return props.disabled && disabledTooltip ? (
    <span className="ui-tooltip-wrap" title={disabledTooltip}>
      {button}
    </span>
  ) : (
    button
  )
})
