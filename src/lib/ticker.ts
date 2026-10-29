// The alert ticker's geometry, shared by the band that draws it and the store that times its runs. Lengths are in
// percent of screen height unless named in pixels, so every screen size scrolls in step.

import type { AlertLayout } from '../../shared/types'
import { CONTENT_COLORS } from '../styles/contentColors'

/** The band stays inside this margin, in percent, on every side of the screen: the projector's safe area. */
export const SAFE_MARGIN = 5
/** The divider between messages in the divider layout, with this much space either side of it, in em. */
export const DIVIDER = '◆'
export const DIVIDER_SPACE_EM = 0.8
export const TICKER_FONT = "'Helvetica Neue', Inter, 'Segoe UI', Arial, sans-serif"
export const TICKER_WEIGHT = 700
/** A priority message scrolls through this many times before the normal messages carry on. */
export const PRIORITY_PASSES = 2
export const PRIORITY_BAND_COLOR = CONTENT_COLORS.priorityBand
/** Scroll speeds for the Slow, Medium and Fast buttons, in percent of screen height per second. */
export const SPEED_PRESETS = { slow: 8, medium: 14, fast: 22 } as const

/** The band's width on a 16:9 projector inside the safe margins, in percent of screen height. */
export const OUTPUT_BAND_WIDTH = (16 / 9) * 100 * (1 - (2 * SAFE_MARGIN) / 100)

let canvas: HTMLCanvasElement | null = null

/** The width of `text` at `fontSize`, in the same units. Without a DOM (tests) it estimates from the length. */
export function measureText(text: string, fontSize: number): number {
  const context = typeof document === 'undefined' ? null : (canvas ??= document.createElement('canvas')).getContext('2d')
  if (!context) return text.length * 0.55 * fontSize
  context.font = `${TICKER_WEIGHT} 100px ${TICKER_FONT}`
  return (context.measureText(text).width / 100) * fontSize
}

/** What follows each message: the divider with its spacing, or, one message at a time, a whole band of blank. */
export function separatorWidth(layout: AlertLayout, fontSize: number, bandWidth: number): number {
  return layout === 'sequence' ? bandWidth : measureText(DIVIDER, fontSize) + 2 * DIVIDER_SPACE_EM * fontSize
}

/** One time through every message, separators included: the length after which the strip repeats seamlessly. */
export function stripWidth(texts: string[], layout: AlertLayout, fontSize: number, bandWidth: number): number {
  const separator = separatorWidth(layout, fontSize, bandWidth)
  return texts.reduce((sum, text) => sum + measureText(text, fontSize) + separator, 0)
}

/**
 * How long `loops` times through the messages take on the projector, from the first letter entering at the right to
 * the last leaving at the left.
 */
export function runDurationMs(texts: string[], loops: number, layout: AlertLayout, fontSize: number, speed: number): number {
  const strip = stripWidth(texts, layout, fontSize, OUTPUT_BAND_WIDTH)
  const trailing = separatorWidth(layout, fontSize, OUTPUT_BAND_WIDTH)
  return ((OUTPUT_BAND_WIDTH + loops * strip - trailing) / speed) * 1000
}

/** How many copies of the strip it takes to keep a band covered as they scroll. */
export const tileCount = (bandWidth: number, strip: number) => (strip > 0 ? Math.ceil(bandWidth / strip) + 1 : 1)

/**
 * Where each copy of the strip sits once the ticker has scrolled `distance`: copy k starts k strip widths after the
 * first, which entered at the band's right edge, so copies join with no gap. Copies past the last loop stay hidden.
 */
export function tilePlacements(
  bandWidth: number,
  strip: number,
  distance: number,
  loops: number,
  count: number,
): { x: number; visible: boolean }[] {
  const start = bandWidth - distance
  const first = strip > 0 ? Math.max(0, Math.floor(-start / strip)) : 0
  return Array.from({ length: count }, (_, i) => {
    const k = first + i
    const x = start + k * strip
    return { x, visible: (loops === 0 || k < loops) && x < bandWidth && x + strip > 0 }
  })
}
