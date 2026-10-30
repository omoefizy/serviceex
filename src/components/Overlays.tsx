import { useEffect, useState, type CSSProperties } from 'react'
import type { DesignStyle, LogoItem, OverlayLayers } from '../../shared/types'
import { ACTION_SAFE } from '../lib/stream'
import { DesignView } from './DesignView'
import { LowerThirdLayer } from './LowerThird'

/** How long the idle design takes to fade in when the main content clears, and out when something goes up. */
export const IDLE_FADE_MS = 500

/** Places a logo: in from a corner of the action safe area by its margin, or centred on its free position. */
function logoStyle(logo: LogoItem): CSSProperties {
  const style: CSSProperties = { height: `${logo.size}cqh`, opacity: logo.opacity }
  if (logo.anchor === 'free') return { ...style, left: `${logo.x}%`, top: `${logo.y}%`, transform: 'translate(-50%, -50%)' }
  const [vertical, horizontal] = logo.anchor.split('-') as ['top' | 'bottom', 'left' | 'right']
  // The margin is in screen height on both axes, so it looks the same across and down.
  return { ...style, [vertical]: `calc(${ACTION_SAFE}cqh + ${logo.margin}cqh)`, [horizontal]: `calc(${ACTION_SAFE}cqw + ${logo.margin}cqh)` }
}

/**
 * The idle layer: the idle design while the main content is cleared, fading in and out. The last one shown stays until
 * it has faded. Its elements flagged to hide while a lower third is live fade out meanwhile.
 */
function IdleLayer({ design, lowerThirdLive }: { design: DesignStyle | null; lowerThirdLive: boolean }) {
  const [shown, setShown] = useState<{ design: DesignStyle; leaving: boolean } | null>(design && { design, leaving: false })

  useEffect(() => {
    if (design) setShown({ design, leaving: false })
    else setShown((current) => current && (current.leaving ? current : { ...current, leaving: true }))
  }, [design])

  useEffect(() => {
    if (!shown?.leaving) return
    const timer = setTimeout(() => setShown(null), IDLE_FADE_MS)
    return () => clearTimeout(timer)
  }, [shown])

  if (!shown) return null
  return (
    <div className={`idle-layer lt-fade-${shown.leaving ? 'out' : 'in'}`} style={{ animationDuration: `${IDLE_FADE_MS}ms` }}>
      <DesignView style={shown.design} onAir lowerThirdLive={lowerThirdLive} />
    </div>
  )
}

/**
 * The overlay layers, bottom to top: the logo layer, the idle design, then the lower third. They fill their
 * positioned parent and size themselves from its height, so the Stream output, the projector and the previews place
 * them alike. `logos`, `idle` and `lowerThird` pick which to draw, so an output can put other layers between them.
 */
export function Overlays({ overlays, logos = true, idle = true, lowerThird = true }: { overlays: OverlayLayers; logos?: boolean; idle?: boolean; lowerThird?: boolean }) {
  return (
    <div className="overlay-layers">
      {logos && (
        <div className="logo-layer">
          {overlays.logos.map((logo) => (
            <img key={logo.id} className="overlay-logo" src={logo.url} style={logoStyle(logo)} alt="" draggable={false} />
          ))}
        </div>
      )}
      {idle && <IdleLayer design={overlays.idle} lowerThirdLive={overlays.lowerThird !== null} />}
      {lowerThird && (
        <div className="lower-third-layer">
          <LowerThirdLayer display={overlays.lowerThird} />
        </div>
      )}
    </div>
  )
}
