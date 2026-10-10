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
  /** The song's own theme; null uses the default theme for songs. */
  themeId: number | null
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

/** What the output window renders for a slide. */
export interface SlideContent {
  text: string
  /** Small line under the text, such as "John 3:16 KJV" or a song's copyright. Empty for none. */
  caption: string
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
  /** The resolved theme, sent whole so the output window needs no database access. */
  theme: ThemeStyle
}

// ---------- Themes ----------

export type ThemeContentType = 'song' | 'scripture' | 'announcement'

export type TextCase = 'normal' | 'upper' | 'lower'

/** Image and video sources are wd-media:// URLs for files copied into the app's media folder. */
export type ThemeBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string }

/** Style of the small line under the text: a scripture reference or a song's copyright. */
export interface ThemeCaptionStyle {
  /** Empty uses the main text's font. */
  fontFamily: string
  fontWeight: number
  /** Percent of screen height. */
  size: number
  color: string
  textCase: TextCase
  italic: boolean
}

/**
 * Sizes scale with the screen, so a theme looks the same on the projector, the live preview and a thumbnail:
 * font sizes and vertical margins are percent of screen height, side margins percent of width, and shadow
 * and outline sizes are em (relative to the text).
 */
export interface ThemeStyle {
  /** A family name such as "Avenir Next", or a CSS font stack. */
  fontFamily: string
  fontWeight: number
  /** auto: as large as fits the safe area. fixed: `fontSize`, shrunk only when the slide would overflow. */
  sizeMode: 'auto' | 'fixed'
  /** Percent of screen height; used in fixed mode. */
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  lineHeight: number
  textCase: TextCase
  shadow: { enabled: boolean; color: string; blur: number; offset: number }
  outline: { enabled: boolean; color: string; width: number }
  /** Safe area: top and bottom in percent of height, left and right in percent of width. */
  margins: { top: number; right: number; bottom: number; left: number }
  /** A solid band filling the safe area behind the text, as lower thirds use. */
  band: { enabled: boolean; color: string; opacity: number }
  background: ThemeBackground
  /** Darkens the background: 0 leaves it, 1 makes it black. */
  overlay: number
  caption: ThemeCaptionStyle
}

export interface Theme {
  id: number
  name: string
  /** Built-in themes ship with the app and cannot be changed or deleted; save a copy instead. */
  type: 'builtin' | 'custom'
  style: ThemeStyle
}

export type ThemeDefaults = Record<ThemeContentType, number>

export interface ThemesApi {
  /** Built-in themes first, then custom ones in the order they were made. */
  list(): Promise<Theme[]>
  create(name: string, style: ThemeStyle): Promise<Theme>
  /** Custom themes only. Resolves to false for a built-in or missing theme. */
  update(id: number, name: string, style: ThemeStyle): Promise<boolean>
  /** Custom themes only. Songs and defaults that used it fall back to the built-in defaults. */
  delete(id: number): Promise<boolean>
  getDefaults(): Promise<ThemeDefaults>
  setDefault(type: ThemeContentType, themeId: number): Promise<void>
  /** Picks an image or video, copies it into the app's media folder and resolves to its URL, or null if cancelled. */
  pickMedia(kind: 'image' | 'video'): Promise<string | null>
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
  themes: ThemesApi
  output: {
    /** Sends the operator's output state to the output window. */
    send(state: OutputState): void
    /** Subscribe to output state changes. Returns an unsubscribe function. */
    onState(listener: (state: OutputState) => void): () => void
  }
}
