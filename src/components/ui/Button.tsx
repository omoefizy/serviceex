import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
/** sm 28px (with a 32px hit area), md 32px, lg 40px: the only button heights there are. */
export type ControlSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ControlSize
  /** Before the label. */
  icon?: ReactNode
  /** After the label, such as a menu chevron. */
  iconEnd?: ReactNode
  /** A toggle button's state, as aria-pressed. */
  pressed?: boolean
  /** Why it is disabled. Disabled buttons show no tooltip, so this sits on a wrapper. */
  disabledTooltip?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconEnd, pressed, disabledTooltip, className, type = 'button', children, ...props },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      className={cx('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className)}
      aria-pressed={pressed}
      {...props}
    >
      {icon}
      {children}
      {iconEnd}
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
