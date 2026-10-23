import { describe, expect, it } from 'vitest'
import { BUILTIN_LOWER_THIRDS, DEFAULT_LOWER_THIRD_STYLE, normalizeLowerThirdStyle } from './lowerThirds'

describe('lower third templates', () => {
  it('ships the four built-in templates, each already valid', () => {
    expect(BUILTIN_LOWER_THIRDS.map((t) => t.name)).toEqual(['Classic Bar', 'Accent Stripe', 'Minimal Text', 'Two Line Banner'])
    for (const { style } of BUILTIN_LOWER_THIRDS) expect(normalizeLowerThirdStyle(style)).toEqual(style)
  })

  it('fills in missing fields and keeps boxes on screen', () => {
    const style = normalizeLowerThirdStyle({
      frame: { x: 90, y: 95, width: 50, height: 50 },
      bar: { color: 'red' },
      headline: { size: 99, maxLines: 9, color: '#ABCDEF' },
      logo: { enabled: true, url: 'file:///etc/passwd' },
    })
    expect(style.frame).toEqual({ x: 90, y: 95, width: 10, height: 5 })
    expect(style.bar.color).toBe(DEFAULT_LOWER_THIRD_STYLE.bar.color)
    expect(style.headline).toMatchObject({ size: 20, maxLines: 4, color: '#abcdef' })
    expect(style.logo.url).toBeNull()
    expect(normalizeLowerThirdStyle(null)).toEqual(DEFAULT_LOWER_THIRD_STYLE)
  })
})
