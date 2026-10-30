// Measures a line of a design's words for auto layout (shared/autoLayout.ts), with a canvas at 1920 by 1080. Sizes in
// a design are percent of the screen, so the width at that size is the width at any size. A font still downloading
// measures in its fallback; useFontsVersion lays the design out again once it has arrived.

import { useContext, useEffect, useMemo, useState } from 'react'
import { layoutDesign, type DesignLayout, type MeasureLine } from '../../shared/autoLayout'
import type { DesignElement, DesignStyle, DesignTextField } from '../../shared/types'
import { DefaultFontContext } from '../components/themedSlideLayers'
import { cssFontFamily, onFontsChanged } from './fonts'

type Text = Extract<DesignElement, { kind: 'text' }>

const WIDTH = 1920
const HEIGHT = 1080

let context: CanvasRenderingContext2D | null | undefined

function canvas(): CanvasRenderingContext2D | null {
  if (context === undefined) context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  return context
}

const requested = new Set<string>()

/** A measure in the Default Font where an element has none. Without a canvas (in tests) it reckons half an em a letter. */
export function measureWith(defaultFont: string): MeasureLine {
  return (element: Text, words: string) => {
    const px = (element.fontSize / 100) * HEIGHT
    const ctx = canvas()
    if (!ctx) return (words.length * px * 0.5 * (1 + element.letterSpacing)) / WIDTH * 100
    const font = `${element.italic ? 'italic ' : ''}${element.fontWeight} ${px}px ${cssFontFamily(element.fontFamily || defaultFont)}`
    ctx.font = font
    ctx.letterSpacing = `${element.letterSpacing * px}px`
    // Asks for the face, so the layout can follow once it has loaded.
    if (!requested.has(font) && typeof document !== 'undefined' && !document.fonts.check(font)) {
      requested.add(font)
      document.fonts.load(font).catch(() => {})
    }
    return (ctx.measureText(words).width / WIDTH) * 100
  }
}

/** A number that changes whenever fonts finish loading or are imported, for laying designs out again. */
export function useFontsVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return
    const bump = () => setVersion((v) => v + 1)
    document.fonts.addEventListener('loadingdone', bump)
    const off = onFontsChanged(bump)
    return () => {
      document.fonts.removeEventListener('loadingdone', bump)
      off()
    }
  }, [])
  return version
}

/**
 * A design laid out for its words (see shared/autoLayout.ts): stretching text and the shapes fitted to it sized to
 * them, the rest kept to their pins. Laid out again when the words, the design or the fonts change.
 */
export function useDesignLayout(style: DesignStyle, fields?: Partial<Record<DesignTextField, string>>): DesignLayout {
  const defaultFont = useContext(DefaultFontContext)
  const fontsVersion = useFontsVersion()
  const fieldsKey = fields === undefined ? null : JSON.stringify(fields)
  return useMemo(
    () => layoutDesign(style.elements, fields, measureWith(defaultFont)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fields by value; the fonts version lays out again
    [style.elements, fieldsKey, defaultFont, fontsVersion],
  )
}
