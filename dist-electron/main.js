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
      order_index INTEGER NOT NULL
    );
  `);
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
function assertId(value) {
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
  ipcMain.handle("songs:get", (_event, id) => getSong(assertId(id)));
  ipcMain.handle("songs:create", (_event, input) => {
    const { title, author, lyrics } = assertSongInput(input);
    return createSong(title, author, lyrics);
  });
  ipcMain.handle("songs:update", (_event, id, input) => {
    const { title, author, lyrics } = assertSongInput(input);
    return updateSong(assertId(id), title, author, lyrics);
  });
  ipcMain.handle("songs:delete", (_event, id) => deleteSong(assertId(id)));
}
const MODES = ["show", "black", "clear", "logo"];
let lastState = { mode: "black", text: "", background: "#000" };
function assertOutputState(value) {
  const state = value;
  if (typeof state !== "object" || state === null || !MODES.includes(state.mode) || typeof state.text !== "string" || typeof state.background !== "string") {
    throw new TypeError("Output state needs a mode, text and background");
  }
  return { mode: state.mode, text: state.text, background: state.background };
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
  registerOutputIpc(() => outputWin);
  createWindow();
  createOutputWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
