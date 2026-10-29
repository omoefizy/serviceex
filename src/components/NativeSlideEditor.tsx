import { AlertTriangle, ChevronLeft, ChevronRight, Columns2, Unlink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { replaceThemeFont, themeFonts } from '../../shared/fonts'
import { paragraphsFromRich, richFromParagraphs } from '../../shared/richText'
import type { RichText, ThemeElement, ThemeStyle, ThemeTextParagraph } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { useOperatorStore } from '../store'
import { MissingFontChips } from './FontPicker'
import { RichTextEditor } from './RichTextEditor'
import { ThemedSlide } from './ThemedSlide'
import { ErrorNote } from './ui'

type FixedText = Extract<ThemeElement, { kind: 'text' }> & { paragraphs: ThemeTextParagraph[] }

const isFixedText = (element: ThemeElement): element is FixedText => element.kind === 'text' && Array.isArray(element.paragraphs)

/** A text box with its words and formatting from the editor; the box's vertical alignment comes along when it was changed. */
function withRich(element: FixedText, rich: RichText): FixedText {
  const { paragraphs, verticalAlign } = paragraphsFromRich(rich, element.paragraphs, element.text)
  return { ...element, paragraphs, text: verticalAlign ? { ...element.text, verticalAlign } : element.text }
}

/**
 * The compare view for a Native mode presentation: PowerPoint's picture of the slide on the left, the native render on
 * the right, what Native mode could not draw, a switch to show this slide as its picture, and its words to edit.
 */
export function NativeSlideEditor({ presentationId, index: startIndex, onClose }: { presentationId: number; index: number; onClose(): void }) {
  const presentation = useOperatorStore((s) => s.presentations.find((p) => p.id === presentationId))
  const setUseImage = useOperatorStore((s) => s.setPresentationSlideUseImage)
  const updateNativeSlide = useOperatorStore((s) => s.updateNativeSlide)
  const detach = useOperatorStore((s) => s.detachPresentation)
  const [index, setIndex] = useState(startIndex)
  const [draft, setDraft] = useState<Record<string, RichText>>({})
  const [error, setError] = useState<ErrorLike | null>(null)
  const [confirmingDetach, setConfirmingDetach] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Edits belong to the slide they were typed on.
  useEffect(() => setDraft({}), [index, presentationId])

  if (!presentation) return null
  const count = presentation.slides.length
  const slide = presentation.slides[Math.min(index, count - 1)]
  if (!slide) return null
  const native = slide.native
  const style = native?.style ?? null
  const texts = style?.elements.filter(isFixedText) ?? []
  const edited: ThemeStyle | null =
    style && Object.keys(draft).length > 0
      ? { ...style, elements: style.elements.map((e) => (isFixedText(e) && draft[e.id] !== undefined ? withRich(e, draft[e.id]) : e)) }
      : style
  const file = presentation.sourcePath.split(/[\\/]/).pop()

  /** Resolves to whether it worked; the error shows otherwise. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    try {
      setError(null)
      await action()
      return true
    } catch (err) {
      setError(reportError('Slide editor', err))
      return false
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal native-editor" role="dialog" aria-label={`Compare slide ${index + 1}`} onMouseDown={(e) => e.stopPropagation()}>
        <h2>
          <Columns2 size={16} aria-hidden="true" /> {presentation.title}
          <span className="native-editor-nav">
            <button className="icon-button" aria-label="Previous slide" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span className="hint">
              Slide {index + 1} of {count}
            </span>
            <button className="icon-button" aria-label="Next slide" disabled={index >= count - 1} onClick={() => setIndex(index + 1)}>
              <ChevronRight size={16} />
            </button>
          </span>
        </h2>

        {presentation.linked ? (
          <div className="native-link-note" role="note">
            <p>
              Linked to <strong>{file}</strong>: saving it in PowerPoint re-imports these slides, and{' '}
              <strong>edits made here are replaced</strong>. Detach to stop following the file and edit freely.
            </p>
            {confirmingDetach ? (
              <span className="native-link-actions">
                <button className="button danger" onClick={() => run(() => detach(presentation.id)).then((ok) => ok && setConfirmingDetach(false))}>
                  Detach
                </button>
                <button className="button" onClick={() => setConfirmingDetach(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="button" onClick={() => setConfirmingDetach(true)}>
                <Unlink size={14} aria-hidden="true" /> Detach…
              </button>
            )}
          </div>
        ) : (
          <p className="hint">Detached from {file}: saving it no longer changes these slides.</p>
        )}

        <div className="native-compare">
          <figure>
            <figcaption>PowerPoint</figcaption>
            <div className="native-compare-screen">
              <img src={slide.image} alt={`PowerPoint's picture of slide ${index + 1}`} />
            </div>
          </figure>
          <figure>
            <figcaption>Native{native?.useImage && style ? ' (showing the picture instead)' : ''}</figcaption>
            <div className="native-compare-screen">
              {edited ? <ThemedSlide theme={edited} text="" /> : <p className="native-compare-empty">{native ? 'Shown as its picture' : 'Not built yet'}</p>}
            </div>
          </figure>
        </div>

        {native && native.warnings.length > 0 && (
          <ul className="native-warnings">
            {native.warnings.map((warning) => (
              <li key={warning}>
                <AlertTriangle size={13} aria-hidden="true" /> {warning}
              </li>
            ))}
          </ul>
        )}

        {edited && (
          <MissingFontChips
            values={themeFonts(edited)}
            onReplace={(from, to) => run(() => updateNativeSlide(presentation.id, index, replaceThemeFont(edited, from, to))).then((ok) => ok && setDraft({}))}
          />
        )}

        {texts.length > 0 && (
          <div className="native-texts">
            {texts.map((element, i) => (
              <div key={element.id} className="field">
                <span>Text box {i + 1}</span>
                <RichTextEditor
                  ariaLabel={`Text box ${i + 1}`}
                  base={element.text}
                  value={draft[element.id] ?? richFromParagraphs(element.paragraphs, element.text)}
                  onChange={(rich) => setDraft((current) => ({ ...current, [element.id]: rich }))}
                />
              </div>
            ))}
          </div>
        )}

        <ErrorNote error={error} />

        <footer className="modal-actions">
          {style && (
            <button className="button" onClick={() => run(() => setUseImage(presentation.id, index, !native?.useImage))}>
              {native?.useImage ? 'Use Native mode for this slide' : 'Use Image mode for this slide'}
            </button>
          )}
          <button className="button" onClick={onClose}>
            Close
          </button>
          {texts.length > 0 && (
            <button
              className="button primary"
              disabled={Object.keys(draft).length === 0}
              onClick={() => edited && run(() => updateNativeSlide(presentation.id, index, edited)).then((ok) => ok && setDraft({}))}
            >
              Save text
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
