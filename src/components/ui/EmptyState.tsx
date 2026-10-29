import { type ReactNode } from 'react'
import { cx } from './cx'
import { DetailsToggle } from './DetailsToggle'

export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  /** One sentence: what goes here, or what to do next. */
  description?: ReactNode
  /** Usually one primary Button. */
  action?: ReactNode
  /** A quieter second step, such as "Add a sample song". */
  secondaryAction?: ReactNode
  /** error: something failed. Say so in plain words, and put the technical text in `details`. */
  tone?: 'default' | 'error'
  /** Technical text, hidden behind Show details. */
  details?: string
  /** Less padding, for narrow panels. */
  compact?: boolean
  className?: string
}

/** What a panel shows when it has nothing in it yet, or when it could not load. */
export function EmptyState({ icon, title, description, action, secondaryAction, tone = 'default', details, compact, className }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', tone === 'error' && 'ui-empty--error', compact && 'ui-empty--compact', className)} role={tone === 'error' ? 'alert' : undefined}>
      {icon && (
        <div className="ui-empty-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="ui-empty-title">{title}</p>
      {description && <p className="ui-empty-text">{description}</p>}
      {(action || secondaryAction) && (
        <div className="ui-empty-actions">
          {action}
          {secondaryAction}
        </div>
      )}
      {details && <DetailsToggle className="ui-empty-details" details={details} />}
    </div>
  )
}
