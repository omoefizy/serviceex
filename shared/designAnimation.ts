// Design animation: how each element of a design comes on and goes off, and when. The timeline works out every
// element's start from its order and delay, so elements can build one after the other; the renderer turns it into CSS
// animations (DesignView), the lower third layer waits for the way out to finish, and the designer plays it.

import type { DesignEasing, DesignElement, DesignElementAnimation, DesignLoop, DesignMotion, DesignMotionStep, DesignStyle } from './types'

export type AnimationPhase = 'in' | 'out'

export const DESIGN_MOTIONS: DesignMotion[] = ['none', 'fade', 'slideLeft', 'slideRight', 'slideBottom', 'slideTop', 'wipe', 'scale']
export const DESIGN_EASINGS: DesignEasing[] = ['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut', 'back']

export const MOTION_LIMITS = { durationMs: [50, 5000], delayMs: [0, 10000], order: [0, 50] } as const

const STEP: DesignMotionStep = { motion: 'none', durationMs: 500, delayMs: 0, easing: 'easeOut' }

/** An element that simply appears and goes with the design. */
export const NO_ANIMATION: DesignElementAnimation = { in: STEP, out: { ...STEP, easing: 'easeIn' }, order: 0 }

export const EASING_CSS: Record<DesignEasing, string> = {
  linear: 'linear',
  ease: 'ease',
  easeIn: 'ease-in',
  easeOut: 'ease-out',
  easeInOut: 'ease-in-out',
  back: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
}

/** The loops as CSS animations (keyframes in index.css), so they can run after an element's way in. */
export const LOOP_CSS: Record<Exclude<DesignLoop, 'none'>, string> = {
  pulse: 'dv-pulse 2.4s ease-in-out infinite',
  float: 'dv-float 3.2s ease-in-out infinite',
  glow: 'dv-glow 2.8s ease-in-out infinite',
  spin: 'dv-spin 10s linear infinite',
  shimmer: 'dv-shimmer 2.6s ease-in-out infinite',
}

/** One element's part of the timeline: when its movement starts and how long it runs, in milliseconds. */
export interface TimelineEntry {
  id: string
  motion: DesignMotion
  startMs: number
  durationMs: number
  easing: DesignEasing
}

export interface Timeline {
  /** In the design's element order, hidden elements left out. */
  entries: TimelineEntry[]
  /** When the last movement ends. */
  totalMs: number
}

/**
 * When each element moves on the way in or out. Elements of the lowest order go first (on the way out, the highest),
 * each after its own delay; the next order starts once every movement of the one before has ended. An element with no
 * movement appears at its start on the way in, and on the way out simply goes with the design at the end.
 */
export function designTimeline(elements: DesignElement[], phase: AnimationPhase): Timeline {
  const shown = elements.filter((e) => !e.hidden)
  const orders = [...new Set(shown.map((e) => e.animation.order))].sort((a, b) => (phase === 'in' ? a - b : b - a))
  const byId = new Map<string, TimelineEntry>()
  let groupStart = 0
  for (const order of orders) {
    let groupEnd = groupStart
    for (const element of shown) {
      if (element.animation.order !== order) continue
      const step = element.animation[phase]
      const moves = step.motion !== 'none'
      if (!moves && phase === 'out') continue
      const startMs = groupStart + step.delayMs
      const durationMs = moves ? step.durationMs : 0
      byId.set(element.id, { id: element.id, motion: step.motion, startMs, durationMs, easing: step.easing })
      groupEnd = Math.max(groupEnd, startMs + durationMs)
    }
    groupStart = groupEnd
  }
  const entries = shown.flatMap((e) => byId.get(e.id) ?? [])
  return { entries, totalMs: groupStart }
}

/** Whether the design's elements animate themselves; if not, the lower third animates the design as a whole. */
export function animatesItself(style: DesignStyle): boolean {
  return designTimeline(style.elements, 'in').totalMs > 0 || designTimeline(style.elements, 'out').totalMs > 0
}

/** How far through its movement an element is at `atMs`, 0 (not started) to 1 (done), before easing. */
export function progressAt(entry: TimelineEntry, atMs: number): number {
  if (atMs < entry.startMs) return 0
  if (entry.durationMs === 0) return 1
  return Math.min(1, (atMs - entry.startMs) / entry.durationMs)
}

/**
 * The CSS animation for an element's movement, or null for none. On the way in it holds its first frame while it
 * waits (an element with no movement stays hidden until its start); on the way out it holds its last frame.
 */
export function motionCss(entry: TimelineEntry | undefined, phase: AnimationPhase): string | null {
  if (!entry) return null
  if (entry.motion === 'none') return entry.startMs > 0 ? `dv-in-pop 1ms linear ${entry.startMs}ms backwards` : null
  return `dv-${phase}-${entry.motion} ${entry.durationMs}ms ${EASING_CSS[entry.easing]} ${entry.startMs}ms ${phase === 'in' ? 'backwards' : 'forwards'}`
}

/** How far an element slides from (or to) its edge to be just off screen: --dv-dx in cqw, --dv-dy in cqh. */
export function slideOffsets(element: DesignElement): { dx: number; dy: number } {
  const { x, y, width, height } = element.box
  const round = (n: number) => Math.round(n * 100) / 100
  return { dx: round(Math.max(x + width, 100 - x)), dy: round(Math.max(y + height, 100 - y)) }
}

/** The movements the free plan plays: an element appears, or fades in and out. */
export const FREE_MOTIONS: readonly DesignMotion[] = ['none', 'fade']

/**
 * A design as the free plan plays it: every movement becomes a fade (keeping its timing), and loops and light
 * effects are left out. The design itself is not changed.
 */
export function fadeOnly(style: DesignStyle): DesignStyle {
  const step = (s: DesignMotionStep): DesignMotionStep => (FREE_MOTIONS.includes(s.motion) ? s : { ...s, motion: 'fade' })
  return {
    ...style,
    elements: style.elements.map((e: DesignElement) => ({ ...e, loop: 'none', effects: [], animation: { ...e.animation, in: step(e.animation.in), out: step(e.animation.out) } })),
  }
}

/** Whether a design uses anything beyond fading in and out. */
export const usesProMotion = (style: DesignStyle): boolean =>
  style.elements.some((e) => e.loop !== 'none' || e.effects.length > 0 || !FREE_MOTIONS.includes(e.animation.in.motion) || !FREE_MOTIONS.includes(e.animation.out.motion))
