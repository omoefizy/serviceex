import { ChevronDown, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { cx } from './cx'

export interface DetailsToggleProps {
  /** The technical text: shown only after Show details. */
  details: string
  className?: string
}

/** Show details / Hide details, for the technical text behind a plain error sentence. */
export function DetailsToggle({ details, className }: DetailsToggleProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className={cx('ui-details', className)}>
      <button type="button" className="ui-details-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Chevron size={14} aria-hidden="true" />
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <pre id={id} className="ui-details-text">
          {details}
        </pre>
      )}
    </div>
  )
}
