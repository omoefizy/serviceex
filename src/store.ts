import { create } from 'zustand'
import { buildSongSlides } from '../shared/lyrics'
import type {
  OutputMode,
  OutputState,
  ServiceItemPayload,
  ServiceItem,
  ServiceItemType,
  ServiceWithItems,
  Song,
} from '../shared/types'
import { announcementSlides } from './lib/slides'

export interface DeckSlide {
  text: string
  /** Small line under the text on the output, such as "John 3:16 KJV". Empty for song slides. */
  caption: string
  /** Song section shown on the slide card only, such as "Chorus". */
  label?: string
}

interface OperatorState {
  selectedSong: Song | null
  /** Heading of the slide grid: the song title or the scripture reference. Null when nothing is loaded. */
  deckTitle: string | null
  slides: DeckSlide[]
  /** Index into `slides` of the slide on screen, or null when nothing is live. */
  liveSlideIndex: number | null
  outputMode: OutputMode
  /** CSS background of the output screen. */
  background: string
  /** The service open in the schedule panel. */
  service: ServiceWithItems | null
  /** The schedule item whose slides are in the grid, or null when the grid came from the library. */
  activeItemId: number | null
  /** The song open in the editor, which takes the slide grid's place. */
  editingSongId: number | null
  /** Bumped whenever a song is saved or deleted, so the song list reloads. */
  songsVersion: number

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
  background: '#000',
  service: null,
  activeItemId: null,
  editingSongId: null,
  songsVersion: 0,

  selectSong(song) {
    loadToken++
    set({
      activeItemId: null,
      selectedSong: song,
      deckTitle: song?.title ?? null,
      slides: song ? songSlides(song) : [],
      liveSlideIndex: null,
    })
  },

  selectScripture(title, slides) {
    loadToken++
    set({ selectedSong: null, deckTitle: title, slides, liveSlideIndex: null, activeItemId: null })
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
    } else {
      slides = announcementSlides(item.payload)
    }

    if (token !== loadToken) return false
    set({ selectedSong: song, deckTitle: item.title, slides, liveSlideIndex: null, activeItemId: item.id })
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

  editSong(id) {
    set({ editingSongId: id })
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

function songSlides(song: Song): DeckSlide[] {
  return buildSongSlides(song.lyrics, song.arrangement).map(({ text, label }) => ({
    text,
    caption: '',
    label: label ?? undefined,
  }))
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
    background: s.background,
  }
}
