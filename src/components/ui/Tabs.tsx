import { type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'

export interface TabItem<T> {
  id: T
  label: string
  icon?: ReactNode
  disabled?: boolean
}

interface TabsProps<T> {
  tabs: TabItem<T>[]
  value: T
  onChange(id: T): void
  'aria-label': string
  /** Prefixes the tab ids; each panel is `${idPrefix}-panel-${id}`, labelled by `${idPrefix}-tab-${id}`. */
  idPrefix: string
  className?: string
}

/** A row of tabs. A label that does not fit ends in an ellipsis and shows in full as a tooltip. */
export function Tabs<T extends string>({ tabs, value, onChange, idPrefix, className, ...props }: TabsProps<T>) {
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const enabled = tabs.filter((t) => !t.disabled)
    const index = enabled.findIndex((t) => t.id === value)
    const next =
      e.key === 'ArrowRight' ? enabled[(index + 1) % enabled.length]
      : e.key === 'ArrowLeft' ? enabled[(index - 1 + enabled.length) % enabled.length]
      : e.key === 'Home' ? enabled[0]
      : e.key === 'End' ? enabled[enabled.length - 1]
      : null
    if (!next) return
    e.preventDefault()
    onChange(next.id)
    e.currentTarget.querySelector<HTMLButtonElement>(`#${CSS.escape(`${idPrefix}-tab-${next.id}`)}`)?.focus()
  }

  return (
    <div className={cx('ui-tabs', className)} role="tablist" aria-label={props['aria-label']} onKeyDown={handleKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`${idPrefix}-tab-${t.id}`}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={t.id === value}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={t.id === value ? 0 : -1}
          disabled={t.disabled}
          title={t.label}
          onClick={() => onChange(t.id)}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}
