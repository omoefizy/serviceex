// How formatted text (shared/richText.ts) draws: CSS for its marks and paragraphs, and a slide's lines with their
// kinds worked out as slideLines does. Shared by the slide renderer, the lower third, the ticker and the editor.

import type { CSSProperties } from 'react'
import { cssFontFamily } from '../../shared/fonts'
import { paragraphText, plainText, sliceSpans, trimSpans } from '../../shared/richText'
import type { RichMarks, RichParagraph, RichParagraphStyle, RichSpan, RichText, TextCase } from '../../shared/types'
import { slideLines, type SlideLine } from './slides'

const TEXT_TRANSFORMS: Record<TextCase, CSSProperties['textTransform']> = { normal: 'none', upper: 'uppercase', lower: 'lowercase' }

/** How a span's marks draw. Marks left out inherit the text box's look; sizes are em, so fitting the box scales them. */
export function spanStyle(marks: RichMarks): CSSProperties {
  const decorations = [marks.underline && 'underline', marks.strike && 'line-through'].filter(Boolean)
  return {
    fontFamily: marks.font ? cssFontFamily(marks.font) : undefined,
    fontSize: marks.size !== undefined ? `${marks.size}em` : undefined,
    fontWeight: marks.bold === undefined ? undefined : marks.bold ? 700 : 400,
    fontStyle: marks.italic === undefined ? undefined : marks.italic ? 'italic' : 'normal',
    textDecorationLine: marks.underline === undefined && marks.strike === undefined ? undefined : decorations.length > 0 ? decorations.join(' ') : 'none',
    color: marks.color,
    backgroundColor: marks.highlight,
    // A highlight wraps with the words onto each line, like a highlighter pen.
    WebkitBoxDecorationBreak: marks.highlight ? 'clone' : undefined,
    boxDecorationBreak: marks.highlight ? 'clone' : undefined,
    textTransform: marks.textCase ? TEXT_TRANSFORMS[marks.textCase] : undefined,
  }
}

export function paragraphCss(paragraph: RichParagraphStyle): CSSProperties {
  return { textAlign: paragraph.align, lineHeight: paragraph.lineHeight }
}

/** A line of formatted slide text, with its kind worked out as slideLines does and its marks taken off. */
export interface RichSlideLine {
  kind: SlideLine['kind']
  spans: RichSpan[]
  paragraph: RichParagraph
}

/** The lines of a formatted slide: [translation] and {reference} lines lose their marks, keeping the formatting of the words. */
export function richSlideLines(rich: RichText): RichSlideLine[] {
  const kinds = slideLines(plainText(rich))
  return rich.paragraphs.map((paragraph, index) => {
    const kind = kinds[index]?.kind ?? 'text'
    if (kind === 'text') return { kind, spans: paragraph.spans, paragraph }
    const text = paragraphText(paragraph)
    const open = text.length - text.trimStart().length
    return { kind, spans: trimSpans(sliceSpans(paragraph.spans, open + 1, text.trimEnd().length - 1)), paragraph }
  })
}
