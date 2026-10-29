// The text areas of a theme (ThemeStyle.textAreas): where the words go for scripture and for songs, in percent of
// the slide so they scale to any output. A theme is resolved for its content once, where the operator's deck takes
// its theme, so the slide grid, previews, the live output and the stage display all draw the same box.

import { mainTextElement } from './themes'
import type { TextAreaContent, ThemeBox, ThemeElement, ThemeStyle, ThemeTextProps } from './types'

/** A box in pixels, as drawn on a slide of a given size. */
export interface PixelBox {
  left: number
  top: number
  width: number
  height: number
}

/** A box in percent of the slide, in pixels on a slide `width` by `height` pixels. */
export function boxToPixels(box: ThemeBox, width: number, height: number): PixelBox {
  return {
    left: (box.x / 100) * width,
    top: (box.y / 100) * height,
    width: (box.width / 100) * width,
    height: (box.height / 100) * height,
  }
}

/** A box in pixels on a slide `width` by `height` pixels, in percent of the slide. */
export function pixelsToBox(box: PixelBox, width: number, height: number): ThemeBox {
  if (width <= 0 || height <= 0) throw new RangeError('The slide must have a size')
  return { x: (box.left / width) * 100, y: (box.top / height) * 100, width: (box.width / width) * 100, height: (box.height / height) * 100 }
}

export const isTextAreaContent = (value: unknown): value is TextAreaContent => value === 'scripture' || value === 'song'

/** Where the main text box goes for this content: its text area, or the box itself for other content. */
export function textAreaOf(style: ThemeStyle, content: TextAreaContent): ThemeBox | null {
  return style.textAreas?.[content] ?? mainTextElement(style.elements)?.box ?? null
}

/** The Reference box placed just below a text area, tall enough for one line, kept on the slide. */
export function referenceBoxBelow(area: ThemeBox, props: ThemeTextProps): ThemeBox {
  const height = Math.min(100, props.fontSize * Math.max(1, props.lineHeight) + props.padding * 2 + 1)
  return { x: area.x, y: Math.min(100 - height, area.y + area.height), width: area.width, height }
}

/** Places the main text box in the area, and for scripture the reference as the theme asks. */
function resolve(style: ThemeStyle, content: TextAreaContent): ThemeStyle {
  const area = style.textAreas?.[content]
  const main = mainTextElement(style.elements)
  if (!area || !main) return style
  const placement = content === 'scripture' ? style.referencePlacement : undefined
  const elements = style.elements.map((element): ThemeElement => {
    if (element === main) return { ...element, box: area }
    if (placement && element.kind === 'reference') {
      return placement === 'inside' ? { ...element, attached: true } : { ...element, attached: false, above: undefined, box: referenceBoxBelow(area, element.text) }
    }
    return element
  })
  return { ...style, elements }
}

const resolved = new WeakMap<ThemeStyle, Partial<Record<TextAreaContent, ThemeStyle>>>()

/**
 * The theme as it draws this content: scripture and songs put the main text in their text area. Other content, or
 * a theme without text areas, gets the theme itself. The same theme gives the same object, so store selectors
 * stay stable.
 */
export function themeForContent(style: ThemeStyle, content: string | null | undefined): ThemeStyle {
  if (!isTextAreaContent(content) || !style.textAreas) return style
  const cache = resolved.get(style) ?? {}
  let result = cache[content]
  if (!result) {
    result = resolve(style, content)
    cache[content] = result
    resolved.set(style, cache)
  }
  return result
}
