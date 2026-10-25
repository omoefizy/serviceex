import { describe, expect, it } from 'vitest'
import { BUNDLED_FONTS, cssFontFamily, fallbackFor, migrateFontName, replaceThemeFont, themeFonts } from './fonts'
import { DEFAULT_THEME_STYLE, newElement, normalizeTheme } from './themes'
import { normalizeLowerThirdStyle } from './lowerThirds'
import type { ThemeElement } from './types'

describe('migrateFontName', () => {
  it('matches bundled fonts whatever the spelling', () => {
    expect(migrateFontName('montserrat')).toBe('Montserrat')
    expect(migrateFontName("'Open Sans'")).toBe('Open Sans')
    expect(migrateFontName('Lato Regular')).toBe('Lato')
    expect(migrateFontName('Source Sans Pro')).toBe('Source Sans 3')
    expect(migrateFontName('OpenSans')).toBe('Open Sans')
  })

  it('keeps stacks and other fonts as they are', () => {
    const stack = "'Helvetica Neue', Inter, 'Segoe UI', Arial, sans-serif"
    expect(migrateFontName(stack)).toBe(stack)
    expect(migrateFontName('Montserrat SemiBold')).toBe('Montserrat SemiBold')
    expect(migrateFontName(' Avenir Next ')).toBe('Avenir Next')
    expect(migrateFontName('')).toBe('')
  })

  it('runs when themes and lower thirds are read', () => {
    const element = { ...newElement('text', 'main'), text: { ...DEFAULT_THEME_STYLE.elements.find((e) => e.kind === 'text')!.text, fontFamily: 'source sans pro' } }
    const theme = normalizeTheme({ ...DEFAULT_THEME_STYLE, elements: [element] }, 'song')
    expect((theme.elements[0] as Extract<ThemeElement, { kind: 'text' }>).text.fontFamily).toBe('Source Sans 3')
    const lowerThird = normalizeLowerThirdStyle({ headline: { fontFamily: 'bebas neue' } })
    expect(lowerThird.headline.fontFamily).toBe('Bebas Neue')
  })
})

describe('fallbacks', () => {
  it('falls back to a bundled font of the same kind, never the default serif for a sans font', () => {
    expect(fallbackFor('Calibri')).toBe('"Inter", sans-serif')
    expect(fallbackFor('Futura')).toBe('"Montserrat", sans-serif')
    expect(fallbackFor('Times New Roman')).toBe('"Crimson Text", serif')
    expect(fallbackFor('Brush Script MT')).toBe('"Great Vibes", cursive')
    expect(fallbackFor('Some Hand Lettering')).toBe('"Dancing Script", cursive')
    expect(fallbackFor('Consolas')).toBe('ui-monospace, Menlo, Consolas, monospace')
    expect(fallbackFor('Unknown Font')).toBe('"Inter", sans-serif')
    expect(fallbackFor('Lora')).toBe('serif')
  })

  it('gives every family a fallback', () => {
    expect(cssFontFamily('Calibri')).toBe('"Calibri", "Inter", sans-serif')
    expect(cssFontFamily("'Segoe UI'")).toBe(`'Segoe UI', "Inter", sans-serif`)
    expect(cssFontFamily('Georgia, serif')).toBe('Georgia, serif')
    expect(cssFontFamily('Playfair Display')).toBe('"Playfair Display", serif')
  })

  it('bundles every font with a face to load', () => {
    expect(BUNDLED_FONTS).toHaveLength(28)
    for (const font of BUNDLED_FONTS) expect(font.faces.length).toBeGreaterThan(0)
  })
})

describe('replaceThemeFont', () => {
  it('replaces a font in text boxes and runs, leaving others', () => {
    const main = newElement('text', 'a') as Extract<ThemeElement, { kind: 'text' }>
    const style = {
      ...DEFAULT_THEME_STYLE,
      elements: [
        { ...main, text: { ...main.text, fontFamily: 'Calibri' }, paragraphs: [{ runs: [{ text: 'x', fontFamily: "'Calibri'" }, { text: 'y', fontFamily: 'Arial' }] }] },
      ] as ThemeElement[],
    }
    const replaced = replaceThemeFont(style, 'Calibri', 'Open Sans')
    expect(themeFonts(replaced)).toEqual(['Open Sans', 'Open Sans', 'Arial'])
    expect(themeFonts(style)).toEqual(['Calibri', "'Calibri'", 'Arial'])
  })
})
