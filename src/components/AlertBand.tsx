import type { AlertDisplay } from '../../shared/types'

/**
 * The alert band across the bottom (or top) of a screen, over the slide. It fills its positioned parent and sizes
 * itself from that parent's height, so it looks the same on the projector, the live preview and the stage display.
 */
export function AlertBand({ alert }: { alert: AlertDisplay | null }) {
  if (!alert) return null
  return (
    <div className="alert-layer" role="status" aria-live="polite">
      <div key={alert.key} className={`alert-band ${alert.position}${alert.priority ? ' priority' : ''}`}>
        {alert.text}
      </div>
    </div>
  )
}
