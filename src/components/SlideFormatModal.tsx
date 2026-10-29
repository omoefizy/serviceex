import { Type } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatFor, pruneFormats, renameFormat, setFormat } from '../../shared/richText'
import type { AnnouncementPayload, RichText, ScripturePayload, SlideFormats } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { announcementSlides, withAnnouncementSlideText } from '../lib/slides'
import { selectDeckTheme, useOperatorStore } from '../store'
import { SlideFormatter } from './SlideFormatter'
import { ErrorNote } from './ui'

type TextPayload = ScripturePayload | AnnouncementPayload

const isScripture = (payload: TextPayload): payload is ScripturePayload => 'verses' in payload

const slidesOf = (payload: TextPayload) => (isScripture(payload) ? payload.verses : announcementSlides(payload))

/** The payload with slide `index` saying `text`. */
function withSlideText(payload: TextPayload, index: number, text: string): TextPayload {
  if (!isScripture(payload)) return withAnnouncementSlideText(payload, index, text)
  return { ...payload, verses: payload.verses.map((verse, i) => (i === index ? { ...verse, text } : verse)) }
}

/**
 * Formats the slides of a scripture or announcement item in the schedule: a slide list, the formatting editor with a
 * live preview, and Save, which keeps the plain words and their formatting in the item.
 */
export function SlideFormatModal({ itemId, startIndex, onClose }: { itemId: number; startIndex: number; onClose(): void }) {
  const item = useOperatorStore((s) => s.service?.items.find((i) => i.id === itemId))
  const theme = useOperatorStore(selectDeckTheme)
  const logoUrl = useOperatorStore((s) => s.settings.logoUrl)
  const updateItemPayload = useOperatorStore((s) => s.updateItemPayload)
  const [payload, setPayload] = useState<TextPayload | null>(item && (item.type === 'scripture' || item.type === 'announcement') ? item.payload : null)
  const [index, setIndex] = useState(startIndex)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ErrorLike | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (!payload) return null
  const slides = slidesOf(payload)
  const formats = payload.formats ?? {}
  const current = Math.min(index, slides.length - 1)
  const dirty = item !== undefined && JSON.stringify(payload) !== JSON.stringify(item.payload)

  const setFormats = (next: SlideFormats) => setPayload({ ...payload, formats: next })

  function handleText(at: number, text: string, rich: RichText) {
    if (!payload) return
    const old = slides[at]?.text
    const next = withSlideText(payload, at, text)
    const texts = slidesOf(next).map((slide) => slide.text)
    // The slide's words may come out a little differently (a quote keeps its marks); formatting follows only an exact match.
    const now = texts[at]
    const formats = next.formats ?? {}
    setPayload({
      ...next,
      formats: old === undefined || now === undefined ? formats : now === text ? renameFormat(formats, old, text, rich, texts) : setFormat(formats, old, null),
    })
  }

  async function save() {
    if (!payload) return
    setSaving(true)
    setError(null)
    try {
      const kept = pruneFormats(payload.formats ?? {}, slides.map((slide) => slide.text))
      const rest = { ...payload }
      delete rest.formats
      await updateItemPayload(itemId, Object.keys(kept).length > 0 ? { ...rest, formats: kept } : rest)
      onClose()
    } catch (err) {
      setError(reportError('Slide format', err))
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal slide-format-modal" role="dialog" aria-label={`Format ${payload.title}`} onMouseDown={(e) => e.stopPropagation()}>
        <h2>
          <Type size={16} aria-hidden="true" /> Format {payload.title}
        </h2>
        <div className="slide-format-body">
          <ol className="slide-format-list" aria-label="Slides">
            {slides.map((slide, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={`slide-format-pick${i === current ? ' active' : ''}${formatFor(formats, slide.text) ? ' formatted' : ''}`}
                  aria-pressed={i === current}
                  onClick={() => setIndex(i)}
                >
                  <span className="slide-number">{i + 1}</span>
                  <span className="slide-format-text">{slide.text}</span>
                </button>
              </li>
            ))}
          </ol>
          {slides[current] && (
            <SlideFormatter
              slides={slides}
              index={current}
              formats={formats}
              theme={theme}
              logoUrl={logoUrl}
              onFormats={setFormats}
              onText={handleText}
            />
          )}
        </div>
        <ErrorNote error={error} />
        <footer className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  )
}
