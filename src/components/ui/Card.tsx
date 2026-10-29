import { type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  icon?: ReactNode
  /** Buttons at the right of the header. */
  actions?: ReactNode
  /** Buttons along the bottom, right-aligned. */
  footer?: ReactNode
}

/** A bordered group with an optional header and footer. The children stack with the card's own gap. */
export function Card({ title, icon, actions, footer, className, children, ...props }: CardProps) {
  return (
    <section className={cx('ui-card', className)} {...props}>
      {(title || actions) && (
        <header className="ui-card-header">
          {title && (
            <h3 className="ui-card-title">
              {icon}
              {title}
            </h3>
          )}
          {actions && <div className="ui-card-actions">{actions}</div>}
        </header>
      )}
      {children}
      {footer && <footer className="ui-card-footer">{footer}</footer>}
    </section>
  )
}
