import { AlertTriangle, ChevronLeft, ChevronRight, Columns2, Unlink } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ThemeElement, ThemeStyle, ThemeTextParagraph } from '../../shared/types'
import { useOperatorStore } from '../store'
import { ThemedSlide } from './ThemedSlide'

type FixedText = Extract<ThemeElement, { kind: 'text' }> & { paragraphs: ThemeTextParagraph[] }

const isFixedText = (element: ThemeElement): element is FixedText => element.kind === 'text' && Array.isArray(element.paragraphs)

const paragraphText = (paragraph: ThemeTextParagraph) => paragraph.runs.map((run) => run.text).join('')

/**
 * New words for a text box, one paragraph per line. A line left as it was keeps its runs; a changed line takes the
 * look of its paragraph's first run, and added lines the look of the last paragraph.
 */
function withLines(paragraphs: ThemeTextParagraph[], value: string): ThemeTextParagraph[] {
  return value.split('\n').map((line, index) => {
    const original = paragraphs[index]
    if (original && paragraphText(original) === line) return original
    const model = original ?? paragraphs[paragraphs.length - 1] ?? { runs: [] }
    const look = model.runs[0] ?? { text: '' }
    return { ...model, runs: line ? [{ ...look, text: line }] : [] }
  })
}

const linesOf = (element: FixedText) => element.paragraphs.map(paragraphText).join('\n')

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
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
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
      ? { ...style, elements: style.elements.map((e) => (isFixedText(e) && draft[e.id] !== undefined ? { ...e, paragraphs: withLines(e.paragraphs, draft[e.id]) } : e)) }
      : style
  const file = presentation.sourcePath.split(/[\\/]/).pop()

  /** Resolves to whether it worked; the error shows otherwise. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    try {
      setError(null)
      await action()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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

        {texts.length > 0 && (
          <div className="native-texts">
            {texts.map((element, i) => (
              <label key={element.id} className="field">
                <span>Text box {i + 1}</span>
                <textarea
                  className="input"
                  rows={Math.min(6, Math.max(2, element.paragraphs.length))}
                  value={draft[element.id] ?? linesOf(element)}
                  onChange={(e) => setDraft({ ...draft, [element.id]: e.target.value })}
                />
              </label>
            ))}
          </div>
        )}

        {error && <p className="error">{error}</p>}

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
