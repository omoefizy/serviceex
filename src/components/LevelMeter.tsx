import { useRef } from 'react'
import { meterFraction, TARGET_PEAK_DB, TARGET_RMS_DB, toDb, type MicReading } from '../lib/mic'

/** How long the peak-hold marker and the clip light stay up. */
const HOLD_MS = 1500
const CLIP_MS = 2500

const dbText = (level: number) => (level > 0 ? `${Math.max(-99, toDb(level)).toFixed(0)} dB` : '–∞')

/**
 * The input level: the bar is the average (RMS), the thin line the peak, and the second line the highest peak of the
 * last moment. Green up to the -18 dBFS target, amber to -6 dBFS, red above. A clip light stays on for a moment
 * after the signal clips.
 */
export function LevelMeter({ reading, small = false }: { reading: MicReading | null; small?: boolean }) {
  const hold = useRef({ level: 0, at: 0 })
  const clipAt = useRef(0)
  const now = Date.now()
  const peak = reading?.peak ?? 0
  if (peak >= hold.current.level || now - hold.current.at > HOLD_MS) hold.current = { level: peak, at: now }
  if (reading?.clipped) clipAt.current = now
  const clipping = now - clipAt.current < CLIP_MS
  const rms = reading?.rms ?? 0
  const percent = (level: number) => `${meterFraction(level) * 100}%`

  return (
    <span className={`level-meter-group${small ? ' small' : ''}`}>
      <span
        className={`level-meter${small ? ' small' : ''}`}
        role="meter"
        aria-label="Input level"
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={rms > 0 ? Math.round(Math.max(-60, toDb(rms))) : -60}
        title={`Average ${dbText(rms)}, peak ${dbText(peak)}. Aim for an average around ${TARGET_RMS_DB} dBFS with peaks below ${TARGET_PEAK_DB} dBFS.`}
      >
        <span style={{ width: `${(1 - meterFraction(rms)) * 100}%` }} />
        {peak > 0 && <i className="level-meter-peak" style={{ left: percent(peak) }} />}
        {hold.current.level > 0 && <i className="level-meter-hold" style={{ left: percent(hold.current.level) }} />}
      </span>
      <span className={`clip-light${clipping ? ' on' : ''}`} title={clipping ? 'Clipped in the last few seconds' : 'Not clipping'}>
        CLIP
      </span>
      {!small && (
        <span className="meter-readout">
          avg {dbText(rms)} · peak {dbText(hold.current.level)}
          {reading && reading.limitingDb >= 0.5 && ` · limiting ${reading.limitingDb.toFixed(0)} dB`}
        </span>
      )}
    </span>
  )
}
