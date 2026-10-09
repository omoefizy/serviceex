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

/** The editable fields of a song, used when creating or updating one. */
export type SongInput = Pick<Song, 'title' | 'author' | 'lyrics'>

export interface SongsApi {
  /** Lists songs, optionally filtered by title, author or lyrics. */
  list(search?: string): Promise<SongSummary[]>
  get(id: number): Promise<Song | undefined>
  /** Creates a song and splits its lyrics into slides on blank lines. */
  create(input: SongInput): Promise<Song>
  /** Updates a song and rebuilds its slides. Resolves to false if the song does not exist. */
  update(id: number, input: SongInput): Promise<boolean>
  /** Resolves to false if the song does not exist. */
  delete(id: number): Promise<boolean>
}

/** The API the preload script exposes to the renderer as `window.api`. */
export interface WorshipDeckApi {
  songs: SongsApi
  output: {
    getState(): Promise<OutputState>
    setSlide(slide: SlideContent): void
    setMode(mode: OutputMode): void
    open(): void
    /** Subscribe to output state changes. Returns an unsubscribe function. */
    onState(listener: (state: OutputState) => void): () => void
  }
}
