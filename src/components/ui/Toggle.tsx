import { useId, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { Switch } from './Switch'

export interface ToggleProps {
  checked?: boolean
  disabled?: boolean
  /** Called as a checkbox's onChange would be, so `e.target.checked` is the new state. */
  onChange?(e: ChangeEvent<HTMLInputElement>): void
  /** The label beside the switch; clicking it flips the switch. Without one, give it an aria-label. */
  children?: ReactNode
  title?: string
  'aria-label'?: string
  className?: string
  /** Shows a state without the pointer, for the dev UI kit. */
  'data-force'?: string
}

/** A labelled on/off switch: the label at the start, the Switch at the end of the row. */
export function Toggle({ children, title, className, checked = false, disabled, onChange, ...props }: ToggleProps) {
  const id = useId()
  const flip = (next: boolean) => onChange?.({ target: { checked: next }, currentTarget: { checked: next } } as ChangeEvent<HTMLInputElement>)
  return (
    <span className={cx('ui-toggle', disabled && 'is-disabled', className)} title={title}>
      {children && (
        <label htmlFor={id} className="ui-toggle-label">
          {children}
        </label>
      )}
      <Switch id={id} checked={checked} disabled={disabled} aria-label={props['aria-label']} data-force={props['data-force']} onCheckedChange={flip} />
    </span>
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
  /** Shows a state without the pointer, for the dev UI kit. */
  'data-force'?: string
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

/** The shorter name the design system uses. */
export const Segmented = SegmentedControl
