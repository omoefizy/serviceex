import { useContext, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { designTimeline, LOOP_CSS, motionCss, slideOffsets, type AnimationPhase, type TimelineEntry } from '../../shared/designAnimation'
import { shownText } from '../../shared/designs'
import type { DesignBackground, DesignElement, DesignShadow, DesignStyle, DesignTextField, TextCase } from '../../shared/types'
import { cssFontFamily } from '../lib/fonts'
import { DefaultFontContext } from './themedSlideLayers'

type Text = Extract<DesignElement, { kind: 'text' }>

/** Auto fit never goes below this, in percent of screen height. */
const MIN_FONT = 0.5

const TEXT_TRANSFORMS: Record<TextCase, CSSProperties['textTransform']> = { normal: 'none', upper: 'uppercase', lower: 'lowercase' }
const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const

const shadowCss = (s: DesignShadow) => `${s.x}cqh ${s.y}cqh ${s.blur}cqh color-mix(in srgb, ${s.color} ${Math.round(s.opacity * 100)}%, transparent)`

function backgroundCss(background: DesignBackground): CSSProperties {
  if (background.kind === 'solid') return { background: background.color }
  if (background.kind === 'gradient') return { background: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})` }
  return {}
}

/** An element's place, and its animation while one plays (its movement, then its loop once that is done). */
const placement = (e: DesignElement, motion?: CSSProperties): CSSProperties => ({
  left: `${e.box.x}%`,
  top: `${e.box.y}%`,
  width: `${e.box.width}%`,
  height: `${e.box.height}%`,
  opacity: e.opacity,
  transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
  ...motion,
})

/**
 * The inline animation for an element in `phase`: its movement from the timeline, with its loop after it (on the way
 * in, the loop starts once the element has arrived). Undefined leaves the loop to its class.
 */
function motionStyle(element: DesignElement, entry: TimelineEntry | undefined, phase: AnimationPhase): CSSProperties | undefined {
  const movement = motionCss(entry, phase)
  if (!movement) return undefined
  const loop = element.loop !== 'none' ? LOOP_CSS[element.loop] : null
  const after = phase === 'in' && entry ? entry.startMs + entry.durationMs : 0
  const loopCss = loop ? `${loop.replace(/ infinite$/, '')} ${after}ms infinite` : null
  // Later animations win a property they share, so the way out (listed last) overrides the loop.
  const animation = phase === 'in' ? [movement, loopCss] : [loopCss, movement]
  const { dx, dy } = slideOffsets(element)
  return { animation: animation.filter(Boolean).join(', '), ['--dv-dx' as string]: dx, ['--dv-dy' as string]: dy }
}

/** What editing a text element in place needs: the words go back on commit (blur, or Cmd+Enter); Escape cancels. */
export interface InlineEdit {
  id: string
  onCommit(text: string): void
  onCancel(): void
}

/** A text element in its box: at its size, or with auto fit as large as fits up to its size. */
function DesignText({ element, words, edit, extra, motion }: { element: Text; words: string; edit?: InlineEdit; extra: string; motion?: CSSProperties }) {
  const defaultFont = useContext(DefaultFontContext)
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const fitRef = useRef<() => void>(() => {})
  const editing = edit !== undefined

  useLayoutEffect(() => {
    const box = boxRef.current
    const el = textRef.current
    if (!box || !el) return
    const fit = () => {
      el.style.fontSize = `${element.fontSize}cqh`
      if (!element.autoFit || box.clientHeight === 0) return
      const fits = (size: number) => {
        el.style.fontSize = `${size}cqh`
        return el.scrollHeight <= box.clientHeight + 1 && el.scrollWidth <= box.clientWidth + 1
      }
      if (fits(element.fontSize)) return
      let low = MIN_FONT
      let high = element.fontSize
      while (high - low > 0.05) {
        const size = (low + high) / 2
        if (fits(size)) low = size
        else high = size
      }
      el.style.fontSize = `${low}cqh`
    }
    fitRef.current = fit
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [element, words, editing])

  // Editing starts with the words in place, the caret at the end and everything selected.
  useLayoutEffect(() => {
    const el = textRef.current
    if (!editing || !el) return
    el.textContent = words
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when editing starts
  }, [editing])

  function onKeyDown(e: KeyboardEvent<HTMLParagraphElement>) {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      edit?.onCancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  const { shadow, outline } = element
  return (
    <div ref={boxRef} className={`dv-el dv-text${extra}`} style={{ ...placement(element, motion), justifyContent: JUSTIFY[element.verticalAlign], textAlign: element.align }}>
      <p
        ref={textRef}
        className={editing ? 'editing' : undefined}
        style={{
          fontFamily: cssFontFamily(element.fontFamily || defaultFont),
          fontWeight: element.fontWeight,
          fontStyle: element.italic ? 'italic' : 'normal',
          color: element.color,
          lineHeight: element.lineHeight,
          letterSpacing: `${element.letterSpacing}em`,
          textTransform: TEXT_TRANSFORMS[element.textCase],
          textShadow: shadow.enabled ? shadowCss(shadow) : undefined,
          // The stroke is drawn under the fill, so double it to show the chosen width outside the letters.
          WebkitTextStroke: outline.enabled ? `${outline.width * 2}em ${outline.color}` : undefined,
          paintOrder: 'stroke fill',
        }}
        contentEditable={editing ? 'plaintext-only' : undefined}
        suppressContentEditableWarning
        spellCheck={editing}
        onInput={() => fitRef.current()}
        onBlur={editing ? (e) => edit.onCommit(e.currentTarget.innerText.replace(/\n$/, '')) : undefined}
        onKeyDown={editing ? onKeyDown : undefined}
        onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
      >
        {editing ? null : words}
      </p>
    </div>
  )
}

function DesignElementView({ element, fields, edit, placeholders, extra, motion }: {
  element: DesignElement
  fields?: Partial<Record<DesignTextField, string>>
  edit?: InlineEdit
  placeholders: boolean
  /** More classes for the element: its loop, and whether it steps aside. */
  extra: string
  /** Its animation while one plays. */
  motion?: CSSProperties
}) {
  switch (element.kind) {
    case 'text':
      return <DesignText element={element} words={shownText(element, fields)} edit={edit?.id === element.id ? edit : undefined} extra={extra} motion={motion} />
    case 'rect': {
      const { fill, border, shadow } = element
      return (
        <div
          className={`dv-el${extra}`}
          style={{
            ...placement(element, motion),
            background: fill.kind === 'solid' ? fill.color : `linear-gradient(${fill.angle}deg, ${fill.from}, ${fill.to})`,
            borderRadius: `${element.radius}cqh`,
            border: border.width > 0 ? `${border.width}cqh solid ${border.color}` : undefined,
            boxShadow: shadow.enabled ? shadowCss(shadow) : undefined,
          }}
        />
      )
    }
    case 'line':
      return (
        <div className={`dv-el dv-line${extra}`} style={placement(element, motion)}>
          <span style={{ borderTop: `${element.thickness}cqh ${element.dashed ? 'dashed' : 'solid'} ${element.color}` }} />
        </div>
      )
    case 'image':
      if (!element.src) return placeholders ? <div className={`dv-el dv-image-empty${extra}`} style={placement(element, motion)} /> : null
      return <img className={`dv-el${extra}`} src={element.src} alt="" draggable={false} style={{ ...placement(element, motion), objectFit: element.fit, borderRadius: `${element.radius}cqh` }} />
  }
}

/**
 * A design drawn at the size of its parent, 16:9: the background and every visible element, bottom to top. Sizes are
 * cqh of this view. Bound text shows `fields` when given, else its sample words. `checker` shows a transparent
 * background as a checkerboard, as an editor does.
 */
export function DesignView({ style, fields, edit, checker = false, placeholders = false, onAir = false, lowerThirdLive = false, phase = null, className = '' }: {
  style: DesignStyle
  fields?: Partial<Record<DesignTextField, string>>
  edit?: InlineEdit
  checker?: boolean
  /** Shows an image element with no picture yet as an empty frame. */
  placeholders?: boolean
  /** On an output: fills the screen, and the elements' loops run. */
  onAir?: boolean
  /** On air with a lower third up: elements flagged to hide while one is live fade out. */
  lowerThirdLive?: boolean
  /** Plays the elements' way in or out (see designTimeline); remount the view (a new key) to play it again. */
  phase?: AnimationPhase | null
  className?: string
}) {
  const { background } = style
  const timeline = phase ? new Map(designTimeline(style.elements, phase).entries.map((entry) => [entry.id, entry])) : null
  const extra = (element: DesignElement) =>
    onAir ? `${element.loop !== 'none' ? ` dv-loop-${element.loop}` : ''}${lowerThirdLive && element.hideWithLowerThird ? ' dv-aside' : ''}` : ''
  return (
    <div
      className={`design-view${checker && background.kind === 'transparent' ? ' checker' : ''}${onAir ? ' on-air' : ''} ${className}`}
      style={backgroundCss(background)}
    >
      {background.kind === 'image' && <img className="dv-background" src={background.src} alt="" draggable={false} style={{ objectFit: background.fit }} />}
      {style.elements.map((element) =>
        element.hidden ? null : (
          <DesignElementView
            key={element.id}
            element={element}
            fields={fields}
            edit={edit}
            placeholders={placeholders}
            extra={extra(element)}
            motion={phase && timeline ? motionStyle(element, timeline.get(element.id), phase) : undefined}
          />
        ),
      )}
    </div>
  )
}
