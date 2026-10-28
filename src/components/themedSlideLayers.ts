// What ThemedSlide shares with the windows that draw it: the default font context, element box placement and the keys
// that let unchanged background layers hold still between slides. Kept apart so ThemedSlide.tsx exports only components.

import { createContext, type CSSProperties } from 'react'
import { DEFAULT_FONT, isTextKind } from '../../shared/themes'
import type { ThemeBox, ThemeStyle } from '../../shared/types'

/** The font for text boxes with none of their own: Live Options' Default Font, provided by each window. */
export const DefaultFontContext = createContext(DEFAULT_FONT)

export const boxStyle = (box: ThemeBox): CSSProperties => ({ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` })

/**
 * Where the background layer ends: the shapes and images under the first text box are drawn with the background,
 * so they hold still while the words crossfade between slides. Everything from the first text box up is content.
 */
export function backgroundSplit(theme: ThemeStyle): number {
  const index = theme.elements.findIndex((element) => isTextKind(element.kind))
  return index === -1 ? theme.elements.length : index
}

/** What the backdrop layer draws, so an unchanged background (a playing video, say) is not redrawn between slides. */
export function backdropKey(theme: ThemeStyle): string {
  return JSON.stringify([theme.background, theme.overlay, theme.keyTransparent])
}

/** What the layer of shapes and images under the text draws, so unchanged ones hold still between slides. */
export function underKey(theme: ThemeStyle, logoUrl: string | null): string {
  const below = theme.elements.slice(0, backgroundSplit(theme))
  const usesLogo = below.some((element) => element.kind === 'image' && element.src === null)
  return JSON.stringify([below, usesLogo ? logoUrl : null])
}
