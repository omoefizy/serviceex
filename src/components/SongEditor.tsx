import { Copy, Download, FileQuestion, Merge, Scissors, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { can, upgradeNote } from '../../shared/features'
import { buildSongSlides, findSection, isArrangement, LINES_PER_SLIDE_OPTIONS, parseLyrics, replaceSongSlide } from '../../shared/lyrics'
import { formatFor, pruneFormats, renameFormat, sanitizeSlideFormats } from '../../shared/richText'
import { DEFAULT_THEME_STYLE } from '../../shared/themes'
import type { AiError, AiTasks, ExportFormat, RichText, SlideFormats, Song, SongArrangement, SongInput } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { duplicateSection, mergeWithNext, splitSlideAt, type ToolResult } from '../lib/lyricsTools'
import { MOD } from '../lib/shortcuts'
import { useOperatorStore } from '../store'
import { LyricsDiffModal } from './LyricsDiffModal'
import { SlideFormatter } from './SlideFormatter'
import { Button, EmptyState, ErrorNote, Skeleton } from './ui'
import { themeForContent } from '../../shared/textAreas'

/** The editor's fields as typed. */
interface Form {
  title: string
  author: string
  copyright: string
  /** Comma separated. */
  tags: string
  arrangement: SongArrangement
  /** Null uses the default song theme. */
  themeId: number | null
  lyrics: string
  /** Formatting for some slides, keyed by slide text; the lyrics stay plain. */
  formatting: SlideFormats
}

interface Draft {
  form: Form
  savedAt: number
}

// Drafts live in this window's localStorage, one per song, until the song is saved or the draft discarded.
const draftKey = (id: number) => `worshipdeck.songDraft.${id}`

function isForm(value: unknown): value is Form {
  const form = value as Partial<Form> | null
  return (
    typeof form === 'object' &&
    form !== null &&
    ['title', 'author', 'copyright', 'tags', 'lyrics'].every((key) => typeof form[key as keyof Form] === 'string') &&
    isArrangement(form.arrangement) &&
    // Drafts saved before songs had themes have no themeId, and before formatting no formatting.
    (form.themeId === undefined || form.themeId === null || typeof form.themeId === 'number') &&
    (form.formatting === undefined || (typeof form.formatting === 'object' && form.formatting !== null))
  )
}

/** The fields in toForm's order, so sameForm's JSON comparison is not thrown off by key order. */
function orderedForm(form: Form): Form {
  const { title, author, copyright, tags, arrangement, lyrics } = form
  return { title, author, copyright, tags, arrangement, themeId: form.themeId ?? null, lyrics, formatting: sanitizeSlideFormats(form.formatting) }
}

function readDraft(id: number): Draft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(id)) ?? 'null') as Partial<Draft> | null
    return draft && isForm(draft.form) && typeof draft.savedAt === 'number'
      ? { form: orderedForm(draft.form), savedAt: draft.savedAt }
      : null
  } catch {
    return null
  }
}

function writeDraft(id: number, form: Form): void {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify({ form, savedAt: Date.now() } satisfies Draft))
  } catch {
    // Drafts are a safety net; editing still works without storage.
  }
}

function clearDraft(id: number): void {
  try {
    localStorage.removeItem(draftKey(id))
  } catch {
    // See writeDraft.
  }
}

function toForm(song: Omit<Song, 'id'>): Form {
  return {
    title: song.title,
    author: song.author ?? '',
    copyright: song.copyright ?? '',
    tags: song.tags.join(', '),
    arrangement: song.arrangement,
    themeId: song.themeId,
    // The section tools count lines, so keep one kind of line break.
    lyrics: song.lyrics.replace(/\r\n?/g, '\n'),
    formatting: song.formatting ?? {},
  }
}

/** Every slide the lyrics have, whether or not the play order uses it. */
const writtenSlideTexts = (lyrics: string, arrangement: SongArrangement) =>
  buildSongSlides(lyrics, { order: [], linesPerSlide: arrangement.linesPerSlide }).map((slide) => slide.text)

function toInput(form: Form): SongInput {
  return {
    title: form.title.trim(),
    author: form.author.trim() || null,
    copyright: form.copyright.trim() || null,
    tags: [...new Set(form.tags.split(',').map((tag) => tag.trim()).filter(Boolean))],
    arrangement: form.arrangement,
    themeId: form.themeId,
    lyrics: form.lyrics,
    formatting: pruneFormats(form.formatting, writtenSlideTexts(form.lyrics, form.arrangement)),
  }
}

const sameForm = (a: Form | null, b: Form | null) => JSON.stringify(a) === JSON.stringify(b)

/** Keeps the cursor in the lyrics box when a tool button is clicked. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

export function SongEditor({ songId }: { songId: number }) {
  /** The song as stored in the library. */
  const [saved, setSaved] = useState<Form | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<ErrorLike | null>(null)
  /** The song was deleted, here or on another computer, before it opened. */
  const [missing, setMissing] = useState(false)
  const [toolMessage, setToolMessage] = useState<string | null>(null)
  /** The slide open in the formatting editor, by play order. */
  const [formatIndex, setFormatIndex] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const deletedRef = useRef(false)
  const latestRef = useRef({ form, saved })
  latestRef.current = { form, saved }

  const editSong = useOperatorStore((s) => s.editSong)
  const songSaved = useOperatorStore((s) => s.songSaved)
  const songDeleted = useOperatorStore((s) => s.songDeleted)
  const autosaveDrafts = useOperatorStore((s) => s.settings.autosaveDrafts)
  const aiEnabled = useOperatorStore((s) => s.settings.aiEnabled)
  /** Clean Lyrics while its window is open: the lyrics sent, then the answer or the error. */
  const [cleaning, setCleaning] = useState<{
    original: string
    result: AiTasks['cleanLyrics']['output'] | null
    error: AiError | null
  } | null>(null)
  const themes = useOperatorStore((s) => s.themes)
  const songDefaultTheme = useOperatorStore((s) => s.themes.find((t) => t.id === s.themeDefaults?.song))
  const logoUrl = useOperatorStore((s) => s.settings.logoUrl)

  const dirty = form !== null && saved !== null && !sameForm(form, saved)
  const sections = useMemo(() => parseLyrics(form?.lyrics ?? ''), [form?.lyrics])
  const slides = useMemo(() => (form ? buildSongSlides(form.lyrics, form.arrangement) : []), [form])
  /** Each section label once, in written order, for the play order buttons. */
  const labels = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const { label } of sections) {
      if (label && !byKey.has(label.toLowerCase())) byKey.set(label.toLowerCase(), label)
    }
    return [...byKey.values()]
  }, [sections])

  // Load the song, then any draft that differs from it.
  useEffect(() => {
    let cancelled = false
    window.api.songs.get(songId).then(
      (song) => {
        if (cancelled) return
        if (!song) {
          setMissing(true)
          return
        }
        const stored = toForm(song)
        const draft = readDraft(songId)
        setSaved(stored)
        if (draft && !sameForm(draft.form, stored)) {
          setForm(draft.form)
          setRestoredAt(draft.savedAt)
          setDraftSavedAt(draft.savedAt)
        } else {
          if (draft) clearDraft(songId)
          setForm(stored)
        }
      },
      (err) => !cancelled && setError(reportError('Song editor', err)),
    )
    return () => {
      cancelled = true
    }
  }, [songId])

  // Autosave a draft shortly after typing stops (unless turned off in Settings); drop it once the form matches the library again.
  useEffect(() => {
    if (!form || !saved) return
    if (sameForm(form, saved)) {
      clearDraft(songId)
      setDraftSavedAt(null)
      return
    }
    if (!autosaveDrafts) return
    const timer = setTimeout(() => {
      writeDraft(songId, form)
      setDraftSavedAt(Date.now())
    }, 600)
    return () => clearTimeout(timer)
  }, [form, saved, songId, autosaveDrafts])

  // Keep the last keystrokes when the editor closes or the window reloads before the autosave timer fires.
  useEffect(() => {
    const flush = () => {
      const { form, saved } = latestRef.current
      if (!useOperatorStore.getState().settings.autosaveDrafts) return
      if (!deletedRef.current && form && saved && !sameForm(form, saved)) writeDraft(songId, form)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [songId])

  function update(patch: Partial<Form>) {
    setForm((current) => current && { ...current, ...patch })
  }

  function updateArrangement(patch: Partial<SongArrangement>) {
    setForm((current) => current && { ...current, arrangement: { ...current.arrangement, ...patch } })
  }

  function applyTool(tool: (lyrics: string, position: number) => ToolResult) {
    const el = textareaRef.current
    if (!el || !form) return
    const result = tool(form.lyrics, el.selectionStart)
    if ('error' in result) {
      setToolMessage(result.error)
      return
    }
    setToolMessage(null)
    update({ lyrics: result.lyrics })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.cursor, result.cursor)
    })
  }

  async function handleSave() {
    if (!form || saving) return
    if (!form.title.trim()) {
      setError('A song needs a title.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const input = toInput(form)
      if (!(await window.api.songs.update(songId, input))) throw new Error('This song no longer exists.')
      const stored = toForm(input)
      setSaved(stored)
      // Show the tidied fields, unless typing carried on while saving.
      setForm((current) => (sameForm(current, form) ? stored : current))
      setRestoredAt(null)
      clearDraft(songId)
      await songSaved({ id: songId, ...input })
    } catch (err) {
      setError(reportError('Song editor', err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    try {
      deletedRef.current = true
      await window.api.songs.delete(songId)
      clearDraft(songId)
      await songDeleted(songId)
    } catch (err) {
      deletedRef.current = false
      setError(reportError('Song editor', err))
    }
  }

  /** Exports the song as saved in the library; unsaved edits are not included. */
  async function handleExport(format: ExportFormat, menuItem: HTMLElement) {
    menuItem.closest('details')?.removeAttribute('open')
    try {
      const result = await window.api.songFiles.export([songId], format)
      if (result) setToolMessage(`Exported to ${result.location}`)
    } catch (err) {
      setError(reportError('Song editor', err))
    }
  }

  /** Sends the lyrics once, from the click; an answer that arrives after the window closed is dropped. */
  async function handleClean() {
    if (!form) return
    const original = form.lyrics
    setCleaning({ original, result: null, error: null })
    let answer: Awaited<ReturnType<typeof window.api.ai.ask<'cleanLyrics'>>>
    try {
      answer = await window.api.ai.ask('cleanLyrics', { lyrics: original })
    } catch (err) {
      answer = { ok: false, error: { code: 'unavailable', message: reportError('Song editor', err).message } }
    }
    setCleaning((current) =>
      current?.original === original && !current.result && !current.error
        ? { ...current, ...(answer.ok ? { result: answer.value } : { error: answer.error }) }
        : current,
    )
  }

  /** A slide's words changed in the formatting editor: they go back into the lyrics, and its formatting with them. */
  function handleSlideText(index: number, text: string, rich: RichText) {
    setForm((current) => {
      if (!current) return current
      const old = buildSongSlides(current.lyrics, current.arrangement)[index]?.text
      const lyrics = replaceSongSlide(current.lyrics, current.arrangement, index, text)
      const formatting = old === undefined ? current.formatting : renameFormat(current.formatting, old, text, rich, writtenSlideTexts(lyrics, current.arrangement))
      return { ...current, lyrics, formatting }
    })
  }

  /**
   * Takes the cleaned lyrics and their play order; lines per slide stays as it was. The AI sees and returns plain
   * text only, so formatting stays with the slides whose words are unchanged and is dropped from the rest.
   */
  function handleAcceptCleaned(cleaned: { lyrics: string; order: string[] }) {
    setForm(
      (current) =>
        current && {
          ...current,
          lyrics: cleaned.lyrics,
          arrangement: { ...current.arrangement, order: cleaned.order },
          formatting: pruneFormats(current.formatting, writtenSlideTexts(cleaned.lyrics, current.arrangement)),
        },
    )
    setCleaning(null)
    setToolMessage('Cleaned lyrics applied. Save to keep them.')
  }

  function handleDiscardDraft() {
    setForm(saved)
    setRestoredAt(null)
    clearDraft(songId)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      handleSave()
    }
  }

  if (!form) {
    return (
      <section className="panel song-editor">
        <header className="panel-header">
          <h2>Edit song</h2>
          <button className="button" onClick={() => editSong(null)}>
            Close
          </button>
        </header>
        {missing ? (
          <EmptyState
            icon={<FileQuestion size={20} />}
            title="This song is no longer in the library"
            description="It was deleted, here or on another computer. Nothing on the screen has changed."
            action={
              <Button variant="primary" onClick={() => editSong(null)}>
                Close the editor
              </Button>
            }
          />
        ) : error ? (
          <ErrorNote error={error} />
        ) : (
          <Skeleton rows={6} label="Loading the song" />
        )}
      </section>
    )
  }

  const status = saving
    ? 'Saving…'
    : !dirty
      ? 'All changes saved'
      : draftSavedAt
        ? 'Draft autosaved · not saved to library'
        : 'Unsaved changes'
  const missingLabels = form.arrangement.order.filter((label) => !findSection(sections, label))
  const formatSlide = formatIndex === null ? null : (slides[formatIndex] ?? null)
  const theme = themeForContent(themes.find((t) => t.id === (form.themeId ?? songDefaultTheme?.id))?.style ?? DEFAULT_THEME_STYLE, 'song')

  return (
    <section className="panel song-editor" onKeyDown={handleKeyDown}>
      <header className="panel-header">
        <h2>{form.title.trim() || 'Untitled song'}</h2>
        <div className="editor-actions">
          <span className="hint">{status}</span>
          {confirmingDelete ? (
            <>
              <span className="error">Delete this song for good?</span>
              <button className="button" onClick={() => setConfirmingDelete(false)} autoFocus>
                Cancel
              </button>
              <button className="button danger" onClick={handleDelete}>
                Delete song
              </button>
            </>
          ) : (
            <button className="button" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          )}
          <details className="menu">
            <summary className="button" title={dirty ? 'Exports the last saved version' : undefined}>
              <Download size={15} aria-hidden="true" /> Export
            </summary>
            <div className="menu-items">
              <button className="button" onClick={(e) => handleExport('openlyrics', e.currentTarget)}>
                OpenLyrics XML…
              </button>
              <button className="button" onClick={(e) => handleExport('text', e.currentTarget)}>
                Plain text…
              </button>
            </div>
          </details>
          <button className="button" onClick={() => editSong(null)}>
            Close
          </button>
          <button className="button primary" disabled={!dirty || saving} onClick={handleSave} title={`Save (${MOD}S)`}>
            Save
          </button>
        </div>
      </header>

      {restoredAt !== null && (
        <div className="editor-banner">
          <span>Restored an unsaved draft from {new Date(restoredAt).toLocaleString()}.</span>
          <button className="button" onClick={handleDiscardDraft}>
            Discard draft
          </button>
        </div>
      )}
      {confirmingDelete && (
        <p className="hint">Any service that lists this song will show it as “Missing song”.</p>
      )}
      <ErrorNote error={error} />

      <div className="editor-fields">
        <label className="field">
          <span>Title</span>
          <input className="input" value={form.title} onChange={(e) => update({ title: e.target.value })} required />
        </label>
        <label className="field">
          <span>Author</span>
          <input className="input" value={form.author} onChange={(e) => update({ author: e.target.value })} />
        </label>
        <label className="field">
          <span>Copyright</span>
          <input
            className="input"
            placeholder="© 2001 Publisher · CCLI 1234567"
            value={form.copyright}
            onChange={(e) => update({ copyright: e.target.value })}
          />
        </label>
        <label className="field">
          <span>
            Tags <small>Comma separated</small>
          </span>
          <input
            className="input"
            placeholder="hymn, christmas"
            value={form.tags}
            onChange={(e) => update({ tags: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Theme</span>
          <select
            className="input"
            value={form.themeId ?? ''}
            onChange={(e) => update({ themeId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Default for songs{songDefaultTheme ? ` (${songDefaultTheme.name})` : ''}</option>
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="editor-toolbar">
        <button type="button" className="button" onMouseDown={keepFocus} onClick={() => applyTool(splitSlideAt)}>
          <Scissors size={15} aria-hidden="true" /> Split slide here
        </button>
        <button type="button" className="button" onMouseDown={keepFocus} onClick={() => applyTool(mergeWithNext)}>
          <Merge size={15} aria-hidden="true" /> Merge with next
        </button>
        <button type="button" className="button" onMouseDown={keepFocus} onClick={() => applyTool(duplicateSection)}>
          <Copy size={15} aria-hidden="true" /> Duplicate section
        </button>
        {/* Disabled buttons show no tooltip, so the reason sits on a wrapper. */}
        <span
          title={
            !can('ai.lyricsCleaner')
              ? upgradeNote('ai.lyricsCleaner')
              : !aiEnabled
                ? 'AI features are turned off in Settings'
                : !form.lyrics.trim()
                  ? 'Paste lyrics into the box first'
                  : 'Add section labels, merge repeated choruses and remove chords and junk, without changing the words'
          }
        >
          <button
            type="button"
            className="button"
            disabled={!can('ai.lyricsCleaner') || !aiEnabled || !form.lyrics.trim() || cleaning !== null}
            onClick={handleClean}
          >
            <Sparkles size={15} aria-hidden="true" />{' '}
            {cleaning && !cleaning.result && !cleaning.error ? 'Cleaning…' : 'Clean Lyrics'}
          </button>
        </span>
        <label className="editor-lines">
          Lines per slide
          <select
            className="input"
            value={form.arrangement.linesPerSlide ?? ''}
            onChange={(e) =>
              updateArrangement({
                linesPerSlide: e.target.value ? (Number(e.target.value) as SongArrangement['linesPerSlide']) : null,
              })
            }
          >
            <option value="">Any</option>
            {LINES_PER_SLIDE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {toolMessage && <p className="hint">{toolMessage}</p>}

      <div className="editor-arrangement">
        <span className="editor-arrangement-label">Play order</span>
        <div className="chips">
          {form.arrangement.order.length === 0 && <span className="hint">As written</span>}
          {form.arrangement.order.map((label, index) => (
            <span key={index} className={`chip${findSection(sections, label) ? '' : ' missing'}`}>
              {label}
              <button
                type="button"
                aria-label={`Remove ${label} from play order`}
                onClick={() => updateArrangement({ order: form.arrangement.order.filter((_, i) => i !== index) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="chips">
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              className="chip add"
              onClick={() => updateArrangement({ order: [...form.arrangement.order, label] })}
            >
              + {label}
            </button>
          ))}
          {labels.length === 0 && <span className="hint">Label sections like [Chorus] to build a play order.</span>}
          {form.arrangement.order.length > 0 && (
            <button type="button" className="button" onClick={() => updateArrangement({ order: [] })}>
              Play as written
            </button>
          )}
        </div>
        {missingLabels.length > 0 && (
          <p className="hint">Not in the lyrics, so skipped: {[...new Set(missingLabels)].join(', ')}.</p>
        )}
      </div>

      <div className="editor-body">
        <textarea
          ref={textareaRef}
          className="input lyrics editor-lyrics"
          aria-label="Lyrics"
          placeholder={'[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\n…'}
          value={form.lyrics}
          onChange={(e) => update({ lyrics: e.target.value })}
        />
        <div className="editor-preview" aria-label="Slide preview">
          <p className="hint">
            {slides.length} slide{slides.length === 1 ? '' : 's'}
          </p>
          <ol className="editor-preview-list">
            {slides.map((slide, index) => (
              <li key={index}>
                <button
                  type="button"
                  className={`slide-card${index === formatIndex ? ' preview' : ''}${formatFor(form.formatting, slide.text) ? ' formatted' : ''}`}
                  title="Format this slide"
                  aria-pressed={index === formatIndex}
                  onClick={() => setFormatIndex(index === formatIndex ? null : index)}
                >
                  <span className="slide-number">{index + 1}</span>
                  {slide.label && <span className="slide-caption">{slide.label}</span>}
                  <span className="slide-text">{slide.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {formatSlide ? (
        <section className="editor-format" aria-label={`Format slide ${(formatIndex ?? 0) + 1}`}>
          <h3>
            Format slide {(formatIndex ?? 0) + 1}
            {formatSlide.label ? ` · ${formatSlide.label}` : ''}
          </h3>
          <SlideFormatter
            slides={slides.map((slide, index) => ({
              text: slide.text,
              label: slide.label,
              caption: index === 0 ? [form.title, form.author].filter(Boolean).join(' · ') : '',
              copyright: index === 0 ? form.copyright : '',
            }))}
            index={formatIndex ?? 0}
            formats={form.formatting}
            theme={theme}
            logoUrl={logoUrl}
            onFormats={(formatting) => update({ formatting })}
            onText={handleSlideText}
          />
        </section>
      ) : (
        slides.length > 0 && <p className="hint">Click a slide in the preview to format it: bold, color, font, size, alignment and more.</p>
      )}

      {cleaning !== null && (
        <LyricsDiffModal
          original={cleaning.original}
          result={cleaning.result}
          error={cleaning.error}
          onAccept={handleAcceptCleaned}
          onClose={() => setCleaning(null)}
        />
      )}
    </section>
  )
}
