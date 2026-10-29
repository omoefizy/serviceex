import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import {
  applyMarks,
  applyParagraphStyle,
  clampPos,
  clearFormatting,
  comparePos,
  deleteRange,
  insertText,
  isCollapsed,
  marksInRange,
  MARK_KEYS,
  normalize,
  orderRange,
  paragraphStyle,
  paragraphText,
  plainText,
  richVerticalAlign,
  sanitizeRichText,
  spanMarks,
  typingMarks,
  wholeRange,
  type RichMarksPatch,
  type RichParagraphPatch,
  type RichPos,
  type RichRange,
} from '../../shared/richText'
import type { RichMarks, RichParagraph, RichText, ThemeTextProps } from '../../shared/types'
import { FormatToolbar, type FormatControl, type FormatPatch, type FormatState } from './FormatToolbar'
import { paragraphCss, spanStyle } from '../lib/richText'
import { CONTENT_COLORS } from '../styles/contentColors'

// A small word processor for slide text. The formatted text (shared/richText.ts) is the model: typing, deleting and
// pasting are turned into model edits from `beforeinput`, and the editing surface is redrawn from the model, so only
// the safe schema is ever stored, never the browser's HTML. Input methods (composition) are left to the browser and
// read back from the page when they finish.

interface Snapshot {
  rich: RichText
  selection: RichRange
}

const START: RichRange = { start: { p: 0, o: 0 }, end: { p: 0, o: 0 } }
/** Typing within this long of the last keystroke undoes together. */
const TYPING_MERGE_MS = 1000
const HISTORY_LIMIT = 200

const sameRich = (a: RichText, b: RichText) => JSON.stringify(a) === JSON.stringify(b)

function applyCss(el: HTMLElement, css: CSSProperties): void {
  for (const [key, value] of Object.entries(css)) {
    if (value === undefined || value === null) continue
    el.style.setProperty(key.replace(/^Webkit/, '-webkit-').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), String(value))
  }
}

/** Draws the model into the editing surface: a div per paragraph, a span per run of marks. Text goes in as text nodes. */
function draw(root: HTMLElement, rich: RichText): void {
  root.replaceChildren(
    ...rich.paragraphs.map((paragraph) => {
      const el = document.createElement('div')
      el.className = 'rt-p'
      el.dataset.p = JSON.stringify(paragraphStyle(paragraph))
      applyCss(el, paragraphCss(paragraph))
      if (paragraph.spans.length === 0) el.append(document.createElement('br'))
      for (const span of paragraph.spans) {
        const s = document.createElement('span')
        s.dataset.s = JSON.stringify(spanMarks(span))
        applyCss(s, spanStyle(span))
        s.textContent = span.text
        el.append(s)
      }
      return el
    }),
  )
  root.dataset.empty = String(plainText(rich) === '')
}

const parseData = (value: string | undefined): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value ?? '{}') as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Reads the surface back into a model after the browser changed it (an input method). Only the marks recorded on our
 * own spans count, checked against the schema; anything else the browser added is read as plain text.
 */
function readSurface(root: HTMLElement): RichText {
  const paragraphs: RichParagraph[] = []
  let current: RichParagraph | null = null
  const open = (style: Record<string, unknown>) => {
    current = { ...style, spans: [] } as RichParagraph
    paragraphs.push(current)
    return current
  }
  const walk = (node: Node, marks: RichMarks, style: Record<string, unknown>) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const paragraph = current ?? open(style)
      paragraph.spans.push({ ...marks, text: (node.textContent ?? '').replace(/[\r\n]/g, ' ') })
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.tagName === 'BR') {
      // A line break inside a paragraph starts another; the one holding an empty paragraph open does not.
      if (node.nextSibling || node.parentElement?.childNodes.length !== 1) open(style)
      return
    }
    const block = node.tagName === 'DIV' || node.tagName === 'P'
    const ownStyle = block && node.dataset.p !== undefined ? parseData(node.dataset.p) : style
    if (block) open(ownStyle)
    const ownMarks = node.dataset.s !== undefined ? parseData(node.dataset.s) : marks
    node.childNodes.forEach((child) => walk(child, ownMarks as RichMarks, ownStyle))
    if (block) current = null
  }
  root.childNodes.forEach((child) => walk(child, {}, {}))
  return sanitizeRichText({ paragraphs }) ?? { paragraphs: [{ spans: [] }] }
}

function paragraphOf(root: HTMLElement, node: Node): HTMLElement | null {
  let el: Node | null = node
  while (el && el.parentNode !== root) el = el.parentNode
  return el instanceof HTMLElement ? el : null
}

/** A DOM position as a model position. */
function toPos(root: HTMLElement, rich: RichText, node: Node, offset: number): RichPos {
  if (node === root) {
    if (offset >= root.childNodes.length) return clampPos(rich, { p: rich.paragraphs.length - 1, o: Infinity })
    return clampPos(rich, { p: offset, o: 0 })
  }
  const paragraph = paragraphOf(root, node)
  if (!paragraph) return { p: 0, o: 0 }
  const range = document.createRange()
  range.setStart(paragraph, 0)
  range.setEnd(node, offset)
  return clampPos(rich, { p: Array.prototype.indexOf.call(root.childNodes, paragraph), o: range.toString().length })
}

/** A model position as a DOM position, at the end of the run before it, so typing carries on in that run's look. */
function toDom(root: HTMLElement, pos: RichPos): [Node, number] {
  const paragraph = root.childNodes[pos.p]
  if (!paragraph) return [root, root.childNodes.length]
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  let left = pos.o
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (left <= length) return [node, left]
    left -= length
  }
  return [paragraph, 0]
}

function rangeIn(root: HTMLElement, rich: RichText, startNode: Node, startOffset: number, endNode: Node, endOffset: number): RichRange | null {
  if (!root.contains(startNode) || !root.contains(endNode)) return null
  return { start: toPos(root, rich, startNode, startOffset), end: toPos(root, rich, endNode, endOffset) }
}

function splitPatch(patch: FormatPatch): { marks: RichMarksPatch; paragraph: RichParagraphPatch } {
  const marks: Record<string, unknown> = {}
  const paragraph: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if ((MARK_KEYS as readonly string[]).includes(key)) marks[key] = value
    else paragraph[key] = value
  }
  return { marks: marks as RichMarksPatch, paragraph: paragraph as RichParagraphPatch }
}

function withPatch(marks: RichMarks, patch: RichMarksPatch): RichMarks {
  const next: Record<string, unknown> = { ...marks }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key]
    else next[key] = value
  }
  return next as RichMarks
}

/** The previous or next letter, a surrogate pair kept whole. */
function stepPos(rich: RichText, pos: RichPos, delta: -1 | 1): RichPos {
  const text = paragraphText(rich.paragraphs[pos.p])
  if (delta < 0) {
    if (pos.o === 0) return pos.p === 0 ? pos : { p: pos.p - 1, o: paragraphText(rich.paragraphs[pos.p - 1]).length }
    const low = text.charCodeAt(pos.o - 1)
    return { p: pos.p, o: pos.o - (low >= 0xdc00 && low <= 0xdfff && pos.o > 1 ? 2 : 1) }
  }
  if (pos.o >= text.length) return pos.p >= rich.paragraphs.length - 1 ? pos : { p: pos.p + 1, o: 0 }
  const high = text.charCodeAt(pos.o)
  return { p: pos.p, o: pos.o + (high >= 0xd800 && high <= 0xdbff ? 2 : 1) }
}

const toHex = (color: string | undefined) => (color && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? color : CONTENT_COLORS.white)

/** What the toolbar shows: the selection's marks where set, else the theme's look (`base`). */
function formatState(rich: RichText, selection: RichRange, pending: RichMarksPatch | null, base: ThemeTextProps | null | undefined): FormatState {
  const marks = pending ? withPatch(typingMarks(rich, selection), pending) : marksInRange(rich, selection)
  const paragraph = rich.paragraphs[orderRange(selection).start.p] ?? { spans: [] }
  return {
    bold: marks.bold ?? (base ? base.fontWeight >= 600 : false),
    italic: marks.italic ?? base?.italic ?? false,
    underline: marks.underline ?? base?.underline ?? false,
    strike: marks.strike ?? false,
    color: marks.color ?? toHex(base?.color),
    highlight: marks.highlight ?? null,
    font: marks.font ?? '',
    size: marks.size ?? null,
    textCase: marks.textCase ?? null,
    align: paragraph.align ?? base?.align ?? 'left',
    verticalAlign: richVerticalAlign(rich) ?? base?.verticalAlign ?? 'middle',
    lineHeight: paragraph.lineHeight ?? null,
  }
}

interface Props {
  value: RichText
  onChange(value: RichText): void
  ariaLabel: string
  /** The theme's look for these words, so the toolbar shows what is in effect. */
  base?: ThemeTextProps | null
  id?: string
  placeholder?: string
  /** One line: Enter does not start a new paragraph and pasted line breaks become spaces. */
  singleLine?: boolean
  maxLength?: number
  /** 'focus' shows the toolbar only while the field (or its toolbar) has focus, for tight panels. */
  toolbar?: 'always' | 'focus'
  /** Controls that do not apply here. */
  disabled?: FormatControl[]
  /** Called before the editor's own handling; preventDefault skips it. */
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void
  onFocus?(): void
  onBlur?(): void
  className?: string
  /** Extra buttons at the end of the toolbar. */
  children?: ReactNode
}

/**
 * A rich text field with the formatting toolbar. Shortcuts: Cmd/Ctrl+B, I and U for bold, italic and underline;
 * Cmd/Ctrl+L, E and R (and J) to align; Cmd/Ctrl+Z to undo and Shift+Cmd+Z or Ctrl+Y to redo.
 */
export function RichTextEditor(props: Props) {
  const { value, ariaLabel, base, id, placeholder, singleLine = false, toolbar = 'always', disabled = [], className = '', children } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const richRef = useRef<RichText>(normalize(value))
  const selectionRef = useRef<RichRange>(START)
  /** Marks chosen with nothing selected: the next letters typed take them. */
  const pendingRef = useRef<RichMarksPatch | null>(null)
  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[]; lastKind: string; lastAt: number }>({ past: [], future: [], lastKind: '', lastAt: 0 })
  const composingRef = useRef(false)
  const propsRef = useRef(props)
  propsRef.current = props
  const [, setVersion] = useState(0)
  const refresh = () => setVersion((v) => v + 1)

  const focused = () => document.activeElement === rootRef.current

  function placeSelection(selection: RichRange) {
    const root = rootRef.current
    const browser = window.getSelection()
    if (!root || !browser || !focused()) return
    const [anchor, anchorOffset] = toDom(root, selection.start)
    const [focus, focusOffset] = toDom(root, selection.end)
    browser.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
  }

  function readSelection(): RichRange {
    const root = rootRef.current
    const browser = window.getSelection()
    if (!root || !browser || browser.rangeCount === 0 || !browser.anchorNode || !browser.focusNode) return selectionRef.current
    return rangeIn(root, richRef.current, browser.anchorNode, browser.anchorOffset, browser.focusNode, browser.focusOffset) ?? selectionRef.current
  }

  /** Makes `rich` the text, redraws, places the caret and tells the owner. */
  function commit(rich: RichText, selection: RichRange, kind: string) {
    const history = historyRef.current
    const now = Date.now()
    if (!(kind === 'type' && history.lastKind === 'type' && now - history.lastAt < TYPING_MERGE_MS)) {
      history.past = [...history.past, { rich: richRef.current, selection: selectionRef.current }].slice(-HISTORY_LIMIT)
    }
    history.future = []
    history.lastKind = kind
    history.lastAt = now
    show(rich, selection)
    propsRef.current.onChange(rich)
  }

  function show(rich: RichText, selection: RichRange) {
    richRef.current = rich
    selectionRef.current = { start: clampPos(rich, selection.start), end: clampPos(rich, selection.end) }
    if (rootRef.current) draw(rootRef.current, rich)
    placeSelection(selectionRef.current)
    refresh()
  }

  function travel(from: 'past' | 'future') {
    const history = historyRef.current
    const snapshot = history[from].pop()
    if (!snapshot) return
    history[from === 'past' ? 'future' : 'past'].push({ rich: richRef.current, selection: selectionRef.current })
    history.lastKind = ''
    show(snapshot.rich, snapshot.selection)
    propsRef.current.onChange(snapshot.rich)
  }

  function type(range: RichRange, text: string, kind = 'type') {
    const rich = richRef.current
    const { maxLength } = propsRef.current
    let words = text
    if (maxLength !== undefined) {
      const { start, end } = orderRange(range)
      const chosen = plainText(rich).length - plainText(deleteRange(rich, { start, end }).rich).length
      words = words.slice(0, Math.max(0, maxLength - (plainText(rich).length - chosen)))
    }
    if (!words && isCollapsed(range)) return
    const marks = pendingRef.current ? withPatch(typingMarks(rich, range), pendingRef.current) : undefined
    pendingRef.current = null
    const result = insertText(rich, range, words, marks)
    commit(result.rich, { start: result.caret, end: result.caret }, kind)
    // A new paragraph starts empty, so the words typed next carry on in the look before it, as in a word processor.
    if (words.endsWith('\n')) {
      const carried = marks ?? typingMarks(rich, range)
      if (Object.keys(carried).length > 0) {
        pendingRef.current = carried
        refresh()
      }
    }
  }

  function remove(range: RichRange, inputType: string) {
    let target = orderRange(range)
    if (isCollapsed(target)) {
      // The browser gave no range: take a letter either side, as the key asked.
      const forward = inputType.includes('Forward')
      const other = stepPos(richRef.current, target.start, forward ? 1 : -1)
      target = orderRange({ start: target.start, end: other })
      if (isCollapsed(target)) return
    }
    const result = deleteRange(richRef.current, target)
    commit(result.rich, { start: result.caret, end: result.caret }, 'delete')
  }

  /** Applies toolbar or shortcut formatting to the selection; with nothing selected, marks wait for the next letters typed. */
  function format(patch: FormatPatch, refocus = true) {
    const selection = selectionRef.current
    const { marks, paragraph } = splitPatch(patch)
    let rich = richRef.current
    if (Object.keys(marks).length > 0) {
      if (isCollapsed(selection)) pendingRef.current = { ...pendingRef.current, ...marks }
      else rich = applyMarks(rich, selection, marks)
    }
    const { verticalAlign, ...rest } = paragraph
    // Vertical alignment belongs to the whole slide.
    if (verticalAlign !== undefined) rich = applyParagraphStyle(rich, wholeRange(rich), { verticalAlign })
    if (Object.keys(rest).length > 0) rich = applyParagraphStyle(rich, selection, rest)
    if (!sameRich(rich, richRef.current)) commit(rich, selection, 'format')
    else refresh()
    if (refocus) {
      rootRef.current?.focus()
      placeSelection(selectionRef.current)
    }
  }

  function clear() {
    pendingRef.current = null
    commit(clearFormatting(richRef.current, selectionRef.current), selectionRef.current, 'format')
    rootRef.current?.focus()
    placeSelection(selectionRef.current)
  }

  // A value from outside (another slide, Reset to theme, a draft restored) replaces what is shown.
  useLayoutEffect(() => {
    const next = normalize(value)
    if (rootRef.current && rootRef.current.childNodes.length > 0 && sameRich(next, richRef.current)) return
    pendingRef.current = null
    show(next, selectionRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compares by content, not identity
  }, [JSON.stringify(value)])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const onSelectionChange = () => {
      if (!focused() || composingRef.current) return
      const next = readSelection()
      const current = selectionRef.current
      if (comparePos(next.start, current.start) === 0 && comparePos(next.end, current.end) === 0) return
      selectionRef.current = next
      pendingRef.current = null
      refresh()
    }

    const onBeforeInput = (e: InputEvent) => {
      if (composingRef.current || e.inputType === 'insertCompositionText') return
      const target = e.getTargetRanges?.()[0]
      const range = (target && rangeIn(root, richRef.current, target.startContainer, target.startOffset, target.endContainer, target.endOffset)) ?? readSelection()
      const { singleLine: oneLine } = propsRef.current
      switch (e.inputType) {
        case 'insertText':
        case 'insertReplacementText':
          e.preventDefault()
          type(range, e.data ?? e.dataTransfer?.getData('text/plain') ?? '')
          return
        case 'insertParagraph':
        case 'insertLineBreak':
          e.preventDefault()
          if (!oneLine) type(range, '\n', 'split')
          return
        case 'insertFromPaste':
        case 'insertFromDrop':
        case 'insertFromYank': {
          e.preventDefault()
          // Only the words come in: pasted formatting and HTML are left behind.
          const text = (e.dataTransfer?.getData('text/plain') ?? e.data ?? '').replace(/\r\n?/g, '\n')
          type(range, oneLine ? text.replace(/\s*\n\s*/g, ' ') : text, 'paste')
          return
        }
        case 'historyUndo':
          e.preventDefault()
          travel('past')
          return
        case 'historyRedo':
          e.preventDefault()
          travel('future')
          return
      }
      if (e.inputType.startsWith('delete')) {
        e.preventDefault()
        remove(range, e.inputType)
      } else if (e.inputType.startsWith('format')) {
        e.preventDefault()
      }
    }

    // Anything the browser did itself (an input method, an input type not handled above) is read back from the page.
    const syncFromPage = () => {
      if (composingRef.current) return
      const rich = readSurface(root)
      const selection = readSelection()
      if (!sameRich(rich, richRef.current)) commit(rich, selection, 'type')
      else show(rich, selection)
    }
    const onCompositionStart = () => {
      composingRef.current = true
    }
    const onCompositionEnd = () => {
      composingRef.current = false
      syncFromPage()
    }

    document.addEventListener('selectionchange', onSelectionChange)
    root.addEventListener('beforeinput', onBeforeInput)
    root.addEventListener('input', syncFromPage)
    root.addEventListener('compositionstart', onCompositionStart)
    root.addEventListener('compositionend', onCompositionEnd)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      root.removeEventListener('beforeinput', onBeforeInput)
      root.removeEventListener('input', syncFromPage)
      root.removeEventListener('compositionstart', onCompositionStart)
      root.removeEventListener('compositionend', onCompositionEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers read the latest state through refs
  }, [])

  const state = formatState(richRef.current, selectionRef.current, pendingRef.current, base)

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.altKey) {
      const key = e.key.toLowerCase()
      const toggles: Record<string, 'bold' | 'italic' | 'underline'> = { b: 'bold', i: 'italic', u: 'underline' }
      const aligns: Record<string, FormatState['align']> = { l: 'left', e: 'center', r: 'right', j: 'justify' }
      const handled =
        !e.shiftKey && toggles[key]
          ? () => format({ [toggles[key]]: !state[toggles[key]] })
          : !e.shiftKey && aligns[key] && !disabled.includes('align')
            ? () => format({ align: aligns[key] })
            : key === 'z'
              ? () => travel(e.shiftKey ? 'future' : 'past')
              : key === 'y'
                ? () => travel('future')
                : null
      if (handled) {
        e.preventDefault()
        // Keep app shortcuts such as Cmd+L (the lower third) and Cmd+E from firing too.
        e.stopPropagation()
        handled()
        return
      }
    }
    props.onKeyDown?.(e)
    if (!e.defaultPrevented && singleLine && e.key === 'Enter') e.preventDefault()
  }

  return (
    <div className={`rich-editor${toolbar === 'focus' ? ' toolbar-on-focus' : ''}${singleLine ? ' single-line' : ''} ${className}`}>
      <FormatToolbar state={state} onChange={format} onClear={clear} disabled={disabled}>
        {children}
      </FormatToolbar>
      <div
        ref={rootRef}
        id={id}
        className="input rt-surface"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={!singleLine}
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        spellCheck
        onKeyDown={handleKeyDown}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
      />
    </div>
  )
}
