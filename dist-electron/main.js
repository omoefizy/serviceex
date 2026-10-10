import { app as G, ipcMain as m, dialog as v, BrowserWindow as le, protocol as kt, net as bn, screen as st } from "electron";
import { pathToFileURL as wn, fileURLToPath as Sn } from "node:url";
import g from "node:path";
import Nn from "better-sqlite3";
import { writeFile as Xe, stat as He, readdir as xn, readFile as Ft, mkdir as Pt, copyFile as An, rm as _n } from "node:fs/promises";
import { existsSync as In } from "node:fs";
function Cn(t) {
  t.pragma("foreign_keys = ON"), t.exec(`
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

    -- App-wide choices such as the default theme per content type.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `), J(t, "service_items", "payload", "TEXT"), J(t, "songs", "copyright", "TEXT"), J(t, "songs", "tags", "TEXT"), J(t, "songs", "arrangement", "TEXT"), J(t, "songs", "theme_id", "INTEGER");
}
function J(t, e, n, r) {
  t.prepare(`PRAGMA table_info(${e})`).all().some((s) => s.name === n) || t.exec(`ALTER TABLE ${e} ADD COLUMN ${n} ${r}`);
}
const Ln = g.join(G.getPath("userData"), "worshipdeck.db"), h = new Nn(Ln);
h.pragma("journal_mode = WAL");
Cn(h);
const On = "'Helvetica Neue', Inter, 'Segoe UI', Arial, sans-serif", ot = "Georgia, 'Times New Roman', serif", M = {
  fontFamily: On,
  fontWeight: 600,
  sizeMode: "auto",
  fontSize: 8,
  color: "#ffffff",
  align: "center",
  verticalAlign: "middle",
  lineHeight: 1.25,
  textCase: "normal",
  shadow: { enabled: !0, color: "#000000", blur: 0.12, offset: 0.04 },
  outline: { enabled: !1, color: "#000000", width: 0.03 },
  margins: { top: 6, right: 5, bottom: 6, left: 5 },
  band: { enabled: !1, color: "#000000", opacity: 0.6 },
  background: { kind: "solid", color: "#000000" },
  overlay: 0,
  caption: { fontFamily: "", fontWeight: 500, size: 3.2, color: "#bfc4cc", textCase: "normal", italic: !1 }
}, K = (t) => ({ ...M, ...t }), Rn = [
  { name: "Classic Black", style: M },
  {
    name: "Deep Blue Gradient",
    style: K({
      fontWeight: 700,
      background: { kind: "gradient", from: "#0b1d4d", to: "#1f5fbf", angle: 160 },
      shadow: { enabled: !0, color: "#020617", blur: 0.18, offset: 0.05 },
      caption: { ...M.caption, color: "#c7d7f5" }
    })
  },
  {
    name: "Warm Sunset",
    style: K({
      fontWeight: 700,
      background: { kind: "gradient", from: "#f59e0b", to: "#7c2d12", angle: 135 },
      overlay: 0.15,
      shadow: { enabled: !0, color: "#3b0d02", blur: 0.2, offset: 0.05 },
      caption: { ...M.caption, color: "#ffe7c2" }
    })
  },
  {
    name: "Minimal White",
    style: K({
      fontWeight: 500,
      color: "#111111",
      shadow: { ...M.shadow, enabled: !1 },
      background: { kind: "solid", color: "#ffffff" },
      caption: { ...M.caption, color: "#666666" }
    })
  },
  {
    // Chroma green behind an opaque band at the bottom: key the green out in OBS or a video switcher.
    name: "Lower Third",
    style: K({
      fontWeight: 600,
      align: "left",
      lineHeight: 1.2,
      margins: { top: 72, right: 0, bottom: 0, left: 0 },
      band: { enabled: !0, color: "#0b0f1a", opacity: 1 },
      background: { kind: "solid", color: "#00b140" },
      shadow: { ...M.shadow, enabled: !1 },
      caption: { ...M.caption, size: 2.8 }
    })
  },
  {
    name: "Scripture Serif",
    style: K({
      fontFamily: ot,
      fontWeight: 400,
      align: "left",
      lineHeight: 1.45,
      color: "#f4efe6",
      margins: { top: 8, right: 8, bottom: 8, left: 8 },
      background: { kind: "gradient", from: "#1c1712", to: "#0d0b09", angle: 180 },
      shadow: { enabled: !0, color: "#000000", blur: 0.1, offset: 0.03 },
      caption: { fontFamily: ot, fontWeight: 400, size: 3.4, color: "#d6b98c", textCase: "normal", italic: !0 }
    })
  }
], vn = {
  song: "Classic Black",
  scripture: "Scripture Serif",
  announcement: "Deep Blue Gradient"
}, ve = ["song", "scripture", "announcement"], U = (t) => typeof t == "object" && t !== null && !Array.isArray(t) ? t : {}, at = (t, e) => typeof t == "string" ? t : e, P = (t, e) => typeof t == "string" && /^#[0-9a-f]{6}$/i.test(t) ? t.toLowerCase() : e, de = (t, e) => typeof t == "boolean" ? t : e, w = (t, e, n, r) => typeof t == "number" && Number.isFinite(t) ? Math.min(r, Math.max(n, t)) : e, Q = (t, e, n) => e.includes(t) ? t : n, lt = ["normal", "upper", "lower"];
function Mn(t, e) {
  const n = U(t);
  switch (n.kind) {
    case "solid":
      return { kind: "solid", color: P(n.color, "#000000") };
    case "gradient":
      return { kind: "gradient", from: P(n.from, "#000000"), to: P(n.to, "#333333"), angle: w(n.angle, 180, 0, 360) };
    case "image":
      return typeof n.src != "string" || !n.src ? { kind: "solid", color: "#000000" } : n.fit === "contain" ? { kind: "image", src: n.src, fit: "contain" } : { kind: "image", src: n.src };
    case "video":
      return typeof n.src == "string" && n.src ? { kind: "video", src: n.src } : { kind: "solid", color: "#000000" };
    default:
      return e;
  }
}
function X(t) {
  const e = M, n = U(t), r = U(n.shadow), i = U(n.outline), s = U(n.margins), a = U(n.band), o = U(n.caption);
  return {
    fontFamily: at(n.fontFamily, e.fontFamily).trim() || e.fontFamily,
    fontWeight: Math.round(w(n.fontWeight, e.fontWeight, 100, 900) / 100) * 100,
    sizeMode: Q(n.sizeMode, ["auto", "fixed"], e.sizeMode),
    fontSize: w(n.fontSize, e.fontSize, 1, 30),
    color: P(n.color, e.color),
    align: Q(n.align, ["left", "center", "right"], e.align),
    verticalAlign: Q(n.verticalAlign, ["top", "middle", "bottom"], e.verticalAlign),
    lineHeight: w(n.lineHeight, e.lineHeight, 0.8, 2.5),
    textCase: Q(n.textCase, lt, e.textCase),
    shadow: {
      enabled: de(r.enabled, e.shadow.enabled),
      color: P(r.color, e.shadow.color),
      blur: w(r.blur, e.shadow.blur, 0, 1),
      offset: w(r.offset, e.shadow.offset, 0, 0.5)
    },
    outline: {
      enabled: de(i.enabled, e.outline.enabled),
      color: P(i.color, e.outline.color),
      width: w(i.width, e.outline.width, 0, 0.2)
    },
    margins: {
      top: w(s.top, e.margins.top, 0, 90),
      right: w(s.right, e.margins.right, 0, 45),
      bottom: w(s.bottom, e.margins.bottom, 0, 90),
      left: w(s.left, e.margins.left, 0, 45)
    },
    band: {
      enabled: de(a.enabled, e.band.enabled),
      color: P(a.color, e.band.color),
      opacity: w(a.opacity, e.band.opacity, 0, 1)
    },
    background: Mn(n.background, e.background),
    overlay: w(n.overlay, e.overlay, 0, 1),
    caption: {
      fontFamily: at(o.fontFamily, e.caption.fontFamily).trim(),
      fontWeight: Math.round(w(o.fontWeight, e.caption.fontWeight, 100, 900) / 100) * 100,
      size: w(o.size, e.caption.size, 1, 15),
      color: P(o.color, e.caption.color),
      textCase: Q(o.textCase, lt, e.caption.textCase),
      italic: de(o.italic, e.caption.italic)
    }
  };
}
function $t(t) {
  try {
    return X(JSON.parse(t));
  } catch {
    return X(null);
  }
}
const kn = (t) => ({ id: t.id, name: t.name, type: t.type, style: $t(t.json) }), Fn = h.transaction(() => {
  const t = h.prepare("SELECT id FROM themes WHERE type = 'builtin' AND name = ?"), e = h.prepare("INSERT INTO themes (name, type, json) VALUES (?, 'builtin', ?)"), n = h.prepare("UPDATE themes SET json = ? WHERE id = ?");
  for (const { name: r, style: i } of Rn) {
    const s = t.get(r);
    s ? n.run(JSON.stringify(i), s.id) : e.run(r, JSON.stringify(i));
  }
});
function Pn() {
  return h.prepare("SELECT id, name, type, json FROM themes ORDER BY type = 'custom', id").all().map(
    kn
  );
}
function $n(t, e) {
  const n = JSON.stringify(X(e)), r = h.prepare("INSERT INTO themes (name, type, json) VALUES (?, 'custom', ?)").run(t, n);
  return { id: Number(r.lastInsertRowid), name: t, type: "custom", style: $t(n) };
}
function jn(t, e, n) {
  return h.prepare("UPDATE themes SET name = ?, json = ? WHERE id = ? AND type = 'custom'").run(e, JSON.stringify(X(n)), t).changes > 0;
}
const Un = h.transaction((t) => h.prepare("DELETE FROM themes WHERE id = ? AND type = 'custom'").run(t).changes === 0 ? !1 : (h.prepare("UPDATE songs SET theme_id = NULL WHERE theme_id = ?").run(t), h.prepare("DELETE FROM settings WHERE key LIKE 'theme.default.%' AND value = ?").run(String(t)), !0)), jt = (t) => `theme.default.${t}`;
function Bn() {
  var i;
  const t = h.prepare("SELECT 1 FROM themes WHERE id = ?"), e = h.prepare("SELECT id FROM themes WHERE type = 'builtin' AND name = ?"), n = h.prepare("SELECT value FROM settings WHERE key = ?"), r = {};
  for (const s of ve) {
    const a = Number((i = n.get(jt(s))) == null ? void 0 : i.value);
    r[s] = Number.isInteger(a) && t.get(a) ? a : e.get(vn[s]).id;
  }
  return r;
}
function Vn(t, e) {
  if (!h.prepare("SELECT 1 FROM themes WHERE id = ?").get(e)) throw new Error(`Theme ${e} does not exist`);
  h.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
    jt(t),
    String(e)
  );
}
const ye = { order: [], linesPerSlide: null }, Ut = [2, 3, 4], Wn = /^\s*\[([^\]]+)\]\s*$/;
function Bt(t) {
  const e = t;
  return typeof e == "object" && e !== null && Array.isArray(e.order) && e.order.every((n) => typeof n == "string") && (e.linesPerSlide === null || Ut.includes(e.linesPerSlide));
}
function Vt(t) {
  const e = t.replace(/\r\n?/g, `
`).split(`
`), n = [];
  let r = null, i = null;
  for (let s = 0; s < e.length; s++) {
    const a = e[s], o = Wn.exec(a);
    if ((o || a.trim() === "") && (i && r && (i.endLine = s, r.chunks.push(i)), i = null), o) {
      r && (r.endLine = s), r = { label: o[1].trim(), labelLine: s, startLine: s, endLine: e.length, chunks: [] }, n.push(r);
      continue;
    }
    a.trim() !== "" && (r || (r = { label: null, labelLine: null, startLine: 0, endLine: e.length, chunks: [] }, n.push(r)), i ?? (i = { startLine: s, endLine: s + 1, lines: [] }), i.lines.push(a.trim()));
  }
  return i && r && (i.endLine = e.length, r.chunks.push(i)), n;
}
function Xn(t, e) {
  if (e === null || t.length <= e) return [t];
  const n = Math.ceil(t.length / e), r = [];
  let i = 0;
  for (let s = 0; s < n; s++) {
    const a = Math.floor(t.length / n) + (s < t.length % n ? 1 : 0);
    r.push(t.slice(i, i + a)), i += a;
  }
  return r;
}
function ct(t, e) {
  return t.chunks.flatMap((n) => Xn(n.lines, e)).map((n) => ({ text: n.join(`
`), label: t.label }));
}
function Hn(t, e) {
  const n = e.trim().toLowerCase();
  return t.find((r) => {
    var i;
    return ((i = r.label) == null ? void 0 : i.toLowerCase()) === n;
  });
}
function Yn(t, e = ye) {
  const n = Vt(t);
  return e.order.length === 0 ? n.flatMap((r) => ct(r, e.linesPerSlide)) : e.order.flatMap((r) => {
    const i = Hn(n, r);
    return i ? ct(i, e.linesPerSlide) : [];
  });
}
function dt(t) {
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
function qn(t) {
  const e = dt(t.tags), n = dt(t.arrangement);
  return {
    id: t.id,
    title: t.title,
    author: t.author,
    copyright: t.copyright,
    tags: Array.isArray(e) ? e.filter((r) => typeof r == "string") : [],
    arrangement: Bt(n) ? n : ye,
    themeId: t.theme_id,
    lyrics: t.lyrics ?? ""
  };
}
function Wt(t, e, n) {
  h.prepare("DELETE FROM slides WHERE song_id = ?").run(t);
  const r = h.prepare("INSERT INTO slides (song_id, order_index, text) VALUES (?, ?, ?)");
  Yn(e, n).forEach((i, s) => r.run(t, s, i.text));
}
function Xt(t) {
  return {
    title: t.title,
    author: t.author,
    copyright: t.copyright,
    tags: JSON.stringify(t.tags),
    arrangement: JSON.stringify(t.arrangement),
    theme_id: t.themeId,
    lyrics: t.lyrics
  };
}
function Ye(t) {
  const e = t == null ? void 0 : t.trim();
  if (!e)
    return h.prepare("SELECT id, title, author FROM songs ORDER BY title COLLATE NOCASE").all();
  const n = `%${e.replace(/[\\%_]/g, (r) => `\\${r}`)}%`;
  return h.prepare(
    `SELECT id, title, author FROM songs
       WHERE title LIKE @pattern ESCAPE '\\'
          OR author LIKE @pattern ESCAPE '\\'
          OR tags LIKE @pattern ESCAPE '\\'
          OR lyrics LIKE @pattern ESCAPE '\\'
       ORDER BY title COLLATE NOCASE`
  ).all({ pattern: n });
}
function Ht(t) {
  const e = h.prepare("SELECT id, title, author, copyright, tags, arrangement, theme_id, lyrics FROM songs WHERE id = ?").get(t);
  return e && qn(e);
}
const Yt = h.transaction((t) => {
  const e = h.prepare(
    `INSERT INTO songs (title, author, copyright, tags, arrangement, theme_id, lyrics)
       VALUES (@title, @author, @copyright, @tags, @arrangement, @theme_id, @lyrics)`
  ).run(Xt(t)), n = Number(e.lastInsertRowid);
  return Wt(n, t.lyrics, t.arrangement), { id: n, ...t };
}), Dn = h.transaction((t) => (t.forEach((e) => Yt(e)), t.length)), Gn = h.transaction((t, e) => h.prepare(
  `UPDATE songs SET title = @title, author = @author, copyright = @copyright, tags = @tags,
         arrangement = @arrangement, theme_id = @theme_id, lyrics = @lyrics
       WHERE id = @id`
).run({ ...Xt(e), id: t }).changes === 0 ? !1 : (Wt(t, e.lyrics, e.arrangement), !0));
function zn(t) {
  return h.prepare("DELETE FROM songs WHERE id = ?").run(t).changes > 0;
}
function we(t) {
  if (!Number.isInteger(t) || t < 1)
    throw new TypeError("Song id must be a positive integer");
  return t;
}
function Me(t) {
  const e = t;
  if (typeof e != "object" || e === null || typeof e.title != "string" || e.title.trim() === "" || e.author !== null && typeof e.author != "string" || e.copyright !== null && typeof e.copyright != "string" || !Array.isArray(e.tags) || !e.tags.every((n) => typeof n == "string") || !Bt(e.arrangement) || e.themeId !== null && !(Number.isInteger(e.themeId) && e.themeId > 0) || typeof e.lyrics != "string")
    throw new TypeError(
      "Song needs a non-empty title, author and copyright (string or null), tags, an arrangement, a theme id (or null) and lyrics"
    );
  return {
    title: e.title.trim(),
    author: e.author,
    copyright: e.copyright,
    tags: e.tags,
    arrangement: { order: e.arrangement.order, linesPerSlide: e.arrangement.linesPerSlide },
    themeId: e.themeId,
    lyrics: e.lyrics
  };
}
function Jn() {
  m.handle(
    "songs:list",
    (t, e) => Ye(typeof e == "string" ? e : void 0)
  ), m.handle("songs:get", (t, e) => Ht(we(e))), m.handle("songs:create", (t, e) => Yt(Me(e))), m.handle(
    "songs:update",
    (t, e, n) => Gn(we(e), Me(n))
  ), m.handle("songs:delete", (t, e) => zn(we(e)));
}
const qe = "v.book, v.chapter, v.verse, v.text", De = "FROM verses v JOIN bible_versions b ON b.id = v.version_id WHERE b.code = @version";
function Kn(t, e, n, r) {
  return h.prepare(
    `SELECT ${qe} ${De}
         AND v.book = @book AND v.chapter = @chapter AND v.verse = @verse`
  ).get({ version: t, book: e, chapter: n, verse: r });
}
function Qn(t, e, n, r, i) {
  return h.prepare(
    `SELECT ${qe} ${De}
         AND v.book = @book AND v.chapter = @chapter AND v.verse BETWEEN @verseStart AND @verseEnd
       ORDER BY v.verse`
  ).all({ version: t, book: e, chapter: n, verseStart: r, verseEnd: i });
}
function Zn(t, e) {
  const n = e.trim();
  if (!n) return [];
  const r = `%${n.replace(/[\\%_]/g, (i) => `\\${i}`)}%`;
  return h.prepare(
    `SELECT ${qe} ${De}
         AND v.text LIKE @pattern ESCAPE '\\'
       ORDER BY v.id
       LIMIT 100`
  ).all({ version: t, pattern: r });
}
function er() {
  return h.prepare("SELECT book FROM verses GROUP BY book ORDER BY MIN(id)").all().map(
    (t) => t.book
  );
}
const ut = ["KJV", "WEB"];
function Se(t) {
  if (!ut.includes(t))
    throw new TypeError(`Bible version must be one of ${ut.join(", ")}`);
  return t;
}
function pt(t) {
  if (typeof t != "string" || t.trim() === "") throw new TypeError("Book must be a non-empty string");
  return t;
}
function Z(t, e) {
  if (!Number.isInteger(t) || t < 1)
    throw new TypeError(`${e} must be a positive integer`);
  return t;
}
function tr() {
  m.handle(
    "bible:getVerse",
    (t, e, n, r, i) => Kn(Se(e), pt(n), Z(r, "Chapter"), Z(i, "Verse"))
  ), m.handle(
    "bible:getRange",
    (t, e, n, r, i, s) => Qn(
      Se(e),
      pt(n),
      Z(r, "Chapter"),
      Z(i, "First verse"),
      Z(s, "Last verse")
    )
  ), m.handle(
    "bible:searchText",
    (t, e, n) => Zn(Se(e), typeof n == "string" ? n : "")
  ), m.handle("bible:listBooks", () => er());
}
const qt = `
  SELECT i.id, i.service_id, i.type, i.ref_id, i.order_index, i.payload, s.title AS song_title
  FROM service_items i
  LEFT JOIN songs s ON i.type = 'song' AND s.id = i.ref_id`;
function Dt(t) {
  const e = { id: t.id, service_id: t.service_id, order: t.order_index };
  if (t.type === "song")
    return { ...e, type: "song", ref_id: t.ref_id, payload: null, title: t.song_title ?? "Missing song" };
  if (t.type === "scripture") {
    const r = JSON.parse(t.payload ?? "{}");
    return { ...e, type: "scripture", ref_id: null, payload: r, title: r.title };
  }
  if (t.type === "presentation") {
    const r = JSON.parse(t.payload ?? "{}");
    return { ...e, type: "presentation", ref_id: null, payload: r, title: r.title };
  }
  const n = JSON.parse(t.payload ?? "{}");
  return { ...e, type: "announcement", ref_id: null, payload: n, title: n.title };
}
function nr(t) {
  const e = h.prepare(`${qt} WHERE i.id = ?`).get(t);
  return e && Dt(e);
}
function rr(t, e) {
  const n = h.prepare("INSERT INTO services (name, date) VALUES (?, ?)").run(t, e);
  return { id: Number(n.lastInsertRowid), name: t, date: e };
}
function ir() {
  return h.prepare("SELECT id, name, date FROM services ORDER BY date IS NULL, date DESC, id DESC").all();
}
function sr(t) {
  const e = h.prepare("SELECT id, name, date FROM services WHERE id = ?").get(t);
  if (!e) return;
  const n = h.prepare(`${qt} WHERE i.service_id = ? ORDER BY i.order_index, i.id`).all(t);
  return { ...e, items: n.map(Dt) };
}
function or(t) {
  return h.prepare("DELETE FROM services WHERE id = ?").run(t).changes > 0;
}
const ar = h.transaction(
  (t, e, n, r) => {
    if (!h.prepare("SELECT 1 FROM services WHERE id = ?").get(t))
      throw new Error(`Service ${t} does not exist`);
    if (e === "song" && !h.prepare("SELECT 1 FROM songs WHERE id = ?").get(n))
      throw new Error(`Song ${n} does not exist`);
    const { next: i } = h.prepare("SELECT COALESCE(MAX(order_index) + 1, 0) AS next FROM service_items WHERE service_id = ?").get(t), s = h.prepare("INSERT INTO service_items (service_id, type, ref_id, order_index, payload) VALUES (?, ?, ?, ?, ?)").run(t, e, n, i, r === null ? null : JSON.stringify(r));
    return nr(Number(s.lastInsertRowid));
  }
);
function lr(t) {
  return h.prepare("DELETE FROM service_items WHERE id = ?").run(t).changes > 0;
}
const cr = h.transaction((t, e) => {
  const n = new Set(
    h.prepare("SELECT id FROM service_items WHERE service_id = ?").all(t).map(
      (s) => s.id
    )
  ), r = new Set(e);
  if (r.size !== e.length || r.size !== n.size || e.some((s) => !n.has(s)))
    return !1;
  const i = h.prepare("UPDATE service_items SET order_index = ? WHERE id = ?");
  return e.forEach((s, a) => i.run(a, s)), !0;
}), ht = ["song", "scripture", "announcement", "presentation"], ft = 500;
function B(t, e = "Id") {
  if (!Number.isInteger(t) || t < 1)
    throw new TypeError(`${e} must be a positive integer`);
  return t;
}
function dr(t) {
  if (typeof t != "string" || t.trim() === "") throw new TypeError("Service needs a non-empty name");
  return t.trim();
}
function ur(t) {
  if (t == null || t === "") return null;
  if (typeof t != "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t))
    throw new TypeError("Service date must be YYYY-MM-DD or null");
  return t;
}
function Ge(t) {
  if (typeof t != "string" || t.trim() === "") throw new TypeError("Item needs a non-empty title");
  return t.trim();
}
function pr(t) {
  const e = t;
  if (typeof e != "object" || e === null || !Array.isArray(e.verses) || e.verses.length === 0)
    throw new TypeError("Scripture needs a title and at least one verse");
  const n = e.verses.map((r) => {
    if (typeof (r == null ? void 0 : r.text) != "string" || typeof r.caption != "string")
      throw new TypeError("Each verse needs text and a caption");
    return { text: r.text, caption: r.caption };
  });
  return { title: Ge(e.title), verses: n };
}
function hr(t) {
  const e = t;
  if (typeof e != "object" || e === null || typeof e.body != "string")
    throw new TypeError("Announcement needs a title and body text");
  return { title: Ge(e.title), body: e.body };
}
function fr(t) {
  const e = t;
  if (typeof e != "object" || e === null || !Array.isArray(e.pages) || e.pages.length === 0 || e.pages.length > ft || !e.pages.every((n) => typeof n == "string" && n.startsWith("wd-media://")))
    throw new TypeError(`A presentation needs a title and 1 to ${ft} page images`);
  return { title: Ge(e.title), pages: e.pages };
}
function gr(t, e, n) {
  if (!ht.includes(t))
    throw new TypeError(`Item type must be one of ${ht.join(", ")}`);
  if (t === "song") {
    if (n != null) throw new TypeError("Song items have no payload");
    return { type: t, refId: B(e, "Song id"), payload: null };
  }
  if (e != null) throw new TypeError(`${t} items have no refId`);
  return t === "scripture" ? { type: t, refId: null, payload: pr(n) } : t === "presentation" ? { type: t, refId: null, payload: fr(n) } : { type: "announcement", refId: null, payload: hr(n) };
}
function mr() {
  m.handle(
    "services:create",
    (t, e, n) => rr(dr(e), ur(n))
  ), m.handle("services:list", () => ir()), m.handle("services:get", (t, e) => sr(B(e, "Service id"))), m.handle("services:delete", (t, e) => or(B(e, "Service id"))), m.handle("services:addItem", (t, e, n, r, i) => {
    const s = gr(n, r, i);
    return ar(B(e, "Service id"), s.type, s.refId, s.payload);
  }), m.handle("services:removeItem", (t, e) => lr(B(e, "Item id"))), m.handle("services:reorderItems", (t, e, n) => {
    if (!Array.isArray(n)) throw new TypeError("Item ids must be an array");
    return cr(
      B(e, "Service id"),
      n.map((r) => B(r, "Item id"))
    );
  });
}
const Gt = ":A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD", Er = Gt + "\\-.\\d\\u00B7\\u0300-\\u036F\\u203F-\\u2040", yr = "[" + Gt + "][" + Er + "]*", Tr = new RegExp("^" + yr + "$");
function br(t, e) {
  const n = [];
  let r = e.exec(t);
  for (; r; ) {
    const i = [];
    i.startIndex = e.lastIndex - r[0].length;
    const s = r.length;
    for (let a = 0; a < s; a++)
      i.push(r[a]);
    n.push(i), r = e.exec(t);
  }
  return n;
}
const zt = function(t) {
  const e = Tr.exec(t);
  return !(e === null || typeof e > "u");
};
function wr(t) {
  return typeof t < "u";
}
const ze = [
  // '__proto__',
  // 'constructor',
  // 'prototype',
  "hasOwnProperty",
  "toString",
  "valueOf",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__"
], Jt = ["__proto__", "constructor", "prototype"], Sr = {
  allowBooleanAttributes: !1,
  //A tag can have attributes without any value
  unpairedTags: []
};
function Nr(t, e) {
  e = Object.assign({}, Sr, e);
  const n = [];
  let r = !1, i = !1;
  t[0] === "\uFEFF" && (t = t.substr(1));
  for (let s = 0; s < t.length; s++)
    if (t[s] === "<" && t[s + 1] === "?") {
      if (s += 2, s = gt(t, s), s.err) return s;
    } else if (t[s] === "<") {
      let a = s;
      if (s++, t[s] === "!") {
        s = mt(t, s);
        continue;
      } else {
        let o = !1;
        t[s] === "/" && (o = !0, s++);
        let l = "";
        for (; s < t.length && t[s] !== ">" && t[s] !== " " && t[s] !== "	" && t[s] !== `
` && t[s] !== "\r"; s++)
          l += t[s];
        if (l = l.trim(), l[l.length - 1] === "/" && (l = l.substring(0, l.length - 1), s--), !Rr(l)) {
          let u;
          return l.trim().length === 0 ? u = "Invalid space after '<'." : u = "Tag '" + l + "' is an invalid name.", T("InvalidTag", u, S(t, s));
        }
        const d = _r(t, s);
        if (d === !1)
          return T("InvalidAttr", "Attributes for '" + l + "' have open quote.", S(t, s));
        let c = d.value;
        if (s = d.index, c[c.length - 1] === "/") {
          const u = s - c.length;
          c = c.substring(0, c.length - 1);
          const p = Et(c, e);
          if (p === !0)
            r = !0;
          else
            return T(p.err.code, p.err.msg, S(t, u + p.err.line));
        } else if (o)
          if (d.tagClosed) {
            if (c.trim().length > 0)
              return T("InvalidTag", "Closing tag '" + l + "' can't have attributes or invalid starting.", S(t, a));
            if (n.length === 0)
              return T("InvalidTag", "Closing tag '" + l + "' has not been opened.", S(t, a));
            {
              const u = n.pop();
              if (l !== u.tagName) {
                let p = S(t, u.tagStartPos);
                return T(
                  "InvalidTag",
                  "Expected closing tag '" + u.tagName + "' (opened in line " + p.line + ", col " + p.col + ") instead of closing tag '" + l + "'.",
                  S(t, a)
                );
              }
              n.length == 0 && (i = !0);
            }
          } else return T("InvalidTag", "Closing tag '" + l + "' doesn't have proper closing.", S(t, s));
        else {
          const u = Et(c, e);
          if (u !== !0)
            return T(u.err.code, u.err.msg, S(t, s - c.length + u.err.line));
          if (i === !0)
            return T("InvalidXml", "Multiple possible root nodes found.", S(t, s));
          e.unpairedTags.indexOf(l) !== -1 || n.push({ tagName: l, tagStartPos: a }), r = !0;
        }
        for (s++; s < t.length; s++)
          if (t[s] === "<")
            if (t[s + 1] === "!") {
              s++, s = mt(t, s);
              continue;
            } else if (t[s + 1] === "?") {
              if (s = gt(t, ++s), s.err) return s;
            } else
              break;
          else if (t[s] === "&") {
            const u = Lr(t, s);
            if (u == -1)
              return T("InvalidChar", "char '&' is not expected.", S(t, s));
            s = u;
          } else if (i === !0 && !Y(t[s]))
            return T("InvalidXml", "Extra text at the end", S(t, s));
        t[s] === "<" && s--;
      }
    } else {
      if (Y(t[s]))
        continue;
      return T("InvalidChar", "char '" + t[s] + "' is not expected.", S(t, s));
    }
  if (r) {
    if (n.length == 1)
      return T("InvalidTag", "Unclosed tag '" + n[0].tagName + "'.", S(t, n[0].tagStartPos));
    if (n.length > 0)
      return T("InvalidXml", "Invalid '" + JSON.stringify(n.map((s) => s.tagName), null, 4).replace(/\r?\n/g, "") + "' found.", { line: 1, col: 1 });
  } else return T("InvalidXml", "Start tag expected.", 1);
  return !0;
}
function Y(t) {
  return t === " " || t === "	" || t === `
` || t === "\r";
}
function gt(t, e) {
  const n = e;
  for (; e < t.length; e++)
    if (t[e] == "?" || t[e] == " ") {
      const r = t.substr(n, e - n);
      if (e > 5 && r === "xml")
        return T("InvalidXml", "XML declaration allowed only at the start of the document.", S(t, e));
      if (t[e] == "?" && t[e + 1] == ">") {
        e++;
        break;
      } else
        continue;
    }
  return e;
}
function mt(t, e) {
  if (t.length > e + 5 && t[e + 1] === "-" && t[e + 2] === "-") {
    for (e += 3; e < t.length; e++)
      if (t[e] === "-" && t[e + 1] === "-" && t[e + 2] === ">") {
        e += 2;
        break;
      }
  } else if (t.length > e + 8 && t[e + 1] === "D" && t[e + 2] === "O" && t[e + 3] === "C" && t[e + 4] === "T" && t[e + 5] === "Y" && t[e + 6] === "P" && t[e + 7] === "E") {
    let n = 1;
    for (e += 8; e < t.length; e++)
      if (t[e] === "<")
        n++;
      else if (t[e] === ">" && (n--, n === 0))
        break;
  } else if (t.length > e + 9 && t[e + 1] === "[" && t[e + 2] === "C" && t[e + 3] === "D" && t[e + 4] === "A" && t[e + 5] === "T" && t[e + 6] === "A" && t[e + 7] === "[") {
    for (e += 8; e < t.length; e++)
      if (t[e] === "]" && t[e + 1] === "]" && t[e + 2] === ">") {
        e += 2;
        break;
      }
  }
  return e;
}
const xr = '"', Ar = "'";
function _r(t, e) {
  let n = "", r = "", i = !1;
  for (; e < t.length; e++) {
    if (t[e] === xr || t[e] === Ar)
      r === "" ? r = t[e] : r !== t[e] || (r = "");
    else if (t[e] === ">" && r === "") {
      i = !0;
      break;
    }
    n += t[e];
  }
  return r !== "" ? !1 : {
    value: n,
    index: e,
    tagClosed: i
  };
}
function Ir(t) {
  const e = [], n = t.length;
  let r = 0;
  for (; r < n; ) {
    const i = r;
    for (; r < n && Y(t[r]); ) r++;
    if (r >= n) break;
    if (t[r] === "=") {
      r = i + 1;
      continue;
    }
    const s = t.slice(i, r), a = r;
    for (; r < n && !Y(t[r]) && t[r] !== "="; ) r++;
    const o = t.slice(a, r);
    let l, d = r;
    for (; d < n && Y(t[d]); ) d++;
    d < n && t[d] === "=" && (l = t.slice(r, d + 1), r = d + 1);
    let c, u, p = r;
    for (; p < n && Y(t[p]); ) p++;
    if (p < n && (t[p] === '"' || t[p] === "'")) {
      const y = p + 1, E = t.indexOf(t[p], y);
      E !== -1 && (c = t[p], u = t.slice(y, E), r = E + 1);
    }
    const f = { startIndex: i };
    f[1] = s, f[2] = o, f[3] = l, f[4] = c !== void 0 ? !0 : void 0, f[5] = c, f[6] = u, e.push(f);
  }
  return e;
}
function Et(t, e) {
  const n = Ir(t), r = {};
  for (let i = 0; i < n.length; i++) {
    if (n[i][1].length === 0)
      return T("InvalidAttr", "Attribute '" + n[i][2] + "' has no space in starting.", ee(n[i]));
    if (n[i][3] !== void 0 && n[i][4] === void 0)
      return T("InvalidAttr", "Attribute '" + n[i][2] + "' is without value.", ee(n[i]));
    if (n[i][3] === void 0 && !e.allowBooleanAttributes)
      return T("InvalidAttr", "boolean attribute '" + n[i][2] + "' is not allowed.", ee(n[i]));
    const s = n[i][2];
    if (!Or(s))
      return T("InvalidAttr", "Attribute '" + s + "' is an invalid name.", ee(n[i]));
    if (!Object.prototype.hasOwnProperty.call(r, s))
      r[s] = 1;
    else
      return T("InvalidAttr", "Attribute '" + s + "' is repeated.", ee(n[i]));
  }
  return !0;
}
function Cr(t, e) {
  let n = /\d/;
  for (t[e] === "x" && (e++, n = /[\da-fA-F]/); e < t.length; e++) {
    if (t[e] === ";")
      return e;
    if (!t[e].match(n))
      break;
  }
  return -1;
}
function Lr(t, e) {
  if (e++, t[e] === ";")
    return -1;
  if (t[e] === "#")
    return e++, Cr(t, e);
  let n = 0;
  for (; e < t.length; e++, n++)
    if (!(t[e].match(/\w/) && n < 20)) {
      if (t[e] === ";")
        break;
      return -1;
    }
  return e;
}
function T(t, e, n) {
  return {
    err: {
      code: t,
      msg: e,
      line: n.line || n,
      col: n.col
    }
  };
}
function Or(t) {
  return zt(t);
}
function Rr(t) {
  return zt(t);
}
function S(t, e) {
  const n = t.substring(0, e).split(/\r?\n/);
  return {
    line: n.length,
    // column number is last line's length + 1, because column numbering starts at 1:
    col: n[n.length - 1].length + 1
  };
}
function ee(t) {
  return t.startIndex + t[1].length;
}
const vr = {
  cent: "¢",
  pound: "£",
  curren: "¤",
  yen: "¥",
  euro: "€",
  dollar: "$",
  fnof: "ƒ",
  inr: "₹",
  af: "؋",
  birr: "ብር",
  peso: "₱",
  rub: "₽",
  won: "₩",
  yuan: "¥",
  cedil: "¸"
}, Kt = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"'
}, Mr = {
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  para: "¶",
  sect: "§",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾"
}, fe = Object.freeze({
  /** Resolve and expand the entity normally. */
  ALLOW: "allow",
  /** Silently skip this entity — it will not be registered. */
  BLOCK: "block",
  /** Throw an error, aborting entity registration entirely. */
  THROW: "throw"
}), kr = new Set("!?\\\\/[]$%{}^&*()<>|+");
function yt(t) {
  if (t[0] === "#")
    throw new Error(`[EntityReplacer] Invalid character '#' in entity name: "${t}"`);
  for (const e of t)
    if (kr.has(e))
      throw new Error(`[EntityReplacer] Invalid character '${e}' in entity name: "${t}"`);
  return t;
}
function te(...t) {
  const e = /* @__PURE__ */ Object.create(null);
  for (const n of t)
    if (n)
      for (const r of Object.keys(n)) {
        const i = n[r];
        if (typeof i == "string")
          e[r] = i;
        else if (i && typeof i == "object" && i.val !== void 0) {
          const s = i.val;
          typeof s == "string" && (e[r] = s);
        }
      }
  return e;
}
const W = "external", ge = "base", ke = "all";
function Fr(t) {
  return !t || t === W ? /* @__PURE__ */ new Set([W]) : t === ke ? /* @__PURE__ */ new Set([ke]) : t === ge ? /* @__PURE__ */ new Set([ge]) : Array.isArray(t) ? new Set(t) : /* @__PURE__ */ new Set([W]);
}
const A = Object.freeze({ allow: 0, leave: 1, remove: 2, throw: 3 }), Pr = /* @__PURE__ */ new Set([9, 10, 13]);
function $r(t) {
  if (!t)
    return { xmlVersion: 1, onLevel: A.allow, nullLevel: A.remove };
  const e = t.xmlVersion === 1.1 ? 1.1 : 1, n = A[t.onNCR] ?? A.allow, r = A[t.nullNCR] ?? A.remove, i = Math.max(r, A.remove);
  return { xmlVersion: e, onLevel: n, nullLevel: i };
}
class jr {
  /**
   * @param {object} [options]
   * @param {object|null}  [options.namedEntities]        — extra named entities merged into base map
   * @param {object}  [options.limit]                 — security limits
   * @param {number}       [options.limit.maxTotalExpansions=0]  — 0 = unlimited
   * @param {number}       [options.limit.maxExpandedLength=0]   — 0 = unlimited
   * @param {'external'|'base'|'all'|string[]} [options.limit.applyLimitsTo='external']
   *   Which entity tiers count against the security limits:
   *   - 'external' (default) — only input/runtime + persistent external entities
   *   - 'base'               — only DEFAULT_XML_ENTITIES + namedEntities
   *   - 'all'                — every entity regardless of tier
   *   - string[]             — explicit combination, e.g. ['external', 'base']
   * @param {((resolved: string, original: string) => string)|null} [options.postCheck=null]
   * @param {string[]} [options.remove=[]] — entity names (e.g. ['nbsp', '#13']) to delete (replace with empty string)
   * @param {string[]} [options.leave=[]]  — entity names to keep as literal (unchanged in output)
   * @param {object}   [options.ncr]       — Numeric Character Reference controls
   * @param {1.0|1.1}  [options.ncr.xmlVersion=1.0]
   *   XML version governing which codepoint ranges are restricted:
   *   - 1.0 — C0 controls U+0001–U+001F (except U+0009/000A/000D) are prohibited
   *   - 1.1 — C0 controls are allowed when written as NCRs; C1 (U+007F–U+009F) decoded as-is
   * @param {'allow'|'leave'|'remove'|'throw'} [options.ncr.onNCR='allow']
   *   Base action for numeric references. Severity order: allow < leave < remove < throw.
   *   For codepoint ranges that carry a minimum level (surrogates → remove, XML 1.0 C0 → remove),
   *   the effective action is max(onNCR, rangeMinimum).
   * @param {'remove'|'throw'} [options.ncr.nullNCR='remove']
   *   Action for U+0000 (null). 'allow' and 'leave' are clamped to 'remove' since null is never safe.
   * @param {((name: string, value: string) => 'allow'|'block'|'throw')|null} [options.onExternalEntity=null]
   *   Hook called when an external entity is registered via `setExternalEntities()` or
   *   `addExternalEntity()`. Return `ENTITY_ACTION.ALLOW` to accept the entity,
   *   `ENTITY_ACTION.BLOCK` to silently skip it, or `ENTITY_ACTION.THROW` to abort with an error.
   * @param {((name: string, value: string) => 'allow'|'block'|'throw')|null} [options.onInputEntity=null]
   *   Hook called when an input entity is registered via `addInputEntities()`. Return
   *   `ENTITY_ACTION.ALLOW` to accept, `ENTITY_ACTION.BLOCK` to silently skip, or
   *   `ENTITY_ACTION.THROW` to abort with an error.
   */
  constructor(e = {}) {
    this._limit = e.limit || {}, this._maxTotalExpansions = this._limit.maxTotalExpansions || 0, this._maxExpandedLength = this._limit.maxExpandedLength || 0, this._postCheck = typeof e.postCheck == "function" ? e.postCheck : (r) => r, this._limitTiers = Fr(this._limit.applyLimitsTo ?? W), this._numericAllowed = e.numericAllowed ?? !0, this._baseMap = te(Kt, e.namedEntities || null), this._externalMap = /* @__PURE__ */ Object.create(null), this._inputMap = /* @__PURE__ */ Object.create(null), this._totalExpansions = 0, this._expandedLength = 0, this._removeSet = new Set(e.remove && Array.isArray(e.remove) ? e.remove : []), this._leaveSet = new Set(e.leave && Array.isArray(e.leave) ? e.leave : []);
    const n = $r(e.ncr);
    this._ncrXmlVersion = n.xmlVersion, this._ncrOnLevel = n.onLevel, this._ncrNullLevel = n.nullLevel, this._onExternalEntity = typeof e.onExternalEntity == "function" ? e.onExternalEntity : null, this._onInputEntity = typeof e.onInputEntity == "function" ? e.onInputEntity : null;
  }
  // -------------------------------------------------------------------------
  // Private: registration hook dispatch
  // -------------------------------------------------------------------------
  /**
   * Invoke a registration hook for a single entity name/value pair.
   * Returns true when the entity should be accepted, false when it should be
   * silently skipped (BLOCK), and throws when the hook returns THROW.
   *
   * @param {((name: string, value: string) => 'allow'|'block'|'throw')|null} hook
   * @param {string} name
   * @param {string} value
   * @param {string} context  — used in error messages ('external' | 'input')
   * @returns {boolean}  true = accept, false = skip
   */
  _applyRegistrationHook(e, n, r, i) {
    if (!e) return !0;
    const s = e(n, r);
    if (s === fe.BLOCK) return !1;
    if (s === fe.THROW)
      throw new Error(
        `[EntityDecoder] Registration of ${i} entity "&${n};" was rejected by hook`
      );
    return !0;
  }
  // -------------------------------------------------------------------------
  // Persistent external entity registration
  // -------------------------------------------------------------------------
  /**
   * Replace the full set of persistent external entities.
   * All keys are validated — throws on invalid characters.
   * If `onExternalEntity` is set, it is called once per entry; entries that
   * return `ENTITY_ACTION.BLOCK` are silently omitted, `ENTITY_ACTION.THROW`
   * aborts the whole call.
   * @param {Record<string, string | { regex?: RegExp, val: string }>} map
   */
  setExternalEntities(e) {
    if (e)
      for (const i of Object.keys(e))
        yt(i);
    if (!this._onExternalEntity) {
      this._externalMap = te(e);
      return;
    }
    const n = te(e), r = /* @__PURE__ */ Object.create(null);
    for (const [i, s] of Object.entries(n))
      this._applyRegistrationHook(this._onExternalEntity, i, s, "external") && (r[i] = s);
    this._externalMap = r;
  }
  /**
   * Add a single persistent external entity.
   * If `onExternalEntity` is set it is called before the entity is stored;
   * `ENTITY_ACTION.BLOCK` silently skips storage, `ENTITY_ACTION.THROW` raises.
   * @param {string} key
   * @param {string} value
   */
  addExternalEntity(e, n) {
    yt(e), typeof n == "string" && n.indexOf("&") === -1 && this._applyRegistrationHook(this._onExternalEntity, e, n, "external") && (this._externalMap[e] = n);
  }
  // -------------------------------------------------------------------------
  // Input / runtime entity registration (per document)
  // -------------------------------------------------------------------------
  /**
   * Inject DOCTYPE entities for the current document.
   * Also resets per-document expansion counters.
   * If `onInputEntity` is set it is called once per entry; entries returning
   * `ENTITY_ACTION.BLOCK` are silently omitted, `ENTITY_ACTION.THROW` aborts.
   * @param {Record<string, string | { regx?: RegExp, regex?: RegExp, val: string }>} map
   */
  addInputEntities(e) {
    if (this._totalExpansions = 0, this._expandedLength = 0, !this._onInputEntity) {
      this._inputMap = te(e);
      return;
    }
    const n = te(e), r = /* @__PURE__ */ Object.create(null);
    for (const [i, s] of Object.entries(n))
      this._applyRegistrationHook(this._onInputEntity, i, s, "input") && (r[i] = s);
    this._inputMap = r;
  }
  // -------------------------------------------------------------------------
  // Per-document reset
  // -------------------------------------------------------------------------
  /**
   * Wipe input/runtime entities and reset counters.
   * Call this before processing each new document.
   * @returns {this}
   */
  reset() {
    return this._inputMap = /* @__PURE__ */ Object.create(null), this._totalExpansions = 0, this._expandedLength = 0, this;
  }
  // -------------------------------------------------------------------------
  // XML version (can be set after construction, e.g. once parser reads <?xml?>)
  // -------------------------------------------------------------------------
  /**
   * Update the XML version used for NCR classification.
   * Call this as soon as the document's `<?xml version="...">` declaration is parsed.
   * @param {1.0|1.1|number} version
   */
  setXmlVersion(e) {
    this._ncrXmlVersion = e === 1.1 ? 1.1 : 1;
  }
  // -------------------------------------------------------------------------
  // Primary API
  // -------------------------------------------------------------------------
  /**
   * Replace all entity references in `str` in a single pass.
   *
   * @param {string} str
   * @returns {string}
   */
  decode(e) {
    if (typeof e != "string" || e.length === 0 || e.indexOf("&") === -1) return e;
    const n = e, r = [], i = e.length;
    let s = 0, a = 0;
    const o = this._maxTotalExpansions > 0, l = this._maxExpandedLength > 0, d = o || l;
    for (; a < i; ) {
      if (e.charCodeAt(a) !== 38) {
        a++;
        continue;
      }
      let u = a + 1;
      for (; u < i && e.charCodeAt(u) !== 59 && u - a <= 32; ) u++;
      if (u >= i || e.charCodeAt(u) !== 59) {
        a++;
        continue;
      }
      const p = e.slice(a + 1, u);
      if (p.length === 0) {
        a++;
        continue;
      }
      let f, y;
      if (this._removeSet.has(p))
        f = "", y === void 0 && (y = W);
      else if (this._leaveSet.has(p)) {
        a++;
        continue;
      } else if (p.charCodeAt(0) === 35) {
        const E = this._resolveNCR(p);
        if (E === void 0) {
          a++;
          continue;
        }
        f = E, y = ge;
      } else {
        const E = this._resolveName(p);
        f = E == null ? void 0 : E.value, y = E == null ? void 0 : E.tier;
      }
      if (f === void 0) {
        a++;
        continue;
      }
      if (a > s && r.push(e.slice(s, a)), r.push(f), s = u + 1, a = s, d && this._tierCounts(y)) {
        if (o && (this._totalExpansions++, this._totalExpansions > this._maxTotalExpansions))
          throw new Error(
            `[EntityReplacer] Entity expansion count limit exceeded: ${this._totalExpansions} > ${this._maxTotalExpansions}`
          );
        if (l) {
          const E = f.length - (p.length + 2);
          if (E > 0 && (this._expandedLength += E, this._expandedLength > this._maxExpandedLength))
            throw new Error(
              `[EntityReplacer] Expanded content length limit exceeded: ${this._expandedLength} > ${this._maxExpandedLength}`
            );
        }
      }
    }
    s < i && r.push(e.slice(s));
    const c = r.length === 0 ? e : r.join("");
    return this._postCheck(c, n);
  }
  // -------------------------------------------------------------------------
  // Private: limit tier check
  // -------------------------------------------------------------------------
  /**
   * Returns true if a resolved entity of the given tier should count
   * against the expansion/length limits.
   * @param {string} tier  — LIMIT_TIER_EXTERNAL | LIMIT_TIER_BASE
   * @returns {boolean}
   */
  _tierCounts(e) {
    return this._limitTiers.has(ke) ? !0 : this._limitTiers.has(e);
  }
  // -------------------------------------------------------------------------
  // Private: entity resolution
  // -------------------------------------------------------------------------
  /**
   * Resolve a named entity token (without & and ;).
   * Priority: inputMap > externalMap > baseMap
   * Returns the resolved value tagged with its limit tier.
   *
   * @param {string} name
   * @returns {{ value: string, tier: string }|undefined}
   */
  _resolveName(e) {
    if (e in this._inputMap) return { value: this._inputMap[e], tier: W };
    if (e in this._externalMap) return { value: this._externalMap[e], tier: W };
    if (e in this._baseMap) return { value: this._baseMap[e], tier: ge };
  }
  /**
   * Classify a codepoint and return the minimum action level that must be applied.
   * Returns -1 when no minimum is imposed (normal allow path).
   *
   * Ranges checked (in priority order):
   *   1. U+0000            — null, governed by nullNCR (always ≥ remove)
   *   2. U+D800–U+DFFF     — surrogates, always prohibited (min: remove)
   *   3. U+0001–U+001F \ {0x09,0x0A,0x0D}  — XML 1.0 restricted C0 (min: remove)
   *      (skipped in XML 1.1 — C0 controls are allowed when written as NCRs)
   *
   * @param {number} cp  — codepoint
   * @returns {number}   — minimum NCR_LEVEL value, or -1 for no restriction
   */
  _classifyNCR(e) {
    return e === 0 ? this._ncrNullLevel : e >= 55296 && e <= 57343 || this._ncrXmlVersion === 1 && e >= 1 && e <= 31 && !Pr.has(e) ? A.remove : -1;
  }
  /**
   * Execute a resolved NCR action.
   *
   * @param {number} action   — NCR_LEVEL value
   * @param {string} token    — raw token (e.g. '#38') for error messages
   * @param {number} cp       — codepoint, used only for error messages
   * @returns {string|undefined}
   *   - decoded character string  → 'allow'
   *   - ''                        → 'remove'
   *   - undefined                 → 'leave' (caller must skip past '&' only)
   *   - throws Error              → 'throw'
   */
  _applyNCRAction(e, n, r) {
    switch (e) {
      case A.allow:
        return String.fromCodePoint(r);
      case A.remove:
        return "";
      case A.leave:
        return;
      case A.throw:
        throw new Error(
          `[EntityDecoder] Prohibited numeric character reference &${n}; (U+${r.toString(16).toUpperCase().padStart(4, "0")})`
        );
      default:
        return String.fromCodePoint(r);
    }
  }
  /**
   * Full NCR resolution pipeline for a numeric token.
   *
   * Steps:
   *   1. Parse the codepoint (decimal or hex).
   *   2. Validate the raw codepoint range (NaN, <0, >0x10FFFF).
   *   3. If numericAllowed is false and no minimum restriction applies → leave as-is.
   *   4. Classify the codepoint to find the minimum required action level.
   *   5. Resolve effective action = max(onNCR, minimum).
   *   6. Apply and return.
   *
   * @param {string} token  — e.g. '#38', '#x26', '#X26'
   * @returns {string|undefined}
   *   - string (incl. '')  — replacement ('' = remove)
   *   - undefined          — leave original &token; as-is
   */
  _resolveNCR(e) {
    const n = e.charCodeAt(1);
    let r;
    if (n === 120 || n === 88 ? r = parseInt(e.slice(2), 16) : r = parseInt(e.slice(1), 10), Number.isNaN(r) || r < 0 || r > 1114111) return;
    const i = this._classifyNCR(r);
    if (!this._numericAllowed && i < A.remove) return;
    const s = i === -1 ? this._ncrOnLevel : Math.max(this._ncrOnLevel, i);
    return this._applyNCRAction(s, e, r);
  }
}
const Qt = (t) => ze.includes(t) ? "__" + t : t, Ur = {
  preserveOrder: !1,
  attributeNamePrefix: "@_",
  attributesGroupName: !1,
  textNodeName: "#text",
  ignoreAttributes: !0,
  removeNSPrefix: !1,
  // remove NS from tag name or attribute name if true
  allowBooleanAttributes: !1,
  //a tag can have attributes without any value
  //ignoreRootElement : false,
  parseTagValue: !0,
  parseAttributeValue: !1,
  trimValues: !0,
  //Trim string values of tag and attributes
  cdataPropName: !1,
  numberParseOptions: {
    hex: !0,
    leadingZeros: !0,
    eNotation: !0,
    unicode: !1
  },
  tagValueProcessor: function(t, e) {
    return e;
  },
  attributeValueProcessor: function(t, e) {
    return e;
  },
  stopNodes: [],
  //nested tags will not be parsed even for errors
  alwaysCreateTextNode: !1,
  isArray: () => !1,
  commentPropName: !1,
  unpairedTags: [],
  processEntities: !0,
  htmlEntities: !1,
  entityDecoder: null,
  ignoreDeclaration: !1,
  ignorePiTags: !1,
  transformTagName: !1,
  transformAttributeName: !1,
  updateTag: function(t, e, n) {
    return t;
  },
  // skipEmptyListItem: false
  captureMetaData: !1,
  maxNestedTags: 100,
  strictReservedNames: !0,
  jPath: !0,
  // if true, pass jPath string to callbacks; if false, pass matcher instance
  onDangerousProperty: Qt
};
function Br(t, e) {
  if (typeof t != "string")
    return;
  const n = t.toLowerCase();
  if (ze.some((r) => n === r.toLowerCase()))
    throw new Error(
      `[SECURITY] Invalid ${e}: "${t}" is a reserved JavaScript keyword that could cause prototype pollution`
    );
  if (Jt.some((r) => n === r.toLowerCase()))
    throw new Error(
      `[SECURITY] Invalid ${e}: "${t}" is a reserved JavaScript keyword that could cause prototype pollution`
    );
}
function Zt(t, e) {
  return typeof t == "boolean" ? {
    enabled: t,
    // true or false
    maxEntitySize: 1e4,
    maxExpansionDepth: 1e4,
    maxTotalExpansions: 1 / 0,
    maxExpandedLength: 1e5,
    maxEntityCount: 1e3,
    allowedTags: null,
    tagFilter: null,
    appliesTo: "all"
  } : typeof t == "object" && t !== null ? {
    enabled: t.enabled !== !1,
    maxEntitySize: Math.max(1, t.maxEntitySize ?? 1e4),
    maxExpansionDepth: Math.max(1, t.maxExpansionDepth ?? 1e4),
    maxTotalExpansions: Math.max(1, t.maxTotalExpansions ?? 1 / 0),
    maxExpandedLength: Math.max(1, t.maxExpandedLength ?? 1e5),
    maxEntityCount: Math.max(1, t.maxEntityCount ?? 1e3),
    allowedTags: t.allowedTags ?? null,
    tagFilter: t.tagFilter ?? null,
    appliesTo: t.appliesTo ?? "all"
  } : Zt(!0);
}
const Vr = function(t) {
  const e = Object.assign({}, Ur, t), n = [
    { value: e.attributeNamePrefix, name: "attributeNamePrefix" },
    { value: e.attributesGroupName, name: "attributesGroupName" },
    { value: e.textNodeName, name: "textNodeName" },
    { value: e.cdataPropName, name: "cdataPropName" },
    { value: e.commentPropName, name: "commentPropName" }
  ];
  for (const { value: r, name: i } of n)
    r && Br(r, i);
  return e.onDangerousProperty === null && (e.onDangerousProperty = Qt), e.processEntities = Zt(e.processEntities, e.htmlEntities), e.unpairedTagsSet = new Set(e.unpairedTags), e.stopNodes && Array.isArray(e.stopNodes) && (e.stopNodes = e.stopNodes.map((r) => typeof r == "string" && r.startsWith("*.") ? ".." + r.substring(2) : r)), e;
};
let V;
typeof Symbol != "function" ? V = "@@xmlMetadata" : V = Symbol("XML Node Metadata");
class F {
  constructor(e) {
    this.tagname = e, this.child = [], this[":@"] = /* @__PURE__ */ Object.create(null);
  }
  add(e, n) {
    e === "__proto__" && (e = "#__proto__"), this.child.push({ [e]: n });
  }
  addChild(e, n) {
    e.tagname === "__proto__" && (e.tagname = "#__proto__"), e[":@"] && Object.keys(e[":@"]).length > 0 ? this.child.push({ [e.tagname]: e.child, ":@": e[":@"] }) : this.child.push({ [e.tagname]: e.child }), this.addStartIndex(n);
  }
  addStartIndex(e) {
    e !== void 0 && (this.child[this.child.length - 1][V] = { startIndex: e });
  }
  addEndIndex(e) {
    const n = this.child[this.child.length - 1];
    n !== void 0 && n[V] !== void 0 && n[V].endIndex === void 0 && (n[V].endIndex = e);
  }
  /** symbol used for metadata */
  static getMetaDataSymbol() {
    return V;
  }
}
const en = ":A-Za-z_À-ÖØ-öø-˿Ͱ-ͽͿ-҆҈-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�", Wr = en + "\\-\\.\\d·̀-ͯ‿-⁀", tn = ":A-Za-z_À-˿Ͱ-ͽͿ-҆҈-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-󯿿", Xr = tn + "\\-\\.\\d·̀-ͯ҇‿-⁀", Je = (t, e, n = "") => {
  const r = t.replace(":", ""), i = e.replace(":", ""), s = `[${r}][${i}]*`;
  return {
    name: new RegExp(`^[${t}][${e}]*$`, n),
    ncName: new RegExp(`^${s}$`, n),
    qName: new RegExp(`^${s}(?::${s})?$`, n),
    nmToken: new RegExp(`^[${e}]+$`, n),
    nmTokens: new RegExp(`^[${e}]+(?:\\s+[${e}]+)*$`, n)
  };
}, Hr = Je(en, Wr), Yr = Je(tn, Xr, "u"), nn = ":A-Za-z_", qr = nn + "\\-\\.\\d", Dr = Je(nn, qr), Gr = (t = "1.0", e = !1) => e ? Dr : t === "1.1" ? Yr : Hr, rn = (t, { xmlVersion: e = "1.0", asciiOnly: n = !1 } = {}) => Gr(e, n).qName.test(t);
class zr {
  constructor(e, n) {
    this.suppressValidationErr = !e, this.options = e, this.xmlVersion = n || 1;
  }
  setXmlVersion(e = 1) {
    this.xmlVersion = e;
  }
  readDocType(e, n) {
    const r = /* @__PURE__ */ Object.create(null);
    let i = 0;
    if (e[n + 3] === "O" && e[n + 4] === "C" && e[n + 5] === "T" && e[n + 6] === "Y" && e[n + 7] === "P" && e[n + 8] === "E") {
      n = n + 9;
      let s = 1, a = !1, o = !1, l = null, d = "";
      for (; n < e.length; n++) {
        if (l !== null) {
          e[n] === l && (l = null), d += e[n];
          continue;
        }
        if (!a && !o && (e[n] === '"' || e[n] === "'")) {
          l = e[n], d += e[n];
          continue;
        }
        if (e[n] === "<" && !o) {
          if (a && j(e, "!ENTITY", n)) {
            n += 7;
            let c, u;
            if ([c, u, n] = this.readEntityExp(e, n + 1, this.suppressValidationErr), u.indexOf("&") === -1) {
              if (this.options.enabled !== !1 && this.options.maxEntityCount != null && i >= this.options.maxEntityCount)
                throw new Error(
                  `Entity count (${i + 1}) exceeds maximum allowed (${this.options.maxEntityCount})`
                );
              r[c] = u, i++;
            }
          } else if (a && j(e, "!ELEMENT", n)) {
            n += 8;
            const { index: c } = this.readElementExp(e, n + 1);
            n = c;
          } else if (a && j(e, "!ATTLIST", n))
            n += 8;
          else if (a && j(e, "!NOTATION", n)) {
            n += 9;
            const { index: c } = this.readNotationExp(e, n + 1, this.suppressValidationErr);
            n = c;
          } else if (j(e, "!--", n)) o = !0;
          else throw new Error("Invalid DOCTYPE");
          s++, d = "";
        } else if (e[n] === ">") {
          if (o ? e[n - 1] === "-" && e[n - 2] === "-" && (o = !1, s--) : s--, s === 0)
            break;
        } else e[n] === "[" ? a = !0 : d += e[n];
      }
      if (l !== null || s !== 0)
        throw new Error("Unclosed DOCTYPE");
    } else
      throw new Error("Invalid Tag instead of DOCTYPE");
    return { entities: r, i: n };
  }
  readEntityExp(e, n) {
    n = x(e, n);
    const r = n;
    for (; n < e.length && !/\s/.test(e[n]) && e[n] !== '"' && e[n] !== "'"; )
      n++;
    let i = e.substring(r, n);
    if (ne(i, { xmlVersion: this.xmlVersion }), n = x(e, n), !this.suppressValidationErr) {
      if (e.substring(n, n + 6).toUpperCase() === "SYSTEM")
        throw new Error("External entities are not supported");
      if (e[n] === "%")
        throw new Error("Parameter entities are not supported");
    }
    let s = "";
    if ([n, s] = this.readIdentifierVal(e, n, "entity"), this.options.enabled !== !1 && this.options.maxEntitySize != null && s.length > this.options.maxEntitySize)
      throw new Error(
        `Entity "${i}" size (${s.length}) exceeds maximum allowed size (${this.options.maxEntitySize})`
      );
    return n--, [i, s, n];
  }
  readNotationExp(e, n) {
    n = x(e, n);
    const r = n;
    for (; n < e.length && !/\s/.test(e[n]); )
      n++;
    let i = e.substring(r, n);
    !this.suppressValidationErr && ne(i, { xmlVersion: this.xmlVersion }), n = x(e, n);
    const s = e.substring(n, n + 6).toUpperCase();
    if (!this.suppressValidationErr && s !== "SYSTEM" && s !== "PUBLIC")
      throw new Error(`Expected SYSTEM or PUBLIC, found "${s}"`);
    n += s.length, n = x(e, n);
    let a = null, o = null;
    if (s === "PUBLIC")
      [n, a] = this.readIdentifierVal(e, n, "publicIdentifier"), n = x(e, n), (e[n] === '"' || e[n] === "'") && ([n, o] = this.readIdentifierVal(e, n, "systemIdentifier"));
    else if (s === "SYSTEM" && ([n, o] = this.readIdentifierVal(e, n, "systemIdentifier"), !this.suppressValidationErr && !o))
      throw new Error("Missing mandatory system identifier for SYSTEM notation");
    return { notationName: i, publicIdentifier: a, systemIdentifier: o, index: --n };
  }
  readIdentifierVal(e, n, r) {
    let i = "";
    const s = e[n];
    if (s !== '"' && s !== "'")
      throw new Error(`Expected quoted string, found "${s}"`);
    n++;
    const a = n;
    for (; n < e.length && e[n] !== s; )
      n++;
    if (i = e.substring(a, n), e[n] !== s)
      throw new Error(`Unterminated ${r} value`);
    return n++, [n, i];
  }
  readElementExp(e, n) {
    n = x(e, n);
    const r = n;
    for (; n < e.length && !/\s/.test(e[n]); )
      n++;
    let i = e.substring(r, n);
    if (!this.suppressValidationErr && !rn(i, { xmlVersion: this.xmlVersion }))
      throw new Error(`Invalid element name: "${i}"`);
    n = x(e, n);
    let s = "";
    if (e[n] === "E" && j(e, "MPTY", n)) n += 4;
    else if (e[n] === "A" && j(e, "NY", n)) n += 2;
    else if (e[n] === "(") {
      n++;
      const a = n;
      for (; n < e.length && e[n] !== ")"; )
        n++;
      if (s = e.substring(a, n), e[n] !== ")")
        throw new Error("Unterminated content model");
    } else if (!this.suppressValidationErr)
      throw new Error(`Invalid Element Expression, found "${e[n]}"`);
    return {
      elementName: i,
      contentModel: s.trim(),
      index: n
    };
  }
  readAttlistExp(e, n) {
    n = x(e, n);
    let r = n;
    for (; n < e.length && !/\s/.test(e[n]); )
      n++;
    let i = e.substring(r, n);
    for (ne(i, { xmlVersion: this.xmlVersion }), n = x(e, n), r = n; n < e.length && !/\s/.test(e[n]); )
      n++;
    let s = e.substring(r, n);
    if (!ne(s, { xmlVersion: this.xmlVersion }))
      throw new Error(`Invalid attribute name: "${s}"`);
    n = x(e, n);
    let a = "";
    if (e.substring(n, n + 8).toUpperCase() === "NOTATION") {
      if (a = "NOTATION", n += 8, n = x(e, n), e[n] !== "(")
        throw new Error(`Expected '(', found "${e[n]}"`);
      n++;
      let l = [];
      for (; n < e.length && e[n] !== ")"; ) {
        const d = n;
        for (; n < e.length && e[n] !== "|" && e[n] !== ")"; )
          n++;
        let c = e.substring(d, n);
        if (c = c.trim(), !ne(c, { xmlVersion: this.xmlVersion }))
          throw new Error(`Invalid notation name: "${c}"`);
        l.push(c), e[n] === "|" && (n++, n = x(e, n));
      }
      if (e[n] !== ")")
        throw new Error("Unterminated list of notations");
      n++, a += " (" + l.join("|") + ")";
    } else {
      const l = n;
      for (; n < e.length && !/\s/.test(e[n]); )
        n++;
      a += e.substring(l, n);
      const d = ["CDATA", "ID", "IDREF", "IDREFS", "ENTITY", "ENTITIES", "NMTOKEN", "NMTOKENS"];
      if (!this.suppressValidationErr && !d.includes(a.toUpperCase()))
        throw new Error(`Invalid attribute type: "${a}"`);
    }
    n = x(e, n);
    let o = "";
    return e.substring(n, n + 8).toUpperCase() === "#REQUIRED" ? (o = "#REQUIRED", n += 8) : e.substring(n, n + 7).toUpperCase() === "#IMPLIED" ? (o = "#IMPLIED", n += 7) : [n, o] = this.readIdentifierVal(e, n, "ATTLIST"), {
      elementName: i,
      attributeName: s,
      attributeType: a,
      defaultValue: o,
      index: n
    };
  }
}
const x = (t, e) => {
  for (; e < t.length && /\s/.test(t[e]); )
    e++;
  return e;
};
function j(t, e, n) {
  for (let r = 0; r < e.length; r++)
    if (e[r] !== t[n + r + 1]) return !1;
  return !0;
}
function ne(t, e) {
  if (rn(t, { xmlVersion: e }))
    return t;
  throw new Error(`Invalid entity name ${t}`);
}
const Jr = [
  // Basic Latin (ASCII) — included for completeness / pass-through
  48,
  // 0-9
  // Arabic scripts
  1632,
  // Arabic-Indic ٠١٢٣٤٥٦٧٨٩
  1776,
  // Extended Arabic-Indic (Urdu/Persian/Sindhi) ۰۱۲۳
  // Indic scripts
  2406,
  // Devanagari ०१२३४५६७८९
  2534,
  // Bengali ০১২৩৪৫৬৭৮৯
  2662,
  // Gurmukhi ੦੧੨੩੪੫੬੭੮੯
  2790,
  // Gujarati ૦૧૨૩૪૫૬૭૮૯
  2918,
  // Odia ୦୧୨୩୪୫୬୭୮୯
  3046,
  // Tamil ௦௧௨௩௪௫௬௭௮௯
  3174,
  // Telugu ౦౧౨౩౪౫౬౭౮౯
  3302,
  // Kannada ೦೧೨೩೪೫೬೭೮೯
  3430,
  // Malayalam ൦൧൨൩൪൫൬൭൮൯
  3558,
  // Sinhala Archaic ෦෧෨෩෪෫෬෭෮෯
  // Southeast Asian scripts
  3664,
  // Thai ๐๑๒๓๔๕๖๗๘๙
  3792,
  // Lao ໐໑໒໓໔໕໖໗໘໙
  3872,
  // Tibetan ༠༡༢༣༤༥༦༧༨༩
  4160,
  // Myanmar ၀၁၂၃၄၅၆၇၈၉
  4240,
  // Myanmar Shan ႐႑႒႓႔႕႖႗႘႙
  6112,
  // Khmer ០១២៣៤៥៦៧៨៩
  6160,
  // Mongolian ᠐᠑᠒᠓᠔᠕᠖᠗᠘᠙
  6470,
  // Limbu ᥆᥇᥈᥉᥊᥋᥌᥍᥎᥏
  6608,
  // New Tai Lue ᧐᧑᧒᧓᧔᧕᧖᧗᧘᧙
  6784,
  // Tai Tham Hora ᪀᪁᪂᪃᪄᪅᪆᪇᪈᪉
  6800,
  // Tai Tham Tham ᪐᪑᪒᪓᪔᪕᪖᪗᪘᪙
  6992,
  // Balinese ᭐᭑᭒᭓᭔᭕᭖᭗᭘᭙
  7088,
  // Sundanese ᮰᮱᮲᮳᮴᮵᮶᮷᮸᮹
  7232,
  // Lepcha ᱀᱁᱂᱃᱄᱅᱆᱇᱈᱉
  7248,
  // Ol Chiki ᱐᱑᱒᱓᱔᱕᱖᱗᱘᱙
  // Fullwidth (CJK context)
  65296,
  // Fullwidth ０１２３４５６７８９
  // Mathematical digit variants (Unicode math block)
  120782,
  // Mathematical Bold
  120792,
  // Mathematical Double-Struck
  120802,
  // Mathematical Sans-Serif
  120812,
  // Mathematical Sans-Serif Bold
  120822,
  // Mathematical Monospace
  // Other scripts
  66720,
  // Osmanya 𐒠𐒡𐒢𐒣𐒤𐒥𐒦𐒧𐒨𐒩
  68912,
  // Hanifi Rohingya 𐴰𐴱𐴲𐴳𐴴𐴵𐴶𐴷𐴸𐴹
  69734,
  // Brahmi 𑁦𑁧𑁨𑁩𑁪𑁫𑁬𑁭𑁮𑁯
  69872,
  // Sora Sompeng 𑃰𑃱𑃲𑃳𑃴𑃵𑃶𑃷𑃸𑃹
  69942,
  // Chakma 𑄶𑄷𑄸𑄹𑄺𑄻𑄼𑄽𑄾𑄿
  70096,
  // Sharada 𑇐𑇑𑇒𑇓𑇔𑇕𑇖𑇗𑇘𑇙
  70384,
  // Khudawadi 𑋰𑋱𑋲𑋳𑋴𑋵𑋶𑋷𑋸𑋹
  70736,
  // Newa 𑑐𑑑𑑒𑑓𑑔𑑕𑑖𑑗𑑘𑑙
  70864,
  // Tirhuta 𑓐𑓑𑓒𑓓𑓔𑓕𑓖𑓗𑓘𑓙
  71248,
  // Modi 𑙐𑙑𑙒𑙓𑙔𑙕𑙖𑙗𑙘𑙙
  71360,
  // Takri 𑛀𑛁𑛂𑛃𑛄𑛅𑛆𑛇𑛈𑛉
  71472,
  // Ahom 𑜰𑜱𑜲𑜳𑜴𑜵𑜶𑜷𑜸𑜹
  71904,
  // Warang Citi 𑣠𑣡𑣢𑣣𑣤𑣥𑣦𑣧𑣨𑣩
  72016,
  // Dives Akuru 𑥐𑥑𑥒𑥓𑥔𑥕𑥖𑥗𑥘𑥙
  72688,
  // Khitan Small Script 𑯰𑯱𑯲𑯳𑯴𑯵𑯶𑯷𑯸𑯹
  72784,
  // Bhaiksuki 𑱐𑱑𑱒𑱓𑱔𑱕𑱖𑱗𑱘𑱙
  73040,
  // Masaram Gondi 𑵐𑵑𑵒𑵓𑵔𑵕𑵖𑵗𑵘𑵙
  73120,
  // Gunjala Gondi 𑶠𑶡𑶢𑶣𑶤𑶥𑶦𑶧𑶨𑶩
  73552,
  // Kawi 𑽐𑽑𑽒𑽓𑽔𑽕𑽖𑽗𑽘𑽙
  92768,
  // Mro 𖩠𖩡𖩢𖩣𖩤𖩥𖩦𖩧𖩨𖩩
  92864,
  // Tangsa 𖫀𖫁𖫂𖫃𖫄𖫅𖫆𖫇𖫈𖫉
  93008,
  // Pahawh Hmong 𖭐𖭑𖭒𖭓𖭔𖭕𖭖𖭗𖭘𖭙
  123200,
  // Nyiakeng Puachue Hmong 𞅀𞅁𞅂𞅃𞅄𞅅𞅆𞅇𞅈𞅉
  123632,
  // Wancho 𞋰𞋱𞋲𞋳𞋴𞋵𞋶𞋷𞋸𞋹
  124144,
  // Nag Mundari 𞓰𞓱𞓲𞓳𞓴𞓵𞓶𞓷𞓸𞓹
  125264,
  // Adlam 𞥐𞥑𞥒𞥓𞥔𞥕𞥖𞥗𞥘𞥙
  130032
  // Segmented digit symbols 🯰🯱🯲🯳🯴🯵🯶🯷🯸🯹
], Fe = 255, Pe = /* @__PURE__ */ new Map(), sn = 65535, on = 1632, ie = on, Kr = sn - on + 1, $e = new Uint8Array(Kr).fill(Fe);
for (const t of Jr)
  for (let e = 0; e < 10; e++) {
    const n = t + e;
    n <= sn ? $e[n - ie] = e : Pe.set(n, e);
  }
const Tt = 48, bt = 57, wt = 45, ue = /* @__PURE__ */ new Set([8722, 65293, 65123]);
function Qr(t) {
  if (typeof t != "string") return t;
  const e = t.length;
  if (e === 0) return t;
  let n = -1;
  for (let i = 0; i < e; i++) {
    const s = t.charCodeAt(i);
    if (!(s >= Tt && s <= bt || s === wt)) {
      if (s < ie) {
        if (ue.has(s)) {
          n = i;
          break;
        }
        continue;
      }
      if (s >= 55296 && s <= 56319) {
        if (i + 1 < e) {
          const a = t.charCodeAt(i + 1);
          if (a >= 56320 && a <= 57343) {
            const o = 65536 + (s - 55296 << 10) + (a - 56320);
            if (Pe.has(o)) {
              n = i;
              break;
            }
          }
        }
        continue;
      }
      if ($e[s - ie] !== Fe || ue.has(s)) {
        n = i;
        break;
      }
    }
  }
  if (n === -1) return t;
  const r = [];
  n > 0 && r.push(t.slice(0, n));
  for (let i = n; i < e; i++) {
    const s = t.charCodeAt(i);
    if (s >= Tt && s <= bt || s === wt) {
      r.push(t[i]);
      continue;
    }
    if (s < ie) {
      r.push(ue.has(s) ? "-" : t[i]);
      continue;
    }
    if (s >= 55296 && s <= 56319) {
      if (i + 1 < e) {
        const o = t.charCodeAt(i + 1);
        if (o >= 56320 && o <= 57343) {
          const l = 65536 + (s - 55296 << 10) + (o - 56320), d = Pe.get(l);
          if (d !== void 0) {
            r.push(String.fromCharCode(d + 48)), i++;
            continue;
          }
        }
      }
      r.push(t[i]);
      continue;
    }
    if (ue.has(s)) {
      r.push("-");
      continue;
    }
    const a = $e[s - ie];
    r.push(a !== Fe ? String.fromCharCode(a + 48) : t[i]);
  }
  return r.join("");
}
const Zr = /^[-+]?0x[a-fA-F0-9]+$/, ei = /^0b[01]+$/, ti = /^0o[0-7]+$/, ni = /^([\-\+])?(0*)([0-9]*(\.[0-9]*)?)$/, ri = {
  hex: !0,
  binary: !1,
  octal: !1,
  leadingZeros: !0,
  decimalPoint: ".",
  eNotation: !0,
  //skipLike: /regex/,
  infinity: "original",
  // "null", "infinity" (Infinity type), "string" ("Infinity" (the string literal))
  unicode: !1
};
function ii(t, e = {}) {
  if (e = Object.assign({}, ri, e), !t || typeof t != "string") return t;
  let n = t.trim();
  if (n.length === 0) return t;
  if (e.skipLike !== void 0 && e.skipLike.test(n)) return t;
  if (n === "0" || e.unicode && (n = Qr(n), n === "0"))
    return 0;
  if (e.hex && Zr.test(n))
    return Ne(n, 16);
  if (e.binary && ei.test(n))
    return Ne(n, 2);
  if (e.octal && ti.test(n))
    return Ne(n, 8);
  if (isFinite(n)) {
    if (n.includes("e") || n.includes("E"))
      return oi(t, n, e);
    {
      const r = ni.exec(n);
      if (r) {
        const i = r[1] || "", s = r[2];
        let a = ai(r[3]);
        const o = i ? (
          // 0., -00., 000.
          t[s.length + 1] === "."
        ) : t[s.length] === ".";
        if (!e.leadingZeros && (s.length > 1 || s.length === 1 && !o))
          return t;
        {
          const l = Number(n), d = String(l);
          if (l === 0) return l;
          if (d.search(/[eE]/) !== -1)
            return e.eNotation ? l : t;
          if (n.indexOf(".") !== -1)
            return d === "0" || d === a || d === `${i}${a}` ? l : t;
          let c = s ? a : n;
          return s ? c === d || i + c === d ? l : t : c === d || c === i + d ? l : t;
        }
      } else
        return t;
    }
  } else return li(t, Number(n), e);
}
const si = /^([-+])?(0*)(\d*(\.\d*)?[eE][-\+]?\d+)$/;
function oi(t, e, n) {
  if (!n.eNotation) return t;
  const r = e.match(si);
  if (r) {
    let i = r[1] || "";
    const s = r[3].indexOf("e") === -1 ? "E" : "e", a = r[2], o = i ? (
      // 0E.
      t[a.length + 1] === s
    ) : t[a.length] === s;
    return a.length > 1 && o ? t : a.length === 1 && (r[3].startsWith(`.${s}`) || r[3][0] === s) ? Number(e) : a.length > 0 ? n.leadingZeros && !o ? (e = (r[1] || "") + r[3], Number(e)) : t : Number(e);
  } else
    return t;
}
function ai(t) {
  if (t && t.indexOf(".") !== -1) {
    let e = t.length;
    for (; e > 0 && t.charCodeAt(e - 1) === 48; ) e--;
    return t = t.slice(0, e), t === "." ? t = "0" : t[0] === "." ? t = "0" + t : t[t.length - 1] === "." && (t = t.substring(0, t.length - 1)), t;
  }
  return t;
}
function Ne(t, e) {
  const n = t.trim();
  if ((e === 2 || e === 8) && (t = n.substring(2)), parseInt) return parseInt(t, e);
  if (Number.parseInt) return Number.parseInt(t, e);
  if (window && window.parseInt) return window.parseInt(t, e);
  throw new Error("parseInt, Number.parseInt, window.parseInt are not supported");
}
function li(t, e, n) {
  const r = e === 1 / 0;
  switch (n.infinity.toLowerCase()) {
    case "null":
      return null;
    case "infinity":
      return e;
    case "string":
      return r ? "Infinity" : "-Infinity";
    case "original":
    default:
      return t;
  }
}
function ci(t) {
  return typeof t == "function" ? t : Array.isArray(t) ? (e) => {
    for (const n of t)
      if (typeof n == "string" && e === n || n instanceof RegExp && n.test(e))
        return !0;
  } : () => !1;
}
class St {
  /**
   * Create a new Expression
   * @param {string} pattern - Pattern string (e.g., "root.users.user", "..user[id]")
   * @param {Object} options - Configuration options
   * @param {string} options.separator - Path separator (default: '.')
   */
  constructor(e, n = {}, r) {
    this.pattern = e, this.separator = n.separator || ".", this.segments = this._parse(e), this.data = r, this._hasDeepWildcard = this.segments.some((i) => i.type === "deep-wildcard"), this._hasAttributeCondition = this.segments.some((i) => i.attrName !== void 0), this._hasPositionSelector = this.segments.some((i) => i.position !== void 0);
  }
  /**
   * Parse pattern string into segments
   * @private
   * @param {string} pattern - Pattern to parse
   * @returns {Array} Array of segment objects
   */
  _parse(e) {
    const n = [];
    let r = 0, i = "";
    for (; r < e.length; )
      e[r] === this.separator ? r + 1 < e.length && e[r + 1] === this.separator ? (i.trim() && (n.push(this._parseSegment(i.trim())), i = ""), n.push({ type: "deep-wildcard" }), r += 2) : (i.trim() && n.push(this._parseSegment(i.trim())), i = "", r++) : (i += e[r], r++);
    return i.trim() && n.push(this._parseSegment(i.trim())), n;
  }
  /**
   * Parse a single segment
   * @private
   * @param {string} part - Segment string (e.g., "user", "ns::user", "user[id]", "ns::user:first")
   * @returns {Object} Segment object
   */
  _parseSegment(e) {
    const n = { type: "tag" };
    let r = null, i = e;
    const s = e.match(/^([^\[]+)(\[[^\]]*\])(.*)$/);
    if (s && (i = s[1] + s[3], s[2])) {
      const c = s[2].slice(1, -1);
      c && (r = c);
    }
    let a, o = i;
    if (i.includes("::")) {
      const c = i.indexOf("::");
      if (a = i.substring(0, c).trim(), o = i.substring(c + 2).trim(), !a)
        throw new Error(`Invalid namespace in pattern: ${e}`);
    }
    let l, d = null;
    if (o.includes(":")) {
      const c = o.lastIndexOf(":"), u = o.substring(0, c).trim(), p = o.substring(c + 1).trim();
      ["first", "last", "odd", "even"].includes(p) || /^nth\(\d+\)$/.test(p) ? (l = u, d = p) : l = o;
    } else
      l = o;
    if (!l)
      throw new Error(`Invalid segment pattern: ${e}`);
    if (n.tag = l, a && (n.namespace = a), r)
      if (r.includes("=")) {
        const c = r.indexOf("=");
        n.attrName = r.substring(0, c).trim(), n.attrValue = r.substring(c + 1).trim();
      } else
        n.attrName = r.trim();
    if (d) {
      const c = d.match(/^nth\((\d+)\)$/);
      c ? (n.position = "nth", n.positionValue = parseInt(c[1], 10)) : n.position = d;
    }
    return n;
  }
  /**
   * Get the number of segments
   * @returns {number}
   */
  get length() {
    return this.segments.length;
  }
  /**
   * Check if expression contains deep wildcard
   * @returns {boolean}
   */
  hasDeepWildcard() {
    return this._hasDeepWildcard;
  }
  /**
   * Check if expression has attribute conditions
   * @returns {boolean}
   */
  hasAttributeCondition() {
    return this._hasAttributeCondition;
  }
  /**
   * Check if expression has position selectors
   * @returns {boolean}
   */
  hasPositionSelector() {
    return this._hasPositionSelector;
  }
  /**
   * Get string representation
   * @returns {string}
   */
  toString() {
    return this.pattern;
  }
}
class di {
  constructor() {
    this._byDepthAndTag = /* @__PURE__ */ new Map(), this._wildcardByDepth = /* @__PURE__ */ new Map(), this._deepWildcards = [], this._deepByTerminalTag = /* @__PURE__ */ new Map(), this._patterns = /* @__PURE__ */ new Set(), this._sealed = !1;
  }
  /**
   * Add an Expression to the set.
   * Duplicate patterns (same pattern string) are silently ignored.
   *
   * @param {import('./Expression.js').default} expression - A pre-constructed Expression instance
   * @returns {this} for chaining
   * @throws {TypeError} if called after seal()
   *
   * @example
   * set.add(new Expression('root.users.user'));
   * set.add(new Expression('..script'));
   */
  add(e) {
    if (this._sealed)
      throw new TypeError(
        "ExpressionSet is sealed. Create a new ExpressionSet to add more expressions."
      );
    if (this._patterns.has(e.pattern)) return this;
    if (this._patterns.add(e.pattern), e.hasDeepWildcard()) {
      const s = e.segments[e.segments.length - 1];
      if (s && s.type !== "deep-wildcard" && s.tag !== "*") {
        const a = s.tag;
        this._deepByTerminalTag.has(a) || this._deepByTerminalTag.set(a, []), this._deepByTerminalTag.get(a).push(e);
      } else
        this._deepWildcards.push(e);
      return this;
    }
    const n = e.length, r = e.segments[e.segments.length - 1], i = r == null ? void 0 : r.tag;
    if (!i || i === "*")
      this._wildcardByDepth.has(n) || this._wildcardByDepth.set(n, []), this._wildcardByDepth.get(n).push(e);
    else {
      const s = `${n}:${i}`;
      this._byDepthAndTag.has(s) || this._byDepthAndTag.set(s, []), this._byDepthAndTag.get(s).push(e);
    }
    return this;
  }
  /**
   * Add multiple expressions at once.
   *
   * @param {import('./Expression.js').default[]} expressions - Array of Expression instances
   * @returns {this} for chaining
   *
   * @example
   * set.addAll([
   *   new Expression('root.users.user'),
   *   new Expression('root.config.setting'),
   * ]);
   */
  addAll(e) {
    for (const n of e) this.add(n);
    return this;
  }
  /**
   * Check whether a pattern string is already present in the set.
   *
   * @param {import('./Expression.js').default} expression
   * @returns {boolean}
   */
  has(e) {
    return this._patterns.has(e.pattern);
  }
  /**
   * Number of expressions in the set.
   * @type {number}
   */
  get size() {
    return this._patterns.size;
  }
  /**
   * Seal the set against further modifications.
   * Useful to prevent accidental mutations after config is built.
   * Calling add() or addAll() on a sealed set throws a TypeError.
   *
   * @returns {this}
   */
  seal() {
    return this._sealed = !0, this;
  }
  /**
   * Whether the set has been sealed.
   * @type {boolean}
   */
  get isSealed() {
    return this._sealed;
  }
  /**
   * Test whether the matcher's current path matches any expression in the set.
   *
   * Evaluation order (cheapest → most expensive):
   *  1. Exact depth + tag bucket  — O(1) lookup, typically 0–2 expressions
   *  2. Depth-only wildcard bucket — O(1) lookup, rare
   *  3. Deep-wildcard list         — always checked, but usually small
   *
   * @param {import('./Matcher.js').default} matcher - Matcher instance (or readOnly view)
   * @returns {boolean} true if any expression matches the current path
   *
   * @example
   * if (stopNodes.matchesAny(matcher)) {
   *   // handle stop node
   * }
   */
  matchesAny(e) {
    return this.findMatch(e) !== null;
  }
  /**
  * Find and return the first Expression that matches the matcher's current path.
  *
  * Uses the same evaluation order as matchesAny (cheapest → most expensive):
  *  1. Exact depth + tag bucket
  *  2. Depth-only wildcard bucket
  *  3. Deep-wildcard list
  *
  * @param {import('./Matcher.js').default} matcher - Matcher instance (or readOnly view)
  * @returns {import('./Expression.js').default | null} the first matching Expression, or null
  *
  * @example
  * const expr = stopNodes.findMatch(matcher);
  * if (expr) {
  *   // access expr.config, expr.pattern, etc.
  * }
  */
  findMatch(e) {
    const n = e.getDepth(), r = e.getCurrentTag(), i = `${n}:${r}`, s = this._byDepthAndTag.get(i);
    if (s) {
      for (let l = 0; l < s.length; l++)
        if (e.matches(s[l])) return s[l];
    }
    const a = this._wildcardByDepth.get(n);
    if (a) {
      for (let l = 0; l < a.length; l++)
        if (e.matches(a[l])) return a[l];
    }
    const o = this._deepByTerminalTag.get(r);
    if (o) {
      for (let l = 0; l < o.length; l++)
        if (e.matches(o[l])) return o[l];
    }
    for (let l = 0; l < this._deepWildcards.length; l++)
      if (e.matches(this._deepWildcards[l])) return this._deepWildcards[l];
    return null;
  }
}
class ui {
  /**
   * @param {Matcher} matcher - The parent Matcher instance to read from.
   */
  constructor(e) {
    this._matcher = e;
  }
  /**
   * Get the path separator used by the parent matcher.
   * @returns {string}
   */
  get separator() {
    return this._matcher.separator;
  }
  /**
   * Get current tag name.
   * @returns {string|undefined}
   */
  getCurrentTag() {
    const e = this._matcher.path;
    return e.length > 0 ? e[e.length - 1].tag : void 0;
  }
  /**
   * Get current namespace.
   * @returns {string|undefined}
   */
  getCurrentNamespace() {
    const e = this._matcher.path;
    return e.length > 0 ? e[e.length - 1].namespace : void 0;
  }
  /**
   * Get current node's attribute value.
   * @param {string} attrName
   * @returns {*}
   */
  getAttrValue(e) {
    var r;
    const n = this._matcher.path;
    if (n.length !== 0)
      return (r = n[n.length - 1].values) == null ? void 0 : r[e];
  }
  /**
   * Check if current node has an attribute.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAttr(e) {
    const n = this._matcher.path;
    if (n.length === 0) return !1;
    const r = n[n.length - 1];
    return r.values !== void 0 && e in r.values;
  }
  /**
   * Get the value of a "kept" attribute from the nearest ancestor (or
   * current node) that declared it via `push(tag, attrs, ns, { keep: [...] })`.
   * @param {string} attrName
   * @returns {*}
   */
  getAnyParentAttr(e) {
    return this._matcher.getAnyParentAttr(e);
  }
  /**
   * Check whether any ancestor (or the current node) kept the given
   * attribute via `push(tag, attrs, ns, { keep: [...] })`.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAnyParentAttr(e) {
    return this._matcher.hasAnyParentAttr(e);
  }
  /**
   * Get current node's sibling position (child index in parent).
   * @returns {number}
   */
  getPosition() {
    const e = this._matcher.path;
    return e.length === 0 ? -1 : e[e.length - 1].position ?? 0;
  }
  /**
   * Get current node's repeat counter (occurrence count of this tag name).
   * @returns {number}
   */
  getCounter() {
    const e = this._matcher.path;
    return e.length === 0 ? -1 : e[e.length - 1].counter ?? 0;
  }
  /**
   * Get current node's sibling index (alias for getPosition).
   * @returns {number}
   * @deprecated Use getPosition() or getCounter() instead
   */
  getIndex() {
    return this.getPosition();
  }
  /**
   * Get current path depth.
   * @returns {number}
   */
  getDepth() {
    return this._matcher.path.length;
  }
  /**
   * Get path as string.
   * @param {string} [separator] - Optional separator (uses default if not provided)
   * @param {boolean} [includeNamespace=true]
   * @returns {string}
   */
  toString(e, n = !0) {
    return this._matcher.toString(e, n);
  }
  /**
   * Get path as array of tag names.
   * @returns {string[]}
   */
  toArray() {
    return this._matcher.path.map((e) => e.tag);
  }
  /**
   * Match current path against an Expression.
   * @param {Expression} expression
   * @returns {boolean}
   */
  matches(e) {
    return this._matcher.matches(e);
  }
  /**
   * Match any expression in the given set against the current path.
   * @param {ExpressionSet} exprSet
   * @returns {boolean}
   */
  matchesAny(e) {
    return e.matchesAny(this._matcher);
  }
}
class pi {
  /**
   * Create a new Matcher.
   * @param {Object} [options={}]
   * @param {string} [options.separator='.'] - Default path separator
   */
  constructor(e = {}) {
    this.separator = e.separator || ".", this.path = [], this.siblingStacks = [], this._pathStringCache = null, this._view = new ui(this), this._keptAttrs = [];
  }
  /**
   * Push a new tag onto the path.
   * @param {string} tagName
   * @param {Object|null} [attrValues=null]
   * @param {string|null} [namespace=null]
   * @param {Object|null} [options=null]
   * @param {string[]} [options.keep] - Names of attributes (from attrValues)
   */
  push(e, n = null, r = null, i = null) {
    this._pathStringCache = null, this.path.length > 0 && (this.path[this.path.length - 1].values = void 0);
    const s = this.path.length;
    let a = this.siblingStacks[s];
    a || (a = { counts: /* @__PURE__ */ new Map(), total: 0 }, this.siblingStacks[s] = a);
    const o = r ? `${r}:${e}` : e, l = a.counts.get(o) || 0, d = a.total;
    a.counts.set(o, l + 1), a.total++;
    const c = {
      tag: e,
      position: d,
      counter: l
    };
    r != null && (c.namespace = r), n != null && (c.values = n), this.path.push(c);
    const u = this.path.length, p = i !== null ? i.keep : null;
    if (p != null && p.length > 0 && n)
      for (let f = 0; f < p.length; f++) {
        const y = p[f];
        n[y] !== void 0 && this._keptAttrs.push({ depth: u, name: y, value: n[y] });
      }
  }
  /**
   * Pop the last tag from the path.
   * @returns {Object|undefined} The popped node
   */
  pop() {
    if (this.path.length === 0) return;
    this._pathStringCache = null;
    const e = this.path.pop();
    this.siblingStacks.length > this.path.length + 1 && (this.siblingStacks.length = this.path.length + 1);
    const n = this.path.length + 1;
    for (; this._keptAttrs.length > 0 && this._keptAttrs[this._keptAttrs.length - 1].depth >= n; )
      this._keptAttrs.pop();
    return e;
  }
  /**
   * Update current node's attribute values.
   * Useful when attributes are parsed after push.
   * @param {Object} attrValues
   */
  updateCurrent(e) {
    if (this.path.length > 0) {
      const n = this.path[this.path.length - 1];
      e != null && (n.values = e);
    }
  }
  /**
   * Get current tag name.
   * @returns {string|undefined}
   */
  getCurrentTag() {
    return this.path.length > 0 ? this.path[this.path.length - 1].tag : void 0;
  }
  /**
   * Get current namespace.
   * @returns {string|undefined}
   */
  getCurrentNamespace() {
    return this.path.length > 0 ? this.path[this.path.length - 1].namespace : void 0;
  }
  /**
   * Get current node's attribute value.
   * @param {string} attrName
   * @returns {*}
   */
  getAttrValue(e) {
    var n;
    if (this.path.length !== 0)
      return (n = this.path[this.path.length - 1].values) == null ? void 0 : n[e];
  }
  /**
   * Check if current node has an attribute.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAttr(e) {
    if (this.path.length === 0) return !1;
    const n = this.path[this.path.length - 1];
    return n.values !== void 0 && e in n.values;
  }
  /**
   * Get the value of a "kept" attribute from the nearest ancestor (or
   * current node) that declared it via `push(tag, attrs, ns, { keep: [...] })`.
   * Unlike getAttrValue(), this works regardless of how deep the path has
   * gone since the attribute was pushed — but only for attribute names that
   * were explicitly marked with `keep` at push time. Cost is proportional to
   * the number of currently-kept attributes (typically 0-3), not path depth.
   * @param {string} attrName
   * @returns {*} the value, or undefined if no ancestor kept this attribute
   */
  getAnyParentAttr(e) {
    const n = this._keptAttrs;
    for (let r = n.length - 1; r >= 0; r--)
      if (n[r].name === e) return n[r].value;
  }
  /**
   * Check whether any ancestor (or the current node) kept the given
   * attribute via `push(tag, attrs, ns, { keep: [...] })`.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAnyParentAttr(e) {
    const n = this._keptAttrs;
    for (let r = n.length - 1; r >= 0; r--)
      if (n[r].name === e) return !0;
    return !1;
  }
  /**
   * Get current node's sibling position (child index in parent).
   * @returns {number}
   */
  getPosition() {
    return this.path.length === 0 ? -1 : this.path[this.path.length - 1].position ?? 0;
  }
  /**
   * Get current node's repeat counter (occurrence count of this tag name).
   * @returns {number}
   */
  getCounter() {
    return this.path.length === 0 ? -1 : this.path[this.path.length - 1].counter ?? 0;
  }
  /**
   * Get current node's sibling index (alias for getPosition).
   * @returns {number}
   * @deprecated Use getPosition() or getCounter() instead
   */
  getIndex() {
    return this.getPosition();
  }
  /**
   * Get current path depth.
   * @returns {number}
   */
  getDepth() {
    return this.path.length;
  }
  /**
   * Get path as string.
   * @param {string} [separator] - Optional separator (uses default if not provided)
   * @param {boolean} [includeNamespace=true]
   * @returns {string}
   */
  toString(e, n = !0) {
    const r = e || this.separator;
    if (r === this.separator && n === !0) {
      if (this._pathStringCache !== null)
        return this._pathStringCache;
      const s = this.path.map(
        (a) => a.namespace ? `${a.namespace}:${a.tag}` : a.tag
      ).join(r);
      return this._pathStringCache = s, s;
    }
    return this.path.map(
      (s) => n && s.namespace ? `${s.namespace}:${s.tag}` : s.tag
    ).join(r);
  }
  /**
   * Get path as array of tag names.
   * @returns {string[]}
   */
  toArray() {
    return this.path.map((e) => e.tag);
  }
  /**
   * Reset the path to empty.
   */
  reset() {
    this._pathStringCache = null, this.path = [], this.siblingStacks = [], this._keptAttrs = [];
  }
  /**
   * Match current path against an Expression.
   * @param {Expression} expression
   * @returns {boolean}
   */
  matches(e) {
    const n = e.segments;
    return n.length === 0 ? !1 : e.hasDeepWildcard() ? this._matchWithDeepWildcard(n) : this._matchSimple(n);
  }
  /**
   * @private
   */
  _matchSimple(e) {
    if (this.path.length !== e.length)
      return !1;
    for (let n = 0; n < e.length; n++)
      if (!this._matchSegment(e[n], this.path[n], n === this.path.length - 1))
        return !1;
    return !0;
  }
  /**
   * @private
   */
  _matchWithDeepWildcard(e) {
    let n = this.path.length - 1, r = e.length - 1;
    for (; r >= 0 && n >= 0; ) {
      const i = e[r];
      if (i.type === "deep-wildcard") {
        if (r--, r < 0)
          return !0;
        const s = e[r];
        let a = !1;
        for (let o = n; o >= 0; o--)
          if (this._matchSegment(s, this.path[o], o === this.path.length - 1)) {
            n = o - 1, r--, a = !0;
            break;
          }
        if (!a)
          return !1;
      } else {
        if (!this._matchSegment(i, this.path[n], n === this.path.length - 1))
          return !1;
        n--, r--;
      }
    }
    return r < 0;
  }
  /**
   * @private
   */
  _matchSegment(e, n, r) {
    if (e.tag !== "*" && e.tag !== n.tag || e.namespace !== void 0 && e.namespace !== "*" && e.namespace !== n.namespace || e.attrName !== void 0 && (!r || !n.values || !(e.attrName in n.values) || e.attrValue !== void 0 && String(n.values[e.attrName]) !== String(e.attrValue)))
      return !1;
    if (e.position !== void 0) {
      if (!r)
        return !1;
      const i = n.counter ?? 0;
      if (e.position === "first" && i !== 0)
        return !1;
      if (e.position === "odd" && i % 2 !== 1)
        return !1;
      if (e.position === "even" && i % 2 !== 0)
        return !1;
      if (e.position === "nth" && i !== e.positionValue)
        return !1;
    }
    return !0;
  }
  /**
   * Match any expression in the given set against the current path.
   * @param {ExpressionSet} exprSet
   * @returns {boolean}
   */
  matchesAny(e) {
    return e.matchesAny(this);
  }
  /**
   * Create a snapshot of current state.
   * @returns {Object}
   */
  snapshot() {
    return {
      path: this.path.map((e) => ({ ...e })),
      siblingStacks: this.siblingStacks.map((e) => e && { counts: new Map(e.counts), total: e.total }),
      keptAttrs: this._keptAttrs.map((e) => ({ ...e }))
    };
  }
  /**
   * Restore state from snapshot.
   * @param {Object} snapshot
   */
  restore(e) {
    this._pathStringCache = null, this.path = e.path.map((n) => ({ ...n })), this.siblingStacks = e.siblingStacks.map((n) => n && { counts: new Map(n.counts), total: n.total }), this._keptAttrs = (e.keptAttrs || []).map((n) => ({ ...n }));
  }
  /**
   * Return the read-only {@link MatcherView} for this matcher.
   *
   * The same instance is returned on every call — no allocation occurs.
   * It always reflects the current parser state and is safe to pass to
   * user callbacks without risk of accidental mutation.
   *
   * @returns {MatcherView}
   *
   * @example
   * const view = matcher.readOnly();
   * // pass view to callbacks — it stays in sync automatically
   * view.matches(expr);       // ✓
   * view.getCurrentTag();     // ✓
   * // view.push(...)         // ✗ method does not exist — caught by TypeScript
   */
  readOnly() {
    return this._view;
  }
}
const an = [
  {
    id: "html-script-open",
    description: "<script opening tag",
    pattern: /<script[\s>/]/i
  },
  {
    id: "html-script-close",
    description: "<\/script closing tag",
    pattern: /<\/script[\s>]/i
  },
  {
    id: "html-javascript-protocol",
    description: "javascript: URI scheme (with optional whitespace/encoding)",
    // Handles j&#x61;vascript:, j\u0061vascript:, and whitespace variants
    pattern: /j[\t\n\r ]*a[\t\n\r ]*v[\t\n\r ]*a[\t\n\r ]*s[\t\n\r ]*c[\t\n\r ]*r[\t\n\r ]*i[\t\n\r ]*p[\t\n\r ]*t[\t\n\r ]*:/i
  },
  {
    id: "html-vbscript-protocol",
    description: "vbscript: URI scheme",
    pattern: /vbscript[\t\n\r ]*:/i
  },
  {
    id: "html-data-html",
    description: "data:text/html URI — can execute scripts in browsers",
    pattern: /data[\t\n\r ]*:[\t\n\r ]*text\/html/i
  },
  {
    id: "html-data-xhtml",
    description: "data:application/xhtml+xml URI",
    pattern: /data[\t\n\r ]*:[\t\n\r ]*application\/xhtml/i
  },
  {
    id: "html-data-svg",
    description: "data:image/svg+xml URI — can execute scripts",
    pattern: /data[\t\n\r ]*:[\t\n\r ]*image\/svg\+xml/i
  },
  {
    id: "html-inline-event-handler",
    description: "Inline event handler attributes: onclick=, onerror=, onload=, etc.",
    // \bon ensures we match a word boundary so "phonetic=" is not caught
    pattern: /\bon\w{1,30}\s*=/i
  },
  {
    id: "html-entity-obfuscated-script",
    description: "HTML-entity-encoded <script (e.g. &#x3C;script or &lt;script)",
    // Entities include optional trailing semicolon: &#x3C; or &#x3C (both valid in HTML5)
    pattern: /(?:&#x0*3[Cc];?|&#0*60;?|&lt;)\s*script/i
  },
  {
    id: "html-entity-obfuscated-javascript",
    description: 'HTML-entity-encoded javascript: (partial — catches common &#106; or &#x6a; for "j")',
    pattern: /(?:&#x0*6[Aa];?|&#0*106;?)\s*(?:&#x0*61;?|a)[\s\S]{0,80}script\s*:/i
  },
  {
    id: "html-style-expression",
    description: "CSS expression() — IE-era code execution in style attributes",
    pattern: /style[\s\S]{0,20}expression\s*\(/i
  },
  {
    id: "html-object-embed",
    description: "<object or <embed tags that can load active content",
    pattern: /<(?:object|embed)[\s>/]/i
  },
  {
    id: "html-base-tag",
    description: "<base href= — can hijack all relative URLs on a page",
    pattern: /<base[\s>]/i
  },
  {
    id: "html-meta-refresh",
    description: '<meta http-equiv="refresh" — can redirect users',
    pattern: /<meta[\s\S]{0,40}http-equiv[\s\S]{0,20}refresh/i
  },
  {
    id: "html-srcdoc",
    description: "srcdoc= attribute on iframes — embeds HTML that can run scripts",
    pattern: /srcdoc\s*=/i
  },
  {
    id: "html-iframe",
    description: "<iframe tag",
    pattern: /<iframe[\s>/]/i
  },
  {
    id: "html-form",
    description: "<form tag — can be used for phishing / credential harvesting injection",
    pattern: /<form[\s>/]/i
  }
], ln = [
  {
    id: "xml-cdata-injection",
    description: "CDATA section injection: <![CDATA[ breaks out of text node context",
    pattern: /<!\[CDATA\[/i
  },
  {
    id: "xml-cdata-close",
    description: "CDATA close sequence: ]]> can terminate an enclosing CDATA section",
    pattern: /\]\]>/
  },
  {
    id: "xml-processing-instruction",
    description: "XML processing instruction: <?xml-stylesheet or <?php etc.",
    pattern: /<\?(?:xml[\- ]|php|asp)/i
  },
  {
    id: "xml-doctype-injection",
    description: "DOCTYPE declaration embedded in content — can define entities",
    // Match <!DOCTYPE followed by end-of-string, whitespace, or [ (internal subset)
    pattern: /<!DOCTYPE(?:[\s[]|$)/i
  },
  {
    id: "xml-entity-system",
    description: "SYSTEM keyword — used in external entity declarations (XXE)",
    pattern: /\bSYSTEM\s+["']/i
  },
  {
    id: "xml-entity-public",
    description: "PUBLIC keyword — used in external entity declarations (XXE)",
    pattern: /\bPUBLIC\s+["']/i
  },
  {
    id: "xml-entity-declaration",
    description: "<!ENTITY declaration — defines entities, potential XXE or entity expansion",
    pattern: /<!ENTITY[\s%]/i
  },
  {
    id: "xml-billion-laughs",
    description: "Entity reference chaining / billion laughs: repeated &eX; style references",
    // Heuristic: 3+ consecutive entity refs suggests expansion attack
    pattern: /(?:&\w{1,20};){3,}/
  },
  {
    id: "xml-namespace-confusion",
    description: "xmlns: attribute injection — can redefine namespaces to confuse parsers",
    // pattern: /\bxmlns\s*(?::\w{1,40})?\s*=/i,
    pattern: /\bxmlns(?::\w{1,40})?\s*=/i
  },
  {
    id: "xml-comment-injection",
    description: "<!-- comment injection — can hide content from some parsers",
    pattern: /<!--/
  },
  {
    id: "xml-comment-close",
    description: "--> closes an enclosing XML comment",
    pattern: /-->/
  },
  {
    id: "xml-pi-close",
    description: "?> closes an enclosing processing instruction",
    pattern: /\?>/
  }
], hi = [
  {
    id: "svg-script-element",
    description: "<script element inside SVG executes JavaScript",
    pattern: /<script[\s>/]/i
  },
  {
    id: "svg-xlink-href-javascript",
    description: "xlink:href with javascript: — classic SVG XSS via <a> or <use>",
    pattern: /xlink\s*:\s*href\s*=\s*["']?\s*javascript\s*:/i
  },
  {
    id: "svg-href-javascript",
    description: "href= with javascript: in SVG context (<a>, <animate>, etc.)",
    pattern: /href\s*=\s*["']?\s*javascript\s*:/i
  },
  {
    id: "svg-foreignobject",
    description: "<foreignObject embeds HTML inside SVG — can execute scripts",
    pattern: /<foreignObject[\s>/]/i
  },
  {
    id: "svg-use-external",
    description: "<use xlink:href or href pointing to external resource (non-fragment URL)",
    // Match <use with href= where the value starts with a non-# character (external URL)
    // [\"'][^#] catches quoted values not starting with #; [^\"'#\s>] catches unquoted
    pattern: /<use[\s\S]{0,60}(?:xlink\s*:\s*)?href\s*=\s*(?:["'][^#]|[^"'#\s>])/i
  },
  {
    id: "svg-animate-href",
    description: '<animate attributeName="href" — can dynamically change href to javascript:',
    pattern: /<animate[\s\S]{0,80}attributeName\s*=\s*["'][\s]*href["']/i
  },
  {
    id: "svg-animate-xlinkhref",
    description: '<animate attributeName="xlink:href"',
    pattern: /<animate[\s\S]{0,80}attributeName\s*=\s*["'][\s]*xlink\s*:\s*href["']/i
  },
  {
    id: "svg-set-javascript",
    description: '<set to="javascript:..." — sets an attribute to a javascript: URI',
    pattern: /<set[\s\S]{0,80}to\s*=\s*["']?\s*javascript\s*:/i
  },
  {
    id: "svg-event-handler",
    description: "SVG-specific event handler attributes: onload=, onerror=, onactivate=, etc.",
    pattern: /\bon(?:load|error|activate|begin|end|repeat|focus|blur|click|mouse\w{1,20}|key\w{1,20})\s*=/i
  },
  {
    id: "svg-handler-generic",
    description: "Generic on* handler catch-all for SVG attributes",
    pattern: /\bon\w{1,30}\s*=/i
  },
  {
    id: "svg-filter-feimage",
    description: "<feImage href= — filter primitive that can load external resources",
    pattern: /<feImage[\s\S]{0,80}(?:xlink\s*:\s*)?href\s*=/i
  },
  {
    id: "svg-image-external",
    description: "<image xlink:href with http/https or javascript protocol",
    pattern: /<image[\s\S]{0,80}(?:xlink\s*:\s*)?href\s*=\s*["']?\s*(?:https?|javascript)\s*:/i
  },
  {
    id: "svg-style-javascript",
    description: "style= attribute containing javascript: (e.g. background:url(javascript:...))",
    pattern: /style\s*=[\s\S]{0,60}javascript\s*:/i
  }
], cn = [
  {
    id: "sql-block-comment-open",
    description: "SQL block comment open: /* ... */ — unusual in legitimate user text",
    pattern: /\/\*/
  },
  {
    id: "sql-union-select",
    description: "UNION SELECT — most common SQL injection aggregation attack",
    pattern: /\bUNION\s{1,20}(?:ALL\s{1,20})?SELECT\b/i
  },
  {
    id: "sql-drop-table",
    description: "DROP TABLE — destructive DDL injection",
    pattern: /\bDROP\s{1,20}TABLE\b/i
  },
  {
    id: "sql-drop-database",
    description: "DROP DATABASE — destructive DDL injection",
    pattern: /\bDROP\s{1,20}DATABASE\b/i
  },
  {
    id: "sql-insert-into",
    description: "INSERT INTO — data injection",
    pattern: /\bINSERT\s{1,20}INTO\b/i
  },
  {
    id: "sql-delete-from",
    description: "DELETE FROM — data deletion injection",
    pattern: /\bDELETE\s{1,20}FROM\b/i
  },
  {
    id: "sql-update-set",
    description: "UPDATE ... SET — data modification injection",
    // Allows arbitrary content between UPDATE and SET (table name, alias, etc.)
    pattern: /\bUPDATE\b[\s\S]{1,60}\bSET\b/i
  },
  {
    id: "sql-exec-xp",
    description: "EXEC xp_ — MSSQL extended stored procedure execution",
    pattern: /\bEXEC(?:UTE)?\s{1,20}xp_/i
  },
  {
    id: "sql-tautology-string",
    description: `Classic string tautology: ' OR '1'='1 or " OR "1"="1"`,
    // Last quote is optional — injection may truncate it: ' OR '1'='1--
    pattern: /'\s{0,10}OR\s{0,10}'[^']{0,20}'\s*=\s*'[^']{0,20}/i
  },
  {
    id: "sql-tautology-numeric",
    description: "Numeric tautology: OR 1=1",
    pattern: /\bOR\s{1,10}1\s*=\s*1\b/i
  },
  {
    id: "sql-always-true-zero",
    description: "Numeric tautology: OR 0=0",
    pattern: /\bOR\s{1,10}0\s*=\s*0\b/i
  },
  {
    id: "sql-sleep-benchmark",
    description: "Time-based blind injection: SLEEP() or BENCHMARK()",
    pattern: /\b(?:SLEEP|BENCHMARK)\s*\(/i
  },
  {
    id: "sql-waitfor-delay",
    description: "MSSQL time-based blind injection: WAITFOR DELAY",
    pattern: /\bWAITFOR\s{1,20}DELAY\b/i
  },
  {
    id: "sql-char-function",
    description: "CHAR() function — used to obfuscate injected strings",
    pattern: /\bCHAR\s*\(\s*\d{1,3}/i
  },
  {
    id: "sql-information-schema",
    description: "INFORMATION_SCHEMA — reconnaissance query for table/column enumeration",
    pattern: /\bINFORMATION_SCHEMA\b/i
  }
], fi = [
  {
    id: "shell-path-traversal-unix",
    description: "Unix path traversal: ../  — climbing the directory tree",
    pattern: /\.\.\//
  },
  {
    id: "shell-path-traversal-windows",
    description: "Windows path traversal: ..\\ — climbing the directory tree",
    pattern: /\.\.\\/
  },
  {
    id: "shell-path-traversal-encoded",
    description: "URL-encoded path traversal: %2e%2e or %2f variants",
    pattern: /%2e%2e|%2f\.\.|\.\.%2f/i
  },
  {
    id: "shell-null-byte",
    description: "Null byte injection: \\x00 or %00 — truncates strings in C-backed functions",
    pattern: /\x00|%00/
  },
  {
    id: "shell-semicolon",
    description: "Semicolon command separator: cmd1; cmd2",
    pattern: /;/
  },
  {
    id: "shell-pipe",
    description: "Pipe operator: cmd1 | cmd2",
    pattern: /\|/
  },
  {
    id: "shell-and-operator",
    description: "AND operator: cmd1 && cmd2",
    pattern: /&&/
  },
  {
    id: "shell-or-operator",
    description: "OR operator: cmd1 || cmd2",
    pattern: /\|\|/
  },
  {
    id: "shell-backtick",
    description: "Backtick command substitution: `cmd`",
    pattern: /`/
  },
  {
    id: "shell-dollar-paren",
    description: "Dollar-paren command substitution: $(cmd)",
    pattern: /\$\(/
  },
  {
    id: "shell-dollar-brace",
    description: "Dollar-brace variable expansion: ${var} — can be abused for injection",
    pattern: /\$\{/
  },
  {
    id: "shell-redirect-out",
    description: "Output redirection: cmd > file or cmd >> file",
    pattern: />{1,2}/
  },
  {
    id: "shell-redirect-in",
    description: "Input redirection: cmd < file",
    pattern: /</
  },
  {
    id: "shell-newline-injection",
    description: "Newline injection: \\n or \\r — can inject new shell commands",
    pattern: /[\n\r]/
  },
  {
    id: "shell-glob-star",
    description: "Glob expansion: * or ? — can expand to unintended files",
    // Only flag when combined with path separators to reduce false positives
    pattern: /[/\\][*?]/
  },
  {
    id: "shell-absolute-root",
    description: "Absolute root path injection: string starting with / or \\ (Windows UNC)",
    pattern: /^(?:\/|\\\\)/
  },
  {
    id: "shell-windows-drive",
    description: "Windows drive letter path injection: C:\\ or D:/",
    pattern: /^[a-zA-Z]:[/\\]/
  },
  {
    id: "shell-curl-wget",
    description: "curl/wget with URL or flags — can exfiltrate data or download payloads",
    // Require a URL scheme (http/https/ftp) or a flag (-) to reduce false positives
    // "curl is a tool" won't match; "curl http://..." or "curl -s ..." will
    pattern: /\b(?:curl|wget)\s+(?:https?:\/\/|ftp:\/\/|-)/i
  }
], gi = [
  {
    id: "redos-nested-quantifier-plus",
    description: "Nested + quantifier inside a group with outer quantifier: (a+)+, (.+b)*, etc.",
    // Matches any group containing a + quantifier, with an outer * or + — catches (a+)+, (.+b)*, etc.
    pattern: /\([^)]*\+[^)]*\)[+*]/
  },
  {
    id: "redos-nested-quantifier-star",
    description: "Nested * quantifier: (a*)* or (a*)+ — catastrophic backtracking",
    pattern: /\([^)]*\*[^)]*\)[*+]/
  },
  {
    id: "redos-nested-groups",
    description: "Doubly nested quantified groups: ((a+)+) — guaranteed catastrophic",
    pattern: /\(\([^)]{0,40}\)[+*]\)[+*]/
  },
  {
    id: "redos-alternation-overlap",
    description: "Overlapping alternation under quantifier: (a|a)+ — ambiguous NFA paths",
    // Detect repeated identical alternatives under a quantifier
    pattern: /\(([^|()]{1,20})\|(?:\1)(?:\|[^|()]{1,20}){0,5}\)[+*?]{1,2}/
  },
  {
    id: "redos-star-plus-concat",
    description: "(x*x)+ pattern — triggers super-linear backtracking",
    pattern: /\([^)]{0,10}\*[^)]{0,10}\)[+*]/
  },
  {
    id: "redos-dot-star-greedy",
    description: "(.*){n,} or (.+){n,} — repeated greedy dot quantifiers",
    pattern: /\(\.[*+]\)\{?\d/
  },
  {
    id: "redos-large-repetition",
    description: "Very large fixed or range repetition count {1000,} or {1000,n} — denial of service via backtracking",
    // Matches { followed by 4+ digits (≥1000), then optional ,digits }
    pattern: /\{\d{4,}(?:,\d*)?\}/
  },
  {
    id: "redos-catastrophic-alternation",
    description: "Long alternation with many similar branches — polynomial backtracking risk",
    // Heuristic: 10+ pipe-separated alternatives in a single group
    pattern: /\([^)]{0,200}(?:\|[^|)]{0,50}){9,}\)/
  }
], _ = `["'\\s]*:`, mi = [
  // ─── MongoDB $ operator injection ────────────────────────────────────────
  {
    id: "nosql-where-operator",
    description: "$where — executes arbitrary JavaScript server-side in MongoDB",
    pattern: new RegExp(`\\$where${_}`, "i")
  },
  {
    id: "nosql-ne-operator",
    description: '$ne — "not equal" operator used to bypass equality checks',
    pattern: new RegExp(`\\$ne${_}`, "i")
  },
  {
    id: "nosql-gt-operator",
    description: '$gt — "greater than" used to bypass password/value checks',
    pattern: new RegExp(`\\$gte?${_}`, "i")
  },
  {
    id: "nosql-lt-operator",
    description: '$lt / $lte — "less than" bypass variants',
    pattern: new RegExp(`\\$lte?${_}`, "i")
  },
  {
    id: "nosql-regex-operator",
    description: "$regex — can be used to extract data character by character (blind injection)",
    pattern: new RegExp(`\\$regex${_}`, "i")
  },
  {
    id: "nosql-or-operator",
    description: "$or — logical OR; used to create always-true conditions",
    pattern: new RegExp(`\\$or${_}\\s*\\[`, "i")
  },
  {
    id: "nosql-and-operator",
    description: "$and — logical AND operator injection",
    pattern: new RegExp(`\\$and${_}\\s*\\[`, "i")
  },
  {
    id: "nosql-nor-operator",
    description: "$nor — logical NOR operator injection",
    pattern: new RegExp(`\\$nor${_}\\s*\\[`, "i")
  },
  {
    id: "nosql-exists-operator",
    description: "$exists — can enumerate fields to determine schema",
    pattern: new RegExp(`\\$exists${_}`, "i")
  },
  {
    id: "nosql-in-operator",
    description: "$in — matches any value in a list; can enumerate values",
    pattern: new RegExp(`\\$in${_}\\s*\\[`, "i")
  },
  {
    id: "nosql-expr-operator",
    description: "$expr — allows aggregation expressions in queries (MongoDB 3.6+)",
    pattern: new RegExp(`\\$expr${_}`, "i")
  },
  {
    id: "nosql-function-operator",
    description: "$function — executes arbitrary JavaScript in MongoDB 4.4+",
    pattern: new RegExp(`\\$function${_}`, "i")
  },
  {
    id: "nosql-accumulator-operator",
    description: "$accumulator — custom aggregation with arbitrary JS execution",
    pattern: new RegExp(`\\$accumulator${_}`, "i")
  },
  // ─── Prototype pollution ─────────────────────────────────────────────────
  {
    id: "nosql-proto-pollution",
    description: "__proto__ — prototype pollution via object key injection",
    pattern: /__proto__/
  },
  {
    id: "nosql-constructor-prototype",
    description: "constructor.prototype — alternative prototype pollution vector (dot notation or JSON key)",
    // Matches dot-notation (obj.constructor.prototype) and JSON key adjacency
    // ("constructor": {"prototype": ...})
    pattern: /constructor[\s"':.,{\[]*prototype/i
  },
  {
    id: "nosql-proto-bracket",
    description: '["__proto__"] — bracket-notation prototype pollution',
    pattern: /\[["']__proto__["']\]/
  }
], Ei = [
  // ─── CRLF / newline injection ─────────────────────────────────────────────
  {
    id: "log-crlf-injection",
    description: "CRLF injection: literal \\r or \\n embeds fake log lines",
    pattern: /[\r\n]/
  },
  {
    id: "log-url-encoded-crlf",
    description: "URL-encoded CRLF: %0d, %0a, %0D, %0A — decoded by some log parsers",
    pattern: /%0[dDaA]/
  },
  {
    id: "log-unicode-newline",
    description: "Unicode newline variants: U+2028 (line separator), U+2029 (paragraph separator)",
    pattern: /[\u2028\u2029]/
  },
  // ─── Log4Shell / JNDI injection (CVE-2021-44228) ─────────────────────────
  {
    id: "log-log4shell-jndi",
    description: "Log4Shell: ${jndi:...} triggers remote code execution in Apache Log4j",
    pattern: /\$\{jndi\s*:/i
  },
  {
    id: "log-log4shell-obfuscated",
    description: "Obfuscated Log4Shell: ${::-j}... lookup-bypass prefix used to evade WAF detection",
    // ${::- is the Log4j lookup-bypass escape sequence; presence alone is suspicious
    pattern: /\$\{::-/
  },
  {
    id: "log-log4j-lookup",
    description: "Log4j lookup syntax: ${env:...}, ${sys:...}, ${ctx:...} — data exfiltration",
    pattern: /\$\{(?:env|sys|ctx|main|map|sd|web|docker|k8s|spring)\s*:/i
  },
  // ─── Server-Side Template Injection (SSTI) in log messages ───────────────
  {
    id: "log-ssti-double-brace",
    description: "SSTI double-brace: {{expression}} — Jinja2, Twig, Handlebars, etc.",
    pattern: /\{\{[\s\S]{0,80}\}\}/
  },
  {
    id: "log-ssti-hash-brace",
    description: "SSTI hash-brace: #{expression} — Thymeleaf, Velocity, Ruby ERB",
    pattern: /#\{[\s\S]{0,80}\}/
  },
  {
    id: "log-ssti-dollar-brace",
    description: "SSTI/EL injection: ${expression with operators or method calls} — JSP EL, Freemarker, SpEL",
    // Require that the ${...} content looks like an expression, not a plain variable name.
    // Flags if the content contains: . ( * + operators, or known SSTI keywords.
    // This avoids flagging ${PATH}, ${HOME} etc. (plain shell variables).
    pattern: /\$\{[^}]*(?:\.|\(|\*|\+|\bclass\b|\bruntime\b|\bprocess\b|\bexec\b)[^}]{0,80}\}/i
  },
  {
    id: "log-ssti-percent-tag",
    description: "SSTI ERB/ASP tag: <%= expression %> — Ruby ERB, ASP",
    pattern: /<%=[\s\S]{0,80}%>/
  },
  // ─── Null byte ────────────────────────────────────────────────────────────
  {
    id: "log-null-byte",
    description: "Null byte: \\x00 or %00 — can truncate log entries in C-backed loggers",
    pattern: /\x00|%00/
  },
  // ─── ANSI escape injection ────────────────────────────────────────────────
  {
    id: "log-ansi-escape",
    description: "ANSI escape sequence: ESC[ — can manipulate terminal output when logs are tailed",
    pattern: /\x1b\[/
  }
], yi = [
  {
    id: "sql-line-comment",
    description: "SQL line comment: -- followed by whitespace or end of string",
    pattern: /--(?:\s|$)/
  },
  {
    id: "sql-stacked-query",
    description: "Stacked queries: semicolon immediately followed by a SQL keyword",
    pattern: /;\s{0,10}(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC)\b/i
  },
  {
    id: "sql-hex-encoding",
    description: "Hex-encoded string injection: 0x41414141 style (MySQL)",
    pattern: /\b0x[0-9a-f]{4,}/i
  }
], Ti = [...cn, ...yi];
an.label = "HTML";
ln.label = "XML";
hi.label = "SVG";
cn.label = "SQL";
Ti.label = "SQL-STRICT";
fi.label = "SHELL";
gi.label = "REDOS";
mi.label = "NOSQL";
Ei.label = "LOG";
function bi(t) {
  if (typeof t != "string")
    throw new TypeError(
      `is-unsafe: first argument must be a string, got ${typeof t}`
    );
}
function wi(t) {
  if (!(t instanceof RegExp)) {
    if (Array.isArray(t)) {
      if (t.length === 0)
        throw new TypeError("is-unsafe: context must not be an empty array");
      if (Array.isArray(t[0])) {
        for (const e of t)
          if (!Array.isArray(e) || e.length === 0)
            throw new TypeError(
              "is-unsafe: each context in the array must be a non-empty pattern array (PatternList)"
            );
      }
      return;
    }
    throw new TypeError(
      `is-unsafe: second argument must be a PatternList (e.g. HTML), an array of PatternLists (e.g. [HTML, XML]), or a RegExp. Got: ${typeof t}`
    );
  }
}
function Si(t) {
  return t instanceof RegExp ? { lists: null, regex: t } : Array.isArray(t[0]) ? { lists: t, regex: null } : { lists: [t], regex: null };
}
function Ni(t, e) {
  const n = e.label ?? "CUSTOM";
  for (const r of e)
    if (r.pattern.test(t))
      return { context: n, id: r.id, description: r.description, pattern: r.pattern };
  return null;
}
function xi(t, e) {
  bi(t), wi(e);
  const { lists: n, regex: r } = Si(e);
  if (r) return r.test(t);
  for (const i of n)
    if (Ni(t, i) !== null) return !0;
  return !1;
}
function Ai(t, e) {
  if (!t) return {};
  const n = e.attributesGroupName ? t[e.attributesGroupName] : t;
  if (!n) return {};
  const r = {};
  for (const i in n)
    if (i.startsWith(e.attributeNamePrefix)) {
      const s = i.substring(e.attributeNamePrefix.length);
      r[s] = n[i];
    } else
      r[i] = n[i];
  return r;
}
function _i(t) {
  if (!t || typeof t != "string") return;
  const e = t.indexOf(":");
  if (e !== -1 && e > 0) {
    const n = t.substring(0, e);
    if (n !== "xmlns")
      return n;
  }
}
class Ii {
  constructor(e, n) {
    this.options = e, this.currentNode = null, this.tagsNodeStack = [], this.parseXml = vi, this.parseTextData = Ci, this.resolveNameSpace = Li, this.buildAttributesMap = Ri, this.isItStopNode = Pi, this.replaceEntitiesValue = ki, this.readStopNodeData = Ui, this.saveTextToParentTag = Fi, this.addChild = Mi, this.ignoreAttributesFn = ci(this.options.ignoreAttributes), this.entityExpansionCount = 0, this.currentExpandedLength = 0, this.doctypefound = !1;
    let r = { ...Kt };
    this.options.entityDecoder ? this.entityDecoder = this.options.entityDecoder : (typeof this.options.htmlEntities == "object" ? r = this.options.htmlEntities : this.options.htmlEntities === !0 && (r = { ...Mr, ...vr }), this.entityDecoder = new jr({
      namedEntities: { ...r, ...n },
      numericAllowed: this.options.htmlEntities,
      limit: {
        maxTotalExpansions: this.options.processEntities.maxTotalExpansions,
        maxExpandedLength: this.options.processEntities.maxExpandedLength,
        applyLimitsTo: this.options.processEntities.appliesTo
      },
      // onExternalEntity: (name, value) => isUnsafe(value) ? 'block' : 'allow',
      onInputEntity: (s, a) => (
        //TODO: VALID_CONTEXTS.HTML should be set only if this.options.htmlEntities
        xi(a, [an, ln]) ? fe.BLOCK : fe.ALLOW
      )
      //postCheck: resolved => resolved
    })), this.matcher = new pi(), this.readonlyMatcher = this.matcher.readOnly(), this.isCurrentNodeStopNode = !1, this.stopNodeExpressionsSet = new di();
    const i = this.options.stopNodes;
    if (i && i.length > 0) {
      for (let s = 0; s < i.length; s++) {
        const a = i[s];
        typeof a == "string" ? this.stopNodeExpressionsSet.add(new St(a)) : a instanceof St && this.stopNodeExpressionsSet.add(a);
      }
      this.stopNodeExpressionsSet.seal();
    }
  }
}
function Ci(t, e, n, r, i, s, a) {
  const o = this.options;
  if (t !== void 0 && (o.trimValues && !r && (t = t.trim()), t.length > 0)) {
    a || (t = this.replaceEntitiesValue(t, e, n));
    const l = o.jPath ? n.toString() : n, d = o.tagValueProcessor(e, t, l, i, s);
    return d == null ? t : typeof d != typeof t || d !== t ? d : o.trimValues || t.trim() === t ? Ue(t, o.parseTagValue, o.numberParseOptions) : t;
  }
}
function Li(t) {
  if (this.options.removeNSPrefix) {
    const e = t.split(":"), n = t.charAt(0) === "/" ? "/" : "";
    if (e[0] === "xmlns")
      return "";
    e.length === 2 && (t = n + e[1]);
  }
  return t;
}
const Oi = new RegExp(`([^\\s=]+)\\s*(=\\s*(['"])([\\s\\S]*?)\\3)?`, "gm");
function Ri(t, e, n, r = !1) {
  const i = this.options;
  if (r === !0 || i.ignoreAttributes !== !0 && typeof t == "string") {
    const s = br(t, Oi), a = s.length, o = {}, l = new Array(a);
    let d = !1;
    const c = {};
    for (let f = 0; f < a; f++) {
      const y = this.resolveNameSpace(s[f][1]), E = s[f][4];
      if (y.length && E !== void 0) {
        let b = E;
        i.trimValues && (b = b.trim()), b = this.replaceEntitiesValue(b, n, this.readonlyMatcher), l[f] = b, c[y] = b, d = !0;
      }
    }
    d && typeof e == "object" && e.updateCurrent && e.updateCurrent(c);
    const u = i.jPath ? e.toString() : this.readonlyMatcher;
    let p = !1;
    for (let f = 0; f < a; f++) {
      const y = this.resolveNameSpace(s[f][1]);
      if (this.ignoreAttributesFn(y, u)) continue;
      let E = i.attributeNamePrefix + y;
      if (y.length)
        if (i.transformAttributeName && (E = i.transformAttributeName(E)), E = dn(E, i), s[f][4] !== void 0) {
          const b = l[f], I = i.attributeValueProcessor(y, b, u);
          I == null ? o[E] = b : typeof I != typeof b || I !== b ? o[E] = I : o[E] = Ue(b, i.parseAttributeValue, i.numberParseOptions), p = !0;
        } else i.allowBooleanAttributes && (o[E] = !0, p = !0);
    }
    if (!p) return;
    if (i.attributesGroupName && !i.preserveOrder) {
      const f = {};
      return f[i.attributesGroupName] = o, f;
    }
    return o;
  }
}
const vi = function(t) {
  t = t.replace(/\r\n?/g, `
`);
  const e = new F("!xml");
  let n = e, r = "";
  this.matcher.reset(), this.entityDecoder.reset(), this.entityExpansionCount = 0, this.currentExpandedLength = 0, this.doctypefound = !1;
  const i = this.options, s = new zr(i.processEntities), a = t.length;
  for (let o = 0; o < a; o++)
    if (t[o] === "<") {
      const d = t.charCodeAt(o + 1);
      if (d === 47) {
        const c = D(t, ">", o, "Closing Tag is not closed.");
        let u = t.substring(o + 2, c).trim();
        if (i.removeNSPrefix) {
          const f = u.indexOf(":");
          f !== -1 && (u = u.substr(f + 1));
        }
        u = xe(i.transformTagName, u, "", i).tagName, n && (r = this.saveTextToParentTag(r, n, this.readonlyMatcher));
        const p = this.matcher.getCurrentTag();
        if (u && i.unpairedTagsSet.has(u))
          throw new Error(`Unpaired tag can not be used as closing tag: </${u}>`);
        p && i.unpairedTagsSet.has(p) && (this.matcher.pop(), this.tagsNodeStack.pop()), this.matcher.pop(), this.isCurrentNodeStopNode = !1, n = this.tagsNodeStack.pop() || e, i.captureMetaData && n && n.addEndIndex(c + 1), r = "", o = c;
      } else if (d === 63) {
        let c = je(t, o, !1, "?>");
        if (!c) throw new Error("Pi Tag is not closed.");
        r = this.saveTextToParentTag(r, n, this.readonlyMatcher);
        const u = this.buildAttributesMap(c.tagExp, this.matcher, c.tagName, !0);
        if (u) {
          const p = u[this.options.attributeNamePrefix + "version"];
          this.entityDecoder.setXmlVersion(Number(p) || 1), s.setXmlVersion(Number(p) || 1);
        }
        if (!(i.ignoreDeclaration && c.tagName === "?xml" || i.ignorePiTags)) {
          const p = new F(c.tagName);
          p.add(i.textNodeName, ""), c.tagName !== c.tagExp && c.attrExpPresent && i.ignoreAttributes !== !0 && (p[":@"] = u), this.addChild(n, p, this.readonlyMatcher, o), i.captureMetaData && n.addEndIndex(c.closeIndex + 2);
        }
        o = c.closeIndex + 1;
      } else if (d === 33 && t.charCodeAt(o + 2) === 45 && t.charCodeAt(o + 3) === 45) {
        const c = D(t, "-->", o + 4, "Comment is not closed.");
        if (i.commentPropName) {
          const u = t.substring(o + 4, c - 2);
          r = this.saveTextToParentTag(r, n, this.readonlyMatcher), n.add(i.commentPropName, [{ [i.textNodeName]: u }]);
        }
        o = c;
      } else if (d === 33 && t.charCodeAt(o + 2) === 68) {
        if (this.doctypefound) throw new Error("Multiple DOCTYPE declarations found.");
        this.doctypefound = !0;
        const c = s.readDocType(t, o);
        this.entityDecoder.addInputEntities(c.entities), o = c.i;
      } else if (d === 33 && t.charCodeAt(o + 2) === 91) {
        const c = D(t, "]]>", o, "CDATA is not closed.") - 2, u = t.substring(o + 9, c);
        r = this.saveTextToParentTag(r, n, this.readonlyMatcher);
        let p = this.parseTextData(u, n.tagname, this.readonlyMatcher, !0, !1, !0, !0);
        p == null && (p = ""), i.cdataPropName ? n.add(i.cdataPropName, [{ [i.textNodeName]: u }]) : n.add(i.textNodeName, p), o = c + 2;
      } else {
        let c = je(t, o, i.removeNSPrefix);
        if (!c) {
          const N = t.substring(Math.max(0, o - 50), Math.min(a, o + 50));
          throw new Error(`readTagExp returned undefined at position ${o}. Context: "${N}"`);
        }
        let u = c.tagName;
        const p = c.rawTagName;
        let f = c.tagExp, y = c.attrExpPresent, E = c.closeIndex;
        if ({ tagName: u, tagExp: f } = xe(i.transformTagName, u, f, i), i.strictReservedNames && (u === i.commentPropName || u === i.cdataPropName || u === i.textNodeName || u === i.attributesGroupName))
          throw new Error(`Invalid tag name: ${u}`);
        n && r && n.tagname !== "!xml" && (r = this.saveTextToParentTag(r, n, this.readonlyMatcher, !1));
        const b = n;
        b && i.unpairedTagsSet.has(b.tagname) && (n = this.tagsNodeStack.pop(), this.matcher.pop());
        let I = !1;
        f.length > 0 && f.lastIndexOf("/") === f.length - 1 && (I = !0, u[u.length - 1] === "/" ? (u = u.substr(0, u.length - 1), f = u) : f = f.substr(0, f.length - 1), y = u !== f);
        let O = null, it;
        it = _i(p), u !== e.tagname && this.matcher.push(u, {}, it), u !== f && y && (O = this.buildAttributesMap(f, this.matcher, u), O && Ai(O, i)), u !== e.tagname && (this.isCurrentNodeStopNode = this.isItStopNode());
        const ce = o;
        if (this.isCurrentNodeStopNode) {
          let N = "";
          if (I)
            o = c.closeIndex;
          else if (i.unpairedTagsSet.has(u))
            o = c.closeIndex;
          else {
            const be = this.readStopNodeData(t, p, E + 1);
            if (!be) throw new Error(`Unexpected end of ${p}`);
            o = be.i, N = be.tagContent;
          }
          const Te = new F(u);
          O && (Te[":@"] = O), Te.add(i.textNodeName, N), this.matcher.pop(), this.isCurrentNodeStopNode = !1, this.addChild(n, Te, this.readonlyMatcher, ce), i.captureMetaData && n.addEndIndex(o + 1);
        } else {
          if (I) {
            ({ tagName: u, tagExp: f } = xe(i.transformTagName, u, f, i));
            const N = new F(u);
            O && (N[":@"] = O), this.addChild(n, N, this.readonlyMatcher, ce), i.captureMetaData && n.addEndIndex(E + 1), this.matcher.pop(), this.isCurrentNodeStopNode = !1;
          } else if (i.unpairedTagsSet.has(u)) {
            const N = new F(u);
            O && (N[":@"] = O), this.addChild(n, N, this.readonlyMatcher, ce), i.captureMetaData && n.addEndIndex(c.closeIndex + 1), this.matcher.pop(), this.isCurrentNodeStopNode = !1, o = c.closeIndex;
            continue;
          } else {
            const N = new F(u);
            if (this.tagsNodeStack.length > i.maxNestedTags)
              throw new Error("Maximum nested tags exceeded");
            this.tagsNodeStack.push(n), O && (N[":@"] = O), this.addChild(n, N, this.readonlyMatcher, ce), n = N;
          }
          r = "", o = E;
        }
      }
    } else
      r += t[o];
  return e.child;
};
function Mi(t, e, n, r) {
  this.options.captureMetaData || (r = void 0);
  const i = this.options.jPath ? n.toString() : n, s = this.options.updateTag(e.tagname, i, e[":@"]);
  s === !1 || (typeof s == "string" && (e.tagname = s), t.addChild(e, r));
}
function ki(t, e, n) {
  const r = this.options.processEntities;
  if (!r || !r.enabled)
    return t;
  if (r.allowedTags) {
    const i = this.options.jPath ? n.toString() : n;
    if (!(Array.isArray(r.allowedTags) ? r.allowedTags.includes(e) : r.allowedTags(e, i)))
      return t;
  }
  if (r.tagFilter) {
    const i = this.options.jPath ? n.toString() : n;
    if (!r.tagFilter(e, i))
      return t;
  }
  return this.entityDecoder.decode(t);
}
function Fi(t, e, n, r) {
  return t && (r === void 0 && (r = e.child.length === 0), t = this.parseTextData(
    t,
    e.tagname,
    n,
    !1,
    e[":@"] ? Object.keys(e[":@"]).length !== 0 : !1,
    r
  ), t !== void 0 && t !== "" && e.add(this.options.textNodeName, t), t = ""), t;
}
function Pi() {
  return this.stopNodeExpressionsSet.size === 0 ? !1 : this.matcher.matchesAny(this.stopNodeExpressionsSet);
}
function $i(t, e, n = ">") {
  let r = 0;
  const i = t.length, s = n.charCodeAt(0), a = n.length > 1 ? n.charCodeAt(1) : -1;
  let o = "", l = e;
  for (let d = e; d < i; d++) {
    const c = t.charCodeAt(d);
    if (r)
      c === r && (r = 0);
    else if (c === 34 || c === 39)
      r = c;
    else if (c === s)
      if (a !== -1) {
        if (t.charCodeAt(d + 1) === a)
          return o += t.substring(l, d), { data: o, index: d };
      } else
        return o += t.substring(l, d), { data: o, index: d };
    else c === 9 && !r && (o += t.substring(l, d) + " ", l = d + 1);
  }
}
function D(t, e, n, r) {
  const i = t.indexOf(e, n);
  if (i === -1)
    throw new Error(r);
  return i + e.length - 1;
}
function ji(t, e, n, r) {
  const i = t.indexOf(e, n);
  if (i === -1) throw new Error(r);
  return i;
}
function je(t, e, n, r = ">") {
  const i = $i(t, e + 1, r);
  if (!i) return;
  let s = i.data;
  const a = i.index, o = s.search(/\s/);
  let l = s, d = !0;
  o !== -1 && (l = s.substring(0, o), s = s.substring(o + 1).trimStart());
  const c = l;
  if (n) {
    const u = l.indexOf(":");
    u !== -1 && (l = l.substr(u + 1), d = l !== i.data.substr(u + 1));
  }
  return {
    tagName: l,
    tagExp: s,
    closeIndex: a,
    attrExpPresent: d,
    rawTagName: c
  };
}
function Ui(t, e, n) {
  const r = n;
  let i = 1;
  const s = t.length;
  for (; n < s; n++)
    if (t[n] === "<") {
      const a = t.charCodeAt(n + 1);
      if (a === 47) {
        const o = ji(t, ">", n, `${e} is not closed`);
        if (t.substring(n + 2, o).trim() === e && (i--, i === 0))
          return {
            tagContent: t.substring(r, n),
            i: o
          };
        n = o;
      } else if (a === 63)
        n = D(t, "?>", n + 1, "StopNode is not closed.");
      else if (a === 33 && t.charCodeAt(n + 2) === 45 && t.charCodeAt(n + 3) === 45)
        n = D(t, "-->", n + 3, "StopNode is not closed.");
      else if (a === 33 && t.charCodeAt(n + 2) === 91)
        n = D(t, "]]>", n, "StopNode is not closed.") - 2;
      else {
        const o = je(t, n, !1);
        o && ((o && o.tagName) === e && o.tagExp[o.tagExp.length - 1] !== "/" && i++, n = o.closeIndex);
      }
    }
}
function Ue(t, e, n) {
  if (e && typeof t == "string") {
    const r = t.trim();
    return r === "true" ? !0 : r === "false" ? !1 : ii(t, n);
  } else
    return wr(t) ? t : "";
}
function xe(t, e, n, r) {
  if (t) {
    const i = t(e);
    n === e && (n = i), e = i;
  }
  return e = dn(e, r), { tagName: e, tagExp: n };
}
function dn(t, e) {
  if (Jt.includes(t))
    throw new Error(`[SECURITY] Invalid name: "${t}" is a reserved JavaScript keyword that could cause prototype pollution`);
  return ze.includes(t) ? e.onDangerousProperty(t) : t;
}
const Ae = F.getMetaDataSymbol();
function Bi(t, e) {
  if (!t || typeof t != "object") return {};
  if (!e) return t;
  const n = {};
  for (const r in t)
    if (r.startsWith(e)) {
      const i = r.substring(e.length);
      n[i] = t[r];
    } else
      n[r] = t[r];
  return n;
}
function Vi(t, e, n, r) {
  return un(t, e, n, r);
}
function un(t, e, n, r) {
  let i;
  const s = {};
  for (let a = 0; a < t.length; a++) {
    const o = t[a], l = Wi(o);
    if (l !== void 0 && l !== e.textNodeName) {
      const d = Bi(
        o[":@"] || {},
        e.attributeNamePrefix
      );
      n.push(l, d);
    }
    if (l === e.textNodeName)
      i === void 0 ? i = o[l] : i += "" + o[l];
    else {
      if (l === void 0)
        continue;
      if (o[l]) {
        let d = un(o[l], e, n, r);
        const c = Hi(d, e);
        if (Object.keys(d).length === 0 && e.alwaysCreateTextNode && (d[e.textNodeName] = ""), o[":@"] ? Xi(d, o[":@"], r, e) : Object.keys(d).length === 1 && d[e.textNodeName] !== void 0 && !e.alwaysCreateTextNode ? d = d[e.textNodeName] : Object.keys(d).length === 0 && (e.alwaysCreateTextNode ? d[e.textNodeName] = "" : d = ""), o[Ae] !== void 0 && typeof d == "object" && d !== null && (d[Ae] = o[Ae]), s[l] !== void 0 && Object.prototype.hasOwnProperty.call(s, l))
          Array.isArray(s[l]) || (s[l] = [s[l]]), s[l].push(d);
        else {
          const u = e.jPath ? r.toString() : r;
          e.isArray(l, u, c) ? s[l] = [d] : s[l] = d;
        }
        l !== void 0 && l !== e.textNodeName && n.pop();
      }
    }
  }
  return typeof i == "string" ? i.length > 0 && (s[e.textNodeName] = i) : i !== void 0 && (s[e.textNodeName] = i), s;
}
function Wi(t) {
  const e = Object.keys(t);
  for (let n = 0; n < e.length; n++) {
    const r = e[n];
    if (r !== ":@") return r;
  }
}
function Xi(t, e, n, r) {
  if (e) {
    const i = Object.keys(e), s = i.length;
    for (let a = 0; a < s; a++) {
      const o = i[a], l = o.startsWith(r.attributeNamePrefix) ? o.substring(r.attributeNamePrefix.length) : o, d = r.jPath ? n.toString() + "." + l : n;
      r.isArray(o, d, !0, !0) ? t[o] = [e[o]] : t[o] = e[o];
    }
  }
}
function Hi(t, e) {
  const { textNodeName: n } = e, r = Object.keys(t).length;
  return !!(r === 0 || r === 1 && (t[n] || typeof t[n] == "boolean" || t[n] === 0));
}
class Yi {
  constructor(e) {
    this.externalEntities = {}, this.options = Vr(e);
  }
  /**
   * Parse XML dats to JS object 
   * @param {string|Uint8Array} xmlData 
   * @param {boolean|Object} validationOption 
   */
  parse(e, n) {
    if (typeof e != "string" && e.toString)
      e = e.toString();
    else if (typeof e != "string")
      throw new Error("XML data is accepted in String or Bytes[] form.");
    if (n) {
      n === !0 && (n = {});
      const s = Nr(e, n);
      if (s !== !0)
        throw Error(`${s.err.msg}:${s.err.line}:${s.err.col}`);
    }
    const r = new Ii(this.options, this.externalEntities), i = r.parseXml(e);
    return this.options.preserveOrder || i === void 0 ? i : Vi(i, this.options, r.matcher, r.readonlyMatcher);
  }
  /**
   * Add Entity which is not by default supported by this library
   * @param {string} key 
   * @param {string} value 
   */
  addEntity(e, n) {
    if (n.indexOf("&") !== -1)
      throw new Error("Entity value can't have '&'");
    if (e.indexOf("&") !== -1 || e.indexOf(";") !== -1)
      throw new Error("An entity must be set without '&' and ';'. Eg. use '#xD' for '&#xD;'");
    if (n === "&")
      throw new Error("An entity with value '&' is not permitted");
    this.externalEntities[e] = n;
  }
  /**
   * Returns a Symbol that can be used to access the metadata
   * property on a node.
   * 
   * If Symbol is not available in the environment, an ordinary property is used
   * and the name of the property is here returned.
   * 
   * The XMLMetaData property is only present when `captureMetaData`
   * is true in the options.
   */
  static getMetaDataSymbol() {
    return F.getMetaDataSymbol();
  }
}
function pn(t) {
  return t.map((e) => ({ ...e, slides: e.slides.filter((n) => n.length > 0) })).filter((e) => e.slides.length > 0).map((e) => {
    const n = e.slides.map((r) => r.join(`
`)).join(`

`);
    return e.label ? `[${e.label}]
${n}` : n;
  }).join(`

`);
}
function Ke(t) {
  var e, n;
  return {
    title: t.title.trim(),
    author: ((e = t.author) == null ? void 0 : e.trim()) || null,
    copyright: ((n = t.copyright) == null ? void 0 : n.trim()) || null,
    tags: t.tags ?? [],
    arrangement: t.arrangement ?? ye,
    themeId: null,
    lyrics: t.lyrics ?? ""
  };
}
const Nt = /^(author|copyright|tags|order|lines per slide):\s*(.*)$/i;
function qi(t, e) {
  var a;
  const n = t.replace(/^\uFEFF/, "").replace(/\r\n?/g, `
`).split(`
`);
  for (; n.length && n[0].trim() === ""; ) n.shift();
  const r = ((a = n.shift()) == null ? void 0 : a.trim()) || e, i = {}, s = { ...ye };
  for (let o = Nt.exec(n[0] ?? ""); o; o = Nt.exec(n[0] ?? "")) {
    n.shift();
    const [, l, d] = o;
    switch (l.toLowerCase()) {
      case "author":
        i.author = d;
        break;
      case "copyright":
        i.copyright = d;
        break;
      case "tags":
        i.tags = d.split(",").map((c) => c.trim()).filter(Boolean);
        break;
      case "order":
        s.order = d.split(",").map((c) => c.trim()).filter(Boolean);
        break;
      case "lines per slide": {
        const c = Number(d);
        Ut.includes(c) && (s.linesPerSlide = c);
        break;
      }
    }
  }
  return Ke({ ...i, title: r, arrangement: s, lyrics: n.join(`
`).trim() });
}
function Di(t) {
  const e = [
    t.author && `Author: ${t.author}`,
    t.copyright && `Copyright: ${t.copyright}`,
    t.tags.length > 0 && `Tags: ${t.tags.join(", ")}`,
    t.arrangement.order.length > 0 && `Order: ${t.arrangement.order.join(", ")}`,
    t.arrangement.linesPerSlide && `Lines per slide: ${t.arrangement.linesPerSlide}`
  ].filter(Boolean);
  return `${[t.title, ...e].join(`
`)}

${t.lyrics.replace(/\r\n?/g, `
`).trim()}
`;
}
const Gi = new Yi({
  preserveOrder: !0,
  ignoreAttributes: !1,
  trimValues: !1,
  // keep the spaces around inline tags in mixed content
  parseTagValue: !1,
  // a title like "1000" stays a string
  parseAttributeValue: !1,
  processEntities: !0,
  htmlEntities: !0
});
function Qe(t) {
  return Object.keys(t).find((e) => e !== ":@" && e !== "#text");
}
function k(t) {
  var e;
  return (e = Qe(t)) == null ? void 0 : e.replace(/^.*:/, "");
}
function se(t) {
  const e = t && Qe(t);
  return e ? t[e] : [];
}
function xt(t, e) {
  var n;
  return (n = t[":@"]) == null ? void 0 : n[`@_${e}`];
}
function C(t, e) {
  return se(t).find((n) => k(n) === e);
}
function pe(t, e) {
  return se(t).filter((n) => k(n) === e);
}
function $(t) {
  if (!t) return "";
  if ("#text" in t) return String(t["#text"]);
  const e = k(t);
  if (e === "br") return `
`;
  if (e === "comment" || e === "chord") return "";
  const n = se(t).map($).join("");
  return e === "line" ? `${n}
` : n;
}
function q(t) {
  return t.split(`
`).map((e) => e.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function zi(t) {
  const e = [], n = (r) => {
    if ("#text" in r) e.push(String(r["#text"]).replace(/\s+/g, " "));
    else if (k(r) === "br") e.push(`
`);
    else {
      if (k(r) === "comment" || k(r) === "chord") return;
      se(r).forEach(n), k(r) === "line" && e.push(`
`);
    }
  };
  return se(t).forEach(n), q(e.join(""));
}
function Ji(t) {
  return Gi.parse(t).find((n) => {
    var r;
    return k(n) !== void 0 && !((r = Qe(n)) != null && r.startsWith("?"));
  });
}
const Ki = {
  v: "Verse",
  c: "Chorus",
  b: "Bridge",
  p: "Pre-Chorus",
  i: "Intro",
  e: "Ending",
  o: "Other"
};
function At(t) {
  const e = /^([a-z])(\d*)([a-z]?)$/i.exec(t.trim()), n = e && Ki[e[1].toLowerCase()];
  if (!e || !n) return t.trim();
  const r = `${e[2]}${e[3]}`;
  return r ? `${n} ${r}` : n;
}
function Qi(t, e) {
  const n = C(t, "properties"), r = q($(C(C(n, "titles"), "title"))).join(" "), i = pe(C(n, "authors"), "author").filter((d) => xt(d, "type") !== "translation").map((d) => q($(d)).join(" ")).filter(Boolean), s = pe(C(n, "themes"), "theme").map((d) => q($(d)).join(" ")).filter(Boolean), a = $(C(n, "verseOrder")).split(/\s+/).filter(Boolean).map(At), o = /* @__PURE__ */ new Set(), l = [];
  for (const d of pe(C(t, "lyrics"), "verse")) {
    const c = xt(d, "name") ?? `o${l.length + 1}`;
    o.has(c) || (o.add(c), l.push({ label: At(c), slides: pe(d, "lines").map(zi) }));
  }
  return Ke({
    title: r || e,
    author: i.join(", "),
    copyright: q($(C(n, "copyright"))).join(" "),
    tags: [...new Set(s)],
    arrangement: { order: a, linesPerSlide: null },
    lyrics: pn(l)
  });
}
const Zi = {
  verse: "v",
  chorus: "c",
  bridge: "b",
  "pre-chorus": "p",
  prechorus: "p",
  intro: "i",
  ending: "e",
  outro: "e",
  other: "o"
};
function es(t, e) {
  const n = t ? /^([a-z-]+)\s*(\d*)([a-z]?)$/i.exec(t.trim()) : null, r = n ? Zi[n[1].toLowerCase()] : void 0, i = r ?? "o", s = n && r ? `${i}${n[2]}${n[3]}` : "";
  if (s && !e.has(s)) return s;
  let a = 1;
  for (; e.has(`${i}${a}`); ) a++;
  return `${i}${a}`;
}
const re = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function ts(t) {
  const e = /* @__PURE__ */ new Set(), n = /* @__PURE__ */ new Map(), r = Vt(t.lyrics).map((a) => {
    var c;
    const o = es(a.label, e);
    e.add(o);
    const l = (c = a.label) == null ? void 0 : c.toLowerCase();
    l && !n.has(l) && n.set(l, o);
    const d = a.chunks.map((u) => `      <lines>${u.lines.map(re).join("<br/>")}</lines>`);
    return `    <verse name="${o}">
${d.join(`
`)}
    </verse>`;
  }), i = t.arrangement.order.map((a) => n.get(a.trim().toLowerCase())).filter((a) => a !== void 0), s = [
    `    <titles>
      <title>${re(t.title)}</title>
    </titles>`,
    t.author && `    <authors>
${t.author.split(",").map((a) => a.trim()).filter(Boolean).map((a) => `      <author>${re(a)}</author>`).join(`
`)}
    </authors>`,
    t.copyright && `    <copyright>${re(t.copyright)}</copyright>`,
    i.length > 0 && `    <verseOrder>${i.join(" ")}</verseOrder>`,
    t.tags.length > 0 && `    <themes>
${t.tags.map((a) => `      <theme>${re(a)}</theme>`).join(`
`)}
    </themes>`
  ].filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9" createdIn="WorshipDeck" modifiedDate="${(/* @__PURE__ */ new Date()).toISOString()}">
  <properties>
${s.join(`
`)}
  </properties>
  <lyrics>
${r.join(`
`)}
  </lyrics>
</song>
`;
}
const ns = {
  V: "Verse",
  C: "Chorus",
  B: "Bridge",
  P: "Pre-Chorus",
  T: "Tag",
  I: "Intro",
  E: "Ending"
};
function hn(t) {
  const e = /^([A-Za-z])(\d*)$/.exec(t.trim()), n = e && ns[e[1].toUpperCase()];
  return !e || !n ? t.trim() : e[2] ? `${n} ${e[2]}` : n;
}
function rs(t) {
  const e = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map();
  let r = "", i = null;
  const s = (o) => {
    let l = e.get(o);
    return l || (l = { label: o ? hn(o) : null, slides: [[]] }, e.set(o, l), n.set(r, [...n.get(r) ?? [], o])), l;
  }, a = (o) => {
    const l = o !== null ? e.get(o) : void 0;
    l && l.slides[l.slides.length - 1].length > 0 && l.slides.push([]);
  };
  for (const o of t.replace(/\r\n?/g, `
`).split(`
`)) {
    const l = /^\s*\[([^\]]+)\]\s*$/.exec(o);
    if (l) {
      r = l[1].trim(), i = null;
      continue;
    }
    if (o.startsWith(".") || o.startsWith(";")) continue;
    const d = /^(\d)(.*)$/.exec(o), c = d && !/\d$/.test(r) ? `${r}${d[1]}` : r, u = (d ? d[2] : o).replace(/_/g, "");
    if (u.trim() === "") {
      a(d ? c : i);
      continue;
    }
    const p = s(c);
    i = c, u.split("||").forEach((y, E) => {
      E > 0 && a(c);
      for (const b of y.split("|")) {
        const I = b.replace(/\s+/g, " ").trim();
        I && p.slides[p.slides.length - 1].push(I);
      }
    });
  }
  return { sections: [...e.values()], groups: n };
}
function is(t, e) {
  const n = (o) => q($(C(t, o))).join(" "), { sections: r, groups: i } = rs($(C(t, "lyrics"))), s = n("presentation").split(/\s+/).filter(Boolean).flatMap((o) => (i.get(o) ?? [o]).map(hn)), a = ["theme", "alttheme"].flatMap((o) => n(o).split(/[;,]/)).map((o) => o.trim()).filter(Boolean);
  return Ke({
    title: n("title") || e,
    author: n("author"),
    copyright: n("copyright"),
    tags: [...new Set(a)],
    arrangement: { order: s, linesPerSlide: null },
    lyrics: pn(r)
  });
}
function ss(t, e) {
  let n;
  try {
    n = Ji(t.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Not valid XML");
  }
  if (!n || k(n) !== "song") throw new Error("Not an OpenLyrics or OpenSong song");
  if (C(n, "properties")) return { format: "openlyrics", song: Qi(n, e) };
  if (C(n, "lyrics")) return { format: "opensong", song: is(n, e) };
  throw new Error("Not an OpenLyrics or OpenSong song");
}
const _t = 2e3, os = 5 * 1024 * 1024, as = /* @__PURE__ */ new Set([".txt", ".xml", ""]);
async function ls(t, e) {
  const n = [];
  for (const r of t)
    try {
      if ((await He(r)).isDirectory()) {
        const i = await xn(r, { withFileTypes: !0 });
        for (const s of i.sort((a, o) => a.name.localeCompare(o.name)))
          !s.isFile() || s.name.startsWith(".") || as.has(g.extname(s.name).toLowerCase()) && n.push({ file: g.join(r, s.name), source: `${g.basename(r)}/${s.name}` });
      } else
        n.push({ file: r, source: g.basename(r) });
    } catch (i) {
      e.push({ source: g.basename(r), error: i instanceof Error ? i.message : String(i) });
    }
  return n;
}
async function cs(t) {
  const { size: e } = await He(t.file);
  if (e > os) throw new Error("File is larger than 5 MB");
  const n = (await Ft(t.file, "utf8")).replace(/^\uFEFF/, ""), r = g.extname(t.file).toLowerCase(), i = g.basename(t.file, r);
  if (r === ".txt") return { source: t.source, format: "text", song: qi(n, i) };
  if (!n.trimStart().startsWith("<")) throw new Error("Not a text, OpenLyrics or OpenSong song");
  return { source: t.source, ...ss(n, i) };
}
async function _e(t) {
  const e = [], n = await ls(t, e);
  if (n.length > _t)
    return { songs: [], problems: [{ source: `${n.length} files`, error: `Pick at most ${_t} files at a time` }] };
  const r = (o) => o.trim().toLowerCase(), i = new Set(Ye().map((o) => r(o.title))), s = /* @__PURE__ */ new Set(), a = [];
  for (const o of n)
    try {
      const l = await cs(o);
      if (!l.song.title) throw new Error("No title found");
      const d = r(l.song.title);
      a.push({ ...l, duplicateOf: i.has(d) ? "library" : s.has(d) ? "import" : null }), s.add(d);
    } catch (l) {
      e.push({ source: o.source, error: l instanceof Error ? l.message : String(l) });
    }
  return { songs: a, problems: e };
}
function Be(t, e, n) {
  const r = [...t].filter((s) => s.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(s)).join("").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
  let i = `${r}${e}`;
  for (let s = 2; n.has(i.toLowerCase()); s++) i = `${r} (${s})${e}`;
  return n.add(i.toLowerCase()), i;
}
function ds(t) {
  return (t ?? Ye().map((n) => n.id)).map((n) => Ht(n)).filter((n) => n !== void 0);
}
const me = { openlyrics: ".xml", text: ".txt" };
function us(t, e) {
  return Be(t.title, me[e], /* @__PURE__ */ new Set());
}
function fn(t, e) {
  return e === "openlyrics" ? ts(t) : Di(t);
}
async function ps(t, e, n) {
  await Xe(n, fn(t, e), "utf8");
}
async function hs(t, e, n) {
  const r = /* @__PURE__ */ new Set();
  for (const i of t) {
    let s = Be(i.title, me[e], r);
    for (; In(g.join(n, s)); ) s = Be(i.title, me[e], r);
    await Xe(g.join(n, s), fn(i, e), "utf8");
  }
  return t.length;
}
const It = ["openlyrics", "text"], fs = [
  { name: "Songs (text, OpenLyrics, OpenSong)", extensions: ["txt", "xml"] },
  // OpenSong song files usually have no extension.
  { name: "All files", extensions: ["*"] }
];
function Ie(t) {
  return le.fromWebContents(t.sender) ?? void 0;
}
function gs(t) {
  if (!Array.isArray(t) || t.length === 0 || !t.every((e) => typeof e == "string" && g.isAbsolute(e)))
    throw new TypeError("Paths must be a non-empty list of absolute paths");
  return t;
}
function ms(t) {
  if (t === null) return null;
  if (!Array.isArray(t) || !t.every((e) => Number.isInteger(e) && e > 0))
    throw new TypeError("Song ids must be a list of positive integers, or null for every song");
  return t;
}
function Es(t) {
  if (!It.includes(t))
    throw new TypeError(`Export format must be one of ${It.join(", ")}`);
  return t;
}
function ys() {
  m.handle("songFiles:pickFiles", async (t) => {
    const e = {
      title: "Import songs",
      properties: ["openFile", "multiSelections"],
      filters: fs
    }, n = Ie(t), { canceled: r, filePaths: i } = n ? await v.showOpenDialog(n, e) : await v.showOpenDialog(e);
    return r || i.length === 0 ? null : _e(i);
  }), m.handle("songFiles:pickFolder", async (t) => {
    const e = { title: "Import a folder of songs", properties: ["openDirectory"] }, n = Ie(t), { canceled: r, filePaths: i } = n ? await v.showOpenDialog(n, e) : await v.showOpenDialog(e);
    return r || i.length === 0 ? null : _e(i);
  }), m.handle("songFiles:scan", (t, e) => _e(gs(e))), m.handle("songFiles:import", (t, e) => {
    if (!Array.isArray(e)) throw new TypeError("Songs must be a list");
    return Dn(e.map(Me));
  }), m.handle(
    "songFiles:export",
    async (t, e, n) => {
      const r = ms(e), i = Es(n), s = ds(r);
      if (s.length === 0) throw new Error("There are no songs to export");
      const a = Ie(t);
      if (s.length === 1 && r !== null) {
        const c = {
          title: "Export song",
          defaultPath: us(s[0], i),
          filters: [{ name: i === "openlyrics" ? "OpenLyrics XML" : "Text", extensions: [me[i].slice(1)] }]
        }, { canceled: u, filePath: p } = a ? await v.showSaveDialog(a, c) : await v.showSaveDialog(c);
        return u || !p ? null : (await ps(s[0], i, p), { written: 1, location: p });
      }
      const o = {
        title: `Choose a folder for ${s.length} songs`,
        buttonLabel: "Export here",
        properties: ["openDirectory", "createDirectory"]
      }, { canceled: l, filePaths: d } = a ? await v.showOpenDialog(a, o) : await v.showOpenDialog(o);
      return l || d.length === 0 ? null : { written: await hs(s, i, d[0]), location: d[0] };
    }
  );
}
function Ce(t) {
  if (!Number.isInteger(t) || t < 1) throw new TypeError("Theme id must be a positive integer");
  return t;
}
function Ct(t) {
  if (typeof t != "string" || t.trim() === "") throw new TypeError("Theme needs a non-empty name");
  return t.trim();
}
function Ts(t) {
  if (!ve.includes(t))
    throw new TypeError(`Content type must be one of ${ve.join(", ")}`);
  return t;
}
function bs() {
  m.handle("themes:list", () => Pn()), m.handle(
    "themes:create",
    (t, e, n) => $n(Ct(e), X(n))
  ), m.handle(
    "themes:update",
    (t, e, n, r) => jn(Ce(e), Ct(n), X(r))
  ), m.handle("themes:delete", (t, e) => Un(Ce(e))), m.handle("themes:getDefaults", () => Bn()), m.handle(
    "themes:setDefault",
    (t, e, n) => Vn(Ts(e), Ce(n))
  );
}
const Ze = "wd-media", z = () => g.join(G.getPath("userData"), "media");
function ws() {
  kt.registerSchemesAsPrivileged([
    { scheme: Ze, privileges: { standard: !0, secure: !0, supportFetchAPI: !0, stream: !0, corsEnabled: !0 } }
  ]);
}
function Ss() {
  kt.handle(Ze, async (t) => {
    const e = decodeURIComponent(new URL(t.url).pathname.replace(/^\//, ""));
    if (!e || e !== g.basename(e) || e.startsWith(".")) return new Response("Not found", { status: 404 });
    const n = await bn.fetch(wn(g.join(z(), e)).toString(), { headers: t.headers }), r = new Headers(n.headers);
    return r.set("Access-Control-Allow-Origin", "*"), new Response(n.body, { status: n.status, statusText: n.statusText, headers: r });
  });
}
const oe = (t) => `${Ze}://local/${encodeURIComponent(t)}`;
function gn(t, e) {
  const n = t.replace(/[^\w.-]+/g, "-").slice(0, 60) || "media";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${n}${e}`;
}
async function Lt(t) {
  await Pt(z(), { recursive: !0 });
  const e = g.extname(t).toLowerCase(), n = gn(g.basename(t, g.extname(t)), e);
  return await An(t, g.join(z(), n)), n;
}
async function Ot(t, e, n) {
  await Pt(z(), { recursive: !0 });
  const r = gn(e, n);
  return await Xe(g.join(z(), r), t), r;
}
async function Le(t) {
  t && t === g.basename(t) && await _n(g.join(z(), t), { force: !0 });
}
function et(t) {
  let e = [];
  try {
    e = JSON.parse(t.tags);
  } catch {
  }
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    url: oe(t.file),
    thumbUrl: t.thumb ? oe(t.thumb) : null,
    tags: Array.isArray(e) ? e.filter((n) => typeof n == "string") : []
  };
}
const mn = "SELECT id, name, kind, file, thumb, tags FROM media";
function Ns() {
  return h.prepare(`${mn} ORDER BY id DESC`).all().map(et);
}
function tt(t) {
  return h.prepare(`${mn} WHERE id = ?`).get(t);
}
function Ve(t) {
  const e = tt(t);
  return e && et(e);
}
function xs(t, e, n) {
  const r = h.prepare("INSERT INTO media (name, kind, file) VALUES (?, ?, ?)").run(t, e, n);
  return Ve(Number(r.lastInsertRowid));
}
function As(t, e, n) {
  return h.prepare("UPDATE media SET name = ?, tags = ? WHERE id = ?").run(e, JSON.stringify(n), t).changes > 0;
}
function _s(t, e) {
  const n = tt(t);
  if (n)
    return h.prepare("UPDATE media SET thumb = ? WHERE id = ?").run(e, t), n.thumb;
}
const Is = h.transaction((t) => {
  var s;
  const e = tt(t);
  if (!e) return;
  const n = oe(e.file), r = h.prepare("SELECT id, json FROM themes WHERE type = 'custom'").all(), i = h.prepare("UPDATE themes SET json = ? WHERE id = ?");
  for (const a of r)
    try {
      const o = JSON.parse(a.json);
      ((s = o == null ? void 0 : o.background) == null ? void 0 : s.src) === n && i.run(JSON.stringify({ ...o, background: { kind: "solid", color: "#000000" } }), a.id);
    } catch {
    }
  return h.prepare("DELETE FROM media WHERE id = ?").run(t), e;
});
function Cs(t) {
  const e = h.prepare(
    `SELECT b.slide_index, m.id, m.name, m.kind, m.file, m.thumb, m.tags
       FROM slide_backgrounds b JOIN media m ON m.id = b.media_id
       WHERE b.deck_key = ?`
  ).all(t);
  return Object.fromEntries(e.map((n) => [n.slide_index, et(n)]));
}
function Ls(t, e, n) {
  if (n === null) {
    h.prepare("DELETE FROM slide_backgrounds WHERE deck_key = ? AND slide_index = ?").run(t, e);
    return;
  }
  h.prepare(
    `INSERT INTO slide_backgrounds (deck_key, slide_index, media_id) VALUES (?, ?, ?)
     ON CONFLICT (deck_key, slide_index) DO UPDATE SET media_id = excluded.media_id`
  ).run(t, e, n);
}
const H = ["jpg", "jpeg", "png", "webp", "gif"], Oe = ["mp4", "webm"], Os = 200 * 1024 * 1024, Rs = 20 * 1024 * 1024;
async function Rt(t, e) {
  const n = le.fromWebContents(t.sender), { canceled: r, filePaths: i } = n ? await v.showOpenDialog(n, e) : await v.showOpenDialog(e);
  return r ? [] : i;
}
const Re = (t) => g.extname(t).slice(1).toLowerCase();
function he(t, e = "Media id") {
  if (!Number.isInteger(t) || t < 1) throw new TypeError(`${e} must be a positive integer`);
  return t;
}
function vt(t) {
  if (typeof t != "string" || !/^(song|item|scripture):.+/.test(t) || t.length > 300)
    throw new TypeError("Deck key must look like song:<id>, item:<id> or scripture:<reference>");
  return t;
}
function Mt(t) {
  if (!(t instanceof Uint8Array) || t.length === 0 || t.length > Rs)
    throw new TypeError("Expected image bytes up to 20 MB");
  return t;
}
function vs() {
  m.handle("media:list", () => Ns()), m.handle("media:import", async (t) => {
    const e = await Rt(t, {
      title: "Import backgrounds",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images and videos", extensions: [...H, ...Oe] },
        { name: "Images", extensions: H },
        { name: "Videos (MP4, WebM)", extensions: Oe }
      ]
    }), n = [];
    for (const r of e) {
      const i = Re(r), s = Oe.includes(i) ? "video" : H.includes(i) ? "image" : null;
      s && n.push(xs(g.basename(r, g.extname(r)), s, await Lt(r)));
    }
    return n;
  }), m.handle("media:update", (t, e, n, r) => {
    if (typeof n != "string" || !n.trim()) throw new TypeError("Media needs a name");
    if (!Array.isArray(r) || !r.every((s) => typeof s == "string")) throw new TypeError("Tags must be strings");
    const i = [...new Set(r.map((s) => s.trim()).filter(Boolean))];
    return As(he(e), n.trim(), i);
  }), m.handle("media:delete", async (t, e) => {
    const n = Is(he(e));
    return n ? (await Le(n.file), await Le(n.thumb), !0) : !1;
  }), m.handle("media:saveThumbnail", async (t, e, n) => {
    const r = he(e);
    if (!Ve(r)) return;
    const i = await Ot(Mt(n), `thumb-${r}`, ".jpg");
    return await Le(_s(r, i) ?? null), Ve(r);
  }), m.handle("media:getSlideBackgrounds", (t, e) => Cs(vt(e))), m.handle("media:setSlideBackground", (t, e, n, r) => {
    if (!Number.isInteger(n) || n < 0) throw new TypeError("Slide index must be 0 or more");
    Ls(vt(e), n, r === null ? null : he(r));
  }), m.handle("media:pickPresentation", async (t) => {
    const e = await Rt(t, {
      title: "Choose images or a PDF",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images or PDF", extensions: [...H, "pdf"] },
        { name: "PDF", extensions: ["pdf"] },
        { name: "Images", extensions: H }
      ]
    });
    if (e.length === 0) return null;
    const n = e.find((a) => Re(a) === "pdf");
    if (n) {
      if (e.length > 1) throw new Error("Choose one PDF, or images only");
      if ((await He(n)).size > Os) throw new Error("The PDF is larger than 200 MB");
      return { kind: "pdf", title: g.basename(n, g.extname(n)), data: new Uint8Array(await Ft(n)) };
    }
    const r = e.filter((a) => H.includes(Re(a))).sort((a, o) => a.localeCompare(o, void 0, { numeric: !0 }));
    if (r.length === 0) throw new Error("Choose images or a PDF");
    const i = [];
    for (const a of r) i.push(oe(await Lt(a)));
    return { kind: "images", title: r.length === 1 ? g.basename(r[0], g.extname(r[0])) : g.basename(g.dirname(r[0])), pages: i };
  }), m.handle("media:saveImage", async (t, e) => oe(await Ot(Mt(e), "page", ".png")));
}
const Ms = { fadeMs: 400 }, Ee = { min: 0, max: 1500 };
function En() {
  const t = h.prepare("SELECT value FROM settings WHERE key = 'output.fadeMs'").get(), e = Number(t == null ? void 0 : t.value);
  return {
    fadeMs: Number.isFinite(e) ? Math.min(Ee.max, Math.max(Ee.min, e)) : Ms.fadeMs
  };
}
function ks(t) {
  if (t.fadeMs !== void 0) {
    const e = Math.round(Math.min(Ee.max, Math.max(Ee.min, t.fadeMs)));
    h.prepare(
      "INSERT INTO settings (key, value) VALUES ('output.fadeMs', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
    ).run(String(e));
  }
  return En();
}
function Fs() {
  m.handle("settings:get", () => En()), m.handle("settings:set", (t, e) => {
    const n = e == null ? void 0 : e.fadeMs;
    if (n !== void 0 && (typeof n != "number" || !Number.isFinite(n)))
      throw new TypeError("fadeMs must be a number of milliseconds");
    return ks({ fadeMs: n });
  });
}
const Ps = ["show", "black", "clear", "logo"];
let We = { mode: "black", text: "", caption: "", theme: M, fadeMs: 400 };
function $s(t) {
  const e = t;
  if (typeof e != "object" || e === null || !Ps.includes(e.mode) || typeof e.text != "string" || typeof e.caption != "string" || typeof e.theme != "object" || typeof e.fadeMs != "number" || !Number.isFinite(e.fadeMs))
    throw new TypeError("Output state needs a mode, text, caption, theme and fade length");
  return {
    mode: e.mode,
    text: e.text,
    caption: e.caption,
    theme: X(e.theme),
    fadeMs: Math.min(1500, Math.max(0, e.fadeMs))
  };
}
function js(t) {
  m.on("output:send", (e, n) => {
    var r;
    try {
      We = $s(n);
    } catch (i) {
      console.error(i);
      return;
    }
    (r = t()) == null || r.webContents.send("output:state", We);
  });
}
function Us(t) {
  t.webContents.send("output:state", We);
}
const nt = g.dirname(Sn(import.meta.url));
process.env.APP_ROOT = g.join(nt, "..");
const ae = process.env.VITE_DEV_SERVER_URL, qs = g.join(process.env.APP_ROOT, "dist-electron"), rt = g.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = ae ? g.join(process.env.APP_ROOT, "public") : rt;
ws();
let R, L = null;
function yn() {
  R = new le({
    icon: g.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: g.join(nt, "preload.mjs")
    }
  }), R.webContents.on("did-finish-load", () => {
    R == null || R.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), ae ? R.loadURL(ae) : R.loadFile(g.join(rt, "index.html")), R.on("closed", () => {
    R = null, L == null || L.close();
  });
}
function Tn() {
  const t = st.getPrimaryDisplay().id, e = st.getAllDisplays().find((n) => n.id !== t);
  L = new le({
    title: "WorshipDeck Output",
    backgroundColor: "#000",
    ...e ? { ...e.bounds, fullscreen: !0, frame: !1 } : { width: 960, height: 540, resizable: !0 },
    webPreferences: {
      preload: g.join(nt, "preload.mjs")
    }
  }), L.webContents.on("did-finish-load", () => {
    L && Us(L);
  }), L.on("closed", () => {
    L = null;
  }), ae ? L.loadURL(`${ae}#/output`) : L.loadFile(g.join(rt, "index.html"), { hash: "/output" });
}
G.on("window-all-closed", () => {
  process.platform !== "darwin" && (G.quit(), R = null);
});
G.on("activate", () => {
  le.getAllWindows().length === 0 && (yn(), Tn());
});
G.whenReady().then(() => {
  Fn(), Ss(), Jn(), tr(), mr(), ys(), bs(), vs(), Fs(), js(() => L), yn(), Tn();
});
export {
  qs as MAIN_DIST,
  rt as RENDERER_DIST,
  ae as VITE_DEV_SERVER_URL
};
