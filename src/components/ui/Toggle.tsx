import { type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role' | 'title' | 'children'> {
  /** The label beside the switch; the whole row is the hit area. Without one, give it an aria-label. */
  children?: ReactNode
  title?: string
}

/** An on/off switch. A real checkbox (role switch) underneath, so `checked` and `onChange` work as usual. */
export function Toggle({ children, title, className, ...props }: ToggleProps) {
  return (
    <label className={cx('ui-toggle', className)} title={title}>
      <input type="checkbox" role="switch" className="ui-toggle-input" {...props} />
      <span className="ui-toggle-track" aria-hidden="true" />
      {children && <span className="ui-toggle-label">{children}</span>}
    </label>
  )
}

export interface SegmentedOption<T> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
  title?: string
}

interface SegmentedControlProps<T> {
  options: SegmentedOption<T>[]
  value: T
  onChange(value: T): void
  /** Leave it out only inside a group that is already labelled. */
  'aria-label'?: string
  className?: string
}

/** One choice of a few, side by side. Arrow keys move the choice, as in any radio group. */
export function SegmentedControl<T extends string | number>({ options, value, onChange, className, ...props }: SegmentedControlProps<T>) {
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    const next = enabled[(enabled.findIndex((o) => o.value === value) + step + enabled.length) % enabled.length]
    if (!next) return
    onChange(next.value)
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')
    buttons[options.indexOf(next)]?.focus()
  }

  // One stop for Tab: the chosen option, or the first enabled one when the value is not among them.
  const tabStop = options.some((o) => o.value === value) ? value : options.find((o) => !o.disabled)?.value

  return (
    <div className={cx('ui-segmented', className)} role="radiogroup" aria-label={props['aria-label']} onKeyDown={handleKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="ui-segmented-item"
          tabIndex={o.value === tabStop ? 0 : -1}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
