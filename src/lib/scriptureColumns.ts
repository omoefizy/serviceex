// A combined scripture slide in two columns (see shared/scriptureGroup.ts): the theme's text box split side by side.

import { COLUMN_GAP, fitBoxOf, slideFontSize } from '../../shared/scriptureGroup'
import type { ThemeElement, ThemeStyle, ThemeTextParagraph } from '../../shared/types'
import { REFERENCE_LINE_COLOR, slideLines } from './slides'

/** Column text as paragraphs for a second text box: a {reference} line in the reference colour. */
function columnParagraphs(text: string): ThemeTextParagraph[] {
  return slideLines(text).map((line) => ({ runs: [line.kind === 'reference' ? { text: line.text, color: REFERENCE_LINE_COLOR } : { text: line.text }] }))
}

/**
 * The theme for a combined slide in two columns: the main text box split side by side, the right half drawing
 * `right`. Both columns start at one size (the one the longer column needs), so they match unless one overflows.
 */
export function columnsTheme(theme: ThemeStyle, left: string, right: string): ThemeStyle {
  const main = theme.elements.find((e): e is Extract<ThemeElement, { kind: 'text' }> => e.kind === 'text' && !e.paragraphs)
  const box = fitBoxOf(theme)
  if (!main || !box) return theme
  const size = Math.min(slideFontSize({ text: left, caption: '', column: right }, box), box.maxSize)
  const text = { ...main.text, sizeMode: 'fixed' as const, fontSize: size }
  const { x, y, width, height } = main.box
  const half = (width - COLUMN_GAP) / 2
  const elements = [...theme.elements]
  elements.splice(
    elements.indexOf(main),
    1,
    { ...main, text, box: { x, y, width: half, height } },
    { ...main, id: `${main.id}-column`, text, box: { x: x + half + COLUMN_GAP, y, width: half, height }, paragraphs: columnParagraphs(right) },
  )
  return { ...theme, elements }
}
