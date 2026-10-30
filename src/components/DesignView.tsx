import { Fragment, useContext, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { boltPaths, diagonal, effectTracks, light } from '../../shared/designEffects'
import { nineSliceBorders } from '../../shared/autoLayout'
import { designTimeline, LOOP_CSS, motionCss, slideOffsets, type AnimationPhase, type TimelineEntry } from '../../shared/designAnimation'
import { shownText } from '../../shared/designs'
import type { DesignBackground, DesignEffect, DesignElement, DesignShadow, DesignStyle, DesignTextField, TextCase, ThemeBox } from '../../shared/types'
import { driveEffect } from '../lib/effectClock'
import { cssFontFamily } from '../lib/fonts'
import { useDesignLayout } from '../lib/textMeasure'
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
const placement = (e: DesignElement, box: ThemeBox, motion?: CSSProperties): CSSProperties => ({
  left: `${box.x}%`,
  top: `${box.y}%`,
  width: `${box.width}%`,
  height: `${box.height}%`,
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

/**
 * What editing a text element in place needs: the words go back on commit (Enter, or leaving it), Escape cancels, and
 * Tab commits and moves to the next text (Shift+Tab the one before). Shift+Enter starts a new line.
 */
export interface InlineEdit {
  id: string
  /** Words to start with in place of the element's, the caret after them: typing on a selected text starts this way. */
  initial?: string
  onCommit(text: string): void
  onCancel(): void
  /** Each change while typing, so stretching shapes follow the words live. */
  onInput?(text: string): void
  onTab?(text: string, back: boolean): void
}

const editedText = (el: HTMLElement) => el.innerText.replace(/\n$/, '')

/** Whether the words need the box to shrink them: Shrink to fit, or a stretching box with auto fit on. */
const shrinks = (e: Text) => e.sizing === 'shrink' || (e.autoFit && (e.sizing === 'autoWidth' || e.sizing === 'autoHeight'))

/** A text element in its box: at its size, or shrunk as large as fits up to its size. */
function DesignText({ element, box, words, edit, extra, motion, overflow }: {
  element: Text
  box: ThemeBox
  words: string
  edit?: InlineEdit
  extra: string
  motion?: CSSProperties
  /** The layout found the words need more room than the maximum size. */
  overflow: boolean
}) {
  const defaultFont = useContext(DefaultFontContext)
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const fitRef = useRef<() => void>(() => {})
  const editing = edit !== undefined

  useLayoutEffect(() => {
    const box = boxRef.current
    const el = textRef.current
    if (!box || !el) return
    const fits = (size: number) => {
      el.style.fontSize = `${size}cqh`
      return el.scrollHeight <= box.clientHeight + 1 && el.scrollWidth <= box.clientWidth + 1
    }
    // Marked when the words still do not fit, for the editors' overflow warning.
    const mark = (over: boolean) => box.toggleAttribute('data-overflow', over)
    const fit = () => {
      el.style.fontSize = `${element.fontSize}cqh`
      if (box.clientHeight === 0) return
      if (!shrinks(element) || fits(element.fontSize)) return mark(overflow || !fits(element.fontSize))
      let low = MIN_FONT
      let high = element.fontSize
      while (high - low > 0.05) {
        const size = (low + high) / 2
        if (fits(size)) low = size
        else high = size
      }
      mark(!fits(low))
    }
    fitRef.current = fit
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [element, words, editing, overflow, box.width, box.height])

  // Editing starts with the words in place and selected, so typing replaces them; or with the first letter typed.
  const editId = edit?.id
  useLayoutEffect(() => {
    const el = textRef.current
    if (!editing || !el) return
    const initial = edit.initial
    el.textContent = initial ?? words
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    if (initial !== undefined) range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    if (initial !== undefined) edit.onInput?.(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when editing starts, or moves to another element
  }, [editing, editId])

  /** Set while a key ends the edit, so the blur that follows does not commit it a second time. */
  const ended = useRef(false)
  useLayoutEffect(() => {
    ended.current = false
  }, [editing, editId])

  function onKeyDown(e: KeyboardEvent<HTMLParagraphElement>) {
    e.stopPropagation()
    const el = e.currentTarget
    const end = (action: () => void) => {
      e.preventDefault()
      ended.current = true
      action()
    }
    if (e.key === 'Escape') end(() => edit?.onCancel())
    else if (e.key === 'Enter' && !e.shiftKey) end(() => edit?.onCommit(editedText(el)))
    else if (e.key === 'Tab' && edit?.onTab) end(() => edit.onTab!(editedText(el), e.shiftKey))
  }

  const { shadow, outline } = element
  // Auto width keeps a line that fits on one line, whatever the browser's own measure.
  const oneLine = element.sizing === 'autoWidth' && box.width < element.maxWidth - 0.01
  return (
    <div
      ref={boxRef}
      className={`dv-el dv-text${oneLine ? ' dv-one-line' : ''}${extra}`}
      data-id={element.id}
      style={{ ...placement(element, box, motion), justifyContent: JUSTIFY[element.verticalAlign], textAlign: element.align }}
    >
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
        onInput={(e) => {
          edit?.onInput?.(editedText(e.currentTarget))
          fitRef.current()
        }}
        onBlur={editing ? (e) => !ended.current && edit.onCommit(editedText(e.currentTarget)) : undefined}
        onKeyDown={editing ? onKeyDown : undefined}
        onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
      >
        {editing ? null : words}
      </p>
    </div>
  )
}

function DesignElementView({ element, box, overflow, fields, edit, placeholders, extra, motion }: {
  element: DesignElement
  /** Where the layout put it. */
  box: ThemeBox
  overflow: boolean
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
      return (
        <DesignText
          element={element}
          box={box}
          words={shownText(element, fields)}
          edit={edit?.id === element.id ? edit : undefined}
          extra={extra}
          motion={motion}
          overflow={overflow}
        />
      )
    case 'rect': {
      const { fill, border, shadow } = element
      return (
        <div
          className={`dv-el${extra}`}
          style={{
            ...placement(element, box, motion),
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
        <div className={`dv-el dv-line${extra}`} style={placement(element, box, motion)}>
          <span style={{ borderTop: `${element.thickness}cqh ${element.dashed ? 'dashed' : 'solid'} ${element.color}` }} />
        </div>
      )
    case 'image': {
      if (!element.src) return placeholders ? <div className={`dv-el dv-image-empty${extra}`} style={placement(element, box, motion)} /> : null
      if (element.slice) {
        // 9 slice: the picture as a border image, its corners and edges at their designed size.
        const b = nineSliceBorders(element.slice, element.box, box)
        const s = element.slice
        return (
          <div
            className={`dv-el dv-slice${extra}`}
            style={{
              ...placement(element, box, motion),
              borderStyle: 'solid',
              borderColor: 'transparent',
              borderWidth: `${b.top}cqh ${b.right}cqw ${b.bottom}cqh ${b.left}cqw`,
              borderImageSource: `url("${element.src}")`,
              borderImageSlice: `${s.top}% ${s.right}% ${s.bottom}% ${s.left}% fill`,
              borderImageRepeat: 'stretch',
            }}
          />
        )
      }
      return <img className={`dv-el${extra}`} src={element.src} alt="" draggable={false} style={{ ...placement(element, box, motion), objectFit: element.fit, borderRadius: `${element.radius}cqh` }} />
    }
  }
}

/** A picture's own outline as a mask, sized as the picture is, so its effects light only the picture. */
function pictureMask(element: Extract<DesignElement, { kind: 'image' }>): CSSProperties | undefined {
  if (!element.src || element.slice) return undefined
  return { maskImage: `url("${element.src}")`, maskSize: element.fit, maskPosition: 'center', maskRepeat: 'no-repeat' }
}

/**
 * One light effect: its layers drawn once, then moved and faded on the effect clock. `startMs` is when the element has
 * come in, from now; the effect's own delay counts from there.
 */
function DesignEffectLayer({ effect, box, mask, startMs }: { effect: DesignEffect; box: ThemeBox; mask?: CSSProperties; startMs: number }) {
  const moveRef = useRef<HTMLDivElement>(null)
  const lightRef = useRef<HTMLDivElement & SVGSVGElement>(null)
  const settings = JSON.stringify(effect)

  useLayoutEffect(() => {
    const targets = { move: moveRef.current, light: lightRef.current }
    const tracks = effectTracks(effect)
    const ready = tracks.every((t) => typeof targets[t.part]?.animate === 'function')
    if (!ready) return
    const animations = tracks.map((t) => targets[t.part]!.animate(t.keyframes, { duration: effect.durationMs, easing: t.easing, fill: 'none' }))
    return driveEffect(effect, animations, performance.now() + startMs)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `settings` stands for the effect; a new copy of the same one keeps playing
  }, [settings, startMs])

  const { color, intensity } = effect
  const side = `${diagonal(box)}cqw`
  switch (effect.kind) {
    case 'lightSweep':
    case 'scanLine': {
      const band =
        effect.kind === 'scanLine'
          ? `linear-gradient(90deg, transparent, ${light(color, intensity * 0.3)} 35%, ${light(color, intensity)} 50%, ${light(color, intensity * 0.3)} 65%, transparent)`
          : `linear-gradient(90deg, transparent, ${light(color, intensity)} 50%, transparent)`
      return (
        <div className={`dv-fx dv-fx-${effect.kind}`} style={mask}>
          <div className="dv-fx-turn" style={{ width: side, height: side, transform: `translate(-50%, -50%) rotate(${effect.angle}deg)` }}>
            <div ref={moveRef} className="dv-fx-band" style={{ width: `${effect.width}%`, background: band }} />
          </div>
        </div>
      )
    }
    case 'borderChase': {
      const length = Math.round(effect.width * 3.6)
      return (
        <div className="dv-fx dv-fx-ring" style={{ padding: `${effect.thickness}cqh` }}>
          <div
            ref={moveRef}
            className="dv-fx-spin"
            style={{ width: side, height: side, background: `conic-gradient(transparent 0deg, transparent ${360 - length}deg, ${light(color, intensity)} 360deg)` }}
          />
        </div>
      )
    }
    case 'glowPulse':
      return (
        <div className="dv-fx dv-fx-unclipped">
          <div
            ref={lightRef}
            className="dv-fx-glow"
            style={mask ? { ...mask, background: color, filter: `blur(${effect.glow / 2}cqh)` } : { boxShadow: `0 0 ${effect.glow}cqh ${effect.glow / 3}cqh ${color}` }}
          />
        </div>
      )
    case 'flicker':
      return (
        <div className="dv-fx" style={mask}>
          <div ref={lightRef} className="dv-fx-fill" style={{ background: color }} />
        </div>
      )
    case 'lightning':
      return (
        <div className="dv-fx" style={mask}>
          <div ref={moveRef} className="dv-fx-bolt" style={{ width: `${effect.width}%` }}>
            <svg ref={lightRef} className="dv-fx-light" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ filter: `drop-shadow(0 0 ${effect.glow}cqh ${color})` }}>
              {boltPaths(effect.seed).map((points, i) => (
                <polyline key={i} points={points} fill="none" stroke={color} strokeWidth={i === 0 ? 2.2 : 1.3} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          </div>
        </div>
      )
  }
}

/** An element's light effects, over it in its place and shape, moving with it. */
function DesignEffects({ element, box, motion, startMs }: { element: DesignElement; box: ThemeBox; motion?: CSSProperties; startMs: number }) {
  const radius = element.kind === 'rect' || element.kind === 'image' ? `${element.radius}cqh` : undefined
  const mask = element.kind === 'image' ? pictureMask(element) : undefined
  return (
    <div className="dv-el dv-fx-host" aria-hidden="true" style={{ ...placement(element, box, motion), borderRadius: radius }}>
      {element.effects.map((effect) => (
        <DesignEffectLayer key={effect.id} effect={effect} box={box} mask={mask} startMs={startMs} />
      ))}
    </div>
  )
}

/**
 * A design drawn at the size of its parent, 16:9: the background and every visible element, bottom to top. Sizes are
 * cqh of this view. Bound text shows `fields` when given, else its sample words. `checker` shows a transparent
 * background as a checkerboard, as an editor does.
 */
export function DesignView({ style, fields, edit, checker = false, placeholders = false, warnings = false, onAir = false, lowerThirdLive = false, phase = null, className = '' }: {
  style: DesignStyle
  fields?: Partial<Record<DesignTextField, string>>
  edit?: InlineEdit
  checker?: boolean
  /** Marks text whose words do not fit, as the editors do. */
  warnings?: boolean
  /** Shows an image element with no picture yet as an empty frame. */
  placeholders?: boolean
  /** On an output: fills the screen, and the elements' loops and light effects run. */
  onAir?: boolean
  /** On air with a lower third up: elements flagged to hide while one is live fade out. */
  lowerThirdLive?: boolean
  /**
   * Plays the elements' way in or out (see designTimeline); remount the view (a new key) to play it again. On the way
   * in, each element's light effects start once it has come in.
   */
  phase?: AnimationPhase | null
  className?: string
}) {
  const { background } = style
  const layout = useDesignLayout(style, fields)
  const timeline = phase ? new Map(designTimeline(style.elements, phase).entries.map((entry) => [entry.id, entry])) : null
  const extra = (element: DesignElement) =>
    onAir ? `${element.loop !== 'none' ? ` dv-loop-${element.loop}` : ''}${lowerThirdLive && element.hideWithLowerThird ? ' dv-aside' : ''}` : ''
  return (
    <div
      className={`design-view${checker && background.kind === 'transparent' ? ' checker' : ''}${onAir ? ' on-air' : ''}${warnings ? ' warnings' : ''} ${className}`}
      style={backgroundCss(background)}
    >
      {background.kind === 'image' && <img className="dv-background" src={background.src} alt="" draggable={false} style={{ objectFit: background.fit }} />}
      {style.elements.map((element) => {
        if (element.hidden) return null
        const box = layout.boxes.get(element.id) ?? element.box
        const entry = timeline?.get(element.id)
        const motion = phase && timeline ? motionStyle(element, entry, phase) : undefined
        // Effects light an element on air and while the designer plays it in; on the way out they go with it.
        const lit = element.effects.length > 0 && phase !== 'out' && (onAir || phase === 'in')
        return (
          <Fragment key={element.id}>
            <DesignElementView
              element={element}
              box={box}
              overflow={layout.overflow.has(element.id)}
              fields={fields}
              edit={edit}
              placeholders={placeholders}
              extra={extra(element)}
              motion={motion}
            />
            {lit && <DesignEffects element={element} box={box} motion={motion} startMs={entry ? entry.startMs + entry.durationMs : 0} />}
          </Fragment>
        )
      })}
    </div>
  )
}
