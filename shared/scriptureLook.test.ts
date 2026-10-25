import { describe, expect, it } from 'vitest'
import { adjustTheme, applyScriptureLook, contrastRatio, contrastWarnings, readScriptureLook } from './scriptureLook'
import { AUTO_FIT_MAX, BUILTIN_THEMES, DEFAULT_THEME_STYLE, normalizeTheme } from './themes'
import type { ThemeStyle } from './types'

const blueSmoke = BUILTIN_THEMES.find((t) => t.name === 'Blue Smoke')?.style as ThemeStyle
const textOf = (theme: ThemeStyle) => theme.elements.find((e) => e.kind === 'text')
const referenceOf = (theme: ThemeStyle) => theme.elements.find((e) => e.kind === 'reference')

describe('readScriptureLook', () => {
  it('reads the verse box and the reference line', () => {
    const look = readScriptureLook(DEFAULT_THEME_STYLE)
    expect(look).toMatchObject({ sizeMode: 'auto', maxSize: AUTO_FIT_MAX, color: '#ffffff', position: 'middle', offset: 0 })
    expect(look?.reference).toMatchObject({ show: true, position: 'below' })
    // Blue Smoke's reference sits in its own box across the top.
    expect(readScriptureLook(blueSmoke)?.reference.position).toBe('above')
  })

  it('is null for a theme with no verse box', () => {
    expect(readScriptureLook({ ...DEFAULT_THEME_STYLE, elements: [] })).toBeNull()
  })
})

describe('applyScriptureLook', () => {
  it('leaves the theme as it was when nothing changed', () => {
    const look = readScriptureLook(blueSmoke)
    if (!look) throw new Error('no look')
    expect(applyScriptureLook(blueSmoke, look)).toEqual(blueSmoke)
  })

  it('writes the changed fields, and they survive normalizing', () => {
    const look = readScriptureLook(DEFAULT_THEME_STYLE)
    if (!look) throw new Error('no look')
    const theme = normalizeTheme(applyScriptureLook(DEFAULT_THEME_STYLE, { ...look, maxSize: 10, offset: -4, position: 'top', color: '#ffd400' }))
    expect(textOf(theme)?.text).toMatchObject({ maxSize: 10, offset: -4, verticalAlign: 'top', color: '#ffd400' })
    expect(readScriptureLook(theme)).toMatchObject({ maxSize: 10, offset: -4, position: 'top', color: '#ffd400' })
  })

  it('attaches the reference above or below the verse, and hides it', () => {
    const look = readScriptureLook(blueSmoke)
    if (!look) throw new Error('no look')
    const below = normalizeTheme(applyScriptureLook(blueSmoke, { ...look, reference: { ...look.reference, position: 'below' } }))
    expect(referenceOf(below)).toMatchObject({ attached: true })
    expect(referenceOf(below)).not.toHaveProperty('above')
    const above = normalizeTheme(applyScriptureLook(below, { ...look, reference: { ...look.reference, position: 'above' } }))
    expect(referenceOf(above)).toMatchObject({ attached: true, above: true })
    const hidden = applyScriptureLook(blueSmoke, { ...look, reference: { ...look.reference, show: false } })
    expect(referenceOf(hidden)).toBeUndefined()
    const shown = applyScriptureLook(hidden, { ...look, reference: { ...look.reference, show: true, color: '#ff0000' } })
    expect(referenceOf(shown)).toMatchObject({ attached: true, above: true, text: { color: '#ff0000' } })
  })
})

describe('adjustTheme', () => {
  it('makes the verse a fixed size and keeps the rest of the look', () => {
    const theme = adjustTheme(DEFAULT_THEME_STYLE, { fontSize: 6.5, bold: false, offset: 2 })
    expect(textOf(theme)?.text).toMatchObject({ sizeMode: 'fixed', fontSize: 6.5, fontWeight: 400, offset: 2, color: '#ffffff' })
  })

  it('leaves the theme alone with no adjustments', () => {
    expect(adjustTheme(DEFAULT_THEME_STYLE, {})).toBe(DEFAULT_THEME_STYLE)
    expect(adjustTheme(DEFAULT_THEME_STYLE, undefined)).toBe(DEFAULT_THEME_STYLE)
  })
})

describe('contrast', () => {
  it('measures the WCAG contrast ratio', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1)
  })

  it('warns about text close to the background', () => {
    expect(contrastWarnings(DEFAULT_THEME_STYLE, false)).toEqual([])
    const grey = adjustTheme(DEFAULT_THEME_STYLE, { color: '#222222' })
    expect(contrastWarnings(grey, false)[0]).toMatch(/Verse text is too close to the background/)
  })

  it('warns about colors too dark for a luma key', () => {
    const dark = adjustTheme({ ...DEFAULT_THEME_STYLE, background: { kind: 'solid', color: '#ffffff' } }, { color: '#1a1a1a' })
    const verse = (lumaKey: boolean) => contrastWarnings(dark, lumaKey).filter((w) => w.startsWith('Verse text'))
    expect(verse(false)).toEqual([])
    expect(verse(true)[0]).toMatch(/too dark for a luma key/)
  })
})
