import { ChevronDown } from 'lucide-react'
import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cx } from './cx'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** sm 32px, md 36px or lg 40px, the same as Input. */
  size?: 'sm' | 'md' | 'lg'
}

/** A native select drawn like Input. `className` goes on the wrapper, which is what layouts size. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ size = 'md', className, children, ...props }, ref) {
  return (
    <span className={cx('ui-select', size !== 'md' && `ui-select--${size}`, className)}>
      <select ref={ref} className="ui-select-field" {...props}>
        {children}
      </select>
      <ChevronDown className="ui-select-chevron" size={14} aria-hidden="true" />
    </span>
  )
})
