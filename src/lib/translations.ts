import type { BibleVersionCode, DualLayout, ThemeElement, ThemeStyle, Verse } from '../../shared/types'
import type { DeckSlide } from '../store'
import { parseVerseCaption, verseCaption } from './slides'

/** The translation to read scripture slides in, with a second one shown under (or beside) it. */
export interface Translation {
  version: BibleVersionCode
  second: { version: BibleVersionCode; layout: DualLayout } | null
}

export type TranslateResult =
  | {
      ok: true
      slides: DeckSlide[]
      title: string
      /** Some slides had their own formatting (highlights), dropped because the words changed. */
      clearedFormatting: boolean
    }
  /** Verses the translation does not have (missing, or merged into a neighbour), such as "Acts 8:37 WEB". */
  | { ok: false; missing: string[] }

/** Past the end of the longest chapter, to read a whole chapter. */
const LAST_VERSE = 999

const VERSION = '[A-Z0-9][A-Z0-9-]{0,11}'
/** The version (or "KJV · WEB") at the end of each reference in a scripture title, such as "John 3:16-18 KJV; Psalm 23 WEB". */
const TITLE_VERSIONS = new RegExp(` ${VERSION}(?: · ${VERSION})?(?=;| and \\d+ more$|$)`, 'g')

/** A scripture deck's title with its versions replaced by `label`. */
export const retitle = (title: string, label: string) => title.replace(TITLE_VERSIONS, ` ${label}`)

/** The current translation of a scripture slide, or null for any other slide. */
export function slideTranslation(slide: DeckSlide | null | undefined): { version: BibleVersionCode; second: BibleVersionCode | null } | null {
  const at = slide ? parseVerseCaption(slide.caption) : null
  return at ? { version: at.version, second: at.second ?? null } : null
}

/**
 * Reads scripture slides in another translation, verse for verse; slides that are not verses stay as they are. Each
 * slide's own formatting is dropped, since it was made for other words. When a verse is not in the translation (or the
 * second one) nothing changes and the missing verses are named.
 */
export async function translateSlides(slides: DeckSlide[], title: string, to: Translation): Promise<TranslateResult> {
  const second = to.second && to.second.version !== to.version ? to.second : null
  const chapters = new Map<string, Promise<Map<number, Verse>>>()
  const chapterOf = (version: BibleVersionCode, book: string, chapter: number) => {
    const key = `${version}:${book}:${chapter}`
    let read = chapters.get(key)
    if (!read) {
      read = window.api.bible.getRange(version, book, chapter, 1, LAST_VERSE).then((verses) => new Map(verses.map((v) => [v.verse, v])))
      chapters.set(key, read)
    }
    return read
  }

  const missing: string[] = []
  const translated = await Promise.all(
    slides.map(async (slide): Promise<DeckSlide> => {
      const at = parseVerseCaption(slide.caption)
      if (!at) return slide
      const verse = (await chapterOf(to.version, at.book, at.chapter)).get(at.verse)
      const other = second ? (await chapterOf(second.version, at.book, at.chapter)).get(at.verse) : undefined
      const name = `${at.book} ${at.chapter}:${at.verse}`
      if (!verse) missing.push(`${name} ${to.version}`)
      if (second && !other) missing.push(`${name} ${second.version}`)
      if (!verse || (second && !other)) return slide
      const next: DeckSlide = { ...slide, text: verse.text, caption: verseCaption(verse, to.version, second?.version) }
      delete next.rich
      delete next.unmarked
      delete next.second
      if (second && other) next.second = { text: other.text, layout: second.layout }
      return next
    }),
  )
  if (missing.length > 0) return { ok: false, missing: [...new Set(missing)] }
  return {
    ok: true,
    slides: translated,
    title: retitle(title, second ? `${to.version} · ${second.version}` : to.version),
    clearedFormatting: slides.some((slide) => slide.rich && parseVerseCaption(slide.caption)),
  }
}

/** The note shown when a translation lacks some of the verses. */
export function missingNote(missing: string[]): string {
  const named = missing.length > 3 ? `${missing.slice(0, 3).join(', ')} and ${missing.length - 3} more` : missing.join(', ')
  return `Not in that translation: ${named}. The verse may be missing or merged with another there, so the current translation stays.`
}

const GAP = 2

/**
 * The theme for a slide that shows a second translation: a theme with two text boxes shows it in its second one;
 * otherwise the text box is split in two, one above the other or side by side, the second showing the second translation.
 * Both translations take the verse box's look (Settings, Scripture display, and any quick adjustments).
 */
export function dualTheme(theme: ThemeStyle, second: NonNullable<DeckSlide['second']>): ThemeStyle {
  const boxes = theme.elements.filter((e): e is Extract<ThemeElement, { kind: 'text' }> => e.kind === 'text' && !e.paragraphs)
  if (boxes.length === 0) return theme
  const paragraphs = second.text.split('\n').map((line) => ({ runs: [{ text: line }] }))
  if (boxes.length >= 2) return { ...theme, elements: theme.elements.map((e) => (e === boxes[1] ? { ...boxes[1], text: boxes[0].text, paragraphs } : e)) }
  const main = boxes[0]
  const { x, y, width, height } = main.box
  const [first, other] =
    second.layout === 'sideBySide'
      ? [
          { x, y, width: (width - GAP) / 2, height },
          { x: x + (width + GAP) / 2, y, width: (width - GAP) / 2, height },
        ]
      : [
          { x, y, width, height: (height - GAP) / 2 },
          { x, y: y + (height + GAP) / 2, width, height: (height - GAP) / 2 },
        ]
  const elements = [...theme.elements]
  elements.splice(elements.indexOf(main), 1, { ...main, box: first }, { ...main, id: `${main.id}-second`, box: other, paragraphs })
  return { ...theme, elements }
}
