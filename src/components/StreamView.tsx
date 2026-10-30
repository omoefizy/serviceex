import { useEffect, useMemo, useRef, useState } from 'react'
import type { OutputState, StreamKeyMode, StreamState, StreamTestBackground } from '../../shared/types'
import { ACTION_SAFE, TITLE_SAFE } from '../lib/stream'
import { Overlays } from './Overlays'
import { SlideLayers } from './OutputView'
import { DefaultFontContext } from './themedSlideLayers'
import { CONTENT_COLORS } from '../styles/contentColors'

const NO_MARGINS = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * A fill color, a border, corner markers, the safe areas and a centre cross, for lining up the key on the vision
 * mixer or the projector on its screen. `width` and `height` are the picture's size in pixels.
 */
export function TestPattern({ width: w, height: h, fill, label }: { width: number; height: number; fill: string; label: string }) {
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
      <rect width={w} height={h} fill={fill} />
      <rect x={line / 2} y={line / 2} width={w - line} height={h - line} fill="none" stroke={CONTENT_COLORS.white} strokeWidth={line} />
      {corners.map(([x, y]) => {
        const dx = x === 0 ? 1 : -1
        const dy = y === 0 ? 1 : -1
        return (
          <path
            key={`${x},${y}`}
            d={`M${x} ${y}h${dx * arm}v${dy * thick}h${-dx * (arm - thick)}v${dy * (arm - thick)}h${-dx * thick}z`}
            fill={CONTENT_COLORS.guideMagenta}
          />
        )
      })}
      <rect {...safe(ACTION_SAFE)} fill="none" stroke={CONTENT_COLORS.white} strokeWidth={line / 2} strokeDasharray={`${h * 0.02} ${h * 0.015}`} />
      <rect {...safe(TITLE_SAFE)} fill="none" stroke={CONTENT_COLORS.white} strokeWidth={line / 2} strokeOpacity={0.6} strokeDasharray={`${h * 0.01} ${h * 0.015}`} />
      <path d={`M${w / 2 - arm / 2} ${h / 2}h${arm}M${w / 2} ${h / 2 - arm / 2}v${arm}`} stroke={CONTENT_COLORS.white} strokeWidth={line} />
      <text x={w / 2} y={h / 2 + arm} textAnchor="middle" fontSize={h * 0.035} fill={CONTENT_COLORS.white} stroke={CONTENT_COLORS.black} strokeWidth={h * 0.003} paintOrder="stroke" fontFamily="Helvetica Neue, Arial, sans-serif" fontWeight={700}>
        {label}
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

/** The background behind the layers, as the vision mixer or capture sees it. */
function keyBackground({ keyMode, keyColor }: StreamState): string {
  if (keyMode === 'chroma') return keyColor
  return keyMode === 'transparent' ? 'transparent' : CONTENT_COLORS.black
}

const KEY_LABELS: Record<StreamKeyMode, string> = { chroma: 'Chroma', luma: 'Luma key', transparent: 'Transparent', keyFill: 'Key and Fill' }

/** The computer's camera, filling its parent; nothing while it is unavailable or refused. */
function Webcam({ onError }: { onError?: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: false })
      .then((media) => {
        if (stopped) return media.getTracks().forEach((track) => track.stop())
        stream = media
        if (videoRef.current) videoRef.current.srcObject = media
      })
      .catch((error: unknown) => onError?.(error instanceof Error ? error.message : String(error)))
    return () => {
      stopped = true
      stream?.getTracks().forEach((track) => track.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the camera opens once
  }, [])
  return <video ref={videoRef} className="stream-key stream-webcam" autoPlay muted playsInline />
}

/**
 * The Stream output, at its own aspect ratio inside its parent. Bottom to top: the background (the key color, black
 * for a luma key or a fill, or nothing for Transparent), the logo layer, the live slide, which covers the logos with
 * its own background unless the stream state empties it, then the idle design and the lower third on top of
 * everything. Black is a black slide layer and takes the idle design and the lower third off.
 *
 * `matte` draws the key for Key and Fill: every layer as white shapes on black, their transparency as grey.
 * `testBackground` (the operator preview only) puts a checkerboard or the webcam where the background would be keyed
 * out, so the layering can be checked without a vision mixer.
 */
export function StreamScreen({ state, guides = false, matte = false, testBackground = 'off', onWebcamError }: {
  state: StreamState | null
  guides?: boolean
  matte?: boolean
  testBackground?: StreamTestBackground
  onWebcamError?: (message: string) => void
}) {
  const slide = useMemo<OutputState | null>(() => state && { ...state, screenMargins: NO_MARGINS, alert: null, overlays: null }, [state])
  if (!state) return <div className="stream-fit" />
  const { width, height, keyMode, keyColor } = state
  const transparent = !matte && testBackground === 'off' && keyMode === 'transparent'
  const layers = (
    <>
      <Overlays overlays={state.overlays} idle={false} lowerThird={false} />
      <SlideLayers state={slide} keyed />
      <Overlays overlays={state.overlays} logos={false} />
    </>
  )
  return (
    <DefaultFontContext.Provider value={state.defaultFont}>
      <div className={`stream-fit${transparent ? ' transparent' : ''}`}>
        <div className="stream-screen" style={{ aspectRatio: `${width} / ${height}`, width: `min(100cqw, ${(100 * width) / height}cqh)` }}>
          {matte ? (
            <div className="stream-key" style={{ background: CONTENT_COLORS.black }} />
          ) : testBackground === 'checker' ? (
            <div className="stream-key checker" />
          ) : testBackground === 'webcam' ? (
            <Webcam onError={onWebcamError} />
          ) : (
            <div className="stream-key" style={{ background: keyBackground(state) }} />
          )}
          {matte ? <div className="stream-matte">{layers}</div> : layers}
          {state.testPattern && !matte && (
            <TestPattern
              width={width}
              height={height}
              fill={keyMode === 'chroma' ? keyColor : CONTENT_COLORS.black}
              label={`${width}×${height} · ${keyMode === 'chroma' ? `Chroma ${keyColor.toUpperCase()}` : KEY_LABELS[keyMode]}`}
            />
          )}
          {guides && <SafeGuides />}
        </div>
      </div>
    </DefaultFontContext.Provider>
  )
}

/** A transparent page for a Transparent background, so window capture, NDI or a virtual camera gets the alpha. */
function useTransparentPage(transparent: boolean) {
  useEffect(() => {
    const targets = [document.documentElement, document.body]
    for (const el of targets) el.style.background = transparent ? 'transparent' : ''
  }, [transparent])
}

/** The Stream output window, for the capture card or vision mixer; with Key and Fill, the fill. */
export function StreamView() {
  const [state, setState] = useState<StreamState | null>(null)
  useEffect(() => window.api.stream.onState(setState), [])
  const transparent = state?.keyMode === 'transparent'
  useTransparentPage(transparent)
  return (
    <div className={`stream-window${transparent ? ' transparent' : ''}`}>
      <StreamScreen state={state} />
    </div>
  )
}

/** The key window for Key and Fill: the Stream output's shapes in white on black, for the vision mixer's key input. */
export function StreamKeyView() {
  const [state, setState] = useState<StreamState | null>(null)
  useEffect(() => window.api.stream.onState(setState), [])
  return (
    <div className="stream-window">
      <StreamScreen state={state} matte />
    </div>
  )
}
