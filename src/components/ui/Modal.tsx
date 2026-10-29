import { X } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { cx } from './cx'
import { IconButton } from './IconButton'

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export interface ModalProps {
  title: ReactNode
  onClose(): void
  /** Buttons along the bottom, right-aligned; the primary action goes last. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** What gets focus on open; otherwise the first field or button in the body. */
  initialFocus?: RefObject<HTMLElement>
  className?: string
  children: ReactNode
}

/** A dialog over a scrim. Escape and a click on the scrim close it; Tab stays inside; focus goes back on close. */
export function Modal({ title, onClose, footer, size = 'md', initialFocus, className, children }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const target = initialFocus?.current ?? dialog?.querySelector<HTMLElement>(`.ui-modal-body :is(${FOCUSABLE})`) ?? dialog
    target?.focus({ preventScroll: true })
    return () => previous?.focus?.({ preventScroll: true })
  }, [initialFocus])

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="ui-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={cx('ui-modal', `ui-modal--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">
            {title}
          </h2>
          <IconButton label="Close" icon={<X size={16} />} onClick={onClose} />
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}
