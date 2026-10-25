import { CopyCheck, Layers, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  applyStyleTo,
  formatFor,
  fromPlain,
  hasFormatting,
  normalize,
  paragraphStyle,
  paragraphText,
  plainText,
  richOrPlain,
  setFormat,
  trimSpans,
} from '../../shared/richText'
import type { RichText, SlideFormats, ThemeStyle } from '../../shared/types'
import { RichTextEditor } from './RichTextEditor'
import { ThemedSlide } from './ThemedSlide'

export interface FormatterSlide {
  text: string
  caption?: string
  copyright?: string
  /** The song section it belongs to, for Apply to this section. */
  label?: string | null
}

/** A slide's words as the slide will hold them: each line trimmed and no blank lines (a blank line would split it). */
function tidySlide(rich: RichText): RichText {
  return normalize({
    paragraphs: rich.paragraphs.map((p) => ({ ...paragraphStyle(p), spans: trimSpans(p.spans) })).filter((p) => paragraphText(p) !== ''),
  })
}

const sameLabel = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * Formats one slide: the rich text editor with its toolbar, a live preview of the slide in its theme, and Reset to
 * theme, Apply to this section and Apply to all slides. Formatting is saved as it is made; changed words are passed
 * on when the editor loses focus, so the owner can work them back into its plain text.
 */
export function SlideFormatter({
  slides,
  index,
  formats,
  theme,
  logoUrl = null,
  onFormats,
  onText,
}: {
  slides: FormatterSlide[]
  index: number
  formats: SlideFormats
  theme: ThemeStyle
  logoUrl?: string | null
  onFormats(formats: SlideFormats): void
  /** The slide's words changed; `rich` is them formatted. */
  onText(index: number, text: string, rich: RichText): void
}) {
  const slide = slides[index]
  const stored = richOrPlain(formatFor(formats, slide.text), slide.text)
  const storedKey = JSON.stringify(stored)
  const [draft, setDraft] = useState(stored)
  const editingRef = useRef(false)
  const base = theme.elements.find((element) => element.kind === 'text')?.text ?? null
  const hasSections = slides.some((s) => s.label)
  const formatted = formatFor(formats, slide.text) !== undefined

  // Another slide, or a change made elsewhere (the lyrics box, Apply to all), shows here unless it is being typed in.
  useEffect(() => {
    if (!editingRef.current) setDraft(JSON.parse(storedKey) as RichText)
  }, [storedKey, index])

  function change(rich: RichText) {
    setDraft(rich)
    if (plainText(rich) === slide.text) onFormats(setFormat(formats, slide.text, rich))
  }

  function commit() {
    editingRef.current = false
    const tidy = tidySlide(draft)
    const text = plainText(tidy)
    if (!text) setDraft(stored)
    else if (text !== slide.text) onText(index, text, tidy)
    else onFormats(setFormat(formats, slide.text, tidy))
  }

  /** The look of this slide on the others in `texts`; this slide keeps its own formatting as it is. */
  function applyTo(texts: string[]) {
    const others = texts.filter((text) => text !== slide.text)
    const own = plainText(draft) === slide.text ? draft : stored
    onFormats(setFormat(applyStyleTo(formats, others, own), slide.text, own))
  }

  return (
    <div className="slide-formatter">
      <div className="slide-formatter-edit">
        <RichTextEditor
          key={index}
          value={draft}
          onChange={change}
          base={base}
          ariaLabel={`Slide ${index + 1} text`}
          onFocus={() => {
            editingRef.current = true
          }}
          onBlur={commit}
        />
        <div className="slide-formatter-actions">
          <button
            type="button"
            className="button"
            disabled={!formatted && !hasFormatting(draft)}
            title="Take this slide's formatting off, so it shows the theme's look"
            onClick={() => {
              setDraft(fromPlain(plainText(draft)))
              onFormats(setFormat(formats, slide.text, null))
            }}
          >
            <RotateCcw size={14} aria-hidden="true" /> Reset to theme
          </button>
          {hasSections && (
            <button
              type="button"
              className="button"
              disabled={!slide.label}
              title={slide.label ? `Give every ${slide.label} slide this slide's look` : 'This slide is not in a labelled section'}
              onClick={() => applyTo(slides.filter((s) => sameLabel(s.label, slide.label)).map((s) => s.text))}
            >
              <Layers size={14} aria-hidden="true" /> Apply to this section
            </button>
          )}
          <button type="button" className="button" title="Give every slide this slide's look" onClick={() => applyTo(slides.map((s) => s.text))}>
            <CopyCheck size={14} aria-hidden="true" /> Apply to all slides
          </button>
        </div>
        <p className="hint">Formatting here overrides the theme for this slide only.</p>
      </div>
      <div className="slide-formatter-preview" aria-label="Live preview">
        <ThemedSlide theme={theme} text={plainText(draft)} caption={slide.caption} copyright={slide.copyright} rich={draft} logoUrl={logoUrl} />
      </div>
    </div>
  )
}
