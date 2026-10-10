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

export type ServiceItemType = 'song' | 'scripture' | 'announcement'

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
}

export type ServiceItemPayload = ScripturePayload | AnnouncementPayload

interface ServiceItemFields {
  id: number
  service_id: number
  order: number
  /** Song title, scripture reference or announcement title. */
  title: string
}

/** Songs point at the songs table through `ref_id`; scripture and announcements carry their content in `payload`. */
export type ServiceItem =
  | (ServiceItemFields & { type: 'song'; ref_id: number; payload: null })
  | (ServiceItemFields & { type: 'scripture'; ref_id: null; payload: ScripturePayload })
  | (ServiceItemFields & { type: 'announcement'; ref_id: null; payload: AnnouncementPayload })

export interface ServiceWithItems extends Service {
  /** In run order. */
  items: ServiceItem[]
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

/** The API the preload script exposes to the renderer as `window.api`. */
export interface WorshipDeckApi {
  songs: SongsApi
  bible: BibleApi
  services: ServicesApi
  songFiles: SongFilesApi
  output: {
    /** Sends the operator's output state to the output window. */
    send(state: OutputState): void
    /** Subscribe to output state changes. Returns an unsubscribe function. */
    onState(listener: (state: OutputState) => void): () => void
  }
}
