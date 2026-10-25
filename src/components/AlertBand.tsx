import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { matching } from '../../shared/richText'
import type { AlertDisplay } from '../../shared/types'
import { DIVIDER, SAFE_MARGIN, tileCount, tilePlacements } from '../lib/ticker'
import { RichInline } from './RichText'

/**
 * The alert ticker: a band inside the safe margins at the bottom (or top) of a screen, with the messages scrolling
 * right to left in a seamless loop. It fills its positioned parent and sizes itself from that parent's height, so the
 * projector, the live preview and the stage display scroll in step.
 */
export function AlertBand({ alert }: { alert: AlertDisplay | null }) {
  return alert ? <Ticker alert={alert} /> : null
}

function Ticker({ alert }: { alert: AlertDisplay }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<(HTMLDivElement | null)[]>([])
  /** Copies of the strip needed to keep the band covered; set once the strip is measured. */
  const [count, setCount] = useState(2)
  const { texts, layout, startedAt, speed, loops, fontSize, position } = alert
  const textsKey = JSON.stringify([texts, alert.riches ?? null])
  tilesRef.current.length = count

  // Each frame places the copies from the clock alone: no state changes and no text redrawn, only transforms, so the
  // scroll stays smooth and every window agrees on where it is.
  useLayoutEffect(() => {
    const layer = layerRef.current
    const band = bandRef.current
    if (!layer || !band) return
    let bandWidth = 0
    let strip = 0
    let screenHeight = 0
    const measure = () => {
      bandWidth = band.clientWidth
      screenHeight = layer.clientHeight
      // One message at a time: each is followed by a whole band of blank.
      band.style.setProperty('--gap', `${bandWidth}px`)
      strip = tilesRef.current[0]?.offsetWidth ?? 0
      setCount(tileCount(bandWidth, strip))
    }
    let frame = 0
    const tick = () => {
      const now = performance.timeOrigin + performance.now()
      const distance = (Math.max(0, now - startedAt) / 1000) * (speed / 100) * screenHeight
      const placements = tilePlacements(bandWidth, strip, distance, loops, tilesRef.current.length)
      tilesRef.current.forEach((tile, i) => {
        if (!tile) return
        tile.style.transform = `translate3d(${placements[i].x}px, 0, 0)`
        tile.style.visibility = placements[i].visible ? 'visible' : 'hidden'
      })
      frame = requestAnimationFrame(tick)
    }
    measure()
    // Before the first paint, so the text never shows at the band's left edge first.
    tick()
    const observer = new ResizeObserver(measure)
    observer.observe(layer)
    if (tilesRef.current[0]) observer.observe(tilesRef.current[0])
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [textsKey, layout, startedAt, speed, loops, fontSize, count])

  const bandStyle: CSSProperties = {
    height: `${alert.bandHeight}cqh`,
    [position]: `${SAFE_MARGIN}cqh`,
    left: `${SAFE_MARGIN}cqw`,
    right: `${SAFE_MARGIN}cqw`,
  }

  return (
    <div ref={layerRef} className="alert-layer" role="status" aria-label={`Alert: ${texts.join(' · ')}`}>
      <div ref={bandRef} className={`alert-band${alert.priority ? ' priority' : ''}`} style={bandStyle}>
        <div className="alert-band-bg" style={{ background: alert.bandColor, opacity: alert.bandOpacity }} />
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            ref={(el) => {
              tilesRef.current[i] = el
            }}
            className={`alert-tile ${layout}`}
            aria-hidden="true"
            style={{ fontSize: `${fontSize}cqh`, color: alert.textColor }}
          >
            {texts.map((text, j) => {
              const rich = matching(alert.riches?.[j], text)
              return (
                <Fragment key={j}>
                  <span className="alert-text">{rich ? <RichInline rich={rich} /> : text}</span>
                  {layout === 'divider' && <span className="alert-divider">{DIVIDER}</span>}
                </Fragment>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
