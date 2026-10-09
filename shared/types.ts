// Types shared by the main process, the preload script and the renderer.
// Keep this file free of runtime code: it is imported with `import type` only.

export interface Song {
  id: number
  title: string
  author: string | null
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

export interface ServiceItem {
  id: number
  service_id: number
  type: string
  ref_id: number | null
  order: number
}

/** What the output window renders for a slide. `background` is any CSS background value. */
export interface SlideContent {
  text: string
  background: string
}

/**
 * - show:  slide text over its background
 * - black: everything off, pure black
 * - clear: background only, text hidden
 * - logo:  the church logo
 */
export type OutputMode = 'show' | 'black' | 'clear' | 'logo'

export interface OutputState {
  mode: OutputMode
  slide: SlideContent | null
}

/** The API the preload script exposes to the renderer as `window.api`. */
export interface WorshipDeckApi {
  songs: {
    search(query: string): Promise<SongSummary[]>
    slides(songId: number): Promise<Slide[]>
  }
  output: {
    getState(): Promise<OutputState>
    setSlide(slide: SlideContent): void
    setMode(mode: OutputMode): void
    open(): void
    /** Subscribe to output state changes. Returns an unsubscribe function. */
    onState(listener: (state: OutputState) => void): () => void
  }
}
