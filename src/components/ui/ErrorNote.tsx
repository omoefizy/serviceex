import { CircleAlert } from 'lucide-react'
import { type ReactNode } from 'react'
import { asFriendly, type ErrorLike } from '../../lib/errors'
import { cx } from './cx'
import { DetailsToggle } from './DetailsToggle'

export interface ErrorNoteProps {
  /** Nothing is drawn for null, so it can sit where an error may appear. */
  error: ErrorLike | null | undefined
  /** A button after the sentence, such as Retry. */
  action?: ReactNode
  className?: string
}

/** An error inside a panel or form: a plain sentence, with the technical text behind Show details. */
export function ErrorNote({ error, action, className }: ErrorNoteProps) {
  if (!error) return null
  const { message, details } = asFriendly(error)
  return (
    <div className={cx('ui-error-note', className)} role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <div className="ui-error-note-body">
        <p className="ui-error-note-text">{message}</p>
        {details && <DetailsToggle details={details} />}
      </div>
      {action}
    </div>
  )
}
