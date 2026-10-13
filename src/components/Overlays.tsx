import type { CSSProperties } from 'react'
import type { LogoItem, OverlayLayers } from '../../shared/types'
import { ACTION_SAFE } from '../lib/stream'

/** Places a logo: in from a corner of the action safe area by its margin, or centred on its free position. */
function logoStyle(logo: LogoItem): CSSProperties {
  const style: CSSProperties = { height: `${logo.size}cqh`, opacity: logo.opacity }
  if (logo.anchor === 'free') return { ...style, left: `${logo.x}%`, top: `${logo.y}%`, transform: 'translate(-50%, -50%)' }
  const [vertical, horizontal] = logo.anchor.split('-') as ['top' | 'bottom', 'left' | 'right']
  // The margin is in screen height on both axes, so it looks the same across and down.
  return { ...style, [vertical]: `calc(${ACTION_SAFE}cqh + ${logo.margin}cqh)`, [horizontal]: `calc(${ACTION_SAFE}cqw + ${logo.margin}cqh)` }
}

/**
 * The overlay layers, bottom to top: the logo layer, then the lower third. They fill their positioned parent and size
 * themselves from its height, so the Stream output, the projector and the previews place them alike.
 */
export function Overlays({ overlays }: { overlays: OverlayLayers }) {
  return (
    <div className="overlay-layers">
      <div className="logo-layer">
        {overlays.logos.map((logo) => (
          <img key={logo.id} className="overlay-logo" src={logo.url} style={logoStyle(logo)} alt="" draggable={false} />
        ))}
      </div>
      {/* The lower third layer will draw here, above the logos. */}
      <div className="lower-third-layer" />
    </div>
  )
}
