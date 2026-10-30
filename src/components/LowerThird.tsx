import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { animatesItself, designTimeline } from '../../shared/designAnimation'
import { matching } from '../../shared/richText'
import type { LowerThirdBox, LowerThirdDisplay, LowerThirdStyle, LowerThirdTextStyle, RichText, TextCase } from '../../shared/types'
import { cssFontFamily } from '../lib/fonts'
import { DesignView } from './DesignView'
import { RichInline } from './RichText'

/** Must match .lt-text in index.css. */
const LINE_HEIGHT = 1.15
const MIN_SIZE = 0.5

const TEXT_TRANSFORMS: Record<TextCase, CSSProperties['textTransform']> = { normal: 'none', upper: 'uppercase', lower: 'lowercase' }
const ALIGN_ITEMS = { left: 'flex-start', center: 'center', right: 'flex-end' } as const

const boxStyle = (box: LowerThirdBox): CSSProperties => ({ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` })

/** The accent stripe along one edge of the frame. */
function accentStyle({ side, size }: LowerThirdStyle['accent']): CSSProperties {
  if (side === 'left') return { left: 0, top: 0, bottom: 0, width: `${size}%` }
  return { left: 0, right: 0, [side]: 0, height: `${size}%` }
}

/**
 * One text field in its box, as large as its template allows and shrunk until it fits the box in no more than its
 * line count. The line clamp is a backstop, so even the longest text never spills off the bar.
 */
function FitText({ field, text, rich, align, outline }: {
  field: LowerThirdTextStyle
  text: string
  /** The words with their formatting, used when its plain text is `text`. */
  rich?: RichText | null
  align: LowerThirdStyle['align']
  outline: LowerThirdStyle['outline']
}) {
  const formatted = matching(rich, text)
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    const el = textRef.current
    if (!box || !el) return
    const fit = () => {
      if (box.clientHeight === 0) return
      const fits = (size: number) => {
        el.style.fontSize = `${size}cqh`
        const lines = Math.round(el.scrollHeight / (parseFloat(getComputedStyle(el).fontSize) * LINE_HEIGHT))
        return lines <= field.maxLines && el.scrollHeight <= box.clientHeight + 1 && el.scrollWidth <= box.clientWidth + 1
      }
      if (fits(field.size)) return
      let low = MIN_SIZE
      let high = field.size
      while (high - low > 0.05) {
        const size = (low + high) / 2
        if (fits(size)) low = size
        else high = size
      }
      el.style.fontSize = `${low}cqh`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [field, text, formatted])

  return (
    <div ref={boxRef} className="lt-text-box" style={{ ...boxStyle(field.box), alignItems: ALIGN_ITEMS[align], textAlign: align }}>
      <p
        ref={textRef}
        className="lt-text"
        style={{
          fontFamily: cssFontFamily(field.fontFamily),
          fontWeight: field.fontWeight,
          fontStyle: field.italic ? 'italic' : 'normal',
          color: field.color,
          textTransform: TEXT_TRANSFORMS[field.textCase],
          WebkitLineClamp: field.maxLines,
          // The stroke is drawn under the fill, so double it to show the chosen width outside the letters.
          WebkitTextStroke: outline.enabled ? `${outline.width * 2}em ${outline.color}` : undefined,
          paintOrder: 'stroke fill',
        }}
      >
        {formatted ? <RichInline rich={formatted} /> : text}
      </p>
    </div>
  )
}

/**
 * A lower third drawn with a template: the bar, its accent stripe, the logo and the two text fields. It is placed in
 * its positioned parent by the template's frame; sizes are in cqh of the nearest size container (the screen).
 */
export function LowerThirdGraphic({ style, headline, body, headlineRich, bodyRich, className = '', frameStyle }: {
  style: LowerThirdStyle
  headline: string
  body: string
  headlineRich?: RichText
  bodyRich?: RichText
  className?: string
  frameStyle?: CSSProperties
}) {
  return (
    <div className={`lt-frame ${className}`} style={{ ...boxStyle(style.frame), ...frameStyle }}>
      {style.bar.enabled && <div className="lt-fill" style={{ background: style.bar.color }} />}
      {style.accent.enabled && <div className="lt-accent" style={{ ...accentStyle(style.accent), background: style.accent.color }} />}
      {style.logo.enabled && style.logo.url && <img className="lt-logo" src={style.logo.url} style={boxStyle(style.logo.box)} alt="" draggable={false} />}
      {headline && <FitText field={style.headline} text={headline} rich={headlineRich} align={style.align} outline={style.outline} />}
      {body && <FitText field={style.body} text={body} rich={bodyRich} align={style.align} outline={style.outline} />}
    </div>
  )
}

/** How long a lower third takes to go: its design's way out when its elements animate, else the layer's animation. */
function leavingMs(display: LowerThirdDisplay): number {
  if (display.design && animatesItself(display.design)) return designTimeline(display.design.elements, 'out').totalMs
  return display.durationMs
}

interface Shown {
  display: LowerThirdDisplay
  leaving: boolean
}

/**
 * The lower third layer: animates the lower third in when it appears and out when it goes, and changes its text in
 * place on an update. The last one shown is kept until its way out has finished.
 */
export function LowerThirdLayer({ display }: { display: LowerThirdDisplay | null }) {
  const [shown, setShown] = useState<Shown | null>(display && { display, leaving: false })

  useEffect(() => {
    if (display) setShown({ display, leaving: false })
    else setShown((current) => current && (current.leaving ? current : { ...current, leaving: true }))
  }, [display])

  useEffect(() => {
    if (!shown?.leaving) return
    const timer = setTimeout(() => setShown(null), leavingMs(shown.display))
    return () => clearTimeout(timer)
  }, [shown])

  if (!shown) return null
  const { display: d, leaving } = shown
  if (d.design) {
    const fields = { headline: d.headline, body: d.body, number: d.number ?? '' }
    // A design whose elements animate plays them; otherwise the whole design moves, from a whole screen to the left.
    if (animatesItself(d.design)) {
      return (
        <div key={`${d.runId}-${leaving}`} className="lt-design">
          <DesignView style={d.design} fields={fields} onAir phase={leaving ? 'out' : 'in'} />
        </div>
      )
    }
    return (
      <div
        key={d.runId}
        className={`lt-design lt-${d.animation}-${leaving ? 'out' : 'in'}`}
        style={{ animationDuration: `${d.durationMs}ms`, ['--lt-offset' as string]: '-100cqw' }}
      >
        <DesignView style={d.design} fields={fields} onAir />
      </div>
    )
  }
  const { frame } = d.style
  return (
    <LowerThirdGraphic
      key={d.runId}
      style={d.style}
      headline={d.headline}
      body={d.body}
      headlineRich={d.headlineRich}
      bodyRich={d.bodyRich}
      className={`lt-${d.animation}-${leaving ? 'out' : 'in'}`}
      frameStyle={{ animationDuration: `${d.durationMs}ms`, ['--lt-offset' as string]: `${-(frame.x + frame.width)}cqw` }}
    />
  )
}
