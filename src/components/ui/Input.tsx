import { forwardRef, type InputHTMLAttributes } from 'react'
import { cx } from './cx'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** md 32px or lg 40px; fields have no smaller size. */
  size?: 'md' | 'lg'
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = 'md', invalid, className, ...props }, ref) {
  return <input ref={ref} className={cx('ui-input', size === 'lg' && 'ui-input--lg', className)} aria-invalid={invalid || undefined} {...props} />
})
