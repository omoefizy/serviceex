// Types shared by the main process, the preload script and the renderer.
// Keep this file free of runtime code: it is imported with `import type` only.

import type { Entitlements, KeyProvider } from './features'
import type { LicenseStatus } from './license'
import type { AccountApi } from './account'
import type { VersePart } from './parseReference'

/** How a song's sections play and how its slides are cut. */
export interface SongArrangement {
  /** Section labels in play order, repeats allowed, such as ["Verse 1", "Chorus", "Verse 2", "Chorus"]. Empty plays sections as written. */
  order: string[]
  /** Splits any slide longer than this many lines; null keeps slides as the blank lines and labels cut them. */
  linesPerSlide: 2 | 3 | 4 | null
}

export interface Song {
  id: number
  title: string
  author: string | null
  /** Copyright or licence line, such as "© 2001 Example Music · CCLI 1234567". */
  copyright: string | null
  tags: string[]
  arrangement: SongArrangement
  /** The song's own theme; null uses the default theme for songs. */
  themeId: number | null
  /** Plain text. A line like [Verse 1] starts a section; a blank line or a section label starts a new slide. */
  lyrics: string
  /** Formatting for some of its slides, keyed by slide text; the lyrics stay the source. Absent or empty: the theme's look. */
  formatting?: SlideFormats
}

export type SongSummary = Pick<Song, 'id' | 'title' | 'author'>

export interface Slide {
  id: number
  song_id: number
  order: number
  text: string
}

export interface Service {
  id: number
  name: string
  date: string | null
}

export type ServiceItemType = 'song' | 'scripture' | 'announcement' | 'presentation'

/** One slide of a scripture passage: a verse, part of one, or a combined slide of several passages. */
export interface ScriptureSlide {
  text: string
  caption: string
  /** The verse's words from the Bible, kept when the slide shows only part of it or edited words. */
  source?: string
  /** Shows only part of the verse: "a" up to `split` (an offset into `source`), "b" from it. */
  part?: { which: VersePart; split: number }
  /** The words were edited for display (typed, or hidden behind "…"); `source` keeps the Bible's. */
  edited?: boolean
  /** A combined slide in two columns: the right column's text; `text` is the left column. */
  column?: string
}

/** A scripture passage saved in a service, verses included so it shows without another lookup. */
export interface ScripturePayload {
  /** Such as "John 3:16-18 KJV". */
  title: string
  verses: ScriptureSlide[]
  /** Formatting for some of its slides, keyed by slide text. */
  formats?: SlideFormats
  /** A Scripture group: several passages combined, kept so the group can be opened and edited again. */
  group?: ScriptureGroup
}

/** How a combined slide lays out its passages. */
export type ScriptureGroupLayout = 'stacked' | 'columns'

/** One passage of a Scripture group. */
export interface ScriptureGroupPassage {
  /** As asked for, such as "Ephesians 1:19b". */
  reference: string
  version: BibleVersionCode
  /** Its verses, each with its own part and edits. */
  verses: ScriptureSlide[]
}

/** Up to four passages on one slide, each under its own reference (see shared/scriptureGroup.ts). */
export interface ScriptureGroup {
  layout: ScriptureGroupLayout
  passages: ScriptureGroupPassage[]
  /** One slide per passage instead of one for them all, for passages too long to share a slide. */
  split?: boolean
}

export interface AnnouncementPayload {
  title: string
  /** Split into slides on blank lines, like song lyrics. */
  body: string
  /** Starts with a slide showing just the title. Older announcements have no title slide. */
  titleSlide?: boolean
  /**
   * A saved quote (a statement from the sermon): the body is one slide in quote marks, with the speaker's name
   * on the line under it, and it uses the Quote theme default.
   */
  quote?: { speaker: string }
  /** Formatting for some of its slides, keyed by slide text. */
  formats?: SlideFormats
}

/** Images or PDF pages, one slide each, stored as image files in the media folder. */
export interface PresentationPayload {
  title: string
  /** wd-media:// URLs, in order. */
  pages: string[]
  /**
   * The library presentation this came from. Its pages follow the presentation when the original file is saved
   * again; absent for items made before the Presentations library.
   */
  presentationId?: number
}

export type ServiceItemPayload = ScripturePayload | AnnouncementPayload | PresentationPayload

interface ServiceItemFields {
  id: number
  service_id: number
  order: number
  /** Song title, scripture reference or announcement title. */
  title: string
}

/** Songs point at the songs table through `ref_id`; the other types carry their content in `payload`. */
export type ServiceItem =
  | (ServiceItemFields & { type: 'song'; ref_id: number; payload: null })
  | (ServiceItemFields & { type: 'scripture'; ref_id: null; payload: ScripturePayload })
  | (ServiceItemFields & { type: 'announcement'; ref_id: null; payload: AnnouncementPayload })
  | (ServiceItemFields & { type: 'presentation'; ref_id: null; payload: PresentationPayload })

export interface ServiceWithItems extends Service {
  /** In run order. */
  items: ServiceItem[]
}

/** What the output window renders for a slide. */
export interface SlideContent {
  text: string
  /**
   * What the theme's Reference box shows: a scripture reference such as "John 3:16 KJV", a song's title and author,
   * an announcement's title or a quote's speaker. Empty for none.
   */
  caption: string
  /** What the theme's Copyright box shows: a song's copyright line on its first slide. */
  copyright?: string
  /** The words with their formatting, drawn in place of `text` when its plain text matches it exactly. */
  rich?: RichText | null
}

// ---------- Formatted text ----------

/**
 * How a span of words looks where it differs from the theme. Left out: the theme's. `size` is a multiple of the
 * theme's size, so auto fit scales it with the rest of the words.
 */
export interface RichMarks {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** #rrggbb. */
  color?: string
  /** A background color behind the words, #rrggbb. */
  highlight?: string
  size?: number
  /** A family name such as "Avenir Next". */
  font?: string
  textCase?: TextCase
}

export interface RichSpan extends RichMarks {
  /** Never holds a line break: each line is its own paragraph. */
  text: string
}

export type RichAlign = 'left' | 'center' | 'right' | 'justify'

export interface RichParagraphStyle {
  align?: RichAlign
  /** Where the words sit in the text box; the first paragraph of a slide that sets it decides. */
  verticalAlign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number
}

export interface RichParagraph extends RichParagraphStyle {
  spans: RichSpan[]
}

/**
 * Formatted words: one paragraph per line of the plain text, made of spans. Stored as JSON next to the plain text,
 * which stays the source for search, the AI features and the speech matcher (see shared/richText.ts).
 */
export interface RichText {
  paragraphs: RichParagraph[]
}

/** Formatting for slides, keyed by each slide's plain text; a slide not listed shows the theme's look. */
export type SlideFormats = Record<string, RichText>

/**
 * - show:  slide text over its background
 * - black: everything off, pure black
 * - clear: text hidden; the background, shapes and images stay
 * - logo:  the default Logo theme
 */
export type OutputMode = 'show' | 'black' | 'clear' | 'logo'

// ---------- Alerts ----------

/** A short message for the alert ticker, such as "Parents, please pick up your child". */
export interface AlertMessage {
  id: string
  text: string
  /** The text with its formatting, used when its plain text matches `text`. */
  rich?: RichText
  /** Interrupts the normal messages in its own band color; they carry on where they were afterwards. */
  priority: boolean
}

/** divider: every message in one stream with a divider between. sequence: each message crosses the band on its own. */
export type AlertLayout = 'divider' | 'sequence'

/**
 * The ticker as the output and stage windows draw it, or null for none. Every window works out the scroll position
 * from `startedAt` and the speed, so they all agree without sending positions.
 */
export interface AlertDisplay {
  /** Changes whenever a new run starts. */
  runId: number
  texts: string[]
  /** Each text's formatting, or null, in the same order. */
  riches?: (RichText | null)[]
  /** Epoch milliseconds at which the start of the text was at the band's right edge. */
  startedAt: number
  /** Times through the messages before the band empties; 0 loops until stopped. */
  loops: number
  layout: AlertLayout
  priority: boolean
  position: 'top' | 'bottom'
  /** Percent of screen height per second, so a smaller screen scrolls in step with the projector. */
  speed: number
  /** Percent of screen height. */
  fontSize: number
  textColor: string
  bandColor: string
  bandOpacity: number
  /** Percent of screen height. */
  bandHeight: number
}

/** What the operator sends to the output window. `text` is empty when no slide is live. */
export interface OutputState extends SlideContent {
  mode: OutputMode
  /** Crossfade length for slide and background changes, in milliseconds. */
  fadeMs: number
  /** The church logo for image elements without their own picture, or null for the placeholder. */
  logoUrl: string | null
  /** The resolved theme (the Logo theme in logo mode), sent whole so the output window needs no database access. */
  theme: ThemeStyle
  copyright: string
  /** The font for text boxes that have none of their own (Live Options). */
  defaultFont: string
  /** Live Options' screen margins, in percent: everything on the projector is drawn inside them. */
  screenMargins: ScreenMargins
  /** A border, corner markers and safe areas over everything, for lining up the projector or a vision mixer. */
  testPattern: boolean
  /** The alert band over the slide, independent of it. */
  alert: AlertDisplay | null
  /**
   * The layers over the slide, or null in Black: the idle design and the lower third always, the logo layer only with
   * `overlaysOnChurchScreen`.
   */
  overlays: OverlayLayers | null
}

// ---------- Stream output and overlays ----------

/** Where a logo sits: a corner of the action safe area, or anywhere (`x` and `y`). */
export type LogoAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'free'

/** One logo on the logo layer, such as a church logo in a corner of the livestream. */
export interface LogoItem {
  id: string
  /** The file name it was added from, for the list. */
  name: string
  /** wd-media:// URL of the copy in the app data folder. PNGs keep their transparency. */
  url: string
  anchor: LogoAnchor
  /** For a free logo: where its centre sits, in percent of the screen's width and height. */
  x: number
  y: number
  /** Height in percent of screen height; the width follows the image. */
  size: number
  /** Distance in from the corner of the action safe area, in percent of screen height. */
  margin: number
  /** 0 to 1. */
  opacity: number
  /** Off keeps the logo in the list without showing it. */
  enabled: boolean
}

/** What the overlay layers draw, bottom to top: logos, the idle design, then the lower third on top of everything. */
export interface OverlayLayers {
  /** The logos that are on, or none while the logo layer is hidden. */
  logos: LogoItem[]
  /**
   * The idle design (Settings, Lower thirds) while the main content is cleared, or null. Its elements flagged
   * `hideWithLowerThird` step aside while `lowerThird` is up.
   */
  idle: DesignStyle | null
  /** The lower third on screen, or null. */
  lowerThird: LowerThirdDisplay | null
}

// ---------- Lower thirds ----------

/** A box in percent: of the screen for a lower third's frame, of the frame for the parts inside it. */
export interface LowerThirdBox {
  x: number
  y: number
  width: number
  height: number
}

/** One text field of a lower third template. */
export interface LowerThirdTextStyle {
  box: LowerThirdBox
  /** Empty uses the template's default sans serif. */
  fontFamily: string
  fontWeight: number
  /** The largest size, in percent of screen height; longer text shrinks to fit its box. */
  size: number
  color: string
  textCase: TextCase
  italic: boolean
  /** The most lines the text wraps to before it shrinks. */
  maxLines: number
}

/**
 * A lower third template. Everything is solid with hard edges (no see-through fills, rounded corners or glows), so it
 * keys cleanly; sizes are relative to the screen, like slide themes.
 */
export interface LowerThirdStyle {
  /** Where it sits on screen. The bar fills it; the accent, logo and text are placed inside it. */
  frame: LowerThirdBox
  bar: { enabled: boolean; color: string }
  /** A stripe along one edge of the bar; `size` is percent of the frame's width (left) or height (top, bottom). */
  accent: { enabled: boolean; color: string; side: 'left' | 'top' | 'bottom'; size: number }
  /** wd-media:// URL of a small logo in the app data folder, or null. */
  logo: { enabled: boolean; url: string | null; box: LowerThirdBox }
  headline: LowerThirdTextStyle
  body: LowerThirdTextStyle
  align: 'left' | 'center' | 'right'
  /** A thin solid outline around the text; width in em. */
  outline: { enabled: boolean; color: string; width: number }
}

export interface LowerThirdTemplate {
  id: number
  name: string
  /** Built-in templates ship with the app and cannot be changed; save a copy instead. */
  type: 'builtin' | 'custom'
  style: LowerThirdStyle
}

export type LowerThirdAnimation = 'slide' | 'fade' | 'wipe'

/** A reusable line in the Lower Third panel. Pinned lines stay at the top. */
export interface SavedLowerThirdLine {
  id: string
  headline: string
  body: string
  headlineRich?: RichText
  bodyRich?: RichText
  pinned: boolean
}

/** A sermon point in the Lower thirds workspace: its words, and the design it shows in (null: the default). */
export interface SermonPoint {
  id: string
  text: string
  designId: number | null
}

/** The lower third as every output draws it, on top of everything else. */
export interface LowerThirdDisplay {
  /** Changes each time a line is shown; an update keeps it, so the text changes in place. */
  runId: number
  headline: string
  body: string
  /** The headline and body with their formatting, used when their plain text matches. */
  headlineRich?: RichText
  bodyRich?: RichText
  style: LowerThirdStyle
  /** A design from the designer drawn in place of the template `style`, its bound text filled with the words. */
  design?: DesignStyle
  /** What a design's text bound to Number shows, such as a sermon point's number. */
  number?: string
  animation: LowerThirdAnimation
  /** How long the animation in and out takes, 200 to 1000 ms. */
  durationMs: number
}

export interface LowerThirdsApi {
  list(): Promise<LowerThirdTemplate[]>
  create(name: string, style: LowerThirdStyle): Promise<LowerThirdTemplate>
  /** Custom templates only; resolves to false for a built-in one. */
  update(id: number, name: string, style: LowerThirdStyle): Promise<boolean>
  delete(id: number): Promise<boolean>
}

// ---------- Designs ----------

/** A design's background: transparent for a lower third over the picture, or a full slide background. */
export type DesignBackground =
  | { kind: 'transparent' }
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  /** A wd-media:// URL in the app data folder. */
  | { kind: 'image'; src: string; fit: 'cover' | 'contain' }

/** How a rectangle is filled. Angles are CSS degrees (0 is bottom to top). */
export type DesignFill = { kind: 'solid'; color: string } | { kind: 'gradient'; from: string; to: string; angle: number }

/** A drop shadow; offsets and blur in percent of screen height. */
export interface DesignShadow {
  enabled: boolean
  color: string
  /** 0 to 1. */
  opacity: number
  blur: number
  x: number
  y: number
}

/**
 * What a text element shows when the design is used: the headline, the body or the point's number in place of its own
 * words. Its own words are the sample the designer shows.
 */
export type DesignTextField = 'headline' | 'body' | 'number'

/** The words typed on a design's canvas, by the field its text is bound to; a field left out shows the design's own words. */
export type LowerThirdCanvasText = Partial<Record<DesignTextField, string>>

/** A light effect over an element: a band of light, a bolt, a light round its edge, a glow, a flicker or a scan line. */
export type DesignEffectKind = 'lightSweep' | 'lightning' | 'borderChase' | 'glowPulse' | 'flicker' | 'scanLine'

/** Which way a pass goes: as set, the other way, or there and back on alternate passes. */
export type DesignEffectDirection = 'forward' | 'reverse' | 'alternate'

/**
 * One light effect on an element. It starts once the element has come in (after `delayMs`), plays `repeat` passes (0
 * loops while the element is on screen), each `durationMs` long at speed 1 with `gapMs` dark between them, and is drawn
 * inside the element's shape: its box with its rounded corners, or a picture's own outline.
 */
export interface DesignEffect {
  id: string
  kind: DesignEffectKind
  /** One pass, at speed 1. */
  durationMs: number
  /** How fast it plays, 0.25 to 4 times. */
  speed: number
  delayMs: number
  /** Dark time between passes, at speed 1. */
  gapMs: number
  /** Passes before it stops; 0 loops. */
  repeat: number
  easing: DesignEasing
  /** How strong the light is, 0 to 1. */
  intensity: number
  color: string
  /** The direction the band travels, in degrees: 0 left to right, 90 top to bottom (Light sweep, Scan line). */
  angle: number
  /** The band's width, the bolt's spread or the length of the light round the edge, in percent (1 to 100). */
  width: number
  direction: DesignEffectDirection
  /** How much the light flickers, 0 to 1 (Lightning, Flicker). */
  flicker: number
  /** Picks the bolt's shape and the flicker's pattern; the same seed draws the same each time. */
  seed: number
  /** The glow round the light, in percent of screen height (Lightning, Glow pulse). */
  glow: number
  /** The thickness of the light round the edge, in percent of screen height (Border chase). */
  thickness: number
}

/** A movement an element repeats while it is on screen, such as a church logo that gently pulses. */
export type DesignLoop = 'none' | 'pulse' | 'float' | 'glow' | 'spin' | 'shimmer'

/** How an element comes on (in) or goes off (out). The slides come from, or go to, that edge of the screen. */
export type DesignMotion = 'none' | 'fade' | 'slideLeft' | 'slideRight' | 'slideBottom' | 'slideTop' | 'wipe' | 'scale'

export type DesignEasing = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back'

/** One way in or out: the movement, how long it takes, how long it waits first and its easing. */
export interface DesignMotionStep {
  motion: DesignMotion
  durationMs: number
  delayMs: number
  easing: DesignEasing
}

/**
 * An element's animation on air. Elements build by `order`: everything with the lowest order first, the next order
 * once those are done, and so on; on the way out the last to build goes first.
 */
export interface DesignElementAnimation {
  in: DesignMotionStep
  out: DesignMotionStep
  order: number
}

/** Where an element stays when the lower third grows or shrinks around stretching text (see shared/autoLayout.ts). */
export type DesignPinX = 'left' | 'right' | 'center' | 'scale'
export type DesignPinY = 'top' | 'bottom' | 'center' | 'scale'
export interface DesignConstraints {
  horizontal: DesignPinX
  vertical: DesignPinY
}

/** Four sides, each in percent: of the canvas for padding, of the picture for 9 slice insets. */
export interface DesignInsets {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * How a text element's box follows its words. Fixed keeps the box; Auto width grows sideways and wraps at the maximum
 * width; Auto height wraps at the box's width and grows down (or up); Shrink to fit keeps the box and makes the words
 * smaller.
 */
export type DesignTextSizing = 'fixed' | 'autoWidth' | 'autoHeight' | 'shrink'

/** Which way a stretching text and the shapes fitted to it grow: the opposite edge (or the centre) stays put. */
export type DesignGrowth = 'right' | 'left' | 'up' | 'down' | 'center'

/** A shape or picture sized to a text element's box, as a background that stretches with the words. */
export interface DesignFitToText {
  /** The text element's id. */
  textId: string
  /** Around the text's box, in percent of the canvas. */
  padding: DesignInsets
  /** Width limits in percent of the canvas; a maximum of 0 is no limit. */
  minWidth: number
  maxWidth: number
  anchor: DesignGrowth
  /** Which sizes follow the text: a stripe along the edge of a bar follows only its height. */
  axes: 'both' | 'width' | 'height'
}

interface DesignElementBase {
  id: string
  /** Shown in the layers list. */
  name: string
  /** Percent of the canvas, before rotation; it may run off the edges. */
  box: ThemeBox
  /** Degrees clockwise about the box's centre. */
  rotation: number
  /** 0 to 1. */
  opacity: number
  /** Locked elements cannot be selected on the canvas, moved or resized. */
  locked: boolean
  /** Hidden elements are not drawn, on the canvas or on air. */
  hidden: boolean
  /** In an idle design: fades out while a lower third is live, so a corner tag steps aside for it. */
  hideWithLowerThird: boolean
  loop: DesignLoop
  animation: DesignElementAnimation
  /** Light effects over the element while it is on screen, in the order they draw (see shared/designEffects.ts). */
  effects: DesignEffect[]
  /** Pins to the lower third's edges, for when stretching text makes it larger or smaller. */
  constraints: DesignConstraints
  /** Sized to a text element as its background; ignored on text. */
  fitToText: DesignFitToText | null
}

export interface DesignTextProps {
  text: string
  field: DesignTextField | null
  /** A family name such as "Montserrat"; empty uses the Default Font. */
  fontFamily: string
  fontWeight: number
  italic: boolean
  /** Percent of screen height: the size, or the largest size when auto fit is on. */
  fontSize: number
  /** How the box follows the words (see DesignTextSizing). */
  sizing: DesignTextSizing
  /** With Auto width or Auto height: also shrinks the words when they still overflow the maximum size. */
  autoFit: boolean
  /** The largest box Auto width and Auto height grow to, in percent of the canvas. */
  maxWidth: number
  maxHeight: number
  color: string
  align: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  lineHeight: number
  /** In em. */
  letterSpacing: number
  textCase: TextCase
  shadow: DesignShadow
  /** Width in em. */
  outline: { enabled: boolean; color: string; width: number }
}

/** One element of a design, drawn bottom to top in list order. Sizes are percent of screen height. */
export type DesignElement =
  | (DesignElementBase & { kind: 'text' } & DesignTextProps)
  | (DesignElementBase & {
      kind: 'rect'
      fill: DesignFill
      /** Corner radius. */
      radius: number
      border: { width: number; color: string }
      shadow: DesignShadow
    })
  /** A line across the middle of its box, as wide as the box; rotate it for any angle. */
  | (DesignElementBase & { kind: 'line'; color: string; thickness: number; dashed: boolean })
  | (DesignElementBase & {
      kind: 'image'
      src: string | null
      fit: 'contain' | 'cover'
      radius: number
      /** 9 slice insets in percent of the picture: the corners and edges keep their size when it stretches. */
      slice: DesignInsets | null
    })

export type DesignElementKind = DesignElement['kind']

export type DesignCategory = 'lowerThird' | 'slide'

/** A design on a 16:9 canvas. Everything scales with the screen, so it looks the same at any size. */
export interface DesignStyle {
  category: DesignCategory
  background: DesignBackground
  elements: DesignElement[]
}

export interface Design {
  id: number
  name: string
  /** Built-in designs ship with the app and cannot be changed or deleted; save a copy instead. */
  type: 'builtin' | 'custom'
  style: DesignStyle
}

export interface DesignsApi {
  /** Built-in designs first, then custom ones in the order they were made. */
  list(): Promise<Design[]>
  create(name: string, style: DesignStyle): Promise<Design>
  /** Custom designs only; resolves to false for a built-in or missing one. */
  update(id: number, name: string, style: DesignStyle): Promise<boolean>
  delete(id: number): Promise<boolean>
  /** Stores a picture an import brought (from an SVG or a pasted PNG) in the media folder; resolves to its URL. */
  saveAsset(bytes: Uint8Array, extension: 'png' | 'jpg' | 'webp' | 'gif' | 'svg'): Promise<string>
}

/**
 * The Stream output's background. chroma: `streamKeyColor` for a chroma key. luma: black for a luma key. transparent:
 * no background, for window capture, NDI or a virtual camera. keyFill: the fill on black here, and the key (white
 * shapes on black) in a second window on `streamKeyDisplay`.
 */
export type StreamKeyMode = 'chroma' | 'luma' | 'transparent' | 'keyFill'

/** What the operator preview of the Stream output shows behind the overlays, to check the layering without a mixer. */
export type StreamTestBackground = 'off' | 'checker' | 'webcam'

export type StreamResolution = '1280x720' | '1920x1080' | '2560x1440' | '3840x2160'

/** Which screen the Stream output uses: a window, or fullscreen on one display. */
export type StreamDisplay = 'window' | number

/**
 * What the operator sends to the Stream output, drawn bottom to top: the background, the logo layer, the live slide,
 * the idle design and the lower third. `mode` is already worked out for the stream: 'clear' means the slide layer is
 * empty (always so for an Overlay only output).
 */
export interface StreamState extends Omit<OutputState, 'alert' | 'overlays' | 'screenMargins'> {
  keyMode: StreamKeyMode
  /** The chroma key color; luma keys on black. */
  keyColor: string
  width: number
  height: number
  overlays: OverlayLayers
  /** Fills the output with the key color, a border and corner markers, over everything else. */
  testPattern: boolean
}

// ---------- Themes ----------

/**
 * What a theme is chosen as the default for. 'announcement' is the Presentation type, 'quote' a sermon statement shown
 * as a slide (see AnnouncementPayload.quote), 'lowerThird' the slides the Stream output can show in place of the full
 * theme, and 'logo' what the Logo button shows.
 */
export type ThemeContentType = 'song' | 'scripture' | 'announcement' | 'quote' | 'lowerThird' | 'logo'

/** The groups themes are listed in. Quotes use Presentation themes. */
export type ThemeCategory = 'song' | 'scripture' | 'presentation' | 'lowerThird' | 'logo'

export type TextCase = 'normal' | 'upper' | 'lower'

/** Image and video sources are wd-media:// URLs for files in the app's media folder, usually library items. */
export type ThemeBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  /** `contain` shows the whole image (presentation pages); the default `cover` fills the screen. */
  | { kind: 'image'; src: string; fit?: 'cover' | 'contain' }
  /** A motion loop. */
  | { kind: 'video'; src: string }
  /** Slow drifting smoke over a solid color, drawn on the fly; no media file. */
  | { kind: 'smoke'; color: string; smoke: string }
  /** Pure black. */
  | { kind: 'none' }

/** A box in percent of the screen: x and width of its width, y and height of its height. */
export interface ThemeBox {
  x: number
  y: number
  width: number
  height: number
}

/** How a text, reference or copyright box draws its words. Sizes are percent of screen height; shadow and outline are em. */
export interface ThemeTextProps {
  /** A family name such as "Avenir Next", or a CSS font stack. Empty uses the Default Font from Live Options. */
  fontFamily: string
  fontWeight: number
  italic: boolean
  underline: boolean
  /** auto: as large as fits the box. fixed: `fontSize`, shrunk only when the text would overflow. */
  sizeMode: 'auto' | 'fixed'
  fontSize: number
  /** The largest size auto fit picks; left out, AUTO_FIT_MAX (shared/themes.ts). */
  maxSize?: number
  color: string
  textCase: TextCase
  align: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  lineHeight: number
  shadow: { enabled: boolean; color: string; blur: number; offset: number }
  outline: { enabled: boolean; color: string; width: number }
  /** Space inside the box, in percent of screen height. */
  padding: number
  /** Moves the box up (negative) or down, in percent of screen height: Settings, Scripture display's fine offset. */
  offset?: number
}

/** A run of words with its own look, inside an imported PowerPoint text box. Fields left out use the box's. */
export interface ThemeTextRun {
  text: string
  fontFamily?: string
  /** Percent of screen height. */
  fontSize?: number
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  highlight?: string
  textCase?: TextCase
}

/** A paragraph of an imported PowerPoint text box. */
export interface ThemeTextParagraph {
  runs: ThemeTextRun[]
  align?: 'left' | 'center' | 'right' | 'justify'
  lineHeight?: number
  /** Drawn before the words, such as "•". */
  bullet?: string
}

export type ThemeElementKind = 'text' | 'reference' | 'copyright' | 'image' | 'shape' | 'video'

interface ThemeElementBase {
  /** Elements copied with "Apply to all themes" keep their id, so applying again replaces them. */
  id: string
  box: ThemeBox
  /** Locked elements cannot be selected on the canvas, moved or resized. */
  locked: boolean
}

/**
 * One element of a theme's layout, drawn bottom to top in list order.
 * - text: the slide's words.
 * - reference: the scripture reference, a song's title and author, an announcement's title or a quote's speaker.
 * - copyright: a song's copyright line.
 * - image: a picture, such as a logo; `src` null uses the church logo from Settings.
 * - shape: a solid rectangle, such as a bar behind the text.
 * - video: a looping clip.
 */
export type ThemeElement =
  | (ThemeElementBase & {
      kind: 'text'
      text: ThemeTextProps
      /** Fixed words (an imported PowerPoint text box), shown in place of the slide's text. */
      paragraphs?: ThemeTextParagraph[]
    })
  | (ThemeElementBase & {
      kind: 'reference' | 'copyright'
      text: ThemeTextProps
      /** Drawn just under the main text, following it, instead of in its own box (how themes before the layout editor worked). */
      attached: boolean
      /** An attached line drawn just over the main text instead of under it. */
      above?: boolean
    })
  | (ThemeElementBase & { kind: 'image'; src: string | null; fit: 'contain' | 'cover'; opacity: number })
  | (ThemeElementBase & { kind: 'shape'; color: string; opacity: number })
  /** A video playing looped and muted in its box, such as a clip on an imported PowerPoint slide. */
  | (ThemeElementBase & { kind: 'video'; src: string; fit: 'contain' | 'cover'; opacity: number })

export type ThemeTextElement = Extract<ThemeElement, { text: ThemeTextProps }>

/** A theme: a background and a free layout of elements. Sizes scale with the screen, so it looks the same at any size. */
export interface ThemeStyle {
  category: ThemeCategory
  background: ThemeBackground
  /** Darkens the background: 0 leaves it, 1 makes it black. */
  overlay: number
  /**
   * Transparent for keying: the background is pure black on the projector, for a luma key, and left out on the Stream
   * output so its key color shows through.
   */
  keyTransparent: boolean
  elements: ThemeElement[]
  /**
   * Where the main text box goes for scripture and for songs, in percent of the slide, so the two can differ (a verse
   * has its reference to make room for). Themes saved before this get the main text box's own place for both.
   * Absent on a theme without a main text box; other content uses the box itself.
   */
  textAreas?: ThemeTextAreas
  /**
   * Where a scripture slide's reference goes: inside the text area under the verse, or just below the area. Absent
   * leaves the Reference box as it is (under the text or in its own box).
   */
  referencePlacement?: 'inside' | 'below'
}

/** The content that has a text area of its own (see ThemeStyle.textAreas). */
export type TextAreaContent = 'scripture' | 'song'

export type ThemeTextAreas = Record<TextAreaContent, ThemeBox>

export interface Theme {
  id: number
  name: string
  /** Built-in themes ship with the app and cannot be changed or deleted; save a copy instead. */
  type: 'builtin' | 'custom'
  style: ThemeStyle
}

export type ThemeDefaults = Record<ThemeContentType, number>

/**
 * Quick adjustments to how a verse looks, over its theme: from the Aa popover on the Live and Preview boxes, for one
 * verse or a whole service. Fields left out keep the theme's.
 */
export interface ScriptureAdjust {
  /** A fixed verse size in percent of screen height. */
  fontSize?: number
  /** #rrggbb. */
  color?: string
  /** A family name; empty uses the Default Font. */
  fontFamily?: string
  bold?: boolean
  /** Moves the verse and its reference up (negative) or down, in percent of screen height. */
  offset?: number
}

export interface ThemesApi {
  /** Built-in themes first, then custom ones in the order they were made. */
  list(): Promise<Theme[]>
  create(name: string, style: ThemeStyle): Promise<Theme>
  /** Custom themes only. Resolves to false for a built-in or missing theme. */
  update(id: number, name: string, style: ThemeStyle): Promise<boolean>
  /** Custom themes only. Songs and defaults that used it fall back to the built-in defaults. */
  delete(id: number): Promise<boolean>
  getDefaults(): Promise<ThemeDefaults>
  setDefault(type: ThemeContentType, themeId: number): Promise<void>
}

// ---------- Media library ----------

export interface MediaItem {
  id: number
  name: string
  kind: 'image' | 'video'
  /** wd-media:// URL of the file. */
  url: string
  /** wd-media:// URL of a small JPEG (a poster frame for videos); null until the renderer has made one. */
  thumbUrl: string | null
  tags: string[]
}

export interface MediaApi {
  list(): Promise<MediaItem[]>
  /** Shows a file picker and copies the chosen images and videos into the library. Resolves to the new items. */
  import(): Promise<MediaItem[]>
  update(id: number, name: string, tags: string[]): Promise<boolean>
  /** Deletes the item and its files. Slides and custom themes using it go back to their theme's background. */
  delete(id: number): Promise<boolean>
  /** Stores a JPEG thumbnail the renderer drew for an item. */
  saveThumbnail(id: number, jpeg: Uint8Array): Promise<MediaItem | undefined>
  /** Per-slide background overrides for a deck (see deckKey in the store), by slide index. */
  getSlideBackgrounds(deckKey: string): Promise<Record<number, MediaItem>>
  setSlideBackground(deckKey: string, slideIndex: number, mediaId: number | null): Promise<void>
}

// ---------- Presentations ----------

export type PresentationKind = 'pptx' | 'ppt' | 'pdf' | 'images'

/** Which program draws PowerPoint files: the first available in Auto, or the one chosen in Settings. */
export type PresentationEngineSetting = 'auto' | 'powerpoint' | 'libreoffice'

/** PowerPoint through COM on Windows, through AppleScript on macOS, or LibreOffice headless. */
export type PresentationEngineId = 'powerpoint-windows' | 'powerpoint-mac' | 'libreoffice'

export interface PresentationSlide {
  /** wd-media:// URL of the 1920x1080 PNG. */
  image: string
  /** A small JPEG of the slide for the slide grid; absent for presentations imported before thumbnails existed. */
  thumb?: string
  title: string
  text: string
  notes: string
  /** Has animations or a transition in PowerPoint; shown as a still image unless Live PowerPoint plays it. */
  animated: boolean
  /** The slide rebuilt from the .pptx, for Native mode; absent until the presentation is first switched to it. */
  native?: NativeSlide
}

/**
 * How a presentation shows: Image mode shows each slide as the picture PowerPoint drew (the exact look), Native mode
 * rebuilds the slides from the .pptx as themed slides, with motion backgrounds that keep playing between slides.
 */
export type PresentationMode = 'image' | 'native'

/** A slide of a .pptx rebuilt as a theme. */
export interface NativeSlide {
  /** The slide as a theme; null when it holds something Native mode cannot draw, so its picture shows instead. */
  style: ThemeStyle | null
  /** What could not be drawn, or a video that cannot play, shown on the slide's warning icon. */
  warnings: string[]
  /** Chosen in the compare view: this slide shows its picture even in Native mode. */
  useImage: boolean
}

/** A presentation in the library: rendered slide pictures, linked to the original file. */
export interface Presentation {
  id: number
  title: string
  kind: PresentationKind
  /** The original file, or the folder of images. */
  sourcePath: string
  /** SHA-256 of the original the pictures were made from; the pictures are cached under it. */
  hash: string
  /** What drew the pictures: an engine, or 'pdf' / 'images' for files that need none. */
  engine: PresentationEngineId | 'pdf' | 'images'
  slides: PresentationSlide[]
  /** ISO time of the last render. */
  updatedAt: string
  /** Its animated slides go live through PowerPoint when the Live PowerPoint setting is on (the default). */
  livePowerPoint: boolean
  /** Live PowerPoint follows the slide timings saved in the file; off (the default) advances only by hand. */
  useTimings: boolean
  /** Image mode (the default) or Native mode; only .pptx files can use Native mode. */
  mode: PresentationMode
  /**
   * Linked to the original file: saving it there re-imports the slides, replacing edits made here. Detach stops that,
   * so the native slides can be edited freely.
   */
  linked: boolean
}

/** A conversion in progress, for the progress chip. `key` is the original's path. */
export interface PresentationProgress {
  key: string
  title: string
  message: string
  /** Pages done and the page count, once known. */
  done: number
  total: number
  finished: boolean
  /** Set when the conversion failed, in words for the operator. */
  error?: string
  /** Set when the operator cancelled the import. */
  cancelled?: boolean
  /** Can be cancelled with PresentationsApi.cancel(key): a new import still converting. */
  cancellable?: boolean
  /**
   * A new import's slides so far, in order, so the grid can show them before the import finishes. The pictures fill
   * in as they are drawn: `image` asks for the full picture, which is drawn next when it is not ready yet.
   */
  slides?: { thumb: string; image: string; text: string }[]
}

export interface PresentationEngineStatus {
  setting: PresentationEngineSetting
  /** The engine PowerPoint files would use now, or null with `message` saying what to install. */
  active: PresentationEngineId | null
  powerPoint: boolean
  /** Where soffice is, or null. */
  libreOffice: string | null
  message: string | null
}

export interface PresentationsApi {
  list(): Promise<Presentation[]>
  /** Shows a file picker for .pptx, .ppt, .pdf and images, or a folder picker. Resolves to the chosen paths. */
  pick(kind: 'files' | 'folder'): Promise<string[]>
  /** The path of a dropped file or folder. */
  pathForFile(file: File): string
  /** Imports each file (or image folder) as a presentation; loose images together make one. Progress comes as events. */
  import(paths: string[], mode?: PresentationMode): Promise<Presentation[]>
  /** Switches a .pptx between Image and Native mode, building the native slides the first time. */
  setMode(id: number, mode: PresentationMode): Promise<Presentation>
  /** Shows one slide as its picture in Native mode (the compare view's Use Image mode for this slide), or not. */
  setSlideUseImage(id: number, index: number, useImage: boolean): Promise<Presentation>
  /** Saves an edited native slide. A refresh from a linked original replaces it. */
  updateNativeSlide(id: number, index: number, style: ThemeStyle): Promise<Presentation>
  /** Stops following the original file, so saving it no longer replaces the slides. */
  detach(id: number): Promise<Presentation>
  delete(id: number): Promise<boolean>
  /** Opens the original in its default app (PowerPoint for .pptx); saving there refreshes the slides. */
  openOriginal(id: number): Promise<void>
  engineStatus(): Promise<PresentationEngineStatus>
  /** Converts a small generated presentation with the active engine. Resolves to what it used and how long it took. */
  testConversion(): Promise<{ engine: PresentationEngineId; slides: number; ms: number }>
  /** Stops a new import that is still converting (by PresentationProgress.key); its import call skips it. */
  cancel(key: string): Promise<void>
  onProgress(listener: (progress: PresentationProgress) => void): () => void
  /** A presentation was re-rendered after its original was saved. */
  onUpdated(listener: (presentation: Presentation) => void): () => void
  /** A presentation's original was saved with new content; onUpdated follows once it is re-rendered. */
  onChanged(listener: (presentationId: number) => void): () => void
  /** Changes a presentation's Live PowerPoint options. Resolves to the presentation as stored. */
  setLiveOptions(id: number, options: Partial<Pick<Presentation, 'livePowerPoint' | 'useTimings'>>): Promise<Presentation>
}

// ---------- Live PowerPoint ----------

/**
 * What the operator window wants the slide show to do. The main process makes PowerPoint match it: starts the
 * show, moves to the slide, or covers it with the output window.
 */
export interface PowerPointTarget {
  presentationId: number
  /** Index into the presentation's slides (the shown slides, from 0). */
  slideIndex: number
  /** False while anything else is on the output (Black, Clear, Logo, an alert, a lower third); the show waits under it. */
  visible: boolean
  /** Bumped by Resend, to start the show again from a fresh copy of the original. */
  generation: number
  /**
   * Changes each time the operator sends a slide (Go Live, Go Back). The show moves to `slideIndex` only then;
   * PowerPoint's own moves (next, previous, slide timings) come back in the status and keep the cue.
   */
  cue: number
}

export type LivePowerPointPhase = 'idle' | 'starting' | 'showing' | 'covered' | 'failed'

export interface LivePowerPointStatus {
  phase: LivePowerPointPhase
  presentationId: number | null
  /** The slide PowerPoint is on, as an index into the presentation's slides; null when no show is running. */
  slideIndex: number | null
  /** Build steps played on that slide and how many it has, when the controller can tell. */
  step: number | null
  steps: number | null
  /** What went wrong, for the operator; the output shows the still slide instead. */
  message: string | null
  /** Bumped with each failure, so the operator window falls back once per failure. */
  failures: number
}

export interface LivePowerPointTestStep {
  label: string
  ms: number
  ok: boolean
  detail: string
}

export interface LivePowerPointTestResult {
  ok: boolean
  /** The display the show ran on, such as "Built-in Retina Display, 1680 × 1050 at 0, 0". */
  display: string
  /** The kind of show window used on this platform. */
  mode: string
  steps: LivePowerPointTestStep[]
  totalMs: number
}

export interface LivePowerPointApi {
  /** Opens these presentations in PowerPoint in the background, so going live is quick. */
  prepare(presentationIds: number[]): void
  sync(target: PowerPointTarget | null): void
  /** The next build step or slide of the running show. */
  next(): Promise<void>
  previous(): Promise<void>
  /** Ends the slide show and brings the output back (also Ctrl+Shift+K or Cmd+Shift+K anywhere). */
  panic(): void
  /** Plays a generated animated deck on the output display and reports each step. */
  test(): Promise<LivePowerPointTestResult>
  onStatus(listener: (status: LivePowerPointStatus) => void): () => void
}

/** The hidden window that draws PDF pages and fits images into 1920x1080 slides with pdf.js and a canvas. */
export type RasterJob = { id: number; kind: 'pdf'; data: Uint8Array } | { id: number; kind: 'images'; images: Uint8Array[] }

export interface RasterizerApi {
  onJob(listener: (job: RasterJob) => void): () => void
  /** The main process stopped a job (the import was cancelled). */
  onCancel(listener: (jobId: number) => void): () => void
  /** The main process wants this page's full picture next (it is on screen before the import finished). */
  onWant(listener: (jobId: number, index: number) => void): () => void
  /** Called once the job listener is in place. */
  ready(): void
  /** A page's small JPEG and its text, sent for every page before any full picture. */
  thumb(jobId: number, index: number, total: number, jpeg: Uint8Array, text: string): void
  page(jobId: number, index: number, total: number, png: Uint8Array): void
  done(jobId: number): void
  fail(jobId: number, message: string): void
}

/**
 * Which screen the output window uses: the first non-primary display, a windowed output, a frameless window at
 * `outputBounds` (Custom Position), or one display.
 */
export type OutputDisplay = 'auto' | 'window' | 'custom' | number

/** In percent of the screen: top and bottom of its height, left and right of its width. */
export interface ScreenMargins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface AppSettings {
  /** Saved alert messages, for reuse, in play order. */
  alertMessages: AlertMessage[]
  /** Where the ticker band sits on the output, inside the safe margins. */
  alertPosition: 'top' | 'bottom'
  /** Scroll speed in percent of screen height per second, 3 to 40. */
  alertSpeed: number
  /** Ticker text size in percent of screen height, 2 to 15. */
  alertFontSize: number
  alertTextColor: string
  alertBandColor: string
  /** 0 to 1. */
  alertBandOpacity: number
  /** Band height in percent of screen height, 4 to 25. */
  alertBandHeight: number
  /** Times through the messages before the ticker stops; 0 loops until stopped. */
  alertLoops: number
  alertLayout: AlertLayout
  /** Whether the ticker stays up in Clear mode (Black always hides it). */
  alertKeepOnClear: boolean
  /** Crossfade between slides and backgrounds on the output, 0 to 1500 ms. */
  fadeMs: number
  outputDisplay: OutputDisplay
  /** The output window's position and size in screen points for Custom Position. */
  outputBounds: { left: number; top: number; width: number; height: number }
  /** Margins around everything on the projector, for a screen that cuts off its edges. */
  screenMargins: ScreenMargins
  /** The font for text boxes that have none of their own. */
  defaultFont: string
  /** Shows the Live screen in the operator window; off saves drawing it twice. */
  previewOutput: boolean
  streamDisplay: StreamDisplay
  streamResolution: StreamResolution
  streamKeyMode: StreamKeyMode
  /** The chroma key color, #00ff00 by default. */
  streamKeyColor: string
  /** For Key and Fill: where the key window opens, a window or fullscreen on one display. */
  streamKeyDisplay: StreamDisplay
  /**
   * The Stream output's type. full: every layer, the live slide with its own background. lowerThird: the live slide in
   * the default Lower Third theme. hide (Overlay only): just the idle design, logos and lower third.
   */
  streamSlideContent: 'full' | 'lowerThird' | 'hide'
  /** The logo layer's logos, bottom to top. */
  logoItems: LogoItem[]
  /** The logo layer's Show and Hide toggle. */
  logoLayerVisible: boolean
  /** Also draws the Stream's logo layer on the projector, over the slide. The lower third always shows there. */
  overlaysOnChurchScreen: boolean
  /** The design shown on every output whenever the main content is cleared; null for none. */
  idleDesignId: number | null
  /** The design quick lower thirds use in place of the template; null (or a deleted one) uses the template. */
  lowerThirdDesignId: number | null
  /** The lower third template in use; null (or a deleted one) uses the first built-in template. */
  lowerThirdTemplateId: number | null
  lowerThirdAnimation: LowerThirdAnimation
  /** 200 to 1000 ms. */
  lowerThirdDurationMs: number
  /** Hides the lower third this many seconds after it is shown; 0 (the default) keeps it up until hidden. */
  lowerThirdHoldSeconds: number
  lowerThirdSavedLines: SavedLowerThirdLine[]
  /** The sermon points of each service, by service id ("0" while no service is open), for the Lower thirds workspace. */
  lowerThirdServicePoints: Record<string, SermonPoint[]>
  /**
   * The words on each lower third design's canvas in the Lower thirds workspace, by design id: what the operator typed on
   * it, or a sermon point picked for it. A field left out shows the design's own words. What Preview and Show live send.
   */
  lowerThirdCanvasText: Record<string, LowerThirdCanvasText>
  /** Where Send as lower third (the transcript, the heard cards, the workspace) puts a quote: the Preview, or live. */
  lowerThirdQuickTarget: 'preview' | 'live'
  /** wd-media:// URL of the church logo, shown by Logo theme images without a picture of their own; null for the placeholder. */
  logoUrl: string | null
  /** The church's name, as typed in Settings, Church profile; used in sermon exports. Empty for none. */
  churchName: string
  /** A line at the foot of exported sermon pages, such as an address or website. Empty for none. */
  churchFooter: string
  appearance: 'system' | 'dark' | 'light'
  /** Whether the song editor keeps unsaved edits as drafts. */
  autosaveDrafts: boolean
  /** Folder for automatic database backups, or null for none. */
  backupFolder: string | null
  /** Minutes between automatic backups; 0 turns them off. */
  backupIntervalMinutes: 0 | 10 | 30 | 60
  /** When the last backup finished (ISO time), set by the main process. */
  lastBackupAt: string | null
  /** Turns every AI feature off; when false the main process makes no AI requests at all. */
  aiEnabled: boolean
  aiModel: AiModel
  /** Where AI gets its access: a developer key (developer builds only) or the ServiceEx account. */
  aiKeyProvider: KeyProvider
  /** Cmd+Down stages the next schedule item in the preview; with this on it also goes live, as it used to. */
  autoGoLiveOnNext: boolean
  /** The microphone the sermon listener uses (a MediaDeviceInfo deviceId), or null for the system default. */
  micDeviceId: string | null
  /** The chosen input's name, to find it again when its deviceId changes (another USB port, a restart) and to show it while unplugged. */
  micDeviceName: string | null
  /** Which channel of the input the speech engine hears; a feed from the desk often uses one side of a stereo interface. */
  micChannel: MicChannel
  /** Input gain in dB, -24 to +12. */
  micGainDb: number
  /** An 80 Hz high-pass filter, removing rumble and handling noise below speech. */
  micHighPass: boolean
  /** A gentle noise gate that lowers (not mutes) the signal below the threshold. */
  micNoiseGate: boolean
  /** The gate's threshold in dBFS, -80 to -30. */
  micGateThresholdDb: number
  /** Echo cancellation, noise suppression and automatic gain on the microphone. Off (the default) sends the plain signal. */
  micProcessing: boolean
  /** Writes each finished line of the live transcript to a file; off keeps the transcript in memory only. */
  saveTranscripts: boolean
  /** Auto (cloud, falling back to offline), cloud only (Deepgram), or offline only (whisper.cpp). */
  speechEngine: SpeechEngineId
  /** Where cloud listening gets its access: a developer key (developer builds only) or the ServiceEx account. */
  speechKeyProvider: KeyProvider
  /** The whisper.cpp model the offline engine uses. */
  whisperModel: WhisperModelId
  /** Real time factor measured per model (processing time / audio time; below 1 keeps up). Set by the main process. */
  whisperSpeed: Partial<Record<WhisperModelId, number>>
  /** Suggests verses from the live transcript: references spoken aloud, and quotes. */
  scriptureDetection: boolean
  /** Suggestions less certain than this (0.3 to 0.95) are not shown. */
  detectionMinConfidence: number
  /** How a new suggestion gets attention, besides appearing in the tray. */
  detectionAlert: 'off' | 'sound' | 'flash'
  /** When the parser and quote matcher find nothing in scripture-like talk, asks Claude Haiku for references. Off by default; needs AI on. */
  aiScriptureFallback: boolean
  /** The name under a quote slide unless changed, such as "Pastor Sam"; empty for none. */
  quoteSpeakerName: string
  /** Asks the AI every 30 seconds for quotable statements in the new transcript text. Off by default; needs AI on. */
  statementPicking: boolean
  /** Which program draws PowerPoint files; Auto uses PowerPoint when installed, else LibreOffice. */
  presentationEngine: PresentationEngineSetting
  /** Sends a re-rendered presentation straight to the output when it is live. Off (the default) asks for a resend. */
  presentationAutoRefreshLive: boolean
  /** Plays animated PowerPoint slides with PowerPoint itself, over the output display. Off (the default) shows still images. */
  presentationLivePowerPoint: boolean
  /** The translation a reference opens in when no version is chosen: typed, from the listener, search and the command palette. */
  scriptureDefaultVersion: BibleVersionCode
  /** A service's own default translation, by service id, set in the schedule header; it wins over the default above. */
  scriptureServiceVersions: Record<string, BibleVersionCode>
  /** A version chip on the Live box sends the new translation straight to the output; off stages it in the preview to resend. */
  scriptureSwitchLiveImmediately: boolean
  /** Two translations on one slide: the chosen one, with `second` in a second text box. */
  scriptureDual: DualTranslation
  /** Quick adjustments saved with Apply to this service only, by service id: every verse of that service shows them. */
  scriptureServiceLooks: Record<string, ScriptureAdjust>
  /** Live highlighting: the marks on a live slide come off when another slide goes live. On by default. */
  highlightClearOnSlideChange: boolean
  /** Live highlighting: marks stay with their schedule item while the app is open, and come back when it is loaded again. Off by default. */
  highlightKeepWithItem: boolean
  /** The brush live highlighting starts with. */
  highlightDefault: HighlightStyle
  /** Local network sharing with other ServiceEx computers (see SharingApi). Off by default. */
  sharingEnabled: boolean
  /** The name other computers see; empty uses the computer's own name. */
  sharingDeviceName: string
  /** The largest file another computer may send, in MB (2048 by default). */
  sharingMaxSizeMb: number
  /** Saves items from trusted paired devices straight into the library. Never touches the output. */
  sharingAutoAccept: boolean
  /** Named sets of panels (see shared/layouts.ts). */
  layouts: Layout[]
  /** The layout this computer shows. */
  activeLayoutId: string
  /** Device chips in the toolbar with what each paired computer has live. On by default. */
  sharingDeviceChips: boolean
  /** How an arriving cue gets attention, besides appearing in the tray. Off by default. */
  sharingCueAlert: 'off' | 'sound' | 'flash'
  /** Copies songs, themes, fonts, media and presentations between paired computers. Off by default. */
  sharingLibrarySync: boolean
  /** The most library sync may use, in KB per second; 0 for no limit. */
  sharingBandwidthKbps: number
  /** Sends one anonymous install report at first launch (see electron/service/installReport). On by default. */
  shareInstallCount: boolean
}

/** The highlighter colors live highlighting offers, in the order the number keys 1 to 5 pick them. */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'orange'

/** What clicking a word does in highlight mode: a highlighter behind it, bold, underline, or its words in a color. */
export type HighlightKind = 'highlight' | 'bold' | 'underline' | 'color'

export interface HighlightStyle {
  kind: HighlightKind
  color: HighlightColor
}

/** How a second translation sits on a slide whose theme has one text box; a theme with two text boxes uses its own layout. */
export type DualLayout = 'stacked' | 'sideBySide'

export interface DualTranslation {
  enabled: boolean
  second: BibleVersionCode
  layout: DualLayout
}

export interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  /** Device pixels per point, so width × scaleFactor is the display's width in pixels. */
  scaleFactor: number
  primary: boolean
}

export interface SettingsApi {
  get(): Promise<AppSettings>
  /** lastBackupAt is ignored; the main process sets it. */
  set(settings: Partial<AppSettings>): Promise<AppSettings>
  listDisplays(): Promise<DisplayInfo[]>
  /** Picks a folder for backups and saves it. Resolves to the new settings, or null if cancelled. */
  pickBackupFolder(): Promise<AppSettings | null>
  /** Picks a logo image, copies it into the media folder and saves it. Resolves to the new settings, or null if cancelled. */
  pickLogo(): Promise<AppSettings | null>
  /** Backs up the database into the backup folder now. Resolves to the file written. */
  backupNow(): Promise<string>
}

/** What the stage display shows the worship leader. */
export interface StageState {
  /** The live slide, or null when nothing is live. */
  current: SlideContent | null
  /** The slide after it in the grid. */
  next: SlideContent | null
  /** What is loaded: a song title, a scripture reference. */
  title: string | null
  /** The schedule item after the loaded one, for "coming up". */
  nextItemTitle: string | null
  mode: OutputMode
  /** The alert the audience sees, if any. */
  alert: AlertDisplay | null
}

export interface StageApi {
  open(): Promise<void>
  close(): Promise<void>
  isOpen(): Promise<boolean>
  /** Called when the stage window opens or closes, including by its own close button. */
  onOpenChange(listener: (open: boolean) => void): () => void
  send(state: StageState): void
  onState(listener: (state: StageState) => void): () => void
}

/** The editable fields of a song, used when creating or updating one. */
export type SongInput = Omit<Song, 'id'>

export interface SongsApi {
  /** Lists songs, optionally filtered by title, author or lyrics. */
  list(search?: string): Promise<SongSummary[]>
  get(id: number): Promise<Song | undefined>
  /** Creates a song and splits its lyrics into slides (see shared/lyrics.ts). */
  create(input: SongInput): Promise<Song>
  /** Updates a song and rebuilds its slides. Resolves to false if the song does not exist. */
  update(id: number, input: SongInput): Promise<boolean>
  /** Resolves to false if the song does not exist. */
  delete(id: number): Promise<boolean>
}

/**
 * A Bible version's short code, such as "KJV". The public domain KJV and WEB ship with the app; others are imported
 * from the church's own files (see BibleApi.importVersion).
 */
export type BibleVersionCode = string

/** The versions that ship with the app; they cannot be removed. */
export const BUNDLED_BIBLE_VERSIONS: readonly BibleVersionCode[] = ['KJV', 'WEB']

export interface BibleVersion {
  code: BibleVersionCode
  name: string
  verses: number
  /** Shipped with the app (KJV, WEB), so it cannot be removed. */
  bundled: boolean
}

export interface BibleImportResult {
  code: BibleVersionCode
  name: string
  /** Verses stored. */
  verses: number
  /** Books in the files that are not among the 66 the app knows, such as the Apocrypha; they are left out. */
  skippedBooks: string[]
}

export interface Verse {
  /** Full book name, such as "1 Corinthians". */
  book: string
  chapter: number
  verse: number
  text: string
}

export type Testament = 'all' | 'old' | 'new'

export interface VerseSearchParams {
  /**
   * What was typed. Words must all appear; the last one also matches as a prefix while it is being typed
   * ("fear of the lo"). Wrap it in double quotes to search for the exact phrase.
   */
  query: string
  versions: BibleVersionCode[]
  testament: Testament
  /** Only this book, or null for any. */
  book: string | null
  offset: number
  limit: number
}

export interface VerseHit extends Verse {
  /** The verse row id, unique across versions. */
  id: number
  version: BibleVersionCode
  /** The verse text split into the words that matched and the rest, for highlighting. */
  segments: { text: string; match: boolean }[]
}

export interface VerseSearchResult {
  total: number
  hits: VerseHit[]
}

export interface BibleApi {
  getVerse(version: BibleVersionCode, book: string, chapter: number, verse: number): Promise<Verse | undefined>
  /** Verses `verseStart` to `verseEnd` inclusive, in order. */
  getRange(
    version: BibleVersionCode,
    book: string,
    chapter: number,
    verseStart: number,
    verseEnd: number,
  ): Promise<Verse[]>
  /** Verses whose text contains `query`, in Bible order, capped at 100. */
  searchText(version: BibleVersionCode, query: string): Promise<Verse[]>
  /** Book names in Bible order. Empty until the Bible data is imported. */
  listBooks(): Promise<string[]>
  /** Installed versions, the bundled ones first. */
  listVersions(): Promise<BibleVersion[]>
  /**
   * Shows a file picker for Zefania XML, OSIS XML or USFM files (one file per book is fine) and stores them as
   * `code`, replacing an imported version with that code. Resolves to null if cancelled. The church is responsible
   * for holding a license for any version it imports.
   */
  importVersion(code: BibleVersionCode, name: string): Promise<BibleImportResult | null>
  /** Removes an imported version. Resolves to false for a bundled or unknown version. */
  removeVersion(code: BibleVersionCode): Promise<boolean>
  /** Full-text search over the local Bible (SQLite FTS5), ranked by relevance. */
  search(params: VerseSearchParams): Promise<VerseSearchResult>
  /** Verses per chapter for a book, from the KJV: [31, 25, …] means chapter 1 has 31 verses. Empty if unknown. */
  bookStructure(book: string): Promise<number[]>
  /**
   * The verses a piece of transcript (its last 8 to 25 words) may quote, strongest first, at most three; empty when
   * nothing matches strongly. Both versions are searched.
   */
  matchQuote(text: string): Promise<QuoteMatch[]>
}

/** A verse the speaker seems to have quoted without naming it. */
export interface QuoteMatch {
  book: string
  chapter: number
  verse: number
  /** The version whose wording matched best. */
  version: BibleVersionCode
  /** Verse words said in order. */
  matched: number
  coverage: number
  confidence: number
  /** The verse in the version that matched, split so the matched words can be highlighted. */
  highlight: { text: string; match: boolean }[]
}

export interface ServicesApi {
  /** `date` is YYYY-MM-DD or null. */
  create(name: string, date: string | null): Promise<Service>
  /** Newest date first; undated services last. */
  list(): Promise<Service[]>
  get(id: number): Promise<ServiceWithItems | undefined>
  /** Deletes the service and its items. Resolves to false if it does not exist. */
  delete(id: number): Promise<boolean>
  /** Appends an item. Songs pass a song id and a null payload; scripture and announcements pass a null refId. */
  addItem(
    serviceId: number,
    type: ServiceItemType,
    refId: number | null,
    payload: ServiceItemPayload | null,
  ): Promise<ServiceItem>
  removeItem(itemId: number): Promise<boolean>
  /** Replaces a scripture or announcement item's payload, as after formatting its slides. Resolves to false if not found. */
  updatePayload(itemId: number, payload: ScripturePayload | AnnouncementPayload): Promise<boolean>
  /** Resolves to false unless `orderedItemIds` lists each of the service's items exactly once. */
  reorderItems(serviceId: number, orderedItemIds: number[]): Promise<boolean>
}

export type SongFileFormat = 'text' | 'openlyrics' | 'opensong'

/** A song read from a file, waiting in the import preview. */
export interface ImportedSong {
  /** The file it came from, such as "Hymns/Amazing Grace.xml". */
  source: string
  format: SongFileFormat
  song: SongInput
  /** Set when the title matches a library song, or an earlier song in the same import. */
  duplicateOf: 'library' | 'import' | null
}

export interface ImportScan {
  songs: ImportedSong[]
  /** Files that were not songs or could not be read. */
  problems: { source: string; error: string }[]
}

export type ExportFormat = 'openlyrics' | 'text'

export interface ExportResult {
  written: number
  /** The file written, or the folder for several songs. */
  location: string
}

export interface SongFilesApi {
  /** Shows a file picker and reads the chosen files. Resolves to null if cancelled. */
  pickFiles(): Promise<ImportScan | null>
  /** Shows a folder picker and reads the song files in it. Resolves to null if cancelled. */
  pickFolder(): Promise<ImportScan | null>
  /** The path of a file or folder dropped on the window. */
  pathForFile(file: File): string
  /** Reads song files and folders by path. */
  scan(paths: string[]): Promise<ImportScan>
  /** Adds the songs in one transaction. Resolves to the number added. */
  import(songs: SongInput[]): Promise<number>
  /** Asks where to save, then writes the songs (null means every song). Resolves to null if cancelled. */
  export(songIds: number[] | null, format: ExportFormat): Promise<ExportResult | null>
}

export interface StreamApi {
  /** Sends the operator's stream state to the Stream output window. */
  send(state: StreamState): void
  onState(listener: (state: StreamState) => void): () => void
  /** Opens the Stream output window, or closes it. */
  setOpen(open: boolean): Promise<void>
  isOpen(): Promise<boolean>
  /** Called when the Stream window opens or closes, including by its own close button. */
  onOpenChange(listener: (open: boolean) => void): () => void
  /** Picks an image and copies it into the app data folder. Resolves to its URL and file name, or null if cancelled. */
  pickLogo(): Promise<{ url: string; name: string } | null>
}

// ---------- Sharing ----------

/** What a received file is, from its extension (see shared/sharing.ts). */
export type ShareKind = 'package' | 'presentation' | 'image' | 'video' | 'audio' | 'text' | 'openlyrics'

/** Another ServiceEx computer on the local network, seen through mDNS or remembered from pairing. */
export interface SharePeer {
  id: string
  name: string
  /** Seen on the network just now. */
  online: boolean
  paired: boolean
  /** Paired and marked trusted, so Auto accept applies to it. */
  trusted: boolean
  /** Paired but disconnected in Settings. */
  disconnected: boolean
  /** The title of what it has live (title only), from its last presence message; null for nothing or unknown. */
  liveTitle: string | null
  /** The shared service it hosts, which this computer can join. */
  hosting: { id: string; name: string } | null
}

export interface PairedDevice {
  id: string
  /** The name the device gives itself. */
  name: string
  /** The name this computer calls it, set in Settings; empty for its own. */
  alias: string
  trusted: boolean
  /** Still paired, but nothing is exchanged with it until it is connected again. */
  disconnected: boolean
  /** ISO time. */
  pairedAt: string
}

/** Something that can be sent to another computer. */
export type ShareSource =
  | { type: 'song'; id: number }
  | { type: 'service'; id: number }
  | { type: 'theme'; id: number }
  | { type: 'media'; id: number }
  | { type: 'presentation'; id: number }
  | { type: 'announcement'; itemId: number }
  /** A file dropped from outside the app, by absolute path. */
  | { type: 'file'; path: string }

/** A received item waiting in the Inbox. It never goes live by itself. */
export interface InboxItem {
  id: string
  senderId: string
  senderName: string
  name: string
  size: number
  kind: ShareKind
  /** ISO time. */
  receivedAt: string
}

export type ConflictChoice = 'replace' | 'keepBoth' | 'skip'

/** Something in a received item with the same name as something already here. */
export interface InboxConflict {
  /** Pass a choice for it under this key. */
  key: string
  what: 'song' | 'theme' | 'media' | 'presentation' | 'service' | 'file'
  name: string
}

export type AcceptResult =
  | { status: 'conflicts'; conflicts: InboxConflict[] }
  | {
      status: 'done'
      message: string
      /**
       * Presentation files saved for the renderer to import into the Presentations library, each replacing the
       * library presentation `replaceId` when the operator chose Replace.
       */
      presentations: { path: string; replaceId: number | null }[]
      /** A service that was added, for the schedule list. */
      serviceId: number | null
      /** What changed, so the views can reload. */
      changed: ('songs' | 'themes' | 'media' | 'services' | 'schedule')[]
    }

/** What is inside a received item, without accepting it. Nothing in it is run or opened by another program. */
export interface InboxPreview {
  kind: ShareKind
  /** wd-media://inbox/<id> for images, videos and audio. */
  url?: string
  /** The start of a text or OpenLyrics file, or the slide titles of a PowerPoint file. */
  text?: string
  /** For a .serviceex package. */
  contents?: {
    service: { name: string; date: string | null; items: string[] } | null
    songs: string[]
    themes: string[]
    media: string[]
    presentations: string[]
    announcements: string[]
  }
}

export interface TransferProgress {
  id: string
  peerId: string
  peerName: string
  name: string
  sent: number
  size: number
  /** Preparing covers waiting in the queue; cancelled and declined ones never go on. */
  state: 'preparing' | 'sending' | 'retrying' | 'done' | 'failed' | 'cancelled' | 'declined'
  error?: string
}

/** A file arriving from a paired device, for the incoming chip on the receiving computer. */
export interface IncomingTransfer {
  /** The sender's device id and its transfer id, joined by a dash. */
  id: string
  senderId: string
  senderName: string
  name: string
  size: number
  received: number
  /** Stalled: nothing arrived for a while; it carries on if the sender sends again. */
  state: 'receiving' | 'stalled' | 'done' | 'cancelled' | 'declined' | 'failed'
}

/** The receiving side of pairing: show this code until the other computer has typed it. */
export interface PairRequest {
  pairingId: string
  deviceName: string
  code: string
}

export interface SharingStatus {
  enabled: boolean
  deviceId: string
  deviceName: string
  /** The port it listens on, or null while off. */
  port: number | null
  /** This computer's local network addresses. */
  addresses: string[]
  /** Why sharing could not start, if it could not. */
  error: string | null
  /** Windows only: the networks this computer is on that Windows treats as Public, where it blocks other computers. */
  publicNetworks: string[]
  /** Windows only: the command an administrator can run to let other computers reach this one on Private networks. */
  firewallCommand: string | null
}

export type SharingEvent =
  | { type: 'peers'; peers: SharePeer[] }
  | { type: 'inbox'; items: InboxItem[]; arrived: InboxItem | null }
  | { type: 'progress'; transfer: TransferProgress }
  /** A file arriving here, and how far it has got. */
  | { type: 'incoming'; transfer: IncomingTransfer }
  | { type: 'pairRequest'; request: PairRequest }
  | { type: 'pairEnded'; pairingId: string; paired: boolean }
  | { type: 'status'; status: SharingStatus }
  /** Auto accept saved an item from a trusted device; the views reload and its presentations are imported. */
  | { type: 'accepted'; item: InboxItem; result: Extract<AcceptResult, { status: 'done' }> }
  | { type: 'cues'; cues: Cue[]; arrived: Cue | null }
  | { type: 'sharedService'; state: SharedServiceState }
  | { type: 'library'; status: LibrarySyncStatus }
  /** Library sync saved presentation files for the renderer to import, and changed these views. */
  | { type: 'librarySaved'; presentations: string[]; changed: ('songs' | 'themes' | 'media' | 'fonts')[] }

export interface SharingApi {
  status(): Promise<SharingStatus>
  /** Devices seen on the network and paired ones, paired first. */
  peers(): Promise<SharePeer[]>
  paired(): Promise<PairedDevice[]>
  setTrusted(id: string, trusted: boolean): Promise<PairedDevice[]>
  /** Removes the device and its key; it must pair again to send anything. */
  forget(id: string): Promise<PairedDevice[]>
  /** Asks the other computer to show a 6 digit code. Resolves to the pairing to finish with that code. */
  startPairing(peerId: string): Promise<{ pairingId: string }>
  /** Checks the typed code with the other computer and stores the shared key on both. */
  finishPairing(pairingId: string, code: string): Promise<PairedDevice>
  /**
   * Asks the computer at a typed address who it is, then to show a code, as startPairing does for a device found on
   * the network. Rejects addresses outside the local network.
   */
  pairByAddress(host: string, port: string): Promise<{ pairingId: string; peerId: string; name: string }>
  /** The receiving side closes its code without pairing. */
  dismissPairing(pairingId: string): Promise<void>
  /** Reaches a paired device over the encrypted channel. Resolves with the round trip time, or what went wrong. */
  testConnection(peerId: string): Promise<{ ok: boolean; ms?: number; error?: string }>
  /** Sends each item to a paired device; progress comes as events. Rejects files of types that cannot be sent. */
  send(peerId: string, sources: ShareSource[]): Promise<void>
  /** Sends a failed transfer again, carrying on from what the other computer already has. */
  retry(transferId: string): Promise<void>
  /**
   * Stops a transfer: a queued one never starts, a running one stops and the other computer deletes what arrived, and
   * a finished or failed one is cleared along with any package written for it.
   */
  cancel(transferId: string): Promise<void>
  /** Refuses a file arriving here: the sender stops, and what arrived is deleted. */
  decline(incomingId: string): Promise<void>
  /** The path of a file dropped on a device chip. */
  pathForFile(file: File): string
  inbox(): Promise<InboxItem[]>
  preview(id: string): Promise<InboxPreview>
  /** Copies the item into the library, media or the given schedule. With conflicts and no choices, resolves to them. */
  accept(id: string, options: { serviceId: number | null; choices?: Record<string, ConflictChoice> }): Promise<AcceptResult>
  reject(id: string): Promise<InboxItem[]>
  /** Asks where to save, then writes the service as one .serviceex file. Resolves to the file, or null if cancelled. */
  exportPackage(serviceId: number): Promise<string | null>
  /** Picks a .serviceex file (from a USB drive, say) and puts it in the Inbox. Resolves to the item, or null if cancelled. */
  importPackage(): Promise<InboxItem | null>
  onEvent(listener: (event: SharingEvent) => void): () => void
  /** The name this computer shows for a paired device; empty goes back to the device's own name. */
  setAlias(id: string, alias: string): Promise<PairedDevice[]>
  /** Stops (or starts again) everything with a paired device without forgetting the pairing. */
  setDisconnected(id: string, disconnected: boolean): Promise<PairedDevice[]>
  /** Runs one shared service and presence round trip with a paired device, as a sync would. */
  testSync(peerId: string): Promise<{ ok: boolean; ms?: number; error?: string }>
  /** What this computer has live, title only, for the other computers' device chips; and whether a slide is live. */
  setLive(info: { title: string | null; slideLive: boolean }): void
  /** Sends a cue to a paired device. It waits in that computer's tray and never goes live by itself. */
  sendCue(peerId: string, cue: CueDraft): Promise<void>
  cues(): Promise<Cue[]>
  dismissCue(id: string): Promise<Cue[]>
  sharedService(): Promise<SharedServiceState>
  /** Hosts a shared service starting with these items; other paired computers can join it. */
  hostService(name: string, items: SharedItemInput[]): Promise<SharedServiceState>
  joinService(peerId: string): Promise<SharedServiceState>
  /** Leaves (or, as host, stops) the shared service. This computer keeps nothing of it but its own copy on disk. */
  leaveService(): Promise<SharedServiceState>
  addSharedItems(items: SharedItemInput[]): Promise<SharedServiceState>
  updateSharedItem(id: string, patch: SharedItemPatch): Promise<SharedServiceState>
  librarySync(): Promise<LibrarySyncStatus>
  /** Compares libraries with every online paired device now and fetches what is missing here. */
  syncLibraryNow(): Promise<LibrarySyncStatus>
}

// ---------- Layouts ----------

/** A panel a layout can show or hide. The library tabs are panels of their own. */
export type LayoutPanel = 'songs' | 'scripture' | 'presentations' | 'media' | 'slides' | 'live' | 'points' | 'listener' | 'schedule'

export interface Layout {
  /** Lower case letters, digits and dashes. */
  id: string
  name: string
  panels: LayoutPanel[]
  /** What the shared service list starts on: every item, or only this computer's. */
  itemFilter: 'all' | 'mine'
  /** Theme defaults set when switching to this layout; types left out keep theirs. */
  themeDefaults: Partial<ThemeDefaults>
  /** The output when nothing is live, set when switching to this layout; null leaves it. */
  outputBackground: 'black' | 'logo' | null
}

// ---------- Shared service ----------

export type SharedItemType = ServiceItemType | 'note'

/** A song in a shared service carries its words, so every computer can show it whatever its library holds. */
export interface SharedSongPayload {
  title: string
  author: string | null
  copyright: string | null
  lyrics: string
  arrangement: SongArrangement
}

export interface SharedNotePayload {
  title: string
  text: string
}

export type SharedPayload = SharedSongPayload | ScripturePayload | AnnouncementPayload | PresentationPayload | SharedNotePayload

export interface SharedItem {
  /** 32 hex characters. */
  id: string
  type: SharedItemType
  payload: SharedPayload
  /** Run order: items sort by it. Moving an item gives it a number between its new neighbours. */
  order: number
  /** Logical clock of the last change (see shared/sharedService.ts). */
  updatedAt: number
  /** The device that made the last change. */
  updatedBy: string
  /** The device this item belongs to, for filtering; null for nobody in particular. */
  ownerDevice: string | null
  /** Removed: kept so the removal reaches every computer. */
  deleted: boolean
}

export interface SharedItemInput {
  type: SharedItemType
  payload: SharedPayload
  ownerDevice?: string | null
}

export type SharedItemPatch = Partial<Pick<SharedItem, 'order' | 'ownerDevice' | 'deleted' | 'payload'>>

export type ItemFilter = { kind: 'all' } | { kind: 'mine' } | { kind: 'device'; deviceId: string }

export interface SharedServiceState {
  role: 'none' | 'host' | 'member'
  id: string | null
  name: string
  hostId: string | null
  hostName: string
  items: SharedItem[]
  /** Device names by id, for "changed by" and the owner tags. */
  names: Record<string, string>
  /** A member reached the host on its last try. Always true for the host. */
  connected: boolean
  /** Changes made here the host has not confirmed yet. */
  pending: number
  /** ISO time of the last successful sync. */
  lastSyncAt: string | null
  error: string | null
}

// ---------- Cues ----------

export type CueKind = 'verse' | 'song' | 'point' | 'note' | 'text'

export interface CueDraft {
  kind: CueKind
  title: string
  /** Exactly as written. */
  text: string
  /** A verse: its slides, as the scripture panel made them. */
  verses?: { text: string; caption: string }[]
  /** A song: its words, so it can be previewed where the library does not have it. */
  song?: SharedSongPayload
}

export interface Cue extends CueDraft {
  id: string
  fromId: string
  fromName: string
  /** ISO time. */
  receivedAt: string
}

// ---------- Library sync ----------

export type LibraryKind = 'song' | 'theme' | 'font' | 'media' | 'presentation'

export interface LibrarySyncFile {
  /** The content hash: the same content is fetched once, whatever it is called. */
  sha256: string
  kind: LibraryKind
  name: string
  peerId: string
  peerName: string
  size: number
  received: number
  state: 'waiting' | 'transferring' | 'done' | 'failed'
  error?: string
}

export interface LibrarySyncStatus {
  enabled: boolean
  running: boolean
  /** Why large transfers are waiting, such as a slide being live; null when they are not. */
  paused: string | null
  files: LibrarySyncFile[]
  /** ISO time. */
  lastRunAt: string | null
  error: string | null
}

/** The API the preload script exposes to the renderer as `window.api`. */
// ---------- Fonts ----------

/** A font file imported into the app data fonts folder. */
export interface ImportedFont {
  /** File name in the fonts folder. */
  file: string
  /** The family name inside the file, which themes refer to. */
  family: string
  /** A CSS font-weight: one weight, or a range for a variable font. */
  weight: string
  italic: boolean
  /** wd-media://font/<file>, for loading it in any window. */
  url: string
}

/** A font file that could not be imported, and why, in plain words to follow its name. */
export interface SkippedFont {
  file: string
  reason: string
}

export interface FontsApi {
  /** Imported fonts, by family. */
  list(): Promise<ImportedFont[]>
  /** Picks .ttf, .otf, .woff and .woff2 files and copies them in. Skipped lists files it could not read, with why. */
  import(): Promise<{ fonts: ImportedFont[]; skipped: SkippedFont[] }>
  /** The same for files dropped on the app, as File objects. */
  importFiles(files: File[]): Promise<{ fonts: ImportedFont[]; skipped: SkippedFont[] }>
  /** Removes imported font files, by file name. */
  remove(files: string[]): Promise<void>
  /** Called in every window when fonts are imported or removed. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

export interface ServiceExApi {
  songs: SongsApi
  bible: BibleApi
  services: ServicesApi
  songFiles: SongFilesApi
  themes: ThemesApi
  media: MediaApi
  settings: SettingsApi
  stage: StageApi
  ai: AiApi
  speech: SpeechApi
  stream: StreamApi
  lowerThirds: LowerThirdsApi
  designs: DesignsApi
  presentations: PresentationsApi
  livePowerPoint: LivePowerPointApi
  rasterizer: RasterizerApi
  log: LogApi
  fonts: FontsApi
  sharing: SharingApi
  license: LicenseApi
  account: AccountApi
  sermons: SermonsApi
  /** Cmd+H on macOS, caught by the main process before the app menu hides the app, to toggle highlight mode. */
  onToggleHighlight(listener: () => void): () => void
  /** Cmd+Plus and Cmd+Minus (Ctrl+Plus and Minus), caught by the main process before they zoom the window: +1 or -1. */
  onScriptureSize(listener: (step: 1 | -1) => void): () => void
  output: {
    /** Sends the operator's output state to the output window. */
    send(state: OutputState): void
    /** Subscribe to output state changes. Returns an unsubscribe function. */
    onState(listener: (state: OutputState) => void): () => void
    /** Opens the projector output window, or closes it. */
    setOpen(open: boolean): Promise<void>
    isOpen(): Promise<boolean>
    /** Called when the output window opens or closes, including by its own close button. */
    onOpenChange(listener: (open: boolean) => void): () => void
  }
}

/** A panel that threw while rendering, as its error boundary caught it. */
export interface PanelErrorReport {
  panel: string
  message: string
  stack: string
  componentStack: string
}

/** What a diagnostics report says about this copy of ServiceEx and the computer it runs on. */
export interface AppInfo {
  version: string
  platform: string
  arch: string
  osVersion: string
  electron: string
  chrome: string
  locale: string
  packaged: boolean
}

export interface LogApi {
  /** Appends the report to logs/panel-errors.log in the app data folder. */
  panelError(report: PanelErrorReport): Promise<void>
  appInfo(): Promise<AppInfo>
}

// ---------- Sermons ----------

export type SermonStatus = 'recording' | 'saved'

/** A sermon in the list: no transcript. */
export interface SermonSummary {
  id: number
  /** Empty for an untitled sermon. */
  title: string
  preacher: string
  /** ISO date, YYYY-MM-DD. */
  date: string
  series: string
  status: SermonStatus
  createdAt: string
  updatedAt: string
}

/** One final line of the transcript; `startMs` counts from when recording started. */
export interface SermonSegment {
  id: number
  startMs: number
  text: string
  isFinal: boolean
}

export interface SermonScripture {
  id: number
  /** Such as "John 3:16-18". */
  reference: string
  atMs: number
  /** Heard by the listener, or added by hand. */
  source: 'detected' | 'manual'
}

export interface SermonStatement {
  id: number
  text: string
  atMs: number
  pinned: boolean
}

export interface Sermon extends SermonSummary {
  /** The church name when the sermon was recorded, so later exports keep it if Settings change. */
  churchName: string
  notes: string
  /** AI summary; empty until notes are generated. */
  summary: string
  /** AI key points; empty until notes are generated. */
  keyPoints: string[]
  /** The AI's cleaned transcript, paragraphs separated by blank lines; empty until cleaned. The raw one is kept. */
  cleanedTranscript: string
  segments: SermonSegment[]
  scriptures: SermonScripture[]
  statements: SermonStatement[]
}

/** What the start dialog asks for; everything is optional. */
export interface SermonInput {
  title?: string
  preacher?: string
  date?: string
  series?: string
}

/** Fields the detail view edits. */
export interface SermonPatch {
  title?: string
  preacher?: string
  date?: string
  series?: string
  notes?: string
  keyPoints?: string[]
  summary?: string
}

/** What an export includes. */
export interface SermonExportOptions {
  /** The summary and key points. */
  summary: boolean
  scriptures: boolean
  transcript: boolean
  /** Uses the cleaned transcript, when there is one, in place of the raw one. */
  cleaned: boolean
}

/** A saved file, or null when the save dialog was cancelled. */
export type SermonExportResult = { ok: true; path: string | null } | { ok: false; error: string }

export interface SermonsApi {
  /** Newest date first. */
  list(): Promise<SermonSummary[]>
  /** Matches the title, the preacher and the transcript. */
  search(query: string): Promise<SermonSummary[]>
  get(id: number): Promise<Sermon | null>
  /** A new sermon in the 'recording' state, dated today unless a date is given, with the church name from Settings. */
  create(input: SermonInput): Promise<Sermon>
  update(id: number, patch: SermonPatch): Promise<Sermon | null>
  delete(id: number): Promise<void>
  /** Past preachers, most recent first, for the start dialog. */
  preachers(): Promise<string[]>
  /** Adds a final transcript line to a sermon (the listener saves its own lines in the main process). */
  appendSegment(id: number, text: string): Promise<void>
  /** A reference heard by the listener or added by hand; one heard again is not added twice. */
  addScripture(id: number, reference: string, source: SermonScripture['source']): Promise<void>
  removeScripture(id: number, scriptureId: number): Promise<void>
  /** A statement shown or pinned while listening; pinning one already saved marks it pinned. */
  addStatement(id: number, text: string, pinned: boolean): Promise<void>
  setStatementPinned(id: number, statementId: number, pinned: boolean): Promise<void>
  removeStatement(id: number, statementId: number): Promise<void>
  /** Marks a recording saved; an untitled sermon with nothing in it is removed. */
  finish(id: number): Promise<void>
  exportText(id: number, format: 'txt' | 'md', options: SermonExportOptions): Promise<SermonExportResult>
  exportPdf(id: number, options: SermonExportOptions): Promise<SermonExportResult>
  /**
   * The sermon's slides as one announcement, for the schedule: its title slide, then scripture, pinned statements, key
   * points and a closing slide (see sermonDeck in shared/sermons).
   */
  exportSlides(id: number): Promise<AnnouncementPayload>
  /** The same slides as a PowerPoint file, through a save dialog, with the church logo on the title slide. */
  exportPptx(id: number): Promise<SermonExportResult>
  /** Whether the AI buttons can work: AI on and a key (or service) available. */
  aiAvailable(): Promise<boolean>
  /** Cleans the transcript a part at a time (about 1,500 words each), sending progress to onAiProgress. */
  cleanTranscript(id: number): Promise<AiResult<SermonAiOutcome>>
  /** Summary and key points; a long sermon is summarised a part at a time first. */
  generateNotes(id: number): Promise<AiResult<SermonAiOutcome>>
  /** Stops the running clean or notes job for a sermon after the part being worked on; what is done is kept. */
  cancelAi(id: number): Promise<void>
  /** Progress of cleanTranscript and generateNotes. Returns a function that stops listening. */
  onAiProgress(listener: (progress: SermonAiProgress) => void): () => void
}

/** Where a sermon AI job is: cleaning part `done` of `total`, summarising a part, or writing the final notes. */
export interface SermonAiProgress {
  sermonId: number
  step: 'clean' | 'summarise' | 'notes'
  done: number
  total: number
}

export interface SermonAiOutcome {
  sermon: Sermon
  /** Parts finished, of all parts. */
  done: number
  total: number
  /**
   * Parts (numbered from 1) the AI could not do after every try. Cleaning keeps their words as spoken; notes leave
   * them out of the summary.
   */
  failedParts: number[]
  /** Stopped by Cancel; finished parts are kept. */
  cancelled: boolean
  /** Why the last failed part failed, when one did. */
  error: AiError | null
  /** The words the checks flagged in each failed part, for developer mode. */
  flagged: { part: number; words: string[] }[]
}

// ---------- Plan ----------

export type { KeyProvider } from './features'

export interface LicenseApi {
  /** The licence as checked at startup, which decides this run's features. The licence as it is now is in the account state. */
  status(): Promise<LicenseStatus>
  /** What this run of the app allows, asked synchronously as the operator window starts; null if it cannot be asked. */
  entitlements(): Entitlements | null
}

// ---------- AI ----------

/** Sonnet 5.5 by default; Haiku 5.5 is faster and cheaper. */
export type AiModel = 'claude-sonnet-5-5' | 'claude-haiku-5-5'

/**
 * Every AI task, with the input the renderer sends and the output it gets back. The main process holds the
 * prompts; the renderer only names a task and passes its input.
 */
export interface AiTasks {
  /**
   * Cleans pasted lyrics: [Section] labels, repeated sections written once with a play order, junk removed,
   * lines split into slides. The main process rejects any answer that changes the words.
   */
  cleanLyrics: { input: { lyrics: string }; output: { lyrics: string; order: string[] } }
  /**
   * Finds passages by meaning ("verses about fear"). References only, such as "John 3:16-18": the app reads the
   * verse text from its own Bible database. Each one is checked to exist there; at most 8 come back.
   */
  suggestScripture: { input: { topic: string }; output: { references: string[] } }
  /**
   * Reads a sermon outline: a title, short key points, and every scripture reference it mentions, checked to
   * exist in the Bible database. No verse text.
   */
  sermonToSlides: {
    input: { outline: string }
    output: { title: string; points: string[]; references: string[] }
  }
  /** Turns a long message into a title and short slides, one idea each. */
  buildAnnouncement: { input: { message: string }; output: { title: string; slides: string[] } }
  /**
   * Picks up to 2 short statements (under 20 words) from new sermon transcript text that stand alone as quotable
   * lines. Always uses Claude Haiku. The main process drops any statement that is not in the transcript word for
   * word (case and punctuation aside) and returns the transcript's own wording.
   */
  pickStatements: { input: { transcript: string }; output: { statements: string[] } }
  /**
   * Names the passages a stretch of sermon transcript quotes, paraphrases or points to, when the app's own parser and
   * quote matcher found nothing. References only, never verse text; each is checked to exist in the Bible database
   * and at most 3 come back. Always uses Claude Haiku.
   */
  findScriptureReferences: { input: { transcript: string }; output: { references: string[] } }
  /**
   * Punctuation, sentences and paragraphs (blank lines between them) for one stretch of sermon transcript, with filler
   * sounds removed. The main process rejects any answer that changes a content word, name or number, or more than a
   * few small words (see wordingChanges). `strict` is the retry after such an answer: copy every word exactly.
   */
  cleanTranscript: { input: { transcript: string; strict?: boolean }; output: { transcript: string } }
  /**
   * A summary of at most 120 words and 5 to 8 key points from a sermon transcript, using only what was said. The
   * scripture list comes from the sermon's saved references, never from the AI. `sermon` is the sermon's own details,
   * which the notes may use as well.
   */
  sermonNotes: { input: { transcript: string; sermon?: SermonDetails }; output: { summary: string; points: string[] } }
  /**
   * A few lines on one part of a long sermon (a summary of at most 60 words and up to 3 points), for sermonNotesFromParts.
   * Like sermonNotes, it may reword but not add names, numbers or dates.
   */
  summarizePart: { input: { transcript: string; sermon?: SermonDetails }; output: { summary: string; points: string[] } }
  /** The summary and key points of a long sermon from the short summaries of its parts, in order (see summarizePart). */
  sermonNotesFromParts: { input: { parts: string; sermon?: SermonDetails }; output: { summary: string; points: string[] } }
}

/** A sermon's own details, sent with its transcript for notes; the notes may use their words and numbers. */
export interface SermonDetails {
  title: string
  preacher: string
  series: string
  churchName: string
  /** ISO date, YYYY-MM-DD. */
  date: string
  /** The saved scripture list, such as "John 3:16-18". */
  scriptures: string[]
}

export type AiTask = keyof AiTasks

export type AiErrorCode =
  /** AI is switched off in Settings. */
  | 'disabled'
  /** This AI feature is not included in the plan. */
  | 'not_in_plan'
  /** No API key has been saved. */
  | 'no_key'
  /** The key was rejected or lacks access. */
  | 'invalid_key'
  /** No internet connection, or Anthropic could not be reached. */
  | 'offline'
  | 'rate_limited'
  /** Anthropic is overloaded or had a server error; try again shortly. */
  | 'unavailable'
  /** The account has a billing problem. */
  | 'billing'
  /** The model declined the request. */
  | 'refused'
  /** The input was too long, malformed, or the answer could not be used. */
  | 'bad_request'
  /** This system cannot encrypt the key, so it is not stored. */
  | 'no_encryption'

export interface AiError {
  code: AiErrorCode
  /** A sentence to show the operator. */
  message: string
  /** For rate limits: how long Anthropic asked to wait. */
  retryAfterSeconds?: number
  /** When an answer failed the wording or fact check: the words it flagged, shown in developer mode to tune the check. */
  flagged?: string[]
}

export type AiResult<T> = { ok: true; value: T } | { ok: false; error: AiError }

export interface AiStatus {
  enabled: boolean
  model: AiModel
  /** Whether an encrypted key is saved; the key itself never leaves the main process. */
  hasKey: boolean
  /** Whether the OS can encrypt the key (Keychain, DPAPI, or a Linux keyring). */
  encryptionAvailable: boolean
  /** A developer build (SERVICEEX_DEV=1, or unpackaged): the only one where keys can be saved and used. */
  developerMode: boolean
}

export interface AiApi {
  status(): Promise<AiStatus>
  /** Encrypts and stores the key. The renderer sends it once, here, and can never read it back. */
  setKey(key: string): Promise<AiResult<AiStatus>>
  clearKey(): Promise<AiStatus>
  /** Checks the saved key can reach the chosen model. Resolves to the model's display name. */
  testConnection(): Promise<AiResult<{ model: string }>>
  ask<T extends AiTask>(task: T, input: AiTasks[T]['input']): Promise<AiResult<AiTasks[T]['output']>>
}

// ---------- Live sermon listener ----------

/** Which engine is transcribing while listening: Deepgram, whisper.cpp, or neither while the cloud is retried. */
export type SpeechMode = 'cloud' | 'offline' | 'reconnecting'

/** What the speech engine is doing. The renderer adds 'starting' while it opens the microphone. */
export type SpeechStatus = 'idle' | 'connecting' | 'listening' | 'stopping' | 'error'

export type SpeechErrorCode = 'not_in_plan' | 'no_key' | 'invalid_key' | 'no_encryption' | 'auth' | 'network' | 'busy' | 'engine'

export interface SpeechError {
  code: SpeechErrorCode
  /** A sentence to show the operator. */
  message: string
}

export type SpeechResult<T> = { ok: true; value: T } | { ok: false; error: SpeechError }

export interface SpeechKeyStatus {
  /** Whether the chosen engine can start; when false, readyHint says what is missing. */
  ready: boolean
  readyHint: string | null
  hasKey: boolean
  encryptionAvailable: boolean
  /** A developer build (SERVICEEX_DEV=1, or unpackaged): the only one where keys can be saved and used. */
  developerMode: boolean
  /** Why cloud listening falls back to offline, such as not being signed in to the account; null when it can run. */
  cloudNotice: string | null
  /** Where saved transcripts go. */
  transcriptsFolder: string
}

/** Sent from the main process to the window that started listening. */
export type SpeechEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'status'; status: SpeechStatus }
  | { type: 'error'; error: SpeechError }
  | { type: 'performance'; performance: SpeechPerformance }
  /** Which engine is in use and why; `warning` is something to show prominently, null clears it. */
  | { type: 'mode'; mode: SpeechMode; reason: string; warning: string | null }
  /** The watchdog is restarting the engine (and, when restartCapture, the microphone); sent again for each failed try. */
  | { type: 'restarting'; reason: string; restartCapture: boolean }
  | { type: 'restarted'; reason: string }

/** The Deepgram key goes to the main process once, in setKey, and is never sent back. */
export interface SpeechApi {
  status(): Promise<SpeechKeyStatus>
  setKey(key: string): Promise<SpeechResult<SpeechKeyStatus>>
  clearKey(): Promise<SpeechKeyStatus>
  /** Checks the key and opens (then closes) a streaming connection. */
  testConnection(): Promise<SpeechResult<{ model: string }>>
  /** Asks the operating system for microphone access where it needs asking (macOS); resolves to whether it is allowed. */
  micAccess(): Promise<boolean>
  /**
   * Connects the speech engine; audio sent with pushAudio is transcribed until stop. With a sermon (one in the
   * 'recording' state), each final line is saved to it as it is heard, and stopping marks it saved.
   */
  start(options?: { sermonId?: number }): Promise<SpeechResult<null>>
  stop(): Promise<void>
  /** 100 ms of 16 kHz mono 16-bit little-endian PCM. */
  pushAudio(chunk: ArrayBuffer): void
  /** The microphone track went quiet (silence is being sent in its place) or came back; the watchdog discounts that time. */
  setMicMuted(muted: boolean): void
  /**
   * Transcribes a short recording (16 kHz mono 16-bit PCM, up to 30 seconds) with the engine chosen in Settings and
   * returns what it heard. Not while listening.
   */
  transcribeTest(pcm: ArrayBuffer): Promise<SpeechResult<{ text: string; engine: string }>>
  onEvent(listener: (event: SpeechEvent) => void): () => void
  whisper: WhisperApi
}

/** Both channels mixed, one side of a stereo input, or a channel number from 1 on a multichannel interface. */
export type MicChannel = 'mono' | 'left' | 'right' | number

/** Auto uses Deepgram and falls back to whisper.cpp; the others use only one. */
export type SpeechEngineId = 'auto' | 'deepgram' | 'whisper'

export type WhisperModelId = 'tiny.en' | 'base.en' | 'small.en' | 'small'

/** How the offline engine is coping, measured while it listens. */
export interface SpeechPerformance {
  model: WhisperModelId
  /** Processing time divided by audio time; below 1 means it transcribes faster than people speak. */
  realTimeFactor: number
  keepingUp: boolean
  /** Seconds of speech waiting to be transcribed. */
  backlogSeconds: number
  /** A smaller model to try when falling behind, or null. */
  suggestion: WhisperModelId | null
}

export interface WhisperModelInfo {
  id: WhisperModelId
  label: string
  description: string
  sizeBytes: number
  downloaded: boolean
  /** Bytes received while downloading, or null when not downloading. */
  receivedBytes: number | null
}

export interface WhisperStatus {
  /** Whether this build includes the whisper.cpp server. */
  engineInstalled: boolean
  models: WhisperModelInfo[]
  recommended: WhisperModelId
  /** Why that model is recommended for this computer. */
  recommendedReason: string
  /** "Apple M1, 8 cores, 8 GB memory" */
  systemSummary: string
  folder: string
}

export interface WhisperProgress {
  id: WhisperModelId
  receivedBytes: number
  totalBytes: number
  /** Set once, when the download ends: done, cancelled, or the error message. */
  finished?: { ok: true } | { ok: false; message: string; cancelled: boolean }
}

export interface WhisperApi {
  status(): Promise<WhisperStatus>
  /** Starts a download; progress arrives through onProgress. Resolves when it ends. */
  download(id: WhisperModelId): Promise<SpeechResult<null>>
  cancelDownload(id: WhisperModelId): Promise<void>
  deleteModel(id: WhisperModelId): Promise<SpeechResult<null>>
  onProgress(listener: (progress: WhisperProgress) => void): () => void
}
