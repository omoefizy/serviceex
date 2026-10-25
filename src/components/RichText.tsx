import { Fragment } from 'react'
import type { RichSpan, RichText } from '../../shared/types'
import { paragraphCss, richSlideLines, spanStyle } from '../lib/richText'
import { REFERENCE_LINE_COLOR } from '../lib/slides'

export function RichSpans({ spans }: { spans: RichSpan[] }) {
  return spans.map((span, index) => (
    <span key={index} style={spanStyle(span)}>
      {span.text}
    </span>
  ))
}

/** A formatted text on one line, paragraphs joined with a space: the ticker and the lower third fields. */
export function RichInline({ rich }: { rich: RichText }) {
  return rich.paragraphs.map((paragraph, index) => (
    <Fragment key={index}>
      {index > 0 && ' '}
      <RichSpans spans={paragraph.spans} />
    </Fragment>
  ))
}

/** A formatted slide's lines as the main text box draws them (see ThemedSlide). */
export function RichSlideLines({ rich }: { rich: RichText }) {
  return richSlideLines(rich).map((line, index) => (
    <span
      key={index}
      className={`themed-line ${line.kind}`}
      style={{ ...paragraphCss(line.paragraph), ...(line.kind === 'reference' ? { color: REFERENCE_LINE_COLOR } : {}) }}
    >
      <RichSpans spans={line.spans} />
    </span>
  ))
}
