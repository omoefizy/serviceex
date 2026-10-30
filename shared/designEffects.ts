// Light effects on a design's elements: a band of light sweeping across, a lightning bolt, a light running round the
// edge, a glow pulse, a flicker and a scan line. Each is a small layer over the element, inside its shape, that only
// moves (transform) and fades (opacity) over a picture drawn once, so the GPU composites it without repainting. The
// renderer (DesignEffects in DesignView) draws the layers and plays these keyframes; the effect clock
// (src/lib/effectClock.ts) sets their time at no more than 60 frames a second, and stops while the window is hidden.

import { DESIGN_EASINGS, EASING_CSS } from './designAnimation'
import { fieldsOf, hex, number, oneOf, text } from './themes'
import type { DesignEffect, DesignEffectDirection, DesignEffectKind, ThemeBox } from './types'

export const DESIGN_EFFECTS: DesignEffectKind[] = ['lightSweep', 'lightning', 'borderChase', 'glowPulse', 'flicker', 'scanLine']
export const EFFECT_DIRECTIONS: DesignEffectDirection[] = ['forward', 'reverse', 'alternate']

export const EFFECT_LABELS: Record<DesignEffectKind, string> = {
  lightSweep: 'Light sweep',
  lightning: 'Lightning',
  borderChase: 'Border chase',
  glowPulse: 'Glow pulse',
  flicker: 'Flicker',
  scanLine: 'Scan line',
}

export const EFFECT_LIMITS = {
  durationMs: [100, 20000],
  speed: [0.25, 4],
  delayMs: [0, 60000],
  gapMs: [0, 60000],
  repeat: [0, 100],
  intensity: [0, 1],
  angle: [-180, 180],
  width: [1, 100],
  flicker: [0, 1],
  seed: [0, 9999],
  glow: [0, 5],
  thickness: [0.1, 3],
  /** Effects on one element. */
  count: 8,
} as const

const BASE: Omit<DesignEffect, 'id' | 'kind'> = {
  durationMs: 1600,
  speed: 1,
  delayMs: 0,
  gapMs: 2400,
  repeat: 0,
  easing: 'easeInOut',
  intensity: 0.6,
  color: '#ffffff',
  angle: 0,
  width: 25,
  direction: 'forward',
  flicker: 0.5,
  seed: 1,
  glow: 1,
  thickness: 0.4,
}

/** Each effect as it starts when added: a sensible look for it, every setting still to change. */
export const EFFECT_DEFAULTS: Record<DesignEffectKind, Omit<DesignEffect, 'id' | 'kind'>> = {
  lightSweep: { ...BASE, angle: 20 },
  lightning: { ...BASE, durationMs: 700, gapMs: 3000, easing: 'linear', intensity: 0.95, color: '#bfe6fa', width: 12, flicker: 0.6, glow: 1.2 },
  borderChase: { ...BASE, durationMs: 3000, gapMs: 0, easing: 'linear', intensity: 0.9, color: '#00afef', width: 25, thickness: 0.35 },
  glowPulse: { ...BASE, durationMs: 2400, gapMs: 0, intensity: 0.7, color: '#00afef', glow: 1.5 },
  flicker: { ...BASE, durationMs: 1200, gapMs: 4000, easing: 'linear', intensity: 0.7, color: '#000000', flicker: 0.6 },
  scanLine: { ...BASE, durationMs: 2200, gapMs: 600, easing: 'linear', intensity: 0.5, angle: 90, width: 4 },
}

export function newEffect(kind: DesignEffectKind, id: string): DesignEffect {
  return { id, kind, ...EFFECT_DEFAULTS[kind] }
}

const lim = (value: unknown, fallback: number, [min, max]: readonly [number, number]) => number(value, fallback, min, max)

function normalizeEffect(value: unknown, index: number): DesignEffect | null {
  const v = fieldsOf(value)
  const kind = oneOf<DesignEffectKind | ''>(v.kind, DESIGN_EFFECTS, '')
  if (!kind) return null
  const d = EFFECT_DEFAULTS[kind]
  const L = EFFECT_LIMITS
  return {
    id: text(v.id, '').slice(0, 64) || `fx${index + 1}`,
    kind,
    durationMs: Math.round(lim(v.durationMs, d.durationMs, L.durationMs)),
    speed: lim(v.speed, d.speed, L.speed),
    delayMs: Math.round(lim(v.delayMs, d.delayMs, L.delayMs)),
    gapMs: Math.round(lim(v.gapMs, d.gapMs, L.gapMs)),
    repeat: Math.round(lim(v.repeat, d.repeat, L.repeat)),
    easing: oneOf(v.easing, DESIGN_EASINGS, d.easing),
    intensity: lim(v.intensity, d.intensity, L.intensity),
    color: hex(v.color, d.color),
    angle: lim(v.angle, d.angle, L.angle),
    width: lim(v.width, d.width, L.width),
    direction: oneOf(v.direction, EFFECT_DIRECTIONS, d.direction),
    flicker: lim(v.flicker, d.flicker, L.flicker),
    seed: Math.round(lim(v.seed, d.seed, L.seed)),
    glow: lim(v.glow, d.glow, L.glow),
    thickness: lim(v.thickness, d.thickness, L.thickness),
  }
}

/** An element's effects as saved: known kinds with every setting in range; anything else is dropped. */
export function normalizeEffects(value: unknown): DesignEffect[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, EFFECT_LIMITS.count)
    .map(normalizeEffect)
    .filter((e): e is DesignEffect => e !== null)
}

// ---------- Timing ----------

/**
 * Where an effect's keyframes are, in milliseconds of one pass, `elapsedMs` after the element came in: 'before' its
 * delay, 'dark' between passes, 'done' after its last pass, else the time into the pass (run backwards on the return
 * passes of Alternate). Speed scales the passes and the gaps, not the delay.
 */
export function effectTime(effect: DesignEffect, elapsedMs: number): number | 'before' | 'dark' | 'done' {
  const t = (elapsedMs - effect.delayMs) * effect.speed
  if (t < 0) return 'before'
  const period = effect.durationMs + effect.gapMs
  const pass = Math.floor(t / period)
  if (effect.repeat > 0 && pass >= effect.repeat) return 'done'
  const into = t - pass * period
  if (into > effect.durationMs) return 'dark'
  return effect.direction === 'alternate' && pass % 2 === 1 ? effect.durationMs - into : into
}

/** How long an effect runs before it stops, after the element came in; Infinity for one that loops. */
export function effectEndMs(effect: DesignEffect): number {
  if (effect.repeat === 0) return Infinity
  return effect.delayMs + (effect.repeat * (effect.durationMs + effect.gapMs) - effect.gapMs) / effect.speed
}

// ---------- Drawing ----------

/** A repeatable random number from 0 to 1 for `seed` and `n` (mulberry32), so a seed draws the same bolt each time. */
export function seeded(seed: number, n: number): number {
  let t = (seed * 9301 + n * 49297 + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * A lightning bolt from top to bottom of a 100 by 100 box: a jagged main stroke and a branch or two, as SVG polyline
 * points. The seed picks the shape.
 */
export function boltPaths(seed: number): string[] {
  const steps = 9
  const main: [number, number][] = []
  let x = 50
  for (let i = 0; i <= steps; i++) {
    main.push([x, (i / steps) * 100])
    x = Math.min(88, Math.max(12, x + (seeded(seed, i) - 0.5) * 46))
  }
  const branches = [3, 6].flatMap((at, b) => {
    if (seeded(seed, 40 + b) < 0.35) return []
    const [bx, by] = main[at]
    const side = seeded(seed, 50 + b) < 0.5 ? -1 : 1
    const points: [number, number][] = [[bx, by]]
    for (let i = 1; i <= 3; i++) points.push([Math.min(98, Math.max(2, bx + side * i * (8 + seeded(seed, 60 + b * 4 + i) * 8))), by + i * 7])
    return [points]
  })
  const round = (n: number) => Math.round(n * 10) / 10
  return [main, ...branches].map((points) => points.map(([px, py]) => `${round(px)},${round(py)}`).join(' '))
}

/** The light's colour at `intensity`, for gradients. */
export const light = (color: string, intensity: number) => `color-mix(in srgb, ${color} ${Math.round(intensity * 100)}%, transparent)`

/**
 * The side of the square a band turns in, in cqw: the box's diagonal, so the band covers the box at any angle. The
 * design is 16:9, so a percent of its height is 9/16 of a percent of its width.
 */
export function diagonal(box: ThemeBox): number {
  const w = box.width
  const h = (box.height * 9) / 16
  return Math.round(Math.sqrt(w * w + h * h) * 100) / 100
}

/** Where a band starts and ends, in percent of its own width: just off one side of the square, to just off the other. */
function travel(effect: DesignEffect): [string, string] {
  const from = 'translateX(-100%)'
  const to = `translateX(${Math.round((100 / effect.width) * 10000) / 100}%)`
  return effect.direction === 'reverse' ? [to, from] : [from, to]
}

/**
 * One part of an effect that moves: its `move` layer travels or turns (transform), its `light` layer fades (opacity).
 * Only those two properties change, so the compositor plays them over pictures drawn once.
 */
export interface EffectTrack {
  part: 'move' | 'light'
  keyframes: Keyframe[]
  /** The pass's easing; stepped flickers keep their own pacing in their keyframes. */
  easing: string
}

/** Stepped brightness for a flicker or a bolt's flashes: `count` steps, each lit (dimmed by chance) or dark, by seed. */
function flashes(effect: DesignEffect, count: number, salt: number, lit: (i: number) => boolean): Keyframe[] {
  const frames: Keyframe[] = []
  for (let i = 0; i <= count; i++) {
    const on = i > 0 && i < count && lit(i)
    const level = 1 - effect.flicker * 0.7 * seeded(effect.seed, salt + 100 + i)
    frames.push({ offset: i / count, opacity: on ? Math.round(effect.intensity * level * 1000) / 1000 : 0, easing: 'steps(1, end)' })
  }
  return frames
}

/** The tracks of one pass of the effect. */
export function effectTracks(effect: DesignEffect): EffectTrack[] {
  const eased = EASING_CSS[effect.easing]
  switch (effect.kind) {
    case 'lightSweep':
    case 'scanLine': {
      const [from, to] = travel(effect)
      return [{ part: 'move', keyframes: [{ transform: from }, { transform: to }], easing: eased }]
    }
    case 'borderChase': {
      const turn = effect.direction === 'reverse' ? -360 : 360
      const keyframes = [
        { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(-50%, -50%) rotate(${turn}deg)`, opacity: 1 },
      ]
      return [{ part: 'move', keyframes, easing: eased }]
    }
    case 'glowPulse':
      return [{ part: 'light', keyframes: [{ opacity: 0 }, { opacity: effect.intensity }, { opacity: 0 }], easing: eased }]
    case 'lightning': {
      // The bolt crosses the element, flashing on the way: more flashes go dark the higher Flicker is.
      const [from, to] = travel(effect)
      return [
        { part: 'move', keyframes: [{ transform: from }, { transform: to }], easing: eased },
        { part: 'light', keyframes: flashes(effect, 12, 0, (i) => seeded(effect.seed, i) >= effect.flicker * 0.6), easing: 'linear' },
      ]
    }
    case 'flicker':
      return [{ part: 'light', keyframes: flashes(effect, 16, 300, (i) => seeded(effect.seed, 300 + i) < effect.flicker), easing: 'linear' }]
  }
}
