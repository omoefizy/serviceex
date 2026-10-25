import { createContext, useContext, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { matching, richVerticalAlign } from '../../shared/richText'
import { DEFAULT_FONT, isTextKind } from '../../shared/themes'
import type {
  OutputMode,
  RichText,
  TextCase,
  ThemeBackground,
  ThemeBox,
  ThemeElement,
  ThemeStyle,
  ThemeTextElement,
  ThemeTextParagraph,
  ThemeTextProps,
  ThemeTextRun,
} from '../../shared/types'
import { cssFontFamily } from '../lib/fonts'
import { REFERENCE_LINE_COLOR, slideLines } from '../lib/slides'
import { animateSmoke, drawStillSmoke, SMOKE_HEIGHT, SMOKE_WIDTH } from '../lib/smoke'
import { spanStyle } from '../lib/richText'
import { RichSlideLines } from './RichText'

/** The largest auto fit size in percent of screen height, so one short line does not fill the screen. */
const AUTO_FIT_MAX = 16
const MIN_SIZE = 1

const TEXT_TRANSFORMS: Record<TextCase, CSSProperties['textTransform']> = {
  normal: 'none',
  upper: 'uppercase',
  lower: 'lowercase',
}
const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const
const ALIGN_ITEMS = { left: 'flex-start', center: 'center', right: 'flex-end' } as const

/** The font for text boxes with none of their own: Live Options' Default Font, provided by each window. */
export const DefaultFontContext = createContext(DEFAULT_FONT)

export const boxStyle = (box: ThemeBox): CSSProperties => ({ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` })

export function LogoPlaceholder() {
  return (
    <div className="logo-placeholder">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 2h4v6h6v4h-6v10h-4V12H4V8h6z" />
      </svg>
      <span>WorshipDeck</span>
    </div>
  )
}

function SmokeBackground({ color, smoke, still }: { color: string; smoke: string; still: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (still) drawStillSmoke(canvas, color, smoke)
    else return animateSmoke(canvas, color, smoke)
  }, [color, smoke, still])
  return <canvas ref={canvasRef} className="themed-bg themed-smoke" width={SMOKE_WIDTH} height={SMOKE_HEIGHT} style={{ background: color }} />
}

function Background({ background, still }: { background: ThemeBackground; still: boolean }) {
  switch (background.kind) {
    case 'solid':
      return <div className="themed-bg" style={{ background: background.color }} />
    case 'gradient':
      return (
        <div
          className="themed-bg"
          style={{ background: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})` }}
        />
      )
    case 'image':
      return (
        <img
          className="themed-bg themed-media"
          style={{ objectFit: background.fit ?? 'cover' }}
          src={background.src}
          alt=""
          draggable={false}
        />
      )
    case 'video':
      // Thumbnails show a frame instead of playing many videos at once.
      return still ? (
        <video className="themed-bg themed-media" src={`${background.src}#t=0.1`} muted preload="metadata" />
      ) : (
        <video className="themed-bg themed-media" src={background.src} autoPlay loop muted playsInline />
      )
    case 'smoke':
      return <SmokeBackground color={background.color} smoke={background.smoke} still={still} />
    case 'none':
      return null
  }
}

/**
 * Where the background layer ends: the shapes and images under the first text box are drawn with the background,
 * so they hold still while the words crossfade between slides. Everything from the first text box up is content.
 */
export function backgroundSplit(theme: ThemeStyle): number {
  const index = theme.elements.findIndex((element) => isTextKind(element.kind))
  return index === -1 ? theme.elements.length : index
}

/** What the backdrop layer draws, so an unchanged background (a playing video, say) is not redrawn between slides. */
export function backdropKey(theme: ThemeStyle): string {
  return JSON.stringify([theme.background, theme.overlay, theme.keyTransparent])
}

/** What the layer of shapes and images under the text draws, so unchanged ones hold still between slides. */
export function underKey(theme: ThemeStyle, logoUrl: string | null): string {
  const below = theme.elements.slice(0, backgroundSplit(theme))
  const usesLogo = below.some((element) => element.kind === 'image' && element.src === null)
  return JSON.stringify([below, usesLogo ? logoUrl : null])
}

export function textStyle(props: ThemeTextProps, defaultFont: string): CSSProperties {
  const { shadow, outline } = props
  return {
    fontFamily: cssFontFamily(props.fontFamily || defaultFont),
    fontWeight: props.fontWeight,
    fontStyle: props.italic ? 'italic' : 'normal',
    textDecoration: props.underline ? 'underline' : 'none',
    color: props.color,
    lineHeight: props.lineHeight,
    textTransform: TEXT_TRANSFORMS[props.textCase],
    textShadow: shadow.enabled ? `${shadow.offset}em ${shadow.offset}em ${shadow.blur}em ${shadow.color}` : 'none',
    // The stroke is drawn under the fill, so double it to show the chosen width outside the letters.
    WebkitTextStroke: outline.enabled ? `${outline.width * 2}em ${outline.color}` : undefined,
    paintOrder: 'stroke fill',
  }
}

/** A clip playing looped and muted; thumbnails show a frame. */
function VideoElement({ element, still }: { element: Extract<ThemeElement, { kind: 'video' }>; still: boolean }) {
  return (
    <div className="themed-element themed-image" style={{ ...boxStyle(element.box), opacity: element.opacity }}>
      {still ? (
        <video src={`${element.src}#t=0.1`} muted preload="metadata" style={{ objectFit: element.fit }} />
      ) : (
        <video src={element.src} autoPlay loop muted playsInline style={{ objectFit: element.fit }} />
      )}
    </div>
  )
}

/** A run of an imported text box: sizes are relative to the box's size, so shrinking to fit keeps their proportions. */
function runStyle(run: ThemeTextRun, props: ThemeTextProps): CSSProperties {
  return spanStyle({
    font: run.fontFamily,
    size: run.fontSize !== undefined ? run.fontSize / props.fontSize : undefined,
    color: run.color,
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    strike: run.strike,
    highlight: run.highlight,
    textCase: run.textCase,
  })
}

function Paragraphs({ paragraphs, props }: { paragraphs: ThemeTextParagraph[]; props: ThemeTextProps }) {
  return paragraphs.map((paragraph, index) => (
    <span key={index} className="themed-line" style={{ textAlign: paragraph.align ?? props.align, lineHeight: paragraph.lineHeight }}>
      {paragraph.bullet && <span className="themed-bullet">{paragraph.bullet}</span>}
      {paragraph.runs.map((run, i) => (
        <span key={i} style={runStyle(run, props)}>
          {run.text}
        </span>
      ))}
    </span>
  ))
}

function ImageElement({ element, logoUrl }: { element: Extract<ThemeElement, { kind: 'image' }>; logoUrl: string | null }) {
  const src = element.src ?? logoUrl
  return (
    <div className="themed-element themed-image" style={{ ...boxStyle(element.box), opacity: element.opacity }}>
      {src ? <img src={src} alt="" draggable={false} style={{ objectFit: element.fit }} /> : <LogoPlaceholder />}
    </div>
  )
}

/** A line drawn under the main text, following it: an attached Reference or Copyright box. */
interface AttachedLine {
  id: string
  text: string
  props: ThemeTextProps
}

/**
 * A text box: as large as fits (auto), or the fixed size unless that would overflow. Sizes are in cqh, so the result
 * is the same at any slide size. Attached lines sit under the words and count towards what has to fit. The main text
 * box draws `rich` (the slide's own formatting, over the theme's) in place of the plain words.
 */
function TextBox({ element, content, attached = [], main, rich = null }: { element: ThemeTextElement; content: string; attached?: AttachedLine[]; main: boolean; rich?: RichText | null }) {
  const defaultFont = useContext(DefaultFontContext)
  const fitRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const attachedRef = useRef<HTMLDivElement>(null)
  const props = element.text
  const paragraphs = element.kind === 'text' ? element.paragraphs : undefined
  const attachedKey = JSON.stringify(attached)

  useLayoutEffect(() => {
    const box = fitRef.current
    const el = textRef.current
    if (!box || !el) return

    const fit = () => {
      if (box.clientHeight === 0) return
      const below = attachedRef.current
      const height = box.clientHeight - (below ? below.offsetHeight : 0)
      const fits = (size: number) => {
        el.style.fontSize = `${size}cqh`
        return el.scrollWidth <= box.clientWidth && el.scrollHeight <= height
      }
      if (props.sizeMode === 'fixed' && fits(props.fontSize)) return
      let low = MIN_SIZE
      let high = props.sizeMode === 'fixed' ? props.fontSize : AUTO_FIT_MAX
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
    // Fonts load on first use, so measure again once they have, or the fit is for the fallback font.
    document.fonts.addEventListener('loadingdone', fit)
    return () => {
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', fit)
    }
  }, [props, content, paragraphs, attachedKey, defaultFont, rich])

  // Aligned paragraphs line up across the whole box, as in a word processor, not just across the widest line.
  const fullWidth = paragraphs !== undefined || (rich?.paragraphs.some((p) => p.align !== undefined) ?? false)
  const verticalAlign = (rich && richVerticalAlign(rich)) ?? props.verticalAlign

  return (
    <div className="themed-element themed-box" style={{ ...boxStyle(element.box), padding: `${props.padding}cqh` }}>
      <div
        ref={fitRef}
        className="themed-fit"
        style={{ justifyContent: JUSTIFY[verticalAlign], alignItems: ALIGN_ITEMS[props.align], textAlign: props.align }}
      >
        {/* data-slide-text lets the Live and Preview boxes find the clicked word (see useWordMarking). */}
        <p ref={textRef} className={`themed-text${fullWidth ? ' fixed' : ''}`} style={textStyle(props, defaultFont)} data-slide-text={main || undefined}>
          {paragraphs ? (
            <Paragraphs paragraphs={paragraphs} props={props} />
          ) : rich ? (
            <RichSlideLines rich={rich} />
          ) : main
            ? slideLines(content).map((line, index) => (
                <span
                  key={index}
                  className={`themed-line ${line.kind}`}
                  style={line.kind === 'reference' ? { color: REFERENCE_LINE_COLOR } : undefined}
                >
                  {line.text}
                </span>
              ))
            : content}
        </p>
        {attached.length > 0 && (
          <div ref={attachedRef} className="themed-attached">
            {attached.map((line) => (
              <p
                key={line.id}
                className="themed-caption"
                style={{ ...textStyle(line.props, defaultFont), fontSize: `${line.props.fontSize}cqh`, textAlign: props.align }}
              >
                {line.text}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  theme: ThemeStyle
  text: string
  /** What the Reference box shows. */
  caption?: string
  /** What the Copyright box shows. */
  copyright?: string
  /** black: plain black. clear: everything but the text. logo: the theme (the Logo theme) without text. show: everything. */
  mode?: OutputMode
  /** Shows a video background's first frame instead of playing it, for thumbnails. */
  still?: boolean
  /**
   * The output window draws the backdrop (the background and its darkening), the shapes and images under the text
   * ('under') and the content as separate layers, so a video background keeps playing across slides whatever else
   * changes. 'background' is the backdrop and the layer under the text together.
   */
  layer?: 'all' | 'background' | 'backdrop' | 'under' | 'content'
  /** The church logo, for images without a picture of their own; the placeholder shows when null. */
  logoUrl?: string | null
  /** On the Stream output a theme that is transparent for keying draws no background, so the key color shows. */
  keyed?: boolean
  /** The slide's own formatting of `text`; ignored unless its plain text is exactly `text`. */
  rich?: RichText | null
}

/**
 * A slide drawn with a theme, filling its parent: the background, then the theme's elements bottom to top. Every
 * size is relative to the slide's own height, so the output window, the live preview, thumbnails and the theme
 * editor all lay text out the same way.
 */
export function ThemedSlide({ theme, text, caption = '', copyright = '', mode = 'show', still = false, layer = 'all', logoUrl = null, keyed = false, rich = null }: Props) {
  const transparentBackground = keyed && theme.keyTransparent && mode !== 'black'
  const drawBackground = (layer === 'all' || layer === 'background' || layer === 'backdrop') && mode !== 'black' && !transparentBackground
  const split = backgroundSplit(theme)
  const from = layer === 'content' ? split : 0
  const to = layer === 'background' || layer === 'under' ? split : layer === 'backdrop' ? 0 : theme.elements.length
  const showText = mode === 'show'
  const formatted = matching(rich, text)

  const contentOf = (element: ThemeTextElement) => (element.kind === 'text' ? text : element.kind === 'reference' ? caption : copyright)
  const mainText = theme.elements.find((element) => element.kind === 'text')
  // Attached boxes follow the main text when there is one to follow.
  const followsText = (element: ThemeElement) => mainText !== undefined && (element.kind === 'reference' || element.kind === 'copyright') && element.attached
  const attached: AttachedLine[] = []
  for (const element of theme.elements) {
    if (followsText(element) && 'text' in element && contentOf(element)) attached.push({ id: element.id, text: contentOf(element), props: element.text })
  }

  const drawn: ReactNode[] = []
  if (mode !== 'black') {
    for (const element of theme.elements.slice(from, to)) {
      if (element.kind === 'shape') {
        drawn.push(<div key={element.id} className="themed-element" style={{ ...boxStyle(element.box), background: element.color, opacity: element.opacity }} />)
      } else if (element.kind === 'image') {
        drawn.push(<ImageElement key={element.id} element={element} logoUrl={logoUrl} />)
      } else if (element.kind === 'video') {
        drawn.push(<VideoElement key={element.id} element={element} still={still} />)
      } else if (showText && !followsText(element)) {
        const content = contentOf(element)
        // The main text carries the attached lines, so they go with it (and like before, only under words).
        if (element.kind === 'text' && element.paragraphs) drawn.push(<TextBox key={element.id} element={element} content="" main={false} />)
        else if (content)
          drawn.push(
            <TextBox
              key={element.id}
              element={element}
              content={content}
              attached={element === mainText ? attached : undefined}
              main={element.kind === 'text'}
              rich={element.kind === 'text' ? formatted : null}
            />,
          )
      }
    }
  }

  return (
    <div className={`themed-slide${layer === 'content' || layer === 'under' || transparentBackground ? ' transparent' : ''}`}>
      {drawBackground && (
        <>
          {theme.keyTransparent ? null : <Background background={theme.background} still={still} />}
          {theme.overlay > 0 && !theme.keyTransparent && <div className="themed-bg" style={{ background: `rgba(0, 0, 0, ${theme.overlay})` }} />}
        </>
      )}
      {drawn}
    </div>
  )
}
