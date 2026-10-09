import { create } from 'zustand'
import type { Song } from '../shared/types'
import { splitIntoSlides } from './lib/slides'

interface OperatorState {
  selectedSong: Song | null
  slides: string[]
  /** Index into `slides` of the slide on screen, or null when nothing is live. */
  liveSlideIndex: number | null

  selectSong(song: Song | null): void
  goLive(index: number): void
  nextSlide(): void
  previousSlide(): void
}

export const useOperatorStore = create<OperatorState>((set, get) => ({
  selectedSong: null,
  slides: [],
  liveSlideIndex: null,

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
