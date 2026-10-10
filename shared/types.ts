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

export type ServiceItemType = 'song' | 'scripture' | 'announcement' | 'presentation'

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
  /** Starts with a slide showing just the title. Older announcements have no title slide. */
  titleSlide?: boolean
}

/** Images or PDF pages, one slide each, stored as image files in the media folder. */
export interface PresentationPayload {
  title: string
  /** wd-media:// URLs, in order. */
  pages: string[]
}

export type ServiceItemPayload = ScripturePayload | AnnouncementPayload | PresentationPayload

interface ServiceItemFields {
  id: number
  service_id: number
  order: number
  /** Song title, scripture reference or announcement title. */
  title: string
}

/** Songs point at the songs table through `ref_id`; the other types carry their content in `payload`. */
export type ServiceItem =
  | (ServiceItemFields & { type: 'song'; ref_id: number; payload: null })
  | (ServiceItemFields & { type: 'scripture'; ref_id: null; payload: ScripturePayload })
  | (ServiceItemFields & { type: 'announcement'; ref_id: null; payload: AnnouncementPayload })
  | (ServiceItemFields & { type: 'presentation'; ref_id: null; payload: PresentationPayload })

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
  /** Crossfade length for slide and background changes, in milliseconds. */
  fadeMs: number
  /** The church logo for logo mode, or null for the placeholder. */
  logoUrl: string | null
  /** The resolved theme, sent whole so the output window needs no database access. */
  theme: ThemeStyle
}

// ---------- Themes ----------

export type ThemeContentType = 'song' | 'scripture' | 'announcement'

export type TextCase = 'normal' | 'upper' | 'lower'

/** Image and video sources are wd-media:// URLs for files in the app's media folder, usually library items. */
export type ThemeBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  /** `contain` shows the whole image (presentation pages); the default `cover` fills the screen. */
  | { kind: 'image'; src: string; fit?: 'cover' | 'contain' }
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
}

// ---------- Media library ----------

export interface MediaItem {
  id: number
  name: string
  kind: 'image' | 'video'
  /** wd-media:// URL of the file. */
  url: string
  /** wd-media:// URL of a small JPEG (a poster frame for videos); null until the renderer has made one. */
  thumbUrl: string | null
  tags: string[]
}

/** What the presentation picker found: images already copied in, or a PDF for the renderer to draw page by page. */
export type PresentationSource =
  | { kind: 'images'; title: string; pages: string[] }
  | { kind: 'pdf'; title: string; data: Uint8Array }

export interface MediaApi {
  list(): Promise<MediaItem[]>
  /** Shows a file picker and copies the chosen images and videos into the library. Resolves to the new items. */
  import(): Promise<MediaItem[]>
  update(id: number, name: string, tags: string[]): Promise<boolean>
  /** Deletes the item and its files. Slides and custom themes using it go back to their theme's background. */
  delete(id: number): Promise<boolean>
  /** Stores a JPEG thumbnail the renderer drew for an item. */
  saveThumbnail(id: number, jpeg: Uint8Array): Promise<MediaItem | undefined>
  /** Per-slide background overrides for a deck (see deckKey in the store), by slide index. */
  getSlideBackgrounds(deckKey: string): Promise<Record<number, MediaItem>>
  setSlideBackground(deckKey: string, slideIndex: number, mediaId: number | null): Promise<void>
  /** Picks images or one PDF for a presentation. Resolves to null if cancelled. */
  pickPresentation(): Promise<PresentationSource | null>
  /** Stores a PNG the renderer drew (a PDF page) and resolves to its URL. */
  saveImage(png: Uint8Array): Promise<string>
}

/** Which screen the output window uses: the first non-primary display, a windowed output, or one display. */
export type OutputDisplay = 'auto' | 'window' | number

export interface AppSettings {
  /** Crossfade between slides and backgrounds on the output, 0 to 1500 ms. */
  fadeMs: number
  outputDisplay: OutputDisplay
  /** wd-media:// URL of the logo shown in logo mode, or null for the placeholder. */
  logoUrl: string | null
  appearance: 'system' | 'dark' | 'light'
  /** Whether the song editor keeps unsaved edits as drafts. */
  autosaveDrafts: boolean
  /** Folder for automatic database backups, or null for none. */
  backupFolder: string | null
  /** Minutes between automatic backups; 0 turns them off. */
  backupIntervalMinutes: 0 | 10 | 30 | 60
  /** When the last backup finished (ISO time), set by the main process. */
  lastBackupAt: string | null
  /** Turns every AI feature off; when false the main process makes no AI requests at all. */
  aiEnabled: boolean
  aiModel: AiModel
}

export interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

export interface SettingsApi {
  get(): Promise<AppSettings>
  /** lastBackupAt is ignored; the main process sets it. */
  set(settings: Partial<AppSettings>): Promise<AppSettings>
  listDisplays(): Promise<DisplayInfo[]>
  /** Picks a folder for backups and saves it. Resolves to the new settings, or null if cancelled. */
  pickBackupFolder(): Promise<AppSettings | null>
  /** Picks a logo image, copies it into the media folder and saves it. Resolves to the new settings, or null if cancelled. */
  pickLogo(): Promise<AppSettings | null>
  /** Backs up the database into the backup folder now. Resolves to the file written. */
  backupNow(): Promise<string>
}

/** What the stage display shows the worship leader. */
export interface StageState {
  /** The live slide, or null when nothing is live. */
  current: SlideContent | null
  /** The slide after it in the grid. */
  next: SlideContent | null
  /** What is loaded: a song title, a scripture reference. */
  title: string | null
  /** The schedule item after the loaded one, for "coming up". */
  nextItemTitle: string | null
  mode: OutputMode
}

export interface StageApi {
  open(): Promise<void>
  close(): Promise<void>
  isOpen(): Promise<boolean>
  /** Called when the stage window opens or closes, including by its own close button. */
  onOpenChange(listener: (open: boolean) => void): () => void
  send(state: StageState): void
  onState(listener: (state: StageState) => void): () => void
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

export type Testament = 'all' | 'old' | 'new'

export interface VerseSearchParams {
  /**
   * What was typed. Words must all appear; the last one also matches as a prefix while it is being typed
   * ("fear of the lo"). Wrap it in double quotes to search for the exact phrase.
   */
  query: string
  versions: BibleVersionCode[]
  testament: Testament
  /** Only this book, or null for any. */
  book: string | null
  offset: number
  limit: number
}

export interface VerseHit extends Verse {
  /** The verse row id, unique across versions. */
  id: number
  version: BibleVersionCode
  /** The verse text split into the words that matched and the rest, for highlighting. */
  segments: { text: string; match: boolean }[]
}

export interface VerseSearchResult {
  total: number
  hits: VerseHit[]
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
  /** Full-text search over the local Bible (SQLite FTS5), ranked by relevance. */
  search(params: VerseSearchParams): Promise<VerseSearchResult>
  /** Verses per chapter for a book, from the KJV: [31, 25, …] means chapter 1 has 31 verses. Empty if unknown. */
  bookStructure(book: string): Promise<number[]>
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
  media: MediaApi
  settings: SettingsApi
  stage: StageApi
  ai: AiApi
  output: {
    /** Sends the operator's output state to the output window. */
    send(state: OutputState): void
    /** Subscribe to output state changes. Returns an unsubscribe function. */
    onState(listener: (state: OutputState) => void): () => void
  }
}

// ---------- AI ----------

/** Sonnet 5.5 by default; Haiku 5.5 is faster and cheaper. */
export type AiModel = 'claude-sonnet-5-5' | 'claude-haiku-5-5'

/**
 * Every AI task, with the input the renderer sends and the output it gets back. The main process holds the
 * prompts; the renderer only names a task and passes its input.
 */
export interface AiTasks {
  /**
   * Cleans pasted lyrics: [Section] labels, repeated sections written once with a play order, junk removed,
   * lines split into slides. The main process rejects any answer that changes the words.
   */
  cleanLyrics: { input: { lyrics: string }; output: { lyrics: string; order: string[] } }
  /**
   * Finds passages by meaning ("verses about fear"). References only, such as "John 3:16-18": the app reads the
   * verse text from its own Bible database. Each one is checked to exist there; at most 8 come back.
   */
  suggestScripture: { input: { topic: string }; output: { references: string[] } }
  /**
   * Reads a sermon outline: a title, short key points, and every scripture reference it mentions, checked to
   * exist in the Bible database. No verse text.
   */
  sermonToSlides: {
    input: { outline: string }
    output: { title: string; points: string[]; references: string[] }
  }
  /** Turns a long message into a title and short slides, one idea each. */
  buildAnnouncement: { input: { message: string }; output: { title: string; slides: string[] } }
}

export type AiTask = keyof AiTasks

export type AiErrorCode =
  /** AI is switched off in Settings. */
  | 'disabled'
  /** No API key has been saved. */
  | 'no_key'
  /** The key was rejected or lacks access. */
  | 'invalid_key'
  /** No internet connection, or Anthropic could not be reached. */
  | 'offline'
  | 'rate_limited'
  /** Anthropic is overloaded or had a server error; try again shortly. */
  | 'unavailable'
  /** The account has a billing problem. */
  | 'billing'
  /** The model declined the request. */
  | 'refused'
  /** The input was too long, malformed, or the answer could not be used. */
  | 'bad_request'
  /** This system cannot encrypt the key, so it is not stored. */
  | 'no_encryption'

export interface AiError {
  code: AiErrorCode
  /** A sentence to show the operator. */
  message: string
  /** For rate limits: how long Anthropic asked to wait. */
  retryAfterSeconds?: number
}

export type AiResult<T> = { ok: true; value: T } | { ok: false; error: AiError }

export interface AiStatus {
  enabled: boolean
  model: AiModel
  /** Whether an encrypted key is saved; the key itself never leaves the main process. */
  hasKey: boolean
  /** Whether the OS can encrypt the key (Keychain, DPAPI, or a Linux keyring). */
  encryptionAvailable: boolean
}

export interface AiApi {
  status(): Promise<AiStatus>
  /** Encrypts and stores the key. The renderer sends it once, here, and can never read it back. */
  setKey(key: string): Promise<AiResult<AiStatus>>
  clearKey(): Promise<AiStatus>
  /** Checks the saved key can reach the chosen model. Resolves to the model's display name. */
  testConnection(): Promise<AiResult<{ model: string }>>
  ask<T extends AiTask>(task: T, input: AiTasks[T]['input']): Promise<AiResult<AiTasks[T]['output']>>
}
