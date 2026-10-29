import { create } from 'zustand'
import { buildSongSlides } from '../shared/lyrics'
import { DEFAULT_LOWER_THIRD_STYLE } from '../shared/lowerThirds'
import { DEFAULT_HIGHLIGHT, isMarked, markSlide, slideRich, unmarkSlide } from '../shared/highlights'
import { can } from '../shared/features'
import { DEFAULT_LAYOUT_ID, PRESET_LAYOUTS } from '../shared/layouts'
import { formatFor, matching, trimRich, type RichRange } from '../shared/richText'
import { adjustTheme, isEmptyAdjust } from '../shared/scriptureLook'
import { DEFAULT_FONT, DEFAULT_THEME_STYLE } from '../shared/themes'
import type {
  AlertDisplay,
  AlertMessage,
  AnnouncementPayload,
  AppSettings,
  BibleVersion,
  BibleVersionCode,
  DualTranslation,
  HighlightStyle,
  LivePowerPointStatus,
  LowerThirdDisplay,
  LowerThirdStyle,
  LowerThirdTemplate,
  MediaItem,
  OutputMode,
  OutputState,
  OverlayLayers,
  PowerPointTarget,
  Presentation,
  PresentationMode,
  PresentationProgress,
  RichText,
  ScriptureAdjust,
  ScripturePayload,
  ServiceItemPayload,
  ServiceItem,
  ServiceItemType,
  ServiceWithItems,
  SlideFormats,
  Song,
  StageState,
  StreamState,
  Theme,
  ThemeBackground,
  ThemeContentType,
  ThemeDefaults,
  ThemeStyle,
  Verse,
} from '../shared/types'
import { announcementSlides, parseVerseCaption, quoteSlide, verseCaption } from './lib/slides'
import { PRIORITY_BAND_COLOR, PRIORITY_PASSES, runDurationMs } from './lib/ticker'
import { dualTheme, missingNote, slideTranslation, translateSlides, type Translation } from './lib/translations'
import { CONTENT_COLORS } from './styles/contentColors'

export interface DeckSlide {
  text: string
  /**
   * What the theme's Reference box shows: a scripture reference, a song's title and author on its first slide, an
   * announcement's title or a quote's speaker.
   */
  caption: string
  /** What the theme's Copyright box shows: a song's copyright line, on its first slide. */
  copyright?: string
  /** The words with their own formatting, drawn over the theme's look; `text` stays the plain words. */
  rich?: RichText
  /** The formatting from before live highlighting (shared/highlights.ts), to take the marks off; set only while it has some. */
  unmarked?: RichText
  /** Song section shown on the slide card only, such as "Chorus". */
  label?: string
  /** Replaces the theme's background for this slide: a library item dropped on it, or a presentation page. */
  background?: ThemeBackground
  /** A presentation page: the image is the whole slide, so the theme's darkening is not applied. */
  page?: boolean
  /** A presentation page's text and speaker notes, from the original. */
  pageText?: string
  notes?: string
  /** Animated or has a transition in PowerPoint; a still image, unless Live PowerPoint plays it. */
  animated?: boolean
  /** A Native mode slide: drawn with its own theme, in place of the deck's theme and the page picture. */
  native?: ThemeStyle
  /** What Native mode could not draw on this slide (it may show its picture instead), for the warning icon. */
  warnings?: string[]
  /** A scripture slide's second translation (its version is in the caption), drawn in a second text box. */
  second?: { text: string; layout: DualTranslation['layout'] }
  /** Quick adjustments to this verse alone (the Aa popover), over its theme; they stay through a change of translation. */
  adjust?: ScriptureAdjust
}

/** Where a translation change goes: the preview's scripture, or the live scripture. */
export type TranslationTarget = 'preview' | 'live'

/** What the last translation change did, shown on the Preview or Live box. */
export interface TranslationNote {
  where: TranslationTarget
  text: string
  error: boolean
}

/** What the grid holds: a schedule item type, or a quote (a sermon statement, with the Quote theme default). */
export type DeckType = ServiceItemType | 'quote'

/** The browse fields that describe what the grid shows; kept with a live snapshot so the grid can jump back to it. */
type BrowseSnapshot = Pick<
  OperatorState,
  'selectedSong' | 'deckTitle' | 'slides' | 'deckType' | 'deckKey' | 'deckThemeId' | 'activeItemId'
>

/** One run of the ticker: these messages, scrolling from `startedAt`. */
export interface TickerRun {
  runId: number
  texts: string[]
  /** Each text's formatting, or null, in the same order. */
  riches: (RichText | null)[]
  /** Epoch milliseconds when the first letter was at the band's right edge. */
  startedAt: number
  /** Times through the messages; 0 runs until stopped. */
  loops: number
}

/** The alert ticker on the output. */
export interface LiveTicker {
  /** The saved messages playing in turn, or null when only a priority message is running. */
  normal: TickerRun | null
  /** A priority message interrupting them. The normal run is paused meanwhile. */
  priority: TickerRun | null
  /** How far into the normal run it was paused, in milliseconds, while a priority message plays. */
  pausedAt: number | null
  /** Off the output for now; the ticker keeps time and comes back where it would have been. */
  hidden: boolean
}

/** A line of the lower third: a headline and a body, either of which may be empty. */
export interface LowerThirdLine {
  headline: string
  body: string
  /** The headline and body with their formatting; used only while their plain text matches. */
  headlineRich?: RichText
  bodyRich?: RichText
}

/** The lower third on the Stream output. */
export interface LiveLowerThird extends LowerThirdLine {
  /** Changes each time a line is shown; an update keeps it. */
  runId: number
}

/**
 * What the projector shows: a full copy taken when something goes live. Browsing, editing songs, changing themes
 * or deleting things never changes it; only going live, the arrow keys and the output mode buttons do.
 */
export interface LiveState {
  itemType: DeckType | null
  /** The song id for songs, the schedule item id for other schedule items; null for scripture lookups. */
  itemId: number | null
  /** The deck key of the live item (see `deckKey`), to tell whether the grid is showing it. */
  deckKey: string | null
  /** The schedule item it came from, for "next item"; null when it came from the library. */
  scheduleItemId: number | null
  title: string | null
  slides: DeckSlide[]
  /** The theme resolved at the time it went live. */
  theme: ThemeStyle
  /** Index into `slides` of the slide on screen, or null when nothing is live. */
  slideIndex: number | null
  mode: OutputMode
  /** The item was edited after going live; the output keeps the older copy until resent. */
  stale: boolean
  /** What the grid showed when this went live, for "jump back to live". */
  source: BrowseSnapshot | null
  /**
   * The alert ticker over the output, or null when stopped. It belongs to the output, not the slide: going live,
   * changing slides or loading anything else keeps it running.
   */
  alert: LiveTicker | null
  /** The lower third, or null when hidden. Like the ticker, it belongs to the output and outlives slide changes. */
  lowerThird: LiveLowerThird | null
  /**
   * Played by PowerPoint (Live PowerPoint): an animated slide of a PowerPoint presentation was sent. The arrow
   * keys then step PowerPoint's animations, and `slideIndex` follows PowerPoint.
   */
  powerPoint: boolean
  /** Changes each time a slide is sent; PowerPoint moves to `slideIndex` only then (see PowerPointTarget). */
  powerPointCue: number
}

const NOTHING_LIVE: LiveState = {
  itemType: null,
  itemId: null,
  deckKey: null,
  scheduleItemId: null,
  title: null,
  slides: [],
  theme: DEFAULT_THEME_STYLE,
  slideIndex: null,
  mode: 'show',
  stale: false,
  source: null,
  alert: null,
  lowerThird: null,
  powerPoint: false,
  powerPointCue: 0,
}

const POWERPOINT_IDLE: LivePowerPointStatus = { phase: 'idle', presentationId: null, slideIndex: null, step: null, steps: null, message: null, failures: 0 }

interface OperatorState {
  // ---------- Browse: what the grid and the preview show ----------
  selectedSong: Song | null
  /** Heading of the slide grid: the song title or the scripture reference. Null when nothing is loaded. */
  deckTitle: string | null
  slides: DeckSlide[]
  /** The slide shown in the preview, moved with Up and Down; Enter sends it live. Null when the grid is empty. */
  highlightIndex: number | null
  /** What the grid holds, which picks the default theme. Null when it is empty. */
  deckType: DeckType | null
  /**
   * Names the deck for per-slide background overrides: 'song:<id>' (wherever the song is loaded from),
   * 'item:<id>' for other schedule items, 'scripture:<reference>' for a scripture lookup. Null when empty.
   */
  deckKey: string | null
  /** The theme picked above the slide grid for what is loaded now; null uses the song's theme or the default. */
  deckThemeId: number | null
  /** The schedule item whose slides are in the grid, or null when the grid came from the library. */
  activeItemId: number | null

  // ---------- Live: what the projector shows ----------
  live: LiveState
  /** What was live before, newest last, for Go Back. */
  liveHistory: LiveState[]

  /** App settings from the main process (crossfade, output display, logo, appearance, backups). */
  settings: AppSettings
  themes: Theme[]
  themeDefaults: ThemeDefaults | null
  themeEditorOpen: boolean
  settingsOpen: boolean
  paletteOpen: boolean
  /** Whether the stage display window is open; kept in step by App from the main process. */
  stageOpen: boolean
  /** Whether the projector output window is open; kept in step by App from the main process. */
  outputOpen: boolean
  /** Whether the Stream output window is open; kept in step by App from the main process. */
  streamOpen: boolean
  /** The test pattern on the Stream output, for lining up the key. Not saved. */
  streamTestPattern: boolean
  /** The test pattern on the projector output, for lining it up (or a vision mixer fed from it). Not saved. */
  outputTestPattern: boolean
  /** The Stream panel (preview, logos and stream settings) in the centre column. */
  streamPanelOpen: boolean
  /** The Sermons screen (saved listening sessions) in the centre column. */
  sermonsOpen: boolean
  lowerThirdTemplates: LowerThirdTemplate[]
  /** What is typed in the Lower Third panel; Enter shows it. */
  lowerThirdDraft: LowerThirdLine
  /** Lines shown during this service, newest first, at most 30, for Up and Down in the panel. */
  lowerThirdHistory: LowerThirdLine[]
  /** The sermon point last shown from the Points list, or -1 before the first. */
  lowerThirdPointIndex: number
  /** The service open in the schedule panel. */
  service: ServiceWithItems | null
  /** The song open in the editor, which takes the slide grid's place. */
  editingSongId: number | null
  /** Bumped whenever a song is saved or deleted, so the song list reloads. */
  songsVersion: number
  /** Bumped when the media library changes, so every view of it reloads. */
  mediaVersion: number
  /** The Presentations library, newest first. */
  presentations: Presentation[]
  /** Conversions running or just finished, for the progress chips. */
  presentationJobs: PresentationProgress[]
  /** What Live PowerPoint reports: the slide and build step on screen, or why it fell back to the still slide. */
  livePowerPoint: LivePowerPointStatus
  /** Bumped by Resend while PowerPoint plays the live slide, to restart it from a fresh copy. */
  powerPointGeneration: number
  /** Installed Bible versions, in the order the version chips and Cmd+1 to 9 (Ctrl+1 to 9) use. */
  bibleVersions: BibleVersion[]
  translationNote: TranslationNote | null
  /** Highlight mode: clicking words on the Live or Preview box marks them. Cmd+H (Ctrl+H) turns it on and off. */
  highlightMode: boolean
  /** The brush highlight mode marks words with; it starts as Settings' default. */
  highlightStyle: HighlightStyle

  /** Shows a song in the grid and preview. Never touches what is live. */
  selectSong(song: Song | null): void
  /** Shows scripture verses in the grid and preview, in place of a song. Never touches what is live. */
  selectScripture(title: string, slides: DeckSlide[]): void
  /** Shows a sermon statement as a quote slide in the grid and preview. Never touches what is live. */
  selectQuote(text: string, speaker: string): void
  /** Shows a library presentation's slides in the grid and preview. Never touches what is live. */
  selectPresentation(presentation: Presentation): void
  /** Copies the grid's item into the live snapshot with this slide on screen, and shows it. */
  goLive(index: number): void
  /** Sends the highlighted preview slide live (Enter, the Go Live button). */
  goLiveHighlighted(): void
  setHighlight(index: number): void
  /** Moves the preview highlight by `delta` slides (Up and Down). */
  moveHighlight(delta: number): void
  /** Changes only the live output mode; browsing never resets it. */
  setOutputMode(mode: OutputMode): void
  /**
   * Next and previous slide of the live item (Right and Left), whatever the grid is showing. Past either end of live
   * scripture they read on into the next verse, or back into the one before.
   */
  nextSlide(): void
  previousSlide(): void
  /** Puts the slide that was live before the current one back on screen. */
  goBack(): void
  /** Starts the ticker with these messages in turn, from the first, replacing whatever it was running. */
  startAlerts(messages: AlertMessage[]): void
  /** Interrupts the ticker with a priority message; the normal messages carry on where they were afterwards. */
  interruptAlert(message: AlertMessage): void
  /** Ends a priority message early, or else moves the normal messages on to the next one. */
  nextAlert(): void
  /** Stops the ticker. */
  stopAlerts(): void
  /** Takes the ticker off the output without stopping it, or brings it back. */
  setAlertHidden(hidden: boolean): void
  /** Shows the live item in the grid again. */
  jumpToLive(): void
  /**
   * Pushes the live item's current version and theme to the output: from the grid when it shows the live item
   * (so the theme picker's choice goes too), otherwise rebuilt from the song or schedule item.
   */
  resendLive(): Promise<void>

  /** Opens a service in the schedule panel, or closes it with null. */
  openService(id: number | null): Promise<void>
  addToSchedule(type: ServiceItemType, refId: number | null, payload: ServiceItemPayload | null): Promise<void>
  removeFromSchedule(itemId: number): Promise<void>
  reorderSchedule(orderedItemIds: number[]): Promise<void>
  /** Loads a schedule item's slides into the grid. Resolves to false if another load replaced it first. */
  loadItem(item: ServiceItem): Promise<boolean>
  /** Stages the next schedule item in the preview; with "Auto go live on schedule next" on, it also goes live. */
  nextItem(): Promise<void>

  editSong(id: number | null): void
  /** Loads the themes and defaults; call again after the theme editor changes them. */
  loadThemes(): Promise<void>
  setDeckTheme(id: number | null): void
  loadSettings(): Promise<void>
  /** Saves settings and keeps what the main process stored (it tidies or rejects bad values). */
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  setFadeMs(fadeMs: number): Promise<void>
  /** Gives one slide of the loaded deck a library background, or clears it with null. */
  setSlideBackground(index: number, mediaId: number | null): Promise<void>
  /** Reloads the loaded deck's slide backgrounds, after a library item is deleted for example. */
  refreshSlideBackgrounds(): Promise<void>
  openThemeEditor(open: boolean): void
  openSettings(open: boolean): void
  setPaletteOpen(open: boolean): void
  setStageOpen(open: boolean): void
  toggleStage(): Promise<void>
  setOutputOpen(open: boolean): void
  toggleOutput(): Promise<void>
  setStreamOpen(open: boolean): void
  toggleStream(): Promise<void>
  setStreamTestPattern(on: boolean): void
  setOutputTestPattern(on: boolean): void
  loadLowerThirdTemplates(): Promise<void>
  setLowerThirdDraft(patch: Partial<LowerThirdLine>): void
  /** Shows the draft on the Stream output, or changes the text in place if a lower third is already up. */
  showLowerThird(): void
  hideLowerThird(): void
  /** Puts a sermon point in the draft and shows it; Next Point is the one after the last shown. */
  showLowerThirdPoint(index: number): void
  nextLowerThirdPoint(): void
  /** Replaces the sermon's points (one per line); Next Point then starts from the first. */
  queueLowerThirdPoints(points: string[]): Promise<void>
  openStreamPanel(open: boolean): void
  openSermons(open: boolean): void
  /** Closes the song editor, theme editor and settings so the slide grid shows. */
  showGrid(): void
  mediaChanged(): void
  /** Tells the song list to reload, after an import for example. */
  songsChanged(): void
  /** Refreshes the grid and schedule after the editor saves a song; marks the live copy out of date if it is that song. */
  songSaved(song: Song): Promise<void>
  songDeleted(id: number): Promise<void>
  /** Saves a scripture or announcement item's new payload (its slides' words and formatting) and shows it in the grid. */
  updateItemPayload(itemId: number, payload: ScripturePayload | AnnouncementPayload): Promise<void>
  loadPresentations(): Promise<void>
  /** Imports files or image folders into the Presentations library, .pptx files in `mode`; resolves to what was imported. */
  importPresentations(paths: string[], mode?: PresentationMode): Promise<Presentation[]>
  addPresentationToSchedule(presentation: Presentation): Promise<void>
  /** Shows conversion progress; a finished job without an error clears itself after a moment. */
  presentationProgress(progress: PresentationProgress): void
  dismissPresentationJob(key: string): void
  /**
   * A presentation was re-rendered after its original was saved. The grid, the schedule and the library take the
   * new slides, keeping the highlighted position. The live output changes only with "Auto refresh live" on;
   * otherwise the live copy is marked out of date for a resend.
   */
  presentationUpdated(presentation: Presentation): void
  /**
   * A presentation's original was saved with new content. If PowerPoint is playing it live, the live copy is marked
   * out of date at once (Resend restarts PowerPoint from the saved file), before the slides are re-rendered.
   */
  presentationChanged(presentationId: number): void
  setPresentationLiveOptions(id: number, options: Partial<Pick<Presentation, 'livePowerPoint' | 'useTimings'>>): Promise<void>
  /** Switches a .pptx between Image and Native mode. */
  setPresentationMode(id: number, mode: PresentationMode): Promise<void>
  /** Shows one slide of a Native mode presentation as its picture, or natively again. */
  setPresentationSlideUseImage(id: number, index: number, useImage: boolean): Promise<void>
  /** Saves an edited native slide. */
  updateNativeSlide(id: number, index: number, style: ThemeStyle): Promise<void>
  /** Stops a presentation following its original file. */
  detachPresentation(id: number): Promise<void>
  /**
   * Live PowerPoint moved on (next, previous, slide timings) or failed. The live slide follows it; after a failure
   * the live slide shows as a still image.
   */
  livePowerPointStatus(status: LivePowerPointStatus): void
  /** Ends PowerPoint's slide show and puts the still slide on the output (Ctrl+Shift+K or Cmd+Shift+K). */
  panicPowerPoint(): void
  /** Reads the installed Bible versions again, as after an import. */
  loadBibleVersions(): Promise<void>
  /**
   * Reads the preview's or the live scripture in another translation, the same verses. On the Live box it goes to the
   * output at once (with the crossfade); with Switch live immediately off it is staged in the preview for a resend.
   */
  switchTranslation(where: TranslationTarget, version: BibleVersionCode): Promise<void>
  /** Saves the two translation choice and shows the preview's or the live scripture with it. */
  setDualTranslation(where: TranslationTarget, dual: DualTranslation): Promise<void>
  dismissTranslationNote(): void
  setHighlightMode(on: boolean): void
  /** Changes the brush, and turns highlight mode on. */
  setHighlightStyle(patch: Partial<HighlightStyle>): void
  /**
   * Toggles the brush on words of the live slide (straight to the output) or the preview slide (it goes live with it).
   * `again` replaces the last marking instead of adding to it: the second click of a double click.
   */
  markWords(where: TranslationTarget, range: RichRange, again?: boolean): void
  /** Takes every mark off the live slide (Esc) or the preview slide. */
  clearHighlights(where: TranslationTarget): void
  /** Quick adjustments to the live or preview verse alone (the Aa popover); on the live verse they reach the output at once. */
  adjustScripture(where: TranslationTarget, patch: ScriptureAdjust): void
  /**
   * Keeps the verse's quick adjustments: in the default scripture theme, or for every verse of the open service. The
   * verse then shows them through its theme, and the rest of the passage with it.
   */
  saveScriptureAdjust(where: TranslationTarget, scope: 'theme' | 'service'): Promise<void>
  /** Takes the verse's quick adjustments off, and the open service's own scripture look: the verse looks like its theme again. */
  resetScriptureAdjust(where: TranslationTarget): void
  /**
   * Saves `style` as the default scripture theme: in place for a custom theme; a built-in one cannot change, so a copy
   * is made and becomes the default for scripture.
   */
  saveScriptureTheme(style: ThemeStyle): Promise<void>
}

/** Bumped by every grid load, so a slow song fetch for an old item cannot overwrite a newer selection. */
let loadToken = 0

/** What the renderer shows before the main process answers, and the fallback for any key its answer lacks. */
export const DEFAULT_SETTINGS: AppSettings = {
  alertMessages: [],
  alertPosition: 'bottom',
  alertSpeed: 14,
  alertFontSize: 5,
  alertTextColor: CONTENT_COLORS.alertText,
  alertBandColor: CONTENT_COLORS.alertBand,
  alertBandOpacity: 0.85,
  alertBandHeight: 9,
  alertLoops: 0,
  alertLayout: 'divider',
  alertKeepOnClear: true,
  fadeMs: 400,
  outputDisplay: 'auto',
  outputBounds: { left: 0, top: 0, width: 1920, height: 1080 },
  screenMargins: { top: 0, right: 0, bottom: 0, left: 0 },
  defaultFont: DEFAULT_FONT,
  previewOutput: true,
  streamDisplay: 'window',
  streamResolution: '1920x1080',
  streamKeyMode: 'chroma',
  streamKeyColor: CONTENT_COLORS.chromaGreen,
  streamSlideContent: 'full',
  logoItems: [],
  logoLayerVisible: true,
  overlaysOnChurchScreen: false,
  lowerThirdTemplateId: null,
  lowerThirdAnimation: 'slide',
  lowerThirdDurationMs: 500,
  lowerThirdHoldSeconds: 0,
  lowerThirdOverFullSlide: false,
  lowerThirdSavedLines: [],
  lowerThirdPoints: [],
  logoUrl: null,
  churchName: '',
  churchFooter: '',
  appearance: 'system',
  autosaveDrafts: true,
  backupFolder: null,
  backupIntervalMinutes: 0,
  lastBackupAt: null,
  aiEnabled: true,
  aiModel: 'claude-sonnet-5-5',
  aiKeyProvider: 'developer_key',
  autoGoLiveOnNext: false,
  micDeviceId: null,
  micDeviceName: null,
  micChannel: 'mono',
  micGainDb: 0,
  micHighPass: true,
  micNoiseGate: false,
  micGateThresholdDb: -60,
  micProcessing: false,
  saveTranscripts: false,
  speechEngine: 'whisper',
  speechKeyProvider: 'developer_key',
  whisperModel: 'base.en',
  whisperSpeed: {},
  scriptureDetection: true,
  detectionMinConfidence: 0.6,
  detectionAlert: 'off',
  aiScriptureFallback: false,
  quoteSpeakerName: '',
  statementPicking: false,
  presentationEngine: 'auto',
  presentationAutoRefreshLive: false,
  presentationLivePowerPoint: false,
  scriptureDefaultVersion: 'KJV',
  scriptureServiceVersions: {},
  scriptureSwitchLiveImmediately: true,
  scriptureDual: { enabled: false, second: 'WEB', layout: 'stacked' },
  scriptureServiceLooks: {},
  highlightClearOnSlideChange: true,
  highlightKeepWithItem: false,
  highlightDefault: DEFAULT_HIGHLIGHT,
  sharingEnabled: false,
  sharingDeviceName: '',
  sharingMaxSizeMb: 2048,
  sharingAutoAccept: false,
  layouts: [...PRESET_LAYOUTS],
  activeLayoutId: DEFAULT_LAYOUT_ID,
  sharingDeviceChips: true,
  sharingCueAlert: 'off',
  sharingLibrarySync: false,
  sharingBandwidthKbps: 0,
}

/** A settings answer with every key present, so a key missing after an update or a bad answer cannot break a panel. */
const withDefaults = (settings: Partial<AppSettings> | null | undefined): AppSettings => ({ ...DEFAULT_SETTINGS, ...settings })

export const useOperatorStore = create<OperatorState>((set, get) => ({
  selectedSong: null,
  deckTitle: null,
  slides: [],
  highlightIndex: null,
  deckType: null,
  deckKey: null,
  deckThemeId: null,
  activeItemId: null,
  live: NOTHING_LIVE,
  liveHistory: [],
  settings: DEFAULT_SETTINGS,
  themes: [],
  themeDefaults: null,
  themeEditorOpen: false,
  settingsOpen: false,
  paletteOpen: false,
  stageOpen: false,
  outputOpen: true,
  streamOpen: false,
  streamTestPattern: false,
  outputTestPattern: false,
  streamPanelOpen: false,
  sermonsOpen: false,
  lowerThirdTemplates: [],
  lowerThirdDraft: { headline: '', body: '' },
  lowerThirdHistory: [],
  lowerThirdPointIndex: -1,
  service: null,
  editingSongId: null,
  songsVersion: 0,
  mediaVersion: 0,
  presentations: [],
  presentationJobs: [],
  livePowerPoint: POWERPOINT_IDLE,
  powerPointGeneration: 0,
  bibleVersions: [],
  translationNote: null,
  highlightMode: false,
  highlightStyle: DEFAULT_HIGHLIGHT,

  selectSong(song) {
    const token = ++loadToken
    const deckKey = song ? `song:${song.id}` : null
    const slides = song ? songSlides(song) : []
    set({
      activeItemId: null,
      selectedSong: song,
      deckType: song ? 'song' : null,
      deckKey,
      deckThemeId: null,
      deckTitle: song?.title ?? null,
      slides,
      highlightIndex: slides.length > 0 ? 0 : null,
    })
    applySlideBackgrounds(token, deckKey)
  },

  selectScripture(title, slides) {
    const token = ++loadToken
    const deckKey = `scripture:${title}`
    set({
      selectedSong: null,
      deckType: 'scripture',
      deckKey,
      deckThemeId: null,
      deckTitle: title,
      slides,
      highlightIndex: slides.length > 0 ? 0 : null,
      activeItemId: null,
    })
    applySlideBackgrounds(token, deckKey).then(() => showDualInGrid(token))
  },

  selectQuote(text, speaker) {
    const token = ++loadToken
    const slides = [quoteSlide(text, speaker)]
    const deckKey = `quote:${slides[0].text}`
    set({
      selectedSong: null,
      deckType: 'quote',
      deckKey,
      deckThemeId: null,
      deckTitle: speaker.trim() ? `Quote · ${speaker.trim()}` : 'Quote',
      slides,
      highlightIndex: 0,
      activeItemId: null,
    })
    applySlideBackgrounds(token, deckKey)
  },

  selectPresentation(presentation) {
    loadToken++
    const slides = presentationSlides(presentation)
    set({
      selectedSong: null,
      deckType: 'presentation',
      deckKey: `presentation:${presentation.id}`,
      deckThemeId: null,
      deckTitle: presentation.title,
      slides,
      highlightIndex: slides.length > 0 ? 0 : null,
      activeItemId: null,
    })
  },

  goLive(index) {
    const s = get()
    if (index < 0 || index >= s.slides.length) return
    const powerPoint = playsInPowerPoint(s, s.deckKey, s.slides[index])
    const live: LiveState = {
      ...snapshotOf(s),
      slideIndex: index,
      mode: 'show',
      stale: false,
      alert: s.live.alert,
      lowerThird: s.live.lowerThird,
      powerPoint,
      powerPointCue: powerPoint ? ++powerPointCues : 0,
    }
    set({ ...leaveSlide(s, live), liveHistory: historyBefore(s, live), highlightIndex: index })
  },

  goLiveHighlighted() {
    const { highlightIndex, slides } = get()
    if (slides.length > 0) get().goLive(highlightIndex ?? 0)
  },

  setHighlight(index) {
    if (index >= 0 && index < get().slides.length) set({ highlightIndex: index })
  },

  moveHighlight(delta) {
    const { slides, highlightIndex } = get()
    if (slides.length === 0) return
    set({ highlightIndex: Math.min(slides.length - 1, Math.max(0, (highlightIndex ?? -1) + delta)) })
  },

  setOutputMode(mode) {
    set({ live: { ...get().live, mode } })
  },

  nextSlide() {
    stepLive(1)
  },

  previousSlide() {
    stepLive(-1)
  },

  goBack() {
    const s = get()
    const { liveHistory, live } = s
    const previous = liveHistory[liveHistory.length - 1]
    if (!previous) return
    // With Clear highlights when the slide changes on, the slide coming back has no marks either.
    const slides = s.settings.highlightClearOnSlideChange ? unmarkAt(previous.slides, previous.slideIndex) : previous.slides
    set({ ...leaveSlide(s, { ...previous, slides, mode: 'show', alert: live.alert, lowerThird: live.lowerThird }), liveHistory: liveHistory.slice(0, -1) })
  },

  startAlerts(messages) {
    if (!can('alerts')) return
    const shown = messages.filter((m) => m.text.trim())
    if (shown.length === 0) return
    const normal = newRun(shown.map((m) => m.text.trim()), get().settings.alertLoops, shown.map(alertRich))
    setTicker({ normal, priority: null, pausedAt: null, hidden: get().live.alert?.hidden ?? false })
    scheduleRunEnd(normal, stopTicker)
  },

  interruptAlert(message) {
    if (!can('alerts')) return
    const ticker = get().live.alert
    const priority = newRun([message.text.trim()], PRIORITY_PASSES, [alertRich(message)])
    // A second priority message keeps the pause point of the first.
    const pausedAt = ticker?.priority ? ticker.pausedAt : ticker?.normal ? Date.now() - ticker.normal.startedAt : null
    setTicker({ normal: ticker?.normal ?? null, priority, pausedAt, hidden: ticker?.hidden ?? false })
    scheduleRunEnd(priority, endPriority)
  },

  nextAlert() {
    const ticker = get().live.alert
    if (!ticker) return get().startAlerts(get().settings.alertMessages.filter((m) => !m.priority))
    if (ticker.priority) return endPriority()
    if (!ticker.normal) return
    const { texts, riches, loops } = ticker.normal
    const normal = newRun([...texts.slice(1), texts[0]], loops, [...riches.slice(1), riches[0]])
    setTicker({ ...ticker, normal })
    scheduleRunEnd(normal, stopTicker)
  },

  stopAlerts() {
    stopTicker()
  },

  setAlertHidden(hidden) {
    const ticker = get().live.alert
    if (ticker) setTicker({ ...ticker, hidden })
  },

  jumpToLive() {
    const { live } = get()
    if (!live.source) return
    loadToken++
    set({ ...live.source, slides: live.slides, highlightIndex: live.slideIndex })
  },

  async resendLive() {
    const s = get()
    const { live } = s
    if (live.deckKey === null) return
    // PowerPoint starts the show again from a fresh copy of the saved original, at the same slide.
    if (live.powerPoint) set({ powerPointGeneration: s.powerPointGeneration + 1 })
    const clamp = (count: number) => (live.slideIndex === null ? null : Math.min(live.slideIndex, count - 1))
    if (s.deckKey === live.deckKey && s.slides.length > 0) {
      set({ live: { ...live, ...snapshotOf(s), slideIndex: clamp(s.slides.length), stale: false } })
      return
    }
    // The grid shows something else: rebuild the live item from its source, with its default theme.
    let slides = live.slides
    let theme = live.theme
    if (live.itemType === 'song' && live.itemId !== null) {
      const song = await window.api.songs.get(live.itemId)
      if (!song) throw new Error('The live song has been deleted, so it cannot be resent.')
      slides = songSlides(song)
      const themeId = song.themeId ?? s.themeDefaults?.song
      theme = s.themes.find((t) => t.id === themeId)?.style ?? theme
    } else if (live.itemType === 'presentation') {
      const presentation = linkedPresentation(s, live.deckKey)
      if (presentation) slides = presentationSlides(presentation)
    }
    slides = withBackgrounds(slides, await window.api.media.getSlideBackgrounds(live.deckKey))
    const current = get().live
    if (current.deckKey !== live.deckKey) return
    set({ live: { ...current, slides, theme, slideIndex: clamp(slides.length), stale: false } })
  },

  async openService(id) {
    const service = id === null ? null : ((await window.api.services.get(id)) ?? null)
    // The lower third history is per service.
    const history = service?.id === get().service?.id ? {} : { lowerThirdHistory: [] }
    set({ service, activeItemId: null, ...history })
    prepareLivePowerPoint()
  },

  async addToSchedule(type, refId, payload) {
    // With a shared service open, the item joins it instead (see lib/sharing.ts).
    if (scheduleTarget && (await scheduleTarget(type, refId, payload))) return
    const { service } = get()
    if (!service) throw new Error('Create or pick a service first')
    await window.api.services.addItem(service.id, type, refId, payload)
    await refreshService(service.id)
    prepareLivePowerPoint()
  },

  async removeFromSchedule(itemId) {
    const { service, activeItemId } = get()
    if (!service) return
    await window.api.services.removeItem(itemId)
    if (activeItemId === itemId) set({ activeItemId: null })
    await refreshService(service.id)
  },

  async reorderSchedule(orderedItemIds) {
    const { service } = get()
    if (!service) return
    // Show the new order straight away, then fall back to the stored order if saving fails.
    const byId = new Map(service.items.map((item) => [item.id, item]))
    const items = orderedItemIds.map((id) => byId.get(id)).filter((item) => item !== undefined)
    set({ service: { ...service, items } })
    const saved = await window.api.services.reorderItems(service.id, orderedItemIds).catch(() => false)
    if (!saved) await refreshService(service.id)
  },

  async loadItem(item) {
    const token = ++loadToken
    set({ activeItemId: item.id })

    let song: Song | null = null
    let slides: DeckSlide[]
    if (item.type === 'song') {
      song = (await window.api.songs.get(item.ref_id)) ?? null
      slides = song ? songSlides(song) : []
    } else if (item.type === 'scripture') {
      slides = withFormats(item.payload.verses, item.payload.formats)
    } else if (item.type === 'presentation') {
      // Linked to the library, it has the notes and animation marks too; older items have only their pages.
      const linked = get().presentations.find((p) => p.id === item.payload.presentationId)
      slides = linked
        ? presentationSlides(linked)
        : item.payload.pages.map((src) => ({ text: '', caption: '', background: { kind: 'image', src, fit: 'contain' }, page: true }))
    } else {
      slides = withFormats(announcementSlides(item.payload), item.payload.formats)
    }
    slides = withKeptMarks(item.id, slides)

    if (token !== loadToken) return false
    // A song keeps its slide backgrounds wherever it is loaded from; other items keep their own.
    const deckKey = item.type === 'song' ? `song:${item.ref_id}` : `item:${item.id}`
    set({
      selectedSong: song,
      // A saved quote is an announcement item that uses the Quote theme default.
      deckType: item.type === 'announcement' && item.payload.quote ? 'quote' : item.type,
      deckKey,
      deckThemeId: null,
      deckTitle: item.title,
      slides,
      highlightIndex: slides.length > 0 ? 0 : null,
      activeItemId: item.id,
    })
    await applySlideBackgrounds(token, deckKey)
    if (item.type === 'scripture') await showDualInGrid(token)
    return true
  },

  async nextItem() {
    const { service, activeItemId, live } = get()
    if (!service) return
    // After the item in the grid, or after the live one when the grid came from the library. With neither,
    // findIndex gives -1 and the run starts at the first item.
    const from = activeItemId ?? live.scheduleItemId
    const next = service.items[service.items.findIndex((item) => item.id === from) + 1]
    if (!next) return
    if ((await get().loadItem(next)) && get().settings.autoGoLiveOnNext && get().slides.length > 0) get().goLive(0)
  },

  // The song editor, theme editor, settings and the Stream panel share the centre panel, so opening one closes the others.
  editSong(id) {
    set(id === null ? { editingSongId: null } : { editingSongId: id, themeEditorOpen: false, settingsOpen: false, streamPanelOpen: false, sermonsOpen: false })
  },

  async loadThemes() {
    const [themes, themeDefaults] = await Promise.all([window.api.themes.list(), window.api.themes.getDefaults()])
    // A deleted theme can no longer be picked for the deck. The live snapshot keeps its own copy of its theme.
    const { deckThemeId } = get()
    set({ themes, themeDefaults, deckThemeId: themes.some((t) => t.id === deckThemeId) ? deckThemeId : null })
  },

  setDeckTheme(id) {
    set({ deckThemeId: id })
  },

  async loadSettings() {
    const settings = withDefaults(await window.api.settings.get())
    set({ settings, highlightStyle: settings.highlightDefault })
  },

  async updateSettings(patch) {
    set({ settings: { ...get().settings, ...patch }, ...(patch.highlightDefault ? { highlightStyle: patch.highlightDefault } : {}) })
    set({ settings: withDefaults(await window.api.settings.set(patch)) })
    if (patch.presentationLivePowerPoint) prepareLivePowerPoint()
  },

  async setFadeMs(fadeMs) {
    await get().updateSettings({ fadeMs })
  },

  async loadBibleVersions() {
    set({ bibleVersions: await window.api.bible.listVersions() })
  },

  async switchTranslation(where, version) {
    const current = slideTranslation(where === 'live' ? selectLiveSlide(get()) : selectPreviewSlide(get()))
    const { scriptureDual: dual } = get().settings
    const second = current?.second ?? (dual.enabled ? dual.second : null)
    await retranslate(where, { version, second: second && second !== version ? { version: second, layout: dual.layout } : null })
  },

  async setDualTranslation(where, dual) {
    await get().updateSettings({ scriptureDual: dual })
    const slide = where === 'live' ? selectLiveSlide(get()) : selectPreviewSlide(get())
    const current = slideTranslation(slide)
    if (!current) return
    const second = dual.enabled && dual.second !== current.version ? { version: dual.second, layout: dual.layout } : null
    // Nothing to read again when the slide already looks like this.
    if ((second?.version ?? null) === current.second && (!second || slide?.second?.layout === second.layout)) return
    await retranslate(where, { version: current.version, second })
  },

  dismissTranslationNote() {
    set({ translationNote: null })
  },

  setHighlightMode(on) {
    set({ highlightMode: on })
  },

  setHighlightStyle(patch) {
    set({ highlightStyle: { ...get().highlightStyle, ...patch }, highlightMode: true })
  },

  markWords(where, range, again = false) {
    const s = get()
    const at = selectMarkTarget(s, where)
    if (!at) return
    // The second click of a double click marks the sentence in place of the word the first click marked.
    const from = again && lastMark?.where === where && lastMark.after === at.slide ? lastMark.before : at.slide
    const marked = markSlide(from, range, s.highlightStyle)
    lastMark = { where, before: from, after: marked }
    putMarked(where, at.index, marked)
  },

  clearHighlights(where) {
    const at = selectMarkTarget(get(), where)
    if (at && isMarked(at.slide)) putMarked(where, at.index, unmarkSlide(at.slide))
  },

  adjustScripture(where, patch) {
    const at = selectAdjustTarget(get(), where)
    if (at) putSlide(where, at.index, { ...at.slide, adjust: { ...at.slide.adjust, ...patch } })
  },

  async saveScriptureAdjust(where, scope) {
    const s = get()
    const adjust = selectAdjustTarget(s, where)?.slide.adjust
    if (!adjust || isEmptyAdjust(adjust)) return
    if (scope === 'service') {
      if (!s.service) return
      const id = String(s.service.id)
      const looks = s.settings.scriptureServiceLooks
      await get().updateSettings({ scriptureServiceLooks: { ...looks, [id]: { ...looks[id], ...adjust } } })
    } else {
      const theme = s.themes.find((t) => t.id === s.themeDefaults?.scripture)
      if (!theme) throw new Error('There is no default scripture theme to save to.')
      await get().saveScriptureTheme(adjustTheme(theme.style, adjust))
    }
    // The live copy keeps its own theme, so the adjustments go into it too; the preview takes the new theme itself.
    const now = get()
    if (where === 'live' && now.live.itemType === 'scripture') set({ live: { ...now.live, theme: adjustTheme(now.live.theme, adjust) } })
    const at = selectAdjustTarget(get(), where)
    if (at && at.slide.adjust === adjust) putSlide(where, at.index, withoutAdjust(at.slide))
  },

  resetScriptureAdjust(where) {
    const s = get()
    const at = selectAdjustTarget(s, where)
    if (!at) return
    if (s.service && selectServiceLook(s)) {
      const looks = { ...s.settings.scriptureServiceLooks }
      delete looks[String(s.service.id)]
      get().updateSettings({ scriptureServiceLooks: looks }).catch(console.error)
      // The live copy took the service's look into its theme when it went live; it goes back to the theme itself.
      const live = get().live
      const base = s.themes.find((t) => t.id === (live.source?.deckThemeId ?? s.themeDefaults?.scripture))?.style
      if (where === 'live' && live.itemType === 'scripture' && base) set({ live: { ...live, theme: base } })
    }
    putSlide(where, at.index, withoutAdjust(at.slide))
  },

  async saveScriptureTheme(style) {
    const { themes, themeDefaults } = get()
    const theme = themes.find((t) => t.id === themeDefaults?.scripture)
    if (!theme) throw new Error('There is no default scripture theme to save to.')
    if (theme.type === 'builtin') {
      const taken = new Set(themes.map((t) => t.name.toLowerCase()))
      let name = `${theme.name} Scripture`
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${theme.name} Scripture ${n}`
      const created = await window.api.themes.create(name, { ...style, category: 'scripture' })
      await window.api.themes.setDefault('scripture', created.id)
    } else if (!(await window.api.themes.update(theme.id, theme.name, style))) {
      throw new Error('The default scripture theme no longer exists.')
    }
    await get().loadThemes()
  },

  async setSlideBackground(index, mediaId) {
    const { deckKey } = get()
    if (!deckKey) return
    await window.api.media.setSlideBackground(deckKey, index, mediaId)
    await applySlideBackgrounds(loadToken, deckKey)
    markLiveStale(deckKey)
  },

  async refreshSlideBackgrounds() {
    await applySlideBackgrounds(loadToken, get().deckKey)
  },

  openThemeEditor(open) {
    if (open && !can('themes.editor')) return
    set(open ? { themeEditorOpen: true, editingSongId: null, settingsOpen: false, streamPanelOpen: false, sermonsOpen: false } : { themeEditorOpen: false })
  },

  openSettings(open) {
    set(open ? { settingsOpen: true, editingSongId: null, themeEditorOpen: false, streamPanelOpen: false, sermonsOpen: false } : { settingsOpen: false })
  },

  openStreamPanel(open) {
    set(open ? { streamPanelOpen: true, editingSongId: null, themeEditorOpen: false, settingsOpen: false, sermonsOpen: false } : { streamPanelOpen: false })
  },

  openSermons(open) {
    set(open ? { sermonsOpen: true, editingSongId: null, themeEditorOpen: false, settingsOpen: false, streamPanelOpen: false } : { sermonsOpen: false })
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open })
  },

  setStageOpen(open) {
    set({ stageOpen: open })
  },

  async toggleStage() {
    if (!get().stageOpen && !can('stageDisplay')) return
    await (get().stageOpen ? window.api.stage.close() : window.api.stage.open())
  },

  setOutputOpen(open) {
    set({ outputOpen: open })
  },

  async toggleOutput() {
    await window.api.output.setOpen(!get().outputOpen)
  },

  setStreamOpen(open) {
    set({ streamOpen: open })
  },

  async toggleStream() {
    if (!get().streamOpen && !can('multiOutput')) return
    await window.api.stream.setOpen(!get().streamOpen)
  },

  setStreamTestPattern(on) {
    set({ streamTestPattern: on })
  },

  setOutputTestPattern(on) {
    set({ outputTestPattern: on })
  },

  async loadLowerThirdTemplates() {
    set({ lowerThirdTemplates: await window.api.lowerThirds.list() })
  },

  setLowerThirdDraft(patch) {
    set({ lowerThirdDraft: { ...get().lowerThirdDraft, ...patch } })
  },

  showLowerThird() {
    if (!can('lowerThirds')) return
    const { live, lowerThirdDraft, lowerThirdHistory, settings } = get()
    const line = trimLowerThirdLine(lowerThirdDraft)
    if (!line.headline && !line.body) return
    const runId = live.lowerThird?.runId ?? ++lowerThirdRuns
    const history = [line, ...lowerThirdHistory.filter((l) => l.headline !== line.headline || l.body !== line.body)].slice(0, LOWER_THIRD_HISTORY)
    set({ live: { ...live, lowerThird: { runId, ...line } }, lowerThirdHistory: history })
    // The hold timer counts from the latest show or update.
    clearTimeout(lowerThirdTimer)
    if (settings.lowerThirdHoldSeconds > 0) {
      lowerThirdTimer = setTimeout(() => {
        if (get().live.lowerThird?.runId === runId) get().hideLowerThird()
      }, settings.lowerThirdHoldSeconds * 1000)
    }
  },

  hideLowerThird() {
    clearTimeout(lowerThirdTimer)
    const { live } = get()
    if (live.lowerThird) set({ live: { ...live, lowerThird: null } })
  },

  showLowerThirdPoint(index) {
    const point = get().settings.lowerThirdPoints[index]
    if (point === undefined) return
    set({ lowerThirdPointIndex: index, lowerThirdDraft: { headline: point, body: '' } })
    get().showLowerThird()
  },

  nextLowerThirdPoint() {
    get().showLowerThirdPoint(get().lowerThirdPointIndex + 1)
  },

  async queueLowerThirdPoints(points) {
    set({ lowerThirdPointIndex: -1 })
    await get().updateSettings({ lowerThirdPoints: points.map((p) => p.trim()).filter(Boolean) })
  },

  showGrid() {
    set({ editingSongId: null, themeEditorOpen: false, settingsOpen: false, streamPanelOpen: false, sermonsOpen: false })
  },

  mediaChanged() {
    set({ mediaVersion: get().mediaVersion + 1 })
  },

  songsChanged() {
    set({ songsVersion: get().songsVersion + 1 })
  },

  async loadPresentations() {
    set({ presentations: await window.api.presentations.list() })
  },

  async importPresentations(paths, mode) {
    const imported = await window.api.presentations.import(paths, mode)
    await get().loadPresentations()
    return imported
  },

  async addPresentationToSchedule(presentation) {
    await get().addToSchedule('presentation', null, {
      title: presentation.title,
      pages: presentation.slides.map((slide) => slide.image),
      presentationId: presentation.id,
    })
  },

  presentationProgress(progress) {
    set({ presentationJobs: [...get().presentationJobs.filter((job) => job.key !== progress.key), progress] })
    if (progress.finished && !progress.error) {
      setTimeout(() => {
        const jobs = get().presentationJobs
        if (jobs.some((job) => job === progress)) set({ presentationJobs: jobs.filter((job) => job !== progress) })
      }, 3000)
    }
  },

  dismissPresentationJob(key) {
    set({ presentationJobs: get().presentationJobs.filter((job) => job.key !== key) })
  },

  presentationUpdated(presentation) {
    const s = get()
    const exists = s.presentations.some((p) => p.id === presentation.id)
    set({ presentations: exists ? s.presentations.map((p) => (p.id === presentation.id ? presentation : p)) : [presentation, ...s.presentations] })
    const slides = presentationSlides(presentation)
    const shows = (deckKey: string | null) => linkedPresentation(get(), deckKey)?.id === presentation.id
    // Slide positions stay where they were, by index, or on the last slide when the deck got shorter.
    const clamp = (index: number | null) => (index === null || slides.length === 0 ? null : Math.min(index, slides.length - 1))

    if (shows(s.deckKey)) {
      loadToken++
      set({ slides, highlightIndex: clamp(get().highlightIndex) })
    }
    const { live, settings } = get()
    if (shows(live.deckKey)) {
      if (live.powerPoint) {
        // PowerPoint plays its own copy, so saving never changes the output (presentationChanged marked it out of
        // date). Once Resend has taken the saved file, the still slides under the show catch up with it.
        if (!live.stale) set({ live: { ...live, slides, slideIndex: clamp(live.slideIndex), source: live.source && { ...live.source, slides } } })
      } else if (settings.presentationAutoRefreshLive) {
        set({
          live: {
            ...live,
            slides,
            slideIndex: clamp(live.slideIndex),
            stale: false,
            source: live.source && { ...live.source, slides },
          },
        })
      } else if (live.deckKey) markLiveStale(live.deckKey)
    }
    // The main process gave linked schedule items the new pages.
    const { service } = get()
    if (service?.items.some((item) => item.type === 'presentation' && item.payload.presentationId === presentation.id)) {
      refreshService(service.id).catch(console.error)
    }
  },

  presentationChanged(presentationId) {
    const s = get()
    if (s.live.powerPoint && s.live.deckKey && linkedPresentation(s, s.live.deckKey)?.id === presentationId) markLiveStale(s.live.deckKey)
  },

  async setPresentationLiveOptions(id, options) {
    const presentation = await window.api.presentations.setLiveOptions(id, options)
    set({ presentations: get().presentations.map((p) => (p.id === id ? presentation : p)) })
    if (options.livePowerPoint) prepareLivePowerPoint()
  },

  async setPresentationMode(id, mode) {
    get().presentationUpdated(await window.api.presentations.setMode(id, mode))
  },

  async setPresentationSlideUseImage(id, index, useImage) {
    get().presentationUpdated(await window.api.presentations.setSlideUseImage(id, index, useImage))
  },

  async updateNativeSlide(id, index, style) {
    get().presentationUpdated(await window.api.presentations.updateNativeSlide(id, index, style))
  },

  async detachPresentation(id) {
    get().presentationUpdated(await window.api.presentations.detach(id))
  },

  livePowerPointStatus(status) {
    const s = get()
    const failed = status.failures !== s.livePowerPoint.failures
    set({ livePowerPoint: status })
    const { live } = s
    if (!live.powerPoint) return
    const livePresentationId = linkedPresentation(s, live.deckKey)?.id
    if (failed) {
      // The still slide goes on the output in its place (unless it was another presentation that failed).
      if (status.presentationId === null || status.presentationId === livePresentationId) set({ live: { ...live, powerPoint: false } })
      return
    }
    if (status.slideIndex === null || status.slideIndex === live.slideIndex || livePresentationId !== status.presentationId) return
    if (status.phase !== 'showing' && status.phase !== 'covered') return
    // PowerPoint moved on: the live slide follows (no Go Back step for each), and so does the grid when it shows it.
    const slideIndex = Math.min(status.slideIndex, live.slides.length - 1)
    set({ live: { ...live, slideIndex }, ...(selectBrowsingLive(s) ? { highlightIndex: slideIndex } : {}) })
  },

  panicPowerPoint() {
    window.api.livePowerPoint.panic()
  },

  async songSaved(song) {
    const { selectedSong, highlightIndex, service, songsVersion } = get()
    set({ songsVersion: songsVersion + 1 })
    if (selectedSong?.id === song.id) {
      const slides = songSlides(song)
      set({
        selectedSong: song,
        deckTitle: song.title,
        slides,
        highlightIndex: slides.length === 0 ? null : Math.min(highlightIndex ?? 0, slides.length - 1),
      })
      await applySlideBackgrounds(loadToken, get().deckKey)
    }
    // The output keeps showing the version that went live; the operator decides when to resend.
    markLiveStale(`song:${song.id}`)
    if (service?.items.some((item) => item.type === 'song' && item.ref_id === song.id)) await refreshService(service.id)
  },

  async updateItemPayload(itemId, payload) {
    const { service } = get()
    if (!(await window.api.services.updatePayload(itemId, payload))) throw new Error('This item is no longer in the schedule.')
    if (service) await refreshService(service.id)
    const item = get().service?.items.find((i) => i.id === itemId)
    if (item && get().activeItemId === itemId && (item.type === 'scripture' || item.type === 'announcement')) {
      const slides = item.type === 'scripture' ? withFormats(item.payload.verses, item.payload.formats) : withFormats(announcementSlides(item.payload), item.payload.formats)
      const { highlightIndex } = get()
      set({ deckTitle: item.title, slides, highlightIndex: slides.length === 0 ? null : Math.min(highlightIndex ?? 0, slides.length - 1) })
      await applySlideBackgrounds(loadToken, get().deckKey)
    }
    // Like a saved song, the output keeps what went live until it is sent again.
    markLiveStale(`item:${itemId}`)
  },

  async songDeleted(id) {
    const { selectedSong, service, songsVersion, editingSongId } = get()
    set({ songsVersion: songsVersion + 1, editingSongId: editingSongId === id ? null : editingSongId })
    // Only the grid lets go of a deleted song; a live copy stays on screen until something else goes live.
    if (selectedSong?.id === id) get().selectSong(null)
    if (service?.items.some((item) => item.type === 'song' && item.ref_id === id)) await refreshService(service.id)
  },
}))

/** A copy of the grid's item, with its theme resolved, for going live. */
function snapshotOf(s: OperatorState): Omit<LiveState, 'slideIndex' | 'mode' | 'stale' | 'alert' | 'lowerThird' | 'powerPoint' | 'powerPointCue'> {
  return {
    itemType: s.deckType,
    itemId: s.deckType === 'song' ? (s.selectedSong?.id ?? null) : s.activeItemId,
    deckKey: s.deckKey,
    scheduleItemId: s.activeItemId,
    title: s.deckTitle,
    slides: s.slides,
    theme: selectDeckTheme(s),
    source: {
      selectedSong: s.selectedSong,
      deckTitle: s.deckTitle,
      slides: s.slides,
      deckType: s.deckType,
      deckKey: s.deckKey,
      deckThemeId: s.deckThemeId,
      activeItemId: s.activeItemId,
    },
  }
}

const MAX_LIVE_HISTORY = 50

/** The Go Back history once `next` replaces what is live: what was on screen is added, unless the slide is the same. */
function historyBefore(s: OperatorState, next: LiveState): LiveState[] {
  const { live } = s
  if (live.slideIndex === null) return s.liveHistory
  const sameSlide =
    live.deckKey === next.deckKey && next.slideIndex !== null && live.slides[live.slideIndex]?.text === next.slides[next.slideIndex]?.text
  return sameSlide ? s.liveHistory : [...s.liveHistory, live].slice(-MAX_LIVE_HISTORY)
}

/** Puts slide `index` of `slides` (the live item's, perhaps with a verse added) on screen. Scripture in the grid follows along. */
function showLiveSlide(slides: DeckSlide[], index: number): void {
  const s = useOperatorStore.getState()
  // Stepping onto an animated slide hands it to PowerPoint.
  const powerPoint = playsInPowerPoint(s, s.live.deckKey, slides[index])
  const live: LiveState = { ...s.live, slides, slideIndex: index, powerPoint, powerPointCue: powerPoint ? ++powerPointCues : 0 }
  const follow = s.live.itemType === 'scripture' && selectBrowsingLive(s)
  const left = leaveSlide(s, live)
  useOperatorStore.setState({ ...left, liveHistory: historyBefore(s, live), ...(follow ? { slides: left.live.slides, highlightIndex: index } : {}) })
}

/** True while the next or previous verse is being read, so key presses meanwhile do not skip ahead. */
let stepping = false

function stepLive(delta: 1 | -1): void {
  const { live } = useOperatorStore.getState()
  if (live.slides.length === 0 || stepping) return
  // PowerPoint plays the build steps, then moves to the next slide; the live slide follows its status.
  if (live.powerPoint) {
    const step = delta > 0 ? window.api.livePowerPoint.next() : window.api.livePowerPoint.previous()
    step.catch(console.error)
    return
  }
  const target = live.slideIndex === null ? 0 : live.slideIndex + delta
  if (target >= 0 && target < live.slides.length) return showLiveSlide(live.slides, target)
  if (live.itemType !== 'scripture' || live.slideIndex === null) return
  stepping = true
  neighbourVerse(live.slides[live.slideIndex], delta)
    .then((verse) => {
      const current = useOperatorStore.getState().live
      // Something else went live meanwhile.
      if (!verse || current.slides !== live.slides || current.slideIndex !== live.slideIndex) return
      const slides = delta > 0 ? [...live.slides, verse] : [verse, ...live.slides]
      showLiveSlide(slides, delta > 0 ? slides.length - 1 : 0)
    })
    .catch(console.error)
    .finally(() => {
      stepping = false
    })
}

/** Past the end of the longest chapter, to read a whole chapter. */
const LAST_VERSE = 999

/**
 * The verse after (or before) a scripture slide's verse, crossing into the next (or previous) chapter, in the slide's
 * translation (and its second one, where that has the verse); null at either end of the book.
 */
async function neighbourVerse(slide: DeckSlide, delta: 1 | -1): Promise<DeckSlide | null> {
  const at = parseVerseCaption(slide.caption)
  if (!at) return null
  const read = (chapter: number, from: number, to: number, version = at.version) => window.api.bible.getRange(version, at.book, chapter, from, to)
  let found: Verse | undefined
  if (delta > 0) found = (await read(at.chapter, at.verse + 1, at.verse + 1))[0] ?? (await read(at.chapter + 1, 1, 1))[0]
  else if (at.verse > 1) found = (await read(at.chapter, at.verse - 1, at.verse - 1))[0]
  else if (at.chapter > 1) found = (await read(at.chapter - 1, 1, LAST_VERSE)).at(-1)
  if (!found) return null
  const other = at.second && slide.second ? (await read(found.chapter, found.verse, found.verse, at.second))[0] : undefined
  if (!other || !slide.second) return { text: found.text, caption: verseCaption(found, at.version) }
  return { text: found.text, caption: verseCaption(found, at.version, at.second), second: { text: other.text, layout: slide.second.layout } }
}

// ---------- Translations ----------

/** How long a translation note stays up; a note about missing verses stays until dismissed or replaced. */
const NOTE_MS = 6000
let noteTimer: ReturnType<typeof setTimeout> | undefined

function noteTranslation(where: TranslationTarget, text: string, error = false): void {
  clearTimeout(noteTimer)
  useOperatorStore.setState({ translationNote: { where, text, error } })
  if (!error) noteTimer = setTimeout(() => useOperatorStore.setState({ translationNote: null }), NOTE_MS)
}

/** Reads the preview's or the live scripture in `to` (see switchTranslation), unless something else was loaded meanwhile. */
async function retranslate(where: TranslationTarget, to: Translation): Promise<void> {
  const s = useOperatorStore.getState()
  const live = where === 'live'
  if (live ? s.live.itemType !== 'scripture' || s.live.slideIndex === null : s.deckType !== 'scripture') return
  const slides = live ? s.live.slides : s.slides
  const result = await translateSlides(slides, (live ? s.live.title : s.deckTitle) ?? '', to)
  if (!result.ok) return noteTranslation(where, missingNote(result.missing), true)
  const now = useOperatorStore.getState()
  const label = to.second ? `${to.version} and ${to.second.version}` : `${to.version}`
  const cleared = result.clearedFormatting ? ' Highlights were cleared, since the words changed.' : ''
  if (!live) {
    if (now.slides !== slides) return
    useOperatorStore.setState({ slides: result.slides, deckTitle: result.title })
    // Like an edit, the output keeps what went live until it is sent again.
    if (now.deckKey) markLiveStale(now.deckKey)
    return noteTranslation(where, `Preview shows the ${label}.${cleared}`)
  }
  if (now.live.slides !== slides) return
  const browsing = selectBrowsingLive(now)
  if (!now.settings.scriptureSwitchLiveImmediately) {
    // The new translation waits in the preview, and the live copy is marked out of date for a resend.
    if (!browsing) now.jumpToLive()
    useOperatorStore.setState({ slides: result.slides, deckTitle: result.title, highlightIndex: now.live.slideIndex })
    if (now.live.deckKey) markLiveStale(now.live.deckKey)
    return noteTranslation(where, `The ${label} is in the preview; resend to show it live.${cleared}`)
  }
  // The output crossfades to the same verse in the new words; Go Back returns to the old translation.
  const next: LiveState = {
    ...now.live,
    slides: result.slides,
    title: result.title,
    stale: browsing ? false : now.live.stale,
    source: now.live.source && { ...now.live.source, slides: result.slides, deckTitle: result.title },
  }
  useOperatorStore.setState({
    live: next,
    liveHistory: historyBefore(now, next),
    ...(browsing ? { slides: result.slides, deckTitle: result.title } : {}),
  })
  noteTranslation(where, `Live shows the ${label}.${cleared}`)
}

/** With two translations on, scripture that comes into the grid shows its second translation too. */
async function showDualInGrid(token: number): Promise<void> {
  const s = useOperatorStore.getState()
  const dual = s.settings.scriptureDual
  const current = slideTranslation(s.slides.find((slide) => slideTranslation(slide)))
  if (!dual.enabled || s.deckType !== 'scripture' || !current || current.second === dual.second || current.version === dual.second) return
  const result = await translateSlides(s.slides, s.deckTitle ?? '', { version: current.version, second: { version: dual.second, layout: dual.layout } }).catch(
    (err) => {
      console.error(err)
      return null
    },
  )
  if (!result || token !== loadToken || useOperatorStore.getState().slides !== s.slides) return
  if (result.ok) useOperatorStore.setState({ slides: result.slides, deckTitle: result.title })
  else noteTranslation('preview', missingNote(result.missing), true)
}

// ---------- Live highlighting ----------

/** Slides of words can be marked: scripture, songs, announcements and quotes (the Stream's lower third shows the same live slide). */
const MARKABLE: (DeckType | null)[] = ['scripture', 'song', 'announcement', 'quote']

/** The live or preview slide, when its words can be marked. */
export function selectMarkTarget(s: OperatorState, where: TranslationTarget): { slide: DeckSlide; index: number } | null {
  const live = where === 'live'
  const index = live ? s.live.slideIndex : s.highlightIndex
  const slide = index === null ? undefined : (live ? s.live.slides : s.slides)[index]
  if (index === null || !slide || !MARKABLE.includes(live ? s.live.itemType : s.deckType)) return null
  return slide.page || slide.native || !slide.text.trim() ? null : { slide, index }
}

/** The last marking, so the second click of a double click can replace it. */
let lastMark: { where: TranslationTarget; before: DeckSlide; after: DeckSlide } | null = null

/** Marks kept with schedule items while the app is open (Keep highlights with the schedule item): by item id, then slide text. */
const keptMarks = new Map<number, Map<string, Pick<DeckSlide, 'rich' | 'unmarked'>>>()

/** Puts a changed live or preview slide in place. It is not a slide change, so Go Back skips it. */
function putSlide(where: TranslationTarget, index: number, slide: DeckSlide): void {
  const s = useOperatorStore.getState()
  const replace = (slides: DeckSlide[]) => slides.map((old, i) => (i === index ? slide : old))
  if (where === 'live') {
    // The grid's copy of the live slide follows, so its thumbnail shows the change too.
    const grid = selectBrowsingLive(s) && s.slides[index]?.text === slide.text ? { slides: replace(s.slides) } : {}
    useOperatorStore.setState({ live: { ...s.live, slides: replace(s.live.slides) }, ...grid })
  } else useOperatorStore.setState({ slides: replace(s.slides) })
}

/** Puts a newly marked (or unmarked) live or preview slide in place. */
function putMarked(where: TranslationTarget, index: number, slide: DeckSlide): void {
  const s = useOperatorStore.getState()
  putSlide(where, index, slide)
  const itemId = where === 'live' ? s.live.scheduleItemId : s.activeItemId
  if (!s.settings.highlightKeepWithItem || itemId === null) return
  const kept = keptMarks.get(itemId) ?? new Map()
  keptMarks.set(itemId, kept)
  if (isMarked(slide)) kept.set(slide.text, { rich: slide.rich, unmarked: slide.unmarked })
  else kept.delete(slide.text)
}

/** A schedule item's slides with the marks kept with it, on slides whose own formatting is still what they were made on. */
function withKeptMarks(itemId: number, slides: DeckSlide[]): DeckSlide[] {
  const kept = useOperatorStore.getState().settings.highlightKeepWithItem ? keptMarks.get(itemId) : undefined
  if (!kept) return slides
  return slides.map((slide) => {
    const marks = kept.get(slide.text)
    return marks && JSON.stringify(slideRich(slide)) === JSON.stringify(marks.unmarked) ? { ...slide, ...marks } : slide
  })
}

// ---------- Scripture quick adjustments ----------

/** The live or preview verse, for quick adjustments: scripture slides only. */
export function selectAdjustTarget(s: OperatorState, where: TranslationTarget): { slide: DeckSlide; index: number } | null {
  const live = where === 'live'
  const index = live ? s.live.slideIndex : s.highlightIndex
  const slide = index === null ? undefined : (live ? s.live.slides : s.slides)[index]
  if (index === null || !slide || (live ? s.live.itemType : s.deckType) !== 'scripture') return null
  return { slide, index }
}

/** The open service's own scripture look (Apply to this service only), if it has one. */
export function selectServiceLook(s: OperatorState): ScriptureAdjust | undefined {
  const own = s.service ? s.settings.scriptureServiceLooks[String(s.service.id)] : undefined
  return isEmptyAdjust(own) ? undefined : own
}

function withoutAdjust(slide: DeckSlide): DeckSlide {
  const next = { ...slide }
  delete next.adjust
  return next
}

/** Slides with the marks taken off slide `index`. */
function unmarkAt(slides: DeckSlide[], index: number | null): DeckSlide[] {
  const slide = index === null ? undefined : slides[index]
  return slide && isMarked(slide) ? slides.map((old) => (old === slide ? unmarkSlide(slide) : old)) : slides
}

/**
 * Clear highlights when the slide changes: the slide leaving the screen loses its marks, in the live copy and in the
 * grid's copy when the grid shows the live item. The slide coming on keeps any marks it brings from the preview.
 */
function leaveSlide(s: OperatorState, next: LiveState): { live: LiveState; slides?: DeckSlide[] } {
  const index = s.live.slideIndex
  const leaving = index === null ? undefined : s.live.slides[index]
  if (!s.settings.highlightClearOnSlideChange || index === null || !leaving || !isMarked(leaving)) return { live: next }
  const holds = (slides: DeckSlide[], deckKey: string | null) => deckKey === s.live.deckKey && slides[index]?.text === leaving.text
  if (holds(next.slides, next.deckKey) && next.slideIndex === index) return { live: next }
  return {
    live: holds(next.slides, next.deckKey) ? { ...next, slides: unmarkAt(next.slides, index) } : next,
    ...(holds(s.slides, s.deckKey) ? { slides: unmarkAt(s.slides, index) } : {}),
  }
}

// ---------- Alert ticker ----------

/** Ends the current run: after its last loop, or when a priority message finishes. Never repaints anything. */
let tickerTimer: ReturnType<typeof setTimeout> | undefined
let tickerRuns = 0

const newRun = (texts: string[], loops: number, riches: (RichText | null)[]): TickerRun => ({ runId: ++tickerRuns, texts, riches, startedAt: Date.now(), loops })

/** A message's formatting, trimmed like its text, or null. */
const alertRich = (message: AlertMessage): RichText | null => matching(message.rich && trimRich(message.rich), message.text.trim())

/** A lower third line trimmed, keeping each field's formatting while it still matches its words. */
function trimLowerThirdLine(line: LowerThirdLine): LowerThirdLine {
  const headline = line.headline.trim()
  const body = line.body.trim()
  const headlineRich = matching(line.headlineRich && trimRich(line.headlineRich), headline)
  const bodyRich = matching(line.bodyRich && trimRich(line.bodyRich), body)
  return { headline, body, ...(headlineRich ? { headlineRich } : {}), ...(bodyRich ? { bodyRich } : {}) }
}

function setTicker(alert: LiveTicker | null): void {
  const { live } = useOperatorStore.getState()
  useOperatorStore.setState({ live: { ...live, alert } })
}

function stopTicker(): void {
  clearTimeout(tickerTimer)
  setTicker(null)
}

const LOWER_THIRD_HISTORY = 30
let lowerThirdRuns = 0
let lowerThirdTimer: ReturnType<typeof setTimeout> | undefined

/** Calls `onEnd` once `run` has gone through its loops on the projector; endless runs have no end. */
function scheduleRunEnd(run: TickerRun, onEnd: () => void): void {
  clearTimeout(tickerTimer)
  if (run.loops === 0) return
  const { alertLayout, alertFontSize, alertSpeed } = useOperatorStore.getState().settings
  const remaining = runDurationMs(run.texts, run.loops, alertLayout, alertFontSize, alertSpeed) - (Date.now() - run.startedAt)
  tickerTimer = setTimeout(onEnd, Math.max(0, remaining))
}

/** The priority message is done: the normal messages carry on from where they were paused, or the ticker stops. */
function endPriority(): void {
  const ticker = useOperatorStore.getState().live.alert
  if (!ticker?.normal) return stopTicker()
  const normal = { ...ticker.normal, startedAt: Date.now() - (ticker.pausedAt ?? 0) }
  setTicker({ ...ticker, normal, priority: null, pausedAt: null })
  scheduleRunEnd(normal, stopTicker)
}

/** The ticker the audience sees: none while hidden or in Black, and none in Clear unless the setting keeps it. */
export function selectAlertDisplay(s: OperatorState): AlertDisplay | null {
  const ticker = s.live.alert
  const run = ticker?.priority ?? ticker?.normal
  if (!ticker || !run || ticker.hidden || s.live.mode === 'black') return null
  if (s.live.mode === 'clear' && !s.settings.alertKeepOnClear) return null
  const { settings } = s
  return {
    runId: run.runId,
    texts: run.texts,
    riches: run.riches,
    startedAt: run.startedAt,
    loops: run.loops,
    layout: settings.alertLayout,
    priority: ticker.priority !== null,
    position: settings.alertPosition,
    speed: settings.alertSpeed,
    fontSize: settings.alertFontSize,
    textColor: settings.alertTextColor,
    bandColor: ticker.priority ? PRIORITY_BAND_COLOR : settings.alertBandColor,
    bandOpacity: ticker.priority ? Math.max(settings.alertBandOpacity, 0.9) : settings.alertBandOpacity,
    bandHeight: settings.alertBandHeight,
  }
}

// ---------- Live PowerPoint ----------

let powerPointCues = 0

/** Whether sending this slide hands it to PowerPoint: an animated slide of a PowerPoint file, with Live PowerPoint on for it. */
function playsInPowerPoint(s: OperatorState, deckKey: string | null, slide: DeckSlide | undefined): boolean {
  // A Native mode slide draws itself, so a motion background shared with its neighbours keeps playing.
  if (!s.settings.presentationLivePowerPoint || !slide?.animated || slide.native) return false
  const presentation = linkedPresentation(s, deckKey)
  return !!presentation && presentation.livePowerPoint && (presentation.kind === 'pptx' || presentation.kind === 'ppt')
}

/** Opens the schedule's presentations in PowerPoint in the background (the main process picks the animated ones). */
function prepareLivePowerPoint(): void {
  const { service, settings } = useOperatorStore.getState()
  if (!settings.presentationLivePowerPoint || !service) return
  const ids = service.items.flatMap((item) => (item.type === 'presentation' && item.payload.presentationId !== undefined ? [item.payload.presentationId] : []))
  if (ids.length > 0) window.api.livePowerPoint.prepare(ids)
}

/**
 * What PowerPoint should do, or null when it plays nothing. It is covered (not visible) whenever the output shows
 * anything else over the slide: Black, Clear, Logo, the test pattern, an alert or a lower third.
 */
export function selectPowerPointTarget(s: OperatorState): PowerPointTarget | null {
  const { live } = s
  if (!s.settings.presentationLivePowerPoint || !live.powerPoint || live.slideIndex === null) return null
  const presentation = linkedPresentation(s, live.deckKey)
  if (!presentation?.livePowerPoint) return null
  const output = selectOutputState(s)
  const visible = live.mode === 'show' && !output.testPattern && !output.alert && !output.overlays?.lowerThird
  return { presentationId: presentation.id, slideIndex: live.slideIndex, visible, generation: s.powerPointGeneration, cue: live.powerPointCue }
}

/** Notes that the live item changed after it went live, without touching what is on screen. */
function markLiveStale(deckKey: string): void {
  const { live } = useOperatorStore.getState()
  if (live.deckKey === deckKey && !live.stale) useOperatorStore.setState({ live: { ...live, stale: true } })
}

/** The title and author (the theme's Reference box) and the copyright line show on the first slide. */
function songSlides(song: Song): DeckSlide[] {
  const titleLine = [song.title, song.author].filter(Boolean).join(' · ')
  return buildSongSlides(song.lyrics, song.arrangement).map(({ text, label }, index) => ({
    text,
    ...richOf(song.formatting, text),
    caption: index === 0 ? titleLine : '',
    copyright: index === 0 ? (song.copyright ?? '') : '',
    label: label ?? undefined,
  }))
}

const richOf = (formats: SlideFormats | undefined, text: string) => {
  const rich = formatFor(formats, text)
  return rich ? { rich } : {}
}

/** Scripture or announcement slides with their stored formatting. */
const withFormats = (slides: { text: string; caption: string }[], formats: SlideFormats | undefined): DeckSlide[] =>
  slides.map((slide) => ({ ...slide, ...richOf(formats, slide.text) }))

const mediaBackground = (item: MediaItem): ThemeBackground =>
  item.kind === 'video' ? { kind: 'video', src: item.url } : { kind: 'image', src: item.url }

/** Slides with their stored per-slide backgrounds applied (presentation pages keep their own). */
/**
 * One full-slide picture per page, with the original's text, notes and animation marks. In Native mode each slide
 * draws its own theme instead, unless Native mode cannot draw it or it was set to show its picture.
 */
export function presentationSlides(presentation: Presentation): DeckSlide[] {
  return presentation.slides.map((slide) => {
    const native = presentation.mode === 'native' ? slide.native : undefined
    return {
      text: '',
      caption: '',
      background: { kind: 'image', src: slide.image, fit: 'contain' },
      page: true,
      pageText: slide.text,
      notes: slide.notes,
      animated: slide.animated,
      ...(native?.style && !native.useImage ? { native: native.style } : {}),
      ...(native && native.warnings.length > 0 ? { warnings: native.warnings } : {}),
    }
  })
}

/** The library presentation the grid shows, directly or through a schedule item. */
export const selectDeckPresentation = (s: OperatorState) => linkedPresentation(s, s.deckKey)

/** The library presentation a deck shows: 'presentation:<id>', or a schedule item made from one. */
function linkedPresentation(s: OperatorState, deckKey: string | null): Presentation | undefined {
  let id: number | undefined
  if (deckKey?.startsWith('presentation:')) id = Number(deckKey.slice('presentation:'.length))
  else if (deckKey?.startsWith('item:')) {
    const item = s.service?.items.find((i) => `item:${i.id}` === deckKey)
    if (item?.type === 'presentation') id = item.payload.presentationId
  }
  return id === undefined ? undefined : s.presentations.find((p) => p.id === id)
}

function withBackgrounds(slides: DeckSlide[], overrides: Record<number, MediaItem>): DeckSlide[] {
  return slides.map((slide, index) => {
    if (slide.page) return slide
    const override = overrides[index]
    if (override) return { ...slide, background: mediaBackground(override) }
    return slide.background ? { ...slide, background: undefined } : slide
  })
}

/** Merges a deck's stored slide backgrounds into the grid's slides, unless another deck was loaded meanwhile. */
async function applySlideBackgrounds(token: number, deckKey: string | null): Promise<void> {
  if (!deckKey) return
  try {
    const overrides = await window.api.media.getSlideBackgrounds(deckKey)
    if (token !== loadToken) return
    useOperatorStore.setState((s) => ({ slides: withBackgrounds(s.slides, overrides) }))
  } catch (err) {
    console.error(err)
  }
}

type ScheduleTarget = (type: ServiceItemType, refId: number | null, payload: ServiceItemPayload | null) => Promise<boolean>

let scheduleTarget: ScheduleTarget | null = null

/** Where Add to schedule puts items while a shared service is open; it resolves to false to use the open service. */
export function setScheduleTarget(target: ScheduleTarget | null): void {
  scheduleTarget = target
}

async function refreshService(id: number): Promise<void> {
  const service = (await window.api.services.get(id)) ?? null
  // Ignore the result if the operator switched services meanwhile.
  if (useOperatorStore.getState().service?.id === id) useOperatorStore.setState({ service })
}

/** The slide on the projector, or null. */
export function selectLiveSlide(s: OperatorState): DeckSlide | null {
  return s.live.slideIndex === null ? null : (s.live.slides[s.live.slideIndex] ?? null)
}

/** The highlighted slide of the grid's item, shown in the preview. */
export function selectPreviewSlide(s: OperatorState): DeckSlide | null {
  return s.highlightIndex === null ? null : (s.slides[s.highlightIndex] ?? null)
}

/** True when the grid shows the item that is live. */
export function selectBrowsingLive(s: OperatorState): boolean {
  return s.live.deckKey !== null && s.live.deckKey === s.deckKey
}

/** The default theme for a content type, or Classic Black before the themes load. */
export function selectDefaultTheme(s: OperatorState, type: ThemeContentType): ThemeStyle {
  const id = s.themeDefaults?.[type]
  return s.themes.find((t) => t.id === id)?.style ?? DEFAULT_THEME_STYLE
}

/** What the output window renders. Read only from the live snapshot, so browsing never changes it. Logo shows the Logo theme. */
export function selectOutputState(s: OperatorState): OutputState {
  const live = selectLiveSlide(s)
  return {
    mode: s.live.mode,
    text: live?.text ?? '',
    caption: live?.caption ?? '',
    copyright: live?.copyright ?? '',
    rich: live?.rich ?? null,
    theme: s.live.mode === 'logo' ? selectDefaultTheme(s, 'logo') : slideTheme(s.live.theme, live),
    fadeMs: s.settings.fadeMs,
    logoUrl: s.settings.logoUrl,
    defaultFont: s.settings.defaultFont,
    screenMargins: s.settings.screenMargins,
    testPattern: s.outputTestPattern,
    alert: selectAlertDisplay(s),
    // Black turns everything off; otherwise the overlays reach the projector only when the setting says so.
    overlays:
      s.settings.overlaysOnChurchScreen && s.live.mode !== 'black' ? selectOverlayLayers(s, s.live.mode === 'show' || s.live.mode === 'logo') : null,
  }
}

/** The lower third template in use: the chosen one, else the first built-in. */
export function selectLowerThirdStyle(s: OperatorState): LowerThirdStyle {
  const { lowerThirdTemplates: templates, settings } = s
  return (templates.find((t) => t.id === settings.lowerThirdTemplateId) ?? templates[0])?.style ?? DEFAULT_LOWER_THIRD_STYLE
}

/**
 * The lower third as the screens draw it, or null. Over a full screen slide (`overFullSlide`) it hides unless the
 * setting keeps it on top.
 */
export function selectLowerThirdDisplay(s: OperatorState, overFullSlide: boolean): LowerThirdDisplay | null {
  const lowerThird = s.live.lowerThird
  if (!lowerThird || (overFullSlide && !s.settings.lowerThirdOverFullSlide)) return null
  return {
    runId: lowerThird.runId,
    headline: lowerThird.headline,
    body: lowerThird.body,
    ...(lowerThird.headlineRich ? { headlineRich: lowerThird.headlineRich } : {}),
    ...(lowerThird.bodyRich ? { bodyRich: lowerThird.bodyRich } : {}),
    style: selectLowerThirdStyle(s),
    animation: s.settings.lowerThirdAnimation,
    durationMs: s.settings.lowerThirdDurationMs,
  }
}

/** The overlay layers: the logos that are on (unless the logo layer is hidden), then the lower third. */
export function selectOverlayLayers(s: OperatorState, overFullSlide: boolean): OverlayLayers {
  return {
    logos: s.settings.logoLayerVisible ? s.settings.logoItems.filter((logo) => logo.enabled) : [],
    lowerThird: selectLowerThirdDisplay(s, overFullSlide),
  }
}

/**
 * What the Stream output renders, from the live snapshot. Black blacks out the whole stream. Clear, or slide content
 * set to Hide, empties the slide layer so only the key color and the overlays show; otherwise the live slide covers
 * them with its own background.
 */
export function selectStreamState(s: OperatorState): StreamState {
  const { mode, text, caption, copyright, rich, theme: slideLook, fadeMs, logoUrl, defaultFont } = selectOutputState(s)
  const { streamKeyMode, streamKeyColor, streamResolution, streamSlideContent } = s.settings
  const [width, height] = streamResolution.split('x').map(Number)
  const streamMode = mode === 'black' ? 'black' : streamSlideContent === 'hide' ? 'clear' : mode
  // Slides (not the Logo theme) can go to the stream in the default Lower Third theme instead of their own.
  const lowerThird = streamSlideContent === 'lowerThird' && mode !== 'logo' && !selectLiveSlide(s)?.page
  const theme = lowerThird ? selectDefaultTheme(s, 'lowerThird') : slideLook
  const overlays = selectOverlayLayers(s, streamMode === 'show' || streamMode === 'logo')
  return {
    mode: streamMode,
    text,
    caption,
    copyright,
    rich,
    theme,
    fadeMs,
    logoUrl,
    defaultFont,
    keyMode: streamKeyMode,
    keyColor: streamKeyColor,
    width,
    height,
    // Black blacks out the whole stream, the lower third included.
    overlays: streamMode === 'black' ? { ...overlays, lowerThird: null } : overlays,
    lowerThirdOnTop: s.settings.lowerThirdOverFullSlide,
    testPattern: s.streamTestPattern,
  }
}

/** What the stage display shows the worship leader, from the live snapshot only. */
export function selectStageState(s: OperatorState): StageState {
  const { live } = s
  const current = selectLiveSlide(s)
  const next = live.slides[live.slideIndex === null ? 0 : live.slideIndex + 1] ?? null
  const items = s.service?.items ?? []
  const nextItem = live.scheduleItemId === null ? undefined : items[items.findIndex((item) => item.id === live.scheduleItemId) + 1]
  return {
    current: current ? { text: current.text, caption: current.caption, rich: current.rich ?? null } : null,
    next: next ? { text: next.text, caption: next.caption, rich: next.rich ?? null } : null,
    title: live.title,
    nextItemTitle: nextItem?.title ?? null,
    mode: live.mode,
    alert: selectAlertDisplay(s),
  }
}

/** A Native mode slide's own theme, or a slide's own background in place of the theme's; a second translation gets a second text box. */
export function slideTheme(theme: ThemeStyle, slide: DeckSlide | null | undefined): ThemeStyle {
  if (slide?.native) return slide.native
  // Quick adjustments go on first, so both translations of a dual slide take them.
  const adjusted = adjustTheme(theme, slide?.adjust)
  const look = slide?.second ? dualTheme(adjusted, slide.second) : adjusted
  if (!slide?.background) return look
  // A presentation page is the whole slide, so the theme's shapes and images stay off it.
  return {
    ...look,
    background: slide.background,
    overlay: slide.page ? 0 : look.overlay,
    keyTransparent: false,
    elements: slide.page ? [] : look.elements,
  }
}

/** The translation references open in: the service's own choice from the schedule header, else Settings, Scripture. */
export function selectDefaultTranslation(s: OperatorState): BibleVersionCode {
  const own = s.service ? s.settings.scriptureServiceVersions[String(s.service.id)] : undefined
  const choice = own ?? s.settings.scriptureDefaultVersion
  // A version removed since falls back to the first one installed.
  return s.bibleVersions.length === 0 || s.bibleVersions.some((v) => v.code === choice) ? choice : s.bibleVersions[0].code
}

/**
 * Where Cmd+1 to 9 (Ctrl+1 to 9) and Alt+Shift+Up and Down change the translation, and Cmd+Plus and Minus and Alt+Up
 * and Down adjust the verse: the live scripture while the grid shows it or holds no scripture, as Up and Down step the
 * live verse; otherwise the preview's.
 */
export function selectTranslationTarget(s: OperatorState): TranslationTarget | null {
  const liveScripture = s.live.itemType === 'scripture' && s.live.slideIndex !== null
  if (liveScripture && (selectBrowsingLive(s) || s.deckType !== 'scripture')) return 'live'
  if (s.deckType === 'scripture' && s.slides.length > 0) return 'preview'
  return null
}

/** The theme the default for what is loaded would use, ignoring the picker: the song's own theme, else the content type's default. */
export function selectBaseThemeId(s: OperatorState): number | null {
  if (s.deckType === 'song' && s.selectedSong?.themeId && s.themes.some((t) => t.id === s.selectedSong?.themeId)) {
    return s.selectedSong.themeId
  }
  // Presentations draw their own pages, so any theme does; use the song default.
  const type = s.deckType === null || s.deckType === 'presentation' ? 'song' : s.deckType
  return s.themeDefaults?.[type] ?? null
}

/** The last theme with a service's scripture look over it, so the selector returns the same object until either changes. */
let serviceLookCache: { theme: ThemeStyle; look: ScriptureAdjust; result: ThemeStyle } | null = null

/** The style the grid and preview use for what is loaded; it goes live with the item. Scripture takes the service's own look. */
export function selectDeckTheme(s: OperatorState): ThemeStyle {
  const id = s.deckThemeId ?? selectBaseThemeId(s)
  const theme = s.themes.find((t) => t.id === id)?.style ?? s.themes[0]?.style ?? DEFAULT_THEME_STYLE
  const look = s.deckType === 'scripture' ? selectServiceLook(s) : undefined
  if (!look) return theme
  if (serviceLookCache?.theme !== theme || serviceLookCache.look !== look) serviceLookCache = { theme, look, result: adjustTheme(theme, look) }
  return serviceLookCache.result
}
