import { cx } from './cx'

export interface SkeletonProps {
  /** How many placeholder rows. */
  rows?: number
  /** Taller rows, for list items with a button. */
  tall?: boolean
  /** Read out instead of the shapes, such as "Loading prices". */
  label: string
  className?: string
}

/** The shape of what is loading, in place of a "Loading…" line. */
export function Skeleton({ rows = 3, tall, label, className }: SkeletonProps) {
  return (
    <div className={cx('ui-skeleton', tall && 'ui-skeleton--tall', className)} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="ui-skeleton-row" style={{ width: `${[92, 76, 84, 64][i % 4]}%` }} />
      ))}
    </div>
  )
}
