// PNG import: a picture with transparent, rounded corners gets 9 slice insets that keep its corners whole.
import { describe, expect, it } from 'vitest'
import { isSvgText, sliceInsets } from './designImport'

/** A width by height picture, solid inside a rounded rectangle of `radius` pixels, transparent outside it. */
function roundedBar(width: number, height: number, radius: number) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = Math.min(Math.max(x, radius), width - 1 - radius)
      const cy = Math.min(Math.max(y, radius), height - 1 - radius)
      const inside = Math.hypot(x - cx, y - cy) <= radius
      data[(y * width + x) * 4 + 3] = inside ? 255 : 0
    }
  }
  return { width, height, data }
}

describe('9 slice insets from a PNG', () => {
  it('covers each rounded corner, so stretching never bends it', () => {
    const insets = sliceInsets(roundedBar(400, 100, 20))!
    // The corners are 20 pixels: 5% of the width and 20% of the height at least.
    expect(insets.left).toBeGreaterThanOrEqual(5)
    expect(insets.right).toBeGreaterThanOrEqual(5)
    expect(insets.top).toBeGreaterThanOrEqual(20)
    expect(insets.bottom).toBeGreaterThanOrEqual(20)
    expect(Math.max(insets.left, insets.top)).toBeLessThan(45)
  })

  it('leaves a picture with no transparency as it is', () => {
    const solid = { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) }
    expect(sliceInsets(solid)).toBeNull()
  })
})

describe('pasted text', () => {
  it('is an SVG when it starts as one, as Figma’s Copy as SVG does', () => {
    expect(isSvgText('<svg width="10"></svg>')).toBe(true)
    expect(isSvgText('<?xml version="1.0"?>\n<!-- Figma -->\n<svg>')).toBe(true)
    expect(isSvgText('Pastor Sam')).toBe(false)
  })
})
