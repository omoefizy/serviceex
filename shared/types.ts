// Types shared by the main process, the preload script and the renderer.
// Keep this file free of runtime code: it is imported with `import type` only.

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

/** A scripture passage saved in a service, verses included so it shows without another lookup. */
export interface ScripturePayload {
  /** Such as "John 3:16-18 KJV". */
  title: string
  verses: { text: string; caption: string }[]
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
}

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
  /** The overlay layers over the slide, or null: they show on the projector only with `overlaysOnChurchScreen`. */
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

/** What the overlay layers draw, bottom to top: logos, then the lower third. */
export interface OverlayLayers {
  /** The logos that are on, or none while the logo layer is hidden. */
  logos: LogoItem[]
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
  pinned: boolean
}

/** The lower third as the Stream output (and the projector, when allowed) draws it. */
export interface LowerThirdDisplay {
  /** Changes each time a line is shown; an update keeps it, so the text changes in place. */
  runId: number
  headline: string
  body: string
  style: LowerThirdStyle
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

/** chroma: the background is `streamKeyColor` for a chroma key. luma: the background is black for a luma key. */
export type StreamKeyMode = 'chroma' | 'luma'

export type StreamResolution = '1280x720' | '1920x1080' | '2560x1440' | '3840x2160'

/** Which screen the Stream output uses: a window, or fullscreen on one display. */
export type StreamDisplay = 'window' | number

/**
 * What the operator sends to the Stream output, drawn bottom to top: the key color, the logo layer, the lower third
 * slot and the live slide. `mode` is already worked out for the stream: 'clear' means the slide layer is empty.
 */
export interface StreamState extends Omit<OutputState, 'alert' | 'overlays' | 'screenMargins'> {
  keyMode: StreamKeyMode
  /** The chroma key color; luma keys on black. */
  keyColor: string
  width: number
  height: number
  overlays: OverlayLayers
  /** Draws the lower third over the live slide instead of in its layer under it. */
  lowerThirdOnTop: boolean
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
  color: string
  textCase: TextCase
  align: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  lineHeight: number
  shadow: { enabled: boolean; color: string; blur: number; offset: number }
  outline: { enabled: boolean; color: string; width: number }
  /** Space inside the box, in percent of screen height. */
  padding: number
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
}

/** A paragraph of an imported PowerPoint text box. */
export interface ThemeTextParagraph {
  runs: ThemeTextRun[]
  align?: 'left' | 'center' | 'right'
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
}

export interface Theme {
  id: number
  name: string
  /** Built-in themes ship with the app and cannot be changed or deleted; save a copy instead. */
  type: 'builtin' | 'custom'
  style: ThemeStyle
}

export type ThemeDefaults = Record<ThemeContentType, number>

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
  /** Set when the conversion failed. */
  error?: string
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
  /** Called once the job listener is in place. */
  ready(): void
  page(jobId: number, index: number, total: number, png: Uint8Array, text: string): void
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
  /**
   * full: the live slide fills the stream with its own background. lowerThird: the live slide in the default Lower
   * Third theme. hide: the stream shows only the key and overlays.
   */
  streamSlideContent: 'full' | 'lowerThird' | 'hide'
  /** The logo layer's logos, bottom to top. */
  logoItems: LogoItem[]
  /** The logo layer's Show and Hide toggle. */
  logoLayerVisible: boolean
  /** Also draws the overlays (logo layer, lower third) on the projector, over the slide. */
  overlaysOnChurchScreen: boolean
  /** The lower third template in use; null (or a deleted one) uses the first built-in template. */
  lowerThirdTemplateId: number | null
  lowerThirdAnimation: LowerThirdAnimation
  /** 200 to 1000 ms. */
  lowerThirdDurationMs: number
  /** Hides the lower third this many seconds after it is shown; 0 (the default) keeps it up until hidden. */
  lowerThirdHoldSeconds: number
  /** Whether the lower third stays on top of a full screen slide; false (the default) hides it while one is live. */
  lowerThirdOverFullSlide: boolean
  lowerThirdSavedLines: SavedLowerThirdLine[]
  /** The sermon's points, one per line, for Next Point. */
  lowerThirdPoints: string[]
  /** wd-media:// URL of the church logo, shown by Logo theme images without a picture of their own; null for the placeholder. */
  logoUrl: string | null
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

/** The API the preload script exposes to the renderer as `window.api`. */
export interface WorshipDeckApi {
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
  presentations: PresentationsApi
  livePowerPoint: LivePowerPointApi
  rasterizer: RasterizerApi
  log: LogApi
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

export interface LogApi {
  /** Appends the report to logs/panel-errors.log in the app data folder. */
  panelError(report: PanelErrorReport): Promise<void>
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
}

export type AiTask = keyof AiTasks

export type AiErrorCode =
  /** AI is switched off in Settings. */
  | 'disabled'
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
}

export type AiResult<T> = { ok: true; value: T } | { ok: false; error: AiError }

export interface AiStatus {
  enabled: boolean
  model: AiModel
  /** Whether an encrypted key is saved; the key itself never leaves the main process. */
  hasKey: boolean
  /** Whether the OS can encrypt the key (Keychain, DPAPI, or a Linux keyring). */
  encryptionAvailable: boolean
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

export type SpeechErrorCode = 'no_key' | 'invalid_key' | 'no_encryption' | 'auth' | 'network' | 'busy' | 'engine'

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
  /** Connects the speech engine; audio sent with pushAudio is transcribed until stop. */
  start(): Promise<SpeechResult<null>>
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
