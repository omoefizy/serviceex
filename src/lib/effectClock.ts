// The clock behind the design light effects (shared/designEffects.ts). Each effect's layers play Web Animations that
// stay paused; one requestAnimationFrame loop sets their time, at most 60 times a second whatever the display's
// refresh rate, so a 120 Hz screen does no extra work. Only transform and opacity animate, so each tick is composited
// without repainting. While the window is hidden (an output turned off, a minimised window) the loop stops, and the
// effects take up again where they were when it shows. An effect that has played its last pass leaves the clock.

import { effectTime } from '../../shared/designEffects'
import type { DesignEffect } from '../../shared/types'

/** The most ticks a second. */
export const EFFECT_FPS = 60
const FRAME_MS = 1000 / EFFECT_FPS

interface Driven {
  effect: DesignEffect
  animations: Animation[]
  /** When the element came in, on the clock: the effect's delay counts from here. */
  startedAt: number
}

const driven = new Set<Driven>()
let frame = 0
let lastTick = -Infinity
let hiddenAt: number | null = null
/** Ticks so far, for the frame rate check in the benchmark. */
let ticks = 0

const now = () => performance.now()
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/** Sets each of the effect's animations to its time; false once it has played its last pass. */
function apply(d: Driven, at: number): boolean {
  const time = effectTime(d.effect, at - d.startedAt)
  // Before the delay and between passes, past the end with no fill: nothing shows. After the last pass it stays so.
  const current = typeof time === 'number' ? time : d.effect.durationMs + 1
  for (const animation of d.animations) animation.currentTime = current
  return time !== 'done'
}

function tick(at: number) {
  frame = 0
  if (hidden() || driven.size === 0) return
  // Within a frame of the last tick (less a little for timer jitter) there is nothing new to show.
  if (at - lastTick >= FRAME_MS - 2) {
    lastTick = at
    ticks++
    for (const d of driven) if (!apply(d, at)) driven.delete(d)
  }
  if (driven.size > 0) frame = requestAnimationFrame(tick)
}

function wake() {
  if (frame === 0 && driven.size > 0 && !hidden()) frame = requestAnimationFrame(tick)
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (hidden()) {
      hiddenAt = now()
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      return
    }
    // Shown again: the time hidden does not count, so each effect carries on from where it was.
    if (hiddenAt !== null) {
      const away = now() - hiddenAt
      for (const d of driven) d.startedAt += away
      hiddenAt = null
    }
    wake()
  })
}

/**
 * Plays `animations` (already made, one effect's layers) on the clock from `startedAt`. Returns the function that
 * stops them and takes them off.
 */
export function driveEffect(effect: DesignEffect, animations: Animation[], startedAt = now()): () => void {
  for (const animation of animations) animation.pause()
  const d: Driven = { effect, animations, startedAt }
  if (apply(d, now())) {
    driven.add(d)
    wake()
  }
  return () => {
    driven.delete(d)
    for (const animation of animations) animation.cancel()
    if (driven.size === 0 && frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }
}

/** How many effects are playing and the ticks so far: for tests and the effects benchmark. */
export function effectClockStats(): { playing: number; ticks: number; running: boolean } {
  return { playing: driven.size, ticks, running: frame !== 0 }
}
