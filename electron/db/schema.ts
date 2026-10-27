import type Database from 'better-sqlite3'

export function initSchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      lyrics TEXT,
      copyright TEXT,
      tags TEXT,
      arrangement TEXT,
      theme_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT
    );

    CREATE TABLE IF NOT EXISTS service_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      ref_id INTEGER,
      order_index INTEGER NOT NULL,
      payload TEXT
    );

    CREATE TABLE IF NOT EXISTS bible_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES bible_versions(id) ON DELETE CASCADE,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL,
      UNIQUE (version_id, book, chapter, verse)
    );

    -- type is 'builtin' (shipped with the app, read-only) or 'custom'; json is a ThemeStyle.
    CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      json TEXT NOT NULL
    );

    -- Lower third templates for the Stream output, kept like themes: 'builtin' or 'custom'; json is a LowerThirdStyle.
    CREATE TABLE IF NOT EXISTS lower_third_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      json TEXT NOT NULL
    );

    -- Background library. file and thumb are names in <userData>/media; tags is a JSON array.
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file TEXT NOT NULL,
      thumb TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A library background for one slide of a deck. deck_key is 'song:<id>', 'item:<service item id>'
    -- or 'scripture:<reference>'; slide_index counts from 0 in play order.
    CREATE TABLE IF NOT EXISTS slide_backgrounds (
      deck_key TEXT NOT NULL,
      slide_index INTEGER NOT NULL,
      media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      PRIMARY KEY (deck_key, slide_index)
    );

    -- Imported presentations. The slide pictures live in <userData>/presentations/<hash>/, cached by the SHA-256
    -- of the original at source_path; slides is a JSON array of { file, title, text, notes, animated }.
    CREATE TABLE IF NOT EXISTS presentations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      engine TEXT NOT NULL,
      slides TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- Live PowerPoint options: play animated slides with PowerPoint (with the setting on), follow slide timings.
      live_powerpoint INTEGER NOT NULL DEFAULT 1,
      use_timings INTEGER NOT NULL DEFAULT 0
    );

    -- Full-text index over verses.text for keyword search. It reads its text from verses (external content),
    -- so it must be rebuilt after verses change: the Bible import does that, and ensureVerseIndex catches up.
    CREATE VIRTUAL TABLE IF NOT EXISTS verses_fts USING fts5(
      text,
      content = 'verses',
      content_rowid = 'id',
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- How many verses each indexed word appears in, for weighting rare words in quote matching. A view of
    -- verses_fts, so it is always up to date.
    CREATE VIRTUAL TABLE IF NOT EXISTS verses_fts_vocab USING fts5vocab(verses_fts, 'row');

    -- Sermons saved from listening sessions. sermon_date is an ISO date; created_at an ISO timestamp with milliseconds,
    -- which the at_ms and start_ms of the rows below count from. status is 'recording' while the listener saves to it,
    -- then 'saved'. key_points is a JSON array of strings; cleaned_transcript the AI's version, kept apart from the raw lines.
    CREATE TABLE IF NOT EXISTS sermons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      preacher TEXT NOT NULL DEFAULT '',
      sermon_date TEXT NOT NULL,
      series TEXT NOT NULL DEFAULT '',
      church_name_snapshot TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      key_points TEXT NOT NULL DEFAULT '[]',
      cleaned_transcript TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'saved'
    );

    CREATE TABLE IF NOT EXISTS sermon_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sermon_id INTEGER NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
      start_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      is_final INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS sermon_segments_sermon ON sermon_segments (sermon_id, start_ms);

    -- source is 'detected' (heard by the listener) or 'manual'.
    CREATE TABLE IF NOT EXISTS sermon_scriptures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sermon_id INTEGER NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
      reference TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      source TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sermon_scriptures_sermon ON sermon_scriptures (sermon_id);

    CREATE TABLE IF NOT EXISTS sermon_statements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sermon_id INTEGER NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sermon_statements_sermon ON sermon_statements (sermon_id);

    -- App-wide choices such as the default theme per content type.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Columns added after the first release. Older databases get them here; CREATE TABLE above covers new ones.
  addColumnIfMissing(db, 'service_items', 'payload', 'TEXT')
  addColumnIfMissing(db, 'songs', 'copyright', 'TEXT')
  addColumnIfMissing(db, 'songs', 'tags', 'TEXT') // JSON array of strings
  addColumnIfMissing(db, 'songs', 'arrangement', 'TEXT') // JSON SongArrangement
  addColumnIfMissing(db, 'songs', 'theme_id', 'INTEGER') // themes.id; null uses the default song theme
  addColumnIfMissing(db, 'songs', 'formatting', 'TEXT') // JSON SlideFormats; null (all older songs) shows the theme's look
  addColumnIfMissing(db, 'presentations', 'live_powerpoint', 'INTEGER NOT NULL DEFAULT 1')
  addColumnIfMissing(db, 'presentations', 'use_timings', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'presentations', 'mode', "TEXT NOT NULL DEFAULT 'image'") // 'image' or 'native'
  addColumnIfMissing(db, 'presentations', 'linked', 'INTEGER NOT NULL DEFAULT 1') // 0 once detached from the original
  addColumnIfMissing(db, 'presentations', 'native', 'TEXT') // JSON NativeSlide[], once Native mode was used
  addColumnIfMissing(db, 'media', 'hash', 'TEXT') // SHA-256 of a clip taken from a .pptx, so it goes in once
}

/** Rebuilds the verse search index from the verses table. Takes a second or two for both Bibles. */
export function rebuildVerseIndex(db: Database.Database): void {
  db.exec("INSERT INTO verses_fts (verses_fts) VALUES ('rebuild')")
}

/** Rebuilds the verse search index when it does not cover every verse, as after upgrading an existing install. */
export function ensureVerseIndex(db: Database.Database): void {
  const { verses } = db.prepare('SELECT count(*) AS verses FROM verses').get() as { verses: number }
  const { indexed } = db.prepare('SELECT count(*) AS indexed FROM verses_fts_docsize').get() as { indexed: number }
  if (verses !== indexed) rebuildVerseIndex(db)
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}
