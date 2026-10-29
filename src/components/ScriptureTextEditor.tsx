import { EyeOff, Redo2, RotateCcw, Scissors, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { VersePart } from '../../shared/parseReference'
import type { ScriptureSlide, ThemeStyle } from '../../shared/types'
import { hideSelection, isEdited, originalText, record, redo, resetSlide, startHistory, undo, withPart, withSlideText, withWholeVerse, type History } from '../../shared/verseEdit'
import { naturalSplit, wordStarts } from '../../shared/verseParts'
import { reportError, type ErrorLike } from '../lib/errors'
import { MOD } from '../lib/shortcuts'
import { parseVerseCaption } from '../lib/slides'
import { useTextEdit } from '../lib/scriptureGroup'
import { selectDeckTheme, slideTheme, useOperatorStore } from '../store'
import { ThemedSlide } from './ThemedSlide'
import { Button, Chip, ErrorNote, Modal, SegmentedControl } from './ui'

/** Typing within this long of the last keystroke joins the same undo step. */
const TYPING_MS = 800

type PartChoice = 'whole' | VersePart

/**
 * The verse's words with a marker where part b begins. Drag the marker (or click a word) to move the split; the arrow
 * keys move it a word at a time. The words of the part shown are bright, the rest dimmed.
 */
function SplitMarker({ source, which, split, onSplit }: { source: string; which: VersePart; split: number; onSplit(split: number): void }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [dragging, setDragging] = useState(false)
  const starts = wordStarts(source)
  const words = starts.map((start, i) => ({ start, text: source.slice(start, starts[i + 1] ?? source.length).trimEnd() }))
  /** Word starts the split can sit at: never before the first word. */
  const stops = starts.filter((start) => start > 0)

  /** The word start nearest the pointer: the left edge of each word, rows weighing more than columns. */
  function nearest(x: number, y: number): number | null {
    let best: { at: number; distance: number } | null = null
    for (const el of ref.current?.querySelectorAll<HTMLElement>('[data-at]') ?? []) {
      const at = Number(el.dataset.at)
      if (at === 0) continue
      const box = el.getBoundingClientRect()
      const distance = Math.abs(x - box.left) + 3 * Math.abs(y - (box.top + box.height / 2))
      if (!best || distance < best.distance) best = { at, distance }
    }
    return best?.at ?? null
  }

  function move(e: PointerEvent) {
    if (!dragging) return
    const at = nearest(e.clientX, e.clientY)
    if (at !== null && at !== split) onSplit(at)
  }

  function step(e: KeyboardEvent) {
    const index = stops.indexOf(split)
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? stops[index - 1] : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? stops[index + 1] : undefined
    if (next === undefined) return
    e.preventDefault()
    onSplit(next)
  }

  return (
    <p
      ref={ref}
      className={`split-words${dragging ? ' dragging' : ''}`}
      onPointerMove={move}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      {words.map((word, i) => (
        <span key={word.start}>
          {word.start === split && (
            <span
              className="split-marker"
              role="slider"
              tabIndex={0}
              aria-label="Split point"
              aria-valuemin={1}
              aria-valuemax={stops.length}
              aria-valuenow={stops.indexOf(split) + 1}
              aria-valuetext={`Part b starts at “${word.text}”`}
              title="Drag to move where the verse splits"
              onKeyDown={step}
              onPointerDown={(e) => {
                e.preventDefault()
                ref.current?.setPointerCapture(e.pointerId)
                setDragging(true)
              }}
            />
          )}
          <span
            data-at={word.start}
            className={`split-word${(which === 'a') === word.start < split ? ' in' : ''}`}
            onClick={() => word.start > 0 && onSplit(word.start)}
          >
            {word.text}
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  )
}

interface Props {
  slide: ScriptureSlide
  /** Shown in the title, such as "John 3:16 KJV". */
  title: string
  /** Draws the small preview; left out, there is none. */
  theme?: ThemeStyle | null
  onSave(slide: ScriptureSlide): Promise<void> | void
  onClose(): void
}

/**
 * Edit text for one scripture slide: type in the words, or select some and Hide selection to put "…" in their place.
 * For part of a verse, the split marker moves where it splits. Undo and Redo step through every change; Reset to
 * original brings back the Bible's words. Save keeps the words with the slide; the Bible text never changes.
 */
export function ScriptureTextEditor({ slide, title, theme = null, onSave, onClose }: Props) {
  const [history, setHistory] = useState<History<ScriptureSlide>>(() => startHistory(slide))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ErrorLike | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const lastTyped = useRef(0)
  /** Where the cursor goes after Hide selection, once the new words are in the box. */
  const cursor = useRef<number | null>(null)
  const current = history.present
  const source = current.source ?? current.text
  const verse = parseVerseCaption(current.caption) !== null && current.column === undefined
  const part = current.part
  const choice: PartChoice = part?.which ?? 'whole'
  const edited = isEdited(current)
  const dirty = JSON.stringify(current) !== JSON.stringify(slide)

  useEffect(() => {
    if (cursor.current === null || !textRef.current) return
    textRef.current.setSelectionRange(cursor.current, cursor.current)
    cursor.current = null
  }, [current.text])

  const change = (next: ScriptureSlide) => {
    lastTyped.current = 0
    setHistory((h) => record(h, next))
  }

  function type(text: string) {
    const now = Date.now()
    const joins = now - lastTyped.current < TYPING_MS && history.past.length > 0
    lastTyped.current = now
    const next = withSlideText(current, text)
    setHistory((h) => (joins ? { ...h, present: next, future: [] } : record(h, next)))
  }

  function hide() {
    const box = textRef.current
    if (!box) return
    const hidden = hideSelection(current.text, box.selectionStart, box.selectionEnd)
    if (hidden.text === current.text) return
    cursor.current = hidden.cursor
    change(withSlideText(current, hidden.text))
    box.focus()
  }

  function choosePart(next: PartChoice) {
    if (next === 'whole') change(withWholeVerse(current))
    else change(withPart(current, next, current.part?.split ?? naturalSplit(source)))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (mod && key === 'z') {
      e.preventDefault()
      lastTyped.current = 0
      setHistory((h) => (e.shiftKey ? redo(h) : undo(h)))
    } else if (mod && key === 'y') {
      e.preventDefault()
      setHistory(redo)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave(current)
      onClose()
    } catch (err) {
      setError(reportError('Edit text', err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={
        <>
          Edit text · {title}
          {edited && (
            <Chip tone="warning" className="edited-chip">
              Edited
            </Chip>
          )}
        </>
      }
      size="lg"
      className="scripture-text-editor"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!dirty || saving || !current.text.trim()} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {verse && (
        <section className="text-editor-part" aria-label="Part of the verse">
          <div className="text-editor-row">
            <Scissors size={14} aria-hidden="true" />
            <SegmentedControl<PartChoice>
              aria-label="Show"
              value={choice}
              options={[
                { value: 'whole', label: 'Whole verse' },
                { value: 'a', label: 'Part a', title: 'The first part of the verse' },
                { value: 'b', label: 'Part b', title: 'The rest of the verse' },
              ]}
              onChange={choosePart}
            />
          </div>
          {part && (
            <>
              <SplitMarker source={source} which={part.which} split={part.split} onSplit={(at) => change(withPart(current, part.which, at))} />
              <p className="hint">Drag the marker or click a word to move the split. Moving it replaces typed changes; Undo brings them back.</p>
            </>
          )}
        </section>
      )}

      <label className="text-editor-label" htmlFor="scripture-text">
        Words on the slide
      </label>
      <textarea
        id="scripture-text"
        ref={textRef}
        className="input text-editor-text"
        rows={5}
        value={current.text}
        onChange={(e) => type(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="text-editor-tools" role="toolbar" aria-label="Edit text">
        <Button size="sm" icon={<EyeOff size={14} aria-hidden="true" />} title="Put “…” in place of the selected words" onMouseDown={(e) => e.preventDefault()} onClick={hide}>
          Hide selection
        </Button>
        <Button size="sm" icon={<Undo2 size={14} aria-hidden="true" />} title={`Undo (${MOD}Z)`} disabled={history.past.length === 0} onClick={() => setHistory(undo)}>
          Undo
        </Button>
        <Button size="sm" icon={<Redo2 size={14} aria-hidden="true" />} title={`Redo (${MOD}⇧Z)`} disabled={history.future.length === 0} onClick={() => setHistory(redo)}>
          Redo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={14} aria-hidden="true" />}
          title={`Back to the Bible’s words: “${originalText(current)}”`}
          disabled={!edited}
          onClick={() => change(resetSlide(current))}
        >
          Reset to original
        </Button>
      </div>
      <p className="hint">Only this item shows the edit. The Bible text itself never changes.</p>

      {theme && (
        <div className="text-editor-preview" aria-label="Preview">
          <ThemedSlide theme={slideTheme(theme, current)} text={current.text} caption={current.caption} still />
        </div>
      )}
      <ErrorNote error={error} />
    </Modal>
  )
}

/** Edit text on the grid's scripture slide picked with useTextEdit (from the slide grid or the Preview monitor). */
export function ScriptureEditHost() {
  const index = useTextEdit((s) => s.index)
  const close = useTextEdit((s) => s.close)
  const slide = useOperatorStore((s) => (index !== null && s.deckType === 'scripture' ? s.slides[index] : undefined))
  const theme = useOperatorStore(selectDeckTheme)
  const editScriptureSlide = useOperatorStore((s) => s.editScriptureSlide)
  if (index === null || !slide) return null
  return (
    <ScriptureTextEditor
      key={index}
      slide={slide}
      title={slide.caption || `Slide ${index + 1}`}
      theme={theme}
      onSave={(next) => editScriptureSlide(index, next)}
      onClose={close}
    />
  )
}
