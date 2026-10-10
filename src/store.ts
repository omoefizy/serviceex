import { create } from 'zustand'
import { buildSongSlides } from '../shared/lyrics'
import { DEFAULT_THEME_STYLE } from '../shared/themes'
import type {
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
} from '../shared/types'
import { announcementSlides } from './lib/slides'

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

interface OperatorState {
  selectedSong: Song | null
  /** Heading of the slide grid: the song title or the scripture reference. Null when nothing is loaded. */
  deckTitle: string | null
  slides: DeckSlide[]
  /** Index into `slides` of the slide on screen, or null when nothing is live. */
  liveSlideIndex: number | null
  outputMode: OutputMode
  /** What the grid holds, which picks the default theme. Null when it is empty. */
  deckType: ServiceItemType | null
  /**
   * Names the deck for per-slide background overrides: 'song:<id>' (wherever the song is loaded from),
   * 'item:<id>' for other schedule items, 'scripture:<reference>' for a scripture lookup. Null when empty.
   */
  deckKey: string | null
  /** App settings from the main process (crossfade, output display, logo, appearance, backups). */
  settings: AppSettings
  themes: Theme[]
  themeDefaults: ThemeDefaults | null
  /** The theme picked above the slide grid for what is loaded now; null uses the song's theme or the default. */
  deckThemeId: number | null
  themeEditorOpen: boolean
  settingsOpen: boolean
  paletteOpen: boolean
  /** Whether the stage display window is open; kept in step by App from the main process. */
  stageOpen: boolean
  /** The service open in the schedule panel. */
  service: ServiceWithItems | null
  /** The schedule item whose slides are in the grid, or null when the grid came from the library. */
  activeItemId: number | null
  /** The song open in the editor, which takes the slide grid's place. */
  editingSongId: number | null
  /** Bumped whenever a song is saved or deleted, so the song list reloads. */
  songsVersion: number
  /** Bumped when the media library changes, so every view of it reloads. */
  mediaVersion: number

  selectSong(song: Song | null): void
  /** Loads scripture verses into the slide grid in place of a song. */
  selectScripture(title: string, slides: DeckSlide[]): void
  goLive(index: number): void
  /** Puts a slide live and switches the output to show it. */
  showSlide(index: number): void
  setOutputMode(mode: OutputMode): void
  nextSlide(): void
  previousSlide(): void

  /** Opens a service in the schedule panel, or closes it with null. */
  openService(id: number | null): Promise<void>
  addToSchedule(type: ServiceItemType, refId: number | null, payload: ServiceItemPayload | null): Promise<void>
  removeFromSchedule(itemId: number): Promise<void>
  reorderSchedule(orderedItemIds: number[]): Promise<void>
  /** Loads a schedule item's slides into the grid. Resolves to false if another load replaced it first. */
  loadItem(item: ServiceItem): Promise<boolean>
  /** Loads the item after the active one and puts its first slide live. */
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
  /** Closes the song editor, theme editor and settings so the slide grid shows. */
  showGrid(): void
  mediaChanged(): void
  /** Tells the song list to reload, after an import for example. */
  songsChanged(): void
  /** Refreshes the grid and schedule after the editor saves a song. */
  songSaved(song: Song): Promise<void>
  songDeleted(id: number): Promise<void>
}

/** Bumped by every grid load, so a slow song fetch for an old item cannot overwrite a newer selection. */
let loadToken = 0

export const useOperatorStore = create<OperatorState>((set, get) => ({
  selectedSong: null,
  deckTitle: null,
  slides: [],
  liveSlideIndex: null,
  outputMode: 'show',
  deckType: null,
  deckKey: null,
  settings: {
    fadeMs: 400,
    outputDisplay: 'auto',
    logoUrl: null,
    appearance: 'system',
    autosaveDrafts: true,
    backupFolder: null,
    backupIntervalMinutes: 0,
    lastBackupAt: null,
  },
  themes: [],
  themeDefaults: null,
  deckThemeId: null,
  themeEditorOpen: false,
  settingsOpen: false,
  paletteOpen: false,
  stageOpen: false,
  service: null,
  activeItemId: null,
  editingSongId: null,
  songsVersion: 0,
  mediaVersion: 0,

  selectSong(song) {
    const token = ++loadToken
    const deckKey = song ? `song:${song.id}` : null
    set({
      activeItemId: null,
      selectedSong: song,
      deckType: song ? 'song' : null,
      deckKey,
      deckThemeId: null,
      deckTitle: song?.title ?? null,
      slides: song ? songSlides(song) : [],
      liveSlideIndex: null,
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
      liveSlideIndex: null,
      activeItemId: null,
    })
    applySlideBackgrounds(token, deckKey)
  },

  goLive(index) {
    const { slides } = get()
    if (index >= 0 && index < slides.length) set({ liveSlideIndex: index })
  },

  showSlide(index) {
    get().goLive(index)
    set({ outputMode: 'show' })
  },

  setOutputMode(mode) {
    set({ outputMode: mode })
  },

  nextSlide() {
    const { slides, liveSlideIndex } = get()
    if (slides.length === 0) return
    get().goLive(liveSlideIndex === null ? 0 : Math.min(liveSlideIndex + 1, slides.length - 1))
  },

  previousSlide() {
    const { slides, liveSlideIndex } = get()
    if (slides.length === 0) return
    get().goLive(liveSlideIndex === null ? 0 : Math.max(liveSlideIndex - 1, 0))
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
      deckType: item.type,
      deckKey,
      deckThemeId: null,
      deckTitle: item.title,
      slides,
      liveSlideIndex: null,
      activeItemId: item.id,
    })
    await applySlideBackgrounds(token, deckKey)
    return true
  },

  async nextItem() {
    const { service, activeItemId } = get()
    if (!service) return
    // With no active item, findIndex gives -1 and the run starts at the first item.
    const next = service.items[service.items.findIndex((item) => item.id === activeItemId) + 1]
    if (!next) return
    if ((await get().loadItem(next)) && get().slides.length > 0) get().showSlide(0)
  },

  // The song editor, theme editor and settings share the centre panel, so opening one closes the others.
  editSong(id) {
    set(id === null ? { editingSongId: null } : { editingSongId: id, themeEditorOpen: false, settingsOpen: false })
  },

  async loadThemes() {
    const [themes, themeDefaults] = await Promise.all([window.api.themes.list(), window.api.themes.getDefaults()])
    // A deleted theme can no longer be picked for the deck.
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
    const { selectedSong, liveSlideIndex, service, songsVersion } = get()
    set({ songsVersion: songsVersion + 1 })
    if (selectedSong?.id === song.id) {
      // Keep the live slide where it is if it still exists, so saving mid-service does not blank the screen.
      const slides = songSlides(song)
      set({
        selectedSong: song,
        deckTitle: song.title,
        slides,
        liveSlideIndex: liveSlideIndex !== null && liveSlideIndex < slides.length ? liveSlideIndex : null,
      })
      await applySlideBackgrounds(loadToken, get().deckKey)
    }
    if (service?.items.some((item) => item.type === 'song' && item.ref_id === song.id)) await refreshService(service.id)
  },

  async songDeleted(id) {
    const { selectedSong, service, songsVersion, editingSongId } = get()
    set({ songsVersion: songsVersion + 1, editingSongId: editingSongId === id ? null : editingSongId })
    if (selectedSong?.id === id) get().selectSong(null)
    if (service?.items.some((item) => item.type === 'song' && item.ref_id === id)) await refreshService(service.id)
  },
}))

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

/** Merges a deck's stored slide backgrounds into its slides, unless another deck was loaded meanwhile. */
async function applySlideBackgrounds(token: number, deckKey: string | null): Promise<void> {
  if (!deckKey) return
  try {
    const overrides = await window.api.media.getSlideBackgrounds(deckKey)
    if (token !== loadToken) return
    useOperatorStore.setState((s) => ({
      slides: s.slides.map((slide, index) => {
        if (slide.page) return slide
        const override = overrides[index]
        if (override) return { ...slide, background: mediaBackground(override) }
        return slide.background ? { ...slide, background: undefined } : slide
      }),
    }))
  } catch (err) {
    console.error(err)
  }
}

async function refreshService(id: number): Promise<void> {
  const service = (await window.api.services.get(id)) ?? null
  // Ignore the result if the operator switched services meanwhile.
  if (useOperatorStore.getState().service?.id === id) useOperatorStore.setState({ service })
}

/** What the output window should render for the current operator state. */
export function selectOutputState(s: OperatorState): OutputState {
  const live = s.liveSlideIndex === null ? null : s.slides[s.liveSlideIndex]
  return {
    mode: s.outputMode,
    text: live?.text ?? '',
    caption: live?.caption ?? '',
    theme: slideTheme(selectDeckTheme(s), live),
    fadeMs: s.settings.fadeMs,
    logoUrl: s.settings.logoUrl,
  }
}

/** The slide after the live one, or the first slide when nothing is live. */
export function selectNextSlide(s: OperatorState): DeckSlide | null {
  const index = s.liveSlideIndex === null ? 0 : s.liveSlideIndex + 1
  return s.slides[index] ?? null
}

/** What the stage display should show the worship leader. */
export function selectStageState(s: OperatorState): StageState {
  const live = s.liveSlideIndex === null ? null : s.slides[s.liveSlideIndex]
  const next = selectNextSlide(s)
  const items = s.service?.items ?? []
  const nextItem = items[items.findIndex((item) => item.id === s.activeItemId) + 1]
  return {
    current: live ? { text: live.text, caption: live.caption } : null,
    next: next ? { text: next.text, caption: next.caption } : null,
    title: s.deckTitle,
    nextItemTitle: nextItem?.title ?? null,
    mode: s.outputMode,
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

/** The style the grid, live preview and output use for what is loaded. */
export function selectDeckTheme(s: OperatorState): ThemeStyle {
  const id = s.deckThemeId ?? selectBaseThemeId(s)
  return s.themes.find((t) => t.id === id)?.style ?? s.themes[0]?.style ?? DEFAULT_THEME_STYLE
}
