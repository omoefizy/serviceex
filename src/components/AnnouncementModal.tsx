import { Plus, Sparkles, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { can, upgradeNote } from '../../shared/features'
import { fromPlain, plainText, setFormat, splitRichSlides } from '../../shared/richText'
import type { AiError, AnnouncementPayload, RichText, SlideFormats } from '../../shared/types'
import { describeError, reportError, type ErrorLike } from '../lib/errors'
import { announcementSlides } from '../lib/slides'
import { selectDefaultTheme, useOperatorStore } from '../store'
import { RichTextEditor } from './RichTextEditor'
import { ThemedSlide } from './ThemedSlide'
import { ErrorNote } from './ui'

interface Props {
  onSave(payload: AnnouncementPayload): Promise<void>
  onCancel(): void
}

export function AnnouncementModal({ onSave, onCancel }: Props) {
  const [title, setTitle] = useState('')
  /** One card per slide, formatted; saved as the plain body with a blank line between slides, and the formatting beside it. */
  const [slides, setSlides] = useState<RichText[]>([fromPlain('')])
  /** The card shown in the live preview. */
  const [active, setActive] = useState(0)
  const [titleSlide, setTitleSlide] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ErrorLike | null>(null)
  /** The long message for Build Slides, and that request's state. */
  const [message, setMessage] = useState('')
  const [building, setBuilding] = useState(false)
  const [aiError, setAiError] = useState<AiError | null>(null)
  const aiEnabled = useOperatorStore((s) => s.settings.aiEnabled)
  const theme = useOperatorStore((s) => selectDefaultTheme(s, 'announcement'))
  const logoUrl = useOperatorStore((s) => s.settings.logoUrl)

  const body = slides.map((slide) => plainText(slide).trim()).filter(Boolean).join('\n\n')
  const slideCount = title.trim() ? announcementSlides({ title, body, titleSlide }).length : 0
  /** Each slide's formatting, split from the cards exactly as the body splits into slides. */
  const formats = slides.flatMap(splitRichSlides).reduce<SlideFormats>((all, rich) => setFormat(all, plainText(rich), rich), {})
  const previewSlide = slides[active] ? splitRichSlides(slides[active])[0] : undefined

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  /** Sends the message once, from the click. The answer fills the title and the cards, to edit before saving. */
  async function handleBuild() {
    if (slides.some((slide) => plainText(slide).trim()) && !window.confirm('Replace the current slides with the AI’s slides?')) return
    setBuilding(true)
    setAiError(null)
    try {
      const answer = await window.api.ai.ask('buildAnnouncement', { message })
      if (answer.ok) {
        setTitle(answer.value.title)
        setSlides(answer.value.slides.map(fromPlain))
        setTitleSlide(true)
      } else {
        setAiError(answer.error)
      }
    } catch (err) {
      setAiError({ code: 'unavailable', message: reportError('Announcement', err).message })
    } finally {
      setBuilding(false)
    }
  }

  function setSlide(index: number, rich: RichText) {
    setSlides((current) => current.map((slide, i) => (i === index ? rich : slide)))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        title: title.trim(),
        body,
        ...(titleSlide ? { titleSlide: true } : {}),
        ...(Object.keys(formats).length > 0 ? { formats } : {}),
      })
    } catch (err) {
      setError(reportError('Announcement', err))
      setSaving(false)
    }
  }

  const buildTooltip = !can('ai.announcements')
    ? upgradeNote('ai.announcements')
    : !aiEnabled
      ? 'AI features are turned off in Settings'
      : !message.trim()
        ? 'Paste a message first'
        : 'Turn the message into a title slide and short slides, one idea each'

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal announcement-modal"
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Add announcement"
      >
        <h2>Add announcement</h2>

        <div className="announcement-builder">
          <label className="field">
            <span>
              Long message <small>Paste an email or bulletin text; the AI keeps its facts and makes short slides</small>
            </span>
            <textarea className="input" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <div className="settings-row">
            {/* Disabled buttons show no tooltip, so the reason sits on a wrapper. */}
            <span title={buildTooltip}>
              <button type="button" className="button" disabled={!can('ai.announcements') || !aiEnabled || !message.trim() || building} onClick={handleBuild}>
                <Sparkles size={15} aria-hidden="true" /> {building ? 'Building…' : 'Build Slides'}
              </button>
            </span>
            {building && (
              <span className="hint" role="status">
                Writing slides… this usually takes a few seconds.
              </span>
            )}
          </div>
          <ErrorNote error={aiError && describeError(aiError)} />
        </div>

        <label className="field">
          <span>
            Title <small>Shown under each slide</small>
          </span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>

        <div className="field">
          <span>
            Slides{' '}
            <small>
              {slideCount} slide{slideCount === 1 ? '' : 's'} · a blank line inside a card splits it in two
            </small>
          </span>
          <label className="inline-check">
            <input type="checkbox" checked={titleSlide} onChange={(e) => setTitleSlide(e.target.checked)} />
            Start with a title slide
          </label>
          <ol className="announcement-cards">
            {titleSlide && (
              <li className="announcement-card title-card">
                <span className="announcement-card-label">Title slide</span>
                <p>{title.trim() || 'The title above'}</p>
              </li>
            )}
            {slides.map((slide, index) => (
              <li key={index} className="announcement-card">
                <span className="announcement-card-label">Slide {index + 1}</span>
                <RichTextEditor
                  value={slide}
                  onChange={(rich) => setSlide(index, rich)}
                  onFocus={() => setActive(index)}
                  base={theme.elements.find((e) => e.kind === 'text')?.text}
                  ariaLabel={`Slide ${index + 1}`}
                  toolbar="focus"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove slide ${index + 1}`}
                  title="Remove slide"
                  disabled={slides.length === 1}
                  onClick={() => {
                    setSlides((current) => current.filter((_, i) => i !== index))
                    setActive(0)
                  }}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="button" onClick={() => setSlides((current) => [...current, fromPlain('')])}>
            <Plus size={15} aria-hidden="true" /> Add slide
          </button>
        </div>

        {previewSlide && (
          <div className="announcement-preview" aria-label="Live preview">
            <ThemedSlide theme={theme} text={plainText(previewSlide)} caption={title.trim()} rich={previewSlide} logoUrl={logoUrl} />
          </div>
        )}

        <ErrorNote error={error} />

        <footer className="modal-actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving || building || !title.trim()}>
            {saving ? 'Adding…' : 'Add to schedule'}
          </button>
        </footer>
      </form>
    </div>
  )
}
