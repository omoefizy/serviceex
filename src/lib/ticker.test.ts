import { describe, expect, it } from 'vitest'
import { runDurationMs, tileCount, tilePlacements } from './ticker'

describe('tilePlacements', () => {
  const band = 1000
  const strip = 300
  const count = tileCount(band, strip)

  it('starts with the text at the right edge of the band', () => {
    const [first] = tilePlacements(band, strip, 0, 0, count)
    expect(first.x).toBe(band)
  })

  it('joins copies end to end, with no gap at the wrap point', () => {
    for (const distance of [0, 450, 1299.5, 1300, 98_765.25]) {
      const placements = tilePlacements(band, strip, distance, 0, count)
      for (let i = 1; i < placements.length; i++) expect(placements[i].x - placements[i - 1].x).toBeCloseTo(strip)
      // The band is always covered once the text has crossed it.
      if (distance >= band) {
        expect(placements[0].x).toBeLessThanOrEqual(0)
        expect(placements[placements.length - 1].x + strip).toBeGreaterThanOrEqual(band)
      }
    }
  })

  it('shows only the set number of loops', () => {
    const loops = 2
    expect(tilePlacements(band, strip, band + 100, loops, count).some((p) => p.visible)).toBe(true)
    expect(tilePlacements(band, strip, band + loops * strip, loops, count).some((p) => p.visible)).toBe(false)
  })
})

describe('runDurationMs', () => {
  it('grows with each loop, and one message at a time takes longer than a divided stream', () => {
    const texts = ['Parents, please pick up your child', 'Car park full']
    const one = runDurationMs(texts, 1, 'divider', 5, 14)
    const two = runDurationMs(texts, 2, 'divider', 5, 14)
    expect(two).toBeGreaterThan(one)
    expect(runDurationMs(texts, 1, 'sequence', 5, 14)).toBeGreaterThan(one)
    expect(runDurationMs(texts, 1, 'divider', 5, 28)).toBeCloseTo(one / 2)
  })
})
