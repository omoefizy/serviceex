import { describe, expect, it } from 'vitest'
import { boxToPixels, pixelsToBox, referenceBoxBelow, textAreaOf, themeForContent } from './textAreas'
import { BUILTIN_THEMES, DEFAULT_THEME_STYLE, mainTextElement, normalizeTheme } from './themes'
import type { ThemeStyle } from './types'

/** A theme as stored before text areas: a main text box and a Reference box under it. */
const stored = (): ThemeStyle => {
  const theme = JSON.parse(JSON.stringify(normalizeTheme(DEFAULT_THEME_STYLE))) as ThemeStyle
  delete theme.textAreas
  delete theme.referencePlacement
  return theme
}

describe('percent and pixel boxes', () => {
  it('turns percent of the slide into pixels at any output size', () => {
    const box = { x: 10, y: 20, width: 80, height: 50 }
    expect(boxToPixels(box, 1920, 1080)).toEqual({ left: 192, top: 216, width: 1536, height: 540 })
    expect(boxToPixels(box, 1280, 720)).toEqual({ left: 128, top: 144, width: 1024, height: 360 })
    expect(boxToPixels(box, 3840, 2160)).toEqual({ left: 384, top: 432, width: 3072, height: 1080 })
    expect(boxToPixels({ x: 0, y: 0, width: 100, height: 100 }, 1024, 768)).toEqual({ left: 0, top: 0, width: 1024, height: 768 })
  })

  it('turns pixels back into the same percentages', () => {
    const box = { x: 12.5, y: 7.25, width: 62.5, height: 40 }
    for (const [width, height] of [
      [1920, 1080],
      [1280, 720],
      [640, 360],
    ]) {
      const back = pixelsToBox(boxToPixels(box, width, height), width, height)
      expect(back.x).toBeCloseTo(box.x, 10)
      expect(back.y).toBeCloseTo(box.y, 10)
      expect(back.width).toBeCloseTo(box.width, 10)
      expect(back.height).toBeCloseTo(box.height, 10)
    }
    expect(pixelsToBox({ left: 96, top: 54, width: 0, height: 0 }, 960, 540)).toEqual({ x: 10, y: 10, width: 0, height: 0 })
    expect(() => pixelsToBox({ left: 0, top: 0, width: 1, height: 1 }, 0, 1080)).toThrow(RangeError)
  })
})

describe('text area migration', () => {
  it('gives a theme saved before text areas both areas where its text box is, so nothing moves', () => {
    const old = stored()
    expect(old.textAreas).toBeUndefined()
    const migrated = normalizeTheme(old)
    const box = mainTextElement(old.elements)?.box
    expect(box).toBeDefined()
    expect(migrated.textAreas).toEqual({ scripture: box, song: box })
    expect(migrated.referencePlacement).toBeUndefined()
    // Drawn for scripture or songs, every element is where it was.
    expect(themeForContent(migrated, 'scripture').elements).toEqual(old.elements)
    expect(themeForContent(migrated, 'song').elements).toEqual(old.elements)
  })

  it('leaves every built-in theme where it is today', () => {
    for (const { name, style } of BUILTIN_THEMES) {
      const migrated = normalizeTheme(JSON.parse(JSON.stringify(style)))
      const before = normalizeTheme(style).elements
      for (const content of ['scripture', 'song'] as const) {
        expect(themeForContent(migrated, content).elements, `${name} for ${content}`).toEqual(before)
      }
    }
  })

  it('migrates themes from before the layout editor too', () => {
    const legacy = normalizeTheme({ background: { kind: 'solid', color: '#102030' }, fontSize: 6, margin: 8 })
    const box = mainTextElement(legacy.elements)?.box
    expect(legacy.textAreas).toEqual({ scripture: box, song: box })
  })

  it('keeps stored areas, checks them, and gives none to a theme without a text box', () => {
    const theme = normalizeTheme({
      ...stored(),
      textAreas: { scripture: { x: 10, y: 5, width: 80, height: 60 }, song: { x: 90, y: -4, width: 30, height: 500 } },
      referencePlacement: 'below',
    })
    expect(theme.textAreas?.scripture).toEqual({ x: 10, y: 5, width: 80, height: 60 })
    // Kept on the slide.
    expect(theme.textAreas?.song).toEqual({ x: 70, y: 0, width: 30, height: 100 })
    expect(theme.referencePlacement).toBe('below')
    expect(normalizeTheme({ ...stored(), referencePlacement: 'sideways' }).referencePlacement).toBeUndefined()

    const logo = normalizeTheme({ ...stored(), elements: [{ id: 'logo', kind: 'image', box: { x: 40, y: 40, width: 20, height: 20 } }] })
    expect(logo.textAreas).toBeUndefined()
    expect(themeForContent(logo, 'scripture')).toBe(logo)
  })
})

describe('themeForContent', () => {
  const theme = normalizeTheme({
    ...stored(),
    textAreas: { scripture: { x: 5, y: 10, width: 90, height: 50 }, song: { x: 20, y: 30, width: 60, height: 40 } },
  })

  it('puts the main text in the area for scripture or songs, and leaves other content alone', () => {
    expect(mainTextElement(themeForContent(theme, 'scripture').elements)?.box).toEqual({ x: 5, y: 10, width: 90, height: 50 })
    expect(mainTextElement(themeForContent(theme, 'song').elements)?.box).toEqual({ x: 20, y: 30, width: 60, height: 40 })
    expect(themeForContent(theme, 'announcement')).toBe(theme)
    expect(themeForContent(theme, null)).toBe(theme)
    expect(textAreaOf(theme, 'song')).toEqual({ x: 20, y: 30, width: 60, height: 40 })
  })

  it('returns the same object for the same theme, so store selectors stay stable', () => {
    expect(themeForContent(theme, 'scripture')).toBe(themeForContent(theme, 'scripture'))
    expect(themeForContent(theme, 'song')).not.toBe(themeForContent(theme, 'scripture'))
  })

  it('puts the scripture reference inside the area or just below it', () => {
    const reference = (style: ThemeStyle) => style.elements.find((e) => e.kind === 'reference')
    const inside = themeForContent({ ...theme, referencePlacement: 'inside' }, 'scripture')
    expect(reference(inside)).toMatchObject({ attached: true })

    const below = themeForContent({ ...theme, referencePlacement: 'below' }, 'scripture')
    const ref = reference(below)
    expect(ref).toMatchObject({ attached: false })
    expect(ref?.box.y).toBe(60)
    expect(ref?.box.x).toBe(5)
    expect(ref?.box.width).toBe(90)
    // Songs have no reference to place.
    expect(reference(themeForContent({ ...theme, referencePlacement: 'below' }, 'song'))).toEqual(reference(theme))
  })

  it('keeps a reference below an area at the bottom of the slide on the slide', () => {
    const props = { ...mainTextElement(theme.elements)!.text, fontSize: 4, lineHeight: 1.2, padding: 1 }
    const box = referenceBoxBelow({ x: 0, y: 70, width: 100, height: 30 }, props)
    expect(box.y + box.height).toBeLessThanOrEqual(100)
    expect(box.height).toBeCloseTo(7.8, 5)
  })
})
