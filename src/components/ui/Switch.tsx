import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type'> {
  checked: boolean
  onCheckedChange(checked: boolean): void
}

/** An on/off switch, 48 by 28: a button with role switch, so Space and Enter flip it and screen readers read its state. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch({ checked, onCheckedChange, className, onClick, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx('ui-switch', className)}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onCheckedChange(!checked)
      }}
      {...props}
    >
      <span className="ui-switch-thumb" aria-hidden="true" />
    </button>
  )
})
