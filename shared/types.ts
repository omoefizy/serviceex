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
  /** Small line under the text, such as "John 3:16 KJV". Empty for none. */
  caption: string
  background: string
}

/**
 * - show:  slide text over its background
 * - black: everything off, pure black
 * - clear: background only, text hidden
 * - logo:  the church logo
 */
export type OutputMode = 'show' | 'black' | 'clear' | 'logo'

/** What the operator sends to the output window. `text` is empty when no slide is live. */
export interface OutputState extends SlideContent {
  mode: OutputMode
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

/** Public domain Bible versions loaded by `npm run import:bible`. */
export type BibleVersionCode = 'KJV' | 'WEB'

export interface Verse {
  /** Full book name, such as "1 Corinthians". */
  book: string
  chapter: number
  verse: number
  text: string
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
}

/** The API the preload script exposes to the renderer as `window.api`. */
export interface WorshipDeckApi {
  songs: SongsApi
  bible: BibleApi
  output: {
    /** Sends the operator's output state to the output window. */
    send(state: OutputState): void
    /** Subscribe to output state changes. Returns an unsubscribe function. */
    onState(listener: (state: OutputState) => void): () => void
  }
}
