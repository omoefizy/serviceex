import { describe, expect, it } from 'vitest'
import { boltPaths, DESIGN_EFFECTS, effectEndMs, effectTime, effectTracks, newEffect, normalizeEffects } from './designEffects'
import { normalizeDesign } from './designs'

describe('design light effects', () => {
  it('keeps known effects with every setting in range, and drops the rest', () => {
    const effects = normalizeEffects([
      { kind: 'lightSweep', id: 'a', durationMs: 5, speed: 99, angle: 400, color: 'red', repeat: -2, intensity: 3 },
      { kind: 'confetti', id: 'b' },
      'nonsense',
      { kind: 'lightning' },
    ])
    expect(effects.map((e) => e.kind)).toEqual(['lightSweep', 'lightning'])
    expect(effects[0]).toMatchObject({ durationMs: 100, speed: 4, angle: 180, color: '#ffffff', repeat: 0, intensity: 1 })
    expect(effects[1].id).toBe('fx4')
    // Saved with a design, and a design from before effects has none.
    const design = normalizeDesign({ category: 'lowerThird', elements: [{ kind: 'rect', id: 'bar', effects: [{ kind: 'borderChase', id: 'c' }] }, { kind: 'text', id: 't' }] })
    expect(design.elements[0].effects.map((e) => e.kind)).toEqual(['borderChase'])
    expect(design.elements[1].effects).toEqual([])
  })

  it('animates only transform and opacity, so the compositor plays every effect', () => {
    for (const kind of DESIGN_EFFECTS) {
      const tracks = effectTracks(newEffect(kind, 'x'))
      expect(tracks.length, kind).toBeGreaterThan(0)
      for (const track of tracks) {
        for (const frame of track.keyframes) {
          const properties = Object.keys(frame).filter((k) => k !== 'offset' && k !== 'easing')
          expect(properties.every((p) => p === 'transform' || p === 'opacity'), `${kind}: ${properties.join(', ')}`).toBe(true)
        }
      }
    }
  })

  it('times passes from the delay, with a dark gap, a repeat count or a loop, and speed', () => {
    const sweep = { ...newEffect('lightSweep', 's'), durationMs: 1000, gapMs: 500, delayMs: 200, repeat: 2, speed: 1 }
    expect(effectTime(sweep, 100)).toBe('before')
    expect(effectTime(sweep, 700)).toBe(500)
    expect(effectTime(sweep, 1400)).toBe('dark')
    expect(effectTime(sweep, 1800)).toBe(100)
    expect(effectTime(sweep, 3200)).toBe('done')
    expect(effectEndMs(sweep)).toBe(200 + 2500)
    // Twice as fast: the passes and gaps halve, the delay stays.
    expect(effectTime({ ...sweep, speed: 2 }, 450)).toBe(500)
    // Looping never ends; Back and forth runs the second pass backwards.
    const loop = { ...sweep, repeat: 0, direction: 'alternate' as const }
    expect(effectTime(loop, 200 + 15 * 1500 + 300)).toBe(1000 - 300)
    expect(effectEndMs(loop)).toBe(Infinity)
  })

  it('draws the same bolt for a seed, and another for another seed', () => {
    expect(boltPaths(7)).toEqual(boltPaths(7))
    expect(boltPaths(7)).not.toEqual(boltPaths(8))
    for (const points of boltPaths(3)) for (const pair of points.split(' ')) for (const n of pair.split(',').map(Number)) expect(n).toBeGreaterThanOrEqual(0)
  })

  it('flickers in steps picked by the seed, more with more Flicker', () => {
    const lit = (flicker: number) =>
      effectTracks({ ...newEffect('flicker', 'f'), flicker, seed: 11 })[0].keyframes.filter((f) => (f.opacity as number) > 0).length
    expect(lit(0)).toBe(0)
    expect(lit(1)).toBeGreaterThan(lit(0.3))
  })
})
