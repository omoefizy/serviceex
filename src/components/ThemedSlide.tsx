import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { OutputMode, TextCase, ThemeBackground, ThemeStyle } from '../../shared/types'
import { cssFontFamily } from '../lib/fonts'

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

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

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
  }
}

interface Props {
  theme: ThemeStyle
  text: string
  /** The small reference or copyright line under the text. */
  caption?: string
  /** black: plain black. clear: background only. logo: the logo over the background. show: everything. */
  mode?: OutputMode
  /** Shows a video background's first frame instead of playing it, for thumbnails. */
  still?: boolean
  /** The output window draws the background and the text as separate layers so a video background keeps playing across slides. */
  layer?: 'all' | 'background' | 'content'
  /** The church logo for logo mode; the placeholder shows when null. */
  logoUrl?: string | null
}

/**
 * A slide drawn with a theme, filling its parent. Every size is relative to the slide's own height, so the
 * output window, the live preview, thumbnails and the theme editor all lay text out the same way.
 */
export function ThemedSlide({ theme, text, caption = '', mode = 'show', still = false, layer = 'all', logoUrl = null }: Props) {
  const fitRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const captionRef = useRef<HTMLParagraphElement>(null)
  const drawBackground = layer !== 'content' && mode !== 'black'
  const drawContent = layer !== 'background' && mode !== 'black'
  const showText = drawContent && mode === 'show' && text !== ''

  // Size the text: as large as fits (auto), or the fixed size unless that would overflow. Sizes are in cqh,
  // so the result is the same at any slide size.
  useLayoutEffect(() => {
    const box = fitRef.current
    const el = textRef.current
    if (!showText || !box || !el) return

    const fit = () => {
      if (box.clientHeight === 0) return
      const captionEl = captionRef.current
      const captionHeight = captionEl ? captionEl.offsetHeight + parseFloat(getComputedStyle(captionEl).marginTop) : 0
      const height = box.clientHeight - captionHeight
      const fits = (size: number) => {
        el.style.fontSize = `${size}cqh`
        return el.scrollWidth <= box.clientWidth && el.scrollHeight <= height
      }
      if (theme.sizeMode === 'fixed' && fits(theme.fontSize)) return
      let low = MIN_SIZE
      let high = theme.sizeMode === 'fixed' ? theme.fontSize : AUTO_FIT_MAX
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
  }, [theme, text, caption, showText])

  const { margins, band, shadow, outline } = theme
  const textStyle: CSSProperties = {
    fontFamily: cssFontFamily(theme.fontFamily),
    fontWeight: theme.fontWeight,
    color: theme.color,
    lineHeight: theme.lineHeight,
    textTransform: TEXT_TRANSFORMS[theme.textCase],
    textShadow: shadow.enabled ? `${shadow.offset}em ${shadow.offset}em ${shadow.blur}em ${shadow.color}` : 'none',
    // The stroke is drawn under the fill, so double it to show the chosen width outside the letters.
    WebkitTextStroke: outline.enabled ? `${outline.width * 2}em ${outline.color}` : undefined,
    paintOrder: 'stroke fill',
  }
  const captionStyle: CSSProperties = {
    fontFamily: cssFontFamily(theme.caption.fontFamily || theme.fontFamily),
    fontWeight: theme.caption.fontWeight,
    fontSize: `${theme.caption.size}cqh`,
    fontStyle: theme.caption.italic ? 'italic' : 'normal',
    color: theme.caption.color,
    textTransform: TEXT_TRANSFORMS[theme.caption.textCase],
    textShadow: textStyle.textShadow,
  }

  return (
    <div className={`themed-slide${layer === 'content' ? ' transparent' : ''}`}>
      {drawBackground && (
        <>
          <Background background={theme.background} still={still} />
          {theme.overlay > 0 && <div className="themed-bg" style={{ background: `rgba(0, 0, 0, ${theme.overlay})` }} />}
        </>
      )}
      {drawContent && mode === 'logo' && (
        <div className="themed-logo">
          {logoUrl ? <img className="themed-logo-image" src={logoUrl} alt="Logo" draggable={false} /> : <LogoPlaceholder />}
        </div>
      )}
      {showText && (
        <div
          className="themed-safe"
          style={{
            top: `${margins.top}%`,
            right: `${margins.right}%`,
            bottom: `${margins.bottom}%`,
            left: `${margins.left}%`,
            background: band.enabled ? rgba(band.color, band.opacity) : undefined,
            padding: band.enabled ? '3cqh 4cqw' : 0,
          }}
        >
          <div
            ref={fitRef}
            className="themed-fit"
            style={{ justifyContent: JUSTIFY[theme.verticalAlign], alignItems: ALIGN_ITEMS[theme.align], textAlign: theme.align }}
          >
            <p ref={textRef} className="themed-text" style={textStyle}>
              {text}
            </p>
            {caption && (
              <p ref={captionRef} className="themed-caption" style={captionStyle}>
                {caption}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
