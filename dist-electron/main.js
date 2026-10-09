import { app, ipcMain, BrowserWindow, screen } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
function initSchema(db2) {
  db2.pragma("foreign_keys = ON");
  db2.exec(`
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
  `);
  const serviceItemColumns = db2.prepare("PRAGMA table_info(service_items)").all();
  if (!serviceItemColumns.some((column) => column.name === "payload")) {
    db2.exec("ALTER TABLE service_items ADD COLUMN payload TEXT");
  }
}
const dbPath = path.join(app.getPath("userData"), "worshipdeck.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
initSchema(db);
function splitIntoSlides(lyrics) {
  return lyrics.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
}
function replaceSlides(songId, lyrics) {
  db.prepare("DELETE FROM slides WHERE song_id = ?").run(songId);
  const insert = db.prepare("INSERT INTO slides (song_id, order_index, text) VALUES (?, ?, ?)");
  splitIntoSlides(lyrics).forEach((text, index) => insert.run(songId, index, text));
}
function listSongs(search) {
  const query = search == null ? void 0 : search.trim();
  if (!query) {
    return db.prepare("SELECT id, title, author FROM songs ORDER BY title COLLATE NOCASE").all();
  }
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.prepare(
    `SELECT id, title, author FROM songs
       WHERE title LIKE @pattern ESCAPE '\\'
          OR author LIKE @pattern ESCAPE '\\'
          OR lyrics LIKE @pattern ESCAPE '\\'
       ORDER BY title COLLATE NOCASE`
  ).all({ pattern });
}
function getSong(id) {
  return db.prepare("SELECT id, title, author, lyrics FROM songs WHERE id = ?").get(id);
}
const createSong = db.transaction(
  (title, author, lyrics) => {
    const result = db.prepare("INSERT INTO songs (title, author, lyrics) VALUES (?, ?, ?)").run(title, author, lyrics);
    const id = Number(result.lastInsertRowid);
    replaceSlides(id, lyrics);
    return { id, title, author, lyrics };
  }
);
const updateSong = db.transaction(
  (id, title, author, lyrics) => {
    const result = db.prepare("UPDATE songs SET title = ?, author = ?, lyrics = ? WHERE id = ?").run(title, author, lyrics, id);
    if (result.changes === 0) return false;
    replaceSlides(id, lyrics);
    return true;
  }
);
function deleteSong(id) {
  return db.prepare("DELETE FROM songs WHERE id = ?").run(id).changes > 0;
}
function assertId$1(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("Song id must be a positive integer");
  }
  return value;
}
function assertSongInput(value) {
  const input = value;
  if (typeof input !== "object" || input === null || typeof input.title !== "string" || input.title.trim() === "" || input.author !== null && typeof input.author !== "string" || typeof input.lyrics !== "string") {
    throw new TypeError("Song needs a non-empty title, an author (string or null) and lyrics");
  }
  return { title: input.title.trim(), author: input.author, lyrics: input.lyrics };
}
function registerSongIpc() {
  ipcMain.handle(
    "songs:list",
    (_event, search) => listSongs(typeof search === "string" ? search : void 0)
  );
  ipcMain.handle("songs:get", (_event, id) => getSong(assertId$1(id)));
  ipcMain.handle("songs:create", (_event, input) => {
    const { title, author, lyrics } = assertSongInput(input);
    return createSong(title, author, lyrics);
  });
  ipcMain.handle("songs:update", (_event, id, input) => {
    const { title, author, lyrics } = assertSongInput(input);
    return updateSong(assertId$1(id), title, author, lyrics);
  });
  ipcMain.handle("songs:delete", (_event, id) => deleteSong(assertId$1(id)));
}
const VERSE_COLUMNS = "v.book, v.chapter, v.verse, v.text";
const FROM_VERSION = "FROM verses v JOIN bible_versions b ON b.id = v.version_id WHERE b.code = @version";
function getVerse(version, book, chapter, verse) {
  return db.prepare(
    `SELECT ${VERSE_COLUMNS} ${FROM_VERSION}
         AND v.book = @book AND v.chapter = @chapter AND v.verse = @verse`
  ).get({ version, book, chapter, verse });
}
function getRange(version, book, chapter, verseStart, verseEnd) {
  return db.prepare(
    `SELECT ${VERSE_COLUMNS} ${FROM_VERSION}
         AND v.book = @book AND v.chapter = @chapter AND v.verse BETWEEN @verseStart AND @verseEnd
       ORDER BY v.verse`
  ).all({ version, book, chapter, verseStart, verseEnd });
}
function searchText(version, query) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.prepare(
    `SELECT ${VERSE_COLUMNS} ${FROM_VERSION}
         AND v.text LIKE @pattern ESCAPE '\\'
       ORDER BY v.id
       LIMIT 100`
  ).all({ version, pattern });
}
function listBooks() {
  return db.prepare("SELECT book FROM verses GROUP BY book ORDER BY MIN(id)").all().map(
    (row) => row.book
  );
}
const VERSIONS = ["KJV", "WEB"];
function assertVersion(value) {
  if (!VERSIONS.includes(value)) {
    throw new TypeError(`Bible version must be one of ${VERSIONS.join(", ")}`);
  }
  return value;
}
function assertBook(value) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError("Book must be a non-empty string");
  return value;
}
function assertNumber(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}
function registerBibleIpc() {
  ipcMain.handle(
    "bible:getVerse",
    (_event, version, book, chapter, verse) => getVerse(assertVersion(version), assertBook(book), assertNumber(chapter, "Chapter"), assertNumber(verse, "Verse"))
  );
  ipcMain.handle(
    "bible:getRange",
    (_event, version, book, chapter, verseStart, verseEnd) => getRange(
      assertVersion(version),
      assertBook(book),
      assertNumber(chapter, "Chapter"),
      assertNumber(verseStart, "First verse"),
      assertNumber(verseEnd, "Last verse")
    )
  );
  ipcMain.handle(
    "bible:searchText",
    (_event, version, query) => searchText(assertVersion(version), typeof query === "string" ? query : "")
  );
  ipcMain.handle("bible:listBooks", () => listBooks());
}
const SELECT_ITEMS = `
  SELECT i.id, i.service_id, i.type, i.ref_id, i.order_index, i.payload, s.title AS song_title
  FROM service_items i
  LEFT JOIN songs s ON i.type = 'song' AND s.id = i.ref_id`;
function toItem(row) {
  const fields = { id: row.id, service_id: row.service_id, order: row.order_index };
  if (row.type === "song") {
    return { ...fields, type: "song", ref_id: row.ref_id, payload: null, title: row.song_title ?? "Missing song" };
  }
  if (row.type === "scripture") {
    const payload2 = JSON.parse(row.payload ?? "{}");
    return { ...fields, type: "scripture", ref_id: null, payload: payload2, title: payload2.title };
  }
  const payload = JSON.parse(row.payload ?? "{}");
  return { ...fields, type: "announcement", ref_id: null, payload, title: payload.title };
}
function getItem(id) {
  const row = db.prepare(`${SELECT_ITEMS} WHERE i.id = ?`).get(id);
  return row && toItem(row);
}
function createService(name, date) {
  const result = db.prepare("INSERT INTO services (name, date) VALUES (?, ?)").run(name, date);
  return { id: Number(result.lastInsertRowid), name, date };
}
function listServices() {
  return db.prepare("SELECT id, name, date FROM services ORDER BY date IS NULL, date DESC, id DESC").all();
}
function getService(id) {
  const service = db.prepare("SELECT id, name, date FROM services WHERE id = ?").get(id);
  if (!service) return void 0;
  const rows = db.prepare(`${SELECT_ITEMS} WHERE i.service_id = ? ORDER BY i.order_index, i.id`).all(id);
  return { ...service, items: rows.map(toItem) };
}
function deleteService(id) {
  return db.prepare("DELETE FROM services WHERE id = ?").run(id).changes > 0;
}
const addItem = db.transaction(
  (serviceId, type, refId, payload) => {
    if (!db.prepare("SELECT 1 FROM services WHERE id = ?").get(serviceId)) {
      throw new Error(`Service ${serviceId} does not exist`);
    }
    if (type === "song" && !db.prepare("SELECT 1 FROM songs WHERE id = ?").get(refId)) {
      throw new Error(`Song ${refId} does not exist`);
    }
    const { next } = db.prepare("SELECT COALESCE(MAX(order_index) + 1, 0) AS next FROM service_items WHERE service_id = ?").get(serviceId);
    const result = db.prepare("INSERT INTO service_items (service_id, type, ref_id, order_index, payload) VALUES (?, ?, ?, ?, ?)").run(serviceId, type, refId, next, payload === null ? null : JSON.stringify(payload));
    return getItem(Number(result.lastInsertRowid));
  }
);
function removeItem(itemId) {
  return db.prepare("DELETE FROM service_items WHERE id = ?").run(itemId).changes > 0;
}
const reorderItems = db.transaction((serviceId, orderedItemIds) => {
  const current = new Set(
    db.prepare("SELECT id FROM service_items WHERE service_id = ?").all(serviceId).map(
      (row) => row.id
    )
  );
  const requested = new Set(orderedItemIds);
  if (requested.size !== orderedItemIds.length || requested.size !== current.size || orderedItemIds.some((id) => !current.has(id))) {
    return false;
  }
  const update = db.prepare("UPDATE service_items SET order_index = ? WHERE id = ?");
  orderedItemIds.forEach((id, index) => update.run(index, id));
  return true;
});
const ITEM_TYPES = ["song", "scripture", "announcement"];
function assertId(value, name = "Id") {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}
function assertName(value) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError("Service needs a non-empty name");
  return value.trim();
}
function assertDate(value) {
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("Service date must be YYYY-MM-DD or null");
  }
  return value;
}
function assertTitle(value) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError("Item needs a non-empty title");
  return value.trim();
}
function assertScripture(value) {
  const payload = value;
  if (typeof payload !== "object" || payload === null || !Array.isArray(payload.verses) || payload.verses.length === 0) {
    throw new TypeError("Scripture needs a title and at least one verse");
  }
  const verses = payload.verses.map((verse) => {
    if (typeof (verse == null ? void 0 : verse.text) !== "string" || typeof verse.caption !== "string") {
      throw new TypeError("Each verse needs text and a caption");
    }
    return { text: verse.text, caption: verse.caption };
  });
  return { title: assertTitle(payload.title), verses };
}
function assertAnnouncement(value) {
  const payload = value;
  if (typeof payload !== "object" || payload === null || typeof payload.body !== "string") {
    throw new TypeError("Announcement needs a title and body text");
  }
  return { title: assertTitle(payload.title), body: payload.body };
}
function assertItem(type, refId, payload) {
  if (!ITEM_TYPES.includes(type)) {
    throw new TypeError(`Item type must be one of ${ITEM_TYPES.join(", ")}`);
  }
  if (type === "song") {
    if (payload !== null && payload !== void 0) throw new TypeError("Song items have no payload");
    return { type, refId: assertId(refId, "Song id"), payload: null };
  }
  if (refId !== null && refId !== void 0) throw new TypeError(`${type} items have no refId`);
  return type === "scripture" ? { type, refId: null, payload: assertScripture(payload) } : { type: "announcement", refId: null, payload: assertAnnouncement(payload) };
}
function registerServiceIpc() {
  ipcMain.handle(
    "services:create",
    (_event, name, date) => createService(assertName(name), assertDate(date))
  );
  ipcMain.handle("services:list", () => listServices());
  ipcMain.handle("services:get", (_event, id) => getService(assertId(id, "Service id")));
  ipcMain.handle("services:delete", (_event, id) => deleteService(assertId(id, "Service id")));
  ipcMain.handle("services:addItem", (_event, serviceId, type, refId, payload) => {
    const item = assertItem(type, refId, payload);
    return addItem(assertId(serviceId, "Service id"), item.type, item.refId, item.payload);
  });
  ipcMain.handle("services:removeItem", (_event, itemId) => removeItem(assertId(itemId, "Item id")));
  ipcMain.handle("services:reorderItems", (_event, serviceId, orderedItemIds) => {
    if (!Array.isArray(orderedItemIds)) throw new TypeError("Item ids must be an array");
    return reorderItems(
      assertId(serviceId, "Service id"),
      orderedItemIds.map((id) => assertId(id, "Item id"))
    );
  });
}
const MODES = ["show", "black", "clear", "logo"];
let lastState = { mode: "black", text: "", caption: "", background: "#000" };
function assertOutputState(value) {
  const state = value;
  if (typeof state !== "object" || state === null || !MODES.includes(state.mode) || typeof state.text !== "string" || typeof state.caption !== "string" || typeof state.background !== "string") {
    throw new TypeError("Output state needs a mode, text, caption and background");
  }
  return { mode: state.mode, text: state.text, caption: state.caption, background: state.background };
}
function registerOutputIpc(getOutputWindow) {
  ipcMain.on("output:send", (_event, state) => {
    var _a;
    try {
      lastState = assertOutputState(state);
    } catch (error) {
      console.error(error);
      return;
    }
    (_a = getOutputWindow()) == null ? void 0 : _a.webContents.send("output:state", lastState);
  });
}
function sendLastOutputState(win2) {
  win2.webContents.send("output:state", lastState);
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
let outputWin = null;
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
  win.on("closed", () => {
    win = null;
    outputWin == null ? void 0 : outputWin.close();
  });
}
function createOutputWindow() {
  const primaryId = screen.getPrimaryDisplay().id;
  const external = screen.getAllDisplays().find((display) => display.id !== primaryId);
  outputWin = new BrowserWindow({
    title: "WorshipDeck Output",
    backgroundColor: "#000",
    ...external ? { ...external.bounds, fullscreen: true, frame: false } : { width: 960, height: 540, resizable: true },
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  outputWin.webContents.on("did-finish-load", () => {
    if (outputWin) sendLastOutputState(outputWin);
  });
  outputWin.on("closed", () => {
    outputWin = null;
  });
  if (VITE_DEV_SERVER_URL) {
    outputWin.loadURL(`${VITE_DEV_SERVER_URL}#/output`);
  } else {
    outputWin.loadFile(path.join(RENDERER_DIST, "index.html"), { hash: "/output" });
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    createOutputWindow();
  }
});
app.whenReady().then(() => {
  registerSongIpc();
  registerBibleIpc();
  registerServiceIpc();
  registerOutputIpc(() => outputWin);
  createWindow();
  createOutputWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
