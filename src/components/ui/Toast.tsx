import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { type ReactNode } from 'react'
import { cx } from './cx'
import { DetailsToggle } from './DetailsToggle'
import { IconButton } from './IconButton'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

const ICONS: Record<ToastTone, LucideIcon> = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert }

export interface ToastProps {
  tone?: ToastTone
  title?: ReactNode
  children?: ReactNode
  /** A button after the text, such as Undo. */
  action?: ReactNode
  /** Technical text for an error, behind Show details. */
  details?: string | null
  onDismiss?(): void
}

/**
 * A short message about something that just happened. Errors are announced at once; the rest politely. Each tone has
 * its own color (info blue, success green, warning amber, error rose); none uses the live red, which means on air.
 */
export function Toast({ tone = 'info', title, children, action, details, onDismiss }: ToastProps) {
  const Icon = ICONS[tone]
  return (
    <div className={cx('ui-toast', `ui-toast--${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={16} aria-hidden="true" />
      <div className="ui-toast-body">
        {title && <span className="ui-toast-title">{title}</span>}
        {children && <span className="ui-toast-text">{children}</span>}
        {details && <DetailsToggle details={details} />}
      </div>
      {action}
      {onDismiss && <IconButton label="Dismiss" icon={<X size={14} />} onClick={onDismiss} />}
    </div>
  )
}

/** Where toasts stack, at the bottom right of the window. */
export function ToastStack({ children }: { children: ReactNode }) {
  return <div className="ui-toast-stack">{children}</div>
}
