import { type ReactNode } from 'react'
import { cx } from './cx'

export interface PanelHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** IconButtons and Buttons, right-aligned. */
  actions?: ReactNode
  className?: string
}

/** The one title style for a panel, with its actions at the right. */
export function PanelHeader({ title, subtitle, actions, className }: PanelHeaderProps) {
  return (
    <header className={cx('panel-header', 'ui-panel-header', className)}>
      <div className="ui-panel-header-text">
        <h2>{title}</h2>
        {subtitle && <p className="ui-panel-header-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ui-panel-header-actions">{actions}</div>}
    </header>
  )
}
