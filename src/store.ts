import { create } from 'zustand'
import { buildSongSlides } from '../shared/lyrics'
import { DEFAULT_THEME_STYLE } from '../shared/themes'
import type {
  AlertDisplay,
  AlertMessage,
  AppSettings,
  MediaItem,
  OutputMode,
  OutputState,
  ServiceItemPayload,
  ServiceItem,
  ServiceItemType,
  ServiceWithItems,
  Song,
  StageState,
  Theme,
  ThemeBackground,
  ThemeDefaults,
  ThemeStyle,
  Verse,
} from '../shared/types'
import { announcementSlides, parseVerseCaption, quoteSlide, verseCaption } from './lib/slides'

export interface DeckSlide {
  text: string
  /** Small line under the text on the output: a scripture reference, or a song's copyright on its first slide. */
  caption: string
  /** Song section shown on the slide card only, such as "Chorus". */
  label?: string
  /** Replaces the theme's background for this slide: a library item dropped on it, or a presentation page. */
  background?: ThemeBackground
  /** A presentation page: the image is the whole slide, so the theme's darkening is not applied. */
  page?: boolean
}

/** What the grid holds: a schedule item type, or a quote (a sermon statement, with the Quote theme default). */
export type DeckType = ServiceItemType | 'quote'

/** The browse fields that describe what the grid shows; kept with a live snapshot so the grid can jump back to it. */
type BrowseSnapshot = Pick<
  OperatorState,
  'selectedSong' | 'deckTitle' | 'slides' | 'deckType' | 'deckKey' | 'deckThemeId' | 'activeItemId'
>

/** The alert on the output: which message, and whether its band is up right now (a loop alert comes and goes). */
export interface LiveAlert {
  /** Changes every time the band appears, so the output fades it in again. */
  key: number
  message: AlertMessage
  visible: boolean
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
  /** The alert band over the output. It belongs to the output, not the slide: going live or changing slides keeps it. */
  alert: LiveAlert | null
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
}

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
  /** Alerts waiting for the one on screen to finish, oldest first. */
  alertQueue: AlertMessage[]
  /** The saved message shown last, so Next can move on to the one after it. */
  lastAlertId: string | null

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
  /** The service open in the schedule panel. */
  service: ServiceWithItems | null
  /** The song open in the editor, which takes the slide grid's place. */
  editingSongId: number | null
  /** Bumped whenever a song is saved or deleted, so the song list reloads. */
  songsVersion: number
  /** Bumped when the media library changes, so every view of it reloads. */
  mediaVersion: number

  /** Shows a song in the grid and preview. Never touches what is live. */
  selectSong(song: Song | null): void
  /** Shows scripture verses in the grid and preview, in place of a song. Never touches what is live. */
  selectScripture(title: string, slides: DeckSlide[]): void
  /** Shows a sermon statement as a quote slide in the grid and preview. Never touches what is live. */
  selectQuote(text: string, speaker: string): void
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
  /**
   * Puts an alert over the output. A priority alert, or any alert when none is up, shows at once; otherwise it waits
   * for the current one to finish.
   */
  showAlert(message: AlertMessage): void
  /** Moves on to the next waiting alert, or else the saved message after the last one shown. */
  nextAlert(): void
  /** Takes the alert off the output and drops any waiting ones. */
  hideAlert(): void
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
  /** Closes the song editor, theme editor and settings so the slide grid shows. */
  showGrid(): void
  mediaChanged(): void
  /** Tells the song list to reload, after an import for example. */
  songsChanged(): void
  /** Refreshes the grid and schedule after the editor saves a song; marks the live copy out of date if it is that song. */
  songSaved(song: Song): Promise<void>
  songDeleted(id: number): Promise<void>
}

/** Bumped by every grid load, so a slow song fetch for an old item cannot overwrite a newer selection. */
let loadToken = 0

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
  alertQueue: [],
  lastAlertId: null,
  settings: {
    alertMessages: [],
    alertPosition: 'bottom',
    alertSeconds: 10,
    alertKeepOnClear: true,
    fadeMs: 400,
    outputDisplay: 'auto',
    logoUrl: null,
    appearance: 'system',
    autosaveDrafts: true,
    backupFolder: null,
    backupIntervalMinutes: 0,
    lastBackupAt: null,
    aiEnabled: true,
    aiModel: 'claude-sonnet-5-5',
    autoGoLiveOnNext: false,
    micDeviceId: null,
    micProcessing: false,
    saveTranscripts: false,
    speechEngine: 'auto',
    whisperModel: 'base.en',
    whisperSpeed: {},
    scriptureDetection: true,
    detectionMinConfidence: 0.6,
    detectionAlert: 'off',
    aiScriptureFallback: false,
    quoteSpeakerName: '',
    statementPicking: false,
  },
  themes: [],
  themeDefaults: null,
  themeEditorOpen: false,
  settingsOpen: false,
  paletteOpen: false,
  stageOpen: false,
  outputOpen: true,
  service: null,
  editingSongId: null,
  songsVersion: 0,
  mediaVersion: 0,

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
    applySlideBackgrounds(token, deckKey)
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

  goLive(index) {
    const s = get()
    if (index < 0 || index >= s.slides.length) return
    const live: LiveState = { ...snapshotOf(s), slideIndex: index, mode: 'show', stale: false, alert: s.live.alert }
    set({ live, liveHistory: historyBefore(s, live), highlightIndex: index })
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
    const { liveHistory, live } = get()
    const previous = liveHistory[liveHistory.length - 1]
    if (!previous) return
    set({ live: { ...previous, mode: 'show', alert: live.alert }, liveHistory: liveHistory.slice(0, -1) })
  },

  showAlert(message) {
    const { alert } = get().live
    if (message.priority || !alert?.visible) return putAlert(message)
    if (alert.message.id === message.id) return
    set({ alertQueue: [...get().alertQueue.filter((m) => m.id !== message.id), message] })
  },

  nextAlert() {
    const { alertQueue, settings, lastAlertId } = get()
    if (alertQueue.length > 0) {
      set({ alertQueue: alertQueue.slice(1) })
      return putAlert(alertQueue[0])
    }
    const saved = settings.alertMessages
    if (saved.length === 0) return putAlert(null)
    putAlert(saved[(saved.findIndex((m) => m.id === lastAlertId) + 1) % saved.length])
  },

  hideAlert() {
    set({ alertQueue: [] })
    putAlert(null)
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
    }
    slides = withBackgrounds(slides, await window.api.media.getSlideBackgrounds(live.deckKey))
    const current = get().live
    if (current.deckKey !== live.deckKey) return
    set({ live: { ...current, slides, theme, slideIndex: clamp(slides.length), stale: false } })
  },

  async openService(id) {
    const service = id === null ? null : ((await window.api.services.get(id)) ?? null)
    set({ service, activeItemId: null })
  },

  async addToSchedule(type, refId, payload) {
    const { service } = get()
    if (!service) throw new Error('Create or pick a service first')
    await window.api.services.addItem(service.id, type, refId, payload)
    await refreshService(service.id)
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
      slides = item.payload.verses
    } else if (item.type === 'presentation') {
      slides = item.payload.pages.map((src) => ({ text: '', caption: '', background: { kind: 'image', src, fit: 'contain' }, page: true }))
    } else {
      slides = announcementSlides(item.payload)
    }

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

  // The song editor, theme editor and settings share the centre panel, so opening one closes the others.
  editSong(id) {
    set(id === null ? { editingSongId: null } : { editingSongId: id, themeEditorOpen: false, settingsOpen: false })
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
    set({ settings: await window.api.settings.get() })
  },

  async updateSettings(patch) {
    set({ settings: { ...get().settings, ...patch } })
    set({ settings: await window.api.settings.set(patch) })
  },

  async setFadeMs(fadeMs) {
    await get().updateSettings({ fadeMs })
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
    set(open ? { themeEditorOpen: true, editingSongId: null, settingsOpen: false } : { themeEditorOpen: false })
  },

  openSettings(open) {
    set(open ? { settingsOpen: true, editingSongId: null, themeEditorOpen: false } : { settingsOpen: false })
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open })
  },

  setStageOpen(open) {
    set({ stageOpen: open })
  },

  async toggleStage() {
    await (get().stageOpen ? window.api.stage.close() : window.api.stage.open())
  },

  setOutputOpen(open) {
    set({ outputOpen: open })
  },

  async toggleOutput() {
    await window.api.output.setOpen(!get().outputOpen)
  },

  showGrid() {
    set({ editingSongId: null, themeEditorOpen: false, settingsOpen: false })
  },

  mediaChanged() {
    set({ mediaVersion: get().mediaVersion + 1 })
  },

  songsChanged() {
    set({ songsVersion: get().songsVersion + 1 })
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

  async songDeleted(id) {
    const { selectedSong, service, songsVersion, editingSongId } = get()
    set({ songsVersion: songsVersion + 1, editingSongId: editingSongId === id ? null : editingSongId })
    // Only the grid lets go of a deleted song; a live copy stays on screen until something else goes live.
    if (selectedSong?.id === id) get().selectSong(null)
    if (service?.items.some((item) => item.type === 'song' && item.ref_id === id)) await refreshService(service.id)
  },
}))

/** A copy of the grid's item, with its theme resolved, for going live. */
function snapshotOf(s: OperatorState): Omit<LiveState, 'slideIndex' | 'mode' | 'stale' | 'alert'> {
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
  const live: LiveState = { ...s.live, slides, slideIndex: index }
  const follow = s.live.itemType === 'scripture' && selectBrowsingLive(s)
  useOperatorStore.setState({ live, liveHistory: historyBefore(s, live), ...(follow ? { slides, highlightIndex: index } : {}) })
}

/** True while the next or previous verse is being read, so key presses meanwhile do not skip ahead. */
let stepping = false

function stepLive(delta: 1 | -1): void {
  const { live } = useOperatorStore.getState()
  if (live.slides.length === 0 || stepping) return
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

/** The verse after (or before) a scripture slide's verse, crossing into the next (or previous) chapter; null at either end of the book. */
async function neighbourVerse(slide: DeckSlide, delta: 1 | -1): Promise<DeckSlide | null> {
  const at = parseVerseCaption(slide.caption)
  if (!at) return null
  const read = (chapter: number, from: number, to: number) => window.api.bible.getRange(at.version, at.book, chapter, from, to)
  let found: Verse | undefined
  if (delta > 0) found = (await read(at.chapter, at.verse + 1, at.verse + 1))[0] ?? (await read(at.chapter + 1, 1, 1))[0]
  else if (at.verse > 1) found = (await read(at.chapter, at.verse - 1, at.verse - 1))[0]
  else if (at.chapter > 1) found = (await read(at.chapter - 1, 1, LAST_VERSE)).at(-1)
  return found ? { text: found.text, caption: verseCaption(found, at.version) } : null
}

// ---------- Alerts ----------

/** The timer that ends the current showing of the alert, or brings a loop alert back. */
let alertTimer: ReturnType<typeof setTimeout> | undefined
let alertKey = 0

function setLiveAlert(alert: LiveAlert | null): void {
  const { live } = useOperatorStore.getState()
  useOperatorStore.setState({ live: { ...live, alert } })
}

/** Shows `message` now in place of any alert, or clears the alert with null. */
function putAlert(message: AlertMessage | null): void {
  clearTimeout(alertTimer)
  if (!message) return setLiveAlert(null)
  setLiveAlert({ key: ++alertKey, message, visible: true })
  useOperatorStore.setState({ lastAlertId: message.id })
  scheduleAlertEnd(message)
}

/** When a showing ends, a waiting alert takes over; else once alerts hide and loop alerts come back later. */
function scheduleAlertEnd(message: AlertMessage): void {
  if (message.repeat === 'hold') return
  const seconds = useOperatorStore.getState().settings.alertSeconds
  alertTimer = setTimeout(() => {
    const { alertQueue } = useOperatorStore.getState()
    if (alertQueue.length > 0) {
      useOperatorStore.setState({ alertQueue: alertQueue.slice(1) })
      return putAlert(alertQueue[0])
    }
    if (message.repeat === 'once') return setLiveAlert(null)
    setLiveAlert({ key: alertKey, message, visible: false })
    alertTimer = setTimeout(() => {
      setLiveAlert({ key: ++alertKey, message, visible: true })
      scheduleAlertEnd(message)
    }, Math.max(1, message.everySeconds - seconds) * 1000)
  }, seconds * 1000)
}

/** The alert band the audience sees: none in Black, and none in Clear unless the setting keeps it. */
export function selectAlertDisplay(s: OperatorState): AlertDisplay | null {
  const alert = s.live.alert
  if (!alert?.visible || s.live.mode === 'black') return null
  if (s.live.mode === 'clear' && !s.settings.alertKeepOnClear) return null
  return { key: alert.key, text: alert.message.text, priority: alert.message.priority, position: s.settings.alertPosition }
}

/** Notes that the live item changed after it went live, without touching what is on screen. */
function markLiveStale(deckKey: string): void {
  const { live } = useOperatorStore.getState()
  if (live.deckKey === deckKey && !live.stale) useOperatorStore.setState({ live: { ...live, stale: true } })
}

/** The copyright line shows under the first slide, styled by the theme's caption settings. */
function songSlides(song: Song): DeckSlide[] {
  return buildSongSlides(song.lyrics, song.arrangement).map(({ text, label }, index) => ({
    text,
    caption: index === 0 ? (song.copyright ?? '') : '',
    label: label ?? undefined,
  }))
}

const mediaBackground = (item: MediaItem): ThemeBackground =>
  item.kind === 'video' ? { kind: 'video', src: item.url } : { kind: 'image', src: item.url }

/** Slides with their stored per-slide backgrounds applied (presentation pages keep their own). */
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

/** What the output window renders. Read only from the live snapshot, so browsing never changes it. */
export function selectOutputState(s: OperatorState): OutputState {
  const live = selectLiveSlide(s)
  return {
    mode: s.live.mode,
    text: live?.text ?? '',
    caption: live?.caption ?? '',
    theme: slideTheme(s.live.theme, live),
    fadeMs: s.settings.fadeMs,
    logoUrl: s.settings.logoUrl,
    alert: selectAlertDisplay(s),
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
    current: current ? { text: current.text, caption: current.caption } : null,
    next: next ? { text: next.text, caption: next.caption } : null,
    title: live.title,
    nextItemTitle: nextItem?.title ?? null,
    mode: live.mode,
    alert: selectAlertDisplay(s),
  }
}

/** A slide's own background, if it has one, in place of the theme's. */
export function slideTheme(theme: ThemeStyle, slide: DeckSlide | null | undefined): ThemeStyle {
  if (!slide?.background) return theme
  return { ...theme, background: slide.background, overlay: slide.page ? 0 : theme.overlay }
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

/** The style the grid and preview use for what is loaded; it goes live with the item. */
export function selectDeckTheme(s: OperatorState): ThemeStyle {
  const id = s.deckThemeId ?? selectBaseThemeId(s)
  return s.themes.find((t) => t.id === id)?.style ?? s.themes[0]?.style ?? DEFAULT_THEME_STYLE
}
