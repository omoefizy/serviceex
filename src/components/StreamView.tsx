import { useEffect, useMemo, useState } from 'react'
import type { OutputState, StreamState } from '../../shared/types'
import { ACTION_SAFE, TITLE_SAFE } from '../lib/stream'
import { Overlays } from './Overlays'
import { SlideLayers } from './OutputView'

/** The key color, a border, corner markers and the safe areas, for lining up the key on the vision mixer. */
function TestPattern({ state }: { state: StreamState }) {
  const { width: w, height: h, keyMode, keyColor } = state
  const line = h * 0.008
  const arm = h * 0.1
  const thick = h * 0.02
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]
  const safe = (percent: number) => ({ x: (w * percent) / 100, y: (h * percent) / 100, width: (w * (100 - 2 * percent)) / 100, height: (h * (100 - 2 * percent)) / 100 })
  return (
    <svg className="stream-test-pattern" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="Test pattern">
      <rect width={w} height={h} fill={keyMode === 'luma' ? '#000000' : keyColor} />
      <rect x={line / 2} y={line / 2} width={w - line} height={h - line} fill="none" stroke="#ffffff" strokeWidth={line} />
      {corners.map(([x, y]) => {
        const dx = x === 0 ? 1 : -1
        const dy = y === 0 ? 1 : -1
        return (
          <path
            key={`${x},${y}`}
            d={`M${x} ${y}h${dx * arm}v${dy * thick}h${-dx * (arm - thick)}v${dy * (arm - thick)}h${-dx * thick}z`}
            fill="#ff00ff"
          />
        )
      })}
      <rect {...safe(ACTION_SAFE)} fill="none" stroke="#ffffff" strokeWidth={line / 2} strokeDasharray={`${h * 0.02} ${h * 0.015}`} />
      <rect {...safe(TITLE_SAFE)} fill="none" stroke="#ffffff" strokeWidth={line / 2} strokeOpacity={0.6} strokeDasharray={`${h * 0.01} ${h * 0.015}`} />
      <path d={`M${w / 2 - arm / 2} ${h / 2}h${arm}M${w / 2} ${h / 2 - arm / 2}v${arm}`} stroke="#ffffff" strokeWidth={line} />
      <text x={w / 2} y={h / 2 + arm} textAnchor="middle" fontSize={h * 0.035} fill="#ffffff" stroke="#000000" strokeWidth={h * 0.003} paintOrder="stroke" fontFamily="Helvetica Neue, Arial, sans-serif" fontWeight={700}>
        {`${w}×${h} · ${keyMode === 'luma' ? 'Luma key' : `Chroma ${keyColor.toUpperCase()}`}`}
      </text>
    </svg>
  )
}

/** The title safe and action safe margins, for the operator preview only. */
function SafeGuides() {
  return (
    <div className="stream-guides" aria-hidden="true">
      <div className="stream-guide action" style={{ inset: `${ACTION_SAFE}%` }}>
        <span>Action safe</span>
      </div>
      <div className="stream-guide title" style={{ inset: `${TITLE_SAFE}%` }}>
        <span>Title safe</span>
      </div>
    </div>
  )
}

/**
 * The Stream output, at its own aspect ratio inside its parent. Bottom to top: the key color (black for a luma key),
 * the logo layer, the lower third slot, then the live slide, which covers them with its own background unless the
 * stream state empties it. Black is a black slide layer, so it covers everything.
 */
export function StreamScreen({ state, guides = false }: { state: StreamState | null; guides?: boolean }) {
  const slide = useMemo<OutputState | null>(() => state && { ...state, alert: null, overlays: null }, [state])
  if (!state) return <div className="stream-fit" />
  const { width, height } = state
  return (
    <div className="stream-fit">
      <div className="stream-screen" style={{ aspectRatio: `${width} / ${height}`, width: `min(100cqw, ${(100 * width) / height}cqh)` }}>
        <div className="stream-key" style={{ background: state.keyMode === 'luma' ? '#000000' : state.keyColor }} />
        <Overlays overlays={state.overlays} />
        <SlideLayers state={slide} keyed />
        {state.testPattern && <TestPattern state={state} />}
        {guides && <SafeGuides />}
      </div>
    </div>
  )
}

/** The Stream output window, for the capture card or vision mixer. */
export function StreamView() {
  const [state, setState] = useState<StreamState | null>(null)
  useEffect(() => window.api.stream.onState(setState), [])
  return (
    <div className="stream-window">
      <StreamScreen state={state} />
    </div>
  )
}
