import { type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  /** Beside the title, quieter: an item count, a LIVE chip. */
  meta?: ReactNode
  /** Buttons at the right of the header. */
  actions?: ReactNode
  /** Along the bottom, full width. */
  footer?: ReactNode
  as?: 'section' | 'aside'
}

/** One of the operator screen's panels: 16px corners, a Bricolage title, the body scrolling under the header. */
export function Panel({ title, meta, actions, footer, as: Tag = 'section', className, children, ...props }: PanelProps) {
  return (
    <Tag className={cx('ui-panel', className)} {...props}>
      {(title || actions) && (
        <header className="ui-panel-head">
          {title && <h2 className="ui-panel-title">{title}</h2>}
          {meta && <span className="ui-panel-meta">{meta}</span>}
          {actions && <div className="ui-panel-actions">{actions}</div>}
        </header>
      )}
      {children}
      {footer && <footer className="ui-panel-footer">{footer}</footer>}
    </Tag>
  )
}
