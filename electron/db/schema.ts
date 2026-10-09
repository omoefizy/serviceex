import type Database from 'better-sqlite3'

export function initSchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      lyrics TEXT
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
  `)

  // Databases created before service_items had a payload column get it added here.
  const serviceItemColumns = db.prepare('PRAGMA table_info(service_items)').all() as { name: string }[]
  if (!serviceItemColumns.some((column) => column.name === 'payload')) {
    db.exec('ALTER TABLE service_items ADD COLUMN payload TEXT')
  }
}
