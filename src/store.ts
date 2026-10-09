import { create } from 'zustand'
import type { OutputMode, OutputState, Song } from '../shared/types'
import { splitIntoSlides } from './lib/slides'

interface OperatorState {
  selectedSong: Song | null
  slides: string[]
  /** Index into `slides` of the slide on screen, or null when nothing is live. */
  liveSlideIndex: number | null
  outputMode: OutputMode
  /** CSS background of the output screen. */
  background: string

  selectSong(song: Song | null): void
  goLive(index: number): void
  /** Puts a slide live and switches the output to show it. */
  showSlide(index: number): void
  setOutputMode(mode: OutputMode): void
  nextSlide(): void
  previousSlide(): void
}

export const useOperatorStore = create<OperatorState>((set, get) => ({
  selectedSong: null,
  slides: [],
  liveSlideIndex: null,
  outputMode: 'show',
  background: '#000',

  selectSong(song) {
    set({
      selectedSong: song,
      slides: song ? splitIntoSlides(song.lyrics) : [],
      liveSlideIndex: null,
    })
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
}))

/** What the output window should render for the current operator state. */
export function selectOutputState(s: OperatorState): OutputState {
  return {
    mode: s.outputMode,
    text: s.liveSlideIndex === null ? '' : s.slides[s.liveSlideIndex],
    background: s.background,
  }
}
