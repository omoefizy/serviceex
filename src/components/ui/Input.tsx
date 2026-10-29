import { forwardRef, type InputHTMLAttributes } from 'react'
import { cx } from './cx'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** sm 32px, md 36px or lg 40px. */
  size?: 'sm' | 'md' | 'lg'
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = 'md', invalid, className, ...props }, ref) {
  return <input ref={ref} className={cx('ui-input', size !== 'md' && `ui-input--${size}`, className)} aria-invalid={invalid || undefined} {...props} />
})
