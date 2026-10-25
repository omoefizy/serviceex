// The verse quick adjustments that read the screen: a size step from the size the Live or Preview box shows now, and
// a nudge up or down. Used by the Aa popover and the keyboard (Cmd+Plus and Minus, Alt+Up and Down).

import { clampOffset, clampSize, NUDGE_STEP, readScriptureLook, SIZE_STEP } from '../../shared/scriptureLook'
import type { ThemeStyle } from '../../shared/types'
import { selectAdjustTarget, selectDeckTheme, slideTheme, useOperatorStore, type TranslationTarget } from '../store'

type OperatorState = ReturnType<typeof useOperatorStore.getState>

/** The live or preview verse's theme as the screen draws it: its quick adjustments included. Null for anything but scripture. */
function verseTheme(s: OperatorState, where: TranslationTarget): ThemeStyle | null {
  const at = selectAdjustTarget(s, where)
  return at ? slideTheme(where === 'live' ? s.live.theme : selectDeckTheme(s), at.slide) : null
}

/** The verse size the Live or Preview box shows now, in percent of the slide's height (what auto fit picked); null when it is not drawn. */
function shownSize(where: TranslationTarget): number | null {
  // While the output crossfades both slides are drawn; the newest is last.
  const texts = document.querySelectorAll<HTMLElement>(`.preview-screen.${where} [data-slide-text]`)
  const text = texts[texts.length - 1]
  const slide = text?.closest('.themed-slide')
  if (!text || !slide || slide.clientHeight === 0) return null
  return (parseFloat(getComputedStyle(text).fontSize) / slide.clientHeight) * 100
}

/** Makes the live or preview verse a step larger (1) or smaller (-1), from the size it shows now. Cmd+Plus and Minus. */
export function stepVerseSize(where: TranslationTarget, step: 1 | -1): void {
  const st = useOperatorStore.getState()
  const theme = verseTheme(st, where)
  const look = theme && readScriptureLook(theme)
  if (!look) return
  const current = shownSize(where) ?? (look.sizeMode === 'fixed' ? look.fontSize : look.maxSize)
  st.adjustScripture(where, { fontSize: clampSize(current + step * SIZE_STEP) })
}

/** Moves the live or preview verse a step down (1) or up (-1). Alt+Down and Alt+Up. */
export function nudgeVerse(where: TranslationTarget, step: 1 | -1): void {
  const st = useOperatorStore.getState()
  const theme = verseTheme(st, where)
  const look = theme && readScriptureLook(theme)
  if (look) st.adjustScripture(where, { offset: clampOffset(look.offset + step * NUDGE_STEP) })
}
