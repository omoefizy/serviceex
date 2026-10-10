import { app as at, ipcMain as R, dialog as fe, BrowserWindow as ct, protocol as Qo, net as Zo, screen as mr, safeStorage as _r } from "electron";
import { pathToFileURL as zl, fileURLToPath as Xl } from "node:url";
import O from "node:path";
import Kl from "better-sqlite3";
import { writeFile as Ir, stat as Xs, readdir as ec, readFile as Ks, mkdir as Ys, copyFile as Yl, rm as Js } from "node:fs/promises";
import { existsSync as tc } from "node:fs";
function Jl(r) {
  r.pragma("foreign_keys = ON"), r.exec(`
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
  `), Dt(r, "service_items", "payload", "TEXT"), Dt(r, "songs", "copyright", "TEXT"), Dt(r, "songs", "tags", "TEXT"), Dt(r, "songs", "arrangement", "TEXT"), Dt(r, "songs", "theme_id", "INTEGER");
}
function Dt(r, t, e, n) {
  r.prepare(`PRAGMA table_info(${t})`).all().some((i) => i.name === e) || r.exec(`ALTER TABLE ${t} ADD COLUMN ${e} ${n}`);
}
const Gl = O.join(at.getPath("userData"), "worshipdeck.db"), k = new Kl(Gl);
k.pragma("journal_mode = WAL");
Jl(k);
const Ql = "'Helvetica Neue', Inter, 'Segoe UI', Arial, sans-serif", Si = "Georgia, 'Times New Roman', serif", xe = {
  fontFamily: Ql,
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
}, Ht = (r) => ({ ...xe, ...r }), Zl = [
  { name: "Classic Black", style: xe },
  {
    name: "Deep Blue Gradient",
    style: Ht({
      fontWeight: 700,
      background: { kind: "gradient", from: "#0b1d4d", to: "#1f5fbf", angle: 160 },
      shadow: { enabled: !0, color: "#020617", blur: 0.18, offset: 0.05 },
      caption: { ...xe.caption, color: "#c7d7f5" }
    })
  },
  {
    name: "Warm Sunset",
    style: Ht({
      fontWeight: 700,
      background: { kind: "gradient", from: "#f59e0b", to: "#7c2d12", angle: 135 },
      overlay: 0.15,
      shadow: { enabled: !0, color: "#3b0d02", blur: 0.2, offset: 0.05 },
      caption: { ...xe.caption, color: "#ffe7c2" }
    })
  },
  {
    name: "Minimal White",
    style: Ht({
      fontWeight: 500,
      color: "#111111",
      shadow: { ...xe.shadow, enabled: !1 },
      background: { kind: "solid", color: "#ffffff" },
      caption: { ...xe.caption, color: "#666666" }
    })
  },
  {
    // Chroma green behind an opaque band at the bottom: key the green out in OBS or a video switcher.
    name: "Lower Third",
    style: Ht({
      fontWeight: 600,
      align: "left",
      lineHeight: 1.2,
      margins: { top: 72, right: 0, bottom: 0, left: 0 },
      band: { enabled: !0, color: "#0b0f1a", opacity: 1 },
      background: { kind: "solid", color: "#00b140" },
      shadow: { ...xe.shadow, enabled: !1 },
      caption: { ...xe.caption, size: 2.8 }
    })
  },
  {
    name: "Scripture Serif",
    style: Ht({
      fontFamily: Si,
      fontWeight: 400,
      align: "left",
      lineHeight: 1.45,
      color: "#f4efe6",
      margins: { top: 8, right: 8, bottom: 8, left: 8 },
      background: { kind: "gradient", from: "#1c1712", to: "#0d0b09", angle: 180 },
      shadow: { enabled: !0, color: "#000000", blur: 0.1, offset: 0.03 },
      caption: { fontFamily: Si, fontWeight: 400, size: 3.4, color: "#d6b98c", textCase: "normal", italic: !0 }
    })
  }
], ed = {
  song: "Classic Black",
  scripture: "Scripture Serif",
  announcement: "Deep Blue Gradient"
}, Ss = ["song", "scripture", "announcement"], Ze = (r) => typeof r == "object" && r !== null && !Array.isArray(r) ? r : {}, ki = (r, t) => typeof r == "string" ? r : t, We = (r, t) => typeof r == "string" && /^#[0-9a-f]{6}$/i.test(r) ? r.toLowerCase() : t, On = (r, t) => typeof r == "boolean" ? r : t, Z = (r, t, e, n) => typeof r == "number" && Number.isFinite(r) ? Math.min(n, Math.max(e, r)) : t, qt = (r, t, e) => t.includes(r) ? r : e, vi = ["normal", "upper", "lower"];
function td(r, t) {
  const e = Ze(r);
  switch (e.kind) {
    case "solid":
      return { kind: "solid", color: We(e.color, "#000000") };
    case "gradient":
      return { kind: "gradient", from: We(e.from, "#000000"), to: We(e.to, "#333333"), angle: Z(e.angle, 180, 0, 360) };
    case "image":
      return typeof e.src != "string" || !e.src ? { kind: "solid", color: "#000000" } : e.fit === "contain" ? { kind: "image", src: e.src, fit: "contain" } : { kind: "image", src: e.src };
    case "video":
      return typeof e.src == "string" && e.src ? { kind: "video", src: e.src } : { kind: "solid", color: "#000000" };
    default:
      return t;
  }
}
function ot(r) {
  const t = xe, e = Ze(r), n = Ze(e.shadow), s = Ze(e.outline), i = Ze(e.margins), a = Ze(e.band), o = Ze(e.caption);
  return {
    fontFamily: ki(e.fontFamily, t.fontFamily).trim() || t.fontFamily,
    fontWeight: Math.round(Z(e.fontWeight, t.fontWeight, 100, 900) / 100) * 100,
    sizeMode: qt(e.sizeMode, ["auto", "fixed"], t.sizeMode),
    fontSize: Z(e.fontSize, t.fontSize, 1, 30),
    color: We(e.color, t.color),
    align: qt(e.align, ["left", "center", "right"], t.align),
    verticalAlign: qt(e.verticalAlign, ["top", "middle", "bottom"], t.verticalAlign),
    lineHeight: Z(e.lineHeight, t.lineHeight, 0.8, 2.5),
    textCase: qt(e.textCase, vi, t.textCase),
    shadow: {
      enabled: On(n.enabled, t.shadow.enabled),
      color: We(n.color, t.shadow.color),
      blur: Z(n.blur, t.shadow.blur, 0, 1),
      offset: Z(n.offset, t.shadow.offset, 0, 0.5)
    },
    outline: {
      enabled: On(s.enabled, t.outline.enabled),
      color: We(s.color, t.outline.color),
      width: Z(s.width, t.outline.width, 0, 0.2)
    },
    margins: {
      top: Z(i.top, t.margins.top, 0, 90),
      right: Z(i.right, t.margins.right, 0, 45),
      bottom: Z(i.bottom, t.margins.bottom, 0, 90),
      left: Z(i.left, t.margins.left, 0, 45)
    },
    band: {
      enabled: On(a.enabled, t.band.enabled),
      color: We(a.color, t.band.color),
      opacity: Z(a.opacity, t.band.opacity, 0, 1)
    },
    background: td(e.background, t.background),
    overlay: Z(e.overlay, t.overlay, 0, 1),
    caption: {
      fontFamily: ki(o.fontFamily, t.caption.fontFamily).trim(),
      fontWeight: Math.round(Z(o.fontWeight, t.caption.fontWeight, 100, 900) / 100) * 100,
      size: Z(o.size, t.caption.size, 1, 15),
      color: We(o.color, t.caption.color),
      textCase: qt(o.textCase, vi, t.caption.textCase),
      italic: On(o.italic, t.caption.italic)
    }
  };
}
function nc(r) {
  try {
    return ot(JSON.parse(r));
  } catch {
    return ot(null);
  }
}
const nd = (r) => ({ id: r.id, name: r.name, type: r.type, style: nc(r.json) }), rd = k.transaction(() => {
  const r = k.prepare("SELECT id FROM themes WHERE type = 'builtin' AND name = ?"), t = k.prepare("INSERT INTO themes (name, type, json) VALUES (?, 'builtin', ?)"), e = k.prepare("UPDATE themes SET json = ? WHERE id = ?");
  for (const { name: n, style: s } of Zl) {
    const i = r.get(n);
    i ? e.run(JSON.stringify(s), i.id) : t.run(n, JSON.stringify(s));
  }
});
function sd() {
  return k.prepare("SELECT id, name, type, json FROM themes ORDER BY type = 'custom', id").all().map(
    nd
  );
}
function id(r, t) {
  const e = JSON.stringify(ot(t)), n = k.prepare("INSERT INTO themes (name, type, json) VALUES (?, 'custom', ?)").run(r, e);
  return { id: Number(n.lastInsertRowid), name: r, type: "custom", style: nc(e) };
}
function ad(r, t, e) {
  return k.prepare("UPDATE themes SET name = ?, json = ? WHERE id = ? AND type = 'custom'").run(t, JSON.stringify(ot(e)), r).changes > 0;
}
const od = k.transaction((r) => k.prepare("DELETE FROM themes WHERE id = ? AND type = 'custom'").run(r).changes === 0 ? !1 : (k.prepare("UPDATE songs SET theme_id = NULL WHERE theme_id = ?").run(r), k.prepare("DELETE FROM settings WHERE key LIKE 'theme.default.%' AND value = ?").run(String(r)), !0)), rc = (r) => `theme.default.${r}`;
function cd() {
  var s;
  const r = k.prepare("SELECT 1 FROM themes WHERE id = ?"), t = k.prepare("SELECT id FROM themes WHERE type = 'builtin' AND name = ?"), e = k.prepare("SELECT value FROM settings WHERE key = ?"), n = {};
  for (const i of Ss) {
    const a = Number((s = e.get(rc(i))) == null ? void 0 : s.value);
    n[i] = Number.isInteger(a) && r.get(a) ? a : t.get(ed[i]).id;
  }
  return n;
}
function ld(r, t) {
  if (!k.prepare("SELECT 1 FROM themes WHERE id = ?").get(t)) throw new Error(`Theme ${t} does not exist`);
  k.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(
    rc(r),
    String(t)
  );
}
const Nr = { order: [], linesPerSlide: null }, sc = [2, 3, 4], dd = /^\s*\[([^\]]+)\]\s*$/;
function ic(r) {
  const t = r;
  return typeof t == "object" && t !== null && Array.isArray(t.order) && t.order.every((e) => typeof e == "string") && (t.linesPerSlide === null || sc.includes(t.linesPerSlide));
}
function ac(r) {
  const t = r.replace(/\r\n?/g, `
`).split(`
`), e = [];
  let n = null, s = null;
  for (let i = 0; i < t.length; i++) {
    const a = t[i], o = dd.exec(a);
    if ((o || a.trim() === "") && (s && n && (s.endLine = i, n.chunks.push(s)), s = null), o) {
      n && (n.endLine = i), n = { label: o[1].trim(), labelLine: i, startLine: i, endLine: t.length, chunks: [] }, e.push(n);
      continue;
    }
    a.trim() !== "" && (n || (n = { label: null, labelLine: null, startLine: 0, endLine: t.length, chunks: [] }, e.push(n)), s ?? (s = { startLine: i, endLine: i + 1, lines: [] }), s.lines.push(a.trim()));
  }
  return s && n && (s.endLine = t.length, n.chunks.push(s)), e;
}
function ud(r, t) {
  if (t === null || r.length <= t) return [r];
  const e = Math.ceil(r.length / t), n = [];
  let s = 0;
  for (let i = 0; i < e; i++) {
    const a = Math.floor(r.length / e) + (i < r.length % e ? 1 : 0);
    n.push(r.slice(s, s + a)), s += a;
  }
  return n;
}
function Ti(r, t) {
  return r.chunks.flatMap((e) => ud(e.lines, t)).map((e) => ({ text: e.join(`
`), label: r.label }));
}
function hd(r, t) {
  const e = t.trim().toLowerCase();
  return r.find((n) => {
    var s;
    return ((s = n.label) == null ? void 0 : s.toLowerCase()) === e;
  });
}
function fd(r, t = Nr) {
  const e = ac(r);
  return t.order.length === 0 ? e.flatMap((n) => Ti(n, t.linesPerSlide)) : t.order.flatMap((n) => {
    const s = hd(e, n);
    return s ? Ti(s, t.linesPerSlide) : [];
  });
}
function xi(r) {
  if (r === null) return null;
  try {
    return JSON.parse(r);
  } catch {
    return null;
  }
}
function pd(r) {
  const t = xi(r.tags), e = xi(r.arrangement);
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    copyright: r.copyright,
    tags: Array.isArray(t) ? t.filter((n) => typeof n == "string") : [],
    arrangement: ic(e) ? e : Nr,
    themeId: r.theme_id,
    lyrics: r.lyrics ?? ""
  };
}
function oc(r, t, e) {
  k.prepare("DELETE FROM slides WHERE song_id = ?").run(r);
  const n = k.prepare("INSERT INTO slides (song_id, order_index, text) VALUES (?, ?, ?)");
  fd(t, e).forEach((s, i) => n.run(r, i, s.text));
}
function cc(r) {
  return {
    title: r.title,
    author: r.author,
    copyright: r.copyright,
    tags: JSON.stringify(r.tags),
    arrangement: JSON.stringify(r.arrangement),
    theme_id: r.themeId,
    lyrics: r.lyrics
  };
}
function Gs(r) {
  const t = r == null ? void 0 : r.trim();
  if (!t)
    return k.prepare("SELECT id, title, author FROM songs ORDER BY title COLLATE NOCASE").all();
  const e = `%${t.replace(/[\\%_]/g, (n) => `\\${n}`)}%`;
  return k.prepare(
    `SELECT id, title, author FROM songs
       WHERE title LIKE @pattern ESCAPE '\\'
          OR author LIKE @pattern ESCAPE '\\'
          OR tags LIKE @pattern ESCAPE '\\'
          OR lyrics LIKE @pattern ESCAPE '\\'
       ORDER BY title COLLATE NOCASE`
  ).all({ pattern: e });
}
function lc(r) {
  const t = k.prepare("SELECT id, title, author, copyright, tags, arrangement, theme_id, lyrics FROM songs WHERE id = ?").get(r);
  return t && pd(t);
}
const dc = k.transaction((r) => {
  const t = k.prepare(
    `INSERT INTO songs (title, author, copyright, tags, arrangement, theme_id, lyrics)
       VALUES (@title, @author, @copyright, @tags, @arrangement, @theme_id, @lyrics)`
  ).run(cc(r)), e = Number(t.lastInsertRowid);
  return oc(e, r.lyrics, r.arrangement), { id: e, ...r };
}), gd = k.transaction((r) => (r.forEach((t) => dc(t)), r.length)), md = k.transaction((r, t) => k.prepare(
  `UPDATE songs SET title = @title, author = @author, copyright = @copyright, tags = @tags,
         arrangement = @arrangement, theme_id = @theme_id, lyrics = @lyrics
       WHERE id = @id`
).run({ ...cc(t), id: r }).changes === 0 ? !1 : (oc(r, t.lyrics, t.arrangement), !0));
function _d(r) {
  return k.prepare("DELETE FROM songs WHERE id = ?").run(r).changes > 0;
}
function Cr(r) {
  if (!Number.isInteger(r) || r < 1)
    throw new TypeError("Song id must be a positive integer");
  return r;
}
function ks(r) {
  const t = r;
  if (typeof t != "object" || t === null || typeof t.title != "string" || t.title.trim() === "" || t.author !== null && typeof t.author != "string" || t.copyright !== null && typeof t.copyright != "string" || !Array.isArray(t.tags) || !t.tags.every((e) => typeof e == "string") || !ic(t.arrangement) || t.themeId !== null && !(Number.isInteger(t.themeId) && t.themeId > 0) || typeof t.lyrics != "string")
    throw new TypeError(
      "Song needs a non-empty title, author and copyright (string or null), tags, an arrangement, a theme id (or null) and lyrics"
    );
  return {
    title: t.title.trim(),
    author: t.author,
    copyright: t.copyright,
    tags: t.tags,
    arrangement: { order: t.arrangement.order, linesPerSlide: t.arrangement.linesPerSlide },
    themeId: t.themeId,
    lyrics: t.lyrics
  };
}
function wd() {
  R.handle(
    "songs:list",
    (r, t) => Gs(typeof t == "string" ? t : void 0)
  ), R.handle("songs:get", (r, t) => lc(Cr(t))), R.handle("songs:create", (r, t) => dc(ks(t))), R.handle(
    "songs:update",
    (r, t, e) => md(Cr(t), ks(e))
  ), R.handle("songs:delete", (r, t) => _d(Cr(t)));
}
const Qs = "v.book, v.chapter, v.verse, v.text", Zs = "FROM verses v JOIN bible_versions b ON b.id = v.version_id WHERE b.code = @version";
function yd(r, t, e, n) {
  return k.prepare(
    `SELECT ${Qs} ${Zs}
         AND v.book = @book AND v.chapter = @chapter AND v.verse = @verse`
  ).get({ version: r, book: t, chapter: e, verse: n });
}
function bd(r, t, e, n, s) {
  return k.prepare(
    `SELECT ${Qs} ${Zs}
         AND v.book = @book AND v.chapter = @chapter AND v.verse BETWEEN @verseStart AND @verseEnd
       ORDER BY v.verse`
  ).all({ version: r, book: t, chapter: e, verseStart: n, verseEnd: s });
}
function Ed(r, t) {
  const e = t.trim();
  if (!e) return [];
  const n = `%${e.replace(/[\\%_]/g, (s) => `\\${s}`)}%`;
  return k.prepare(
    `SELECT ${Qs} ${Zs}
         AND v.text LIKE @pattern ESCAPE '\\'
       ORDER BY v.id
       LIMIT 100`
  ).all({ version: r, pattern: n });
}
function Sd() {
  return k.prepare("SELECT book FROM verses GROUP BY book ORDER BY MIN(id)").all().map(
    (r) => r.book
  );
}
const Ai = ["KJV", "WEB"];
function Lr(r) {
  if (!Ai.includes(r))
    throw new TypeError(`Bible version must be one of ${Ai.join(", ")}`);
  return r;
}
function Ri(r) {
  if (typeof r != "string" || r.trim() === "") throw new TypeError("Book must be a non-empty string");
  return r;
}
function Vt(r, t) {
  if (!Number.isInteger(r) || r < 1)
    throw new TypeError(`${t} must be a positive integer`);
  return r;
}
function kd() {
  R.handle(
    "bible:getVerse",
    (r, t, e, n, s) => yd(Lr(t), Ri(e), Vt(n, "Chapter"), Vt(s, "Verse"))
  ), R.handle(
    "bible:getRange",
    (r, t, e, n, s, i) => bd(
      Lr(t),
      Ri(e),
      Vt(n, "Chapter"),
      Vt(s, "First verse"),
      Vt(i, "Last verse")
    )
  ), R.handle(
    "bible:searchText",
    (r, t, e) => Ed(Lr(t), typeof e == "string" ? e : "")
  ), R.handle("bible:listBooks", () => Sd());
}
const uc = `
  SELECT i.id, i.service_id, i.type, i.ref_id, i.order_index, i.payload, s.title AS song_title
  FROM service_items i
  LEFT JOIN songs s ON i.type = 'song' AND s.id = i.ref_id`;
function hc(r) {
  const t = { id: r.id, service_id: r.service_id, order: r.order_index };
  if (r.type === "song")
    return { ...t, type: "song", ref_id: r.ref_id, payload: null, title: r.song_title ?? "Missing song" };
  if (r.type === "scripture") {
    const n = JSON.parse(r.payload ?? "{}");
    return { ...t, type: "scripture", ref_id: null, payload: n, title: n.title };
  }
  if (r.type === "presentation") {
    const n = JSON.parse(r.payload ?? "{}");
    return { ...t, type: "presentation", ref_id: null, payload: n, title: n.title };
  }
  const e = JSON.parse(r.payload ?? "{}");
  return { ...t, type: "announcement", ref_id: null, payload: e, title: e.title };
}
function vd(r) {
  const t = k.prepare(`${uc} WHERE i.id = ?`).get(r);
  return t && hc(t);
}
function Td(r, t) {
  const e = k.prepare("INSERT INTO services (name, date) VALUES (?, ?)").run(r, t);
  return { id: Number(e.lastInsertRowid), name: r, date: t };
}
function xd() {
  return k.prepare("SELECT id, name, date FROM services ORDER BY date IS NULL, date DESC, id DESC").all();
}
function Ad(r) {
  const t = k.prepare("SELECT id, name, date FROM services WHERE id = ?").get(r);
  if (!t) return;
  const e = k.prepare(`${uc} WHERE i.service_id = ? ORDER BY i.order_index, i.id`).all(r);
  return { ...t, items: e.map(hc) };
}
function Rd(r) {
  return k.prepare("DELETE FROM services WHERE id = ?").run(r).changes > 0;
}
const Id = k.transaction(
  (r, t, e, n) => {
    if (!k.prepare("SELECT 1 FROM services WHERE id = ?").get(r))
      throw new Error(`Service ${r} does not exist`);
    if (t === "song" && !k.prepare("SELECT 1 FROM songs WHERE id = ?").get(e))
      throw new Error(`Song ${e} does not exist`);
    const { next: s } = k.prepare("SELECT COALESCE(MAX(order_index) + 1, 0) AS next FROM service_items WHERE service_id = ?").get(r), i = k.prepare("INSERT INTO service_items (service_id, type, ref_id, order_index, payload) VALUES (?, ?, ?, ?, ?)").run(r, t, e, s, n === null ? null : JSON.stringify(n));
    return vd(Number(i.lastInsertRowid));
  }
);
function Nd(r) {
  return k.prepare("DELETE FROM service_items WHERE id = ?").run(r).changes > 0;
}
const Od = k.transaction((r, t) => {
  const e = new Set(
    k.prepare("SELECT id FROM service_items WHERE service_id = ?").all(r).map(
      (i) => i.id
    )
  ), n = new Set(t);
  if (n.size !== t.length || n.size !== e.size || t.some((i) => !e.has(i)))
    return !1;
  const s = k.prepare("UPDATE service_items SET order_index = ? WHERE id = ?");
  return t.forEach((i, a) => s.run(a, i)), !0;
}), Ii = ["song", "scripture", "announcement", "presentation"], Ni = 500;
function et(r, t = "Id") {
  if (!Number.isInteger(r) || r < 1)
    throw new TypeError(`${t} must be a positive integer`);
  return r;
}
function Md(r) {
  if (typeof r != "string" || r.trim() === "") throw new TypeError("Service needs a non-empty name");
  return r.trim();
}
function Cd(r) {
  if (r == null || r === "") return null;
  if (typeof r != "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r))
    throw new TypeError("Service date must be YYYY-MM-DD or null");
  return r;
}
function ei(r) {
  if (typeof r != "string" || r.trim() === "") throw new TypeError("Item needs a non-empty title");
  return r.trim();
}
function Ld(r) {
  const t = r;
  if (typeof t != "object" || t === null || !Array.isArray(t.verses) || t.verses.length === 0)
    throw new TypeError("Scripture needs a title and at least one verse");
  const e = t.verses.map((n) => {
    if (typeof (n == null ? void 0 : n.text) != "string" || typeof n.caption != "string")
      throw new TypeError("Each verse needs text and a caption");
    return { text: n.text, caption: n.caption };
  });
  return { title: ei(t.title), verses: e };
}
function Pd(r) {
  const t = r;
  if (typeof t != "object" || t === null || typeof t.body != "string")
    throw new TypeError("Announcement needs a title and body text");
  return { title: ei(t.title), body: t.body };
}
function $d(r) {
  const t = r;
  if (typeof t != "object" || t === null || !Array.isArray(t.pages) || t.pages.length === 0 || t.pages.length > Ni || !t.pages.every((e) => typeof e == "string" && e.startsWith("wd-media://")))
    throw new TypeError(`A presentation needs a title and 1 to ${Ni} page images`);
  return { title: ei(t.title), pages: t.pages };
}
function Fd(r, t, e) {
  if (!Ii.includes(r))
    throw new TypeError(`Item type must be one of ${Ii.join(", ")}`);
  if (r === "song") {
    if (e != null) throw new TypeError("Song items have no payload");
    return { type: r, refId: et(t, "Song id"), payload: null };
  }
  if (t != null) throw new TypeError(`${r} items have no refId`);
  return r === "scripture" ? { type: r, refId: null, payload: Ld(e) } : r === "presentation" ? { type: r, refId: null, payload: $d(e) } : { type: "announcement", refId: null, payload: Pd(e) };
}
function jd() {
  R.handle(
    "services:create",
    (r, t, e) => Td(Md(t), Cd(e))
  ), R.handle("services:list", () => xd()), R.handle("services:get", (r, t) => Ad(et(t, "Service id"))), R.handle("services:delete", (r, t) => Rd(et(t, "Service id"))), R.handle("services:addItem", (r, t, e, n, s) => {
    const i = Fd(e, n, s);
    return Id(et(t, "Service id"), i.type, i.refId, i.payload);
  }), R.handle("services:removeItem", (r, t) => Nd(et(t, "Item id"))), R.handle("services:reorderItems", (r, t, e) => {
    if (!Array.isArray(e)) throw new TypeError("Item ids must be an array");
    return Od(
      et(t, "Service id"),
      e.map((n) => et(n, "Item id"))
    );
  });
}
const fc = ":A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD", Bd = fc + "\\-.\\d\\u00B7\\u0300-\\u036F\\u203F-\\u2040", Ud = "[" + fc + "][" + Bd + "]*", Wd = new RegExp("^" + Ud + "$");
function Dd(r, t) {
  const e = [];
  let n = t.exec(r);
  for (; n; ) {
    const s = [];
    s.startIndex = t.lastIndex - n[0].length;
    const i = n.length;
    for (let a = 0; a < i; a++)
      s.push(n[a]);
    e.push(s), n = t.exec(r);
  }
  return e;
}
const pc = function(r) {
  const t = Wd.exec(r);
  return !(t === null || typeof t > "u");
};
function Hd(r) {
  return typeof r < "u";
}
const ti = [
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
], gc = ["__proto__", "constructor", "prototype"], qd = {
  allowBooleanAttributes: !1,
  //A tag can have attributes without any value
  unpairedTags: []
};
function Vd(r, t) {
  t = Object.assign({}, qd, t);
  const e = [];
  let n = !1, s = !1;
  r[0] === "\uFEFF" && (r = r.substr(1));
  for (let i = 0; i < r.length; i++)
    if (r[i] === "<" && r[i + 1] === "?") {
      if (i += 2, i = Oi(r, i), i.err) return i;
    } else if (r[i] === "<") {
      let a = i;
      if (i++, r[i] === "!") {
        i = Mi(r, i);
        continue;
      } else {
        let o = !1;
        r[i] === "/" && (o = !0, i++);
        let l = "";
        for (; i < r.length && r[i] !== ">" && r[i] !== " " && r[i] !== "	" && r[i] !== `
` && r[i] !== "\r"; i++)
          l += r[i];
        if (l = l.trim(), l[l.length - 1] === "/" && (l = l.substring(0, l.length - 1), i--), !Zd(l)) {
          let h;
          return l.trim().length === 0 ? h = "Invalid space after '<'." : h = "Tag '" + l + "' is an invalid name.", q("InvalidTag", h, ee(r, i));
        }
        const u = Kd(r, i);
        if (u === !1)
          return q("InvalidAttr", "Attributes for '" + l + "' have open quote.", ee(r, i));
        let d = u.value;
        if (i = u.index, d[d.length - 1] === "/") {
          const h = i - d.length;
          d = d.substring(0, d.length - 1);
          const g = Ci(d, t);
          if (g === !0)
            n = !0;
          else
            return q(g.err.code, g.err.msg, ee(r, h + g.err.line));
        } else if (o)
          if (u.tagClosed) {
            if (d.trim().length > 0)
              return q("InvalidTag", "Closing tag '" + l + "' can't have attributes or invalid starting.", ee(r, a));
            if (e.length === 0)
              return q("InvalidTag", "Closing tag '" + l + "' has not been opened.", ee(r, a));
            {
              const h = e.pop();
              if (l !== h.tagName) {
                let g = ee(r, h.tagStartPos);
                return q(
                  "InvalidTag",
                  "Expected closing tag '" + h.tagName + "' (opened in line " + g.line + ", col " + g.col + ") instead of closing tag '" + l + "'.",
                  ee(r, a)
                );
              }
              e.length == 0 && (s = !0);
            }
          } else return q("InvalidTag", "Closing tag '" + l + "' doesn't have proper closing.", ee(r, i));
        else {
          const h = Ci(d, t);
          if (h !== !0)
            return q(h.err.code, h.err.msg, ee(r, i - d.length + h.err.line));
          if (s === !0)
            return q("InvalidXml", "Multiple possible root nodes found.", ee(r, i));
          t.unpairedTags.indexOf(l) !== -1 || e.push({ tagName: l, tagStartPos: a }), n = !0;
        }
        for (i++; i < r.length; i++)
          if (r[i] === "<")
            if (r[i + 1] === "!") {
              i++, i = Mi(r, i);
              continue;
            } else if (r[i + 1] === "?") {
              if (i = Oi(r, ++i), i.err) return i;
            } else
              break;
          else if (r[i] === "&") {
            const h = Gd(r, i);
            if (h == -1)
              return q("InvalidChar", "char '&' is not expected.", ee(r, i));
            i = h;
          } else if (s === !0 && !vt(r[i]))
            return q("InvalidXml", "Extra text at the end", ee(r, i));
        r[i] === "<" && i--;
      }
    } else {
      if (vt(r[i]))
        continue;
      return q("InvalidChar", "char '" + r[i] + "' is not expected.", ee(r, i));
    }
  if (n) {
    if (e.length == 1)
      return q("InvalidTag", "Unclosed tag '" + e[0].tagName + "'.", ee(r, e[0].tagStartPos));
    if (e.length > 0)
      return q("InvalidXml", "Invalid '" + JSON.stringify(e.map((i) => i.tagName), null, 4).replace(/\r?\n/g, "") + "' found.", { line: 1, col: 1 });
  } else return q("InvalidXml", "Start tag expected.", 1);
  return !0;
}
function vt(r) {
  return r === " " || r === "	" || r === `
` || r === "\r";
}
function Oi(r, t) {
  const e = t;
  for (; t < r.length; t++)
    if (r[t] == "?" || r[t] == " ") {
      const n = r.substr(e, t - e);
      if (t > 5 && n === "xml")
        return q("InvalidXml", "XML declaration allowed only at the start of the document.", ee(r, t));
      if (r[t] == "?" && r[t + 1] == ">") {
        t++;
        break;
      } else
        continue;
    }
  return t;
}
function Mi(r, t) {
  if (r.length > t + 5 && r[t + 1] === "-" && r[t + 2] === "-") {
    for (t += 3; t < r.length; t++)
      if (r[t] === "-" && r[t + 1] === "-" && r[t + 2] === ">") {
        t += 2;
        break;
      }
  } else if (r.length > t + 8 && r[t + 1] === "D" && r[t + 2] === "O" && r[t + 3] === "C" && r[t + 4] === "T" && r[t + 5] === "Y" && r[t + 6] === "P" && r[t + 7] === "E") {
    let e = 1;
    for (t += 8; t < r.length; t++)
      if (r[t] === "<")
        e++;
      else if (r[t] === ">" && (e--, e === 0))
        break;
  } else if (r.length > t + 9 && r[t + 1] === "[" && r[t + 2] === "C" && r[t + 3] === "D" && r[t + 4] === "A" && r[t + 5] === "T" && r[t + 6] === "A" && r[t + 7] === "[") {
    for (t += 8; t < r.length; t++)
      if (r[t] === "]" && r[t + 1] === "]" && r[t + 2] === ">") {
        t += 2;
        break;
      }
  }
  return t;
}
const zd = '"', Xd = "'";
function Kd(r, t) {
  let e = "", n = "", s = !1;
  for (; t < r.length; t++) {
    if (r[t] === zd || r[t] === Xd)
      n === "" ? n = r[t] : n !== r[t] || (n = "");
    else if (r[t] === ">" && n === "") {
      s = !0;
      break;
    }
    e += r[t];
  }
  return n !== "" ? !1 : {
    value: e,
    index: t,
    tagClosed: s
  };
}
function Yd(r) {
  const t = [], e = r.length;
  let n = 0;
  for (; n < e; ) {
    const s = n;
    for (; n < e && vt(r[n]); ) n++;
    if (n >= e) break;
    if (r[n] === "=") {
      n = s + 1;
      continue;
    }
    const i = r.slice(s, n), a = n;
    for (; n < e && !vt(r[n]) && r[n] !== "="; ) n++;
    const o = r.slice(a, n);
    let l, u = n;
    for (; u < e && vt(r[u]); ) u++;
    u < e && r[u] === "=" && (l = r.slice(n, u + 1), n = u + 1);
    let d, h, g = n;
    for (; g < e && vt(r[g]); ) g++;
    if (g < e && (r[g] === '"' || r[g] === "'")) {
      const m = g + 1, y = r.indexOf(r[g], m);
      y !== -1 && (d = r[g], h = r.slice(m, y), n = y + 1);
    }
    const f = { startIndex: s };
    f[1] = i, f[2] = o, f[3] = l, f[4] = d !== void 0 ? !0 : void 0, f[5] = d, f[6] = h, t.push(f);
  }
  return t;
}
function Ci(r, t) {
  const e = Yd(r), n = {};
  for (let s = 0; s < e.length; s++) {
    if (e[s][1].length === 0)
      return q("InvalidAttr", "Attribute '" + e[s][2] + "' has no space in starting.", zt(e[s]));
    if (e[s][3] !== void 0 && e[s][4] === void 0)
      return q("InvalidAttr", "Attribute '" + e[s][2] + "' is without value.", zt(e[s]));
    if (e[s][3] === void 0 && !t.allowBooleanAttributes)
      return q("InvalidAttr", "boolean attribute '" + e[s][2] + "' is not allowed.", zt(e[s]));
    const i = e[s][2];
    if (!Qd(i))
      return q("InvalidAttr", "Attribute '" + i + "' is an invalid name.", zt(e[s]));
    if (!Object.prototype.hasOwnProperty.call(n, i))
      n[i] = 1;
    else
      return q("InvalidAttr", "Attribute '" + i + "' is repeated.", zt(e[s]));
  }
  return !0;
}
function Jd(r, t) {
  let e = /\d/;
  for (r[t] === "x" && (t++, e = /[\da-fA-F]/); t < r.length; t++) {
    if (r[t] === ";")
      return t;
    if (!r[t].match(e))
      break;
  }
  return -1;
}
function Gd(r, t) {
  if (t++, r[t] === ";")
    return -1;
  if (r[t] === "#")
    return t++, Jd(r, t);
  let e = 0;
  for (; t < r.length; t++, e++)
    if (!(r[t].match(/\w/) && e < 20)) {
      if (r[t] === ";")
        break;
      return -1;
    }
  return t;
}
function q(r, t, e) {
  return {
    err: {
      code: r,
      msg: t,
      line: e.line || e,
      col: e.col
    }
  };
}
function Qd(r) {
  return pc(r);
}
function Zd(r) {
  return pc(r);
}
function ee(r, t) {
  const e = r.substring(0, t).split(/\r?\n/);
  return {
    line: e.length,
    // column number is last line's length + 1, because column numbering starts at 1:
    col: e[e.length - 1].length + 1
  };
}
function zt(r) {
  return r.startIndex + r[1].length;
}
const eu = {
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
}, mc = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"'
}, tu = {
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
}, wr = Object.freeze({
  /** Resolve and expand the entity normally. */
  ALLOW: "allow",
  /** Silently skip this entity — it will not be registered. */
  BLOCK: "block",
  /** Throw an error, aborting entity registration entirely. */
  THROW: "throw"
}), nu = new Set("!?\\\\/[]$%{}^&*()<>|+");
function Li(r) {
  if (r[0] === "#")
    throw new Error(`[EntityReplacer] Invalid character '#' in entity name: "${r}"`);
  for (const t of r)
    if (nu.has(t))
      throw new Error(`[EntityReplacer] Invalid character '${t}' in entity name: "${r}"`);
  return r;
}
function Xt(...r) {
  const t = /* @__PURE__ */ Object.create(null);
  for (const e of r)
    if (e)
      for (const n of Object.keys(e)) {
        const s = e[n];
        if (typeof s == "string")
          t[n] = s;
        else if (s && typeof s == "object" && s.val !== void 0) {
          const i = s.val;
          typeof i == "string" && (t[n] = i);
        }
      }
  return t;
}
const nt = "external", yr = "base", vs = "all";
function ru(r) {
  return !r || r === nt ? /* @__PURE__ */ new Set([nt]) : r === vs ? /* @__PURE__ */ new Set([vs]) : r === yr ? /* @__PURE__ */ new Set([yr]) : Array.isArray(r) ? new Set(r) : /* @__PURE__ */ new Set([nt]);
}
const se = Object.freeze({ allow: 0, leave: 1, remove: 2, throw: 3 }), su = /* @__PURE__ */ new Set([9, 10, 13]);
function iu(r) {
  if (!r)
    return { xmlVersion: 1, onLevel: se.allow, nullLevel: se.remove };
  const t = r.xmlVersion === 1.1 ? 1.1 : 1, e = se[r.onNCR] ?? se.allow, n = se[r.nullNCR] ?? se.remove, s = Math.max(n, se.remove);
  return { xmlVersion: t, onLevel: e, nullLevel: s };
}
class au {
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
  constructor(t = {}) {
    this._limit = t.limit || {}, this._maxTotalExpansions = this._limit.maxTotalExpansions || 0, this._maxExpandedLength = this._limit.maxExpandedLength || 0, this._postCheck = typeof t.postCheck == "function" ? t.postCheck : (n) => n, this._limitTiers = ru(this._limit.applyLimitsTo ?? nt), this._numericAllowed = t.numericAllowed ?? !0, this._baseMap = Xt(mc, t.namedEntities || null), this._externalMap = /* @__PURE__ */ Object.create(null), this._inputMap = /* @__PURE__ */ Object.create(null), this._totalExpansions = 0, this._expandedLength = 0, this._removeSet = new Set(t.remove && Array.isArray(t.remove) ? t.remove : []), this._leaveSet = new Set(t.leave && Array.isArray(t.leave) ? t.leave : []);
    const e = iu(t.ncr);
    this._ncrXmlVersion = e.xmlVersion, this._ncrOnLevel = e.onLevel, this._ncrNullLevel = e.nullLevel, this._onExternalEntity = typeof t.onExternalEntity == "function" ? t.onExternalEntity : null, this._onInputEntity = typeof t.onInputEntity == "function" ? t.onInputEntity : null;
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
  _applyRegistrationHook(t, e, n, s) {
    if (!t) return !0;
    const i = t(e, n);
    if (i === wr.BLOCK) return !1;
    if (i === wr.THROW)
      throw new Error(
        `[EntityDecoder] Registration of ${s} entity "&${e};" was rejected by hook`
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
  setExternalEntities(t) {
    if (t)
      for (const s of Object.keys(t))
        Li(s);
    if (!this._onExternalEntity) {
      this._externalMap = Xt(t);
      return;
    }
    const e = Xt(t), n = /* @__PURE__ */ Object.create(null);
    for (const [s, i] of Object.entries(e))
      this._applyRegistrationHook(this._onExternalEntity, s, i, "external") && (n[s] = i);
    this._externalMap = n;
  }
  /**
   * Add a single persistent external entity.
   * If `onExternalEntity` is set it is called before the entity is stored;
   * `ENTITY_ACTION.BLOCK` silently skips storage, `ENTITY_ACTION.THROW` raises.
   * @param {string} key
   * @param {string} value
   */
  addExternalEntity(t, e) {
    Li(t), typeof e == "string" && e.indexOf("&") === -1 && this._applyRegistrationHook(this._onExternalEntity, t, e, "external") && (this._externalMap[t] = e);
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
  addInputEntities(t) {
    if (this._totalExpansions = 0, this._expandedLength = 0, !this._onInputEntity) {
      this._inputMap = Xt(t);
      return;
    }
    const e = Xt(t), n = /* @__PURE__ */ Object.create(null);
    for (const [s, i] of Object.entries(e))
      this._applyRegistrationHook(this._onInputEntity, s, i, "input") && (n[s] = i);
    this._inputMap = n;
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
  setXmlVersion(t) {
    this._ncrXmlVersion = t === 1.1 ? 1.1 : 1;
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
  decode(t) {
    if (typeof t != "string" || t.length === 0 || t.indexOf("&") === -1) return t;
    const e = t, n = [], s = t.length;
    let i = 0, a = 0;
    const o = this._maxTotalExpansions > 0, l = this._maxExpandedLength > 0, u = o || l;
    for (; a < s; ) {
      if (t.charCodeAt(a) !== 38) {
        a++;
        continue;
      }
      let h = a + 1;
      for (; h < s && t.charCodeAt(h) !== 59 && h - a <= 32; ) h++;
      if (h >= s || t.charCodeAt(h) !== 59) {
        a++;
        continue;
      }
      const g = t.slice(a + 1, h);
      if (g.length === 0) {
        a++;
        continue;
      }
      let f, m;
      if (this._removeSet.has(g))
        f = "", m === void 0 && (m = nt);
      else if (this._leaveSet.has(g)) {
        a++;
        continue;
      } else if (g.charCodeAt(0) === 35) {
        const y = this._resolveNCR(g);
        if (y === void 0) {
          a++;
          continue;
        }
        f = y, m = yr;
      } else {
        const y = this._resolveName(g);
        f = y == null ? void 0 : y.value, m = y == null ? void 0 : y.tier;
      }
      if (f === void 0) {
        a++;
        continue;
      }
      if (a > i && n.push(t.slice(i, a)), n.push(f), i = h + 1, a = i, u && this._tierCounts(m)) {
        if (o && (this._totalExpansions++, this._totalExpansions > this._maxTotalExpansions))
          throw new Error(
            `[EntityReplacer] Entity expansion count limit exceeded: ${this._totalExpansions} > ${this._maxTotalExpansions}`
          );
        if (l) {
          const y = f.length - (g.length + 2);
          if (y > 0 && (this._expandedLength += y, this._expandedLength > this._maxExpandedLength))
            throw new Error(
              `[EntityReplacer] Expanded content length limit exceeded: ${this._expandedLength} > ${this._maxExpandedLength}`
            );
        }
      }
    }
    i < s && n.push(t.slice(i));
    const d = n.length === 0 ? t : n.join("");
    return this._postCheck(d, e);
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
  _tierCounts(t) {
    return this._limitTiers.has(vs) ? !0 : this._limitTiers.has(t);
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
  _resolveName(t) {
    if (t in this._inputMap) return { value: this._inputMap[t], tier: nt };
    if (t in this._externalMap) return { value: this._externalMap[t], tier: nt };
    if (t in this._baseMap) return { value: this._baseMap[t], tier: yr };
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
  _classifyNCR(t) {
    return t === 0 ? this._ncrNullLevel : t >= 55296 && t <= 57343 || this._ncrXmlVersion === 1 && t >= 1 && t <= 31 && !su.has(t) ? se.remove : -1;
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
  _applyNCRAction(t, e, n) {
    switch (t) {
      case se.allow:
        return String.fromCodePoint(n);
      case se.remove:
        return "";
      case se.leave:
        return;
      case se.throw:
        throw new Error(
          `[EntityDecoder] Prohibited numeric character reference &${e}; (U+${n.toString(16).toUpperCase().padStart(4, "0")})`
        );
      default:
        return String.fromCodePoint(n);
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
  _resolveNCR(t) {
    const e = t.charCodeAt(1);
    let n;
    if (e === 120 || e === 88 ? n = parseInt(t.slice(2), 16) : n = parseInt(t.slice(1), 10), Number.isNaN(n) || n < 0 || n > 1114111) return;
    const s = this._classifyNCR(n);
    if (!this._numericAllowed && s < se.remove) return;
    const i = s === -1 ? this._ncrOnLevel : Math.max(this._ncrOnLevel, s);
    return this._applyNCRAction(i, t, n);
  }
}
const _c = (r) => ti.includes(r) ? "__" + r : r, ou = {
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
  tagValueProcessor: function(r, t) {
    return t;
  },
  attributeValueProcessor: function(r, t) {
    return t;
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
  updateTag: function(r, t, e) {
    return r;
  },
  // skipEmptyListItem: false
  captureMetaData: !1,
  maxNestedTags: 100,
  strictReservedNames: !0,
  jPath: !0,
  // if true, pass jPath string to callbacks; if false, pass matcher instance
  onDangerousProperty: _c
};
function cu(r, t) {
  if (typeof r != "string")
    return;
  const e = r.toLowerCase();
  if (ti.some((n) => e === n.toLowerCase()))
    throw new Error(
      `[SECURITY] Invalid ${t}: "${r}" is a reserved JavaScript keyword that could cause prototype pollution`
    );
  if (gc.some((n) => e === n.toLowerCase()))
    throw new Error(
      `[SECURITY] Invalid ${t}: "${r}" is a reserved JavaScript keyword that could cause prototype pollution`
    );
}
function wc(r, t) {
  return typeof r == "boolean" ? {
    enabled: r,
    // true or false
    maxEntitySize: 1e4,
    maxExpansionDepth: 1e4,
    maxTotalExpansions: 1 / 0,
    maxExpandedLength: 1e5,
    maxEntityCount: 1e3,
    allowedTags: null,
    tagFilter: null,
    appliesTo: "all"
  } : typeof r == "object" && r !== null ? {
    enabled: r.enabled !== !1,
    maxEntitySize: Math.max(1, r.maxEntitySize ?? 1e4),
    maxExpansionDepth: Math.max(1, r.maxExpansionDepth ?? 1e4),
    maxTotalExpansions: Math.max(1, r.maxTotalExpansions ?? 1 / 0),
    maxExpandedLength: Math.max(1, r.maxExpandedLength ?? 1e5),
    maxEntityCount: Math.max(1, r.maxEntityCount ?? 1e3),
    allowedTags: r.allowedTags ?? null,
    tagFilter: r.tagFilter ?? null,
    appliesTo: r.appliesTo ?? "all"
  } : wc(!0);
}
const lu = function(r) {
  const t = Object.assign({}, ou, r), e = [
    { value: t.attributeNamePrefix, name: "attributeNamePrefix" },
    { value: t.attributesGroupName, name: "attributesGroupName" },
    { value: t.textNodeName, name: "textNodeName" },
    { value: t.cdataPropName, name: "cdataPropName" },
    { value: t.commentPropName, name: "commentPropName" }
  ];
  for (const { value: n, name: s } of e)
    n && cu(n, s);
  return t.onDangerousProperty === null && (t.onDangerousProperty = _c), t.processEntities = wc(t.processEntities, t.htmlEntities), t.unpairedTagsSet = new Set(t.unpairedTags), t.stopNodes && Array.isArray(t.stopNodes) && (t.stopNodes = t.stopNodes.map((n) => typeof n == "string" && n.startsWith("*.") ? ".." + n.substring(2) : n)), t;
};
let tt;
typeof Symbol != "function" ? tt = "@@xmlMetadata" : tt = Symbol("XML Node Metadata");
class Be {
  constructor(t) {
    this.tagname = t, this.child = [], this[":@"] = /* @__PURE__ */ Object.create(null);
  }
  add(t, e) {
    t === "__proto__" && (t = "#__proto__"), this.child.push({ [t]: e });
  }
  addChild(t, e) {
    t.tagname === "__proto__" && (t.tagname = "#__proto__"), t[":@"] && Object.keys(t[":@"]).length > 0 ? this.child.push({ [t.tagname]: t.child, ":@": t[":@"] }) : this.child.push({ [t.tagname]: t.child }), this.addStartIndex(e);
  }
  addStartIndex(t) {
    t !== void 0 && (this.child[this.child.length - 1][tt] = { startIndex: t });
  }
  addEndIndex(t) {
    const e = this.child[this.child.length - 1];
    e !== void 0 && e[tt] !== void 0 && e[tt].endIndex === void 0 && (e[tt].endIndex = t);
  }
  /** symbol used for metadata */
  static getMetaDataSymbol() {
    return tt;
  }
}
const yc = ":A-Za-z_À-ÖØ-öø-˿Ͱ-ͽͿ-҆҈-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�", du = yc + "\\-\\.\\d·̀-ͯ‿-⁀", bc = ":A-Za-z_À-˿Ͱ-ͽͿ-҆҈-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-󯿿", uu = bc + "\\-\\.\\d·̀-ͯ҇‿-⁀", ni = (r, t, e = "") => {
  const n = r.replace(":", ""), s = t.replace(":", ""), i = `[${n}][${s}]*`;
  return {
    name: new RegExp(`^[${r}][${t}]*$`, e),
    ncName: new RegExp(`^${i}$`, e),
    qName: new RegExp(`^${i}(?::${i})?$`, e),
    nmToken: new RegExp(`^[${t}]+$`, e),
    nmTokens: new RegExp(`^[${t}]+(?:\\s+[${t}]+)*$`, e)
  };
}, hu = ni(yc, du), fu = ni(bc, uu, "u"), Ec = ":A-Za-z_", pu = Ec + "\\-\\.\\d", gu = ni(Ec, pu), mu = (r = "1.0", t = !1) => t ? gu : r === "1.1" ? fu : hu, Sc = (r, { xmlVersion: t = "1.0", asciiOnly: e = !1 } = {}) => mu(t, e).qName.test(r);
class _u {
  constructor(t, e) {
    this.suppressValidationErr = !t, this.options = t, this.xmlVersion = e || 1;
  }
  setXmlVersion(t = 1) {
    this.xmlVersion = t;
  }
  readDocType(t, e) {
    const n = /* @__PURE__ */ Object.create(null);
    let s = 0;
    if (t[e + 3] === "O" && t[e + 4] === "C" && t[e + 5] === "T" && t[e + 6] === "Y" && t[e + 7] === "P" && t[e + 8] === "E") {
      e = e + 9;
      let i = 1, a = !1, o = !1, l = null, u = "";
      for (; e < t.length; e++) {
        if (l !== null) {
          t[e] === l && (l = null), u += t[e];
          continue;
        }
        if (!a && !o && (t[e] === '"' || t[e] === "'")) {
          l = t[e], u += t[e];
          continue;
        }
        if (t[e] === "<" && !o) {
          if (a && Ve(t, "!ENTITY", e)) {
            e += 7;
            let d, h;
            if ([d, h, e] = this.readEntityExp(t, e + 1, this.suppressValidationErr), h.indexOf("&") === -1) {
              if (this.options.enabled !== !1 && this.options.maxEntityCount != null && s >= this.options.maxEntityCount)
                throw new Error(
                  `Entity count (${s + 1}) exceeds maximum allowed (${this.options.maxEntityCount})`
                );
              n[d] = h, s++;
            }
          } else if (a && Ve(t, "!ELEMENT", e)) {
            e += 8;
            const { index: d } = this.readElementExp(t, e + 1);
            e = d;
          } else if (a && Ve(t, "!ATTLIST", e))
            e += 8;
          else if (a && Ve(t, "!NOTATION", e)) {
            e += 9;
            const { index: d } = this.readNotationExp(t, e + 1, this.suppressValidationErr);
            e = d;
          } else if (Ve(t, "!--", e)) o = !0;
          else throw new Error("Invalid DOCTYPE");
          i++, u = "";
        } else if (t[e] === ">") {
          if (o ? t[e - 1] === "-" && t[e - 2] === "-" && (o = !1, i--) : i--, i === 0)
            break;
        } else t[e] === "[" ? a = !0 : u += t[e];
      }
      if (l !== null || i !== 0)
        throw new Error("Unclosed DOCTYPE");
    } else
      throw new Error("Invalid Tag instead of DOCTYPE");
    return { entities: n, i: e };
  }
  readEntityExp(t, e) {
    e = te(t, e);
    const n = e;
    for (; e < t.length && !/\s/.test(t[e]) && t[e] !== '"' && t[e] !== "'"; )
      e++;
    let s = t.substring(n, e);
    if (Kt(s, { xmlVersion: this.xmlVersion }), e = te(t, e), !this.suppressValidationErr) {
      if (t.substring(e, e + 6).toUpperCase() === "SYSTEM")
        throw new Error("External entities are not supported");
      if (t[e] === "%")
        throw new Error("Parameter entities are not supported");
    }
    let i = "";
    if ([e, i] = this.readIdentifierVal(t, e, "entity"), this.options.enabled !== !1 && this.options.maxEntitySize != null && i.length > this.options.maxEntitySize)
      throw new Error(
        `Entity "${s}" size (${i.length}) exceeds maximum allowed size (${this.options.maxEntitySize})`
      );
    return e--, [s, i, e];
  }
  readNotationExp(t, e) {
    e = te(t, e);
    const n = e;
    for (; e < t.length && !/\s/.test(t[e]); )
      e++;
    let s = t.substring(n, e);
    !this.suppressValidationErr && Kt(s, { xmlVersion: this.xmlVersion }), e = te(t, e);
    const i = t.substring(e, e + 6).toUpperCase();
    if (!this.suppressValidationErr && i !== "SYSTEM" && i !== "PUBLIC")
      throw new Error(`Expected SYSTEM or PUBLIC, found "${i}"`);
    e += i.length, e = te(t, e);
    let a = null, o = null;
    if (i === "PUBLIC")
      [e, a] = this.readIdentifierVal(t, e, "publicIdentifier"), e = te(t, e), (t[e] === '"' || t[e] === "'") && ([e, o] = this.readIdentifierVal(t, e, "systemIdentifier"));
    else if (i === "SYSTEM" && ([e, o] = this.readIdentifierVal(t, e, "systemIdentifier"), !this.suppressValidationErr && !o))
      throw new Error("Missing mandatory system identifier for SYSTEM notation");
    return { notationName: s, publicIdentifier: a, systemIdentifier: o, index: --e };
  }
  readIdentifierVal(t, e, n) {
    let s = "";
    const i = t[e];
    if (i !== '"' && i !== "'")
      throw new Error(`Expected quoted string, found "${i}"`);
    e++;
    const a = e;
    for (; e < t.length && t[e] !== i; )
      e++;
    if (s = t.substring(a, e), t[e] !== i)
      throw new Error(`Unterminated ${n} value`);
    return e++, [e, s];
  }
  readElementExp(t, e) {
    e = te(t, e);
    const n = e;
    for (; e < t.length && !/\s/.test(t[e]); )
      e++;
    let s = t.substring(n, e);
    if (!this.suppressValidationErr && !Sc(s, { xmlVersion: this.xmlVersion }))
      throw new Error(`Invalid element name: "${s}"`);
    e = te(t, e);
    let i = "";
    if (t[e] === "E" && Ve(t, "MPTY", e)) e += 4;
    else if (t[e] === "A" && Ve(t, "NY", e)) e += 2;
    else if (t[e] === "(") {
      e++;
      const a = e;
      for (; e < t.length && t[e] !== ")"; )
        e++;
      if (i = t.substring(a, e), t[e] !== ")")
        throw new Error("Unterminated content model");
    } else if (!this.suppressValidationErr)
      throw new Error(`Invalid Element Expression, found "${t[e]}"`);
    return {
      elementName: s,
      contentModel: i.trim(),
      index: e
    };
  }
  readAttlistExp(t, e) {
    e = te(t, e);
    let n = e;
    for (; e < t.length && !/\s/.test(t[e]); )
      e++;
    let s = t.substring(n, e);
    for (Kt(s, { xmlVersion: this.xmlVersion }), e = te(t, e), n = e; e < t.length && !/\s/.test(t[e]); )
      e++;
    let i = t.substring(n, e);
    if (!Kt(i, { xmlVersion: this.xmlVersion }))
      throw new Error(`Invalid attribute name: "${i}"`);
    e = te(t, e);
    let a = "";
    if (t.substring(e, e + 8).toUpperCase() === "NOTATION") {
      if (a = "NOTATION", e += 8, e = te(t, e), t[e] !== "(")
        throw new Error(`Expected '(', found "${t[e]}"`);
      e++;
      let l = [];
      for (; e < t.length && t[e] !== ")"; ) {
        const u = e;
        for (; e < t.length && t[e] !== "|" && t[e] !== ")"; )
          e++;
        let d = t.substring(u, e);
        if (d = d.trim(), !Kt(d, { xmlVersion: this.xmlVersion }))
          throw new Error(`Invalid notation name: "${d}"`);
        l.push(d), t[e] === "|" && (e++, e = te(t, e));
      }
      if (t[e] !== ")")
        throw new Error("Unterminated list of notations");
      e++, a += " (" + l.join("|") + ")";
    } else {
      const l = e;
      for (; e < t.length && !/\s/.test(t[e]); )
        e++;
      a += t.substring(l, e);
      const u = ["CDATA", "ID", "IDREF", "IDREFS", "ENTITY", "ENTITIES", "NMTOKEN", "NMTOKENS"];
      if (!this.suppressValidationErr && !u.includes(a.toUpperCase()))
        throw new Error(`Invalid attribute type: "${a}"`);
    }
    e = te(t, e);
    let o = "";
    return t.substring(e, e + 8).toUpperCase() === "#REQUIRED" ? (o = "#REQUIRED", e += 8) : t.substring(e, e + 7).toUpperCase() === "#IMPLIED" ? (o = "#IMPLIED", e += 7) : [e, o] = this.readIdentifierVal(t, e, "ATTLIST"), {
      elementName: s,
      attributeName: i,
      attributeType: a,
      defaultValue: o,
      index: e
    };
  }
}
const te = (r, t) => {
  for (; t < r.length && /\s/.test(r[t]); )
    t++;
  return t;
};
function Ve(r, t, e) {
  for (let n = 0; n < t.length; n++)
    if (t[n] !== r[e + n + 1]) return !1;
  return !0;
}
function Kt(r, t) {
  if (Sc(r, { xmlVersion: t }))
    return r;
  throw new Error(`Invalid entity name ${r}`);
}
const wu = [
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
], Ts = 255, xs = /* @__PURE__ */ new Map(), kc = 65535, vc = 1632, yn = vc, yu = kc - vc + 1, As = new Uint8Array(yu).fill(Ts);
for (const r of wu)
  for (let t = 0; t < 10; t++) {
    const e = r + t;
    e <= kc ? As[e - yn] = t : xs.set(e, t);
  }
const Pi = 48, $i = 57, Fi = 45, Mn = /* @__PURE__ */ new Set([8722, 65293, 65123]);
function bu(r) {
  if (typeof r != "string") return r;
  const t = r.length;
  if (t === 0) return r;
  let e = -1;
  for (let s = 0; s < t; s++) {
    const i = r.charCodeAt(s);
    if (!(i >= Pi && i <= $i || i === Fi)) {
      if (i < yn) {
        if (Mn.has(i)) {
          e = s;
          break;
        }
        continue;
      }
      if (i >= 55296 && i <= 56319) {
        if (s + 1 < t) {
          const a = r.charCodeAt(s + 1);
          if (a >= 56320 && a <= 57343) {
            const o = 65536 + (i - 55296 << 10) + (a - 56320);
            if (xs.has(o)) {
              e = s;
              break;
            }
          }
        }
        continue;
      }
      if (As[i - yn] !== Ts || Mn.has(i)) {
        e = s;
        break;
      }
    }
  }
  if (e === -1) return r;
  const n = [];
  e > 0 && n.push(r.slice(0, e));
  for (let s = e; s < t; s++) {
    const i = r.charCodeAt(s);
    if (i >= Pi && i <= $i || i === Fi) {
      n.push(r[s]);
      continue;
    }
    if (i < yn) {
      n.push(Mn.has(i) ? "-" : r[s]);
      continue;
    }
    if (i >= 55296 && i <= 56319) {
      if (s + 1 < t) {
        const o = r.charCodeAt(s + 1);
        if (o >= 56320 && o <= 57343) {
          const l = 65536 + (i - 55296 << 10) + (o - 56320), u = xs.get(l);
          if (u !== void 0) {
            n.push(String.fromCharCode(u + 48)), s++;
            continue;
          }
        }
      }
      n.push(r[s]);
      continue;
    }
    if (Mn.has(i)) {
      n.push("-");
      continue;
    }
    const a = As[i - yn];
    n.push(a !== Ts ? String.fromCharCode(a + 48) : r[s]);
  }
  return n.join("");
}
const Eu = /^[-+]?0x[a-fA-F0-9]+$/, Su = /^0b[01]+$/, ku = /^0o[0-7]+$/, vu = /^([\-\+])?(0*)([0-9]*(\.[0-9]*)?)$/, Tu = {
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
function xu(r, t = {}) {
  if (t = Object.assign({}, Tu, t), !r || typeof r != "string") return r;
  let e = r.trim();
  if (e.length === 0) return r;
  if (t.skipLike !== void 0 && t.skipLike.test(e)) return r;
  if (e === "0" || t.unicode && (e = bu(e), e === "0"))
    return 0;
  if (t.hex && Eu.test(e))
    return Pr(e, 16);
  if (t.binary && Su.test(e))
    return Pr(e, 2);
  if (t.octal && ku.test(e))
    return Pr(e, 8);
  if (isFinite(e)) {
    if (e.includes("e") || e.includes("E"))
      return Ru(r, e, t);
    {
      const n = vu.exec(e);
      if (n) {
        const s = n[1] || "", i = n[2];
        let a = Iu(n[3]);
        const o = s ? (
          // 0., -00., 000.
          r[i.length + 1] === "."
        ) : r[i.length] === ".";
        if (!t.leadingZeros && (i.length > 1 || i.length === 1 && !o))
          return r;
        {
          const l = Number(e), u = String(l);
          if (l === 0) return l;
          if (u.search(/[eE]/) !== -1)
            return t.eNotation ? l : r;
          if (e.indexOf(".") !== -1)
            return u === "0" || u === a || u === `${s}${a}` ? l : r;
          let d = i ? a : e;
          return i ? d === u || s + d === u ? l : r : d === u || d === s + u ? l : r;
        }
      } else
        return r;
    }
  } else return Nu(r, Number(e), t);
}
const Au = /^([-+])?(0*)(\d*(\.\d*)?[eE][-\+]?\d+)$/;
function Ru(r, t, e) {
  if (!e.eNotation) return r;
  const n = t.match(Au);
  if (n) {
    let s = n[1] || "";
    const i = n[3].indexOf("e") === -1 ? "E" : "e", a = n[2], o = s ? (
      // 0E.
      r[a.length + 1] === i
    ) : r[a.length] === i;
    return a.length > 1 && o ? r : a.length === 1 && (n[3].startsWith(`.${i}`) || n[3][0] === i) ? Number(t) : a.length > 0 ? e.leadingZeros && !o ? (t = (n[1] || "") + n[3], Number(t)) : r : Number(t);
  } else
    return r;
}
function Iu(r) {
  if (r && r.indexOf(".") !== -1) {
    let t = r.length;
    for (; t > 0 && r.charCodeAt(t - 1) === 48; ) t--;
    return r = r.slice(0, t), r === "." ? r = "0" : r[0] === "." ? r = "0" + r : r[r.length - 1] === "." && (r = r.substring(0, r.length - 1)), r;
  }
  return r;
}
function Pr(r, t) {
  const e = r.trim();
  if ((t === 2 || t === 8) && (r = e.substring(2)), parseInt) return parseInt(r, t);
  if (Number.parseInt) return Number.parseInt(r, t);
  if (window && window.parseInt) return window.parseInt(r, t);
  throw new Error("parseInt, Number.parseInt, window.parseInt are not supported");
}
function Nu(r, t, e) {
  const n = t === 1 / 0;
  switch (e.infinity.toLowerCase()) {
    case "null":
      return null;
    case "infinity":
      return t;
    case "string":
      return n ? "Infinity" : "-Infinity";
    case "original":
    default:
      return r;
  }
}
function Ou(r) {
  return typeof r == "function" ? r : Array.isArray(r) ? (t) => {
    for (const e of r)
      if (typeof e == "string" && t === e || e instanceof RegExp && e.test(t))
        return !0;
  } : () => !1;
}
class ji {
  /**
   * Create a new Expression
   * @param {string} pattern - Pattern string (e.g., "root.users.user", "..user[id]")
   * @param {Object} options - Configuration options
   * @param {string} options.separator - Path separator (default: '.')
   */
  constructor(t, e = {}, n) {
    this.pattern = t, this.separator = e.separator || ".", this.segments = this._parse(t), this.data = n, this._hasDeepWildcard = this.segments.some((s) => s.type === "deep-wildcard"), this._hasAttributeCondition = this.segments.some((s) => s.attrName !== void 0), this._hasPositionSelector = this.segments.some((s) => s.position !== void 0);
  }
  /**
   * Parse pattern string into segments
   * @private
   * @param {string} pattern - Pattern to parse
   * @returns {Array} Array of segment objects
   */
  _parse(t) {
    const e = [];
    let n = 0, s = "";
    for (; n < t.length; )
      t[n] === this.separator ? n + 1 < t.length && t[n + 1] === this.separator ? (s.trim() && (e.push(this._parseSegment(s.trim())), s = ""), e.push({ type: "deep-wildcard" }), n += 2) : (s.trim() && e.push(this._parseSegment(s.trim())), s = "", n++) : (s += t[n], n++);
    return s.trim() && e.push(this._parseSegment(s.trim())), e;
  }
  /**
   * Parse a single segment
   * @private
   * @param {string} part - Segment string (e.g., "user", "ns::user", "user[id]", "ns::user:first")
   * @returns {Object} Segment object
   */
  _parseSegment(t) {
    const e = { type: "tag" };
    let n = null, s = t;
    const i = t.match(/^([^\[]+)(\[[^\]]*\])(.*)$/);
    if (i && (s = i[1] + i[3], i[2])) {
      const d = i[2].slice(1, -1);
      d && (n = d);
    }
    let a, o = s;
    if (s.includes("::")) {
      const d = s.indexOf("::");
      if (a = s.substring(0, d).trim(), o = s.substring(d + 2).trim(), !a)
        throw new Error(`Invalid namespace in pattern: ${t}`);
    }
    let l, u = null;
    if (o.includes(":")) {
      const d = o.lastIndexOf(":"), h = o.substring(0, d).trim(), g = o.substring(d + 1).trim();
      ["first", "last", "odd", "even"].includes(g) || /^nth\(\d+\)$/.test(g) ? (l = h, u = g) : l = o;
    } else
      l = o;
    if (!l)
      throw new Error(`Invalid segment pattern: ${t}`);
    if (e.tag = l, a && (e.namespace = a), n)
      if (n.includes("=")) {
        const d = n.indexOf("=");
        e.attrName = n.substring(0, d).trim(), e.attrValue = n.substring(d + 1).trim();
      } else
        e.attrName = n.trim();
    if (u) {
      const d = u.match(/^nth\((\d+)\)$/);
      d ? (e.position = "nth", e.positionValue = parseInt(d[1], 10)) : e.position = u;
    }
    return e;
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
class Mu {
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
  add(t) {
    if (this._sealed)
      throw new TypeError(
        "ExpressionSet is sealed. Create a new ExpressionSet to add more expressions."
      );
    if (this._patterns.has(t.pattern)) return this;
    if (this._patterns.add(t.pattern), t.hasDeepWildcard()) {
      const i = t.segments[t.segments.length - 1];
      if (i && i.type !== "deep-wildcard" && i.tag !== "*") {
        const a = i.tag;
        this._deepByTerminalTag.has(a) || this._deepByTerminalTag.set(a, []), this._deepByTerminalTag.get(a).push(t);
      } else
        this._deepWildcards.push(t);
      return this;
    }
    const e = t.length, n = t.segments[t.segments.length - 1], s = n == null ? void 0 : n.tag;
    if (!s || s === "*")
      this._wildcardByDepth.has(e) || this._wildcardByDepth.set(e, []), this._wildcardByDepth.get(e).push(t);
    else {
      const i = `${e}:${s}`;
      this._byDepthAndTag.has(i) || this._byDepthAndTag.set(i, []), this._byDepthAndTag.get(i).push(t);
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
  addAll(t) {
    for (const e of t) this.add(e);
    return this;
  }
  /**
   * Check whether a pattern string is already present in the set.
   *
   * @param {import('./Expression.js').default} expression
   * @returns {boolean}
   */
  has(t) {
    return this._patterns.has(t.pattern);
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
  matchesAny(t) {
    return this.findMatch(t) !== null;
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
  findMatch(t) {
    const e = t.getDepth(), n = t.getCurrentTag(), s = `${e}:${n}`, i = this._byDepthAndTag.get(s);
    if (i) {
      for (let l = 0; l < i.length; l++)
        if (t.matches(i[l])) return i[l];
    }
    const a = this._wildcardByDepth.get(e);
    if (a) {
      for (let l = 0; l < a.length; l++)
        if (t.matches(a[l])) return a[l];
    }
    const o = this._deepByTerminalTag.get(n);
    if (o) {
      for (let l = 0; l < o.length; l++)
        if (t.matches(o[l])) return o[l];
    }
    for (let l = 0; l < this._deepWildcards.length; l++)
      if (t.matches(this._deepWildcards[l])) return this._deepWildcards[l];
    return null;
  }
}
class Cu {
  /**
   * @param {Matcher} matcher - The parent Matcher instance to read from.
   */
  constructor(t) {
    this._matcher = t;
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
    const t = this._matcher.path;
    return t.length > 0 ? t[t.length - 1].tag : void 0;
  }
  /**
   * Get current namespace.
   * @returns {string|undefined}
   */
  getCurrentNamespace() {
    const t = this._matcher.path;
    return t.length > 0 ? t[t.length - 1].namespace : void 0;
  }
  /**
   * Get current node's attribute value.
   * @param {string} attrName
   * @returns {*}
   */
  getAttrValue(t) {
    var n;
    const e = this._matcher.path;
    if (e.length !== 0)
      return (n = e[e.length - 1].values) == null ? void 0 : n[t];
  }
  /**
   * Check if current node has an attribute.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAttr(t) {
    const e = this._matcher.path;
    if (e.length === 0) return !1;
    const n = e[e.length - 1];
    return n.values !== void 0 && t in n.values;
  }
  /**
   * Get the value of a "kept" attribute from the nearest ancestor (or
   * current node) that declared it via `push(tag, attrs, ns, { keep: [...] })`.
   * @param {string} attrName
   * @returns {*}
   */
  getAnyParentAttr(t) {
    return this._matcher.getAnyParentAttr(t);
  }
  /**
   * Check whether any ancestor (or the current node) kept the given
   * attribute via `push(tag, attrs, ns, { keep: [...] })`.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAnyParentAttr(t) {
    return this._matcher.hasAnyParentAttr(t);
  }
  /**
   * Get current node's sibling position (child index in parent).
   * @returns {number}
   */
  getPosition() {
    const t = this._matcher.path;
    return t.length === 0 ? -1 : t[t.length - 1].position ?? 0;
  }
  /**
   * Get current node's repeat counter (occurrence count of this tag name).
   * @returns {number}
   */
  getCounter() {
    const t = this._matcher.path;
    return t.length === 0 ? -1 : t[t.length - 1].counter ?? 0;
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
  toString(t, e = !0) {
    return this._matcher.toString(t, e);
  }
  /**
   * Get path as array of tag names.
   * @returns {string[]}
   */
  toArray() {
    return this._matcher.path.map((t) => t.tag);
  }
  /**
   * Match current path against an Expression.
   * @param {Expression} expression
   * @returns {boolean}
   */
  matches(t) {
    return this._matcher.matches(t);
  }
  /**
   * Match any expression in the given set against the current path.
   * @param {ExpressionSet} exprSet
   * @returns {boolean}
   */
  matchesAny(t) {
    return t.matchesAny(this._matcher);
  }
}
class Lu {
  /**
   * Create a new Matcher.
   * @param {Object} [options={}]
   * @param {string} [options.separator='.'] - Default path separator
   */
  constructor(t = {}) {
    this.separator = t.separator || ".", this.path = [], this.siblingStacks = [], this._pathStringCache = null, this._view = new Cu(this), this._keptAttrs = [];
  }
  /**
   * Push a new tag onto the path.
   * @param {string} tagName
   * @param {Object|null} [attrValues=null]
   * @param {string|null} [namespace=null]
   * @param {Object|null} [options=null]
   * @param {string[]} [options.keep] - Names of attributes (from attrValues)
   */
  push(t, e = null, n = null, s = null) {
    this._pathStringCache = null, this.path.length > 0 && (this.path[this.path.length - 1].values = void 0);
    const i = this.path.length;
    let a = this.siblingStacks[i];
    a || (a = { counts: /* @__PURE__ */ new Map(), total: 0 }, this.siblingStacks[i] = a);
    const o = n ? `${n}:${t}` : t, l = a.counts.get(o) || 0, u = a.total;
    a.counts.set(o, l + 1), a.total++;
    const d = {
      tag: t,
      position: u,
      counter: l
    };
    n != null && (d.namespace = n), e != null && (d.values = e), this.path.push(d);
    const h = this.path.length, g = s !== null ? s.keep : null;
    if (g != null && g.length > 0 && e)
      for (let f = 0; f < g.length; f++) {
        const m = g[f];
        e[m] !== void 0 && this._keptAttrs.push({ depth: h, name: m, value: e[m] });
      }
  }
  /**
   * Pop the last tag from the path.
   * @returns {Object|undefined} The popped node
   */
  pop() {
    if (this.path.length === 0) return;
    this._pathStringCache = null;
    const t = this.path.pop();
    this.siblingStacks.length > this.path.length + 1 && (this.siblingStacks.length = this.path.length + 1);
    const e = this.path.length + 1;
    for (; this._keptAttrs.length > 0 && this._keptAttrs[this._keptAttrs.length - 1].depth >= e; )
      this._keptAttrs.pop();
    return t;
  }
  /**
   * Update current node's attribute values.
   * Useful when attributes are parsed after push.
   * @param {Object} attrValues
   */
  updateCurrent(t) {
    if (this.path.length > 0) {
      const e = this.path[this.path.length - 1];
      t != null && (e.values = t);
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
  getAttrValue(t) {
    var e;
    if (this.path.length !== 0)
      return (e = this.path[this.path.length - 1].values) == null ? void 0 : e[t];
  }
  /**
   * Check if current node has an attribute.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAttr(t) {
    if (this.path.length === 0) return !1;
    const e = this.path[this.path.length - 1];
    return e.values !== void 0 && t in e.values;
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
  getAnyParentAttr(t) {
    const e = this._keptAttrs;
    for (let n = e.length - 1; n >= 0; n--)
      if (e[n].name === t) return e[n].value;
  }
  /**
   * Check whether any ancestor (or the current node) kept the given
   * attribute via `push(tag, attrs, ns, { keep: [...] })`.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAnyParentAttr(t) {
    const e = this._keptAttrs;
    for (let n = e.length - 1; n >= 0; n--)
      if (e[n].name === t) return !0;
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
  toString(t, e = !0) {
    const n = t || this.separator;
    if (n === this.separator && e === !0) {
      if (this._pathStringCache !== null)
        return this._pathStringCache;
      const i = this.path.map(
        (a) => a.namespace ? `${a.namespace}:${a.tag}` : a.tag
      ).join(n);
      return this._pathStringCache = i, i;
    }
    return this.path.map(
      (i) => e && i.namespace ? `${i.namespace}:${i.tag}` : i.tag
    ).join(n);
  }
  /**
   * Get path as array of tag names.
   * @returns {string[]}
   */
  toArray() {
    return this.path.map((t) => t.tag);
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
  matches(t) {
    const e = t.segments;
    return e.length === 0 ? !1 : t.hasDeepWildcard() ? this._matchWithDeepWildcard(e) : this._matchSimple(e);
  }
  /**
   * @private
   */
  _matchSimple(t) {
    if (this.path.length !== t.length)
      return !1;
    for (let e = 0; e < t.length; e++)
      if (!this._matchSegment(t[e], this.path[e], e === this.path.length - 1))
        return !1;
    return !0;
  }
  /**
   * @private
   */
  _matchWithDeepWildcard(t) {
    let e = this.path.length - 1, n = t.length - 1;
    for (; n >= 0 && e >= 0; ) {
      const s = t[n];
      if (s.type === "deep-wildcard") {
        if (n--, n < 0)
          return !0;
        const i = t[n];
        let a = !1;
        for (let o = e; o >= 0; o--)
          if (this._matchSegment(i, this.path[o], o === this.path.length - 1)) {
            e = o - 1, n--, a = !0;
            break;
          }
        if (!a)
          return !1;
      } else {
        if (!this._matchSegment(s, this.path[e], e === this.path.length - 1))
          return !1;
        e--, n--;
      }
    }
    return n < 0;
  }
  /**
   * @private
   */
  _matchSegment(t, e, n) {
    if (t.tag !== "*" && t.tag !== e.tag || t.namespace !== void 0 && t.namespace !== "*" && t.namespace !== e.namespace || t.attrName !== void 0 && (!n || !e.values || !(t.attrName in e.values) || t.attrValue !== void 0 && String(e.values[t.attrName]) !== String(t.attrValue)))
      return !1;
    if (t.position !== void 0) {
      if (!n)
        return !1;
      const s = e.counter ?? 0;
      if (t.position === "first" && s !== 0)
        return !1;
      if (t.position === "odd" && s % 2 !== 1)
        return !1;
      if (t.position === "even" && s % 2 !== 0)
        return !1;
      if (t.position === "nth" && s !== t.positionValue)
        return !1;
    }
    return !0;
  }
  /**
   * Match any expression in the given set against the current path.
   * @param {ExpressionSet} exprSet
   * @returns {boolean}
   */
  matchesAny(t) {
    return t.matchesAny(this);
  }
  /**
   * Create a snapshot of current state.
   * @returns {Object}
   */
  snapshot() {
    return {
      path: this.path.map((t) => ({ ...t })),
      siblingStacks: this.siblingStacks.map((t) => t && { counts: new Map(t.counts), total: t.total }),
      keptAttrs: this._keptAttrs.map((t) => ({ ...t }))
    };
  }
  /**
   * Restore state from snapshot.
   * @param {Object} snapshot
   */
  restore(t) {
    this._pathStringCache = null, this.path = t.path.map((e) => ({ ...e })), this.siblingStacks = t.siblingStacks.map((e) => e && { counts: new Map(e.counts), total: e.total }), this._keptAttrs = (t.keptAttrs || []).map((e) => ({ ...e }));
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
const Tc = [
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
], xc = [
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
], Pu = [
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
], Ac = [
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
], $u = [
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
], Fu = [
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
], ae = `["'\\s]*:`, ju = [
  // ─── MongoDB $ operator injection ────────────────────────────────────────
  {
    id: "nosql-where-operator",
    description: "$where — executes arbitrary JavaScript server-side in MongoDB",
    pattern: new RegExp(`\\$where${ae}`, "i")
  },
  {
    id: "nosql-ne-operator",
    description: '$ne — "not equal" operator used to bypass equality checks',
    pattern: new RegExp(`\\$ne${ae}`, "i")
  },
  {
    id: "nosql-gt-operator",
    description: '$gt — "greater than" used to bypass password/value checks',
    pattern: new RegExp(`\\$gte?${ae}`, "i")
  },
  {
    id: "nosql-lt-operator",
    description: '$lt / $lte — "less than" bypass variants',
    pattern: new RegExp(`\\$lte?${ae}`, "i")
  },
  {
    id: "nosql-regex-operator",
    description: "$regex — can be used to extract data character by character (blind injection)",
    pattern: new RegExp(`\\$regex${ae}`, "i")
  },
  {
    id: "nosql-or-operator",
    description: "$or — logical OR; used to create always-true conditions",
    pattern: new RegExp(`\\$or${ae}\\s*\\[`, "i")
  },
  {
    id: "nosql-and-operator",
    description: "$and — logical AND operator injection",
    pattern: new RegExp(`\\$and${ae}\\s*\\[`, "i")
  },
  {
    id: "nosql-nor-operator",
    description: "$nor — logical NOR operator injection",
    pattern: new RegExp(`\\$nor${ae}\\s*\\[`, "i")
  },
  {
    id: "nosql-exists-operator",
    description: "$exists — can enumerate fields to determine schema",
    pattern: new RegExp(`\\$exists${ae}`, "i")
  },
  {
    id: "nosql-in-operator",
    description: "$in — matches any value in a list; can enumerate values",
    pattern: new RegExp(`\\$in${ae}\\s*\\[`, "i")
  },
  {
    id: "nosql-expr-operator",
    description: "$expr — allows aggregation expressions in queries (MongoDB 3.6+)",
    pattern: new RegExp(`\\$expr${ae}`, "i")
  },
  {
    id: "nosql-function-operator",
    description: "$function — executes arbitrary JavaScript in MongoDB 4.4+",
    pattern: new RegExp(`\\$function${ae}`, "i")
  },
  {
    id: "nosql-accumulator-operator",
    description: "$accumulator — custom aggregation with arbitrary JS execution",
    pattern: new RegExp(`\\$accumulator${ae}`, "i")
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
], Bu = [
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
], Uu = [
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
], Wu = [...Ac, ...Uu];
Tc.label = "HTML";
xc.label = "XML";
Pu.label = "SVG";
Ac.label = "SQL";
Wu.label = "SQL-STRICT";
$u.label = "SHELL";
Fu.label = "REDOS";
ju.label = "NOSQL";
Bu.label = "LOG";
function Du(r) {
  if (typeof r != "string")
    throw new TypeError(
      `is-unsafe: first argument must be a string, got ${typeof r}`
    );
}
function Hu(r) {
  if (!(r instanceof RegExp)) {
    if (Array.isArray(r)) {
      if (r.length === 0)
        throw new TypeError("is-unsafe: context must not be an empty array");
      if (Array.isArray(r[0])) {
        for (const t of r)
          if (!Array.isArray(t) || t.length === 0)
            throw new TypeError(
              "is-unsafe: each context in the array must be a non-empty pattern array (PatternList)"
            );
      }
      return;
    }
    throw new TypeError(
      `is-unsafe: second argument must be a PatternList (e.g. HTML), an array of PatternLists (e.g. [HTML, XML]), or a RegExp. Got: ${typeof r}`
    );
  }
}
function qu(r) {
  return r instanceof RegExp ? { lists: null, regex: r } : Array.isArray(r[0]) ? { lists: r, regex: null } : { lists: [r], regex: null };
}
function Vu(r, t) {
  const e = t.label ?? "CUSTOM";
  for (const n of t)
    if (n.pattern.test(r))
      return { context: e, id: n.id, description: n.description, pattern: n.pattern };
  return null;
}
function zu(r, t) {
  Du(r), Hu(t);
  const { lists: e, regex: n } = qu(t);
  if (n) return n.test(r);
  for (const s of e)
    if (Vu(r, s) !== null) return !0;
  return !1;
}
function Xu(r, t) {
  if (!r) return {};
  const e = t.attributesGroupName ? r[t.attributesGroupName] : r;
  if (!e) return {};
  const n = {};
  for (const s in e)
    if (s.startsWith(t.attributeNamePrefix)) {
      const i = s.substring(t.attributeNamePrefix.length);
      n[i] = e[s];
    } else
      n[s] = e[s];
  return n;
}
function Ku(r) {
  if (!r || typeof r != "string") return;
  const t = r.indexOf(":");
  if (t !== -1 && t > 0) {
    const e = r.substring(0, t);
    if (e !== "xmlns")
      return e;
  }
}
class Yu {
  constructor(t, e) {
    this.options = t, this.currentNode = null, this.tagsNodeStack = [], this.parseXml = eh, this.parseTextData = Ju, this.resolveNameSpace = Gu, this.buildAttributesMap = Zu, this.isItStopNode = sh, this.replaceEntitiesValue = nh, this.readStopNodeData = oh, this.saveTextToParentTag = rh, this.addChild = th, this.ignoreAttributesFn = Ou(this.options.ignoreAttributes), this.entityExpansionCount = 0, this.currentExpandedLength = 0, this.doctypefound = !1;
    let n = { ...mc };
    this.options.entityDecoder ? this.entityDecoder = this.options.entityDecoder : (typeof this.options.htmlEntities == "object" ? n = this.options.htmlEntities : this.options.htmlEntities === !0 && (n = { ...tu, ...eu }), this.entityDecoder = new au({
      namedEntities: { ...n, ...e },
      numericAllowed: this.options.htmlEntities,
      limit: {
        maxTotalExpansions: this.options.processEntities.maxTotalExpansions,
        maxExpandedLength: this.options.processEntities.maxExpandedLength,
        applyLimitsTo: this.options.processEntities.appliesTo
      },
      // onExternalEntity: (name, value) => isUnsafe(value) ? 'block' : 'allow',
      onInputEntity: (i, a) => (
        //TODO: VALID_CONTEXTS.HTML should be set only if this.options.htmlEntities
        zu(a, [Tc, xc]) ? wr.BLOCK : wr.ALLOW
      )
      //postCheck: resolved => resolved
    })), this.matcher = new Lu(), this.readonlyMatcher = this.matcher.readOnly(), this.isCurrentNodeStopNode = !1, this.stopNodeExpressionsSet = new Mu();
    const s = this.options.stopNodes;
    if (s && s.length > 0) {
      for (let i = 0; i < s.length; i++) {
        const a = s[i];
        typeof a == "string" ? this.stopNodeExpressionsSet.add(new ji(a)) : a instanceof ji && this.stopNodeExpressionsSet.add(a);
      }
      this.stopNodeExpressionsSet.seal();
    }
  }
}
function Ju(r, t, e, n, s, i, a) {
  const o = this.options;
  if (r !== void 0 && (o.trimValues && !n && (r = r.trim()), r.length > 0)) {
    a || (r = this.replaceEntitiesValue(r, t, e));
    const l = o.jPath ? e.toString() : e, u = o.tagValueProcessor(t, r, l, s, i);
    return u == null ? r : typeof u != typeof r || u !== r ? u : o.trimValues || r.trim() === r ? Is(r, o.parseTagValue, o.numberParseOptions) : r;
  }
}
function Gu(r) {
  if (this.options.removeNSPrefix) {
    const t = r.split(":"), e = r.charAt(0) === "/" ? "/" : "";
    if (t[0] === "xmlns")
      return "";
    t.length === 2 && (r = e + t[1]);
  }
  return r;
}
const Qu = new RegExp(`([^\\s=]+)\\s*(=\\s*(['"])([\\s\\S]*?)\\3)?`, "gm");
function Zu(r, t, e, n = !1) {
  const s = this.options;
  if (n === !0 || s.ignoreAttributes !== !0 && typeof r == "string") {
    const i = Dd(r, Qu), a = i.length, o = {}, l = new Array(a);
    let u = !1;
    const d = {};
    for (let f = 0; f < a; f++) {
      const m = this.resolveNameSpace(i[f][1]), y = i[f][4];
      if (m.length && y !== void 0) {
        let v = y;
        s.trimValues && (v = v.trim()), v = this.replaceEntitiesValue(v, e, this.readonlyMatcher), l[f] = v, d[m] = v, u = !0;
      }
    }
    u && typeof t == "object" && t.updateCurrent && t.updateCurrent(d);
    const h = s.jPath ? t.toString() : this.readonlyMatcher;
    let g = !1;
    for (let f = 0; f < a; f++) {
      const m = this.resolveNameSpace(i[f][1]);
      if (this.ignoreAttributesFn(m, h)) continue;
      let y = s.attributeNamePrefix + m;
      if (m.length)
        if (s.transformAttributeName && (y = s.transformAttributeName(y)), y = Rc(y, s), i[f][4] !== void 0) {
          const v = l[f], T = s.attributeValueProcessor(m, v, h);
          T == null ? o[y] = v : typeof T != typeof v || T !== v ? o[y] = T : o[y] = Is(v, s.parseAttributeValue, s.numberParseOptions), g = !0;
        } else s.allowBooleanAttributes && (o[y] = !0, g = !0);
    }
    if (!g) return;
    if (s.attributesGroupName && !s.preserveOrder) {
      const f = {};
      return f[s.attributesGroupName] = o, f;
    }
    return o;
  }
}
const eh = function(r) {
  r = r.replace(/\r\n?/g, `
`);
  const t = new Be("!xml");
  let e = t, n = "";
  this.matcher.reset(), this.entityDecoder.reset(), this.entityExpansionCount = 0, this.currentExpandedLength = 0, this.doctypefound = !1;
  const s = this.options, i = new _u(s.processEntities), a = r.length;
  for (let o = 0; o < a; o++)
    if (r[o] === "<") {
      const u = r.charCodeAt(o + 1);
      if (u === 47) {
        const d = Ot(r, ">", o, "Closing Tag is not closed.");
        let h = r.substring(o + 2, d).trim();
        if (s.removeNSPrefix) {
          const f = h.indexOf(":");
          f !== -1 && (h = h.substr(f + 1));
        }
        h = $r(s.transformTagName, h, "", s).tagName, e && (n = this.saveTextToParentTag(n, e, this.readonlyMatcher));
        const g = this.matcher.getCurrentTag();
        if (h && s.unpairedTagsSet.has(h))
          throw new Error(`Unpaired tag can not be used as closing tag: </${h}>`);
        g && s.unpairedTagsSet.has(g) && (this.matcher.pop(), this.tagsNodeStack.pop()), this.matcher.pop(), this.isCurrentNodeStopNode = !1, e = this.tagsNodeStack.pop() || t, s.captureMetaData && e && e.addEndIndex(d + 1), n = "", o = d;
      } else if (u === 63) {
        let d = Rs(r, o, !1, "?>");
        if (!d) throw new Error("Pi Tag is not closed.");
        n = this.saveTextToParentTag(n, e, this.readonlyMatcher);
        const h = this.buildAttributesMap(d.tagExp, this.matcher, d.tagName, !0);
        if (h) {
          const g = h[this.options.attributeNamePrefix + "version"];
          this.entityDecoder.setXmlVersion(Number(g) || 1), i.setXmlVersion(Number(g) || 1);
        }
        if (!(s.ignoreDeclaration && d.tagName === "?xml" || s.ignorePiTags)) {
          const g = new Be(d.tagName);
          g.add(s.textNodeName, ""), d.tagName !== d.tagExp && d.attrExpPresent && s.ignoreAttributes !== !0 && (g[":@"] = h), this.addChild(e, g, this.readonlyMatcher, o), s.captureMetaData && e.addEndIndex(d.closeIndex + 2);
        }
        o = d.closeIndex + 1;
      } else if (u === 33 && r.charCodeAt(o + 2) === 45 && r.charCodeAt(o + 3) === 45) {
        const d = Ot(r, "-->", o + 4, "Comment is not closed.");
        if (s.commentPropName) {
          const h = r.substring(o + 4, d - 2);
          n = this.saveTextToParentTag(n, e, this.readonlyMatcher), e.add(s.commentPropName, [{ [s.textNodeName]: h }]);
        }
        o = d;
      } else if (u === 33 && r.charCodeAt(o + 2) === 68) {
        if (this.doctypefound) throw new Error("Multiple DOCTYPE declarations found.");
        this.doctypefound = !0;
        const d = i.readDocType(r, o);
        this.entityDecoder.addInputEntities(d.entities), o = d.i;
      } else if (u === 33 && r.charCodeAt(o + 2) === 91) {
        const d = Ot(r, "]]>", o, "CDATA is not closed.") - 2, h = r.substring(o + 9, d);
        n = this.saveTextToParentTag(n, e, this.readonlyMatcher);
        let g = this.parseTextData(h, e.tagname, this.readonlyMatcher, !0, !1, !0, !0);
        g == null && (g = ""), s.cdataPropName ? e.add(s.cdataPropName, [{ [s.textNodeName]: h }]) : e.add(s.textNodeName, g), o = d + 2;
      } else {
        let d = Rs(r, o, s.removeNSPrefix);
        if (!d) {
          const S = r.substring(Math.max(0, o - 50), Math.min(a, o + 50));
          throw new Error(`readTagExp returned undefined at position ${o}. Context: "${S}"`);
        }
        let h = d.tagName;
        const g = d.rawTagName;
        let f = d.tagExp, m = d.attrExpPresent, y = d.closeIndex;
        if ({ tagName: h, tagExp: f } = $r(s.transformTagName, h, f, s), s.strictReservedNames && (h === s.commentPropName || h === s.cdataPropName || h === s.textNodeName || h === s.attributesGroupName))
          throw new Error(`Invalid tag name: ${h}`);
        e && n && e.tagname !== "!xml" && (n = this.saveTextToParentTag(n, e, this.readonlyMatcher, !1));
        const v = e;
        v && s.unpairedTagsSet.has(v.tagname) && (e = this.tagsNodeStack.pop(), this.matcher.pop());
        let T = !1;
        f.length > 0 && f.lastIndexOf("/") === f.length - 1 && (T = !0, h[h.length - 1] === "/" ? (h = h.substr(0, h.length - 1), f = h) : f = f.substr(0, f.length - 1), m = h !== f);
        let b = null, N;
        N = Ku(g), h !== t.tagname && this.matcher.push(h, {}, N), h !== f && m && (b = this.buildAttributesMap(f, this.matcher, h), b && Xu(b, s)), h !== t.tagname && (this.isCurrentNodeStopNode = this.isItStopNode());
        const x = o;
        if (this.isCurrentNodeStopNode) {
          let S = "";
          if (T)
            o = d.closeIndex;
          else if (s.unpairedTagsSet.has(h))
            o = d.closeIndex;
          else {
            const P = this.readStopNodeData(r, g, y + 1);
            if (!P) throw new Error(`Unexpected end of ${g}`);
            o = P.i, S = P.tagContent;
          }
          const A = new Be(h);
          b && (A[":@"] = b), A.add(s.textNodeName, S), this.matcher.pop(), this.isCurrentNodeStopNode = !1, this.addChild(e, A, this.readonlyMatcher, x), s.captureMetaData && e.addEndIndex(o + 1);
        } else {
          if (T) {
            ({ tagName: h, tagExp: f } = $r(s.transformTagName, h, f, s));
            const S = new Be(h);
            b && (S[":@"] = b), this.addChild(e, S, this.readonlyMatcher, x), s.captureMetaData && e.addEndIndex(y + 1), this.matcher.pop(), this.isCurrentNodeStopNode = !1;
          } else if (s.unpairedTagsSet.has(h)) {
            const S = new Be(h);
            b && (S[":@"] = b), this.addChild(e, S, this.readonlyMatcher, x), s.captureMetaData && e.addEndIndex(d.closeIndex + 1), this.matcher.pop(), this.isCurrentNodeStopNode = !1, o = d.closeIndex;
            continue;
          } else {
            const S = new Be(h);
            if (this.tagsNodeStack.length > s.maxNestedTags)
              throw new Error("Maximum nested tags exceeded");
            this.tagsNodeStack.push(e), b && (S[":@"] = b), this.addChild(e, S, this.readonlyMatcher, x), e = S;
          }
          n = "", o = y;
        }
      }
    } else
      n += r[o];
  return t.child;
};
function th(r, t, e, n) {
  this.options.captureMetaData || (n = void 0);
  const s = this.options.jPath ? e.toString() : e, i = this.options.updateTag(t.tagname, s, t[":@"]);
  i === !1 || (typeof i == "string" && (t.tagname = i), r.addChild(t, n));
}
function nh(r, t, e) {
  const n = this.options.processEntities;
  if (!n || !n.enabled)
    return r;
  if (n.allowedTags) {
    const s = this.options.jPath ? e.toString() : e;
    if (!(Array.isArray(n.allowedTags) ? n.allowedTags.includes(t) : n.allowedTags(t, s)))
      return r;
  }
  if (n.tagFilter) {
    const s = this.options.jPath ? e.toString() : e;
    if (!n.tagFilter(t, s))
      return r;
  }
  return this.entityDecoder.decode(r);
}
function rh(r, t, e, n) {
  return r && (n === void 0 && (n = t.child.length === 0), r = this.parseTextData(
    r,
    t.tagname,
    e,
    !1,
    t[":@"] ? Object.keys(t[":@"]).length !== 0 : !1,
    n
  ), r !== void 0 && r !== "" && t.add(this.options.textNodeName, r), r = ""), r;
}
function sh() {
  return this.stopNodeExpressionsSet.size === 0 ? !1 : this.matcher.matchesAny(this.stopNodeExpressionsSet);
}
function ih(r, t, e = ">") {
  let n = 0;
  const s = r.length, i = e.charCodeAt(0), a = e.length > 1 ? e.charCodeAt(1) : -1;
  let o = "", l = t;
  for (let u = t; u < s; u++) {
    const d = r.charCodeAt(u);
    if (n)
      d === n && (n = 0);
    else if (d === 34 || d === 39)
      n = d;
    else if (d === i)
      if (a !== -1) {
        if (r.charCodeAt(u + 1) === a)
          return o += r.substring(l, u), { data: o, index: u };
      } else
        return o += r.substring(l, u), { data: o, index: u };
    else d === 9 && !n && (o += r.substring(l, u) + " ", l = u + 1);
  }
}
function Ot(r, t, e, n) {
  const s = r.indexOf(t, e);
  if (s === -1)
    throw new Error(n);
  return s + t.length - 1;
}
function ah(r, t, e, n) {
  const s = r.indexOf(t, e);
  if (s === -1) throw new Error(n);
  return s;
}
function Rs(r, t, e, n = ">") {
  const s = ih(r, t + 1, n);
  if (!s) return;
  let i = s.data;
  const a = s.index, o = i.search(/\s/);
  let l = i, u = !0;
  o !== -1 && (l = i.substring(0, o), i = i.substring(o + 1).trimStart());
  const d = l;
  if (e) {
    const h = l.indexOf(":");
    h !== -1 && (l = l.substr(h + 1), u = l !== s.data.substr(h + 1));
  }
  return {
    tagName: l,
    tagExp: i,
    closeIndex: a,
    attrExpPresent: u,
    rawTagName: d
  };
}
function oh(r, t, e) {
  const n = e;
  let s = 1;
  const i = r.length;
  for (; e < i; e++)
    if (r[e] === "<") {
      const a = r.charCodeAt(e + 1);
      if (a === 47) {
        const o = ah(r, ">", e, `${t} is not closed`);
        if (r.substring(e + 2, o).trim() === t && (s--, s === 0))
          return {
            tagContent: r.substring(n, e),
            i: o
          };
        e = o;
      } else if (a === 63)
        e = Ot(r, "?>", e + 1, "StopNode is not closed.");
      else if (a === 33 && r.charCodeAt(e + 2) === 45 && r.charCodeAt(e + 3) === 45)
        e = Ot(r, "-->", e + 3, "StopNode is not closed.");
      else if (a === 33 && r.charCodeAt(e + 2) === 91)
        e = Ot(r, "]]>", e, "StopNode is not closed.") - 2;
      else {
        const o = Rs(r, e, !1);
        o && ((o && o.tagName) === t && o.tagExp[o.tagExp.length - 1] !== "/" && s++, e = o.closeIndex);
      }
    }
}
function Is(r, t, e) {
  if (t && typeof r == "string") {
    const n = r.trim();
    return n === "true" ? !0 : n === "false" ? !1 : xu(r, e);
  } else
    return Hd(r) ? r : "";
}
function $r(r, t, e, n) {
  if (r) {
    const s = r(t);
    e === t && (e = s), t = s;
  }
  return t = Rc(t, n), { tagName: t, tagExp: e };
}
function Rc(r, t) {
  if (gc.includes(r))
    throw new Error(`[SECURITY] Invalid name: "${r}" is a reserved JavaScript keyword that could cause prototype pollution`);
  return ti.includes(r) ? t.onDangerousProperty(r) : r;
}
const Fr = Be.getMetaDataSymbol();
function ch(r, t) {
  if (!r || typeof r != "object") return {};
  if (!t) return r;
  const e = {};
  for (const n in r)
    if (n.startsWith(t)) {
      const s = n.substring(t.length);
      e[s] = r[n];
    } else
      e[n] = r[n];
  return e;
}
function lh(r, t, e, n) {
  return Ic(r, t, e, n);
}
function Ic(r, t, e, n) {
  let s;
  const i = {};
  for (let a = 0; a < r.length; a++) {
    const o = r[a], l = dh(o);
    if (l !== void 0 && l !== t.textNodeName) {
      const u = ch(
        o[":@"] || {},
        t.attributeNamePrefix
      );
      e.push(l, u);
    }
    if (l === t.textNodeName)
      s === void 0 ? s = o[l] : s += "" + o[l];
    else {
      if (l === void 0)
        continue;
      if (o[l]) {
        let u = Ic(o[l], t, e, n);
        const d = hh(u, t);
        if (Object.keys(u).length === 0 && t.alwaysCreateTextNode && (u[t.textNodeName] = ""), o[":@"] ? uh(u, o[":@"], n, t) : Object.keys(u).length === 1 && u[t.textNodeName] !== void 0 && !t.alwaysCreateTextNode ? u = u[t.textNodeName] : Object.keys(u).length === 0 && (t.alwaysCreateTextNode ? u[t.textNodeName] = "" : u = ""), o[Fr] !== void 0 && typeof u == "object" && u !== null && (u[Fr] = o[Fr]), i[l] !== void 0 && Object.prototype.hasOwnProperty.call(i, l))
          Array.isArray(i[l]) || (i[l] = [i[l]]), i[l].push(u);
        else {
          const h = t.jPath ? n.toString() : n;
          t.isArray(l, h, d) ? i[l] = [u] : i[l] = u;
        }
        l !== void 0 && l !== t.textNodeName && e.pop();
      }
    }
  }
  return typeof s == "string" ? s.length > 0 && (i[t.textNodeName] = s) : s !== void 0 && (i[t.textNodeName] = s), i;
}
function dh(r) {
  const t = Object.keys(r);
  for (let e = 0; e < t.length; e++) {
    const n = t[e];
    if (n !== ":@") return n;
  }
}
function uh(r, t, e, n) {
  if (t) {
    const s = Object.keys(t), i = s.length;
    for (let a = 0; a < i; a++) {
      const o = s[a], l = o.startsWith(n.attributeNamePrefix) ? o.substring(n.attributeNamePrefix.length) : o, u = n.jPath ? e.toString() + "." + l : e;
      n.isArray(o, u, !0, !0) ? r[o] = [t[o]] : r[o] = t[o];
    }
  }
}
function hh(r, t) {
  const { textNodeName: e } = t, n = Object.keys(r).length;
  return !!(n === 0 || n === 1 && (r[e] || typeof r[e] == "boolean" || r[e] === 0));
}
class fh {
  constructor(t) {
    this.externalEntities = {}, this.options = lu(t);
  }
  /**
   * Parse XML dats to JS object 
   * @param {string|Uint8Array} xmlData 
   * @param {boolean|Object} validationOption 
   */
  parse(t, e) {
    if (typeof t != "string" && t.toString)
      t = t.toString();
    else if (typeof t != "string")
      throw new Error("XML data is accepted in String or Bytes[] form.");
    if (e) {
      e === !0 && (e = {});
      const i = Vd(t, e);
      if (i !== !0)
        throw Error(`${i.err.msg}:${i.err.line}:${i.err.col}`);
    }
    const n = new Yu(this.options, this.externalEntities), s = n.parseXml(t);
    return this.options.preserveOrder || s === void 0 ? s : lh(s, this.options, n.matcher, n.readonlyMatcher);
  }
  /**
   * Add Entity which is not by default supported by this library
   * @param {string} key 
   * @param {string} value 
   */
  addEntity(t, e) {
    if (e.indexOf("&") !== -1)
      throw new Error("Entity value can't have '&'");
    if (t.indexOf("&") !== -1 || t.indexOf(";") !== -1)
      throw new Error("An entity must be set without '&' and ';'. Eg. use '#xD' for '&#xD;'");
    if (e === "&")
      throw new Error("An entity with value '&' is not permitted");
    this.externalEntities[t] = e;
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
    return Be.getMetaDataSymbol();
  }
}
function Nc(r) {
  return r.map((t) => ({ ...t, slides: t.slides.filter((e) => e.length > 0) })).filter((t) => t.slides.length > 0).map((t) => {
    const e = t.slides.map((n) => n.join(`
`)).join(`

`);
    return t.label ? `[${t.label}]
${e}` : e;
  }).join(`

`);
}
function ri(r) {
  var t, e;
  return {
    title: r.title.trim(),
    author: ((t = r.author) == null ? void 0 : t.trim()) || null,
    copyright: ((e = r.copyright) == null ? void 0 : e.trim()) || null,
    tags: r.tags ?? [],
    arrangement: r.arrangement ?? Nr,
    themeId: null,
    lyrics: r.lyrics ?? ""
  };
}
const Bi = /^(author|copyright|tags|order|lines per slide):\s*(.*)$/i;
function ph(r, t) {
  var a;
  const e = r.replace(/^\uFEFF/, "").replace(/\r\n?/g, `
`).split(`
`);
  for (; e.length && e[0].trim() === ""; ) e.shift();
  const n = ((a = e.shift()) == null ? void 0 : a.trim()) || t, s = {}, i = { ...Nr };
  for (let o = Bi.exec(e[0] ?? ""); o; o = Bi.exec(e[0] ?? "")) {
    e.shift();
    const [, l, u] = o;
    switch (l.toLowerCase()) {
      case "author":
        s.author = u;
        break;
      case "copyright":
        s.copyright = u;
        break;
      case "tags":
        s.tags = u.split(",").map((d) => d.trim()).filter(Boolean);
        break;
      case "order":
        i.order = u.split(",").map((d) => d.trim()).filter(Boolean);
        break;
      case "lines per slide": {
        const d = Number(u);
        sc.includes(d) && (i.linesPerSlide = d);
        break;
      }
    }
  }
  return ri({ ...s, title: n, arrangement: i, lyrics: e.join(`
`).trim() });
}
function gh(r) {
  const t = [
    r.author && `Author: ${r.author}`,
    r.copyright && `Copyright: ${r.copyright}`,
    r.tags.length > 0 && `Tags: ${r.tags.join(", ")}`,
    r.arrangement.order.length > 0 && `Order: ${r.arrangement.order.join(", ")}`,
    r.arrangement.linesPerSlide && `Lines per slide: ${r.arrangement.linesPerSlide}`
  ].filter(Boolean);
  return `${[r.title, ...t].join(`
`)}

${r.lyrics.replace(/\r\n?/g, `
`).trim()}
`;
}
const mh = new fh({
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
function si(r) {
  return Object.keys(r).find((t) => t !== ":@" && t !== "#text");
}
function Ne(r) {
  var t;
  return (t = si(r)) == null ? void 0 : t.replace(/^.*:/, "");
}
function kn(r) {
  const t = r && si(r);
  return t ? r[t] : [];
}
function Ui(r, t) {
  var e;
  return (e = r[":@"]) == null ? void 0 : e[`@_${t}`];
}
function pe(r, t) {
  return kn(r).find((e) => Ne(e) === t);
}
function Cn(r, t) {
  return kn(r).filter((e) => Ne(e) === t);
}
function De(r) {
  if (!r) return "";
  if ("#text" in r) return String(r["#text"]);
  const t = Ne(r);
  if (t === "br") return `
`;
  if (t === "comment" || t === "chord") return "";
  const e = kn(r).map(De).join("");
  return t === "line" ? `${e}
` : e;
}
function Tt(r) {
  return r.split(`
`).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function _h(r) {
  const t = [], e = (n) => {
    if ("#text" in n) t.push(String(n["#text"]).replace(/\s+/g, " "));
    else if (Ne(n) === "br") t.push(`
`);
    else {
      if (Ne(n) === "comment" || Ne(n) === "chord") return;
      kn(n).forEach(e), Ne(n) === "line" && t.push(`
`);
    }
  };
  return kn(r).forEach(e), Tt(t.join(""));
}
function wh(r) {
  return mh.parse(r).find((e) => {
    var n;
    return Ne(e) !== void 0 && !((n = si(e)) != null && n.startsWith("?"));
  });
}
const yh = {
  v: "Verse",
  c: "Chorus",
  b: "Bridge",
  p: "Pre-Chorus",
  i: "Intro",
  e: "Ending",
  o: "Other"
};
function Wi(r) {
  const t = /^([a-z])(\d*)([a-z]?)$/i.exec(r.trim()), e = t && yh[t[1].toLowerCase()];
  if (!t || !e) return r.trim();
  const n = `${t[2]}${t[3]}`;
  return n ? `${e} ${n}` : e;
}
function bh(r, t) {
  const e = pe(r, "properties"), n = Tt(De(pe(pe(e, "titles"), "title"))).join(" "), s = Cn(pe(e, "authors"), "author").filter((u) => Ui(u, "type") !== "translation").map((u) => Tt(De(u)).join(" ")).filter(Boolean), i = Cn(pe(e, "themes"), "theme").map((u) => Tt(De(u)).join(" ")).filter(Boolean), a = De(pe(e, "verseOrder")).split(/\s+/).filter(Boolean).map(Wi), o = /* @__PURE__ */ new Set(), l = [];
  for (const u of Cn(pe(r, "lyrics"), "verse")) {
    const d = Ui(u, "name") ?? `o${l.length + 1}`;
    o.has(d) || (o.add(d), l.push({ label: Wi(d), slides: Cn(u, "lines").map(_h) }));
  }
  return ri({
    title: n || t,
    author: s.join(", "),
    copyright: Tt(De(pe(e, "copyright"))).join(" "),
    tags: [...new Set(i)],
    arrangement: { order: a, linesPerSlide: null },
    lyrics: Nc(l)
  });
}
const Eh = {
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
function Sh(r, t) {
  const e = r ? /^([a-z-]+)\s*(\d*)([a-z]?)$/i.exec(r.trim()) : null, n = e ? Eh[e[1].toLowerCase()] : void 0, s = n ?? "o", i = e && n ? `${s}${e[2]}${e[3]}` : "";
  if (i && !t.has(i)) return i;
  let a = 1;
  for (; t.has(`${s}${a}`); ) a++;
  return `${s}${a}`;
}
const Yt = (r) => r.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function kh(r) {
  const t = /* @__PURE__ */ new Set(), e = /* @__PURE__ */ new Map(), n = ac(r.lyrics).map((a) => {
    var d;
    const o = Sh(a.label, t);
    t.add(o);
    const l = (d = a.label) == null ? void 0 : d.toLowerCase();
    l && !e.has(l) && e.set(l, o);
    const u = a.chunks.map((h) => `      <lines>${h.lines.map(Yt).join("<br/>")}</lines>`);
    return `    <verse name="${o}">
${u.join(`
`)}
    </verse>`;
  }), s = r.arrangement.order.map((a) => e.get(a.trim().toLowerCase())).filter((a) => a !== void 0), i = [
    `    <titles>
      <title>${Yt(r.title)}</title>
    </titles>`,
    r.author && `    <authors>
${r.author.split(",").map((a) => a.trim()).filter(Boolean).map((a) => `      <author>${Yt(a)}</author>`).join(`
`)}
    </authors>`,
    r.copyright && `    <copyright>${Yt(r.copyright)}</copyright>`,
    s.length > 0 && `    <verseOrder>${s.join(" ")}</verseOrder>`,
    r.tags.length > 0 && `    <themes>
${r.tags.map((a) => `      <theme>${Yt(a)}</theme>`).join(`
`)}
    </themes>`
  ].filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9" createdIn="WorshipDeck" modifiedDate="${(/* @__PURE__ */ new Date()).toISOString()}">
  <properties>
${i.join(`
`)}
  </properties>
  <lyrics>
${n.join(`
`)}
  </lyrics>
</song>
`;
}
const vh = {
  V: "Verse",
  C: "Chorus",
  B: "Bridge",
  P: "Pre-Chorus",
  T: "Tag",
  I: "Intro",
  E: "Ending"
};
function Oc(r) {
  const t = /^([A-Za-z])(\d*)$/.exec(r.trim()), e = t && vh[t[1].toUpperCase()];
  return !t || !e ? r.trim() : t[2] ? `${e} ${t[2]}` : e;
}
function Th(r) {
  const t = /* @__PURE__ */ new Map(), e = /* @__PURE__ */ new Map();
  let n = "", s = null;
  const i = (o) => {
    let l = t.get(o);
    return l || (l = { label: o ? Oc(o) : null, slides: [[]] }, t.set(o, l), e.set(n, [...e.get(n) ?? [], o])), l;
  }, a = (o) => {
    const l = o !== null ? t.get(o) : void 0;
    l && l.slides[l.slides.length - 1].length > 0 && l.slides.push([]);
  };
  for (const o of r.replace(/\r\n?/g, `
`).split(`
`)) {
    const l = /^\s*\[([^\]]+)\]\s*$/.exec(o);
    if (l) {
      n = l[1].trim(), s = null;
      continue;
    }
    if (o.startsWith(".") || o.startsWith(";")) continue;
    const u = /^(\d)(.*)$/.exec(o), d = u && !/\d$/.test(n) ? `${n}${u[1]}` : n, h = (u ? u[2] : o).replace(/_/g, "");
    if (h.trim() === "") {
      a(u ? d : s);
      continue;
    }
    const g = i(d);
    s = d, h.split("||").forEach((m, y) => {
      y > 0 && a(d);
      for (const v of m.split("|")) {
        const T = v.replace(/\s+/g, " ").trim();
        T && g.slides[g.slides.length - 1].push(T);
      }
    });
  }
  return { sections: [...t.values()], groups: e };
}
function xh(r, t) {
  const e = (o) => Tt(De(pe(r, o))).join(" "), { sections: n, groups: s } = Th(De(pe(r, "lyrics"))), i = e("presentation").split(/\s+/).filter(Boolean).flatMap((o) => (s.get(o) ?? [o]).map(Oc)), a = ["theme", "alttheme"].flatMap((o) => e(o).split(/[;,]/)).map((o) => o.trim()).filter(Boolean);
  return ri({
    title: e("title") || t,
    author: e("author"),
    copyright: e("copyright"),
    tags: [...new Set(a)],
    arrangement: { order: i, linesPerSlide: null },
    lyrics: Nc(n)
  });
}
function Ah(r, t) {
  let e;
  try {
    e = wh(r.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Not valid XML");
  }
  if (!e || Ne(e) !== "song") throw new Error("Not an OpenLyrics or OpenSong song");
  if (pe(e, "properties")) return { format: "openlyrics", song: bh(e, t) };
  if (pe(e, "lyrics")) return { format: "opensong", song: xh(e, t) };
  throw new Error("Not an OpenLyrics or OpenSong song");
}
const Di = 2e3, Rh = 5 * 1024 * 1024, Ih = /* @__PURE__ */ new Set([".txt", ".xml", ""]);
async function Nh(r, t) {
  const e = [];
  for (const n of r)
    try {
      if ((await Xs(n)).isDirectory()) {
        const s = await ec(n, { withFileTypes: !0 });
        for (const i of s.sort((a, o) => a.name.localeCompare(o.name)))
          !i.isFile() || i.name.startsWith(".") || Ih.has(O.extname(i.name).toLowerCase()) && e.push({ file: O.join(n, i.name), source: `${O.basename(n)}/${i.name}` });
      } else
        e.push({ file: n, source: O.basename(n) });
    } catch (s) {
      t.push({ source: O.basename(n), error: s instanceof Error ? s.message : String(s) });
    }
  return e;
}
async function Oh(r) {
  const { size: t } = await Xs(r.file);
  if (t > Rh) throw new Error("File is larger than 5 MB");
  const e = (await Ks(r.file, "utf8")).replace(/^\uFEFF/, ""), n = O.extname(r.file).toLowerCase(), s = O.basename(r.file, n);
  if (n === ".txt") return { source: r.source, format: "text", song: ph(e, s) };
  if (!e.trimStart().startsWith("<")) throw new Error("Not a text, OpenLyrics or OpenSong song");
  return { source: r.source, ...Ah(e, s) };
}
async function jr(r) {
  const t = [], e = await Nh(r, t);
  if (e.length > Di)
    return { songs: [], problems: [{ source: `${e.length} files`, error: `Pick at most ${Di} files at a time` }] };
  const n = (o) => o.trim().toLowerCase(), s = new Set(Gs().map((o) => n(o.title))), i = /* @__PURE__ */ new Set(), a = [];
  for (const o of e)
    try {
      const l = await Oh(o);
      if (!l.song.title) throw new Error("No title found");
      const u = n(l.song.title);
      a.push({ ...l, duplicateOf: s.has(u) ? "library" : i.has(u) ? "import" : null }), i.add(u);
    } catch (l) {
      t.push({ source: o.source, error: l instanceof Error ? l.message : String(l) });
    }
  return { songs: a, problems: t };
}
function Ns(r, t, e) {
  const n = [...r].filter((i) => i.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(i)).join("").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
  let s = `${n}${t}`;
  for (let i = 2; e.has(s.toLowerCase()); i++) s = `${n} (${i})${t}`;
  return e.add(s.toLowerCase()), s;
}
function Mh(r) {
  return (r ?? Gs().map((e) => e.id)).map((e) => lc(e)).filter((e) => e !== void 0);
}
const br = { openlyrics: ".xml", text: ".txt" };
function Ch(r, t) {
  return Ns(r.title, br[t], /* @__PURE__ */ new Set());
}
function Mc(r, t) {
  return t === "openlyrics" ? kh(r) : gh(r);
}
async function Lh(r, t, e) {
  await Ir(e, Mc(r, t), "utf8");
}
async function Ph(r, t, e) {
  const n = /* @__PURE__ */ new Set();
  for (const s of r) {
    let i = Ns(s.title, br[t], n);
    for (; tc(O.join(e, i)); ) i = Ns(s.title, br[t], n);
    await Ir(O.join(e, i), Mc(s, t), "utf8");
  }
  return r.length;
}
const Hi = ["openlyrics", "text"], $h = [
  { name: "Songs (text, OpenLyrics, OpenSong)", extensions: ["txt", "xml"] },
  // OpenSong song files usually have no extension.
  { name: "All files", extensions: ["*"] }
];
function Br(r) {
  return ct.fromWebContents(r.sender) ?? void 0;
}
function Fh(r) {
  if (!Array.isArray(r) || r.length === 0 || !r.every((t) => typeof t == "string" && O.isAbsolute(t)))
    throw new TypeError("Paths must be a non-empty list of absolute paths");
  return r;
}
function jh(r) {
  if (r === null) return null;
  if (!Array.isArray(r) || !r.every((t) => Number.isInteger(t) && t > 0))
    throw new TypeError("Song ids must be a list of positive integers, or null for every song");
  return r;
}
function Bh(r) {
  if (!Hi.includes(r))
    throw new TypeError(`Export format must be one of ${Hi.join(", ")}`);
  return r;
}
function Uh() {
  R.handle("songFiles:pickFiles", async (r) => {
    const t = {
      title: "Import songs",
      properties: ["openFile", "multiSelections"],
      filters: $h
    }, e = Br(r), { canceled: n, filePaths: s } = e ? await fe.showOpenDialog(e, t) : await fe.showOpenDialog(t);
    return n || s.length === 0 ? null : jr(s);
  }), R.handle("songFiles:pickFolder", async (r) => {
    const t = { title: "Import a folder of songs", properties: ["openDirectory"] }, e = Br(r), { canceled: n, filePaths: s } = e ? await fe.showOpenDialog(e, t) : await fe.showOpenDialog(t);
    return n || s.length === 0 ? null : jr(s);
  }), R.handle("songFiles:scan", (r, t) => jr(Fh(t))), R.handle("songFiles:import", (r, t) => {
    if (!Array.isArray(t)) throw new TypeError("Songs must be a list");
    return gd(t.map(ks));
  }), R.handle(
    "songFiles:export",
    async (r, t, e) => {
      const n = jh(t), s = Bh(e), i = Mh(n);
      if (i.length === 0) throw new Error("There are no songs to export");
      const a = Br(r);
      if (i.length === 1 && n !== null) {
        const d = {
          title: "Export song",
          defaultPath: Ch(i[0], s),
          filters: [{ name: s === "openlyrics" ? "OpenLyrics XML" : "Text", extensions: [br[s].slice(1)] }]
        }, { canceled: h, filePath: g } = a ? await fe.showSaveDialog(a, d) : await fe.showSaveDialog(d);
        return h || !g ? null : (await Lh(i[0], s, g), { written: 1, location: g });
      }
      const o = {
        title: `Choose a folder for ${i.length} songs`,
        buttonLabel: "Export here",
        properties: ["openDirectory", "createDirectory"]
      }, { canceled: l, filePaths: u } = a ? await fe.showOpenDialog(a, o) : await fe.showOpenDialog(o);
      return l || u.length === 0 ? null : { written: await Ph(i, s, u[0]), location: u[0] };
    }
  );
}
function Ur(r) {
  if (!Number.isInteger(r) || r < 1) throw new TypeError("Theme id must be a positive integer");
  return r;
}
function qi(r) {
  if (typeof r != "string" || r.trim() === "") throw new TypeError("Theme needs a non-empty name");
  return r.trim();
}
function Wh(r) {
  if (!Ss.includes(r))
    throw new TypeError(`Content type must be one of ${Ss.join(", ")}`);
  return r;
}
function Dh() {
  R.handle("themes:list", () => sd()), R.handle(
    "themes:create",
    (r, t, e) => id(qi(t), ot(e))
  ), R.handle(
    "themes:update",
    (r, t, e, n) => ad(Ur(t), qi(e), ot(n))
  ), R.handle("themes:delete", (r, t) => od(Ur(t))), R.handle("themes:getDefaults", () => cd()), R.handle(
    "themes:setDefault",
    (r, t, e) => ld(Wh(t), Ur(e))
  );
}
const ii = "wd-media", Ft = () => O.join(at.getPath("userData"), "media");
function Hh() {
  Qo.registerSchemesAsPrivileged([
    { scheme: ii, privileges: { standard: !0, secure: !0, supportFetchAPI: !0, stream: !0, corsEnabled: !0 } }
  ]);
}
function qh() {
  Qo.handle(ii, async (r) => {
    const t = decodeURIComponent(new URL(r.url).pathname.replace(/^\//, ""));
    if (!t || t !== O.basename(t) || t.startsWith(".")) return new Response("Not found", { status: 404 });
    const e = await Zo.fetch(zl(O.join(Ft(), t)).toString(), { headers: r.headers }), n = new Headers(e.headers);
    return n.set("Access-Control-Allow-Origin", "*"), new Response(e.body, { status: e.status, statusText: e.statusText, headers: n });
  });
}
const jt = (r) => `${ii}://local/${encodeURIComponent(r)}`;
function Cc(r, t) {
  const e = r.replace(/[^\w.-]+/g, "-").slice(0, 60) || "media";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${e}${t}`;
}
async function Os(r) {
  await Ys(Ft(), { recursive: !0 });
  const t = O.extname(r).toLowerCase(), e = Cc(O.basename(r, O.extname(r)), t);
  return await Yl(r, O.join(Ft(), e)), e;
}
async function Vi(r, t, e) {
  await Ys(Ft(), { recursive: !0 });
  const n = Cc(t, e);
  return await Ir(O.join(Ft(), n), r), n;
}
async function Wr(r) {
  r && r === O.basename(r) && await Js(O.join(Ft(), r), { force: !0 });
}
function ai(r) {
  let t = [];
  try {
    t = JSON.parse(r.tags);
  } catch {
  }
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    url: jt(r.file),
    thumbUrl: r.thumb ? jt(r.thumb) : null,
    tags: Array.isArray(t) ? t.filter((e) => typeof e == "string") : []
  };
}
const Lc = "SELECT id, name, kind, file, thumb, tags FROM media";
function Vh() {
  return k.prepare(`${Lc} ORDER BY id DESC`).all().map(ai);
}
function oi(r) {
  return k.prepare(`${Lc} WHERE id = ?`).get(r);
}
function Ms(r) {
  const t = oi(r);
  return t && ai(t);
}
function zh(r, t, e) {
  const n = k.prepare("INSERT INTO media (name, kind, file) VALUES (?, ?, ?)").run(r, t, e);
  return Ms(Number(n.lastInsertRowid));
}
function Xh(r, t, e) {
  return k.prepare("UPDATE media SET name = ?, tags = ? WHERE id = ?").run(t, JSON.stringify(e), r).changes > 0;
}
function Kh(r, t) {
  const e = oi(r);
  if (e)
    return k.prepare("UPDATE media SET thumb = ? WHERE id = ?").run(t, r), e.thumb;
}
const Yh = k.transaction((r) => {
  var i;
  const t = oi(r);
  if (!t) return;
  const e = jt(t.file), n = k.prepare("SELECT id, json FROM themes WHERE type = 'custom'").all(), s = k.prepare("UPDATE themes SET json = ? WHERE id = ?");
  for (const a of n)
    try {
      const o = JSON.parse(a.json);
      ((i = o == null ? void 0 : o.background) == null ? void 0 : i.src) === e && s.run(JSON.stringify({ ...o, background: { kind: "solid", color: "#000000" } }), a.id);
    } catch {
    }
  return k.prepare("DELETE FROM media WHERE id = ?").run(r), t;
});
function Jh(r) {
  const t = k.prepare(
    `SELECT b.slide_index, m.id, m.name, m.kind, m.file, m.thumb, m.tags
       FROM slide_backgrounds b JOIN media m ON m.id = b.media_id
       WHERE b.deck_key = ?`
  ).all(r);
  return Object.fromEntries(t.map((e) => [e.slide_index, ai(e)]));
}
function Gh(r, t, e) {
  if (e === null) {
    k.prepare("DELETE FROM slide_backgrounds WHERE deck_key = ? AND slide_index = ?").run(r, t);
    return;
  }
  k.prepare(
    `INSERT INTO slide_backgrounds (deck_key, slide_index, media_id) VALUES (?, ?, ?)
     ON CONFLICT (deck_key, slide_index) DO UPDATE SET media_id = excluded.media_id`
  ).run(r, t, e);
}
const lt = ["jpg", "jpeg", "png", "webp", "gif"], Dr = ["mp4", "webm"], Qh = 200 * 1024 * 1024, Zh = 20 * 1024 * 1024;
async function zi(r, t) {
  const e = ct.fromWebContents(r.sender), { canceled: n, filePaths: s } = e ? await fe.showOpenDialog(e, t) : await fe.showOpenDialog(t);
  return n ? [] : s;
}
const Hr = (r) => O.extname(r).slice(1).toLowerCase();
function Ln(r, t = "Media id") {
  if (!Number.isInteger(r) || r < 1) throw new TypeError(`${t} must be a positive integer`);
  return r;
}
function Xi(r) {
  if (typeof r != "string" || !/^(song|item|scripture):.+/.test(r) || r.length > 300)
    throw new TypeError("Deck key must look like song:<id>, item:<id> or scripture:<reference>");
  return r;
}
function Ki(r) {
  if (!(r instanceof Uint8Array) || r.length === 0 || r.length > Zh)
    throw new TypeError("Expected image bytes up to 20 MB");
  return r;
}
function ef() {
  R.handle("media:list", () => Vh()), R.handle("media:import", async (r) => {
    const t = await zi(r, {
      title: "Import backgrounds",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images and videos", extensions: [...lt, ...Dr] },
        { name: "Images", extensions: lt },
        { name: "Videos (MP4, WebM)", extensions: Dr }
      ]
    }), e = [];
    for (const n of t) {
      const s = Hr(n), i = Dr.includes(s) ? "video" : lt.includes(s) ? "image" : null;
      i && e.push(zh(O.basename(n, O.extname(n)), i, await Os(n)));
    }
    return e;
  }), R.handle("media:update", (r, t, e, n) => {
    if (typeof e != "string" || !e.trim()) throw new TypeError("Media needs a name");
    if (!Array.isArray(n) || !n.every((i) => typeof i == "string")) throw new TypeError("Tags must be strings");
    const s = [...new Set(n.map((i) => i.trim()).filter(Boolean))];
    return Xh(Ln(t), e.trim(), s);
  }), R.handle("media:delete", async (r, t) => {
    const e = Yh(Ln(t));
    return e ? (await Wr(e.file), await Wr(e.thumb), !0) : !1;
  }), R.handle("media:saveThumbnail", async (r, t, e) => {
    const n = Ln(t);
    if (!Ms(n)) return;
    const s = await Vi(Ki(e), `thumb-${n}`, ".jpg");
    return await Wr(Kh(n, s) ?? null), Ms(n);
  }), R.handle("media:getSlideBackgrounds", (r, t) => Jh(Xi(t))), R.handle("media:setSlideBackground", (r, t, e, n) => {
    if (!Number.isInteger(e) || e < 0) throw new TypeError("Slide index must be 0 or more");
    Gh(Xi(t), e, n === null ? null : Ln(n));
  }), R.handle("media:pickPresentation", async (r) => {
    const t = await zi(r, {
      title: "Choose images or a PDF",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images or PDF", extensions: [...lt, "pdf"] },
        { name: "PDF", extensions: ["pdf"] },
        { name: "Images", extensions: lt }
      ]
    });
    if (t.length === 0) return null;
    const e = t.find((a) => Hr(a) === "pdf");
    if (e) {
      if (t.length > 1) throw new Error("Choose one PDF, or images only");
      if ((await Xs(e)).size > Qh) throw new Error("The PDF is larger than 200 MB");
      return { kind: "pdf", title: O.basename(e, O.extname(e)), data: new Uint8Array(await Ks(e)) };
    }
    const n = t.filter((a) => lt.includes(Hr(a))).sort((a, o) => a.localeCompare(o, void 0, { numeric: !0 }));
    if (n.length === 0) throw new Error("Choose images or a PDF");
    const s = [];
    for (const a of n) s.push(jt(await Os(a)));
    return { kind: "images", title: n.length === 1 ? O.basename(n[0], O.extname(n[0])) : O.basename(O.dirname(n[0])), pages: s };
  }), R.handle("media:saveImage", async (r, t) => jt(await Vi(Ki(t), "page", ".png")));
}
const tf = {
  fadeMs: 400,
  outputDisplay: "auto",
  logoUrl: null,
  appearance: "system",
  autosaveDrafts: !0,
  backupFolder: null,
  backupIntervalMinutes: 0,
  lastBackupAt: null,
  aiEnabled: !0,
  aiModel: "claude-sonnet-5-5"
}, Yi = { min: 0, max: 1500 }, Er = {
  fadeMs: "output.fadeMs",
  outputDisplay: "output.display",
  logoUrl: "output.logoUrl",
  appearance: "ui.appearance",
  autosaveDrafts: "editor.autosaveDrafts",
  backupFolder: "backup.folder",
  backupIntervalMinutes: "backup.intervalMinutes",
  lastBackupAt: "backup.lastAt",
  aiEnabled: "ai.enabled",
  aiModel: "ai.model"
};
function Pc(r, t) {
  const e = t;
  switch (r) {
    case "fadeMs":
      return typeof t == "number" && Number.isFinite(t) ? Math.round(Math.min(Yi.max, Math.max(Yi.min, t))) : void 0;
    case "outputDisplay":
      return t === "auto" || t === "window" || Number.isInteger(t) && t >= 0 ? e : void 0;
    case "logoUrl":
      return t === null || typeof t == "string" && t.startsWith("wd-media://") ? e : void 0;
    case "appearance":
      return ["system", "dark", "light"].includes(t) ? e : void 0;
    case "autosaveDrafts":
    case "aiEnabled":
      return typeof t == "boolean" ? e : void 0;
    case "aiModel":
      return t === "claude-sonnet-5-5" || t === "claude-haiku-5-5" ? e : void 0;
    case "backupFolder":
    case "lastBackupAt":
      return t === null || typeof t == "string" && t !== "" ? e : void 0;
    case "backupIntervalMinutes":
      return [0, 10, 30, 60].includes(t) ? e : void 0;
    default:
      return;
  }
}
function Re() {
  const r = k.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'theme.%'").all(), t = new Map(r.map((n) => [n.key, n.value])), e = { ...tf };
  for (const n of Object.keys(Er)) {
    const s = t.get(Er[n]);
    if (s === void 0) continue;
    let i;
    try {
      i = JSON.parse(s);
    } catch {
      continue;
    }
    const a = Pc(n, i);
    a !== void 0 && (e[n] = a);
  }
  return e;
}
function $c(r) {
  const t = k.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  return k.transaction(() => {
    for (const e of Object.keys(r)) {
      if (!(e in Er)) continue;
      const n = Pc(e, r[e]);
      n !== void 0 && t.run(Er[e], JSON.stringify(n));
    }
  })(), Re();
}
const Ji = "worshipdeck-backup-";
async function Fc() {
  const { backupFolder: r } = Re();
  if (!r) throw new Error("Choose a backup folder first");
  await Ys(r, { recursive: !0 });
  const t = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/:/g, "-"), e = O.join(r, `${Ji}${t}.db`);
  await k.backup(e), $c({ lastBackupAt: (/* @__PURE__ */ new Date()).toISOString() });
  const n = (await ec(r)).filter((s) => s.startsWith(Ji) && s.endsWith(".db")).sort().slice(0, -20);
  return await Promise.all(n.map((s) => Js(O.join(r, s), { force: !0 }))), e;
}
function nf() {
  setInterval(() => {
    const { backupFolder: r, backupIntervalMinutes: t, lastBackupAt: e } = Re();
    if (!r || t === 0) return;
    const n = e ? Date.parse(e) : 0;
    Date.now() - n >= t * 6e4 && Fc().catch((s) => console.error("Backup failed", s));
  }, 6e4);
}
async function Gi(r, t) {
  const e = ct.fromWebContents(r.sender), { canceled: n, filePaths: s } = e ? await fe.showOpenDialog(e, t) : await fe.showOpenDialog(t);
  return n || s.length === 0 ? null : s[0];
}
function rf(r) {
  const t = (e) => {
    const n = Re(), s = $c(e);
    return r(n, s), s;
  };
  R.handle("settings:get", () => Re()), R.handle("settings:set", (e, n) => {
    if (typeof n != "object" || n === null) throw new TypeError("Settings must be an object");
    const s = { ...n };
    return delete s.lastBackupAt, t(s);
  }), R.handle("settings:listDisplays", () => {
    const e = mr.getPrimaryDisplay().id;
    return mr.getAllDisplays().map((n, s) => ({
      id: n.id,
      label: n.label || `Display ${s + 1}`,
      width: n.size.width,
      height: n.size.height,
      primary: n.id === e
    }));
  }), R.handle("settings:pickBackupFolder", async (e) => {
    const n = await Gi(e, {
      title: "Choose a backup folder",
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"]
    });
    return n ? t({ backupFolder: O.resolve(n) }) : null;
  }), R.handle("settings:pickLogo", async (e) => {
    const n = await Gi(e, {
      title: "Choose a logo",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }]
    });
    return n ? t({ logoUrl: jt(await Os(n)) }) : null;
  }), R.handle("settings:backupNow", () => Fc());
}
const sf = ["show", "black", "clear", "logo"];
let Cs = { current: null, next: null, title: null, nextItemTitle: null, mode: "show" };
function Qi(r) {
  const t = r;
  if (t === null) return null;
  if (typeof t != "object" || typeof t.text != "string" || typeof t.caption != "string")
    throw new TypeError("A stage slide needs text and a caption");
  return { text: t.text, caption: t.caption };
}
const Zi = (r) => typeof r == "string" ? r : null;
function af(r) {
  const t = r;
  if (typeof t != "object" || t === null || !sf.includes(t.mode))
    throw new TypeError("Stage state needs a mode");
  return {
    current: Qi(t.current ?? null),
    next: Qi(t.next ?? null),
    title: Zi(t.title),
    nextItemTitle: Zi(t.nextItemTitle),
    mode: t.mode
  };
}
function of(r) {
  R.handle("stage:open", () => r.open()), R.handle("stage:close", () => r.close()), R.handle("stage:isOpen", () => r.getWindow() !== null), R.on("stage:send", (t, e) => {
    var n;
    try {
      Cs = af(e);
    } catch (s) {
      console.error(s);
      return;
    }
    (n = r.getWindow()) == null || n.webContents.send("stage:state", Cs);
  });
}
function cf(r) {
  r.webContents.send("stage:state", Cs);
}
function w(r, t, e, n, s) {
  if (typeof t == "function" ? r !== t || !0 : !t.has(r))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return t.set(r, e), e;
}
function c(r, t, e, n) {
  if (e === "a" && !n)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof t == "function" ? r !== t || !n : !t.has(r))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return e === "m" ? n : e === "a" ? n.call(r) : n ? n.value : t.get(r);
}
function Bt(r) {
  return typeof r == "object" && r !== null && // Spec-compliant fetch implementations
  ("name" in r && r.name === "AbortError" || // Expo fetch
  "message" in r && String(r.message).includes("FetchRequestCanceledException"));
}
const Sr = (r) => {
  if (r instanceof Error)
    return r;
  if (typeof r == "object" && r !== null) {
    try {
      const t = Object.prototype.toString.call(r);
      if (t === "[object Error]" || t === "[object DOMException]") {
        const e = new Error(r.message, r.cause ? { cause: r.cause } : {});
        return r.stack && (e.stack = r.stack), r.cause && !e.cause && (e.cause = r.cause), r.name && (e.name = r.name), e;
      }
    } catch {
    }
    try {
      return new Error(JSON.stringify(r));
    } catch {
    }
  }
  return new Error(r);
};
var E = /* @__PURE__ */ (() => {
  class r extends Error {
  }
  return r;
})();
class K extends E {
  constructor(t, e, n, s, i) {
    super(`${K.makeMessage(t, e, n)}`), this.status = t, this.headers = s, this.requestID = s == null ? void 0 : s.get("request-id"), this.workspaceID = s == null ? void 0 : s.get("anthropic-workspace-id"), this.error = e, this.type = i ?? null;
  }
  static makeMessage(t, e, n) {
    const s = e != null && e.message ? typeof e.message == "string" ? e.message : JSON.stringify(e.message) : e ? JSON.stringify(e) : n;
    return t && s ? `${t} ${s}` : t ? `${t} status code (no body)` : s || "(no status code or body)";
  }
  static generate(t, e, n, s) {
    var o;
    if (!t || !s)
      return new vn({ message: n, cause: Sr(e) });
    const i = e, a = (o = i == null ? void 0 : i.error) == null ? void 0 : o.type;
    return t === 400 ? new jc(t, i, n, s, a) : t === 401 ? new Bc(t, i, n, s, a) : t === 403 ? new Uc(t, i, n, s, a) : t === 404 ? new Wc(t, i, n, s, a) : t === 409 ? new Dc(t, i, n, s, a) : t === 422 ? new Hc(t, i, n, s, a) : t === 429 ? new qc(t, i, n, s, a) : t >= 500 ? new Vc(t, i, n, s, a) : new K(t, i, n, s, a);
  }
}
class ye extends K {
  constructor({ message: t } = {}) {
    super(void 0, void 0, t || "Request was aborted.", void 0);
  }
}
class vn extends K {
  constructor({ message: t, cause: e }) {
    super(void 0, void 0, t || "Connection error.", void 0), e && (this.cause = e);
  }
}
class ea extends vn {
  constructor({ message: t } = {}) {
    super({ message: t ?? "Request timed out." });
  }
}
class lf extends E {
  constructor(t, { cause: e } = {}) {
    super(t ?? "Retryable error."), e !== void 0 && (this.cause = e);
  }
}
class jc extends K {
}
class Bc extends K {
}
class Uc extends K {
}
class Wc extends K {
}
class Dc extends K {
}
class Hc extends K {
}
class qc extends K {
}
class Vc extends K {
}
const df = /^[a-z][a-z0-9+.-]*:/i, uf = (r) => df.test(r);
let ie = (r) => (ie = Array.isArray, ie(r)), ta = ie;
function kr(r) {
  return typeof r != "object" ? {} : r ?? {};
}
function na(r) {
  if (!r)
    return !0;
  for (const t in r)
    return !1;
  return !0;
}
function hf(r, t) {
  return Object.prototype.hasOwnProperty.call(r, t);
}
function ra(r) {
  return r != null && typeof r == "object" && !Array.isArray(r);
}
const qr = (r, t) => {
  if (typeof t != "number" || !Number.isInteger(t))
    throw new E(`${r} must be an integer`);
  if (t < 0)
    throw new E(`${r} must be a positive integer`);
  return t;
}, zc = (r) => {
  try {
    return JSON.parse(r);
  } catch {
    return;
  }
};
const rt = (r, t) => new Promise((e) => {
  if (t != null && t.aborted)
    return e();
  const n = () => {
    clearTimeout(s), e();
  }, s = setTimeout(() => {
    t == null || t.removeEventListener("abort", n), e();
  }, r);
  t == null || t.addEventListener("abort", n, { once: !0 });
}), He = "0.128.0", ff = () => (
  // @ts-ignore
  typeof window < "u" && // @ts-ignore
  typeof window.document < "u" && // @ts-ignore
  typeof navigator < "u"
);
function pf() {
  return typeof Deno < "u" && Deno.build != null ? "deno" : typeof EdgeRuntime < "u" ? "edge" : Object.prototype.toString.call(typeof globalThis.process < "u" ? globalThis.process : 0) === "[object process]" ? "node" : "unknown";
}
const gf = () => {
  var e, n;
  const r = pf();
  if (r === "deno")
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": He,
      "X-Stainless-OS": ia(Deno.build.os),
      "X-Stainless-Arch": sa(Deno.build.arch),
      "X-Stainless-Runtime": "deno",
      "X-Stainless-Runtime-Version": typeof Deno.version == "string" ? Deno.version : ((e = Deno.version) == null ? void 0 : e.deno) ?? "unknown"
    };
  if (typeof EdgeRuntime < "u")
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": He,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": `other:${EdgeRuntime}`,
      "X-Stainless-Runtime": "edge",
      "X-Stainless-Runtime-Version": ((n = globalThis.process) == null ? void 0 : n.version) ?? "unknown"
    };
  if (r === "node")
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": He,
      "X-Stainless-OS": ia(globalThis.process.platform ?? "unknown"),
      "X-Stainless-Arch": sa(globalThis.process.arch ?? "unknown"),
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown"
    };
  const t = mf();
  return t ? {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": He,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": `browser:${t.browser}`,
    "X-Stainless-Runtime-Version": t.version
  } : {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": He,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": "unknown",
    "X-Stainless-Runtime-Version": "unknown"
  };
};
function mf() {
  if (typeof navigator > "u" || !navigator)
    return null;
  const r = [
    { key: "edge", pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "chrome", pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "firefox", pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "safari", pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ }
  ];
  for (const { key: t, pattern: e } of r) {
    const n = e.exec(navigator.userAgent);
    if (n) {
      const s = n[1] || 0, i = n[2] || 0, a = n[3] || 0;
      return { browser: t, version: `${s}.${i}.${a}` };
    }
  }
  return null;
}
const sa = (r) => r === "x32" ? "x32" : r === "x86_64" || r === "x64" ? "x64" : r === "arm" ? "arm" : r === "aarch64" || r === "arm64" ? "arm64" : r ? `other:${r}` : "unknown", ia = (r) => (r = r.toLowerCase(), r.includes("ios") ? "iOS" : r === "android" ? "Android" : r === "darwin" ? "MacOS" : r === "win32" ? "Windows" : r === "freebsd" ? "FreeBSD" : r === "openbsd" ? "OpenBSD" : r === "linux" ? "Linux" : r ? `Other:${r}` : "Unknown");
let aa;
const ci = () => aa ?? (aa = gf()), vr = /* @__PURE__ */ new WeakMap(), Mt = typeof globalThis.FinalizationRegistry == "function" ? new globalThis.FinalizationRegistry((r) => st(r)) : null;
function _f(r, t) {
  return () => r.removeEventListener("abort", t);
}
function wf(r, t, e) {
  vr.set(r, _f(t, e));
}
function yf(r, t) {
  vr.has(t) && (Mt == null || Mt.register(r, t, t));
}
function st(r) {
  const t = vr.get(r);
  t && (vr.delete(r), Mt == null || Mt.unregister(r), t());
}
function bf() {
  if (typeof fetch < "u")
    return fetch;
  throw new Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new Anthropic({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function Xc(...r) {
  const t = globalThis.ReadableStream;
  if (typeof t > "u")
    throw new Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
  return new t(...r);
}
function Kc(r) {
  let t = Symbol.asyncIterator in r ? r[Symbol.asyncIterator]() : r[Symbol.iterator]();
  return Xc({
    start() {
    },
    async pull(e) {
      const { done: n, value: s } = await t.next();
      n ? e.close() : e.enqueue(s);
    },
    async cancel() {
      var e;
      await ((e = t.return) == null ? void 0 : e.call(t));
    }
  });
}
function li(r) {
  if (r[Symbol.asyncIterator])
    return r;
  const t = r.getReader();
  return {
    async next() {
      try {
        const e = await t.read();
        return e != null && e.done && t.releaseLock(), e;
      } catch (e) {
        throw t.releaseLock(), e;
      }
    },
    async return() {
      const e = t.cancel();
      return t.releaseLock(), await e, { done: !0, value: void 0 };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}
async function Ef(r) {
  var n, s;
  if (r === null || typeof r != "object")
    return;
  if (r[Symbol.asyncIterator]) {
    await ((s = (n = r[Symbol.asyncIterator]()).return) == null ? void 0 : s.call(n));
    return;
  }
  const t = r.getReader(), e = t.cancel();
  t.releaseLock(), await e;
}
const Sf = ({ headers: r, body: t }) => ({
  bodyHeaders: {
    "content-type": "application/json"
  },
  body: JSON.stringify(t)
}), Yc = "RFC3986", Jc = (r) => String(r), oa = {
  RFC1738: (r) => String(r).replace(/%20/g, "+"),
  RFC3986: Jc
}, kf = "RFC1738";
let Ls = (r, t) => (Ls = Object.hasOwn ?? Function.prototype.call.bind(Object.prototype.hasOwnProperty), Ls(r, t));
const Ee = /* @__PURE__ */ (() => {
  const r = [];
  for (let t = 0; t < 256; ++t)
    r.push("%" + ((t < 16 ? "0" : "") + t.toString(16)).toUpperCase());
  return r;
})(), Vr = 1024, vf = (r, t, e, n, s) => {
  if (r.length === 0)
    return r;
  let i = r;
  if (typeof r == "symbol" ? i = Symbol.prototype.toString.call(r) : typeof r != "string" && (i = String(r)), e === "iso-8859-1")
    return escape(i).replace(/%u[0-9a-f]{4}/gi, function(o) {
      return "%26%23" + parseInt(o.slice(2), 16) + "%3B";
    });
  let a = "";
  for (let o = 0; o < i.length; o += Vr) {
    const l = i.length >= Vr ? i.slice(o, o + Vr) : i, u = [];
    for (let d = 0; d < l.length; ++d) {
      let h = l.charCodeAt(d);
      if (h === 45 || // -
      h === 46 || // .
      h === 95 || // _
      h === 126 || // ~
      h >= 48 && h <= 57 || // 0-9
      h >= 65 && h <= 90 || // a-z
      h >= 97 && h <= 122 || // A-Z
      s === kf && (h === 40 || h === 41)) {
        u[u.length] = l.charAt(d);
        continue;
      }
      if (h < 128) {
        u[u.length] = Ee[h];
        continue;
      }
      if (h < 2048) {
        u[u.length] = Ee[192 | h >> 6] + Ee[128 | h & 63];
        continue;
      }
      if (h < 55296 || h >= 57344) {
        u[u.length] = Ee[224 | h >> 12] + Ee[128 | h >> 6 & 63] + Ee[128 | h & 63];
        continue;
      }
      d += 1, h = 65536 + ((h & 1023) << 10 | l.charCodeAt(d) & 1023), u[u.length] = Ee[240 | h >> 18] + Ee[128 | h >> 12 & 63] + Ee[128 | h >> 6 & 63] + Ee[128 | h & 63];
    }
    a += u.join("");
  }
  return a;
};
function Tf(r) {
  return !r || typeof r != "object" ? !1 : !!(r.constructor && r.constructor.isBuffer && r.constructor.isBuffer(r));
}
function ca(r, t) {
  if (ie(r)) {
    const e = [];
    for (let n = 0; n < r.length; n += 1)
      e.push(t(r[n]));
    return e;
  }
  return t(r);
}
const Gc = {
  brackets(r) {
    return String(r) + "[]";
  },
  comma: "comma",
  indices(r, t) {
    return String(r) + "[" + t + "]";
  },
  repeat(r) {
    return String(r);
  }
}, Qc = function(r, t) {
  Array.prototype.push.apply(r, ie(t) ? t : [t]);
};
let la;
const X = {
  addQueryPrefix: !1,
  allowDots: !1,
  allowEmptyArrays: !1,
  arrayFormat: "indices",
  charset: "utf-8",
  charsetSentinel: !1,
  delimiter: "&",
  encode: !0,
  encodeDotInKeys: !1,
  encoder: vf,
  encodeValuesOnly: !1,
  format: Yc,
  formatter: Jc,
  /** @deprecated */
  indices: !1,
  serializeDate(r) {
    return (la ?? (la = Function.prototype.call.bind(Date.prototype.toISOString)))(r);
  },
  skipNulls: !1,
  strictNullHandling: !1
};
function xf(r) {
  return typeof r == "string" || typeof r == "number" || typeof r == "boolean" || typeof r == "symbol" || typeof r == "bigint";
}
const zr = {};
function Zc(r, t, e, n, s, i, a, o, l, u, d, h, g, f, m, y, v, T) {
  let b = r, N = T, x = 0, S = !1;
  for (; (N = N.get(zr)) !== void 0 && !S; ) {
    const M = N.get(r);
    if (x += 1, typeof M < "u") {
      if (M === x)
        throw new RangeError("Cyclic object value");
      S = !0;
    }
    typeof N.get(zr) > "u" && (x = 0);
  }
  if (typeof u == "function" ? b = u(t, b) : b instanceof Date ? b = g == null ? void 0 : g(b) : e === "comma" && ie(b) && (b = ca(b, function(M) {
    return M instanceof Date ? g == null ? void 0 : g(M) : M;
  })), b === null) {
    if (i)
      return l && !y ? (
        // @ts-expect-error
        l(t, X.encoder, v, "key", f)
      ) : t;
    b = "";
  }
  if (xf(b) || Tf(b)) {
    if (l) {
      const M = y ? t : l(t, X.encoder, v, "key", f);
      return [
        (m == null ? void 0 : m(M)) + "=" + // @ts-expect-error
        (m == null ? void 0 : m(l(b, X.encoder, v, "value", f)))
      ];
    }
    return [(m == null ? void 0 : m(t)) + "=" + (m == null ? void 0 : m(String(b)))];
  }
  const A = [];
  if (typeof b > "u")
    return A;
  let P;
  if (e === "comma" && ie(b))
    y && l && (b = ca(b, l)), P = [{ value: b.length > 0 ? b.join(",") || null : void 0 }];
  else if (ie(u))
    P = u;
  else {
    const M = Object.keys(b);
    P = d ? M.sort(d) : M;
  }
  const U = o ? String(t).replace(/\./g, "%2E") : String(t), j = n && ie(b) && b.length === 1 ? U + "[]" : U;
  if (s && ie(b) && b.length === 0)
    return j + "[]";
  for (let M = 0; M < P.length; ++M) {
    const Y = P[M], Me = (
      // @ts-ignore
      typeof Y == "object" && typeof Y.value < "u" ? Y.value : b[Y]
    );
    if (a && Me === null)
      continue;
    const Ce = h && o ? Y.replace(/\./g, "%2E") : Y, Vl = ie(b) ? typeof e == "function" ? e(j, Ce) : j : j + (h ? "." + Ce : "[" + Ce + "]");
    T.set(r, x);
    const Ei = /* @__PURE__ */ new WeakMap();
    Ei.set(zr, T), Qc(A, Zc(
      Me,
      Vl,
      e,
      n,
      s,
      i,
      a,
      o,
      // @ts-ignore
      e === "comma" && y && ie(b) ? null : l,
      u,
      d,
      h,
      g,
      f,
      m,
      y,
      v,
      Ei
    ));
  }
  return A;
}
function Af(r = X) {
  if (typeof r.allowEmptyArrays < "u" && typeof r.allowEmptyArrays != "boolean")
    throw new TypeError("`allowEmptyArrays` option can only be `true` or `false`, when provided");
  if (typeof r.encodeDotInKeys < "u" && typeof r.encodeDotInKeys != "boolean")
    throw new TypeError("`encodeDotInKeys` option can only be `true` or `false`, when provided");
  if (r.encoder !== null && typeof r.encoder < "u" && typeof r.encoder != "function")
    throw new TypeError("Encoder has to be a function.");
  const t = r.charset || X.charset;
  if (typeof r.charset < "u" && r.charset !== "utf-8" && r.charset !== "iso-8859-1")
    throw new TypeError("The charset option must be either utf-8, iso-8859-1, or undefined");
  let e = Yc;
  if (typeof r.format < "u") {
    if (!Ls(oa, r.format))
      throw new TypeError("Unknown format option provided.");
    e = r.format;
  }
  const n = oa[e];
  let s = X.filter;
  (typeof r.filter == "function" || ie(r.filter)) && (s = r.filter);
  let i;
  if (r.arrayFormat && r.arrayFormat in Gc ? i = r.arrayFormat : "indices" in r ? i = r.indices ? "indices" : "repeat" : i = X.arrayFormat, "commaRoundTrip" in r && typeof r.commaRoundTrip != "boolean")
    throw new TypeError("`commaRoundTrip` must be a boolean, or absent");
  const a = typeof r.allowDots > "u" ? r.encodeDotInKeys ? !0 : X.allowDots : !!r.allowDots;
  return {
    addQueryPrefix: typeof r.addQueryPrefix == "boolean" ? r.addQueryPrefix : X.addQueryPrefix,
    // @ts-ignore
    allowDots: a,
    allowEmptyArrays: typeof r.allowEmptyArrays == "boolean" ? !!r.allowEmptyArrays : X.allowEmptyArrays,
    arrayFormat: i,
    charset: t,
    charsetSentinel: typeof r.charsetSentinel == "boolean" ? r.charsetSentinel : X.charsetSentinel,
    commaRoundTrip: !!r.commaRoundTrip,
    delimiter: typeof r.delimiter > "u" ? X.delimiter : r.delimiter,
    encode: typeof r.encode == "boolean" ? r.encode : X.encode,
    encodeDotInKeys: typeof r.encodeDotInKeys == "boolean" ? r.encodeDotInKeys : X.encodeDotInKeys,
    encoder: typeof r.encoder == "function" ? r.encoder : X.encoder,
    encodeValuesOnly: typeof r.encodeValuesOnly == "boolean" ? r.encodeValuesOnly : X.encodeValuesOnly,
    filter: s,
    format: e,
    formatter: n,
    serializeDate: typeof r.serializeDate == "function" ? r.serializeDate : X.serializeDate,
    skipNulls: typeof r.skipNulls == "boolean" ? r.skipNulls : X.skipNulls,
    // @ts-ignore
    sort: typeof r.sort == "function" ? r.sort : null,
    strictNullHandling: typeof r.strictNullHandling == "boolean" ? r.strictNullHandling : X.strictNullHandling
  };
}
function Rf(r, t = {}) {
  let e = r;
  const n = Af(t);
  let s, i;
  typeof n.filter == "function" ? (i = n.filter, e = i("", e)) : ie(n.filter) && (i = n.filter, s = i);
  const a = [];
  if (typeof e != "object" || e === null)
    return "";
  const o = Gc[n.arrayFormat], l = o === "comma" && n.commaRoundTrip;
  s || (s = Object.keys(e)), n.sort && s.sort(n.sort);
  const u = /* @__PURE__ */ new WeakMap();
  for (let g = 0; g < s.length; ++g) {
    const f = s[g];
    n.skipNulls && e[f] === null || Qc(a, Zc(
      e[f],
      f,
      // @ts-expect-error
      o,
      l,
      n.allowEmptyArrays,
      n.strictNullHandling,
      n.skipNulls,
      n.encodeDotInKeys,
      n.encode ? n.encoder : null,
      n.filter,
      n.sort,
      n.allowDots,
      n.serializeDate,
      n.format,
      n.formatter,
      n.encodeValuesOnly,
      n.charset,
      u
    ));
  }
  const d = a.join(n.delimiter);
  let h = n.addQueryPrefix === !0 ? "?" : "";
  return n.charsetSentinel && (n.charset === "iso-8859-1" ? h += "utf8=%26%2310003%3B&" : h += "utf8=%E2%9C%93&"), d.length > 0 ? h + d : "";
}
function If(r) {
  return Rf(r, { arrayFormat: "brackets" });
}
const Nf = "urn:ietf:params:oauth:grant-type:jwt-bearer", Of = "refresh_token", el = "/v1/oauth/token", Tr = "oauth-2025-04-20", Mf = "oidc-federation-2026-04-01", Cf = 120, di = 30, Lf = 5, da = 1 << 20;
function tl(r) {
  if (!r)
    return;
  let t;
  try {
    t = new URL(r);
  } catch (n) {
    throw new B(`Invalid token endpoint base URL "${r}": ${n}`);
  }
  if (t.protocol === "https:")
    return;
  const e = t.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!(t.protocol === "http:" && (e === "localhost" || e === "127.0.0.1" || e === "::1")))
    throw new B(`Refusing to send credential over non-https token endpoint "${r}"`);
}
async function nl(r, t) {
  const e = await $f(r);
  let n;
  try {
    n = JSON.parse(e);
  } catch {
    throw new B(`Token endpoint returned non-JSON response (status ${r.status})`, r.status, _e(e), t);
  }
  if (!n.access_token)
    throw new B(`Token endpoint response missing access_token: ${JSON.stringify(_e(n))}`, r.status, _e(n), t);
  if (n.token_type && n.token_type.toLowerCase() !== "bearer")
    throw new B(`Token endpoint response: unsupported token_type "${n.token_type}" (want Bearer)`, r.status, _e(n), t);
  return n;
}
const Xr = 2e3, Pf = /* @__PURE__ */ new Set(["error", "error_description", "error_uri"]);
function _e(r) {
  if (r == null)
    return r;
  if (typeof r == "string") {
    let t;
    try {
      t = JSON.parse(r);
    } catch {
      return r.length <= Xr ? r : r.slice(0, Xr) + `... <${r.length - Xr} more chars>`;
    }
    return JSON.stringify(_e(t));
  }
  if (typeof r == "object" && !Array.isArray(r)) {
    const t = {};
    for (const [e, n] of Object.entries(r))
      Pf.has(e) && (t[e] = n);
    return t;
  }
  return null;
}
async function rl(r, t = (e) => console.warn(`anthropic-sdk: ${e}`)) {
  if (typeof process > "u" || process.platform === "win32")
    return;
  const { fs: e } = await import("./node-Cz2Ted7k.js");
  let n = r, s;
  try {
    n = await e.promises.realpath(r), s = await e.promises.stat(n);
  } catch {
    return;
  }
  const i = s.mode & 511;
  if (i & 18)
    throw new B(`Credentials file at ${n} is group/world-writable (mode 0o${i.toString(8)}); this allows other local users to plant tokens. Run \`chmod 600 ${n}\`.`);
  if (i & 36)
    throw new B(`Credentials file at ${n} is group/world-readable (mode 0o${i.toString(8)}); run \`chmod 600 ${n}\` before retrying.`);
  typeof process.getuid == "function" && s.uid !== process.getuid() && t(`credentials file at ${n} is owned by uid ${s.uid} (current process uid ${process.getuid()}); verify this is intentional.`);
}
async function sl(r, t) {
  const { fs: e, path: n } = await import("./node-Cz2Ted7k.js"), s = n.dirname(r);
  await e.promises.mkdir(s, { recursive: !0, mode: 448 });
  const i = `${r}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    const a = await e.promises.open(i, "w", 384);
    try {
      await a.writeFile(JSON.stringify(t, null, 2)), await a.sync();
    } finally {
      await a.close();
    }
    await e.promises.rename(i, r);
  } catch (a) {
    throw await e.promises.unlink(i).catch(() => {
    }), a;
  }
  try {
    const a = await e.promises.open(s, "r");
    try {
      await a.sync();
    } finally {
      await a.close();
    }
  } catch {
  }
}
async function $f(r) {
  if (!r.body)
    return "";
  const t = r.body.getReader(), e = [];
  let n = 0;
  for (; ; ) {
    const { done: i, value: a } = await t.read();
    if (i)
      break;
    if (n + a.length > da) {
      const o = da - n;
      o > 0 && e.push(a.subarray(0, o)), await t.cancel();
      break;
    }
    e.push(a), n += a.length;
  }
  let s;
  if (e.length === 1)
    s = e[0];
  else {
    s = new Uint8Array(e.reduce((a, o) => a + o.length, 0));
    let i = 0;
    for (const a of e)
      s.set(a, i), i += a.length;
  }
  return new TextDecoder("utf-8").decode(s);
}
class B extends E {
  constructor(t, e = null, n = null, s = null) {
    super(t), this.statusCode = e, this.body = n, this.requestId = s;
  }
}
function it() {
  return Math.floor(Date.now() / 1e3);
}
class Ff {
  constructor(t, e) {
    this.cached = null, this.pendingRefresh = null, this.nextForce = !1, this.lastAdvisoryError = 0, this.provider = t, this.onAdvisoryRefreshError = e;
  }
  async getToken() {
    const t = this.nextForce;
    this.nextForce = !1;
    const e = this.cached;
    if (t || e == null)
      return (await this.refresh(t)).token;
    if (e.expiresAt == null)
      return e.token;
    const n = e.expiresAt - it();
    return n > Cf ? e.token : n > di ? (this.backgroundRefresh(), e.token) : (await this.refresh()).token;
  }
  /**
   * Clears the cached token and marks the next {@link getToken} as a forced
   * refresh, so the underlying provider bypasses any on-disk freshness check.
   * Called after a 401 — the server has just told us the token is bad even
   * if its `expires_at` still looks fresh.
   */
  invalidate() {
    this.cached = null, this.nextForce = !0;
  }
  /**
   * Mandatory refresh. Joins any in-flight refresh unless forced — a forced
   * refresh must not coalesce into a non-forced one that may re-serve the
   * same stale disk token.
   */
  refresh(t = !1) {
    return this.pendingRefresh && !t ? this.pendingRefresh : this.doRefresh(t);
  }
  /**
   * Advisory background refresh. Shares the same in-flight promise as
   * mandatory refreshes for deduplication, but swallows errors so the
   * stale cached token keeps being served. Backs off for
   * {@link ADVISORY_REFRESH_BACKOFF_IN_SECONDS} after a failure so an
   * outage during the advisory window doesn't hammer the token endpoint.
   */
  backgroundRefresh() {
    this.pendingRefresh || it() - this.lastAdvisoryError < Lf || this.doRefresh().catch((t) => {
      var e;
      this.lastAdvisoryError = it(), (e = this.onAdvisoryRefreshError) == null || e.call(this, t);
    });
  }
  /**
   * Core refresh. Sets {@link pendingRefresh} so concurrent callers
   * (both advisory and mandatory) coalesce into a single provider call.
   */
  doRefresh(t = !1) {
    return this.pendingRefresh = this.provider(t ? { forceRefresh: !0 } : void 0).then((e) => (this.cached = e, this.pendingRefresh = null, e), (e) => {
      throw this.pendingRefresh = null, e;
    }), this.pendingRefresh;
  }
}
const C = (r) => {
  var t, e, n, s, i;
  if (typeof globalThis.process < "u")
    return ((e = (t = globalThis.process.env) == null ? void 0 : t[r]) == null ? void 0 : e.trim()) || void 0;
  if (typeof globalThis.Deno < "u")
    return ((i = (s = (n = globalThis.Deno.env) == null ? void 0 : n.get) == null ? void 0 : s.call(n, r)) == null ? void 0 : i.trim()) || void 0;
};
function jf(r) {
  let t = 0;
  for (const s of r)
    t += s.length;
  const e = new Uint8Array(t);
  let n = 0;
  for (const s of r)
    e.set(s, n), n += s.length;
  return e;
}
let ua;
function ui(r) {
  let t;
  return (ua ?? (t = new globalThis.TextEncoder(), ua = t.encode.bind(t)))(r);
}
let ha;
function Ps(r) {
  let t;
  return (ha ?? (t = new globalThis.TextDecoder(), ha = t.decode.bind(t)))(r);
}
const Bf = (r) => {
  if (typeof globalThis.Buffer < "u") {
    const t = globalThis.Buffer.from(r, "base64");
    return new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
  }
  if (typeof atob < "u") {
    const t = atob(r), e = new Uint8Array(t.length);
    for (let n = 0; n < t.length; n++)
      e[n] = t.charCodeAt(n);
    return e;
  }
  throw new E("Cannot decode base64 string; Expected `Buffer` or `atob` to be defined");
}, xr = "warn", Ar = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500
}, $s = (r, t, e) => {
  if (r) {
    if (hf(Ar, r))
      return r;
    e.warn(`${t} was set to ${JSON.stringify(r)}, expected one of ${JSON.stringify(Object.keys(Ar))}`);
  }
};
function xt() {
}
function Pn(r, t, e) {
  return !t || Ar[r] > Ar[e] ? xt : t[r].bind(t);
}
const Uf = {
  error: xt,
  warn: xt,
  info: xt,
  debug: xt
};
let fa = /* @__PURE__ */ new WeakMap();
function Fs(r, t) {
  const e = fa.get(r);
  if (e && e[0] === t)
    return e[1];
  const n = {
    error: Pn("error", r, t),
    warn: Pn("warn", r, t),
    info: Pn("info", r, t),
    debug: Pn("debug", r, t)
  };
  return fa.set(r, [t, n]), n;
}
function F(r) {
  const t = r.logger, e = r.logLevel ?? "off";
  return t ? Fs(t, e) : Uf;
}
let pa, Kr;
function Wf() {
  const r = C("ANTHROPIC_LOG");
  return (!Kr || r !== pa) && (pa = r, Kr = Fs(console, $s(r, "process.env['ANTHROPIC_LOG']", Fs(console, xr)) ?? xr)), Kr;
}
function je(r, t, e) {
  r.debug !== xt && r.debug(t, Df(e));
}
const Df = (r) => (r.options && (r.options = { ...r.options }, delete r.options.headers), r.headers && (r.headers = Object.fromEntries((r.headers instanceof Headers ? [...r.headers] : Object.entries(r.headers)).map(([t, e]) => [
  t,
  t.toLowerCase() === "authorization" || t.toLowerCase() === "api-key" || t.toLowerCase() === "x-api-key" || t.toLowerCase() === "cookie" || t.toLowerCase() === "set-cookie" ? "***" : e
]))), "retryOfRequestLogID" in r && (r.retryOfRequestLogID && (r.retryOf = r.retryOfRequestLogID), delete r.retryOfRequestLogID), r);
let js = function() {
  const { crypto: r } = globalThis;
  if (r != null && r.randomUUID)
    return js = r.randomUUID.bind(r), r.randomUUID();
  const t = new Uint8Array(1), e = r ? () => r.getRandomValues(t)[0] : () => Math.random() * 255 & 255;
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (n) => (+n ^ e() & 15 >> +n / 4).toString(16));
};
const il = "1.0", Hf = /^[A-Za-z0-9_.-]+$/;
function al(r) {
  if (!r)
    throw new Error("profile name is empty");
  if (r === "." || r === "..")
    throw new Error(`profile name "${r}" is not allowed`);
  if (r.includes("/") || r.includes("\\"))
    throw new Error(`profile name "${r}" must not contain path separators`);
  if (!Hf.test(r))
    throw new Error(`profile name "${r}" contains disallowed characters (allowed: letters, digits, '_', '.', '-')`);
}
const qf = async (r) => {
  var t, e;
  const n = await hi();
  if (n === null)
    return null;
  const s = r ?? await ol();
  if (s === null)
    return null;
  al(s);
  const { fs: i, path: a } = await import("./node-Cz2Ted7k.js"), o = a.join(n, "configs", `${s}.json`);
  let l;
  try {
    l = await i.promises.readFile(o, "utf-8");
  } catch (h) {
    if ((h == null ? void 0 : h.code) !== "ENOENT")
      throw new Error(`failed to read config file ${o}: ${h}`);
    l = null;
  }
  if (l === null) {
    const h = C("ANTHROPIC_ORGANIZATION_ID"), g = C("ANTHROPIC_IDENTITY_TOKEN_FILE"), f = C("ANTHROPIC_FEDERATION_RULE_ID");
    return f && h ? {
      fromFile: !1,
      config: {
        organization_id: h,
        // A defaulted-but-empty CI variable (`ANTHROPIC_WORKSPACE_ID=""`) is
        // treated as unset — readEnv coerces empty to undefined, and the body
        // builder's truthy check skips it — so `"workspace_id": ""` never goes
        // on the wire.
        workspace_id: C("ANTHROPIC_WORKSPACE_ID"),
        base_url: C("ANTHROPIC_BASE_URL"),
        authentication: {
          type: "oidc_federation",
          federation_rule_id: f,
          service_account_id: C("ANTHROPIC_SERVICE_ACCOUNT_ID"),
          identity_token: g ? { source: "file", path: g } : void 0,
          scope: C("ANTHROPIC_SCOPE")
        }
      }
    } : null;
  }
  let u;
  try {
    u = JSON.parse(l);
  } catch (h) {
    throw new Error(`failed to parse config file ${o}: ${h}`);
  }
  if (!u.authentication)
    throw new Error(`config file ${o} is missing "authentication"`);
  const d = u.authentication.type;
  if (d !== "oidc_federation" && d !== "user_oauth")
    throw new Error(`authentication.type "${d}" is not a known authentication type`);
  if (u.organization_id ?? (u.organization_id = C("ANTHROPIC_ORGANIZATION_ID")), u.workspace_id ?? (u.workspace_id = C("ANTHROPIC_WORKSPACE_ID")), u.base_url ?? (u.base_url = C("ANTHROPIC_BASE_URL")), (t = u.authentication).scope ?? (t.scope = C("ANTHROPIC_SCOPE")), u.authentication.type === "oidc_federation") {
    if (!u.authentication.identity_token) {
      const h = C("ANTHROPIC_IDENTITY_TOKEN_FILE");
      h && (u.authentication.identity_token = {
        source: "file",
        path: h
      });
    }
    u.authentication.federation_rule_id || (u.authentication.federation_rule_id = C("ANTHROPIC_FEDERATION_RULE_ID") ?? ""), (e = u.authentication).service_account_id ?? (e.service_account_id = C("ANTHROPIC_SERVICE_ACCOUNT_ID"));
  }
  return { config: u, fromFile: !0 };
}, Vf = async (r, t) => {
  if (r != null && r.authentication.credentials_path)
    return r.authentication.credentials_path;
  const e = await hi();
  if (!e)
    return null;
  const n = t ?? await ol();
  if (!n)
    return null;
  al(n);
  const { path: s } = await import("./node-Cz2Ted7k.js");
  return s.join(e, "credentials", `${n}.json`);
}, hi = async () => {
  if (!zf())
    return null;
  const { path: r } = await import("./node-Cz2Ted7k.js"), t = C("ANTHROPIC_CONFIG_DIR");
  if (t)
    return t;
  if (ci()["X-Stainless-OS"] === "Windows") {
    const i = C("APPDATA");
    if (i)
      return r.join(i, "Anthropic");
    const a = C("USERPROFILE");
    return a ? r.join(a, "AppData", "Roaming", "Anthropic") : null;
  }
  const n = C("XDG_CONFIG_HOME");
  if (n)
    return r.join(n, "anthropic");
  const s = C("HOME");
  return s ? r.join(s, ".config", "anthropic") : null;
}, zf = () => {
  const r = ci()["X-Stainless-Runtime"];
  return r === "node" || r === "deno";
}, ol = async () => {
  const r = await hi();
  if (!r)
    return null;
  const t = C("ANTHROPIC_PROFILE");
  if (t)
    return t;
  const { fs: e, path: n } = await import("./node-Cz2Ted7k.js"), s = n.join(r, "active_config");
  try {
    return (await e.promises.readFile(s, "utf-8")).trim() || "default";
  } catch (i) {
    if ((i == null ? void 0 : i.code) !== "ENOENT")
      throw new Error(`failed to read ${s}: ${i}`);
    return "default";
  }
};
function ga(r) {
  if (!r)
    throw new E("Identity token file path is empty");
  return async () => {
    const { fs: t } = await import("./node-Cz2Ted7k.js");
    let e;
    try {
      e = await t.promises.readFile(r, "utf-8");
    } catch (s) {
      throw new E(`Failed to read identity token file at ${r}: ${s}`);
    }
    const n = e.trim();
    if (!n)
      throw new E(`Identity token file at ${r} is empty`);
    return n;
  };
}
function Xf(r) {
  if (!r)
    throw new E("Identity token value is empty");
  return () => r;
}
function Kf(r) {
  return async () => {
    tl(r.baseURL);
    const t = await r.identityTokenProvider();
    if (t.length > 16 * 1024)
      throw new B(`Identity token is ${Math.ceil(t.length / 1024)} KiB, exceeds the 16 KiB assertion limit`);
    const e = {
      grant_type: Nf,
      assertion: t,
      federation_rule_id: r.federationRuleId,
      organization_id: r.organizationId
    };
    r.serviceAccountId && (e.service_account_id = r.serviceAccountId), r.workspaceId && (e.workspace_id = r.workspaceId);
    const n = `${r.baseURL}${el}`;
    let s;
    try {
      s = await r.fetch(n, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-beta": `${Tr},${Mf}`,
          "User-Agent": r.userAgent || `anthropic-sdk-typescript/${He} oidcFederationProvider`
        },
        body: JSON.stringify(e)
      });
    } catch (l) {
      throw new B(`Failed to reach token endpoint ${n}: ${l}`);
    }
    const i = s.headers.get("Request-Id");
    if (!s.ok) {
      const l = await s.text().catch(() => ""), u = _e(l);
      let d = "";
      throw s.status === 401 && (d = ` Ensure your federation rule matches your identity token. ${r.workspaceId ? "" : "If your federation rule is scoped to multiple workspaces, set the ANTHROPIC_WORKSPACE_ID environment variable, the 'workspace_id' config key, or the `workspaceId` option. "}View your authentication events in the Workload identity page of Claude Console for more details.`), new B(`Token exchange failed with status ${s.status}${i ? ` (request-id ${i})` : ""}: ${u}${d}`, s.status, u, i);
    }
    const a = await nl(s, i), o = Number(a.expires_in);
    if (!Number.isFinite(o))
      throw new B(`Token endpoint response missing required fields: ${JSON.stringify(_e(a))}`, s.status, _e(a), i);
    return {
      token: a.access_token,
      expiresAt: it() + o
    };
  };
}
function Yf(r) {
  return async (t) => {
    const { fs: e } = await import("./node-Cz2Ted7k.js");
    await rl(r.credentialsPath, r.onSafetyWarning);
    let n;
    try {
      n = await e.promises.readFile(r.credentialsPath, "utf-8");
    } catch (v) {
      throw new B(`Credentials file not found at ${r.credentialsPath}: ${v}`);
    }
    let s;
    try {
      s = JSON.parse(n);
    } catch (v) {
      throw new B(`Credentials file at ${r.credentialsPath} is not valid JSON: ${v}`);
    }
    const i = s.access_token;
    if (!i)
      throw new B(`Credentials file at ${r.credentialsPath} must include 'access_token'`);
    const a = s.expires_at;
    if (!(t != null && t.forceRefresh) && (a == null || it() < a - di))
      return { token: i, expiresAt: a ?? null };
    const o = s.refresh_token;
    if (!r.clientId || !o)
      throw new B(`Access token at ${r.credentialsPath} has expired and no refresh is available (client_id ${r.clientId ? "set" : "empty"}, refresh_token ${o ? "set" : "empty"})`);
    tl(r.baseURL);
    const l = {
      grant_type: Of,
      refresh_token: o,
      client_id: r.clientId
    }, u = `${r.baseURL}${el}`;
    let d;
    try {
      d = await r.fetch(u, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-beta": Tr,
          "User-Agent": r.userAgent || `anthropic-sdk-typescript/${He} userOAuthProvider`
        },
        body: JSON.stringify(l)
      });
    } catch (v) {
      throw new B(`User OAuth refresh failed to reach token endpoint: ${v}`);
    }
    const h = d.headers.get("Request-Id");
    if (!d.ok) {
      const v = await d.text().catch(() => "");
      throw new B(`User OAuth refresh failed (HTTP ${d.status}): ${_e(v)}`, d.status, _e(v), h);
    }
    const g = await nl(d, h), f = Number(g.expires_in);
    if (!Number.isFinite(f))
      throw new B(`User OAuth refresh response missing or invalid expires_in: ${JSON.stringify(_e(g))}`, d.status, _e(g), h);
    const m = it() + f, y = g.refresh_token || o;
    return await sl(r.credentialsPath, {
      ...s,
      version: il,
      type: "oauth_token",
      access_token: g.access_token,
      expires_at: m,
      refresh_token: y
    }), { token: g.access_token, expiresAt: m };
  };
}
function cl(r, t) {
  const e = r.authentication.credentials_path ?? null, n = (r.base_url || t.baseURL).replace(/\/+$/, ""), s = Gf(r, e, n, t), i = {};
  return r.workspace_id && r.authentication.type === "user_oauth" && (i["anthropic-workspace-id"] = r.workspace_id), { provider: s, extraHeaders: i, baseURL: r.base_url || void 0 };
}
async function Jf(r, t) {
  const e = await qf(t);
  if (!e)
    return null;
  const { config: n, fromFile: s } = e, i = n.authentication.credentials_path || !s ? n : {
    ...n,
    authentication: {
      ...n.authentication,
      credentials_path: await Vf(n, t) ?? void 0
    }
  };
  return cl(i, r);
}
function Gf(r, t, e, n) {
  switch (r.authentication.type) {
    case "oidc_federation": {
      const s = r.authentication, i = Qf(s);
      if (!i)
        throw new B("oidc_federation config requires an identity token (set authentication.identity_token, ANTHROPIC_IDENTITY_TOKEN_FILE, or ANTHROPIC_IDENTITY_TOKEN)");
      if (!s.federation_rule_id)
        throw new B("oidc_federation config requires 'federation_rule_id'. Set it in authentication.federation_rule_id in your profile, or via ANTHROPIC_FEDERATION_RULE_ID (profile takes precedence).");
      if (!r.organization_id)
        throw new B("oidc_federation config requires organization_id (set ANTHROPIC_ORGANIZATION_ID or config.organization_id)");
      const a = Kf({
        identityTokenProvider: i,
        federationRuleId: s.federation_rule_id,
        organizationId: r.organization_id,
        serviceAccountId: s.service_account_id,
        workspaceId: r.workspace_id,
        baseURL: e,
        fetch: n.fetch,
        userAgent: n.userAgent
      });
      return t ? Zf(a, t, n.onCacheWriteError, n.onSafetyWarning) : a;
    }
    case "user_oauth": {
      if (!t)
        throw new B("user_oauth config requires authentication.credentials_path (or load via a profile so it defaults to <config_dir>/credentials/<profile>.json)");
      return Yf({
        credentialsPath: t,
        clientId: r.authentication.client_id,
        baseURL: e,
        fetch: n.fetch,
        userAgent: n.userAgent,
        onSafetyWarning: n.onSafetyWarning
      });
    }
    default: {
      const s = r.authentication.type;
      throw new B(`authentication.type "${s}" is not a known authentication type`);
    }
  }
}
function Qf(r) {
  if (r.identity_token) {
    const n = r.identity_token.source;
    if (n !== "file")
      throw new B(`identity_token.source "${n}" is not supported by this SDK version (only "file")`);
    if (!r.identity_token.path)
      throw new B('identity_token.source "file" requires a non-empty path');
    return ga(r.identity_token.path);
  }
  const t = C("ANTHROPIC_IDENTITY_TOKEN_FILE");
  if (t)
    return ga(t);
  const e = C("ANTHROPIC_IDENTITY_TOKEN");
  return e ? Xf(e) : null;
}
function Zf(r, t, e, n) {
  return async (s) => {
    const { fs: i } = await import("./node-Cz2Ted7k.js");
    await rl(t, n);
    let a;
    try {
      const l = await i.promises.readFile(t, "utf-8");
      a = JSON.parse(l);
      const u = a == null ? void 0 : a.access_token;
      if (u && !(s != null && s.forceRefresh)) {
        const d = a == null ? void 0 : a.expires_at;
        if (d == null || it() < d - di)
          return { token: u, expiresAt: d ?? null };
      }
    } catch (l) {
      (l == null ? void 0 : l.code) !== "ENOENT" && !(l instanceof SyntaxError) && (e == null || e(l));
    }
    const o = await r(s);
    try {
      await sl(t, {
        ...a ?? {},
        version: il,
        type: "oauth_token",
        access_token: o.token,
        expires_at: o.expiresAt
      });
    } catch (l) {
      e == null || e(l);
    }
    return o;
  };
}
var oe, ce, fi = /* @__PURE__ */ (() => {
  class r {
    constructor() {
      oe.set(this, void 0), ce.set(this, void 0), w(this, oe, new Uint8Array()), w(this, ce, null);
    }
    decode(e) {
      if (e == null)
        return [];
      const n = e instanceof ArrayBuffer ? new Uint8Array(e) : typeof e == "string" ? ui(e) : e;
      w(this, oe, jf([c(this, oe, "f"), n]));
      const s = [];
      let i;
      for (; (i = ep(c(this, oe, "f"), c(this, ce, "f"))) != null; ) {
        if (i.carriage && c(this, ce, "f") == null) {
          w(this, ce, i.index);
          continue;
        }
        if (c(this, ce, "f") != null && (i.index !== c(this, ce, "f") + 1 || i.carriage)) {
          s.push(Ps(c(this, oe, "f").subarray(0, c(this, ce, "f") - 1))), w(this, oe, c(this, oe, "f").subarray(c(this, ce, "f"))), w(this, ce, null);
          continue;
        }
        const a = c(this, ce, "f") !== null ? i.preceding - 1 : i.preceding, o = Ps(c(this, oe, "f").subarray(0, a));
        s.push(o), w(this, oe, c(this, oe, "f").subarray(i.index)), w(this, ce, null);
      }
      return s;
    }
    flush() {
      return c(this, oe, "f").length ? this.decode(`
`) : [];
    }
  }
  return oe = /* @__PURE__ */ new WeakMap(), ce = /* @__PURE__ */ new WeakMap(), r.NEWLINE_CHARS = /* @__PURE__ */ new Set([`
`, "\r"]), r.NEWLINE_REGEXP = /\r\n|[\n\r]/g, r;
})();
function ep(r, t) {
  for (let s = t ?? 0; s < r.length; s++) {
    if (r[s] === 10)
      return { preceding: s, index: s + 1, carriage: !1 };
    if (r[s] === 13)
      return { preceding: s, index: s + 1, carriage: !0 };
  }
  return null;
}
function tp(r) {
  for (let n = 0; n < r.length - 1; n++) {
    if (r[n] === 10 && r[n + 1] === 10 || r[n] === 13 && r[n + 1] === 13)
      return n + 2;
    if (r[n] === 13 && r[n + 1] === 10 && n + 3 < r.length && r[n + 2] === 13 && r[n + 3] === 10)
      return n + 4;
  }
  return -1;
}
var Jt, Ut = /* @__PURE__ */ (() => {
  class r {
    constructor(e, n, s) {
      this.iterator = e, Jt.set(this, void 0), this.controller = n, w(this, Jt, s);
    }
    /**
     * Iterate the raw Server-Sent Events from `response` — `{event, data, raw}`
     * objects, before any JSON parsing or event-name filtering.
     *
     * This reads `response.body` directly (not a clone), so the response is
     * consumed. Use this in middleware that fully replaces the stream body; for
     * read-only observation of parsed events, use `ctx.parse()` instead.
     */
    static rawEvents(e, n = new AbortController()) {
      return ma(e, n);
    }
    static fromSSEResponse(e, n, s) {
      let i = !1;
      const a = s ? F(s) : console;
      async function* o() {
        var u;
        if (i)
          throw new E("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
        i = !0;
        let l = !1;
        try {
          for await (const d of ma(e, n)) {
            if (d.event === "completion")
              try {
                yield JSON.parse(d.data);
              } catch (h) {
                throw a.error("Could not parse message into JSON:", d.data), a.error("From chunk:", d.raw), h;
              }
            if (d.event === "message_start" || d.event === "message_delta" || d.event === "message_stop" || d.event === "content_block_start" || d.event === "content_block_delta" || d.event === "content_block_stop" || d.event === "message" || d.event === "user.message" || d.event === "user.interrupt" || d.event === "user.tool_confirmation" || d.event === "user.custom_tool_result" || d.event === "user.tool_result" || d.event === "agent.message" || d.event === "agent.thinking" || d.event === "agent.tool_use" || d.event === "agent.tool_result" || d.event === "agent.mcp_tool_use" || d.event === "agent.mcp_tool_result" || d.event === "agent.custom_tool_use" || d.event === "agent.thread_context_compacted" || d.event === "session.status_running" || d.event === "session.status_idle" || d.event === "session.status_rescheduled" || d.event === "session.status_terminated" || d.event === "session.error" || d.event === "session.deleted" || d.event === "session.updated" || d.event === "span.model_request_start" || d.event === "span.model_request_end" || d.event === "span.outcome_evaluation_start" || d.event === "span.outcome_evaluation_ongoing" || d.event === "span.outcome_evaluation_end" || d.event === "user.define_outcome" || d.event === "agent.thread_message_received" || d.event === "agent.thread_message_sent" || d.event === "agent.session_thread_message_received" || d.event === "agent.session_thread_message_sent" || d.event === "session.thread_created" || d.event === "session.thread_status_created" || d.event === "session.thread_status_running" || d.event === "session.thread_status_idle" || d.event === "session.thread_status_rescheduled" || d.event === "session.thread_status_terminated" || d.event === "event_start" || d.event === "event_delta" || d.event === "system.message")
              try {
                yield JSON.parse(d.data);
              } catch (h) {
                throw a.error("Could not parse message into JSON:", d.data), a.error("From chunk:", d.raw), h;
              }
            if (d.event !== "ping" && d.event === "error") {
              const h = zc(d.data) ?? d.data, g = (u = h == null ? void 0 : h.error) == null ? void 0 : u.type;
              throw new K(void 0, h, void 0, e.headers, g);
            }
          }
          l = !0;
        } catch (d) {
          if (Bt(d))
            return;
          throw d;
        } finally {
          l || n.abort(), st(n);
        }
      }
      return new r(o, n, s);
    }
    /**
     * Generates a Stream from a newline-separated ReadableStream
     * where each item is a JSON value.
     */
    static fromReadableStream(e, n, s) {
      let i = !1;
      async function* a() {
        const l = new fi(), u = li(e);
        for await (const d of u)
          for (const h of l.decode(d))
            yield h;
        for (const d of l.flush())
          yield d;
      }
      async function* o() {
        if (i)
          throw new E("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
        i = !0;
        let l = !1;
        try {
          for await (const u of a())
            l || u && (yield JSON.parse(u));
          l = !0;
        } catch (u) {
          if (Bt(u))
            return;
          throw u;
        } finally {
          l || n.abort(), st(n);
        }
      }
      return new r(o, n, s);
    }
    [(Jt = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
      return this.iterator();
    }
    /**
     * Splits the stream into two streams which can be
     * independently read from at different speeds.
     */
    tee() {
      const e = [], n = [], s = this.iterator(), i = (a) => ({
        next: () => {
          if (a.length === 0) {
            const o = s.next();
            e.push(o), n.push(o);
          }
          return a.shift();
        }
      });
      return [
        new r(() => i(e), this.controller, c(this, Jt, "f")),
        new r(() => i(n), this.controller, c(this, Jt, "f"))
      ];
    }
    /**
     * Converts this stream to a newline-separated ReadableStream of
     * JSON stringified values in the stream
     * which can be turned back into a Stream with `Stream.fromReadableStream()`.
     */
    toReadableStream() {
      const e = this;
      let n;
      return Xc({
        async start() {
          n = e[Symbol.asyncIterator]();
        },
        async pull(s) {
          try {
            const { value: i, done: a } = await n.next();
            if (a)
              return s.close();
            const o = ui(JSON.stringify(i) + `
`);
            s.enqueue(o);
          } catch (i) {
            s.error(i);
          }
        },
        async cancel() {
          var s;
          await ((s = n.return) == null ? void 0 : s.call(n));
        }
      });
    }
  }
  return r;
})();
async function* ma(r, t) {
  if (!r.body)
    throw t.abort(), typeof globalThis.navigator < "u" && globalThis.navigator.product === "ReactNative" ? new E("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api") : new E("Attempted to iterate over a response with no body");
  const e = new rp(), n = new fi(), s = li(r.body);
  for await (const i of np(s))
    for (const a of n.decode(i)) {
      const o = e.decode(a);
      o && (yield o);
    }
  for (const i of n.flush()) {
    const a = e.decode(i);
    a && (yield a);
  }
}
async function* np(r) {
  let t = new Uint8Array();
  for await (const e of r) {
    if (e == null)
      continue;
    const n = e instanceof ArrayBuffer ? new Uint8Array(e) : typeof e == "string" ? ui(e) : e;
    let s = new Uint8Array(t.length + n.length);
    s.set(t), s.set(n, t.length), t = s;
    let i;
    for (; (i = tp(t)) !== -1; )
      yield t.subarray(0, i), t = t.subarray(i);
  }
  t.length > 0 && (yield t);
}
class rp {
  constructor() {
    this.event = null, this.data = [], this.chunks = [];
  }
  decode(t) {
    if (t.endsWith("\r") && (t = t.substring(0, t.length - 1)), !t) {
      if (!this.event && !this.data.length)
        return null;
      const i = {
        event: this.event,
        data: this.data.join(`
`),
        raw: this.chunks
      };
      return this.event = null, this.data = [], this.chunks = [], i;
    }
    if (this.chunks.push(t), t.startsWith(":"))
      return null;
    let [e, n, s] = sp(t, ":");
    return s.startsWith(" ") && (s = s.substring(1)), e === "event" ? this.event = s : e === "data" && this.data.push(s), null;
  }
}
function sp(r, t) {
  const e = r.indexOf(t);
  return e !== -1 ? [r.substring(0, e), t, r.substring(e + t.length)] : [r, "", ""];
}
async function ll(r, t) {
  const { response: e, requestLogID: n, retryOfRequestLogID: s, startTime: i } = t, a = await (async () => {
    var h;
    if (t.options.stream)
      return F(r).debug("response", e.status, e.url, e.headers, e.body), Ut.fromSSEResponse(e, t.controller, r);
    if (e.status === 204)
      return null;
    if (t.options.__binaryResponse)
      return e;
    const o = e.headers.get("content-type"), l = (h = o == null ? void 0 : o.split(";")[0]) == null ? void 0 : h.trim();
    if ((l == null ? void 0 : l.includes("application/json")) || (l == null ? void 0 : l.endsWith("+json"))) {
      if (e.headers.get("content-length") === "0")
        return;
      const f = await e.json();
      return pi(f, e);
    }
    return await e.text();
  })().finally(() => {
    !t.options.stream && !t.options.__binaryResponse && st(t.controller);
  });
  return je(F(r), `[${n}] response parsed`, {
    retryOfRequestLogID: s,
    url: e.url,
    status: e.status,
    body: a,
    durationMs: Date.now() - i
  }), a;
}
function pi(r, t) {
  return !r || typeof r != "object" || Array.isArray(r) ? r : Object.defineProperties(r, {
    _request_id: { value: t.headers.get("request-id"), enumerable: !1 },
    _workspace_id: { value: t.headers.get("anthropic-workspace-id"), enumerable: !1 }
  });
}
const dl = /* @__PURE__ */ new WeakSet();
function ul(r) {
  return typeof r == "object" && r !== null && dl.has(r);
}
function ip(r) {
  const t = /* @__PURE__ */ new Set();
  for (; typeof r == "object" && r !== null && !t.has(r); ) {
    if (t.add(r), ul(r) || Bt(r) || r instanceof vn || r instanceof lf)
      return !0;
    r = r.cause;
  }
  return !1;
}
function _a(r, t, e, n) {
  return async (s, i = {}) => {
    var l;
    if (t.length === 0)
      return r.call(void 0, s, i);
    const a = i.headers instanceof Headers ? i.headers : new Headers(i.headers), o = await op(r, t, e, n)({
      ...i,
      headers: a,
      url: typeof s == "string" ? s : s instanceof URL ? s.href : s.url
    });
    if (o.bodyUsed || (l = o.body) != null && l.locked)
      throw new E("middleware consumed the response body; use response.clone() to inspect it, or return new Response(body, response) to consume and replace it");
    return o;
  };
}
function ap(r, t) {
  const e = /* @__PURE__ */ new WeakMap();
  return {
    options: r,
    // Resolved per chain, so changes to the client's `logLevel`/`logger`
    // apply to subsequent requests.
    logger: t ? F(t) : Wf(),
    parse(n) {
      if (r != null && r.stream && n.ok)
        return wa(n, r, t);
      let s = e.get(n);
      return s || (s = wa(n, r, t), e.set(n, s)), s;
    }
  };
}
async function wa(r, t, e) {
  var a, o;
  if (r.bodyUsed || (a = r.body) != null && a.locked)
    throw new E("cannot ctx.parse() a response whose body was already consumed; call ctx.parse() instead of reading the body, or read via response.clone()");
  if (t != null && t.stream && r.ok)
    return Ut.fromSSEResponse(r.clone(), new AbortController(), e);
  if (r.status === 204)
    return null;
  if (t != null && t.__binaryResponse)
    return r;
  const n = r.headers.get("content-type"), s = (o = n == null ? void 0 : n.split(";")[0]) == null ? void 0 : o.trim();
  return (s == null ? void 0 : s.includes("application/json")) || (s == null ? void 0 : s.endsWith("+json")) ? r.headers.get("content-length") === "0" ? void 0 : pi(await r.clone().json(), r) : await r.clone().text();
}
function op(r, t, e, n) {
  let s = async ({ url: a, ...o }) => {
    try {
      return await r.call(void 0, a, o);
    } catch (l) {
      const u = Sr(l);
      throw dl.add(u), u;
    }
  };
  const i = ap(e, n);
  for (let a = t.length - 1; a >= 0; a--) {
    const o = t[a], l = s;
    s = async (u) => o(u, l, i);
  }
  return s;
}
var Gt, hl = /* @__PURE__ */ (() => {
  class r extends Promise {
    constructor(e, n, s = ll) {
      super((i) => {
        i(null);
      }), this.responsePromise = n, this.parseResponse = s, Gt.set(this, void 0), w(this, Gt, e);
    }
    _thenUnwrap(e) {
      return new r(c(this, Gt, "f"), this.responsePromise, async (n, s) => pi(e(await this.parseResponse(n, s), s), s.response));
    }
    /**
     * Gets the raw `Response` instance instead of parsing the response
     * data.
     *
     * If you want to parse the response body but still get the `Response`
     * instance, you can use {@link withResponse()}.
     *
     * 👋 Getting the wrong TypeScript type for `Response`?
     * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
     * to your `tsconfig.json`.
     */
    asResponse() {
      return this.responsePromise.then((e) => e.response);
    }
    /**
     * Gets the parsed response data, the raw `Response` instance and the ID of the request,
     * returned via the `request-id` header which is useful for debugging requests and resporting
     * issues to Anthropic.
     *
     * If you just want to get the raw `Response` instance without parsing it,
     * you can use {@link asResponse()}.
     *
     * 👋 Getting the wrong TypeScript type for `Response`?
     * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
     * to your `tsconfig.json`.
     */
    async withResponse() {
      const [e, n] = await Promise.all([this.parse(), this.asResponse()]);
      return {
        data: e,
        response: n,
        request_id: n.headers.get("request-id"),
        workspace_id: n.headers.get("anthropic-workspace-id")
      };
    }
    parse() {
      return this.parsedPromise || (this.parsedPromise = this.responsePromise.then((e) => this.parseResponse(c(this, Gt, "f"), e))), this.parsedPromise;
    }
    then(e, n) {
      return this.parse().then(e, n);
    }
    catch(e) {
      return this.parse().catch(e);
    }
    finally(e) {
      return this.parse().finally(e);
    }
  }
  return Gt = /* @__PURE__ */ new WeakMap(), r;
})(), $n, gi = /* @__PURE__ */ (() => {
  class r {
    constructor(e, n, s, i) {
      $n.set(this, void 0), w(this, $n, e), this.options = i, this.response = n, this.body = s;
    }
    hasNextPage() {
      return this.getPaginatedItems().length ? this.nextPageRequestOptions() != null : !1;
    }
    async getNextPage() {
      const e = this.nextPageRequestOptions();
      if (!e)
        throw new E("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");
      return await c(this, $n, "f").requestAPIList(this.constructor, e);
    }
    async *iterPages() {
      let e = this;
      for (yield e; e.hasNextPage(); )
        e = await e.getNextPage(), yield e;
    }
    async *[($n = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
      for await (const e of this.iterPages())
        for (const n of e.getPaginatedItems())
          yield n;
    }
  }
  return r;
})(), cp = /* @__PURE__ */ (() => {
  class r extends hl {
    constructor(e, n, s) {
      super(e, n, async (i, a) => new s(i, a.response, await ll(i, a), a.options));
    }
    /**
     * Allow auto-paginating iteration on an unawaited list call, eg:
     *
     *    for await (const item of client.items.list()) {
     *      console.log(item)
     *    }
     */
    async *[Symbol.asyncIterator]() {
      const e = await this;
      for await (const n of e)
        yield n;
    }
  }
  return r;
})();
class Oe extends gi {
  constructor(t, e, n, s) {
    super(t, e, n, s), this.data = n.data || [], this.has_more = n.has_more || !1, this.first_id = n.first_id || null, this.last_id = n.last_id || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    return this.has_more === !1 ? !1 : super.hasNextPage();
  }
  nextPageRequestOptions() {
    var e;
    if ((e = this.options.query) != null && e.before_id) {
      const n = this.first_id;
      return n ? {
        ...this.options,
        query: {
          ...kr(this.options.query),
          before_id: n
        }
      } : null;
    }
    const t = this.last_id;
    return t ? {
      ...this.options,
      query: {
        ...kr(this.options.query),
        after_id: t
      }
    } : null;
  }
}
class L extends gi {
  constructor(t, e, n, s) {
    super(t, e, n, s), this.data = n.data || [], this.next_page = n.next_page || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  nextPageRequestOptions() {
    const t = this.next_page;
    return t ? {
      ...this.options,
      query: {
        ...kr(this.options.query),
        page: t
      }
    } : null;
  }
}
class lp extends gi {
  constructor(t, e, n, s) {
    super(t, e, n, s), this.data = n.data || [], this.next_page = n.next_page || null, this.prev_page = n.prev_page || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  nextPageRequestOptions() {
    const t = this.next_page;
    return t ? {
      ...this.options,
      query: {
        ...kr(this.options.query),
        page: t
      }
    } : null;
  }
}
const fl = () => {
  var r;
  if (typeof File > "u") {
    const { process: t } = globalThis, e = typeof ((r = t == null ? void 0 : t.versions) == null ? void 0 : r.node) == "string" && parseInt(t.versions.node.split(".")) < 20;
    throw new Error("`File` is not defined as a global, which is required for file uploads." + (e ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`." : ""));
  }
};
function Ct(r, t, e) {
  return fl(), new File(r, t ?? "unknown_file", e);
}
function hr(r, t) {
  const e = typeof r == "object" && r !== null && ("name" in r && r.name && String(r.name) || "url" in r && r.url && String(r.url) || "filename" in r && r.filename && String(r.filename) || "path" in r && r.path && String(r.path)) || "";
  return t ? e.split(/[\\/]/).pop() || void 0 : e;
}
const pl = (r) => r != null && typeof r == "object" && typeof r[Symbol.asyncIterator] == "function", Wt = async (r, t, e = !0) => ({ ...r, body: await up(r.body, t, e) }), ya = /* @__PURE__ */ new WeakMap();
function dp(r) {
  const t = typeof r == "function" ? r : r.fetch, e = ya.get(t);
  if (e)
    return e;
  const n = (async () => {
    try {
      const s = "Response" in t ? t.Response : (await t("data:,")).constructor, i = new FormData();
      return i.toString() !== await new s(i).text();
    } catch {
      return !0;
    }
  })();
  return ya.set(t, n), n;
}
const up = async (r, t, e = !0) => {
  if (!await dp(t))
    throw new TypeError("The provided fetch function does not support file uploads with the current global FormData class.");
  const n = new FormData();
  return await Promise.all(Object.entries(r || {}).map(([s, i]) => Bs(n, s, i, e))), n;
}, Bs = async (r, t, e, n) => {
  if (e !== void 0) {
    if (e == null)
      throw new TypeError(`Received null for "${t}"; to pass null in FormData, you must use the string 'null'`);
    if (typeof e == "string" || typeof e == "number" || typeof e == "boolean")
      r.append(t, String(e));
    else if (e instanceof Response) {
      let s = {};
      const i = e.headers.get("Content-Type");
      i && (s = { type: i }), r.append(t, Ct([await e.blob()], hr(e, n), s));
    } else if (pl(e))
      r.append(t, Ct([await new Response(Kc(e)).blob()], hr(e, n)));
    else if (e instanceof Blob)
      r.append(t, Ct([e], hr(e, n) || void 0, { type: e.type }));
    else if (Array.isArray(e))
      await Promise.all(e.map((s) => Bs(r, t + "[]", s, n)));
    else {
      if (typeof e.then == "function")
        throw new TypeError(`Received a Promise for "${t}"; await it first, e.g. \`await toFile(...)\``);
      if (e instanceof ArrayBuffer || ArrayBuffer.isView(e))
        throw new TypeError(`Received ${e.constructor.name} for "${t}"; to upload raw bytes, wrap them with \`await toFile(bytes, 'filename')\``);
      if (typeof e == "object")
        await Promise.all(Object.entries(e).map(([s, i]) => Bs(r, `${t}[${s}]`, i, n)));
      else
        throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${e} instead`);
    }
  }
}, gl = (r) => r != null && typeof r == "object" && typeof r.size == "number" && typeof r.type == "string" && typeof r.text == "function" && typeof r.slice == "function" && typeof r.arrayBuffer == "function", hp = (r) => r != null && typeof r == "object" && typeof r.name == "string" && typeof r.lastModified == "number" && gl(r), fp = (r) => r != null && typeof r == "object" && typeof r.url == "string" && typeof r.blob == "function";
async function pp(r, t, e) {
  if (fl(), r = await r, t || (t = hr(r, !0)), hp(r))
    return r instanceof File && t == null && e == null ? r : Ct([await r.arrayBuffer()], t ?? r.name, {
      type: r.type,
      lastModified: r.lastModified,
      ...e
    });
  if (fp(r)) {
    const s = await r.blob();
    return t || (t = new URL(r.url).pathname.split(/[\\/]/).pop()), Ct(await Us(s), t, e);
  }
  const n = await Us(r);
  if (!(e != null && e.type)) {
    const s = n.find((i) => typeof i == "object" && "type" in i && i.type);
    typeof s == "string" && (e = { ...e, type: s });
  }
  return Ct(n, t, e);
}
async function Us(r) {
  var e;
  let t = [];
  if (typeof r == "string" || ArrayBuffer.isView(r) || // includes Uint8Array, Buffer, etc.
  r instanceof ArrayBuffer)
    t.push(r);
  else if (gl(r))
    t.push(r instanceof Blob ? r : await r.arrayBuffer());
  else if (pl(r))
    for await (const n of r)
      t.push(...await Us(n));
  else {
    const n = (e = r == null ? void 0 : r.constructor) == null ? void 0 : e.name;
    throw new Error(`Unexpected data type: ${typeof r}${n ? `; constructor: ${n}` : ""}${gp(r)}`);
  }
  return t;
}
function gp(r) {
  return typeof r != "object" || r === null ? "" : `; props: [${Object.getOwnPropertyNames(r).map((e) => `"${e}"`).join(", ")}]`;
}
class I {
  constructor(t) {
    this._client = t;
  }
}
const ml = Symbol.for("brand.privateNullableHeaders");
function* mp(r) {
  if (!r)
    return;
  if (ml in r) {
    const { values: n, nulls: s } = r;
    yield* n.entries();
    for (const i of s)
      yield [i, null];
    return;
  }
  let t = !1, e;
  r instanceof Headers ? e = r.entries() : ta(r) ? e = r : (t = !0, e = Object.entries(r ?? {}));
  for (let n of e) {
    const s = n[0];
    if (typeof s != "string")
      throw new TypeError("expected header name to be a string");
    const i = ta(n[1]) ? n[1] : [n[1]];
    let a = !1;
    for (const o of i)
      o !== void 0 && (t && !a && (a = !0, yield [s, fr]), yield [s, o]);
  }
}
const fr = Symbol("clear"), _p = /* @__PURE__ */ new Set(["x-stainless-helper"]), wp = (r, t) => {
  const e = r ? r.split(",").map((n) => n.trim()).filter(Boolean) : [];
  for (const n of t.split(",").map((s) => s.trim()))
    n && !e.includes(n) && e.push(n);
  return e.join(", ");
}, p = (r) => {
  const t = new Headers(), e = /* @__PURE__ */ new Set();
  for (const n of r) {
    const s = /* @__PURE__ */ new Set();
    for (const [i, a] of mp(n)) {
      const o = i.toLowerCase();
      if (_p.has(o)) {
        if (a === fr)
          continue;
        a === null ? (t.delete(i), e.add(o)) : (t.set(i, wp(t.get(i), a)), e.delete(o));
        continue;
      }
      (a === fr || !s.has(o)) && (t.delete(i), s.add(o), a === fr) || (a === null ? (t.delete(i), e.add(o)) : (t.append(i, a), e.delete(o)));
    }
  }
  return { [ml]: !0, values: t, nulls: e };
};
function _l(r) {
  return r.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
const ba = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null)), yp = (r = _l) => function(e, ...n) {
  if (e.length === 1)
    return e[0];
  let s = !1;
  const i = [], a = e.reduce((d, h, g) => {
    var y;
    /[?#]/.test(h) && (s = !0);
    const f = n[g];
    let m = (s ? encodeURIComponent : r)("" + f);
    return g !== n.length && (f == null || typeof f == "object" && // handle values from other realms
    f.toString === ((y = Object.getPrototypeOf(Object.getPrototypeOf(f.hasOwnProperty ?? ba) ?? ba)) == null ? void 0 : y.toString)) && (m = f + "", i.push({
      start: d.length + h.length,
      length: m.length,
      error: `Value of type ${Object.prototype.toString.call(f).slice(8, -1)} is not a valid path parameter`
    })), d + h + (g === n.length ? "" : m);
  }, ""), o = a.split(/[?#]/, 1)[0], l = new RegExp("(?<=^|\\/)(?:\\.|%2e){1,2}(?=\\/|$)", "gi");
  let u;
  for (; (u = l.exec(o)) !== null; )
    i.push({
      start: u.index,
      length: u[0].length,
      error: `Value "${u[0]}" can't be safely passed as a path parameter`
    });
  if (i.sort((d, h) => d.start - h.start), i.length > 0) {
    let d = 0;
    const h = i.reduce((g, f) => {
      const m = " ".repeat(f.start - d), y = "^".repeat(f.length);
      return d = f.start + f.length, g + m + y;
    }, "");
    throw new E(`Path parameters result in path with invalid segments:
${i.map((g) => g.error).join(`
`)}
${a}
${h}`);
  }
  return a;
}, _ = /* @__PURE__ */ yp(_l);
class Ea extends I {
  /**
   * Get Deployment Run
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeploymentRun =
   *   await client.beta.deploymentRuns.retrieve(
   *     'deployment_run_id',
   *   );
   * ```
   */
  retrieve(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.get(_`/v1/deployment_runs/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List Deployment Runs
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsDeploymentRun of client.beta.deploymentRuns.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { betas: n, workspace_id: s, ...i } = t ?? {};
    return this._client.getAPIList("/v1/deployment_runs?beta=true", L, {
      query: i,
      ...e,
      headers: p([
        {
          "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString(),
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
}
class Sa extends I {
  /**
   * Create Deployment
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeployment =
   *   await client.beta.deployments.create({
   *     agent: 'string',
   *     environment_id: 'x',
   *     initial_events: [
   *       {
   *         content: [
   *           {
   *             text: 'Where is my order #1234?',
   *             type: 'text',
   *           },
   *         ],
   *         type: 'user.message',
   *       },
   *     ],
   *     name: 'x',
   *   });
   * ```
   */
  create(t, e) {
    const { betas: n, workspace_id: s, ...i } = t;
    return this._client.post("/v1/deployments?beta=true", {
      body: i,
      ...e,
      headers: p([
        {
          "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString(),
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Get Deployment
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeployment =
   *   await client.beta.deployments.retrieve(
   *     'depl_011CZkZcDH3vPqd7xnEfwTai',
   *   );
   * ```
   */
  retrieve(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.get(_`/v1/deployments/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Update Deployment
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeployment =
   *   await client.beta.deployments.update(
   *     'depl_011CZkZcDH3vPqd7xnEfwTai',
   *   );
   * ```
   */
  update(t, e, n) {
    const { betas: s, workspace_id: i, ...a } = e;
    return this._client.post(_`/v1/deployments/${t}?beta=true`, {
      body: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List Deployments
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsDeployment of client.beta.deployments.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { betas: n, workspace_id: s, ...i } = t ?? {};
    return this._client.getAPIList("/v1/deployments?beta=true", L, {
      query: i,
      ...e,
      headers: p([
        {
          "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString(),
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Archive Deployment
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeployment =
   *   await client.beta.deployments.archive(
   *     'depl_011CZkZcDH3vPqd7xnEfwTai',
   *   );
   * ```
   */
  archive(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.post(_`/v1/deployments/${t}/archive?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Pause Deployment
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeployment =
   *   await client.beta.deployments.pause(
   *     'depl_011CZkZcDH3vPqd7xnEfwTai',
   *   );
   * ```
   */
  pause(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.post(_`/v1/deployments/${t}/pause?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Run Deployment Now
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeploymentRun =
   *   await client.beta.deployments.run(
   *     'depl_011CZkZcDH3vPqd7xnEfwTai',
   *   );
   * ```
   */
  run(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.post(_`/v1/deployments/${t}/run?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Unpause Deployment
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeployment =
   *   await client.beta.deployments.unpause(
   *     'depl_011CZkZcDH3vPqd7xnEfwTai',
   *   );
   * ```
   */
  unpause(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.post(_`/v1/deployments/${t}/unpause?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
class ka extends I {
  /**
   * Start an asynchronous job that uses past sessions to produce a reorganized
   * version of a memory store and get back the dream to poll for the result.
   *
   * By default the dream writes its result to a new memory store and doesn't change
   * the input memory store. The response has `status` set to `pending` and an empty
   * `outputs` array. Poll the dream until `status` is `completed`, `failed`, or
   * `canceled`.
   *
   * See the
   * [Dreams guide](https://platform.claude.com/docs/en/managed-agents/dreams#create-a-dream)
   * to learn more about creating dreams.
   *
   * @example
   * ```ts
   * const betaDream = await client.beta.dreams.create({
   *   inputs: [{ memory_store_id: 'x', type: 'memory_store' }],
   *   model: 'string',
   * });
   * ```
   */
  create(t, e) {
    const { betas: n, workspace_id: s, ...i } = t;
    return this._client.post("/v1/dreams?beta=true", {
      body: i,
      ...e,
      headers: p([
        {
          "anthropic-beta": [...n ?? [], "dreaming-2026-04-21"].toString(),
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Get a dream by ID to check its status, output memory store, and token usage.
   *
   * Archived dreams are returned too.
   *
   * See the
   * [Dreams guide](https://platform.claude.com/docs/en/managed-agents/dreams#track-progress)
   * for how to poll a dream and what each status means.
   *
   * @example
   * ```ts
   * const betaDream = await client.beta.dreams.retrieve(
   *   'dream_id',
   * );
   * ```
   */
  retrieve(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.get(_`/v1/dreams/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "dreaming-2026-04-21"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List the dreams in the workspace, newest first.
   *
   * Archived dreams are left out unless `include_archived` is `true`.
   *
   * See the
   * [Dreams guide](https://platform.claude.com/docs/en/managed-agents/dreams#list-dreams)
   * for how to page through dreams.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaDream of client.beta.dreams.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { betas: n, workspace_id: s, ...i } = t ?? {};
    return this._client.getAPIList("/v1/dreams?beta=true", L, {
      query: i,
      ...e,
      headers: p([
        {
          "anthropic-beta": [...n ?? [], "dreaming-2026-04-21"].toString(),
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Hide a `completed`, `failed`, or `canceled` dream from the default list of
   * dreams.
   *
   * Archiving a `pending` or `running` dream returns a 400 error, so cancel it
   * first. Archiving an archived dream returns it unchanged. An archived dream can
   * still be fetched by ID. Archiving can't be undone.
   *
   * See the
   * [Dreams guide](https://platform.claude.com/docs/en/managed-agents/dreams#archive-a-dream)
   * to learn more about archiving dreams.
   *
   * @example
   * ```ts
   * const betaDream = await client.beta.dreams.archive(
   *   'dream_id',
   * );
   * ```
   */
  archive(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.post(_`/v1/dreams/${t}/archive?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "dreaming-2026-04-21"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Stop a `pending` or `running` dream.
   *
   * The response shows `status` as `canceled`, unless the dream reached `completed`
   * or `failed` first. `usage` can keep changing after the response. Canceling a
   * `canceled` dream returns it unchanged. Canceling a `completed` or `failed` dream
   * returns a 400 error.
   *
   * See the
   * [Dreams guide](https://platform.claude.com/docs/en/managed-agents/dreams#cancel-a-dream)
   * to learn more about canceling dreams.
   *
   * @example
   * ```ts
   * const betaDream = await client.beta.dreams.cancel(
   *   'dream_id',
   * );
   * ```
   */
  cancel(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.post(_`/v1/dreams/${t}/cancel?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "dreaming-2026-04-21"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
const An = "x-stainless-helper", wl = "x-stainless-helper-method";
function Ws(r) {
  return { [An]: r };
}
const At = Symbol("anthropic.sdk.stainlessHelper");
function bn(r) {
  return typeof r == "object" && r !== null && At in r;
}
function yl(r, t) {
  var n;
  const e = /* @__PURE__ */ new Set();
  if (r)
    for (const s of r)
      bn(s) && e.add(s[At]);
  if (t)
    for (const s of t) {
      bn(s) && e.add(s[At]);
      const i = s.content;
      if (Array.isArray(i))
        for (const a of i) {
          bn(a) && e.add(a[At]);
          const o = (n = a == null ? void 0 : a.tool) == null ? void 0 : n.definition;
          bn(o) && e.add(o[At]);
        }
    }
  return Array.from(e);
}
function bl(r, t) {
  const e = yl(r, t);
  return e.length === 0 ? {} : { [An]: e.join(", ") };
}
function El(r) {
  return bn(r) ? { [An]: r[At] } : {};
}
let va = class extends I {
  /**
   * List Files
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaFileMetadata of client.beta.files.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { betas: n, workspace_id: s, ...i } = t ?? {};
    return this._client.getAPIList("/v1/files?beta=true", L, {
      query: i,
      ...e,
      headers: p([
        {
          ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0,
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Delete File
   *
   * @example
   * ```ts
   * const betaDeletedFile = await client.beta.files.delete(
   *   'file_id',
   * );
   * ```
   */
  delete(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.delete(_`/v1/files/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0,
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Download File
   *
   * @example
   * ```ts
   * const response = await client.beta.files.download(
   *   'file_id',
   * );
   *
   * const content = await response.blob();
   * console.log(content);
   * ```
   */
  download(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.get(_`/v1/files/${t}/content?beta=true`, {
      ...n,
      headers: p([
        {
          Accept: "application/binary",
          ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0,
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ]),
      __binaryResponse: !0
    });
  }
  /**
   * Get File Metadata
   *
   * @example
   * ```ts
   * const betaFileMetadata =
   *   await client.beta.files.retrieveMetadata('file_id');
   * ```
   */
  retrieveMetadata(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.get(_`/v1/files/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0,
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Upload File
   *
   * @example
   * ```ts
   * const betaFileMetadata = await client.beta.files.upload({
   *   file: fs.createReadStream('path/to/file'),
   * });
   * ```
   */
  upload(t, e) {
    const { betas: n, workspace_id: s, ...i } = t;
    return this._client.post("/v1/files?beta=true", Wt({
      body: i,
      ...e,
      headers: p([
        {
          ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0,
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        El(i.file),
        e == null ? void 0 : e.headers
      ])
    }, this._client));
  }
}, Ta = class extends I {
  /**
   * Get a specific model.
   *
   * The Models API response can be used to determine information about a specific
   * model or resolve a model alias to a model ID.
   *
   * @example
   * ```ts
   * const betaModelInfo = await client.beta.models.retrieve(
   *   'model_id',
   * );
   * ```
   */
  retrieve(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.get(_`/v1/models/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0,
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List available models.
   *
   * The Models API response can be used to determine which models are available for
   * use in the API. More recently released models are listed first.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaModelInfo of client.beta.models.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { betas: n, workspace_id: s, ...i } = t ?? {};
    return this._client.getAPIList("/v1/models?beta=true", Oe, {
      query: i,
      ...e,
      headers: p([
        {
          ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0,
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
};
class xa extends I {
  /**
   * Create User Profile
   *
   * @example
   * ```ts
   * const betaUserProfile =
   *   await client.beta.userProfiles.create();
   * ```
   */
  create(t, e) {
    const { betas: n, workspace_id: s, ...i } = t;
    return this._client.post("/v1/user_profiles?beta=true", {
      body: i,
      ...e,
      headers: p([
        {
          "anthropic-beta": [...n ?? [], "user-profiles-2026-08-18"].toString(),
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Get User Profile
   *
   * @example
   * ```ts
   * const betaUserProfile =
   *   await client.beta.userProfiles.retrieve(
   *     'uprof_011CZkZCu8hGbp5mYRQgUmz9',
   *   );
   * ```
   */
  retrieve(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.get(_`/v1/user_profiles/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "user-profiles-2026-08-18"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Update User Profile
   *
   * @example
   * ```ts
   * const betaUserProfile =
   *   await client.beta.userProfiles.update(
   *     'uprof_011CZkZCu8hGbp5mYRQgUmz9',
   *   );
   * ```
   */
  update(t, e, n) {
    const { betas: s, workspace_id: i, ...a } = e;
    return this._client.post(_`/v1/user_profiles/${t}?beta=true`, {
      body: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "user-profiles-2026-08-18"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List User Profiles
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaUserProfile of client.beta.userProfiles.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { betas: n, workspace_id: s, ...i } = t ?? {};
    return this._client.getAPIList("/v1/user_profiles?beta=true", L, {
      query: i,
      ...e,
      headers: p([
        {
          "anthropic-beta": [...n ?? [], "user-profiles-2026-08-18"].toString(),
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Create Enrollment URL
   *
   * @example
   * ```ts
   * const betaUserProfileEnrollmentURL =
   *   await client.beta.userProfiles.createEnrollmentURL(
   *     'uprof_011CZkZCu8hGbp5mYRQgUmz9',
   *   );
   * ```
   */
  createEnrollmentURL(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.post(_`/v1/user_profiles/${t}/enrollment_url?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "user-profiles-2026-08-18"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
var Ds = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {}, Tn = {}, be = {}, bp = Ds && Ds.__extends || /* @__PURE__ */ function() {
  var r = function(t, e) {
    return r = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(n, s) {
      n.__proto__ = s;
    } || function(n, s) {
      for (var i in s) s.hasOwnProperty(i) && (n[i] = s[i]);
    }, r(t, e);
  };
  return function(t, e) {
    r(t, e);
    function n() {
      this.constructor = t;
    }
    t.prototype = e === null ? Object.create(e) : (n.prototype = e.prototype, new n());
  };
}();
Object.defineProperty(be, "__esModule", { value: !0 });
var V = 256, mi = (
  /** @class */
  function() {
    function r(t) {
      t === void 0 && (t = "="), this._paddingCharacter = t;
    }
    return r.prototype.encodedLength = function(t) {
      return this._paddingCharacter ? (t + 2) / 3 * 4 | 0 : (t * 8 + 5) / 6 | 0;
    }, r.prototype.encode = function(t) {
      for (var e = "", n = 0; n < t.length - 2; n += 3) {
        var s = t[n] << 16 | t[n + 1] << 8 | t[n + 2];
        e += this._encodeByte(s >>> 3 * 6 & 63), e += this._encodeByte(s >>> 2 * 6 & 63), e += this._encodeByte(s >>> 1 * 6 & 63), e += this._encodeByte(s >>> 0 * 6 & 63);
      }
      var i = t.length - n;
      if (i > 0) {
        var s = t[n] << 16 | (i === 2 ? t[n + 1] << 8 : 0);
        e += this._encodeByte(s >>> 3 * 6 & 63), e += this._encodeByte(s >>> 2 * 6 & 63), i === 2 ? e += this._encodeByte(s >>> 1 * 6 & 63) : e += this._paddingCharacter || "", e += this._paddingCharacter || "";
      }
      return e;
    }, r.prototype.maxDecodedLength = function(t) {
      return this._paddingCharacter ? t / 4 * 3 | 0 : (t * 6 + 7) / 8 | 0;
    }, r.prototype.decodedLength = function(t) {
      return this.maxDecodedLength(t.length - this._getPaddingLength(t));
    }, r.prototype.decode = function(t) {
      if (t.length === 0)
        return new Uint8Array(0);
      for (var e = this._getPaddingLength(t), n = t.length - e, s = new Uint8Array(this.maxDecodedLength(n)), i = 0, a = 0, o = 0, l = 0, u = 0, d = 0, h = 0; a < n - 4; a += 4)
        l = this._decodeChar(t.charCodeAt(a + 0)), u = this._decodeChar(t.charCodeAt(a + 1)), d = this._decodeChar(t.charCodeAt(a + 2)), h = this._decodeChar(t.charCodeAt(a + 3)), s[i++] = l << 2 | u >>> 4, s[i++] = u << 4 | d >>> 2, s[i++] = d << 6 | h, o |= l & V, o |= u & V, o |= d & V, o |= h & V;
      if (a < n - 1 && (l = this._decodeChar(t.charCodeAt(a)), u = this._decodeChar(t.charCodeAt(a + 1)), s[i++] = l << 2 | u >>> 4, o |= l & V, o |= u & V), a < n - 2 && (d = this._decodeChar(t.charCodeAt(a + 2)), s[i++] = u << 4 | d >>> 2, o |= d & V), a < n - 3 && (h = this._decodeChar(t.charCodeAt(a + 3)), s[i++] = d << 6 | h, o |= h & V), o !== 0)
        throw new Error("Base64Coder: incorrect characters for decoding");
      return s;
    }, r.prototype._encodeByte = function(t) {
      var e = t;
      return e += 65, e += 25 - t >>> 8 & 6, e += 51 - t >>> 8 & -75, e += 61 - t >>> 8 & -15, e += 62 - t >>> 8 & 3, String.fromCharCode(e);
    }, r.prototype._decodeChar = function(t) {
      var e = V;
      return e += (42 - t & t - 44) >>> 8 & -V + t - 43 + 62, e += (46 - t & t - 48) >>> 8 & -V + t - 47 + 63, e += (47 - t & t - 58) >>> 8 & -V + t - 48 + 52, e += (64 - t & t - 91) >>> 8 & -V + t - 65 + 0, e += (96 - t & t - 123) >>> 8 & -V + t - 97 + 26, e;
    }, r.prototype._getPaddingLength = function(t) {
      var e = 0;
      if (this._paddingCharacter) {
        for (var n = t.length - 1; n >= 0 && t[n] === this._paddingCharacter; n--)
          e++;
        if (t.length < 4 || e > 2)
          throw new Error("Base64Coder: incorrect padding");
      }
      return e;
    }, r;
  }()
);
be.Coder = mi;
var Rn = new mi();
function Ep(r) {
  return Rn.encode(r);
}
be.encode = Ep;
function Sp(r) {
  return Rn.decode(r);
}
be.decode = Sp;
var Sl = (
  /** @class */
  function(r) {
    bp(t, r);
    function t() {
      return r !== null && r.apply(this, arguments) || this;
    }
    return t.prototype._encodeByte = function(e) {
      var n = e;
      return n += 65, n += 25 - e >>> 8 & 6, n += 51 - e >>> 8 & -75, n += 61 - e >>> 8 & -13, n += 62 - e >>> 8 & 49, String.fromCharCode(n);
    }, t.prototype._decodeChar = function(e) {
      var n = V;
      return n += (44 - e & e - 46) >>> 8 & -V + e - 45 + 62, n += (94 - e & e - 96) >>> 8 & -V + e - 95 + 63, n += (47 - e & e - 58) >>> 8 & -V + e - 48 + 52, n += (64 - e & e - 91) >>> 8 & -V + e - 65 + 0, n += (96 - e & e - 123) >>> 8 & -V + e - 97 + 26, n;
    }, t;
  }(mi)
);
be.URLSafeCoder = Sl;
var kl = new Sl();
function kp(r) {
  return kl.encode(r);
}
be.encodeURLSafe = kp;
function vp(r) {
  return kl.decode(r);
}
be.decodeURLSafe = vp;
be.encodedLength = function(r) {
  return Rn.encodedLength(r);
};
be.maxDecodedLength = function(r) {
  return Rn.maxDecodedLength(r);
};
be.decodedLength = function(r) {
  return Rn.decodedLength(r);
};
var vl = { exports: {} };
(function(r) {
  (function(t, e) {
    var n = {};
    e(n);
    var s = n.default;
    for (var i in n)
      s[i] = n[i];
    r.exports = s;
  })(Ds, function(t) {
    t.__esModule = !0, t.digestLength = 32, t.blockSize = 64;
    var e = new Uint32Array([
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ]);
    function n(g, f, m, y, v) {
      for (var T, b, N, x, S, A, P, U, j, M, Y, Me, Ce; v >= 64; ) {
        for (T = f[0], b = f[1], N = f[2], x = f[3], S = f[4], A = f[5], P = f[6], U = f[7], M = 0; M < 16; M++)
          Y = y + M * 4, g[M] = (m[Y] & 255) << 24 | (m[Y + 1] & 255) << 16 | (m[Y + 2] & 255) << 8 | m[Y + 3] & 255;
        for (M = 16; M < 64; M++)
          j = g[M - 2], Me = (j >>> 17 | j << 15) ^ (j >>> 19 | j << 13) ^ j >>> 10, j = g[M - 15], Ce = (j >>> 7 | j << 25) ^ (j >>> 18 | j << 14) ^ j >>> 3, g[M] = (Me + g[M - 7] | 0) + (Ce + g[M - 16] | 0);
        for (M = 0; M < 64; M++)
          Me = (((S >>> 6 | S << 26) ^ (S >>> 11 | S << 21) ^ (S >>> 25 | S << 7)) + (S & A ^ ~S & P) | 0) + (U + (e[M] + g[M] | 0) | 0) | 0, Ce = ((T >>> 2 | T << 30) ^ (T >>> 13 | T << 19) ^ (T >>> 22 | T << 10)) + (T & b ^ T & N ^ b & N) | 0, U = P, P = A, A = S, S = x + Me | 0, x = N, N = b, b = T, T = Me + Ce | 0;
        f[0] += T, f[1] += b, f[2] += N, f[3] += x, f[4] += S, f[5] += A, f[6] += P, f[7] += U, y += 64, v -= 64;
      }
      return y;
    }
    var s = (
      /** @class */
      function() {
        function g() {
          this.digestLength = t.digestLength, this.blockSize = t.blockSize, this.state = new Int32Array(8), this.temp = new Int32Array(64), this.buffer = new Uint8Array(128), this.bufferLength = 0, this.bytesHashed = 0, this.finished = !1, this.reset();
        }
        return g.prototype.reset = function() {
          return this.state[0] = 1779033703, this.state[1] = 3144134277, this.state[2] = 1013904242, this.state[3] = 2773480762, this.state[4] = 1359893119, this.state[5] = 2600822924, this.state[6] = 528734635, this.state[7] = 1541459225, this.bufferLength = 0, this.bytesHashed = 0, this.finished = !1, this;
        }, g.prototype.clean = function() {
          for (var f = 0; f < this.buffer.length; f++)
            this.buffer[f] = 0;
          for (var f = 0; f < this.temp.length; f++)
            this.temp[f] = 0;
          this.reset();
        }, g.prototype.update = function(f, m) {
          if (m === void 0 && (m = f.length), this.finished)
            throw new Error("SHA256: can't update because hash was finished.");
          var y = 0;
          if (this.bytesHashed += m, this.bufferLength > 0) {
            for (; this.bufferLength < 64 && m > 0; )
              this.buffer[this.bufferLength++] = f[y++], m--;
            this.bufferLength === 64 && (n(this.temp, this.state, this.buffer, 0, 64), this.bufferLength = 0);
          }
          for (m >= 64 && (y = n(this.temp, this.state, f, y, m), m %= 64); m > 0; )
            this.buffer[this.bufferLength++] = f[y++], m--;
          return this;
        }, g.prototype.finish = function(f) {
          if (!this.finished) {
            var m = this.bytesHashed, y = this.bufferLength, v = m / 536870912 | 0, T = m << 3, b = m % 64 < 56 ? 64 : 128;
            this.buffer[y] = 128;
            for (var N = y + 1; N < b - 8; N++)
              this.buffer[N] = 0;
            this.buffer[b - 8] = v >>> 24 & 255, this.buffer[b - 7] = v >>> 16 & 255, this.buffer[b - 6] = v >>> 8 & 255, this.buffer[b - 5] = v >>> 0 & 255, this.buffer[b - 4] = T >>> 24 & 255, this.buffer[b - 3] = T >>> 16 & 255, this.buffer[b - 2] = T >>> 8 & 255, this.buffer[b - 1] = T >>> 0 & 255, n(this.temp, this.state, this.buffer, 0, b), this.finished = !0;
          }
          for (var N = 0; N < 8; N++)
            f[N * 4 + 0] = this.state[N] >>> 24 & 255, f[N * 4 + 1] = this.state[N] >>> 16 & 255, f[N * 4 + 2] = this.state[N] >>> 8 & 255, f[N * 4 + 3] = this.state[N] >>> 0 & 255;
          return this;
        }, g.prototype.digest = function() {
          var f = new Uint8Array(this.digestLength);
          return this.finish(f), f;
        }, g.prototype._saveState = function(f) {
          for (var m = 0; m < this.state.length; m++)
            f[m] = this.state[m];
        }, g.prototype._restoreState = function(f, m) {
          for (var y = 0; y < this.state.length; y++)
            this.state[y] = f[y];
          this.bytesHashed = m, this.finished = !1, this.bufferLength = 0;
        }, g;
      }()
    );
    t.Hash = s;
    var i = (
      /** @class */
      function() {
        function g(f) {
          this.inner = new s(), this.outer = new s(), this.blockSize = this.inner.blockSize, this.digestLength = this.inner.digestLength;
          var m = new Uint8Array(this.blockSize);
          if (f.length > this.blockSize)
            new s().update(f).finish(m).clean();
          else
            for (var y = 0; y < f.length; y++)
              m[y] = f[y];
          for (var y = 0; y < m.length; y++)
            m[y] ^= 54;
          this.inner.update(m);
          for (var y = 0; y < m.length; y++)
            m[y] ^= 106;
          this.outer.update(m), this.istate = new Uint32Array(8), this.ostate = new Uint32Array(8), this.inner._saveState(this.istate), this.outer._saveState(this.ostate);
          for (var y = 0; y < m.length; y++)
            m[y] = 0;
        }
        return g.prototype.reset = function() {
          return this.inner._restoreState(this.istate, this.inner.blockSize), this.outer._restoreState(this.ostate, this.outer.blockSize), this;
        }, g.prototype.clean = function() {
          for (var f = 0; f < this.istate.length; f++)
            this.ostate[f] = this.istate[f] = 0;
          this.inner.clean(), this.outer.clean();
        }, g.prototype.update = function(f) {
          return this.inner.update(f), this;
        }, g.prototype.finish = function(f) {
          return this.outer.finished ? this.outer.finish(f) : (this.inner.finish(f), this.outer.update(f, this.digestLength).finish(f)), this;
        }, g.prototype.digest = function() {
          var f = new Uint8Array(this.digestLength);
          return this.finish(f), f;
        }, g;
      }()
    );
    t.HMAC = i;
    function a(g) {
      var f = new s().update(g), m = f.digest();
      return f.clean(), m;
    }
    t.hash = a, t.default = a;
    function o(g, f) {
      var m = new i(g).update(f), y = m.digest();
      return m.clean(), y;
    }
    t.hmac = o;
    function l(g, f, m, y) {
      var v = y[0];
      if (v === 0)
        throw new Error("hkdf: cannot expand more");
      f.reset(), v > 1 && f.update(g), m && f.update(m), f.update(y), f.finish(g), y[0]++;
    }
    var u = new Uint8Array(t.digestLength);
    function d(g, f, m, y) {
      f === void 0 && (f = u), y === void 0 && (y = 32);
      for (var v = new Uint8Array([1]), T = o(f, g), b = new i(T), N = new Uint8Array(b.digestLength), x = N.length, S = new Uint8Array(y), A = 0; A < y; A++)
        x === N.length && (l(N, b, m, v), x = 0), S[A] = N[x++];
      return b.clean(), N.fill(0), v.fill(0), S;
    }
    t.hkdf = d;
    function h(g, f, m, y) {
      for (var v = new i(g), T = v.digestLength, b = new Uint8Array(4), N = new Uint8Array(T), x = new Uint8Array(T), S = new Uint8Array(y), A = 0; A * T < y; A++) {
        var P = A + 1;
        b[0] = P >>> 24 & 255, b[1] = P >>> 16 & 255, b[2] = P >>> 8 & 255, b[3] = P >>> 0 & 255, v.reset(), v.update(f), v.update(b), v.finish(x);
        for (var U = 0; U < T; U++)
          N[U] = x[U];
        for (var U = 2; U <= m; U++) {
          v.reset(), v.update(x).finish(x);
          for (var j = 0; j < T; j++)
            N[j] ^= x[j];
        }
        for (var U = 0; U < T && A * T + U < y; U++)
          S[A * T + U] = N[U];
      }
      for (var A = 0; A < T; A++)
        N[A] = x[A] = 0;
      for (var A = 0; A < 4; A++)
        b[A] = 0;
      return v.clean(), S;
    }
    t.pbkdf2 = h;
  });
})(vl);
var Tp = vl.exports, _i = {};
Object.defineProperty(_i, "__esModule", { value: !0 });
_i.timingSafeEqual = xp;
function Aa(r, t = "") {
  if (!r)
    throw new Error(t);
}
function xp(r, t) {
  if (r.byteLength !== t.byteLength)
    return !1;
  r instanceof DataView || (r = new DataView(ArrayBuffer.isView(r) ? r.buffer : r)), t instanceof DataView || (t = new DataView(ArrayBuffer.isView(t) ? t.buffer : t)), Aa(r instanceof DataView), Aa(t instanceof DataView);
  const e = r.byteLength;
  let n = 0, s = -1;
  for (; ++s < e; )
    n |= r.getUint8(s) ^ t.getUint8(s);
  return n === 0;
}
Object.defineProperty(Tn, "__esModule", { value: !0 });
var Tl = Tn.Webhook = Tn.WebhookVerificationError = void 0;
const Ra = be, Ap = Tp, Rp = _i, Ia = 5 * 60;
class wi extends Error {
  constructor(t) {
    super(t), Object.setPrototypeOf(this, wi.prototype), this.name = "ExtendableError", this.stack = new Error(t).stack;
  }
}
class qe extends wi {
  constructor(t) {
    super(t), Object.setPrototypeOf(this, qe.prototype), this.name = "WebhookVerificationError";
  }
}
Tn.WebhookVerificationError = qe;
class xn {
  constructor(t, e) {
    if ((e == null ? void 0 : e.format) === "raw")
      t instanceof Uint8Array ? this.key = t : this.key = Uint8Array.from(t, (n) => n.charCodeAt(0));
    else {
      if (typeof t != "string")
        throw new Error("Expected secret to be of type string");
      t.startsWith(xn.prefix) && (t = t.substring(xn.prefix.length)), this.key = Ra.decode(t);
    }
    if (this.key.length === 0)
      throw new Error("Secret can't be empty.");
  }
  verify(t, e, n) {
    var s;
    const i = (s = n == null ? void 0 : n.jsonParse) !== null && s !== void 0 ? s : !0, a = {};
    for (const y of Object.keys(e))
      a[y.toLowerCase()] = e[y];
    const o = a["webhook-id"], l = a["webhook-signature"], u = a["webhook-timestamp"];
    if (!l || !o || !u)
      throw new qe("Missing required headers");
    const d = this.verifyTimestamp(u), g = this.sign(o, d, t).split(",")[1], f = l.split(" "), m = new globalThis.TextEncoder();
    for (const y of f) {
      const [v, T] = y.split(",");
      if (v === "v1" && (0, Rp.timingSafeEqual)(m.encode(T), m.encode(g))) {
        const b = t.toString();
        return b === "" ? void 0 : i ? JSON.parse(b) : void 0;
      }
    }
    throw new qe("No matching signature found");
  }
  sign(t, e, n) {
    if (typeof n != "string") if (n.constructor.name === "Buffer")
      n = n.toString();
    else
      throw new Error("Expected payload to be of type string or Buffer.");
    const s = new TextEncoder(), i = Math.floor(e.getTime() / 1e3), a = s.encode(`${t}.${i}.${n}`);
    return `v1,${Ra.encode(Ap.hmac(this.key, a))}`;
  }
  verifyTimestamp(t) {
    const e = Math.floor(Date.now() / 1e3), n = parseInt(t, 10);
    if (Number.isNaN(n))
      throw new qe("Invalid Signature Headers");
    if (e - n > Ia)
      throw new qe("Message timestamp too old");
    if (n > e + Ia)
      throw new qe("Message timestamp too new");
    return new Date(n * 1e3);
  }
}
Tl = Tn.Webhook = xn;
xn.prefix = "whsec_";
class Na extends I {
  /**
   * Parses a webhook payload into an event without verifying its signature. Prefer
   * `unwrap()` unless you have already verified the signature yourself.
   */
  parseUnverified(t) {
    return JSON.parse(t);
  }
  /**
   * Verifies the webhook signature from the `webhook-id`, `webhook-timestamp` and
   * `webhook-signature` headers using your webhook signing key, then parses the
   * payload into an event. Fails if the signature is missing or invalid.
   */
  unwrap(t, e) {
    const n = e == null ? void 0 : e.headers;
    if (n == null)
      throw new Error("Webhook headers are required in order to verify the signature");
    const s = e.key === void 0 ? this._client.webhookKey : e.key;
    if (!s)
      throw new Error("Webhook key must not be null or empty in order to unwrap");
    return new Tl(s).verify(t, n), JSON.parse(t);
  }
}
let Oa = class extends I {
  /**
   * List Agent Versions
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsAgent of client.beta.agents.versions.list(
   *   'agent_011CZkYpogX7uDKUyvBTophP',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, workspace_id: i, ...a } = e ?? {};
    return this._client.getAPIList(_`/v1/agents/${t}/versions?beta=true`, L, {
      query: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
};
var Ma = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.versions = new Oa(this._client);
    }
    /**
     * Create Agent
     *
     * @example
     * ```ts
     * const betaManagedAgentsAgent =
     *   await client.beta.agents.create({
     *     model: 'claude-opus-5',
     *     name: 'My First Agent',
     *   });
     * ```
     */
    create(e, n) {
      const { betas: s, workspace_id: i, ...a } = e;
      return this._client.post("/v1/agents?beta=true", {
        body: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Get Agent
     *
     * @example
     * ```ts
     * const betaManagedAgentsAgent =
     *   await client.beta.agents.retrieve(
     *     'agent_011CZkYpogX7uDKUyvBTophP',
     *   );
     * ```
     */
    retrieve(e, n = {}, s) {
      const { betas: i, workspace_id: a, ...o } = n ?? {};
      return this._client.get(_`/v1/agents/${e}?beta=true`, {
        query: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Update Agent
     *
     * @example
     * ```ts
     * const betaManagedAgentsAgent =
     *   await client.beta.agents.update(
     *     'agent_011CZkYpogX7uDKUyvBTophP',
     *     { description: 'updated' },
     *   );
     * ```
     */
    update(e, n, s) {
      const { betas: i, workspace_id: a, ...o } = n;
      return this._client.post(_`/v1/agents/${e}?beta=true`, {
        body: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * List Agents
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaManagedAgentsAgent of client.beta.agents.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { betas: s, workspace_id: i, ...a } = e ?? {};
      return this._client.getAPIList("/v1/agents?beta=true", L, {
        query: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Archive Agent
     *
     * @example
     * ```ts
     * const betaManagedAgentsAgent =
     *   await client.beta.agents.archive(
     *     'agent_011CZkYpogX7uDKUyvBTophP',
     *   );
     * ```
     */
    archive(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.post(_`/v1/agents/${e}/archive?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Versions = Oa, r;
})();
function In(r, t) {
  if (!r)
    return () => {
    };
  if (r.aborted)
    return t.abort(), () => {
    };
  const e = () => t.abort();
  return r.addEventListener("abort", e), () => r.removeEventListener("abort", e);
}
function Lt(r, t) {
  return r instanceof K && r.status === t;
}
function Ip(r) {
  return r instanceof K && typeof r.status == "number" && r.status >= 400 && r.status < 500;
}
function Rr(r) {
  return Ip(r) && !Lt(r, 408) && !Lt(r, 409) && !Lt(r, 429);
}
function xl(r, t, e) {
  return Math.min(t * 2 ** r, e);
}
function Np(r, t) {
  return r + Math.random() * (t - r);
}
function Al(r) {
  return r * (1 - Math.random() * 0.25);
}
function Rl(r, { authToken: t, helper: e }) {
  var l;
  if (!t)
    throw new E(`copyClientForHelper: expected a non-empty authToken but received ${JSON.stringify(t)}`);
  const n = r, s = n._options.defaultHeaders, i = (l = n._authState) == null ? void 0 : l.extraHeaders, a = i ? Object.fromEntries(Object.entries(i).filter(([u]) => {
    const d = u.toLowerCase();
    return d !== "authorization" && d !== "x-api-key";
  })) : void 0, o = p([
    a,
    s,
    { [An]: e }
  ]);
  return r.withOptions({
    apiKey: null,
    authToken: t,
    baseURL: r.baseURL,
    credentials: void 0,
    defaultHeaders: o
  });
}
var dt, Fn, ue, jn, Bn, Un, Qt, Zt, ut, ht, Wn, ft, en;
const Op = 999, Mp = 1e3, Cp = 6e4, Lp = 3e5;
var Hs = /* @__PURE__ */ (() => {
  class r {
    constructor(e) {
      dt.set(this, void 0), Fn.set(this, !1), ue.set(this, void 0), jn.set(this, void 0), Bn.set(this, void 0), Un.set(this, void 0), Qt.set(this, void 0), Zt.set(this, void 0), ut.set(this, void 0), this.client = e.client, this.environmentId = e.environmentId, this.environmentKey = e.environmentKey, this.workerId = e.workerId ?? Fp(), w(this, dt, Rl(e.client, {
        authToken: e.environmentKey,
        helper: "environments-work-poller"
      })), w(this, Bn, e.autoStop ?? !0), w(this, Un, e.drain ?? !1), w(this, Qt, e.blockMs === void 0 ? Op : e.blockMs), w(this, Zt, e.reclaimOlderThanMs ?? null), w(this, ut, e.requestOptions), w(this, ue, new AbortController()), w(this, jn, In(e.signal, c(this, ue, "f")));
    }
    /** Read-only view of this iterator's abort signal. */
    get signal() {
      return c(this, ue, "f").signal;
    }
    /** Abort the iterator. The current `for await` will exit cleanly. */
    abort() {
      c(this, ue, "f").abort();
    }
    async *[(dt = /* @__PURE__ */ new WeakMap(), Fn = /* @__PURE__ */ new WeakMap(), ue = /* @__PURE__ */ new WeakMap(), jn = /* @__PURE__ */ new WeakMap(), Bn = /* @__PURE__ */ new WeakMap(), Un = /* @__PURE__ */ new WeakMap(), Qt = /* @__PURE__ */ new WeakMap(), Zt = /* @__PURE__ */ new WeakMap(), ut = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
      var s, i, a;
      if (c(this, Fn, "f"))
        throw new E("Cannot iterate over a consumed WorkPoller");
      w(this, Fn, !0);
      const e = F(this.client);
      e.info("poller starting", {
        component: "work-poller",
        environment_id: this.environmentId
      });
      const n = new $p(e, this.environmentId);
      try {
        let o = 0;
        for (; !c(this, ue, "f").signal.aborted; ) {
          let l;
          try {
            l = await c(this, dt, "f").beta.environments.work.poll(this.environmentId, {
              "Anthropic-Worker-ID": this.workerId,
              ...c(this, Qt, "f") !== null ? { block_ms: c(this, Qt, "f") } : {},
              ...c(this, Zt, "f") !== null ? { reclaim_older_than_ms: c(this, Zt, "f") } : {}
            }, { headers: p([(s = c(this, ut, "f")) == null ? void 0 : s.headers]), signal: c(this, ue, "f").signal });
          } catch (u) {
            if (c(this, ue, "f").signal.aborted)
              return;
            if (Rr(u))
              throw e.error("poll failed permanently, stopping poller", { error: String(u) }), u;
            const d = Al(Pp(o));
            e.warn("poll failed, backing off", { error: String(u), backoff_ms: d }), o++, await rt(d, c(this, ue, "f").signal);
            continue;
          }
          if (o = 0, l == null) {
            if (c(this, Un, "f"))
              return;
            n.onEmptyPoll(), await rt(Np(1e3, 3e3), c(this, ue, "f").signal);
            continue;
          }
          n.onClaim(), e.info("claimed work", {
            component: "work-poller",
            environment_id: this.environmentId,
            work_id: l.id,
            work_type: l.data.type
          });
          try {
            await c(this, dt, "f").beta.environments.work.ack(l.id, { environment_id: l.environment_id }, { headers: p([(i = c(this, ut, "f")) == null ? void 0 : i.headers]), signal: c(this, ue, "f").signal });
          } catch (u) {
            e.error("ack failed", { work_id: l.id, error: String(u) });
            continue;
          }
          try {
            yield l;
          } finally {
            if (c(this, Bn, "f"))
              try {
                await c(this, dt, "f").beta.environments.work.stop(l.id, { environment_id: l.environment_id }, { headers: p([(a = c(this, ut, "f")) == null ? void 0 : a.headers]) });
              } catch (u) {
                Lt(u, 409) || e.warn("stop failed", { work_id: l.id, error: String(u) });
              }
          }
        }
      } finally {
        c(this, jn, "f").call(this);
      }
    }
  }
  return r;
})();
function Pp(r) {
  return xl(r, Mp, Cp);
}
var $p = /* @__PURE__ */ (() => {
  class r {
    constructor(e, n) {
      ht.set(this, void 0), Wn.set(this, void 0), ft.set(this, void 0), en.set(this, 0), w(this, ht, e), w(this, Wn, n);
    }
    onEmptyPoll() {
      const e = Date.now(), n = { component: "work-poller", environment_id: c(this, Wn, "f") };
      c(this, ft, "f") === void 0 ? (w(this, ft, w(this, en, e, "f")), c(this, ht, "f").info("idle; polling for work", n)) : e - c(this, en, "f") >= Lp ? (w(this, en, e), c(this, ht, "f").info(`still polling; idle for ${Math.round((e - c(this, ft, "f")) / 1e3)}s`, n)) : c(this, ht, "f").debug("poll returned no work", n);
    }
    onClaim() {
      w(this, ft, void 0);
    }
  }
  return ht = /* @__PURE__ */ new WeakMap(), Wn = /* @__PURE__ */ new WeakMap(), ft = /* @__PURE__ */ new WeakMap(), en = /* @__PURE__ */ new WeakMap(), r;
})();
function Fp() {
  var e;
  const r = (e = globalThis.process) == null ? void 0 : e.env, t = r == null ? void 0 : r.HOSTNAME;
  return t ? `${t}-${js()}` : js();
}
var pt, Le, gt, jp = /* @__PURE__ */ (() => {
  class r {
    constructor() {
      pt.set(this, []), Le.set(this, []), gt.set(this, !1);
    }
    /** Enqueue an item, or hand it directly to a waiting reader. Returns `false` once closed. */
    push(e) {
      if (c(this, gt, "f"))
        return !1;
      const n = c(this, Le, "f").shift();
      return n ? n({ done: !1, value: e }) : c(this, pt, "f").push(e), !0;
    }
    /** Mark the queue done. Idempotent; wakes every pending reader with `done: true`. */
    close() {
      if (!c(this, gt, "f"))
        for (w(this, gt, !0); c(this, Le, "f").length > 0; )
          c(this, Le, "f").shift()({ done: !0, value: void 0 });
    }
    /**
     * Resolve with the next item, or `done: true` once the queue is closed and
     * drained. When `signal` is supplied, aborting it resolves a pending read
     * with `done: true` (cancellation is pushed down here rather than handled by
     * an outer `Promise.race`).
     */
    next(e) {
      return c(this, pt, "f").length > 0 ? Promise.resolve({ done: !1, value: c(this, pt, "f").shift() }) : c(this, gt, "f") || e != null && e.aborted ? Promise.resolve({ done: !0, value: void 0 }) : new Promise((n) => {
        const s = (a) => {
          e == null || e.removeEventListener("abort", i), n(a);
        }, i = () => {
          const a = c(this, Le, "f").indexOf(s);
          a >= 0 && c(this, Le, "f").splice(a, 1), n({ done: !0, value: void 0 });
        };
        c(this, Le, "f").push(s), e == null || e.addEventListener("abort", i, { once: !0 });
      });
    }
    /** Synchronously remove and return the next buffered item, or `undefined` if empty. */
    tryShift() {
      return c(this, pt, "f").shift();
    }
  }
  return pt = /* @__PURE__ */ new WeakMap(), Le = /* @__PURE__ */ new WeakMap(), gt = /* @__PURE__ */ new WeakMap(), r;
})(), yi = /* @__PURE__ */ (() => {
  class r extends Error {
    constructor(e) {
      const n = typeof e == "string" ? e : e.map((s) => s.type === "text" ? s.text : `[${s.type}]`).join(" ");
      super(n), this.name = "ToolError", this.content = e;
    }
  }
  return r;
})();
function Ca(r) {
  return "name" in r ? r.name : "mcp_server_name" in r ? r.mcp_server_name : r.type;
}
function Bp(r) {
  return r instanceof yi ? r.content : `Error: ${r instanceof Error ? r.message : String(r)}`;
}
async function Up(r, t, e) {
  try {
    const n = r.parse ? r.parse(t) : t;
    return { content: await r.run(n, e), isError: !1 };
  } catch (n) {
    return { content: Bp(n), isError: !0 };
  }
}
var tn, Dn, mt, ze, we, D, Hn, J, qn, En, pr, z, Rt, de, It, Ue, St, Ie, gr, Sn, ge, Vn, Il, La, Pa, $a, Yr, Fa, zn, Xn, Jr, ja, Nl;
const Ba = 500, Wp = 1e4, Dp = 12e4, Hp = 3e4, qp = 1e3, Vp = 3e4, zp = 5 * 6e4, Xp = 6e4;
function Ol(r) {
  var t;
  return r.type === "session.status_idle" && ((t = r.stop_reason) == null ? void 0 : t.type) === "end_turn";
}
var Kp = /* @__PURE__ */ (() => {
  class r {
    constructor(e, n) {
      tn.set(this, void 0), Dn.set(this, void 0), mt.set(this, /* @__PURE__ */ new Set()), ze.set(this, !1), we.set(this, void 0), w(this, tn, e), w(this, Dn, n);
    }
    /**
     * Arm on `status_idle{end_turn}`; disarm otherwise. `user.tool_confirmation`
     * is neutral: it signals neither agent activity nor an idle, and its effect
     * on the clock flows through {@link block} / {@link unblock} instead —
     * disarming here would discard the pending arm the verdict is about to
     * settle.
     */
    noteEvent(e) {
      e.type !== "user.tool_confirmation" && (Ol(e) ? this.arm() : this.disarm());
    }
    /** Register gated work that must resolve before an idle countdown starts. */
    block(e) {
      c(this, mt, "f").add(e), c(this, we, "f") !== void 0 && (w(this, ze, !0), clearTimeout(c(this, we, "f")), w(this, we, void 0));
    }
    /**
     * Retire gated work (a no-op for ids never blocked); applies a pending arm —
     * with a fresh full `maxIdleMs` window — once the last blocker retires.
     */
    unblock(e) {
      c(this, mt, "f").delete(e), c(this, mt, "f").size === 0 && c(this, ze, "f") && this.arm();
    }
    /**
     * (Re)start the idle countdown — or, while blockers are outstanding, hold
     * the arm pending instead. Stopping then would drop a held call when its
     * verdict later arrives, or cut the runner off before a released call's
     * result can drive the next turn.
     */
    arm() {
      if (!(c(this, tn, "f") <= 0)) {
        if (c(this, mt, "f").size > 0) {
          w(this, ze, !0);
          return;
        }
        w(this, ze, !1), c(this, we, "f") !== void 0 && clearTimeout(c(this, we, "f")), w(this, we, setTimeout(c(this, Dn, "f"), c(this, tn, "f")));
      }
    }
    /**
     * Cancel the idle countdown and any pending arm. Blockers persist — they
     * track real outstanding work, retired only by {@link unblock}.
     */
    disarm() {
      w(this, ze, !1), c(this, we, "f") !== void 0 && (clearTimeout(c(this, we, "f")), w(this, we, void 0));
    }
  }
  return tn = /* @__PURE__ */ new WeakMap(), Dn = /* @__PURE__ */ new WeakMap(), mt = /* @__PURE__ */ new WeakMap(), ze = /* @__PURE__ */ new WeakMap(), we = /* @__PURE__ */ new WeakMap(), r;
})(), qs = /* @__PURE__ */ (() => {
  class r {
    constructor(e, n) {
      D.add(this), Hn.set(this, !1), J.set(this, void 0), qn.set(this, void 0), En.set(this, void 0), pr.set(this, void 0), z.set(this, void 0), Rt.set(this, /* @__PURE__ */ new Set()), de.set(this, /* @__PURE__ */ new Set()), It.set(this, /* @__PURE__ */ new Map()), Ue.set(this, /* @__PURE__ */ new Map()), St.set(this, new jp()), Ie.set(this, 0), gr.set(this, zp), Sn.set(this, null), ge.set(this, void 0), this.client = n.client, this.sessionId = e, this.tools = n.tools, this.maxIdleMs = n.maxIdleMs ?? Xp, w(this, z, F(n.client)), w(this, pr, new Map(n.tools.map((s) => [Ca(s), s]))), w(this, J, new AbortController()), w(this, qn, In(n.signal, c(this, J, "f"))), w(this, En, n.requestOptions), w(this, ge, new Kp(this.maxIdleMs, () => {
        c(this, z, "f").info("session idle after end_turn; stopping", {
          component: "session-tool-runner",
          session_id: this.sessionId,
          max_idle_ms: this.maxIdleMs
        }), c(this, J, "f").abort();
      }));
    }
    /** Read-only view of this runner's abort signal. */
    get signal() {
      return c(this, J, "f").signal;
    }
    /** Abort the runner. Background tasks will wind down and `for await` will exit cleanly. */
    abort() {
      c(this, J, "f").abort();
    }
    /**
     * @internal
     * `EnvironmentWorker` keeps this equal to the lease TTL each heartbeat
     * reports; applies to a send already retrying.
     */
    _setSendRetryWindow(e) {
      w(this, gr, e);
    }
    async *[(Hn = /* @__PURE__ */ new WeakMap(), J = /* @__PURE__ */ new WeakMap(), qn = /* @__PURE__ */ new WeakMap(), En = /* @__PURE__ */ new WeakMap(), pr = /* @__PURE__ */ new WeakMap(), z = /* @__PURE__ */ new WeakMap(), Rt = /* @__PURE__ */ new WeakMap(), de = /* @__PURE__ */ new WeakMap(), It = /* @__PURE__ */ new WeakMap(), Ue = /* @__PURE__ */ new WeakMap(), St = /* @__PURE__ */ new WeakMap(), Ie = /* @__PURE__ */ new WeakMap(), gr = /* @__PURE__ */ new WeakMap(), Sn = /* @__PURE__ */ new WeakMap(), ge = /* @__PURE__ */ new WeakMap(), D = /* @__PURE__ */ new WeakSet(), Symbol.asyncIterator)]() {
      var n;
      if (c(this, Hn, "f"))
        throw new E("Cannot iterate over a consumed SessionToolRunner");
      w(this, Hn, !0), c(this, z, "f").info("session tool runner starting", {
        component: "session-tool-runner",
        session_id: this.sessionId
      });
      const e = c(this, D, "m", Il).call(this).catch((s) => {
        c(this, J, "f").signal.aborted || c(this, z, "f").error("stream loop failed", { error: String(s) }), c(this, J, "f").abort();
      });
      try {
        for (; ; ) {
          const i = await c(this, St, "f").next(c(this, J, "f").signal);
          if (i.done)
            break;
          yield i.value;
        }
        await e;
        let s;
        for (; (s = c(this, St, "f").tryShift()) !== void 0; )
          yield s;
      } finally {
        c(this, J, "f").abort(), c(this, ge, "f").disarm(), await e;
        try {
          await c(this, D, "m", Nl).call(this);
        } catch (s) {
          c(this, z, "f").warn("drain failed", { error: String(s) });
        }
        c(this, St, "f").close();
        for (const s of this.tools)
          try {
            await ((n = s.close) == null ? void 0 : n.call(s));
          } catch (i) {
            c(this, z, "f").warn("tool.close failed", { tool: Ca(s), error: String(i) });
          }
        c(this, qn, "f").call(this);
      }
    }
  }
  return r;
})();
Vn = function() {
  var t;
  return {
    ...c(this, En, "f"),
    headers: p([Ws("session-tool-runner"), (t = c(this, En, "f")) == null ? void 0 : t.headers]),
    signal: c(this, J, "f").signal
  };
}, Il = // ===== event stream =====
async function() {
  const t = c(this, J, "f");
  let e = Ba;
  for (; !t.signal.aborted; ) {
    try {
      const n = await this.client.beta.sessions.events.stream(this.sessionId, {}, c(this, D, "m", Vn).call(this));
      await c(this, D, "m", La).call(this);
      for await (const s of n)
        if (e = Ba, await c(this, D, "m", $a).call(this, s))
          return;
    } catch (n) {
      if (t.signal.throwIfAborted(), Rr(n))
        throw c(this, z, "f").error("permanent stream failure, shutting down", { error: String(n) }), t.abort(), n;
      c(this, z, "f").warn("stream disconnected, reconnecting", {
        error: String(n),
        backoff_ms: e
      });
    }
    t.signal.throwIfAborted(), await rt(e, t.signal), e = Math.min(e * 2, Wp);
  }
}, La = /**
 * Read full history before dispatching so a `tool_use` whose result appears
 * later in the same history is not re-executed. Runs after the live stream is
 * already attached (see {@link SessionToolRunner.#streamLoop}).
 */
async function() {
  const t = c(this, J, "f"), e = [];
  let n = !1;
  try {
    for await (const a of this.client.beta.sessions.events.list(this.sessionId, { limit: 1e3 }, c(this, D, "m", Vn).call(this)))
      c(this, D, "m", Pa).call(this, a, e), n = Ol(a);
  } catch (a) {
    t.signal.throwIfAborted(), c(this, z, "f").warn("reconcile list failed", { error: String(a) });
    for (const o of e)
      c(this, Rt, "f").delete(o.id);
    return;
  }
  const s = e.filter((a) => !c(this, de, "f").has(a.id));
  c(this, ge, "f").disarm();
  for (const a of s)
    await c(this, D, "m", Yr).call(this, a);
  for (const a of [...c(this, Ue, "f").values()]) {
    const o = c(this, It, "f").get(a.id);
    o !== void 0 && await c(this, D, "m", zn).call(this, a, o);
  }
  const i = s.filter((a) => !c(this, de, "f").has(a.id) && !c(this, Ue, "f").has(a.id));
  n && i.length === 0 ? c(this, ge, "f").arm() : c(this, ge, "f").disarm();
}, Pa = function(t, e) {
  t.type === "agent.tool_use" || t.type === "agent.custom_tool_use" ? (c(this, Rt, "f").add(t.id), c(this, de, "f").has(t.id) || e.push(t)) : t.type === "user.tool_result" ? c(this, de, "f").add(t.tool_use_id) : t.type === "user.custom_tool_result" ? c(this, de, "f").add(t.custom_tool_use_id) : t.type === "user.tool_confirmation" && (c(this, de, "f").has(t.tool_use_id) || c(this, It, "f").set(t.tool_use_id, t.result));
}, $a = /** Returns true when the runner should exit. */
async function(t) {
  switch (c(this, ge, "f").noteEvent(t), t.type) {
    case "agent.tool_use":
    case "agent.custom_tool_use":
      return c(this, Rt, "f").has(t.id) || (c(this, Rt, "f").add(t.id), await c(this, D, "m", Yr).call(this, t)), !1;
    case "user.tool_confirmation":
      return await c(this, D, "m", Fa).call(this, t), !1;
    case "user.tool_result":
      return c(this, de, "f").add(t.tool_use_id), !1;
    case "user.custom_tool_result":
      return c(this, de, "f").add(t.custom_tool_use_id), !1;
    case "session.status_terminated":
    case "session.deleted":
      return c(this, z, "f").info("session terminated", {
        component: "session-tool-runner",
        session_id: this.sessionId
      }), c(this, J, "f").abort(), !0;
    default:
      return !1;
  }
}, Yr = // ===== confirmation gating (always_ask tools) =====
/**
 * Dispatch `ev`, honoring its evaluated permission. A call the server gated
 * (`evaluated_permission == "ask"`) is held until its `user.tool_confirmation`
 * arrives. Fails closed: only an explicit `allow` verdict releases a gated
 * call; a server-side `deny` overrides any recorded verdict; an unrecognized
 * permission is held like `ask` and an unrecognized verdict is denied.
 */
async function(t) {
  const e = t.evaluated_permission, n = e === "deny" ? "deny" : c(this, It, "f").get(t.id);
  if (n === void 0) {
    e === void 0 || e === "allow" ? await c(this, D, "m", Jr).call(this, t, void 0) : c(this, Ue, "f").has(t.id) || (c(this, z, "f").info("tool call awaiting confirmation; holding", {
      component: "session-tool-runner",
      session_id: this.sessionId,
      tool: t.name,
      tool_use_id: t.id
    }), c(this, Ue, "f").set(t.id, t), c(this, ge, "f").block(t.id));
    return;
  }
  await c(this, D, "m", zn).call(this, t, n);
}, Fa = /** Record an allow/deny verdict and release the held call it gates, if any. */
async function(t) {
  c(this, It, "f").set(t.tool_use_id, t.result);
  const e = c(this, Ue, "f").get(t.tool_use_id);
  e !== void 0 && await c(this, D, "m", zn).call(this, e, t.result);
}, zn = /**
 * Dispatch or resolve a gated call according to its verdict.
 *
 * The idle-clock blocker accounting lives here: a denial retires the held
 * call's blocker, while an allow keeps one on the call — taking it now if the
 * verdict was already known when the call was routed, so it was never held —
 * until `#execute` has finished with it. The countdown must not run over
 * gated work that is still in flight.
 */
async function(t, e) {
  const n = c(this, Ue, "f").delete(t.id);
  if (e === "allow") {
    c(this, z, "f").info("tool call confirmed", {
      component: "session-tool-runner",
      session_id: this.sessionId,
      tool: t.name,
      tool_use_id: t.id
    }), n || c(this, ge, "f").block(t.id);
    try {
      await c(this, D, "m", Jr).call(this, t, "allow");
    } finally {
      c(this, ge, "f").unblock(t.id);
    }
    return;
  }
  n && c(this, ge, "f").unblock(t.id), c(this, de, "f").add(t.id), c(this, z, "f").info("tool call denied; not executing", {
    component: "session-tool-runner",
    session_id: this.sessionId,
    tool: t.name,
    tool_use_id: t.id
  }), c(this, D, "m", Xn).call(this, {
    event: t,
    toolUseId: t.id,
    name: t.name,
    isError: !1,
    posted: !1,
    confirmation: "deny"
  });
}, Xn = function(t) {
  c(this, St, "f").push(t);
}, Jr = // ===== tool execution =====
async function(t, e) {
  var i;
  var n, s;
  if (!c(this, de, "f").has(t.id)) {
    c(this, z, "f").info("executing tool", {
      component: "session-tool-runner",
      session_id: this.sessionId,
      tool: t.name,
      tool_use_id: t.id
    }), w(this, Ie, (n = c(this, Ie, "f"), n++, n));
    try {
      const a = c(this, pr, "f").get(t.name);
      if (!a) {
        c(this, z, "f").info("tool not owned by this runner; leaving the tool_use_id pending for its owner", {
          component: "session-tool-runner",
          session_id: this.sessionId,
          tool: t.name,
          tool_use_id: t.id
        }), c(this, D, "m", Xn).call(this, {
          event: t,
          toolUseId: t.id,
          name: t.name,
          isError: !1,
          posted: !1,
          confirmation: e
        });
        return;
      }
      let o, l;
      const u = new AbortController(), d = In(c(this, J, "f").signal, u), h = setTimeout(() => u.abort(), Dp);
      try {
        const m = await Up(a, t.input, {
          toolUse: t,
          toolUseBlock: t,
          signal: u.signal
        });
        o = m.content, l = m.isError;
      } finally {
        clearTimeout(h), d();
      }
      const g = Yp(t, l, Jp(o)), f = await c(this, D, "m", ja).call(this, g, t.id);
      c(this, D, "m", Xn).call(this, {
        event: t,
        result: g,
        toolUseId: t.id,
        name: t.name,
        isError: l,
        posted: f,
        confirmation: e
      });
    } finally {
      w(this, Ie, (s = c(this, Ie, "f"), s--, s)), c(this, Ie, "f") === 0 && ((i = c(this, Sn, "f")) == null || i.call(this));
    }
  }
}, ja = async function(t, e) {
  const n = c(this, J, "f"), s = Date.now();
  let i, a = 0;
  for (; ; ) {
    a++, n.signal.throwIfAborted();
    try {
      return await this.client.beta.sessions.events.send(this.sessionId, { events: [t] }, c(this, D, "m", Vn).call(this)), c(this, de, "f").add(e), !0;
    } catch (o) {
      if (i = o, Rr(o))
        break;
      const l = c(this, gr, "f") - (Date.now() - s);
      if (l <= 0)
        break;
      const u = Math.min(Al(xl(a - 1, qp, Vp)), l);
      c(this, z, "f").warn("tool result send failed; retrying", {
        tool_use_id: e,
        attempt: a,
        backoff_ms: u,
        error: String(o)
      }), await rt(u, n.signal);
    }
  }
  return c(this, z, "f").error("failed to send tool result", {
    tool_use_id: e,
    attempts: a,
    error: String(i)
  }), !1;
}, Nl = /** Wait (bounded) for in-flight tool executions to finish during teardown. */
async function() {
  c(this, Ie, "f") !== 0 && (await Promise.race([new Promise((t) => w(this, Sn, t)), rt(Hp)]), w(this, Sn, null), c(this, Ie, "f") > 0 && c(this, z, "f").warn("drain timeout exceeded"));
};
function Yp(r, t, e) {
  return r.type === "agent.custom_tool_use" ? { type: "user.custom_tool_result", custom_tool_use_id: r.id, is_error: t, content: e } : { type: "user.tool_result", tool_use_id: r.id, is_error: t, content: e };
}
function Jp(r) {
  if (typeof r == "string")
    return [{ type: "text", text: r || "(no output)" }];
  const t = r.map((e) => {
    var n;
    return e.type === "text" ? { type: "text", text: e.text || "(no output)" } : e.type === "image" || e.type === "document" ? e : e.type === "search_result" ? {
      type: "search_result",
      source: e.source,
      title: e.title,
      content: e.content.map((s) => ({ type: "text", text: s.text })),
      citations: { enabled: ((n = e.citations) == null ? void 0 : n.enabled) ?? !1 }
    } : { type: "text", text: JSON.stringify(e) };
  });
  return t.length > 0 ? t : [{ type: "text", text: "(no output)" }];
}
const Yg = 15e3, Ua = 5e3;
function Gp(r, t) {
  if (!(r >= Ua))
    throw new E(`${t} must be at least ${Ua}ms (got ${r}); to run without memory sync, pass \`memorySyncIntervalMs: null\` to the worker instead`);
}
var Kn, nn, Gr, rn, _t;
const Wa = 3e4, Qp = 9e4, Zp = "NO_HEARTBEAT";
function eg(r) {
  return r.resources.some((t) => t.type === "memory_store");
}
function tg(r) {
  if (!r)
    return null;
  let t;
  try {
    const n = r.replace(/-/g, "+").replace(/_/g, "/"), s = n.padEnd(Math.ceil(n.length / 4) * 4, "=");
    t = JSON.parse(Ps(Bf(s)));
  } catch {
    return null;
  }
  if (t === null || typeof t != "object" || Array.isArray(t))
    return null;
  const e = t.sessions_token;
  return typeof e == "string" && e !== "" ? e : null;
}
var Da = /* @__PURE__ */ (() => {
  class r {
    constructor(e) {
      if (Kn.add(this), nn.set(this, void 0), e.unrestrictedPaths !== void 0)
        throw new E("The `unrestrictedPaths` option you passed to EnvironmentWorker (or client.beta.environments.work.worker()) is no longer supported. The worker's file tools (read, write, edit, glob, grep) are now always confined to `workdir` plus the session's memory folders. Remove `unrestrictedPaths` from your options; to let the file tools reach any other directory, add it to `AgentToolContext.allowedRoots` from a `tools` factory.");
      this.client = e.client, this.environmentId = e.environmentId, this.environmentKey = e.environmentKey, this.tools = e.tools, this.workdir = e.workdir ?? process.cwd(), this.maxFileBytes = e.maxFileBytes, this.maxIdleMs = e.maxIdleMs, e.memorySyncIntervalMs != null && Gp(e.memorySyncIntervalMs, "memorySyncIntervalMs"), this.memorySyncIntervalMs = e.memorySyncIntervalMs, this.memorySyncDeletions = e.memorySyncDeletions ?? "enabled", this.workerId = e.workerId, this.requestOptions = e.requestOptions, w(this, nn, e.signal);
    }
    /**
     * Poll the environment and service each claimed session until the supplied
     * signal (or the one passed to the constructor) aborts. Throws if
     * `environmentId` / `environmentKey` were not provided to the constructor.
     */
    async run(e) {
      var o;
      const { environmentId: n, environmentKey: s } = this;
      if (n === void 0 || s === void 0)
        throw new E("EnvironmentWorker.run: environmentId and environmentKey are required to poll for work");
      const i = e ?? c(this, nn, "f"), a = new Hs({
        client: this.client,
        environmentId: n,
        environmentKey: s,
        ...this.workerId !== void 0 ? { workerId: this.workerId } : {},
        ...i ? { signal: i } : {},
        ...this.requestOptions !== void 0 ? { requestOptions: this.requestOptions } : {},
        // The per-item handler stops or releases every work item on exit; let it
        // be the single owner of `work.stop` rather than double-posting from the
        // poller.
        autoStop: !1
      });
      for await (const l of a)
        try {
          await c(this, Kn, "m", Gr).call(this, l, s, a.signal);
        } catch (u) {
          if ((o = a.signal) != null && o.aborted)
            throw u;
          F(this.client).error("work item failed", { work_id: l.id, error: String(u) });
        }
    }
    /**
     * Service a single, already-claimed work item without the poll loop: build the
     * per-session {@link AgentToolContext} (workdir from this worker's options),
     * download the session agent's skills (`setupSkills`), run a
     * {@link SessionToolRunner} for the session while heartbeating the work-item
     * lease, and force-stop the work item on exit (whether the runner finishes
     * normally, throws, or the control plane signals shutdown). The one
     * exception is a lost lease: the item then belongs to the queue or another
     * worker and is left alone.
     *
     * Use this when something else does the claiming — e.g. a `worker poll
     * --on-work` script that hands an already-claimed item to a fresh process. The
     * work id / environment id / session id each fall back to `ANTHROPIC_WORK_ID` /
     * `ANTHROPIC_ENVIRONMENT_ID` / `ANTHROPIC_SESSION_ID` (the env vars that
     * command sets) when not passed; the environment key resolves from this
     * option, then the worker's own `environmentKey`, then
     * `ANTHROPIC_ENVIRONMENT_KEY`, and is needed only when the work item's
     * `secret` yields no sessions token — a host that receives only the
     * per-item secret runs without ever holding the key. With no arguments
     * inside that command it just works. Throws a clear error naming the first
     * required value still missing after resolution, and — rather than ever
     * running unauthenticated — when neither a sessions token nor an
     * environment key resolved. Throws `SessionMemoryError` when the
     * session has memory stores attached but they cannot be mounted — the work
     * item carried no sessions token (unless `memorySyncIntervalMs` turned
     * memory off), or a store failed to download.
     *
     * `workSecret` is the work item's per-item `secret` payload from the poll
     * response, falling back to `ANTHROPIC_WORK_SECRET`; unlike the others it is
     * optional — when present, the sessions token extracted from it is preferred
     * as the Bearer credential for this item's heartbeat / force-stop / session
     * calls; when absent (or undecodable) those calls use the environment key.
     */
    async handleItem(e) {
      const n = (e == null ? void 0 : e.workId) ?? C("ANTHROPIC_WORK_ID"), s = (e == null ? void 0 : e.environmentId) ?? C("ANTHROPIC_ENVIRONMENT_ID"), i = (e == null ? void 0 : e.sessionId) ?? C("ANTHROPIC_SESSION_ID"), a = ((e == null ? void 0 : e.environmentKey) ?? this.environmentKey ?? C("ANTHROPIC_ENVIRONMENT_KEY")) || void 0, o = (e == null ? void 0 : e.workSecret) || C("ANTHROPIC_WORK_SECRET") || null;
      if (!n)
        throw new E("handleItem: workId is required — pass it or set ANTHROPIC_WORK_ID");
      if (!s)
        throw new E("handleItem: environmentId is required — pass it or set ANTHROPIC_ENVIRONMENT_ID");
      if (!i)
        throw new E("handleItem: sessionId is required — pass it or set ANTHROPIC_SESSION_ID");
      if (!a && !o)
        throw new E("handleItem: environmentKey is required when there is no work secret — pass it, construct the worker with it, or set ANTHROPIC_ENVIRONMENT_KEY");
      const l = {
        id: n,
        environment_id: s,
        secret: o,
        data: { type: "session", id: i }
      };
      await c(this, Kn, "m", Gr).call(this, l, a, (e == null ? void 0 : e.signal) ?? c(this, nn, "f"));
    }
  }
  return nn = /* @__PURE__ */ new WeakMap(), Kn = /* @__PURE__ */ new WeakSet(), Gr = /**
   * The per-item body shared by {@link EnvironmentWorker.run}'s poll loop and
   * {@link EnvironmentWorker.handleItem}: run a {@link SessionToolRunner} for the
   * work item's session while heartbeating its lease, force-stopping on exit
   * unless the lease was lost. Non-session work items are ignored.
   *
   * When the poll response carried a per-item `secret` (a short-lived payload
   * scoped to this work item), the sessions token extracted from it is
   * preferred over `environmentKey` as the Bearer credential for those
   * per-item calls; a missing/undecodable secret falls back to
   * `environmentKey` unchanged.
   */
  async function(e, n, s) {
    const i = F(this.client), a = tg(e.secret), o = a ?? n;
    if (o === void 0)
      throw new E("handleItem: the work item carried a secret payload but no sessions token could be extracted, and there is no environment key to fall back to; the poller must issue a secret whose payload carries `sessions_token`, or provide the environment key (pass it, construct the worker with it, or set ANTHROPIC_ENVIRONMENT_KEY)");
    e.secret && a === null && i.warn("work item carried a secret payload but no sessions token could be extracted; falling back to the environment key", { work_id: e.id });
    const l = Rl(this.client, {
      authToken: o,
      helper: "environments-worker"
    }), u = e.data.id, d = new AbortController(), h = In(s, d), g = new rg(d), f = await import("./node-Cp0pg73e.js");
    let m, y;
    const v = ig(l, e, g, i, this.requestOptions, (x) => {
      m = x, y == null || y._setSendRetryWindow(x);
    }).catch((x) => {
      d.signal.aborted || i.error("heartbeat loop failed", { work_id: e.id, error: String(x) }), d.abort();
    });
    let T = async () => {
    }, b, N = !1;
    try {
      if (e.data.type !== "session") {
        i.debug("skipping non-session work item", { work_id: e.id, type: e.data.type });
        return;
      }
      const x = await l.beta.sessions.retrieve(u);
      if (a === null && this.memorySyncIntervalMs !== null && eg(x))
        throw new f.SessionMemoryError(`cannot mount the session's memories: the work item carried no sessions token (work_id=${e.id}, session_id=${u}); the memory endpoints reject the environment key, so the poller must issue a per-item \`secret\` carrying \`sessions_token\`, or set \`memorySyncIntervalMs: null\` to run without memory`);
      const S = {
        workdir: this.workdir,
        // The scoped sub-client, not the parent: the skill download
        // `setupSkills` performs for this session rides the same per-item
        // credential as every other per-item call.
        client: l,
        session: x,
        ...this.maxFileBytes !== void 0 ? { maxFileBytes: this.maxFileBytes } : {}
      };
      try {
        T = await f.setupSkills(S);
      } catch (P) {
        i.warn("skill setup failed", { session_id: u, work_id: e.id, error: String(P) });
      }
      a !== null && this.memorySyncIntervalMs !== null ? (b = new f.SessionMemoryStores(l, {
        workdir: this.workdir,
        ...this.memorySyncIntervalMs !== void 0 ? { syncIntervalMs: this.memorySyncIntervalMs } : {},
        syncDeletions: this.memorySyncDeletions
      }), await b.download(x), S.allowedRoots = b.roots, S.readOnlyRoots = b.readOnlyRoots) : i.debug("memory stores disabled for this item", { work_id: e.id });
      const A = typeof this.tools == "function" ? this.tools(S) : this.tools ?? f.betaAgentToolset20260401(S);
      y = new qs(u, {
        client: l,
        tools: A,
        ...this.maxIdleMs !== void 0 ? { maxIdleMs: this.maxIdleMs } : {},
        ...this.requestOptions !== void 0 ? { requestOptions: this.requestOptions } : {},
        signal: d.signal
      }), m !== void 0 && y._setSendRetryWindow(m);
      for await (const P of y)
        b && await b.syncIfDue();
      N = !d.signal.aborted;
    } finally {
      try {
        await T().catch((x) => {
          i.warn("skill cleanup failed", { session_id: u, work_id: e.id, error: String(x) });
        });
      } finally {
        if (b) {
          const x = f.MEMORY_FLUSH_TIMEOUT_MS;
          N && await Ha(b.finish(), x) && i.warn(`final memory sync cut off after ${x}ms; the flush that follows still uploads changed files`, { session_id: u, work_id: e.id });
          const S = new AbortController();
          await Ha(b.flushWrites(S.signal), x) && (S.abort(), i.warn(`memory flush cut off after ${x}ms; changed files it had not uploaded yet are not saved`, { session_id: u, work_id: e.id })), await b.dispose().catch((P) => {
            i.warn("memory store cleanup failed", {
              session_id: u,
              work_id: e.id,
              error: String(P)
            });
          });
        }
      }
      g.finish("runner_done"), h(), await v, g.lost ? i.info("lease lost; released without stopping it", { session_id: u, work_id: e.id }) : await ng(l, e, i, this.requestOptions);
    }
  }, r;
})();
async function Ha(r, t) {
  let e;
  try {
    return await Promise.race([
      r.then(() => !1, () => !1),
      new Promise((n) => {
        e = setTimeout(() => n(!0), t);
      })
    ]);
  } finally {
    e !== void 0 && clearTimeout(e);
  }
}
async function ng(r, t, e, n) {
  try {
    await r.beta.environments.work.stop(
      t.id,
      { environment_id: t.environment_id, force: !0 },
      // Caller's headers pass through; the helper-tag header is on the scoped
      // sub-client's default_headers via copyClientForHelper, so no per-call
      // re-stamping needed.
      { ...n, headers: p([n == null ? void 0 : n.headers]) }
    );
  } catch (s) {
    Lt(s, 409) || e.error("force-stop on exit failed", { work_id: t.id, error: String(s) });
  }
}
var rg = /* @__PURE__ */ (() => {
  class r {
    constructor(e) {
      rn.set(this, void 0), _t.set(this, void 0), w(this, rn, e);
    }
    get signal() {
      return c(this, rn, "f").signal;
    }
    finish(e) {
      w(this, _t, c(this, _t, "f") ?? e), c(this, rn, "f").abort();
    }
    /** True once the item belongs to the queue or another worker. */
    get lost() {
      return c(this, _t, "f") === "lease_lost" || c(this, _t, "f") === "assumed_lost";
    }
  }
  return rn = /* @__PURE__ */ new WeakMap(), _t = /* @__PURE__ */ new WeakMap(), r;
})();
function sg(r) {
  let t = r instanceof K ? r.error : void 0;
  for (const e of ["error", "details", "current_state"]) {
    if (!ra(t))
      return {};
    t = t[e];
  }
  return ra(t) ? t : {};
}
async function ig(r, t, e, n, s, i) {
  let a = Wa, o = Qp, l = Date.now(), u = Zp;
  const d = async () => {
    const h = new AbortController(), g = In(e.signal, h), f = setTimeout(() => h.abort(), a);
    try {
      const m = await r.beta.environments.work.heartbeat(t.id, { environment_id: t.environment_id, expected_last_heartbeat: u }, { ...s, headers: p([s == null ? void 0 : s.headers]), signal: h.signal });
      l = Date.now(), u = m.last_heartbeat, m.ttl_seconds > 0 && (o = m.ttl_seconds * 1e3, a = Math.max(1e3, Math.min(o / 2, Wa)), i == null || i(o)), (m.state === "stopping" || m.state === "stopped") && (n.info("heartbeat signals shutdown", { work_id: t.id, state: m.state }), e.finish("control_plane_stop")), m.lease_extended || (n.warn("lease not extended, shutting down", { work_id: t.id }), e.finish("control_plane_stop"));
    } catch (m) {
      if (e.signal.throwIfAborted(), Lt(m, 412)) {
        const y = sg(m);
        n.error("lease lost: heartbeat precondition failed", {
          work_id: t.id,
          server_state: y.state,
          server_ttl_seconds: y.ttl_seconds,
          server_last_heartbeat: y.last_heartbeat
        }), e.finish("lease_lost");
        return;
      }
      if (Rr(m))
        throw n.error("permanent heartbeat failure", { work_id: t.id, error: String(m) }), e.finish("heartbeat_rejected"), m;
      if (Date.now() - l > o) {
        n.error("lease assumed lost: no successful heartbeat in ttl", {
          work_id: t.id,
          ttl_ms: o,
          error: String(m)
        }), e.finish("assumed_lost");
        return;
      }
      n.warn("transient heartbeat failure", { work_id: t.id, error: String(m) });
    } finally {
      clearTimeout(f), g();
    }
  };
  for (await d(); !e.signal.aborted; )
    await rt(a, e.signal), e.signal.throwIfAborted(), await d();
}
var qa = /* @__PURE__ */ (() => {
  class r extends I {
    /**
     * Note: these endpoints are called automatically by the pre-built environment
     * worker provided in the SDKs and CLI, for orchestrating sessions with self-hosted
     * sandbox environments. They are included here as a reference; you do not need to
     * invoke them directly.
     *
     * Retrieve detailed information about a specific work item.
     *
     * @example
     * ```ts
     * const betaSelfHostedWork =
     *   await client.beta.environments.work.retrieve('work_id', {
     *     environment_id: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   });
     * ```
     */
    retrieve(e, n, s) {
      const { environment_id: i, betas: a, workspace_id: o } = n;
      return this._client.get(_`/v1/environments/${i}/work/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString(),
            ...o != null ? { "anthropic-workspace-id": o } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Note: these endpoints are called automatically by the pre-built environment
     * worker provided in the SDKs and CLI, for orchestrating sessions with self-hosted
     * sandbox environments. They are included here as a reference; you do not need to
     * invoke them directly.
     *
     * Update work item metadata with merge semantics.
     *
     * @example
     * ```ts
     * const betaSelfHostedWork =
     *   await client.beta.environments.work.update('work_id', {
     *     environment_id: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *     metadata: { foo: 'string' },
     *   });
     * ```
     */
    update(e, n, s) {
      const { environment_id: i, betas: a, workspace_id: o, ...l } = n;
      return this._client.post(_`/v1/environments/${i}/work/${e}?beta=true`, {
        body: l,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString(),
            ...o != null ? { "anthropic-workspace-id": o } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Note: these endpoints are called automatically by the pre-built environment
     * worker provided in the SDKs and CLI, for orchestrating sessions with self-hosted
     * sandbox environments. They are included here as a reference; you do not need to
     * invoke them directly.
     *
     * List work items in an environment.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaSelfHostedWork of client.beta.environments.work.list(
     *   'env_011CZkZ9X2dpNyB7HsEFoRfW',
     * )) {
     *   // ...
     * }
     * ```
     */
    list(e, n = {}, s) {
      const { betas: i, ...a } = n ?? {};
      return this._client.getAPIList(_`/v1/environments/${e}/work?beta=true`, L, {
        query: a,
        ...s,
        headers: p([
          { "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString() },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Note: these endpoints are called automatically by the pre-built environment
     * worker provided in the SDKs and CLI, for orchestrating sessions with self-hosted
     * sandbox environments. They are included here as a reference; you do not need to
     * invoke them directly.
     *
     * Acknowledge receipt of a work item, transitioning it from 'queued' to 'starting'
     * and removing it from the queue.
     *
     * @example
     * ```ts
     * const betaSelfHostedWork =
     *   await client.beta.environments.work.ack('work_id', {
     *     environment_id: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   });
     * ```
     */
    ack(e, n, s) {
      const { environment_id: i, betas: a } = n;
      return this._client.post(_`/v1/environments/${i}/work/${e}/ack?beta=true`, {
        ...s,
        headers: p([
          { "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString() },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Note: these endpoints are called automatically by the pre-built environment
     * worker provided in the SDKs and CLI, for orchestrating sessions with self-hosted
     * sandbox environments. They are included here as a reference; you do not need to
     * invoke them directly.
     *
     * Record a heartbeat for a work item to maintain the lease.
     *
     * @example
     * ```ts
     * const betaSelfHostedWorkHeartbeatResponse =
     *   await client.beta.environments.work.heartbeat('work_id', {
     *     environment_id: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   });
     * ```
     */
    heartbeat(e, n, s) {
      const { environment_id: i, desired_ttl_seconds: a, expected_last_heartbeat: o, betas: l } = n;
      return this._client.post(_`/v1/environments/${i}/work/${e}/heartbeat?beta=true`, {
        query: { desired_ttl_seconds: a, expected_last_heartbeat: o },
        ...s,
        headers: p([
          { "anthropic-beta": [...l ?? [], "managed-agents-2026-04-01"].toString() },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Note: these endpoints are called automatically by the pre-built environment
     * worker provided in the SDKs and CLI, for orchestrating sessions with self-hosted
     * sandbox environments. They are included here as a reference; you do not need to
     * invoke them directly.
     *
     * Long poll for work items in the queue.
     *
     * @example
     * ```ts
     * const betaSelfHostedWork =
     *   await client.beta.environments.work.poll(
     *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   );
     * ```
     */
    poll(e, n = {}, s) {
      const { betas: i, "Anthropic-Worker-ID": a, ...o } = n ?? {};
      return this._client.get(_`/v1/environments/${e}/work/poll?beta=true`, {
        query: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "Anthropic-Worker-ID": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Get statistics about the work queue for an environment.
     *
     * @example
     * ```ts
     * const betaSelfHostedWorkQueueStats =
     *   await client.beta.environments.work.stats(
     *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   );
     * ```
     */
    stats(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.get(_`/v1/environments/${e}/work/stats?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Note: these endpoints are called automatically by the pre-built environment
     * worker provided in the SDKs and CLI, for orchestrating sessions with self-hosted
     * sandbox environments. They are included here as a reference; you do not need to
     * invoke them directly.
     *
     * Stop a work item, initiating graceful or forced shutdown.
     *
     * @example
     * ```ts
     * const betaSelfHostedWork =
     *   await client.beta.environments.work.stop('work_id', {
     *     environment_id: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   });
     * ```
     */
    stop(e, n, s) {
      const { environment_id: i, betas: a, workspace_id: o, ...l } = n;
      return this._client.post(_`/v1/environments/${i}/work/${e}/stop?beta=true`, {
        body: l,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString(),
            ...o != null ? { "anthropic-workspace-id": o } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Continuously claim work from a self-hosted environment, ack each item,
     * and yield it. Posts `stop` automatically when the consumer's loop body
     * returns or when iteration ends.
     *
     * @example
     * ```ts
     * for await (const work of client.beta.environments.work.poller({
     *   environmentId,
     *   environmentKey,
     * })) {
     *   if (work.data.type !== 'session') continue;
     *   // ...service the work...
     * }
     * ```
     */
    poller(e) {
      return new Hs({ ...e, client: this._client });
    }
    worker(e) {
      return new Da({ ...e, client: this._client });
    }
  }
  return r.WorkPoller = Hs, r.EnvironmentWorker = Da, r;
})(), Va = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.work = new qa(this._client);
    }
    /**
     * Create a new environment with the specified configuration.
     *
     * @example
     * ```ts
     * const betaEnvironment =
     *   await client.beta.environments.create({
     *     name: 'python-data-analysis',
     *   });
     * ```
     */
    create(e, n) {
      const { betas: s, workspace_id: i, ...a } = e;
      return this._client.post("/v1/environments?beta=true", {
        body: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Retrieve a specific environment by ID.
     *
     * @example
     * ```ts
     * const betaEnvironment =
     *   await client.beta.environments.retrieve(
     *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   );
     * ```
     */
    retrieve(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.get(_`/v1/environments/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Update an existing environment's configuration.
     *
     * @example
     * ```ts
     * const betaEnvironment =
     *   await client.beta.environments.update(
     *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   );
     * ```
     */
    update(e, n, s) {
      const { betas: i, workspace_id: a, ...o } = n;
      return this._client.post(_`/v1/environments/${e}?beta=true`, {
        body: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * List environments with pagination support.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaEnvironment of client.beta.environments.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { betas: s, workspace_id: i, ...a } = e ?? {};
      return this._client.getAPIList("/v1/environments?beta=true", L, {
        query: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Delete an environment by ID. Returns a confirmation of the deletion.
     *
     * @example
     * ```ts
     * const betaEnvironmentDeleteResponse =
     *   await client.beta.environments.delete(
     *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   );
     * ```
     */
    delete(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.delete(_`/v1/environments/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Archive an environment by ID. Archived environments cannot be used to create new
     * sessions.
     *
     * @example
     * ```ts
     * const betaEnvironment =
     *   await client.beta.environments.archive(
     *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   );
     * ```
     */
    archive(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.post(_`/v1/environments/${e}/archive?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Work = qa, r;
})();
class za extends I {
  /**
   * Create a memory
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemory =
   *   await client.beta.memoryStores.memories.create(
   *     'memory_store_id',
   *     { content: 'content', path: 'xx' },
   *   );
   * ```
   */
  create(t, e, n) {
    const { view: s, betas: i, workspace_id: a, ...o } = e;
    return this._client.post(_`/v1/memory_stores/${t}/memories?beta=true`, {
      query: { view: s },
      body: o,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "agent-memory-2026-07-22"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Retrieve a memory
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemory =
   *   await client.beta.memoryStores.memories.retrieve(
   *     'memory_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  retrieve(t, e, n) {
    const { memory_store_id: s, betas: i, workspace_id: a, ...o } = e;
    return this._client.get(_`/v1/memory_stores/${s}/memories/${t}?beta=true`, {
      query: o,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "agent-memory-2026-07-22"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Update a memory
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemory =
   *   await client.beta.memoryStores.memories.update(
   *     'memory_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  update(t, e, n) {
    const { memory_store_id: s, view: i, betas: a, workspace_id: o, ...l } = e;
    return this._client.post(_`/v1/memory_stores/${s}/memories/${t}?beta=true`, {
      query: { view: i },
      body: l,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...a ?? [], "agent-memory-2026-07-22"].toString(),
          ...o != null ? { "anthropic-workspace-id": o } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List memories
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsMemoryListItem of client.beta.memoryStores.memories.list(
   *   'memory_store_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, workspace_id: i, ...a } = e ?? {};
    return this._client.getAPIList(_`/v1/memory_stores/${t}/memories?beta=true`, L, {
      query: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "agent-memory-2026-07-22"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Delete a memory
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeletedMemory =
   *   await client.beta.memoryStores.memories.delete(
   *     'memory_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  delete(t, e, n) {
    const { memory_store_id: s, expected_content_sha256: i, betas: a, workspace_id: o } = e;
    return this._client.delete(_`/v1/memory_stores/${s}/memories/${t}?beta=true`, {
      query: { expected_content_sha256: i },
      ...n,
      headers: p([
        {
          "anthropic-beta": [...a ?? [], "agent-memory-2026-07-22"].toString(),
          ...o != null ? { "anthropic-workspace-id": o } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
class Xa extends I {
  /**
   * Retrieve a memory version
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemoryVersion =
   *   await client.beta.memoryStores.memoryVersions.retrieve(
   *     'memory_version_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  retrieve(t, e, n) {
    const { memory_store_id: s, betas: i, workspace_id: a, ...o } = e;
    return this._client.get(_`/v1/memory_stores/${s}/memory_versions/${t}?beta=true`, {
      query: o,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "agent-memory-2026-07-22"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List memory versions
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsMemoryVersion of client.beta.memoryStores.memoryVersions.list(
   *   'memory_store_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, workspace_id: i, ...a } = e ?? {};
    return this._client.getAPIList(_`/v1/memory_stores/${t}/memory_versions?beta=true`, L, {
      query: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "agent-memory-2026-07-22"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Redact a memory version
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemoryVersion =
   *   await client.beta.memoryStores.memoryVersions.redact(
   *     'memory_version_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  redact(t, e, n) {
    const { memory_store_id: s, betas: i, workspace_id: a } = e;
    return this._client.post(_`/v1/memory_stores/${s}/memory_versions/${t}/redact?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "agent-memory-2026-07-22"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
var Ka = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.memories = new za(this._client), this.memoryVersions = new Xa(this._client);
    }
    /**
     * Create a memory store
     *
     * @example
     * ```ts
     * const betaManagedAgentsMemoryStore =
     *   await client.beta.memoryStores.create({ name: 'x' });
     * ```
     */
    create(e, n) {
      const { betas: s, workspace_id: i, ...a } = e;
      return this._client.post("/v1/memory_stores?beta=true", {
        body: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "agent-memory-2026-07-22"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Retrieve a memory store
     *
     * @example
     * ```ts
     * const betaManagedAgentsMemoryStore =
     *   await client.beta.memoryStores.retrieve(
     *     'memory_store_id',
     *   );
     * ```
     */
    retrieve(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.get(_`/v1/memory_stores/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "agent-memory-2026-07-22"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Update a memory store
     *
     * @example
     * ```ts
     * const betaManagedAgentsMemoryStore =
     *   await client.beta.memoryStores.update('memory_store_id');
     * ```
     */
    update(e, n, s) {
      const { betas: i, workspace_id: a, ...o } = n;
      return this._client.post(_`/v1/memory_stores/${e}?beta=true`, {
        body: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "agent-memory-2026-07-22"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * List memory stores
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaManagedAgentsMemoryStore of client.beta.memoryStores.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { betas: s, workspace_id: i, ...a } = e ?? {};
      return this._client.getAPIList("/v1/memory_stores?beta=true", L, {
        query: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "agent-memory-2026-07-22"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Delete a memory store
     *
     * @example
     * ```ts
     * const betaManagedAgentsDeletedMemoryStore =
     *   await client.beta.memoryStores.delete('memory_store_id');
     * ```
     */
    delete(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.delete(_`/v1/memory_stores/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "agent-memory-2026-07-22"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Archive a memory store
     *
     * @example
     * ```ts
     * const betaManagedAgentsMemoryStore =
     *   await client.beta.memoryStores.archive('memory_store_id');
     * ```
     */
    archive(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.post(_`/v1/memory_stores/${e}/archive?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "agent-memory-2026-07-22"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Memories = za, r.MemoryVersions = Xa, r;
})(), Ml = /* @__PURE__ */ (() => {
  class r {
    constructor(e, n) {
      this.iterator = e, this.controller = n;
    }
    async *decoder() {
      const e = new fi();
      for await (const n of this.iterator)
        for (const s of e.decode(n))
          yield JSON.parse(s);
      for (const n of e.flush())
        yield JSON.parse(n);
    }
    [Symbol.asyncIterator]() {
      return this.decoder();
    }
    static fromResponse(e, n) {
      if (!e.body)
        throw n.abort(), typeof globalThis.navigator < "u" && globalThis.navigator.product === "ReactNative" ? new E("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api") : new E("Attempted to iterate over a response with no body");
      return new r(li(e.body), n);
    }
  }
  return r;
})();
let Ya = class extends I {
  /**
   * Send a batch of Message creation requests.
   *
   * The Message Batches API can be used to process multiple Messages API requests at
   * once. Once a Message Batch is created, it begins processing immediately. Batches
   * can take up to 24 hours to complete.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatch =
   *   await client.beta.messages.batches.create({
   *     requests: [
   *       {
   *         custom_id: 'my-custom-id-1',
   *         params: {
   *           max_tokens: 1024,
   *           messages: [
   *             { content: 'Hello, world', role: 'user' },
   *           ],
   *           model: 'claude-opus-5',
   *         },
   *       },
   *     ],
   *   });
   * ```
   */
  create(t, e) {
    const { betas: n, user_profile_id: s, workspace_id: i, ...a } = t;
    return this._client.post("/v1/messages/batches?beta=true", {
      body: a,
      ...e,
      headers: p([
        {
          "anthropic-beta": [...n ?? [], "message-batches-2024-09-24"].toString(),
          ...s != null ? { "anthropic-user-profile-id": s } : void 0,
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * This endpoint is idempotent and can be used to poll for Message Batch
   * completion. To access the results of a Message Batch, make a request to the
   * `results_url` field in the response.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatch =
   *   await client.beta.messages.batches.retrieve(
   *     'message_batch_id',
   *   );
   * ```
   */
  retrieve(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.get(_`/v1/messages/batches/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "message-batches-2024-09-24"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List all Message Batches within a Workspace. Most recently created batches are
   * returned first.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaMessageBatch of client.beta.messages.batches.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { betas: n, workspace_id: s, ...i } = t ?? {};
    return this._client.getAPIList("/v1/messages/batches?beta=true", Oe, {
      query: i,
      ...e,
      headers: p([
        {
          "anthropic-beta": [...n ?? [], "message-batches-2024-09-24"].toString(),
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Delete a Message Batch.
   *
   * Message Batches can only be deleted once they've finished processing. If you'd
   * like to delete an in-progress batch, you must first cancel it.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaDeletedMessageBatch =
   *   await client.beta.messages.batches.delete(
   *     'message_batch_id',
   *   );
   * ```
   */
  delete(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.delete(_`/v1/messages/batches/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "message-batches-2024-09-24"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Batches may be canceled any time before processing ends. Once cancellation is
   * initiated, the batch enters a `canceling` state, at which time the system may
   * complete any in-progress, non-interruptible requests before finalizing
   * cancellation.
   *
   * The number of canceled requests is specified in `request_counts`. To determine
   * which requests were canceled, check the individual results within the batch.
   * Note that cancellation may not result in any canceled requests if they were
   * non-interruptible.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatch =
   *   await client.beta.messages.batches.cancel(
   *     'message_batch_id',
   *   );
   * ```
   */
  cancel(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.post(_`/v1/messages/batches/${t}/cancel?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "message-batches-2024-09-24"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Streams the results of a Message Batch as a `.jsonl` file.
   *
   * Each line in the file is a JSON object containing the result of a single request
   * in the Message Batch. Results are not guaranteed to be in the same order as
   * requests. Use the `custom_id` field to match results to requests.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatchIndividualResponse =
   *   await client.beta.messages.batches.results(
   *     'message_batch_id',
   *   );
   * ```
   */
  async results(t, e = {}, n) {
    const s = await this.retrieve(t, e, n);
    if (!s.results_url)
      throw new E(`No batch \`results_url\`; Has it finished processing? ${s.processing_status} - ${s.id}`);
    const { betas: i, workspace_id: a } = e ?? {};
    return this._client.get(s.results_url, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "message-batches-2024-09-24"].toString(),
          Accept: "application/binary",
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ]),
      stream: !0,
      __binaryResponse: !0
    })._thenUnwrap((o, l) => Ml.fromResponse(l.response, l.controller));
  }
};
const Cl = {
  "claude-opus-4@20250514": 8192,
  "anthropic.claude-opus-4-1-20250805-v1:0": 8192,
  "claude-opus-4-1@20250805": 8192
};
function Ll(r) {
  var t;
  return (r == null ? void 0 : r.output_format) ?? ((t = r == null ? void 0 : r.output_config) == null ? void 0 : t.format);
}
function Ja(r, t, e) {
  const n = Ll(t);
  return !t || !("parse" in (n ?? {})) ? {
    ...r,
    content: r.content.map((s) => {
      if (s.type === "text") {
        const i = Object.defineProperty({ ...s }, "parsed_output", {
          value: null,
          enumerable: !1
        });
        return Object.defineProperty(i, "parsed", {
          get() {
            return e.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead."), null;
          },
          enumerable: !1
        });
      }
      return s;
    }),
    parsed_output: null
  } : Pl(r, t, e);
}
function Pl(r, t, e) {
  let n = null;
  const s = r.content.map((i) => {
    if (i.type === "text") {
      const a = ag(t, i.text);
      n === null && (n = a);
      const o = Object.defineProperty({ ...i }, "parsed_output", {
        value: a,
        enumerable: !1
      });
      return Object.defineProperty(o, "parsed", {
        get() {
          return e.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead."), a;
        },
        enumerable: !1
      });
    }
    return i;
  });
  return {
    ...r,
    content: s,
    parsed_output: n
  };
}
function ag(r, t) {
  const e = Ll(r);
  if ((e == null ? void 0 : e.type) !== "json_schema")
    return null;
  try {
    return "parse" in e ? e.parse(t) : JSON.parse(t);
  } catch (n) {
    throw new E(`Failed to parse structured output: ${n}`);
  }
}
const og = (r) => {
  let t = 0, e = [];
  for (; t < r.length; ) {
    let n = r[t];
    if (n === "\\") {
      t++;
      continue;
    }
    if (n === "{") {
      e.push({
        type: "brace",
        value: "{"
      }), t++;
      continue;
    }
    if (n === "}") {
      e.push({
        type: "brace",
        value: "}"
      }), t++;
      continue;
    }
    if (n === "[") {
      e.push({
        type: "paren",
        value: "["
      }), t++;
      continue;
    }
    if (n === "]") {
      e.push({
        type: "paren",
        value: "]"
      }), t++;
      continue;
    }
    if (n === ":") {
      e.push({
        type: "separator",
        value: ":"
      }), t++;
      continue;
    }
    if (n === ",") {
      e.push({
        type: "delimiter",
        value: ","
      }), t++;
      continue;
    }
    if (n === '"') {
      let o = "", l = !1;
      for (n = r[++t]; n !== '"'; ) {
        if (t === r.length) {
          l = !0;
          break;
        }
        if (n === "\\") {
          if (t++, t === r.length) {
            l = !0;
            break;
          }
          o += n + r[t], n = r[++t];
        } else
          o += n, n = r[++t];
      }
      n = r[++t], l || e.push({
        type: "string",
        value: o
      });
      continue;
    }
    if (n && /\s/.test(n)) {
      t++;
      continue;
    }
    let i = /[0-9]/;
    if (n && i.test(n) || n === "-" || n === ".") {
      let o = "";
      for (n === "-" && (o += n, n = r[++t]); n && (i.test(n) || n === "." || // exponent marker, e.g. `1e10` or `1.5E-9`
      n === "e" || n === "E" || // exponent sign, only valid immediately after the exponent marker
      (n === "-" || n === "+") && (o[o.length - 1] === "e" || o[o.length - 1] === "E")); )
        o += n, n = r[++t];
      e.push({
        type: "number",
        value: o
      });
      continue;
    }
    let a = /[a-z]/i;
    if (n && a.test(n)) {
      let o = "";
      for (; n && a.test(n) && t !== r.length; )
        o += n, n = r[++t];
      if (o == "true" || o == "false" || o === "null")
        e.push({
          type: "name",
          value: o
        });
      else {
        t++;
        continue;
      }
      continue;
    }
    t++;
  }
  return e;
}, kt = (r) => {
  if (r.length === 0)
    return r;
  let t = r[r.length - 1];
  switch (t.type) {
    case "separator":
      return r = r.slice(0, r.length - 1), kt(r);
    case "number":
      let e = t.value[t.value.length - 1];
      if (e === "." || e === "-" || e === "+" || e === "e" || e === "E")
        return r = r.slice(0, r.length - 1), kt(r);
    case "string":
      let n = r[r.length - 2];
      if ((n == null ? void 0 : n.type) === "delimiter")
        return r = r.slice(0, r.length - 1), kt(r);
      if ((n == null ? void 0 : n.type) === "brace" && n.value === "{")
        return r = r.slice(0, r.length - 1), kt(r);
      break;
    case "delimiter":
      return r = r.slice(0, r.length - 1), kt(r);
  }
  return r;
}, cg = (r) => {
  let t = [];
  return r.map((e) => {
    e.type === "brace" && (e.value === "{" ? t.push("}") : t.splice(t.lastIndexOf("}"), 1)), e.type === "paren" && (e.value === "[" ? t.push("]") : t.splice(t.lastIndexOf("]"), 1));
  }), t.length > 0 && t.reverse().map((e) => {
    e === "}" ? r.push({
      type: "brace",
      value: "}"
    }) : e === "]" && r.push({
      type: "paren",
      value: "]"
    });
  }), r;
}, lg = (r) => {
  let t = "";
  return r.map((e) => {
    switch (e.type) {
      case "string":
        t += '"' + e.value + '"';
        break;
      default:
        t += e.value;
        break;
    }
  }), t;
}, dg = (r) => JSON.parse(lg(cg(kt(og(r))))), Pt = "__json_buf";
function $l(r, t) {
  const e = {};
  for (const i of Object.keys(r))
    i !== "input" && (e[i] = r[i]);
  Object.defineProperty(e, Pt, { value: t, enumerable: !1, writable: !0 });
  let n, s = !1;
  return Object.defineProperty(e, "input", {
    enumerable: !0,
    configurable: !0,
    get() {
      return s || (n = t ? dg(t) : {}, s = !0), n;
    }
  }), e;
}
var ne, Pe, wt, sn, Yn, an, on, Jn, cn, Se, ln, Gn, Qn, Xe, Zn, er, tr, dn, Qr, Ga, un, Zr, es, ts, Qa, ns;
function rs(r) {
  return r.type === "tool_use" || r.type === "server_tool_use" || r.type === "mcp_tool_use";
}
var ug = /* @__PURE__ */ (() => {
  class r {
    constructor(e, n) {
      ne.add(this), this.messages = [], this.receivedMessages = [], Pe.set(this, void 0), wt.set(this, null), this.controller = new AbortController(), sn.set(this, void 0), Yn.set(this, () => {
      }), an.set(this, () => {
      }), on.set(this, void 0), Jn.set(this, () => {
      }), cn.set(this, () => {
      }), Se.set(this, {}), ln.set(this, !1), Gn.set(this, !1), Qn.set(this, !1), Xe.set(this, !1), Zn.set(this, void 0), er.set(this, void 0), tr.set(this, void 0), dn.set(this, void 0), un.set(this, (s) => {
        if (w(this, Gn, !0), Bt(s) && (s = new ye()), s instanceof ye)
          return w(this, Qn, !0), this._emit("abort", s);
        if (s instanceof E)
          return this._emit("error", s);
        if (s instanceof Error) {
          const i = new E(s.message);
          return i.cause = s, this._emit("error", i);
        }
        return this._emit("error", new E(String(s)));
      }), w(this, sn, new Promise((s, i) => {
        w(this, Yn, s, "f"), w(this, an, i, "f");
      })), w(this, on, new Promise((s, i) => {
        w(this, Jn, s, "f"), w(this, cn, i, "f");
      })), c(this, sn, "f").catch(() => {
      }), c(this, on, "f").catch(() => {
      }), w(this, wt, e), w(this, dn, (n == null ? void 0 : n.logger) ?? console);
    }
    get response() {
      return c(this, Zn, "f");
    }
    get request_id() {
      return c(this, er, "f");
    }
    get workspace_id() {
      return c(this, tr, "f");
    }
    /**
     * Returns the `MessageStream` data, the raw `Response` instance and the ID of the request,
     * returned vie the `request-id` header which is useful for debugging requests and resporting
     * issues to Anthropic.
     *
     * This is the same as the `APIPromise.withResponse()` method.
     *
     * This method will raise an error if you created the stream using `MessageStream.fromReadableStream`
     * as no `Response` is available.
     */
    async withResponse() {
      w(this, Xe, !0);
      const e = await c(this, sn, "f");
      if (!e)
        throw new Error("Could not resolve a `Response` object");
      return {
        data: this,
        response: e,
        request_id: e.headers.get("request-id"),
        workspace_id: e.headers.get("anthropic-workspace-id")
      };
    }
    /**
     * Intended for use on the frontend, consuming a stream produced with
     * `.toReadableStream()` on the backend.
     *
     * Note that messages sent to the model do not appear in `.on('message')`
     * in this context.
     */
    static fromReadableStream(e) {
      const n = new r(null);
      return n._run(() => n._fromReadableStream(e)), n;
    }
    static createMessage(e, n, s, { logger: i } = {}) {
      const a = new r(n, { logger: i });
      for (const o of n.messages)
        a._addMessageParam(o);
      return w(a, wt, { ...n, stream: !0 }), a._run(() => a._createMessage(e, { ...n, stream: !0 }, { ...s, headers: { ...s == null ? void 0 : s.headers, [wl]: "stream" } })), a;
    }
    _run(e) {
      e().then(() => {
        this._emitFinal(), this._emit("end");
      }, c(this, un, "f"));
    }
    _addMessageParam(e) {
      this.messages.push(e);
    }
    _addMessage(e, n = !0) {
      this.receivedMessages.push(e), n && this._emit("message", e);
    }
    async _createMessage(e, n, s) {
      var o;
      const i = s == null ? void 0 : s.signal;
      let a;
      i && (i.aborted && this.controller.abort(), a = this.controller.abort.bind(this.controller), i.addEventListener("abort", a));
      try {
        c(this, ne, "m", Zr).call(this);
        const { response: l, data: u } = await e.create({ ...n, stream: !0 }, { ...s, signal: this.controller.signal }).withResponse();
        this._connected(l);
        for await (const d of u)
          c(this, ne, "m", es).call(this, d);
        if ((o = u.controller.signal) != null && o.aborted)
          throw new ye();
        c(this, ne, "m", ts).call(this);
      } finally {
        i && a && i.removeEventListener("abort", a);
      }
    }
    _connected(e) {
      this.ended || (w(this, Zn, e), w(this, er, e == null ? void 0 : e.headers.get("request-id")), w(this, tr, e == null ? void 0 : e.headers.get("anthropic-workspace-id")), c(this, Yn, "f").call(this, e), this._emit("connect"));
    }
    get ended() {
      return c(this, ln, "f");
    }
    get errored() {
      return c(this, Gn, "f");
    }
    get aborted() {
      return c(this, Qn, "f");
    }
    abort() {
      this.controller.abort();
    }
    /**
     * Adds the listener function to the end of the listeners array for the event.
     * No checks are made to see if the listener has already been added. Multiple calls passing
     * the same combination of event and listener will result in the listener being added, and
     * called, multiple times.
     * @returns this MessageStream, so that calls can be chained
     */
    on(e, n) {
      return (c(this, Se, "f")[e] || (c(this, Se, "f")[e] = [])).push({ listener: n }), this;
    }
    /**
     * Removes the specified listener from the listener array for the event.
     * off() will remove, at most, one instance of a listener from the listener array. If any single
     * listener has been added multiple times to the listener array for the specified event, then
     * off() must be called multiple times to remove each instance.
     * @returns this MessageStream, so that calls can be chained
     */
    off(e, n) {
      const s = c(this, Se, "f")[e];
      if (!s)
        return this;
      const i = s.findIndex((a) => a.listener === n);
      return i >= 0 && s.splice(i, 1), this;
    }
    /**
     * Adds a one-time listener function for the event. The next time the event is triggered,
     * this listener is removed and then invoked.
     * @returns this MessageStream, so that calls can be chained
     */
    once(e, n) {
      return (c(this, Se, "f")[e] || (c(this, Se, "f")[e] = [])).push({ listener: n, once: !0 }), this;
    }
    /**
     * This is similar to `.once()`, but returns a Promise that resolves the next time
     * the event is triggered, instead of calling a listener callback.
     * @returns a Promise that resolves the next time given event is triggered,
     * or rejects if an error is emitted.  (If you request the 'error' event,
     * returns a promise that resolves with the error).
     *
     * Example:
     *
     *   const message = await stream.emitted('message') // rejects if the stream errors
     */
    emitted(e) {
      return new Promise((n, s) => {
        w(this, Xe, !0), e !== "error" && this.once("error", s), this.once(e, n);
      });
    }
    async done() {
      w(this, Xe, !0), await c(this, on, "f");
    }
    get currentMessage() {
      return c(this, Pe, "f");
    }
    /**
     * @returns a promise that resolves with the the final assistant Message response,
     * or rejects if an error occurred or the stream ended prematurely without producing a Message.
     * If structured outputs were used, this will be a ParsedMessage with a `parsed` field.
     */
    async finalMessage() {
      return await this.done(), c(this, ne, "m", Qr).call(this);
    }
    /**
     * @returns a promise that resolves with the the final assistant Message's text response, concatenated
     * together if there are more than one text blocks.
     * Rejects if an error occurred or the stream ended prematurely without producing a Message.
     */
    async finalText() {
      return await this.done(), c(this, ne, "m", Ga).call(this);
    }
    _emit(e, ...n) {
      if (c(this, ln, "f"))
        return;
      e === "end" && (w(this, ln, !0), c(this, Jn, "f").call(this));
      const s = c(this, Se, "f")[e];
      if (s && (c(this, Se, "f")[e] = s.filter((i) => !i.once), s.forEach(({ listener: i }) => i(...n))), e === "abort") {
        const i = n[0];
        !c(this, Xe, "f") && !(s != null && s.length) && Promise.reject(i), c(this, an, "f").call(this, i), c(this, cn, "f").call(this, i), this._emit("end");
        return;
      }
      if (e === "error") {
        const i = n[0];
        !c(this, Xe, "f") && !(s != null && s.length) && Promise.reject(i), c(this, an, "f").call(this, i), c(this, cn, "f").call(this, i), this._emit("end");
      }
    }
    _emitFinal() {
      this.receivedMessages.at(-1) && this._emit("finalMessage", c(this, ne, "m", Qr).call(this));
    }
    async _fromReadableStream(e, n) {
      var a;
      const s = n == null ? void 0 : n.signal;
      let i;
      s && (s.aborted && this.controller.abort(), i = this.controller.abort.bind(this.controller), s.addEventListener("abort", i));
      try {
        c(this, ne, "m", Zr).call(this), this._connected(null);
        const o = Ut.fromReadableStream(e, this.controller);
        for await (const l of o)
          c(this, ne, "m", es).call(this, l);
        if ((a = o.controller.signal) != null && a.aborted)
          throw new ye();
        c(this, ne, "m", ts).call(this);
      } finally {
        s && i && s.removeEventListener("abort", i);
      }
    }
    [(Pe = /* @__PURE__ */ new WeakMap(), wt = /* @__PURE__ */ new WeakMap(), sn = /* @__PURE__ */ new WeakMap(), Yn = /* @__PURE__ */ new WeakMap(), an = /* @__PURE__ */ new WeakMap(), on = /* @__PURE__ */ new WeakMap(), Jn = /* @__PURE__ */ new WeakMap(), cn = /* @__PURE__ */ new WeakMap(), Se = /* @__PURE__ */ new WeakMap(), ln = /* @__PURE__ */ new WeakMap(), Gn = /* @__PURE__ */ new WeakMap(), Qn = /* @__PURE__ */ new WeakMap(), Xe = /* @__PURE__ */ new WeakMap(), Zn = /* @__PURE__ */ new WeakMap(), er = /* @__PURE__ */ new WeakMap(), tr = /* @__PURE__ */ new WeakMap(), dn = /* @__PURE__ */ new WeakMap(), un = /* @__PURE__ */ new WeakMap(), ne = /* @__PURE__ */ new WeakSet(), Qr = function() {
      if (this.receivedMessages.length === 0)
        throw new E("stream ended without producing a Message with role=assistant");
      return this.receivedMessages.at(-1);
    }, Ga = function() {
      if (this.receivedMessages.length === 0)
        throw new E("stream ended without producing a Message with role=assistant");
      const n = this.receivedMessages.at(-1).content.filter((s) => s.type === "text").map((s) => s.text);
      if (n.length === 0)
        throw new E("stream ended without producing a content block with type=text");
      return n.join(" ");
    }, Zr = function() {
      this.ended || w(this, Pe, void 0);
    }, es = function(n) {
      var i;
      if (this.ended)
        return;
      const s = c(this, ne, "m", Qa).call(this, n);
      switch (this._emit("streamEvent", n, s), n.type) {
        case "content_block_delta": {
          const a = s.content.at(-1);
          switch (n.delta.type) {
            case "text_delta": {
              a.type === "text" && this._emit("text", n.delta.text, a.text || "");
              break;
            }
            case "citations_delta": {
              a.type === "text" && this._emit("citation", n.delta.citation, a.citations ?? []);
              break;
            }
            case "input_json_delta": {
              if (rs(a) && ((i = c(this, Se, "f").inputJson) != null && i.length)) {
                let o;
                try {
                  o = a.input;
                } catch (l) {
                  c(this, un, "f").call(this, c(this, ne, "m", ns).call(this, a, l));
                  break;
                }
                this._emit("inputJson", n.delta.partial_json, o);
              }
              break;
            }
            case "thinking_delta": {
              a.type === "thinking" && this._emit("thinking", n.delta.thinking, a.thinking);
              break;
            }
            case "signature_delta": {
              a.type === "thinking" && this._emit("signature", a.signature);
              break;
            }
            case "compaction_delta": {
              a.type === "compaction" && a.content && this._emit("compaction", a.content);
              break;
            }
            default:
              n.delta;
          }
          break;
        }
        case "message_stop": {
          this._addMessageParam(s), this._addMessage(Ja(s, c(this, wt, "f"), { logger: c(this, dn, "f") }), !0);
          break;
        }
        case "content_block_stop": {
          this._emit("contentBlock", s.content.at(-1));
          break;
        }
        case "message_start": {
          w(this, Pe, s);
          break;
        }
      }
    }, ts = function() {
      if (this.ended)
        throw new E("stream has ended, this shouldn't happen");
      const n = c(this, Pe, "f");
      if (!n)
        throw new E("request ended without sending any chunks");
      return w(this, Pe, void 0), Ja(n, c(this, wt, "f"), { logger: c(this, dn, "f") });
    }, Qa = function(n) {
      let s = c(this, Pe, "f");
      if (n.type === "message_start") {
        if (s)
          throw new E(`Unexpected event order, got ${n.type} before receiving "message_stop"`);
        return n.message;
      }
      if (!s)
        throw new E(`Unexpected event order, got ${n.type} before "message_start"`);
      switch (n.type) {
        case "message_stop":
          return s;
        case "message_delta":
          return s.stop_reason = n.delta.stop_reason, s.stop_sequence = n.delta.stop_sequence, s.stop_details = n.delta.stop_details, s.usage.output_tokens = n.usage.output_tokens, n.delta.container != null && (s.container = n.delta.container), n.context_management != null && (s.context_management = n.context_management), n.input_transformations != null && (s.input_transformations = n.input_transformations), n.usage.input_tokens != null && (s.usage.input_tokens = n.usage.input_tokens), n.usage.cache_creation_input_tokens != null && (s.usage.cache_creation_input_tokens = n.usage.cache_creation_input_tokens), n.usage.cache_read_input_tokens != null && (s.usage.cache_read_input_tokens = n.usage.cache_read_input_tokens), n.usage.server_tool_use != null && (s.usage.server_tool_use = n.usage.server_tool_use), n.usage.iterations != null && (s.usage.iterations = n.usage.iterations), n.usage.fallback_credit != null && (s.usage.fallback_credit = n.usage.fallback_credit), n.usage.output_tokens_details != null && (s.usage.output_tokens_details = n.usage.output_tokens_details), s;
        case "content_block_start":
          return s.content.push(n.content_block), n.content_block.type === "fallback" && (s.model = n.content_block.to.model), s;
        case "content_block_delta": {
          const i = s.content.at(n.index);
          switch (n.delta.type) {
            case "text_delta": {
              (i == null ? void 0 : i.type) === "text" && (s.content[n.index] = {
                ...i,
                text: (i.text || "") + n.delta.text
              });
              break;
            }
            case "citations_delta": {
              (i == null ? void 0 : i.type) === "text" && (s.content[n.index] = {
                ...i,
                citations: [...i.citations ?? [], n.delta.citation]
              });
              break;
            }
            case "input_json_delta": {
              if (i && rs(i)) {
                const a = (i[Pt] || "") + n.delta.partial_json;
                s.content[n.index] = $l(i, a);
              }
              break;
            }
            case "thinking_delta": {
              (i == null ? void 0 : i.type) === "thinking" && (s.content[n.index] = {
                ...i,
                thinking: i.thinking + n.delta.thinking
              });
              break;
            }
            case "signature_delta": {
              (i == null ? void 0 : i.type) === "thinking" && (s.content[n.index] = {
                ...i,
                signature: n.delta.signature
              });
              break;
            }
            case "compaction_delta": {
              if ((i == null ? void 0 : i.type) === "compaction") {
                const a = { ...i, content: n.delta.content };
                "encrypted_content" in n.delta && (a.encrypted_content = n.delta.encrypted_content), s.content[n.index] = a;
              }
              break;
            }
            default:
              n.delta;
          }
          return s;
        }
        case "content_block_stop": {
          const i = s.content.at(n.index);
          if (i && rs(i) && Pt in i) {
            let a;
            try {
              a = i.input;
            } catch (o) {
              a = {}, c(this, un, "f").call(this, c(this, ne, "m", ns).call(this, i, o));
            }
            Object.defineProperty(i, "input", {
              value: a,
              enumerable: !0,
              configurable: !0,
              writable: !0
            });
          }
          return s;
        }
      }
    }, ns = function(n, s) {
      const i = n[Pt];
      return new E(`Unable to parse tool parameter JSON from model. Please retry your request or adjust your prompt. Error: ${s}. JSON: ${i}`);
    }, Symbol.asyncIterator)]() {
      const e = [], n = [];
      let s = !1;
      return this.on("streamEvent", (i) => {
        const a = n.shift();
        a ? a.resolve(i) : e.push(i);
      }), this.on("end", () => {
        s = !0;
        for (const i of n)
          i.resolve(void 0);
        n.length = 0;
      }), this.on("abort", (i) => {
        s = !0;
        for (const a of n)
          a.reject(i);
        n.length = 0;
      }), this.on("error", (i) => {
        s = !0;
        for (const a of n)
          a.reject(i);
        n.length = 0;
      }), {
        next: async () => e.length ? { value: e.shift(), done: !1 } : s ? { value: void 0, done: !0 } : new Promise((a, o) => n.push({ resolve: a, reject: o })).then((a) => a ? { value: a, done: !1 } : { value: void 0, done: !0 }),
        return: async () => (this.abort(), { value: void 0, done: !0 })
      };
    }
    toReadableStream() {
      return new Ut(this[Symbol.asyncIterator].bind(this), this.controller).toReadableStream();
    }
  }
  return r;
})();
function Za() {
  let r, t;
  return { promise: new Promise((n, s) => {
    r = n, t = s;
  }), resolve: r, reject: t };
}
const hg = 1e5, fg = `You have been working on the task described above but have not yet completed it. Write a continuation summary that will allow you (or another instance of yourself) to resume work efficiently in a future context window where the conversation history will be replaced with this summary. Your summary should be structured, concise, and actionable. Include:
1. Task Overview
The user's core request and success criteria
Any clarifications or constraints they specified
2. Current State
What has been completed so far
Files created, modified, or analyzed (with paths if relevant)
Key outputs or artifacts produced
3. Important Discoveries
Technical constraints or requirements uncovered
Decisions made and their rationale
Errors encountered and how they were resolved
What approaches were tried that didn't work (and why)
4. Next Steps
Specific actions needed to complete the task
Any blockers or open questions to resolve
Priority order if multiple steps remain
5. Context to Preserve
User preferences or style requirements
Domain-specific details that aren't obvious
Any promises made to the user
Be concise but complete—err on the side of including information that would prevent duplicate work or repeated mistakes. Write in a way that enables immediate resumption of the task.
Wrap your summary in <summary></summary> tags.`;
var H, yt, Ke, $, re, G, Ye, ke, $e, hn, le, Je, bt, Ge, eo, ss, is, nr, as, os, cs, ls, to, ds, no = /* @__PURE__ */ (() => {
  class r {
    constructor(e, n, s) {
      var a;
      H.add(this), this.client = e, yt.set(this, !1), Ke.set(this, !1), $.set(this, void 0), re.set(this, void 0), G.set(this, void 0), Ye.set(this, void 0), ke.set(this, void 0), $e.set(this, void 0), hn.set(this, 0), le.set(this, { status: "idle" }), Je.set(this, null), bt.set(this, /* @__PURE__ */ new Map()), Ge.set(this, []), ro(n), w(this, $, {
        params: {
          // You can't clone the entire params since there are functions as handlers.
          // You also don't really need to clone params.messages, but it probably will prevent a foot gun
          // somewhere.
          ...n,
          // Not structuredClone(): it throws on a function, and a runnable tool written by value into a
          // `tool_addition` block has `run`. A JSON copy is the messages as they are sent, which drops it.
          messages: JSON.parse(JSON.stringify(n.messages))
        }
      });
      const i = yl(n.tools, n.messages);
      w(this, re, {
        ...s,
        headers: p([
          Ws("BetaToolRunner"),
          i.length ? { [An]: i.join(", ") } : void 0,
          s == null ? void 0 : s.headers
        ])
      }), w(this, $e, Za()), (a = n.compactionControl) != null && a.enabled && console.warn('Anthropic: The `compactionControl` parameter is deprecated and will be removed in a future version. Use server-side compaction instead by passing `edits: [{ type: "compact_20260112" }]` in the params passed to `toolRunner()`. See https://platform.claude.com/docs/en/build-with-claude/compaction');
    }
    async *[(yt = /* @__PURE__ */ new WeakMap(), Ke = /* @__PURE__ */ new WeakMap(), $ = /* @__PURE__ */ new WeakMap(), re = /* @__PURE__ */ new WeakMap(), G = /* @__PURE__ */ new WeakMap(), Ye = /* @__PURE__ */ new WeakMap(), ke = /* @__PURE__ */ new WeakMap(), $e = /* @__PURE__ */ new WeakMap(), hn = /* @__PURE__ */ new WeakMap(), le = /* @__PURE__ */ new WeakMap(), Je = /* @__PURE__ */ new WeakMap(), bt = /* @__PURE__ */ new WeakMap(), Ge = /* @__PURE__ */ new WeakMap(), H = /* @__PURE__ */ new WeakSet(), eo = async function() {
      var d;
      const n = c(this, $, "f").params.compactionControl;
      if (!n || !n.enabled)
        return !1;
      let s = 0;
      if (c(this, G, "f") !== void 0)
        try {
          const h = await c(this, G, "f");
          s = h.usage.input_tokens + (h.usage.cache_creation_input_tokens ?? 0) + (h.usage.cache_read_input_tokens ?? 0) + h.usage.output_tokens;
        } catch {
          return !1;
        }
      const i = n.contextTokenThreshold ?? hg;
      if (s < i)
        return !1;
      const a = n.model ?? c(this, $, "f").params.model, o = n.summaryPrompt ?? fg, l = c(this, $, "f").params.messages;
      if (l[l.length - 1].role === "assistant") {
        const h = l[l.length - 1];
        if (Array.isArray(h.content)) {
          const g = h.content.filter((f) => f.type !== "tool_use");
          g.length === 0 ? l.pop() : h.content = g;
        }
      }
      const u = await this.client.beta.messages.create({
        model: a,
        messages: [
          ...l,
          {
            role: "user",
            content: [
              {
                type: "text",
                text: o
              }
            ]
          }
        ],
        max_tokens: c(this, $, "f").params.max_tokens
      }, {
        signal: c(this, re, "f").signal,
        headers: p([c(this, re, "f").headers, Ws("compaction")])
      });
      if (((d = u.content[0]) == null ? void 0 : d.type) !== "text")
        throw new E("Expected text response for compaction");
      return c(this, H, "m", os).call(this), w(this, Je, null), c(this, $, "f").params.messages = [
        {
          role: "user",
          content: u.content
        }
      ], !0;
    }, Symbol.asyncIterator)]() {
      var n;
      var e;
      if (c(this, yt, "f"))
        throw new E("Cannot iterate over a consumed stream");
      w(this, yt, !0), w(this, Ke, !0), w(this, ke, void 0);
      try {
        for (; ; )
          try {
            if (c(this, $, "f").params.max_iterations && c(this, hn, "f") >= c(this, $, "f").params.max_iterations)
              break;
            if (c(this, H, "m", to).call(this), c(this, le, "f").status === "scheduled" && io(c(this, Je, "f")) !== "resume") {
              yield* c(this, H, "m", is).call(this, c(this, le, "f").config);
              continue;
            }
            w(this, Ke, !1, "f"), w(this, ke, void 0, "f"), w(this, hn, (e = c(this, hn, "f"), e++, e), "f"), w(this, G, void 0, "f");
            const { max_iterations: s, compactionControl: i, ...a } = c(this, $, "f").params;
            if (yield* c(this, H, "m", ss).call(this, a), !await c(this, H, "m", eo).call(this)) {
              if (c(this, Ke, "f"))
                w(this, Je, null, "f");
              else {
                const u = await c(this, G, "f"), d = io(u.stop_reason);
                w(this, Je, u.stop_reason, "f"), c(this, $, "f").params.messages.push({
                  role: u.role,
                  content: u.content
                });
                const { container: h } = c(this, $, "f").params;
                if (u.container && (h == null ? c(this, $, "f").params.container = u.container.id : typeof h == "object" && h.id == null && (c(this, $, "f").params.container = { ...h, id: u.container.id })), d === "stop") {
                  yield* c(this, H, "m", cs).call(this);
                  break;
                }
                if (d === "resume")
                  continue;
              }
              const l = await c(this, H, "m", ls).call(this, c(this, $, "f").params.messages.at(-1));
              if (l)
                c(this, $, "f").params.messages.push(l);
              else if (!c(this, Ke, "f")) {
                yield* c(this, H, "m", cs).call(this);
                break;
              }
            }
          } finally {
            (n = c(this, Ye, "f")) == null || n.abort(), w(this, Ye, void 0, "f");
          }
        if (!c(this, G, "f"))
          throw new E("ToolRunner concluded without a message from the server");
        c(this, $e, "f").resolve(await c(this, G, "f"));
      } catch (s) {
        throw w(this, yt, !1), c(this, $e, "f").promise.catch(() => {
        }), c(this, $e, "f").reject(s), w(this, $e, Za()), s;
      }
    }
    setMessagesParams(e) {
      const n = typeof e == "function" ? e(c(this, $, "f").params) : e;
      if (ro(n), c(this, le, "f").status !== "idle" && us(n), c(this, le, "f").status === "in_flight" && n.messages !== c(this, $, "f").params.messages)
        throw new E("Message params can't be changed while the conversation is being compacted, because the compaction response is about to replace them. Change them after this iteration instead.");
      c(this, $, "f").params = n, w(this, Ke, !0), w(this, ke, void 0);
    }
    setRequestOptions(e) {
      typeof e == "function" ? w(this, re, e(c(this, re, "f"))) : w(this, re, { ...c(this, re, "f"), ...e });
    }
    /**
     * Get the tool response for the last message from the assistant.
     * Avoids redundant tool executions by caching results.
     *
     * @returns A promise that resolves to a BetaMessageParam containing tool results, or null if no tools need to be executed
     *
     * @example
     * const toolResponse = await runner.generateToolResponse();
     * if (toolResponse) {
     *   console.log('Tool results:', toolResponse.content);
     * }
     */
    async generateToolResponse(e = c(this, re, "f").signal) {
      const n = await c(this, G, "f") ?? this.params.messages.at(-1);
      return n ? c(this, H, "m", ls).call(this, n, e) : null;
    }
    /**
     * Wait for the async iterator to complete. This works even if the async iterator hasn't yet started, and
     * will wait for an instance to start and go to completion.
     *
     * @returns A promise that resolves to the final BetaMessage when the iterator completes
     *
     * @example
     * // Start consuming the iterator
     * for await (const message of runner) {
     *   console.log('Message:', message.content);
     * }
     *
     * // Meanwhile, wait for completion from another part of the code
     * const finalMessage = await runner.done();
     * console.log('Final response:', finalMessage.content);
     */
    done() {
      return c(this, $e, "f").promise;
    }
    /**
     * Returns a promise indicating that the stream is done. Unlike .done(), this will eagerly read the stream:
     * * If the iterator has not been consumed, consume the entire iterator and return the final message from the
     * assistant.
     * * If the iterator has been consumed, waits for it to complete and returns the final message.
     *
     * @returns A promise that resolves to the final BetaMessage from the conversation
     * @throws {AnthropicError} If no messages were processed during the conversation
     *
     * @example
     * const finalMessage = await runner.runUntilDone();
     * console.log('Final response:', finalMessage.content);
     */
    async runUntilDone() {
      if (!c(this, yt, "f"))
        for await (const e of this)
          ;
      return this.done();
    }
    /**
     * Get the current parameters being used by the ToolRunner.
     *
     * @returns A readonly view of the current ToolRunnerParams
     *
     * @example
     * const currentParams = runner.params;
     * console.log('Current model:', currentParams.model);
     * console.log('Message count:', currentParams.messages.length);
     */
    get params() {
      return c(this, $, "f").params;
    }
    /**
     * Add one or more messages to the conversation history.
     *
     * @param messages - One or more BetaMessageParam objects to add to the conversation
     *
     * @example
     * runner.pushMessages(
     *   { role: 'user', content: 'Also, what about the weather in NYC?' }
     * );
     *
     * @example
     * // Adding multiple messages
     * runner.pushMessages(
     *   { role: 'user', content: 'What about NYC?' },
     *   { role: 'user', content: 'And Boston?' }
     * );
     */
    pushMessages(...e) {
      this.setMessagesParams((n) => ({
        ...n,
        messages: [...n.messages, ...e]
      }));
    }
    /**
     * Schedule a compaction of the conversation. Once the current turn has finished, including any tool
     * calls, the runner requests a summary and replaces the message history with the compaction response,
     * which is yielded like any other message. Requires the `compact-2026-09-04` beta.
     *
     * @param compaction - The config to send, as `messages.create()` takes it. Defaults to `{ type: 'summarize' }`
     *
     * @example
     * for await (const message of runner) {
     *   if (message.usage.input_tokens > 100_000) {
     *     runner.compactBeforeNextTurn();
     *   }
     * }
     */
    compactBeforeNextTurn(e) {
      c(this, le, "f").status !== "in_flight" && (us(c(this, $, "f").params), w(this, le, { status: "scheduled", config: e ?? { type: "summarize" } }));
    }
    /**
     * Give the model more tools without changing `params.tools`, which would miss the prompt cache.
     *
     * Each tool's whole definition is sent in a `tool_addition` block with the next request, and a
     * runnable tool replaces a runnable tool of the same name straight away, even for a call already in
     * the message being handled. A raw definition is only sent: the runner never runs it, and stops
     * running a tool of the same name. Requires the `inline-tools-2026-09-15` beta, which the runner does
     * not add for you.
     *
     * @param tools - Runnable tools (for example from `betaZodTool()`) or raw tool definitions
     *
     * @example
     * runner.addTools(queryDatabaseTool);
     */
    addTools(...e) {
      for (const n of e)
        "name" in n && c(this, bt, "f").set(n.name, "run" in n ? n : null), c(this, Ge, "f").push({ type: "addition", tool: n });
    }
    /**
     * Take tools away from the model without changing `params.tools`, which would miss the prompt cache.
     *
     * The tools stop being run straight away: a call to one of them, even one in the message being
     * handled, gets the same "not found" error result as a call to an unknown tool. The model is told
     * in a `tool_removal` block with the next request. Use {@link addTools} to bring a tool back.
     * Requires the `inline-tools-2026-09-15` beta, which the runner does not add for you.
     *
     * @param tools - The tools to remove, or their names
     *
     * @example
     * runner.removeTools('query_database');
     */
    removeTools(...e) {
      for (const n of e) {
        const s = typeof n == "string" ? n : n.name;
        c(this, bt, "f").set(s, null), c(this, Ge, "f").push({ type: "removal", name: s });
      }
    }
    /**
     * Makes the ToolRunner directly awaitable, equivalent to calling .runUntilDone()
     * This allows using `await runner` instead of `await runner.runUntilDone()`
     */
    then(e, n) {
      return this.runUntilDone().then(e, n);
    }
  }
  return ss = /**
   * Sends one request and yields its message, or its stream when streaming. `#message` and `#stream` are set
   * before the yield, so they are there while the caller handles the item; the loop aborts the stream at the
   * end of the iteration.
   */
  async function* (e) {
    e.stream ? (w(this, Ye, this.client.beta.messages.stream({ ...e }, c(this, re, "f"))), w(this, G, c(this, Ye, "f").finalMessage()), c(this, G, "f").catch(() => {
    }), yield c(this, Ye, "f")) : (w(this, G, this.client.beta.messages.create({ ...e, stream: !1 }, c(this, re, "f"))), yield c(this, G, "f"));
  }, is = async function* (e) {
    us(c(this, $, "f").params);
    const { max_iterations: n, compactionControl: s, ...i } = c(this, $, "f").params, a = pg(i);
    w(this, le, { status: "in_flight" }), w(this, ke, void 0);
    const o = c(this, G, "f");
    try {
      yield* c(this, H, "m", ss).call(this, { ...a, compaction: e });
      const l = await c(this, G, "f");
      l.content.some((u) => u.type === "compaction" && u.content) ? (c(this, H, "m", os).call(this), c(this, $, "f").params.messages = [{ role: l.role, content: l.content }]) : (F(this.client).warn("Compaction produced no summary; keeping the conversation as it is."), w(this, G, o, "f"));
    } finally {
      w(this, le, { status: "idle" });
    }
  }, nr = function() {
    const e = /* @__PURE__ */ new Map();
    for (const n of c(this, $, "f").params.tools)
      "run" in n && e.set(n.name, n);
    for (const [n, s] of c(this, bt, "f"))
      s ? e.set(n, s) : e.delete(n);
    return e;
  }, as = function() {
    const e = new Set(c(this, H, "m", nr).call(this).keys());
    for (const n of [...c(this, $, "f").params.messages, c(this, H, "m", ds).call(this)])
      if (typeof n.content != "string") {
        for (const s of n.content)
          if (n.role === "system")
            so(s, e);
          else if (n.role === "assistant" && s.type === "compaction")
            for (const i of s.tool_changes ?? [])
              so(i, e);
      }
    return e;
  }, os = function() {
    const e = c(this, H, "m", as).call(this);
    for (const n of c(this, H, "m", nr).call(this).keys())
      e.has(n) || c(this, bt, "f").set(n, null);
  }, cs = async function* () {
    var n;
    if (c(this, le, "f").status !== "scheduled")
      return;
    const e = (n = c(this, $, "f").params.messages.at(-1)) == null ? void 0 : n.content;
    if (Array.isArray(e) && e.some((s) => s.type === "tool_use")) {
      F(this.client).warn("The pending compaction was skipped because the last turn ended with tool calls that were not run. Call `compactBeforeNextTurn()` again if you continue the conversation."), w(this, le, { status: "idle" });
      return;
    }
    yield* c(this, H, "m", is).call(this, c(this, le, "f").config);
  }, ls = async function(e, n = c(this, re, "f").signal) {
    return c(this, ke, "f") !== void 0 ? c(this, ke, "f") : (w(this, ke, gg(c(this, H, "m", nr).call(this), c(this, H, "m", as).call(this), e, { ...c(this, re, "f"), signal: n })), c(this, ke, "f"));
  }, to = function() {
    c(this, Je, "f") === "pause_turn" || c(this, Ge, "f").length === 0 || (c(this, $, "f").params.messages.push(c(this, H, "m", ds).call(this)), w(this, Ge, []));
  }, ds = function() {
    const e = [];
    for (const n of c(this, Ge, "f")) {
      if (n.type === "removal") {
        e.push({ type: "tool_removal", tool: { type: "tool_reference", name: n.name } });
        continue;
      }
      let s = n.tool;
      if ("run" in n.tool) {
        const { run: i, parse: a, close: o, ...l } = n.tool;
        s = l;
      }
      e.push({ type: "tool_addition", tool: { type: "tool_definition", definition: s } });
    }
    return { role: "system", content: e };
  }, r;
})();
function ro(r) {
  if ("compaction" in r && r.compaction != null)
    throw new E("`compaction` cannot be set on a tool runner: every request in the loop would compact again. Call `runner.compactBeforeNextTurn()` when the conversation should be compacted instead.");
}
function us(r) {
  var t, e;
  if ((e = (t = r.context_management) == null ? void 0 : t.edits) != null && e.some((n) => n.type.startsWith("compact_")))
    throw new E("`compactBeforeNextTurn()` can't be used while `context_management` has a compaction edit, because the API doesn't accept a compaction block together with one. Remove the edit first.");
}
function pg(r) {
  var a, o;
  const { context_management: t, stop_sequences: e, output_format: n, ...s } = r, i = ({ format: l, ...u }) => u;
  return (((a = s.tool_choice) == null ? void 0 : a.type) === "any" || ((o = s.tool_choice) == null ? void 0 : o.type) === "tool") && delete s.tool_choice, s.output_config && (s.output_config = i(s.output_config)), Array.isArray(s.fallbacks) && (s.fallbacks = s.fallbacks.map((l) => l.output_config ? { ...l, output_config: i(l.output_config) } : l)), s;
}
async function gg(r, t, e, n) {
  if (!e || e.role !== "assistant" || !e.content || typeof e.content == "string")
    return null;
  const s = e.content.filter((a) => a.type === "tool_use");
  return s.length === 0 ? null : {
    role: "user",
    content: await Promise.all(s.map(async (a) => {
      const o = t.has(a.name) ? r.get(a.name) : void 0;
      if (!o)
        return mg(a);
      try {
        let l = a.input;
        "parse" in o && o.parse && (l = o.parse(l));
        const u = await o.run(l, {
          toolUse: a,
          toolUseBlock: a,
          signal: n == null ? void 0 : n.signal
        });
        return {
          type: "tool_result",
          tool_use_id: a.id,
          content: u
        };
      } catch (l) {
        return {
          type: "tool_result",
          tool_use_id: a.id,
          content: l instanceof yi ? l.content : `Error: ${l instanceof Error ? l.message : String(l)}`,
          is_error: !0
        };
      }
    }))
  };
}
function mg(r) {
  return {
    type: "tool_result",
    tool_use_id: r.id,
    content: `Error: Tool '${r.name}' not found`,
    is_error: !0
  };
}
function so(r, t) {
  switch (r.type) {
    case "tool_removal":
    case "tool_addition":
      _g(r, t);
      break;
  }
}
function _g(r, t) {
  const e = wg(r.tool);
  e !== void 0 && (r.type === "tool_removal" ? t.delete(e) : t.add(e));
}
function wg(r) {
  switch (r.type) {
    case "tool_reference":
      return r.name;
    case "tool_definition":
      return "name" in r.definition ? r.definition.name : void 0;
    default:
      return;
  }
}
function io(r) {
  if (r === null)
    return "stop";
  switch (r) {
    case "tool_use":
      return "run_tools";
    case "pause_turn":
    case "compaction":
      return "resume";
    case "end_turn":
    case "stop_sequence":
    case "max_tokens":
    case "model_context_window_exceeded":
    case "refusal":
      return "stop";
    default:
      return "stop";
  }
}
const ao = {}, yg = ["claude-mythos-preview", "claude-opus-4-6"];
var oo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.batches = new Ya(this._client);
    }
    create(e, n) {
      const s = co(e), { betas: i, user_profile_id: a, workspace_id: o, ...l } = s;
      l.model in ao && console.warn(`The model '${l.model}' is deprecated and will reach end-of-life on ${ao[l.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`), yg.includes(l.model) && l.thinking && l.thinking.type === "enabled" && console.warn(`Using Claude with ${l.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);
      let u = (n == null ? void 0 : n.timeout) ?? this._client._options.timeout;
      if (!l.stream && u == null) {
        const h = Cl[l.model] ?? void 0;
        u = this._client.calculateNonstreamingTimeout(l.max_tokens, h);
      }
      const d = bl(l.tools, l.messages);
      return this._client.post("/v1/messages?beta=true", {
        body: l,
        timeout: u ?? 6e5,
        ...n,
        headers: p([
          {
            ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0,
            ...a != null ? { "anthropic-user-profile-id": a } : void 0,
            ...o != null ? { "anthropic-workspace-id": o } : void 0
          },
          d,
          n == null ? void 0 : n.headers
        ]),
        stream: s.stream ?? !1
      });
    }
    /**
     * Send a structured list of input messages with text and/or image content, along with an expected `output_format` and
     * the response will be automatically parsed and available in the `parsed_output` property of the message.
     *
     * @example
     * ```ts
     * const message = await client.beta.messages.parse({
     *   model: 'claude-3-5-sonnet-20241022',
     *   max_tokens: 1024,
     *   messages: [{ role: 'user', content: 'What is 2+2?' }],
     *   output_format: zodOutputFormat(z.object({ answer: z.number() }), 'math'),
     * });
     *
     * console.log(message.parsed_output?.answer); // 4
     * ```
     */
    parse(e, n) {
      return n = {
        ...n,
        headers: p([
          { "anthropic-beta": [...e.betas ?? [], "structured-outputs-2025-12-15"].toString() },
          n == null ? void 0 : n.headers
        ])
      }, this.create(e, n).then((s) => Pl(s, e, { logger: this._client.logger ?? console }));
    }
    /**
     * Create a Message stream
     */
    stream(e, n) {
      return ug.createMessage(this, e, n);
    }
    /**
     * Count the number of tokens in a Message.
     *
     * The Token Count API can be used to count the number of tokens in a Message,
     * including tools, images, and documents, without creating it.
     *
     * Learn more about token counting in our
     * [user guide](https://platform.claude.com/docs/en/build-with-claude/token-counting)
     *
     * @example
     * ```ts
     * const betaMessageTokensCount =
     *   await client.beta.messages.countTokens({
     *     messages: [{ content: 'Hello, world', role: 'user' }],
     *     model: 'claude-opus-5',
     *   });
     * ```
     */
    countTokens(e, n) {
      const s = co(e), { betas: i, user_profile_id: a, workspace_id: o, ...l } = s;
      return this._client.post("/v1/messages/count_tokens?beta=true", {
        body: l,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "token-counting-2024-11-01"].toString(),
            ...a != null ? { "anthropic-user-profile-id": a } : void 0,
            ...o != null ? { "anthropic-workspace-id": o } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    toolRunner(e, n) {
      return new no(this._client, e, n);
    }
  }
  return r.Batches = Ya, r.BetaToolRunner = no, r.ToolError = yi, r;
})();
function co(r) {
  var n;
  if (!r.output_format)
    return r;
  if ((n = r.output_config) != null && n.format)
    throw new E("Both output_format and output_config.format were provided. Please use only output_config.format (output_format is deprecated).");
  const { output_format: t, ...e } = r;
  return {
    ...e,
    output_config: {
      ...r.output_config,
      format: t
    }
  };
}
class lo extends I {
  /**
   * Get API Key
   *
   * @example
   * ```ts
   * const betaAPIKey =
   *   await client.beta.organization.apiKeys.retrieve(
   *     'api_key_id',
   *   );
   * ```
   */
  retrieve(t, e) {
    return this._client.get(_`/v1/organizations/api_keys/${t}?beta=true`, e);
  }
  /**
   * Update API Key
   *
   * @example
   * ```ts
   * const betaAPIKey =
   *   await client.beta.organization.apiKeys.update(
   *     'api_key_id',
   *   );
   * ```
   */
  update(t, e, n) {
    return this._client.post(_`/v1/organizations/api_keys/${t}?beta=true`, { body: e, ...n });
  }
  /**
   * List API Keys
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaAPIKey of client.beta.organization.apiKeys.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    return this._client.getAPIList("/v1/organizations/api_keys?beta=true", Oe, {
      query: t,
      ...e
    });
  }
}
class uo extends I {
  /**
   * Retrieve your organization's Compliance Settings.
   *
   * Compliance Settings is a singleton resource: there is exactly one per
   * organization, addressed without an identifier. The `state` field reflects
   * whether the Compliance API is enabled. An organization with a parent
   * organization reads the state inherited from the parent's configuration.
   *
   * @example
   * ```ts
   * const betaComplianceSettings =
   *   await client.beta.organization.complianceSettings.retrieve();
   * ```
   */
  retrieve(t) {
    return this._client.get("/v1/organizations/compliance_settings?beta=true", t);
  }
  /**
   * Update your organization's Compliance Settings.
   *
   * Setting `state` to `enabled` turns on the Compliance API and begins capturing
   * organization activity events. Setting it to `disabled` turns both off. `state`
   * reflects whether the Compliance API is enabled.
   *
   * A request that sets `state` to its current value succeeds and leaves the
   * resource unchanged. A `disabled` request stays in effect until a later `enabled`
   * request or the organization's next provisioning action that enables Access
   * Transparency: enabling Access Transparency also enables the Compliance API,
   * which serves its activity events, so such provisioning (including re-runs)
   * re-enables the Compliance API even after a `disabled` request. Automated
   * provisioning never disables compliance settings.
   *
   * @example
   * ```ts
   * const betaComplianceSettings =
   *   await client.beta.organization.complianceSettings.update({
   *     state: { type: 'enabled' },
   *   });
   * ```
   */
  update(t, e) {
    return this._client.post("/v1/organizations/compliance_settings?beta=true", { body: t, ...e });
  }
}
class ho extends I {
  /**
   * Create an external key config owned by the caller's organization.
   *
   * @example
   * ```ts
   * const betaExternalKey =
   *   await client.beta.organization.externalKeys.create({
   *     provider_config: {
   *       kms_arn:
   *         'arn:aws:kms:us-east-1:111122223333:key/abcd1234-5678-90ab-cdef-000011112222',
   *       type: 'aws',
   *     },
   *   });
   * ```
   */
  create(t, e) {
    return this._client.post("/v1/organizations/external_keys?beta=true", { body: t, ...e });
  }
  /**
   * Retrieve a single external key config in the caller's organization by ID.
   *
   * @example
   * ```ts
   * const betaExternalKey =
   *   await client.beta.organization.externalKeys.retrieve(
   *     'external_key_id',
   *   );
   * ```
   */
  retrieve(t, e) {
    return this._client.get(_`/v1/organizations/external_keys/${t}?beta=true`, e);
  }
  /**
   * Partially update an external key config. Omitted fields are left unchanged.
   *
   * `display_name` is always editable. `geo` and `provider_config` cannot be changed
   * once any workspace references this config, because previously encrypted data
   * requires the original key identity to decrypt.
   *
   * @example
   * ```ts
   * const betaExternalKey =
   *   await client.beta.organization.externalKeys.update(
   *     'external_key_id',
   *   );
   * ```
   */
  update(t, e, n) {
    return this._client.post(_`/v1/organizations/external_keys/${t}?beta=true`, {
      body: e,
      ...n
    });
  }
  /**
   * List external key configs in the caller's organization.
   *
   * Results are ordered by creation time (newest first). Use the `next_page` cursor
   * from the response to fetch subsequent pages.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaExternalKey of client.beta.organization.externalKeys.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    return this._client.getAPIList("/v1/organizations/external_keys?beta=true", L, {
      query: t,
      ...e
    });
  }
  /**
   * Delete an external key config.
   *
   * The request is rejected if any workspace still references this config.
   *
   * @example
   * ```ts
   * const externalKey =
   *   await client.beta.organization.externalKeys.delete(
   *     'external_key_id',
   *   );
   * ```
   */
  delete(t, e) {
    return this._client.delete(_`/v1/organizations/external_keys/${t}?beta=true`, e);
  }
  /**
   * Validate an external key config against the customer's KMS.
   *
   * Anthropic performs an encrypt/decrypt roundtrip against the configured KMS key
   * and waits up to 30 seconds for the result. The response status is `success` if
   * the roundtrip succeeded, or `failure` with an error message if it failed or
   * timed out.
   *
   * @example
   * ```ts
   * const response =
   *   await client.beta.organization.externalKeys.validate(
   *     'external_key_id',
   *   );
   * ```
   */
  validate(t, e) {
    return this._client.post(_`/v1/organizations/external_keys/${t}/validate?beta=true`, e);
  }
}
class fo extends I {
  /**
   * Invite a user to join the organization by email.
   *
   * On plans that draw members from a finite pool of purchased seats, the invite
   * automatically consumes a seat from the lowest tier with availability; there is
   * no seat-tier parameter. When no seat is free the request fails with a 400 error
   * rather than purchasing a seat.
   *
   * @example
   * ```ts
   * const betaOrganizationInvite =
   *   await client.beta.organization.invites.create({
   *     email: 'user@emaildomain.com',
   *     role: 'user',
   *   });
   * ```
   */
  create(t, e) {
    return this._client.post("/v1/organizations/invites?beta=true", { body: t, ...e });
  }
  /**
   * Retrieve an invite by ID.
   *
   * @example
   * ```ts
   * const betaOrganizationInvite =
   *   await client.beta.organization.invites.retrieve(
   *     'invite_id',
   *   );
   * ```
   */
  retrieve(t, e) {
    return this._client.get(_`/v1/organizations/invites/${t}?beta=true`, e);
  }
  /**
   * List the organization's invites.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaOrganizationInvite of client.beta.organization.invites.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    return this._client.getAPIList("/v1/organizations/invites?beta=true", Oe, {
      query: t,
      ...e
    });
  }
  /**
   * Delete a pending invite.
   *
   * @example
   * ```ts
   * const invite =
   *   await client.beta.organization.invites.delete(
   *     'invite_id',
   *   );
   * ```
   */
  delete(t, e) {
    return this._client.delete(_`/v1/organizations/invites/${t}?beta=true`, e);
  }
}
let po = class extends I {
  /**
   * List Messages API rate limits for your organization.
   *
   * Each entry corresponds to one rate-limit group (either a model family or an
   * API-surface category such as the Files API or Message Batches) and contains the
   * set of limiter values that apply to it.
   *
   * When `limit` is omitted, every matching entry is returned in a single page; when
   * `limit` truncates the result, follow `next_page` to fetch the remaining entries.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaOrganizationRateLimit of client.beta.organization.rateLimits.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    return this._client.getAPIList("/v1/organizations/rate_limits?beta=true", L, { query: t, ...e });
  }
};
class go extends I {
  /**
   * Retrieve a member of the organization by user ID.
   *
   * @example
   * ```ts
   * const betaOrganizationUser =
   *   await client.beta.organization.users.retrieve('user_id');
   * ```
   */
  retrieve(t, e) {
    return this._client.get(_`/v1/organizations/users/${t}?beta=true`, e);
  }
  /**
   * Update a member's organization role.
   *
   * @example
   * ```ts
   * const betaOrganizationUser =
   *   await client.beta.organization.users.update('user_id', {
   *     role: 'user',
   *   });
   * ```
   */
  update(t, e, n) {
    return this._client.post(_`/v1/organizations/users/${t}?beta=true`, { body: e, ...n });
  }
  /**
   * List the organization's members.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaOrganizationUser of client.beta.organization.users.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    return this._client.getAPIList("/v1/organizations/users?beta=true", Oe, {
      query: t,
      ...e
    });
  }
  /**
   * Remove a member from the organization.
   *
   * @example
   * ```ts
   * const user = await client.beta.organization.users.remove(
   *   'user_id',
   * );
   * ```
   */
  remove(t, e) {
    return this._client.delete(_`/v1/organizations/users/${t}?beta=true`, e);
  }
}
class mo extends I {
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Register an OIDC issuer that Anthropic will trust for workload identity
   * federation in your organization.
   *
   * The `jwks` field controls how the issuer's signing keys are obtained and takes
   * one of three shapes selected by `type`: `discovery` (resolve keys through OIDC
   * discovery), `explicit_url` (fetch keys from a fixed JWKS URL), or `inline`
   * (provide a static key set). When `jwks.type` is `discovery` and no
   * `discovery_base` is set, the issuer URL must be publicly reachable over HTTPS so
   * Anthropic can fetch the discovery document; for `explicit_url` and `inline`
   * modes the issuer URL is only matched as the JWT's `iss` claim and is not
   * fetched.
   *
   * @example
   * ```ts
   * const betaFederationIssuer =
   *   await client.beta.organization.federation.issuers.create({
   *     issuer_url: 'x',
   *     name: 'x',
   *   });
   * ```
   */
  create(t, e) {
    const { betas: n, ...s } = t;
    return this._client.post("/v1/organizations/federation_issuers?beta=true", {
      body: s,
      ...e,
      headers: p([
        { ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0 },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Retrieve a federation issuer by its ID (`fdis_...`).
   *
   * @example
   * ```ts
   * const betaFederationIssuer =
   *   await client.beta.organization.federation.issuers.retrieve(
   *     'federation_issuer_id',
   *   );
   * ```
   */
  retrieve(t, e = {}, n) {
    const { betas: s } = e ?? {};
    return this._client.get(_`/v1/organizations/federation_issuers/${t}?beta=true`, {
      ...n,
      headers: p([
        { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Partially update a federation issuer.
   *
   * Setting `jwks` replaces the full JWKS shape at once. Archived issuers cannot be
   * updated; this returns 400. Create a new issuer instead.
   *
   * Updating an issuer that backs a rule with a scope outside `workspace:developer`
   * or `workspace:inference` requires a Console session.
   *
   * @example
   * ```ts
   * const betaFederationIssuer =
   *   await client.beta.organization.federation.issuers.update(
   *     'federation_issuer_id',
   *   );
   * ```
   */
  update(t, e, n) {
    const { betas: s, ...i } = e;
    return this._client.post(_`/v1/organizations/federation_issuers/${t}?beta=true`, {
      body: i,
      ...n,
      headers: p([
        { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * List federation issuers in your organization.
   *
   * Archived issuers are excluded unless `include_archived=true`.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaFederationIssuer of client.beta.organization.federation.issuers.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { betas: n, ...s } = t ?? {};
    return this._client.getAPIList("/v1/organizations/federation_issuers?beta=true", L, {
      query: s,
      ...e,
      headers: p([
        { ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0 },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Archive a federation issuer.
   *
   * Idempotent; re-archiving returns the issuer with its original `archived_at`.
   * Rejected with 400 if any live (non-archived) federation rule still references
   * the issuer; archive those rules first (a rule's issuer cannot be changed), or
   * recreate them against another issuer.
   *
   * @example
   * ```ts
   * const betaFederationIssuer =
   *   await client.beta.organization.federation.issuers.archive(
   *     'federation_issuer_id',
   *   );
   * ```
   */
  archive(t, e = {}, n) {
    const { betas: s } = e ?? {};
    return this._client.post(_`/v1/organizations/federation_issuers/${t}/archive?beta=true`, {
      ...n,
      headers: p([
        { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
let _o = class extends I {
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * List workspaces where this federation rule is enabled.
   *
   * Returns all workspace enablements in a single response; the `limit` and `page`
   * parameters are accepted but have no effect, and `next_page` is always `null`.
   * Returns explicit per-workspace enablements only; for rules with
   * `applies_to_all_workspaces` or a legacy single `workspace_id`, check those
   * fields on the rule itself.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaFederationRuleWorkspace of client.beta.organization.federation.rules.workspaces.list(
   *   'federation_rule_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, ...i } = e ?? {};
    return this._client.getAPIList(_`/v1/organizations/federation_rules/${t}/workspaces?beta=true`, L, {
      query: i,
      ...n,
      headers: p([
        { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Enable a federation rule for a workspace.
   *
   * Idempotent; re-enabling returns the existing enablement. The rule and workspace
   * must both belong to your organization. Membership of the rule's target service
   * account in this workspace is not checked at enablement: token exchange into this
   * workspace is rejected unless the target is a member (it is implicitly a member
   * of the default workspace). Archived rules are rejected with 400. OAuth callers
   * may only manage rules whose `oauth_scope` is `workspace:developer` or
   * `workspace:inference`; other scopes require a Console session.
   *
   * @example
   * ```ts
   * const betaFederationRuleWorkspace =
   *   await client.beta.organization.federation.rules.workspaces.add(
   *     'federation_rule_id',
   *     { workspace_id: 'workspace_id' },
   *   );
   * ```
   */
  add(t, e, n) {
    const { betas: s, ...i } = e;
    return this._client.post(_`/v1/organizations/federation_rules/${t}/workspaces?beta=true`, {
      body: i,
      ...n,
      headers: p([
        { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Disable a federation rule for a workspace.
   *
   * Idempotent; succeeds even if the enablement was already removed. OAuth callers
   * may only manage rules whose `oauth_scope` is `workspace:developer` or
   * `workspace:inference`; other scopes require a Console session.
   *
   * @example
   * ```ts
   * const workspace =
   *   await client.beta.organization.federation.rules.workspaces.remove(
   *     'workspace_id',
   *     { federation_rule_id: 'federation_rule_id' },
   *   );
   * ```
   */
  remove(t, e, n) {
    const { federation_rule_id: s, betas: i } = e;
    return this._client.delete(_`/v1/organizations/federation_rules/${s}/workspaces/${t}?beta=true`, {
      ...n,
      headers: p([
        { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
};
var wo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.workspaces = new _o(this._client);
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * Create a federation rule owned by your organization.
     *
     * The referenced issuer and the target service account must already exist in the
     * same organization; invalid references are rejected with a 400 error. The
     * workspace reference is validated. Membership is not checked at rule creation:
     * token exchange resolves a single enabled workspace per call and is rejected
     * unless the target service account is a member of that workspace (it is
     * implicitly a member of the default workspace). Rules on well-known shared
     * issuers (GitHub Actions, GitLab, Buildkite, Terraform Cloud, Google) must
     * constrain tenant identity via an identity-bearing claim, a tenant-pinning
     * subject prefix (such as `repo:YOUR_ORG/...`), or a CEL condition referencing one
     * of those identity claims (e.g. `claims.repository_owner`). OAuth callers may
     * only manage rules whose `oauth_scope` is `workspace:developer` or
     * `workspace:inference`; other scopes require a Console session.
     *
     * @example
     * ```ts
     * const betaFederationRule =
     *   await client.beta.organization.federation.rules.create({
     *     issuer_id: 'issuer_id',
     *     match: {},
     *     name: 'x',
     *     oauth_scope: 'x',
     *     target: {
     *       service_account_id: 'svac_01SDCCSbTxrXDpWc1phhtcfK',
     *       type: 'service_account',
     *     },
     *   });
     * ```
     */
    create(e, n) {
      const { betas: s, ...i } = e;
      return this._client.post("/v1/organizations/federation_rules?beta=true", {
        body: i,
        ...n,
        headers: p([
          { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * Retrieve a federation rule by its ID (`fdrl_...`).
     *
     * @example
     * ```ts
     * const betaFederationRule =
     *   await client.beta.organization.federation.rules.retrieve(
     *     'federation_rule_id',
     *   );
     * ```
     */
    retrieve(e, n = {}, s) {
      const { betas: i } = n ?? {};
      return this._client.get(_`/v1/organizations/federation_rules/${e}?beta=true`, {
        ...s,
        headers: p([
          { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * Partially update a federation rule.
     *
     * `issuer_id` is immutable. `match` and `target` are replaced as whole objects
     * when set. Referenced service accounts and workspaces must exist in your
     * organization; invalid references are rejected with a 400 error. Archived rules
     * cannot be updated; this returns 400. Create a new rule instead. Rules on
     * well-known shared issuers (GitHub Actions, GitLab, Buildkite, Terraform Cloud,
     * Google) must constrain tenant identity via an identity-bearing claim, a
     * tenant-pinning subject prefix (such as `repo:YOUR_ORG/...`), or a CEL condition
     * referencing one of those identity claims (e.g. `claims.repository_owner`). On
     * these issuers the requirement is re-checked on every update; if an existing
     * rule's stored match does not yet constrain tenant identity, any update (even a
     * rename or description change) must also supply a conforming `match` in the same
     * request. OAuth callers may only manage rules whose `oauth_scope` is
     * `workspace:developer` or `workspace:inference`; other scopes require a Console
     * session.
     *
     * @example
     * ```ts
     * const betaFederationRule =
     *   await client.beta.organization.federation.rules.update(
     *     'federation_rule_id',
     *   );
     * ```
     */
    update(e, n, s) {
      const { betas: i, ...a } = n;
      return this._client.post(_`/v1/organizations/federation_rules/${e}?beta=true`, {
        body: a,
        ...s,
        headers: p([
          { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * List federation rules in your organization.
     *
     * Optionally filter by issuer with `issuer_id`. Archived rules are excluded unless
     * `include_archived=true`.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaFederationRule of client.beta.organization.federation.rules.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { betas: s, ...i } = e ?? {};
      return this._client.getAPIList("/v1/organizations/federation_rules?beta=true", L, {
        query: i,
        ...n,
        headers: p([
          { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * Archive a federation rule.
     *
     * Token exchange through this rule stops immediately. Idempotent; re-archiving
     * returns the rule with its original `archived_at`. Archiving clears the rule's
     * workspace targeting (`workspace_id` and `workspace_ids` are emptied). Tokens
     * already minted before archive remain valid until they expire. OAuth callers may
     * only manage rules whose `oauth_scope` is `workspace:developer` or
     * `workspace:inference`; other scopes require a Console session.
     *
     * @example
     * ```ts
     * const betaFederationRule =
     *   await client.beta.organization.federation.rules.archive(
     *     'federation_rule_id',
     *   );
     * ```
     */
    archive(e, n = {}, s) {
      const { betas: i } = n ?? {};
      return this._client.post(_`/v1/organizations/federation_rules/${e}/archive?beta=true`, {
        ...s,
        headers: p([
          { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Workspaces = _o, r;
})(), yo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.issuers = new mo(this._client), this.rules = new wo(this._client);
    }
  }
  return r.Issuers = mo, r.Rules = wo, r;
})();
let bo = class extends I {
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * List the workspaces a service account is a member of.
   *
   * Each entry includes the service account's `workspace_role` in that workspace.
   * Use `limit` and the `next_page` cursor to paginate. When the service account has
   * no explicit default-workspace membership, the implicit (`implicit: true`)
   * membership is returned as the first entry on the first page; with `limit=1` the
   * first page may return up to 2 entries (the implicit entry plus one explicit
   * membership) so a pagination cursor can be derived. Memberships are returned only
   * while the service account is active. Without a `page` cursor, an archived
   * service account returns an empty list. A `page` cursor that does not match an
   * active membership returns a 400 invalid-request error. A cursor stops matching
   * when the membership is removed, the workspace is deleted, or the service account
   * is archived. Restart pagination from the first page to recover.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaServiceAccountWorkspaceMember of client.beta.organization.serviceAccounts.workspaces.list(
   *   'service_account_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, ...i } = e ?? {};
    return this._client.getAPIList(_`/v1/organizations/service_accounts/${t}/workspaces?beta=true`, L, {
      query: i,
      ...n,
      headers: p([
        { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Add a service account to a workspace with the given `workspace_role`.
   *
   * Mirror of `POST /workspaces/{workspace_id}/service_accounts`, addressed from the
   * service-account side; both create the same membership. If the service account is
   * already an explicit member of the workspace, its `workspace_role` is replaced
   * with the value supplied here. Archived workspaces return 400. Archived service
   * accounts cannot be added and are rejected.
   *
   * @example
   * ```ts
   * const betaServiceAccountWorkspaceMember =
   *   await client.beta.organization.serviceAccounts.workspaces.add(
   *     'service_account_id',
   *     {
   *       workspace_id: 'workspace_id',
   *       workspace_role: 'workspace_admin',
   *     },
   *   );
   * ```
   */
  add(t, e, n) {
    const { betas: s, ...i } = e;
    return this._client.post(_`/v1/organizations/service_accounts/${t}/workspaces?beta=true`, {
      body: i,
      ...n,
      headers: p([
        { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Remove a service account from a workspace.
   *
   * Mirror of
   * `DELETE /workspaces/{workspace_id}/service_accounts/{service_account_id}`,
   * addressed from the service-account side. Removal is idempotent (returns 200 even
   * if the membership was already removed). A DELETE against the implicit
   * default-workspace membership returns 200 but is a no-op and the membership
   * persists; deleting an explicit default-workspace row reverts to the implicit
   * `workspace_user` membership. Archived workspaces return 400.
   *
   * @example
   * ```ts
   * const workspace =
   *   await client.beta.organization.serviceAccounts.workspaces.remove(
   *     'workspace_id',
   *     { service_account_id: 'service_account_id' },
   *   );
   * ```
   */
  remove(t, e, n) {
    const { service_account_id: s, betas: i } = e;
    return this._client.delete(_`/v1/organizations/service_accounts/${s}/workspaces/${t}?beta=true`, {
      ...n,
      headers: p([
        { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
};
var Eo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.workspaces = new bo(this._client);
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * Create a service account.
     *
     * A service account is a named workload identity that federation rules target.
     * `organization_role` is `developer` (default) or `admin`; a rule may only be
     * created or retargeted to grant `org:admin` scope when the target's
     * `organization_role` is `admin`. Creating an `admin`-role service account
     * requires an interactive credential (a user OAuth token or a Console session) — a
     * workload may only create `developer`-role service accounts.
     *
     * @example
     * ```ts
     * const betaServiceAccount =
     *   await client.beta.organization.serviceAccounts.create({
     *     name: 'ci-deploy-bot',
     *   });
     * ```
     */
    create(e, n) {
      const { betas: s, ...i } = e;
      return this._client.post("/v1/organizations/service_accounts?beta=true", {
        body: i,
        ...n,
        headers: p([
          { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * Retrieve a service account by its ID (`svac_...`).
     *
     * @example
     * ```ts
     * const betaServiceAccount =
     *   await client.beta.organization.serviceAccounts.retrieve(
     *     'service_account_id',
     *   );
     * ```
     */
    retrieve(e, n = {}, s) {
      const { betas: i } = n ?? {};
      return this._client.get(_`/v1/organizations/service_accounts/${e}?beta=true`, {
        ...s,
        headers: p([
          { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * Update a service account.
     *
     * Only `description` and `organization_role` are mutable; `name` cannot be
     * changed. Archived service accounts cannot be updated; this returns 400. Setting
     * `organization_role` to `admin` (even when unchanged) requires an interactive
     * credential (a user OAuth token or a Console session).
     *
     * @example
     * ```ts
     * const betaServiceAccount =
     *   await client.beta.organization.serviceAccounts.update(
     *     'service_account_id',
     *   );
     * ```
     */
    update(e, n, s) {
      const { betas: i, ...a } = n;
      return this._client.post(_`/v1/organizations/service_accounts/${e}?beta=true`, {
        body: a,
        ...s,
        headers: p([
          { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * List service accounts in the caller's organization.
     *
     * Results are ordered by creation time, newest first. Use `limit` and the
     * `next_page` cursor to paginate; set `include_archived=true` to include archived
     * service accounts.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaServiceAccount of client.beta.organization.serviceAccounts.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { betas: s, ...i } = e ?? {};
      return this._client.getAPIList("/v1/organizations/service_accounts?beta=true", L, {
        query: i,
        ...n,
        headers: p([
          { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * **Requires an OAuth access token with the `org:admin` scope**, from
     * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
     * API keys are not accepted. See
     * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
     *
     * Archive a service account.
     *
     * Idempotent; re-archiving returns the service account with its original
     * `archived_at`. Rejected with 400 if any live (non-archived) federation rule
     * still targets this service account, same as issuer archival; archive those rules
     * first or change their target to another service account.
     *
     * @example
     * ```ts
     * const betaServiceAccount =
     *   await client.beta.organization.serviceAccounts.archive(
     *     'service_account_id',
     *   );
     * ```
     */
    archive(e, n = {}, s) {
      const { betas: i } = n ?? {};
      return this._client.post(_`/v1/organizations/service_accounts/${e}/archive?beta=true`, {
        ...s,
        headers: p([
          { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Workspaces = bo, r;
})();
class So extends I {
  /**
   * Get Workspace Member
   *
   * @example
   * ```ts
   * const betaWorkspaceMember =
   *   await client.beta.organization.workspaces.members.retrieve(
   *     'user_id',
   *     { workspace_id: 'workspace_id' },
   *   );
   * ```
   */
  retrieve(t, e, n) {
    const { workspace_id: s } = e;
    return this._client.get(_`/v1/organizations/workspaces/${s}/members/${t}?beta=true`, n);
  }
  /**
   * Update Workspace Member
   *
   * @example
   * ```ts
   * const betaWorkspaceMember =
   *   await client.beta.organization.workspaces.members.update(
   *     'user_id',
   *     {
   *       workspace_id: 'workspace_id',
   *       workspace_role: 'workspace_admin',
   *     },
   *   );
   * ```
   */
  update(t, e, n) {
    const { workspace_id: s, ...i } = e;
    return this._client.post(_`/v1/organizations/workspaces/${s}/members/${t}?beta=true`, {
      body: i,
      ...n
    });
  }
  /**
   * List Workspace Members
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaWorkspaceMember of client.beta.organization.workspaces.members.list(
   *   'workspace_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    return this._client.getAPIList(_`/v1/organizations/workspaces/${t}/members?beta=true`, Oe, { query: e, ...n });
  }
  /**
   * Create Workspace Member
   *
   * @example
   * ```ts
   * const betaWorkspaceMember =
   *   await client.beta.organization.workspaces.members.add(
   *     'workspace_id',
   *     {
   *       user_id: 'user_01WCz1FkmYMm4gnmykNKUu3Q',
   *       workspace_role: 'workspace_admin',
   *     },
   *   );
   * ```
   */
  add(t, e, n) {
    return this._client.post(_`/v1/organizations/workspaces/${t}/members?beta=true`, {
      body: e,
      ...n
    });
  }
  /**
   * Delete Workspace Member
   *
   * @example
   * ```ts
   * const member =
   *   await client.beta.organization.workspaces.members.remove(
   *     'user_id',
   *     { workspace_id: 'workspace_id' },
   *   );
   * ```
   */
  remove(t, e, n) {
    const { workspace_id: s } = e;
    return this._client.delete(_`/v1/organizations/workspaces/${s}/members/${t}?beta=true`, n);
  }
}
class ko extends I {
  /**
   * List rate-limit overrides configured for a workspace.
   *
   * Returns only the groups and limiter types that have a workspace-level override.
   * Groups without overrides inherit the organization limits and are not listed; use
   * `GET /v1/organizations/rate_limits` to see those.
   *
   * When `limit` is omitted, every matching entry is returned in a single page; when
   * `limit` truncates the result, follow `next_page` to fetch the remaining entries.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaWorkspaceRateLimit of client.beta.organization.workspaces.rateLimits.list(
   *   'workspace_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    return this._client.getAPIList(_`/v1/organizations/workspaces/${t}/rate_limits?beta=true`, L, { query: e, ...n });
  }
}
class vo extends I {
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Retrieve a service account's membership in a workspace.
   *
   * Returns the membership record, including the service account's `workspace_role`
   * in this workspace. Archived workspaces return 400. For the default workspace,
   * returns the implicit (`implicit: true`) membership when no explicit membership
   * exists; an explicitly added membership is returned with its assigned role. An
   * archived service account returns 404.
   *
   * @example
   * ```ts
   * const betaServiceAccountWorkspaceMember =
   *   await client.beta.organization.workspaces.serviceAccounts.retrieve(
   *     'service_account_id',
   *     { workspace_id: 'workspace_id' },
   *   );
   * ```
   */
  retrieve(t, e, n) {
    const { workspace_id: s, betas: i } = e;
    return this._client.get(_`/v1/organizations/workspaces/${s}/service_accounts/${t}?beta=true`, {
      ...n,
      headers: p([
        { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Change a service account's role in a workspace.
   *
   * The new `workspace_role` replaces the current one. Only explicit memberships can
   * be updated; to set a role on the implicit default-workspace membership, add the
   * service account explicitly with
   * `POST /workspaces/{workspace_id}/service_accounts`. Archived workspaces
   * return 400. Archived service accounts cannot be updated and are rejected.
   *
   * @example
   * ```ts
   * const betaServiceAccountWorkspaceMember =
   *   await client.beta.organization.workspaces.serviceAccounts.update(
   *     'service_account_id',
   *     {
   *       workspace_id: 'workspace_id',
   *       workspace_role: 'workspace_admin',
   *     },
   *   );
   * ```
   */
  update(t, e, n) {
    const { workspace_id: s, betas: i, ...a } = e;
    return this._client.post(_`/v1/organizations/workspaces/${s}/service_accounts/${t}?beta=true`, {
      body: a,
      ...n,
      headers: p([
        { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * List the service accounts that are members of a workspace.
   *
   * Each entry includes the service account's `workspace_role`. Use `limit` and the
   * `next_page` cursor to paginate. Archived workspaces return 400; use
   * `GET /service_accounts/{id}/workspaces` to audit memberships of an archived
   * workspace. The implicit default-workspace membership is not included in this
   * list. Memberships of archived service accounts are omitted from the results.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaServiceAccountWorkspaceMember of client.beta.organization.workspaces.serviceAccounts.list(
   *   'workspace_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, ...i } = e ?? {};
    return this._client.getAPIList(_`/v1/organizations/workspaces/${t}/service_accounts?beta=true`, L, {
      query: i,
      ...n,
      headers: p([
        { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Add a service account to a workspace with the given `workspace_role`.
   *
   * The role determines what the service account can do in the workspace and which
   * workspace-scoped permissions it can be granted when authenticating through
   * federation. Every service account is already an implicit `workspace_user` member
   * of the default workspace; adding it explicitly assigns a chosen role. If the
   * service account is already an explicit member of the workspace, its
   * `workspace_role` is replaced with the value supplied here. Archived workspaces
   * return 400. Archived service accounts cannot be added and are rejected.
   *
   * @example
   * ```ts
   * const betaServiceAccountWorkspaceMember =
   *   await client.beta.organization.workspaces.serviceAccounts.add(
   *     'workspace_id',
   *     {
   *       service_account_id: 'service_account_id',
   *       workspace_role: 'workspace_admin',
   *     },
   *   );
   * ```
   */
  add(t, e, n) {
    const { betas: s, ...i } = e;
    return this._client.post(_`/v1/organizations/workspaces/${t}/service_accounts?beta=true`, {
      body: i,
      ...n,
      headers: p([
        { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * **Requires an OAuth access token with the `org:admin` scope**, from
   * `ant auth login --scope org:admin` or a workload identity federation rule; Admin
   * API keys are not accepted. See
   * [Manage WIF with the Admin API](/docs/en/manage-claude/wif-admin-api).
   *
   * Remove a service account from a workspace.
   *
   * Removal is idempotent (returns 200 even if the membership was already removed).
   * A DELETE against the implicit default-workspace membership returns 200 but is a
   * no-op and the membership persists; deleting an explicit default-workspace row
   * reverts to the implicit `workspace_user` membership. Archived workspaces
   * return 400.
   *
   * @example
   * ```ts
   * const serviceAccount =
   *   await client.beta.organization.workspaces.serviceAccounts.remove(
   *     'service_account_id',
   *     { workspace_id: 'workspace_id' },
   *   );
   * ```
   */
  remove(t, e, n) {
    const { workspace_id: s, betas: i } = e;
    return this._client.delete(_`/v1/organizations/workspaces/${s}/service_accounts/${t}?beta=true`, {
      ...n,
      headers: p([
        { ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
var To = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.rateLimits = new ko(this._client), this.members = new So(this._client), this.serviceAccounts = new vo(this._client);
    }
    /**
     * Create Workspace
     *
     * @example
     * ```ts
     * const betaWorkspace =
     *   await client.beta.organization.workspaces.create({
     *     name: 'x',
     *   });
     * ```
     */
    create(e, n) {
      const { betas: s, ...i } = e;
      return this._client.post("/v1/organizations/workspaces?beta=true", {
        body: i,
        ...n,
        headers: p([
          { ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0 },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Get Workspace
     *
     * @example
     * ```ts
     * const betaWorkspace =
     *   await client.beta.organization.workspaces.retrieve(
     *     'workspace_id',
     *   );
     * ```
     */
    retrieve(e, n) {
      return this._client.get(_`/v1/organizations/workspaces/${e}?beta=true`, n);
    }
    /**
     * Update Workspace
     *
     * @example
     * ```ts
     * const betaWorkspace =
     *   await client.beta.organization.workspaces.update(
     *     'workspace_id',
     *   );
     * ```
     */
    update(e, n, s) {
      return this._client.post(_`/v1/organizations/workspaces/${e}?beta=true`, {
        body: n,
        ...s
      });
    }
    /**
     * List Workspaces
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaWorkspace of client.beta.organization.workspaces.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      return this._client.getAPIList("/v1/organizations/workspaces?beta=true", Oe, {
        query: e,
        ...n
      });
    }
    /**
     * Archive Workspace
     *
     * @example
     * ```ts
     * const betaWorkspace =
     *   await client.beta.organization.workspaces.archive(
     *     'workspace_id',
     *   );
     * ```
     */
    archive(e, n) {
      return this._client.post(_`/v1/organizations/workspaces/${e}/archive?beta=true`, n);
    }
  }
  return r.RateLimits = ko, r.Members = So, r.ServiceAccounts = vo, r;
})(), xo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.apiKeys = new lo(this._client), this.externalKeys = new ho(this._client), this.federation = new yo(this._client), this.invites = new fo(this._client), this.serviceAccounts = new Eo(this._client), this.users = new go(this._client), this.workspaces = new To(this._client), this.rateLimits = new po(this._client), this.complianceSettings = new uo(this._client);
    }
    /**
     * Retrieve information about the organization associated with the authenticated
     * API key.
     *
     * @example
     * ```ts
     * const betaOrganization =
     *   await client.beta.organization.retrieve();
     * ```
     */
    retrieve(e) {
      return this._client.get("/v1/organizations/me?beta=true", e);
    }
  }
  return r.APIKeys = lo, r.ExternalKeys = ho, r.Federation = yo, r.Invites = fo, r.ServiceAccounts = Eo, r.Users = go, r.Workspaces = To, r.RateLimits = po, r.ComplianceSettings = uo, r;
})(), Ao = /* @__PURE__ */ (() => {
  class r extends I {
    /**
     * List Events
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaManagedAgentsSessionEvent of client.beta.sessions.events.list(
     *   'sesn_011CZkZAtmR3yMPDzynEDxu7',
     * )) {
     *   // ...
     * }
     * ```
     */
    list(e, n = {}, s) {
      const { betas: i, workspace_id: a, ...o } = n ?? {};
      return this._client.getAPIList(_`/v1/sessions/${e}/events?beta=true`, L, {
        query: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Send Events
     *
     * @example
     * ```ts
     * const betaManagedAgentsSendSessionEvents =
     *   await client.beta.sessions.events.send(
     *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
     *     {
     *       events: [
     *         {
     *           content: [
     *             {
     *               text: 'Where is my order #1234?',
     *               type: 'text',
     *             },
     *           ],
     *           type: 'user.message',
     *         },
     *       ],
     *     },
     *   );
     * ```
     */
    send(e, n, s) {
      const { betas: i, workspace_id: a, ...o } = n;
      return this._client.post(_`/v1/sessions/${e}/events?beta=true`, {
        body: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Stream Events
     *
     * @example
     * ```ts
     * const betaManagedAgentsStreamSessionEvents =
     *   await client.beta.sessions.events.stream(
     *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
     *   );
     * ```
     */
    stream(e, n = {}, s) {
      const { betas: i, workspace_id: a, ...o } = n ?? {};
      return this._client.get(_`/v1/sessions/${e}/events/stream?beta=true`, {
        query: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ]),
        stream: !0
      });
    }
    /**
     * Attach to a session and dispatch every incoming `agent.tool_use` and
     * `agent.custom_tool_use` event to a local tool registry, sending the matching
     * result back (`user.tool_result` / `user.custom_tool_result`). The
     * sessions-side counterpart to `client.beta.messages.toolRunner`: yields one
     * entry per completed tool call so callers can observe each dispatch (and
     * `break` to abort cleanly).
     *
     * @example
     * ```ts
     * import { betaAgentToolset20260401 } from '@anthropic-ai/sdk/tools/agent-toolset/node';
     *
     * for await (const call of client.beta.sessions.events.toolRunner(work.data.id, {
     *   tools: [...betaAgentToolset20260401({ workdir }), myTool],
     * })) {
     *   console.log(`${call.name} -> ${call.isError ? 'error' : 'ok'}`);
     * }
     * ```
     */
    toolRunner(e, n) {
      return new qs(e, { ...n, client: this._client });
    }
  }
  return r.SessionToolRunner = qs, r;
})();
class Ro extends I {
  /**
   * Get Session Resource
   *
   * @example
   * ```ts
   * const resource =
   *   await client.beta.sessions.resources.retrieve(
   *     'sesrsc_011CZkZBJq5dWxk9fVLNcPht',
   *     { session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7' },
   *   );
   * ```
   */
  retrieve(t, e, n) {
    const { session_id: s, betas: i, workspace_id: a } = e;
    return this._client.get(_`/v1/sessions/${s}/resources/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Update Session Resource
   *
   * @example
   * ```ts
   * const resource =
   *   await client.beta.sessions.resources.update(
   *     'sesrsc_011CZkZBJq5dWxk9fVLNcPht',
   *     {
   *       session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *       authorization_token: 'ghp_exampletoken',
   *     },
   *   );
   * ```
   */
  update(t, e, n) {
    const { session_id: s, betas: i, workspace_id: a, ...o } = e;
    return this._client.post(_`/v1/sessions/${s}/resources/${t}?beta=true`, {
      body: o,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List Session Resources
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsSessionResource of client.beta.sessions.resources.list(
   *   'sesn_011CZkZAtmR3yMPDzynEDxu7',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, workspace_id: i, ...a } = e ?? {};
    return this._client.getAPIList(_`/v1/sessions/${t}/resources?beta=true`, L, {
      query: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Delete Session Resource
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeleteSessionResource =
   *   await client.beta.sessions.resources.delete(
   *     'sesrsc_011CZkZBJq5dWxk9fVLNcPht',
   *     { session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7' },
   *   );
   * ```
   */
  delete(t, e, n) {
    const { session_id: s, betas: i, workspace_id: a } = e;
    return this._client.delete(_`/v1/sessions/${s}/resources/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Add Session Resource
   *
   * @example
   * ```ts
   * const betaManagedAgentsFileResource =
   *   await client.beta.sessions.resources.add(
   *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *     {
   *       file_id: 'file_011CNha8iCJcU1wXNR6q4V8w',
   *       type: 'file',
   *     },
   *   );
   * ```
   */
  add(t, e, n) {
    const { betas: s, workspace_id: i, ...a } = e;
    return this._client.post(_`/v1/sessions/${t}/resources?beta=true`, {
      body: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
class Io extends I {
  /**
   * List Session Thread Events
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsSessionEvent of client.beta.sessions.threads.events.list(
   *   'sthr_011CZkZVWa6oIjw0rgXZpnBt',
   *   { session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7' },
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e, n) {
    const { session_id: s, betas: i, workspace_id: a, ...o } = e;
    return this._client.getAPIList(_`/v1/sessions/${s}/threads/${t}/events?beta=true`, L, {
      query: o,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Stream Session Thread Events
   *
   * @example
   * ```ts
   * const betaManagedAgentsStreamSessionThreadEvents =
   *   await client.beta.sessions.threads.events.stream(
   *     'sthr_011CZkZVWa6oIjw0rgXZpnBt',
   *     { session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7' },
   *   );
   * ```
   */
  stream(t, e, n) {
    const { session_id: s, betas: i, workspace_id: a, ...o } = e;
    return this._client.get(_`/v1/sessions/${s}/threads/${t}/stream?beta=true`, {
      query: o,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ]),
      stream: !0
    });
  }
}
var No = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.events = new Io(this._client);
    }
    /**
     * Get Session Thread
     *
     * @example
     * ```ts
     * const betaManagedAgentsSessionThread =
     *   await client.beta.sessions.threads.retrieve(
     *     'sthr_011CZkZVWa6oIjw0rgXZpnBt',
     *     { session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7' },
     *   );
     * ```
     */
    retrieve(e, n, s) {
      const { session_id: i, betas: a, workspace_id: o } = n;
      return this._client.get(_`/v1/sessions/${i}/threads/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString(),
            ...o != null ? { "anthropic-workspace-id": o } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * List Session Threads
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaManagedAgentsSessionThread of client.beta.sessions.threads.list(
     *   'sesn_011CZkZAtmR3yMPDzynEDxu7',
     * )) {
     *   // ...
     * }
     * ```
     */
    list(e, n = {}, s) {
      const { betas: i, workspace_id: a, ...o } = n ?? {};
      return this._client.getAPIList(_`/v1/sessions/${e}/threads?beta=true`, L, {
        query: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Archive Session Thread
     *
     * @example
     * ```ts
     * const betaManagedAgentsSessionThread =
     *   await client.beta.sessions.threads.archive(
     *     'sthr_011CZkZVWa6oIjw0rgXZpnBt',
     *     { session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7' },
     *   );
     * ```
     */
    archive(e, n, s) {
      const { session_id: i, betas: a, workspace_id: o } = n;
      return this._client.post(_`/v1/sessions/${i}/threads/${e}/archive?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString(),
            ...o != null ? { "anthropic-workspace-id": o } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Events = Io, r;
})(), Oo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.events = new Ao(this._client), this.resources = new Ro(this._client), this.threads = new No(this._client);
    }
    /**
     * Create Session
     *
     * @example
     * ```ts
     * const betaManagedAgentsSession =
     *   await client.beta.sessions.create({
     *     agent: 'agent_011CZkYpogX7uDKUyvBTophP',
     *     environment_id: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
     *   });
     * ```
     */
    create(e, n) {
      const { betas: s, workspace_id: i, ...a } = e;
      return this._client.post("/v1/sessions?beta=true", {
        body: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Get Session
     *
     * @example
     * ```ts
     * const betaManagedAgentsSession =
     *   await client.beta.sessions.retrieve(
     *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
     *   );
     * ```
     */
    retrieve(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.get(_`/v1/sessions/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Update Session
     *
     * @example
     * ```ts
     * const betaManagedAgentsSession =
     *   await client.beta.sessions.update(
     *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
     *   );
     * ```
     */
    update(e, n, s) {
      const { betas: i, workspace_id: a, ...o } = n;
      return this._client.post(_`/v1/sessions/${e}?beta=true`, {
        body: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * List Sessions
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaManagedAgentsSession of client.beta.sessions.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { betas: s, workspace_id: i, ...a } = e ?? {};
      return this._client.getAPIList("/v1/sessions?beta=true", lp, {
        query: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Delete Session
     *
     * @example
     * ```ts
     * const betaManagedAgentsDeletedSession =
     *   await client.beta.sessions.delete(
     *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
     *   );
     * ```
     */
    delete(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.delete(_`/v1/sessions/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Archive Session
     *
     * @example
     * ```ts
     * const betaManagedAgentsSession =
     *   await client.beta.sessions.archive(
     *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
     *   );
     * ```
     */
    archive(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.post(_`/v1/sessions/${e}/archive?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Events = Ao, r.Resources = Ro, r.Threads = No, r;
})();
let Mo = class extends I {
  /**
   * Create Skill Version
   *
   * @example
   * ```ts
   * const betaSkillVersion =
   *   await client.beta.skills.versions.create('skill_id', {
   *     files: [fs.createReadStream('path/to/file')],
   *   });
   * ```
   */
  create(t, e, n) {
    const { betas: s, workspace_id: i, ...a } = e;
    return this._client.post(_`/v1/skills/${t}/versions?beta=true`, Wt({
      body: a,
      ...n,
      headers: p([
        {
          ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0,
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    }, this._client, !1));
  }
  /**
   * Get Skill Version
   *
   * @example
   * ```ts
   * const betaSkillVersion =
   *   await client.beta.skills.versions.retrieve('version', {
   *     skill_id: 'skill_id',
   *   });
   * ```
   */
  retrieve(t, e, n) {
    const { skill_id: s, betas: i, workspace_id: a } = e;
    return this._client.get(_`/v1/skills/${s}/versions/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0,
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List Skill Versions
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaSkillVersion of client.beta.skills.versions.list(
   *   'skill_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, workspace_id: i, ...a } = e ?? {};
    return this._client.getAPIList(_`/v1/skills/${t}/versions?beta=true`, L, {
      query: a,
      ...n,
      headers: p([
        {
          ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0,
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Delete Skill Version
   *
   * @example
   * ```ts
   * const betaDeletedSkillVersion =
   *   await client.beta.skills.versions.delete('version', {
   *     skill_id: 'skill_id',
   *   });
   * ```
   */
  delete(t, e, n) {
    const { skill_id: s, betas: i, workspace_id: a } = e;
    return this._client.delete(_`/v1/skills/${s}/versions/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0,
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Download a skill version's content as a zip archive.
   *
   * @example
   * ```ts
   * const response = await client.beta.skills.versions.download(
   *   'version',
   *   { skill_id: 'skill_id' },
   * );
   *
   * const content = await response.blob();
   * console.log(content);
   * ```
   */
  download(t, e, n) {
    const { skill_id: s, betas: i, workspace_id: a } = e;
    return this._client.get(_`/v1/skills/${s}/versions/${t}/content?beta=true`, {
      ...n,
      headers: p([
        {
          Accept: "application/binary",
          ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0,
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ]),
      __binaryResponse: !0
    });
  }
};
var Co = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.versions = new Mo(this._client);
    }
    /**
     * Create Skill
     *
     * @example
     * ```ts
     * const betaSkill = await client.beta.skills.create({
     *   files: [fs.createReadStream('path/to/file')],
     * });
     * ```
     */
    create(e, n) {
      const { betas: s, workspace_id: i, ...a } = e;
      return this._client.post("/v1/skills?beta=true", Wt({
        body: a,
        ...n,
        headers: p([
          {
            ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0,
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      }, this._client, !1));
    }
    /**
     * Get Skill
     *
     * @example
     * ```ts
     * const betaSkill = await client.beta.skills.retrieve(
     *   'skill_id',
     * );
     * ```
     */
    retrieve(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.get(_`/v1/skills/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0,
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * List Skills
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaSkill of client.beta.skills.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { betas: s, workspace_id: i, ...a } = e ?? {};
      return this._client.getAPIList("/v1/skills?beta=true", L, {
        query: a,
        ...n,
        headers: p([
          {
            ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0,
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Delete Skill
     *
     * @example
     * ```ts
     * const betaDeletedSkill = await client.beta.skills.delete(
     *   'skill_id',
     * );
     * ```
     */
    delete(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.delete(_`/v1/skills/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            ...(i == null ? void 0 : i.toString()) != null ? { "anthropic-beta": i == null ? void 0 : i.toString() } : void 0,
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Versions = Mo, r;
})();
class Lo extends I {
  /**
   * The Tunnels API is in research preview. It requires the
   * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
   * deprecation period. It supersedes the Admin API endpoints at
   * `/v1/organizations/tunnels`, which remain available during a migration window.
   *
   * Registers a public CA certificate on a tunnel. Anthropic verifies the gateway's
   * server certificate against this CA when it terminates the inner TLS session. A
   * tunnel holds at most two non-archived certificates.
   *
   * @example
   * ```ts
   * const betaTunnelCertificate =
   *   await client.beta.tunnels.certificates.create(
   *     'tunnel_id',
   *     { ca_certificate_pem: 'ca_certificate_pem' },
   *   );
   * ```
   */
  create(t, e, n) {
    const { betas: s, workspace_id: i, ...a } = e;
    return this._client.post(_`/v1/tunnels/${t}/certificates?beta=true`, {
      body: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "mcp-tunnels-2026-06-22"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * The Tunnels API is in research preview. It requires the
   * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
   * deprecation period. It supersedes the Admin API endpoints at
   * `/v1/organizations/tunnels`, which remain available during a migration window.
   *
   * Fetches a tunnel certificate by ID.
   *
   * @example
   * ```ts
   * const betaTunnelCertificate =
   *   await client.beta.tunnels.certificates.retrieve(
   *     'certificate_id',
   *     { tunnel_id: 'tunnel_id' },
   *   );
   * ```
   */
  retrieve(t, e, n) {
    const { tunnel_id: s, betas: i, workspace_id: a } = e;
    return this._client.get(_`/v1/tunnels/${s}/certificates/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "mcp-tunnels-2026-06-22"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * The Tunnels API is in research preview. It requires the
   * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
   * deprecation period. It supersedes the Admin API endpoints at
   * `/v1/organizations/tunnels`, which remain available during a migration window.
   *
   * Lists the certificates registered on a tunnel. Archived certificates are
   * excluded unless include_archived is set.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaTunnelCertificate of client.beta.tunnels.certificates.list(
   *   'tunnel_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, workspace_id: i, ...a } = e ?? {};
    return this._client.getAPIList(_`/v1/tunnels/${t}/certificates?beta=true`, L, {
      query: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "mcp-tunnels-2026-06-22"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * The Tunnels API is in research preview. It requires the
   * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
   * deprecation period. It supersedes the Admin API endpoints at
   * `/v1/organizations/tunnels`, which remain available during a migration window.
   *
   * Archives a tunnel certificate, removing it from the set Anthropic trusts for the
   * tunnel. The certificate record is retained. Archiving the last non-archived
   * certificate is permitted; the tunnel rejects MCP traffic until a new certificate
   * is added.
   *
   * @example
   * ```ts
   * const betaTunnelCertificate =
   *   await client.beta.tunnels.certificates.archive(
   *     'certificate_id',
   *     { tunnel_id: 'tunnel_id' },
   *   );
   * ```
   */
  archive(t, e, n) {
    const { tunnel_id: s, betas: i, workspace_id: a } = e;
    return this._client.post(_`/v1/tunnels/${s}/certificates/${t}/archive?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "mcp-tunnels-2026-06-22"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
var Po = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.certificates = new Lo(this._client);
    }
    /**
     * The Tunnels API is in research preview. It requires the
     * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
     * deprecation period. It supersedes the Admin API endpoints at
     * `/v1/organizations/tunnels`, which remain available during a migration window.
     *
     * Creates a tunnel. Creation allocates a fresh hostname and provisions the tunnel;
     * it is not idempotent. The new tunnel rejects MCP traffic until at least one CA
     * certificate is added.
     *
     * @example
     * ```ts
     * const betaTunnel = await client.beta.tunnels.create();
     * ```
     */
    create(e, n) {
      const { betas: s, workspace_id: i, ...a } = e;
      return this._client.post("/v1/tunnels?beta=true", {
        body: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "mcp-tunnels-2026-06-22"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * The Tunnels API is in research preview. It requires the
     * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
     * deprecation period. It supersedes the Admin API endpoints at
     * `/v1/organizations/tunnels`, which remain available during a migration window.
     *
     * Fetches a tunnel by ID.
     *
     * @example
     * ```ts
     * const betaTunnel = await client.beta.tunnels.retrieve(
     *   'tunnel_id',
     * );
     * ```
     */
    retrieve(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.get(_`/v1/tunnels/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "mcp-tunnels-2026-06-22"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * The Tunnels API is in research preview. It requires the
     * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
     * deprecation period. It supersedes the Admin API endpoints at
     * `/v1/organizations/tunnels`, which remain available during a migration window.
     *
     * Lists tunnels. Results are ordered by creation time, newest first; archived
     * tunnels are excluded unless include_archived is set.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaTunnel of client.beta.tunnels.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { betas: s, workspace_id: i, ...a } = e ?? {};
      return this._client.getAPIList("/v1/tunnels?beta=true", L, {
        query: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "mcp-tunnels-2026-06-22"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * The Tunnels API is in research preview. It requires the
     * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
     * deprecation period. It supersedes the Admin API endpoints at
     * `/v1/organizations/tunnels`, which remain available during a migration window.
     *
     * Archives a tunnel. Archival is irreversible: every non-archived certificate on
     * the tunnel is archived in the same operation, the hostname is retired and never
     * re-allocated, and the tunnel token is invalidated. Retrying against an
     * already-archived tunnel returns the existing record unchanged.
     *
     * @example
     * ```ts
     * const betaTunnel = await client.beta.tunnels.archive(
     *   'tunnel_id',
     * );
     * ```
     */
    archive(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.post(_`/v1/tunnels/${e}/archive?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "mcp-tunnels-2026-06-22"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * The Tunnels API is in research preview. It requires the
     * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
     * deprecation period. It supersedes the Admin API endpoints at
     * `/v1/organizations/tunnels`, which remain available during a migration window.
     *
     * Reveals a tunnel's connector token. The value is fetched live on each call;
     * Anthropic does not store it. Repeated calls return the same value until the
     * token is rotated. Exposed as POST so the token does not appear in intermediary
     * access logs.
     *
     * @example
     * ```ts
     * const betaTunnelToken =
     *   await client.beta.tunnels.revealToken('tunnel_id');
     * ```
     */
    revealToken(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.post(_`/v1/tunnels/${e}/reveal_token?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "mcp-tunnels-2026-06-22"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * The Tunnels API is in research preview. It requires the
     * `anthropic-beta: mcp-tunnels-2026-06-22` header and may change without a
     * deprecation period. It supersedes the Admin API endpoints at
     * `/v1/organizations/tunnels`, which remain available during a migration window.
     *
     * Rotates a tunnel's connector token. Rotation invalidates the current token for
     * new connections and returns a fresh value; established connections are not
     * severed. A connector restarted after rotation must use the new value.
     *
     * @example
     * ```ts
     * const betaTunnelToken =
     *   await client.beta.tunnels.rotateToken('tunnel_id');
     * ```
     */
    rotateToken(e, n, s) {
      const { betas: i, workspace_id: a, ...o } = n;
      return this._client.post(_`/v1/tunnels/${e}/rotate_token?beta=true`, {
        body: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "mcp-tunnels-2026-06-22"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Certificates = Lo, r;
})();
class $o extends I {
  /**
   * Create Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsCredential =
   *   await client.beta.vaults.credentials.create(
   *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
   *     {
   *       auth: {
   *         token: 'bearer_exampletoken',
   *         mcp_server_url:
   *           'https://example-server.modelcontextprotocol.io/sse',
   *         type: 'static_bearer',
   *       },
   *     },
   *   );
   * ```
   */
  create(t, e, n) {
    const { betas: s, workspace_id: i, ...a } = e;
    return this._client.post(_`/v1/vaults/${t}/credentials?beta=true`, {
      body: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Get Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsCredential =
   *   await client.beta.vaults.credentials.retrieve(
   *     'vcrd_011CZkZEMt8gZan2iYOQfSkw',
   *     { vault_id: 'vlt_011CZkZDLs7fYzm1hXNPeRjv' },
   *   );
   * ```
   */
  retrieve(t, e, n) {
    const { vault_id: s, betas: i, workspace_id: a } = e;
    return this._client.get(_`/v1/vaults/${s}/credentials/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Update Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsCredential =
   *   await client.beta.vaults.credentials.update(
   *     'vcrd_011CZkZEMt8gZan2iYOQfSkw',
   *     { vault_id: 'vlt_011CZkZDLs7fYzm1hXNPeRjv' },
   *   );
   * ```
   */
  update(t, e, n) {
    const { vault_id: s, betas: i, workspace_id: a, ...o } = e;
    return this._client.post(_`/v1/vaults/${s}/credentials/${t}?beta=true`, {
      body: o,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List Credentials
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsCredential of client.beta.vaults.credentials.list(
   *   'vlt_011CZkZDLs7fYzm1hXNPeRjv',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { betas: s, workspace_id: i, ...a } = e ?? {};
    return this._client.getAPIList(_`/v1/vaults/${t}/credentials?beta=true`, L, {
      query: a,
      ...n,
      headers: p([
        {
          "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Delete Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeletedCredential =
   *   await client.beta.vaults.credentials.delete(
   *     'vcrd_011CZkZEMt8gZan2iYOQfSkw',
   *     { vault_id: 'vlt_011CZkZDLs7fYzm1hXNPeRjv' },
   *   );
   * ```
   */
  delete(t, e, n) {
    const { vault_id: s, betas: i, workspace_id: a } = e;
    return this._client.delete(_`/v1/vaults/${s}/credentials/${t}?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Archive Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsCredential =
   *   await client.beta.vaults.credentials.archive(
   *     'vcrd_011CZkZEMt8gZan2iYOQfSkw',
   *     { vault_id: 'vlt_011CZkZDLs7fYzm1hXNPeRjv' },
   *   );
   * ```
   */
  archive(t, e, n) {
    const { vault_id: s, betas: i, workspace_id: a } = e;
    return this._client.post(_`/v1/vaults/${s}/credentials/${t}/archive?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Validate Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsCredentialValidation =
   *   await client.beta.vaults.credentials.mcpOAuthValidate(
   *     'vcrd_011CZkZEMt8gZan2iYOQfSkw',
   *     { vault_id: 'vlt_011CZkZDLs7fYzm1hXNPeRjv' },
   *   );
   * ```
   */
  mcpOAuthValidate(t, e, n) {
    const { vault_id: s, betas: i, workspace_id: a } = e;
    return this._client.post(_`/v1/vaults/${s}/credentials/${t}/mcp_oauth_validate?beta=true`, {
      ...n,
      headers: p([
        {
          "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
          ...a != null ? { "anthropic-workspace-id": a } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
var Fo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.credentials = new $o(this._client);
    }
    /**
     * Create Vault
     *
     * @example
     * ```ts
     * const betaManagedAgentsVault =
     *   await client.beta.vaults.create({
     *     display_name: 'Example vault',
     *   });
     * ```
     */
    create(e, n) {
      const { betas: s, workspace_id: i, ...a } = e;
      return this._client.post("/v1/vaults?beta=true", {
        body: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Get Vault
     *
     * @example
     * ```ts
     * const betaManagedAgentsVault =
     *   await client.beta.vaults.retrieve(
     *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
     *   );
     * ```
     */
    retrieve(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.get(_`/v1/vaults/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Update Vault
     *
     * @example
     * ```ts
     * const betaManagedAgentsVault =
     *   await client.beta.vaults.update(
     *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
     *   );
     * ```
     */
    update(e, n, s) {
      const { betas: i, workspace_id: a, ...o } = n;
      return this._client.post(_`/v1/vaults/${e}?beta=true`, {
        body: o,
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * List Vaults
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaManagedAgentsVault of client.beta.vaults.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { betas: s, workspace_id: i, ...a } = e ?? {};
      return this._client.getAPIList("/v1/vaults?beta=true", L, {
        query: a,
        ...n,
        headers: p([
          {
            "anthropic-beta": [...s ?? [], "managed-agents-2026-04-01"].toString(),
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Delete Vault
     *
     * @example
     * ```ts
     * const betaManagedAgentsDeletedVault =
     *   await client.beta.vaults.delete(
     *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
     *   );
     * ```
     */
    delete(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.delete(_`/v1/vaults/${e}?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * Archive Vault
     *
     * @example
     * ```ts
     * const betaManagedAgentsVault =
     *   await client.beta.vaults.archive(
     *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
     *   );
     * ```
     */
    archive(e, n = {}, s) {
      const { betas: i, workspace_id: a } = n ?? {};
      return this._client.post(_`/v1/vaults/${e}/archive?beta=true`, {
        ...s,
        headers: p([
          {
            "anthropic-beta": [...i ?? [], "managed-agents-2026-04-01"].toString(),
            ...a != null ? { "anthropic-workspace-id": a } : void 0
          },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Credentials = $o, r;
})(), jo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.models = new Ta(this._client), this.messages = new oo(this._client), this.agents = new Ma(this._client), this.environments = new Va(this._client), this.sessions = new Oo(this._client), this.deployments = new Sa(this._client), this.deploymentRuns = new Ea(this._client), this.vaults = new Fo(this._client), this.memoryStores = new Ka(this._client), this.files = new va(this._client), this.skills = new Co(this._client), this.webhooks = new Na(this._client), this.userProfiles = new xa(this._client), this.dreams = new ka(this._client), this.tunnels = new Po(this._client), this.organization = new xo(this._client);
    }
  }
  return r.Models = Ta, r.Messages = oo, r.Agents = Ma, r.Environments = Va, r.Sessions = Oo, r.Deployments = Sa, r.DeploymentRuns = Ea, r.Vaults = Fo, r.MemoryStores = Ka, r.Files = va, r.Skills = Co, r.Webhooks = Na, r.UserProfiles = xa, r.Dreams = ka, r.Tunnels = Po, r.Organization = xo, r;
})();
class Bo extends I {
  create(t, e) {
    const { betas: n, workspace_id: s, ...i } = t;
    return this._client.post("/v1/complete", {
      body: i,
      timeout: this._client._options.timeout ?? 6e5,
      ...e,
      headers: p([
        {
          ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0,
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ]),
      stream: t.stream ?? !1
    });
  }
}
class Uo extends I {
  /**
   * List Files
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fileMetadata of client.files.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { workspace_id: n, ...s } = t ?? {};
    return this._client.getAPIList("/v1/files", L, {
      query: s,
      ...e,
      headers: p([
        { ...n != null ? { "anthropic-workspace-id": n } : void 0 },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Delete File
   *
   * @example
   * ```ts
   * const deletedFile = await client.files.delete('file_id');
   * ```
   */
  delete(t, e = {}, n) {
    const { workspace_id: s } = e ?? {};
    return this._client.delete(_`/v1/files/${t}`, {
      ...n,
      headers: p([
        { ...s != null ? { "anthropic-workspace-id": s } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Download File
   *
   * @example
   * ```ts
   * const response = await client.files.download('file_id');
   *
   * const content = await response.blob();
   * console.log(content);
   * ```
   */
  download(t, e = {}, n) {
    const { workspace_id: s } = e ?? {};
    return this._client.get(_`/v1/files/${t}/content`, {
      ...n,
      headers: p([
        {
          Accept: "application/binary",
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        n == null ? void 0 : n.headers
      ]),
      __binaryResponse: !0
    });
  }
  /**
   * Get File Metadata
   *
   * @example
   * ```ts
   * const fileMetadata = await client.files.retrieveMetadata(
   *   'file_id',
   * );
   * ```
   */
  retrieveMetadata(t, e = {}, n) {
    const { workspace_id: s } = e ?? {};
    return this._client.get(_`/v1/files/${t}`, {
      ...n,
      headers: p([
        { ...s != null ? { "anthropic-workspace-id": s } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Upload File
   *
   * @example
   * ```ts
   * const fileMetadata = await client.files.upload({
   *   file: fs.createReadStream('path/to/file'),
   * });
   * ```
   */
  upload(t, e) {
    const { workspace_id: n, ...s } = t;
    return this._client.post("/v1/files", Wt({
      body: s,
      ...e,
      headers: p([
        { ...n != null ? { "anthropic-workspace-id": n } : void 0 },
        El(s.file),
        e == null ? void 0 : e.headers
      ])
    }, this._client));
  }
}
function Fl(r) {
  var t;
  return (t = r == null ? void 0 : r.output_config) == null ? void 0 : t.format;
}
function Wo(r, t, e) {
  const n = Fl(t);
  return !t || !("parse" in (n ?? {})) ? {
    ...r,
    content: r.content.map((s) => s.type === "text" ? Object.defineProperty({ ...s }, "parsed_output", {
      value: null,
      enumerable: !1
    }) : s),
    parsed_output: null
  } : jl(r, t);
}
function jl(r, t, e) {
  let n = null;
  const s = r.content.map((i) => {
    if (i.type === "text") {
      const a = bg(t, i.text);
      return n === null && (n = a), Object.defineProperty({ ...i }, "parsed_output", {
        value: a,
        enumerable: !1
      });
    }
    return i;
  });
  return {
    ...r,
    content: s,
    parsed_output: n
  };
}
function bg(r, t) {
  const e = Fl(r);
  if ((e == null ? void 0 : e.type) !== "json_schema")
    return null;
  try {
    return "parse" in e ? e.parse(t) : JSON.parse(t);
  } catch (n) {
    throw new E(`Failed to parse structured output: ${n}`);
  }
}
var he, Fe, Et, fn, rr, pn, gn, sr, mn, ve, _n, ir, ar, Qe, or, cr, lr, wn, hs, Do, fs, ps, gs, ms, Ho;
function _s(r) {
  return r.type === "tool_use" || r.type === "server_tool_use";
}
var Eg = /* @__PURE__ */ (() => {
  class r {
    constructor(e, n) {
      he.add(this), this.messages = [], this.receivedMessages = [], Fe.set(this, void 0), Et.set(this, null), this.controller = new AbortController(), fn.set(this, void 0), rr.set(this, () => {
      }), pn.set(this, () => {
      }), gn.set(this, void 0), sr.set(this, () => {
      }), mn.set(this, () => {
      }), ve.set(this, {}), _n.set(this, !1), ir.set(this, !1), ar.set(this, !1), Qe.set(this, !1), or.set(this, void 0), cr.set(this, void 0), lr.set(this, void 0), wn.set(this, void 0), fs.set(this, (s) => {
        if (w(this, ir, !0), Bt(s) && (s = new ye()), s instanceof ye)
          return w(this, ar, !0), this._emit("abort", s);
        if (s instanceof E)
          return this._emit("error", s);
        if (s instanceof Error) {
          const i = new E(s.message);
          return i.cause = s, this._emit("error", i);
        }
        return this._emit("error", new E(String(s)));
      }), w(this, fn, new Promise((s, i) => {
        w(this, rr, s, "f"), w(this, pn, i, "f");
      })), w(this, gn, new Promise((s, i) => {
        w(this, sr, s, "f"), w(this, mn, i, "f");
      })), c(this, fn, "f").catch(() => {
      }), c(this, gn, "f").catch(() => {
      }), w(this, Et, e), w(this, wn, (n == null ? void 0 : n.logger) ?? console);
    }
    get response() {
      return c(this, or, "f");
    }
    get request_id() {
      return c(this, cr, "f");
    }
    get workspace_id() {
      return c(this, lr, "f");
    }
    /**
     * Returns the `MessageStream` data, the raw `Response` instance and the ID of the request,
     * returned vie the `request-id` header which is useful for debugging requests and resporting
     * issues to Anthropic.
     *
     * This is the same as the `APIPromise.withResponse()` method.
     *
     * This method will raise an error if you created the stream using `MessageStream.fromReadableStream`
     * as no `Response` is available.
     */
    async withResponse() {
      w(this, Qe, !0);
      const e = await c(this, fn, "f");
      if (!e)
        throw new Error("Could not resolve a `Response` object");
      return {
        data: this,
        response: e,
        request_id: e.headers.get("request-id"),
        workspace_id: e.headers.get("anthropic-workspace-id")
      };
    }
    /**
     * Intended for use on the frontend, consuming a stream produced with
     * `.toReadableStream()` on the backend.
     *
     * Note that messages sent to the model do not appear in `.on('message')`
     * in this context.
     */
    static fromReadableStream(e) {
      const n = new r(null);
      return n._run(() => n._fromReadableStream(e)), n;
    }
    static createMessage(e, n, s, { logger: i } = {}) {
      const a = new r(n, { logger: i });
      for (const o of n.messages)
        a._addMessageParam(o);
      return w(a, Et, { ...n, stream: !0 }), a._run(() => a._createMessage(e, { ...n, stream: !0 }, { ...s, headers: { ...s == null ? void 0 : s.headers, [wl]: "stream" } })), a;
    }
    _run(e) {
      e().then(() => {
        this._emitFinal(), this._emit("end");
      }, c(this, fs, "f"));
    }
    _addMessageParam(e) {
      this.messages.push(e);
    }
    _addMessage(e, n = !0) {
      this.receivedMessages.push(e), n && this._emit("message", e);
    }
    async _createMessage(e, n, s) {
      var o;
      const i = s == null ? void 0 : s.signal;
      let a;
      i && (i.aborted && this.controller.abort(), a = this.controller.abort.bind(this.controller), i.addEventListener("abort", a));
      try {
        c(this, he, "m", ps).call(this);
        const { response: l, data: u } = await e.create({ ...n, stream: !0 }, { ...s, signal: this.controller.signal }).withResponse();
        this._connected(l);
        for await (const d of u)
          c(this, he, "m", gs).call(this, d);
        if ((o = u.controller.signal) != null && o.aborted)
          throw new ye();
        c(this, he, "m", ms).call(this);
      } finally {
        i && a && i.removeEventListener("abort", a);
      }
    }
    _connected(e) {
      this.ended || (w(this, or, e), w(this, cr, e == null ? void 0 : e.headers.get("request-id")), w(this, lr, e == null ? void 0 : e.headers.get("anthropic-workspace-id")), c(this, rr, "f").call(this, e), this._emit("connect"));
    }
    get ended() {
      return c(this, _n, "f");
    }
    get errored() {
      return c(this, ir, "f");
    }
    get aborted() {
      return c(this, ar, "f");
    }
    abort() {
      this.controller.abort();
    }
    /**
     * Adds the listener function to the end of the listeners array for the event.
     * No checks are made to see if the listener has already been added. Multiple calls passing
     * the same combination of event and listener will result in the listener being added, and
     * called, multiple times.
     * @returns this MessageStream, so that calls can be chained
     */
    on(e, n) {
      return (c(this, ve, "f")[e] || (c(this, ve, "f")[e] = [])).push({ listener: n }), this;
    }
    /**
     * Removes the specified listener from the listener array for the event.
     * off() will remove, at most, one instance of a listener from the listener array. If any single
     * listener has been added multiple times to the listener array for the specified event, then
     * off() must be called multiple times to remove each instance.
     * @returns this MessageStream, so that calls can be chained
     */
    off(e, n) {
      const s = c(this, ve, "f")[e];
      if (!s)
        return this;
      const i = s.findIndex((a) => a.listener === n);
      return i >= 0 && s.splice(i, 1), this;
    }
    /**
     * Adds a one-time listener function for the event. The next time the event is triggered,
     * this listener is removed and then invoked.
     * @returns this MessageStream, so that calls can be chained
     */
    once(e, n) {
      return (c(this, ve, "f")[e] || (c(this, ve, "f")[e] = [])).push({ listener: n, once: !0 }), this;
    }
    /**
     * This is similar to `.once()`, but returns a Promise that resolves the next time
     * the event is triggered, instead of calling a listener callback.
     * @returns a Promise that resolves the next time given event is triggered,
     * or rejects if an error is emitted.  (If you request the 'error' event,
     * returns a promise that resolves with the error).
     *
     * Example:
     *
     *   const message = await stream.emitted('message') // rejects if the stream errors
     */
    emitted(e) {
      return new Promise((n, s) => {
        w(this, Qe, !0), e !== "error" && this.once("error", s), this.once(e, n);
      });
    }
    async done() {
      w(this, Qe, !0), await c(this, gn, "f");
    }
    get currentMessage() {
      return c(this, Fe, "f");
    }
    /**
     * @returns a promise that resolves with the the final assistant Message response,
     * or rejects if an error occurred or the stream ended prematurely without producing a Message.
     * If structured outputs were used, this will be a ParsedMessage with a `parsed_output` field.
     */
    async finalMessage() {
      return await this.done(), c(this, he, "m", hs).call(this);
    }
    /**
     * @returns a promise that resolves with the the final assistant Message's text response, concatenated
     * together if there are more than one text blocks.
     * Rejects if an error occurred or the stream ended prematurely without producing a Message.
     */
    async finalText() {
      return await this.done(), c(this, he, "m", Do).call(this);
    }
    _emit(e, ...n) {
      if (c(this, _n, "f"))
        return;
      e === "end" && (w(this, _n, !0), c(this, sr, "f").call(this));
      const s = c(this, ve, "f")[e];
      if (s && (c(this, ve, "f")[e] = s.filter((i) => !i.once), s.forEach(({ listener: i }) => i(...n))), e === "abort") {
        const i = n[0];
        !c(this, Qe, "f") && !(s != null && s.length) && Promise.reject(i), c(this, pn, "f").call(this, i), c(this, mn, "f").call(this, i), this._emit("end");
        return;
      }
      if (e === "error") {
        const i = n[0];
        !c(this, Qe, "f") && !(s != null && s.length) && Promise.reject(i), c(this, pn, "f").call(this, i), c(this, mn, "f").call(this, i), this._emit("end");
      }
    }
    _emitFinal() {
      this.receivedMessages.at(-1) && this._emit("finalMessage", c(this, he, "m", hs).call(this));
    }
    async _fromReadableStream(e, n) {
      var a;
      const s = n == null ? void 0 : n.signal;
      let i;
      s && (s.aborted && this.controller.abort(), i = this.controller.abort.bind(this.controller), s.addEventListener("abort", i));
      try {
        c(this, he, "m", ps).call(this), this._connected(null);
        const o = Ut.fromReadableStream(e, this.controller);
        for await (const l of o)
          c(this, he, "m", gs).call(this, l);
        if ((a = o.controller.signal) != null && a.aborted)
          throw new ye();
        c(this, he, "m", ms).call(this);
      } finally {
        s && i && s.removeEventListener("abort", i);
      }
    }
    [(Fe = /* @__PURE__ */ new WeakMap(), Et = /* @__PURE__ */ new WeakMap(), fn = /* @__PURE__ */ new WeakMap(), rr = /* @__PURE__ */ new WeakMap(), pn = /* @__PURE__ */ new WeakMap(), gn = /* @__PURE__ */ new WeakMap(), sr = /* @__PURE__ */ new WeakMap(), mn = /* @__PURE__ */ new WeakMap(), ve = /* @__PURE__ */ new WeakMap(), _n = /* @__PURE__ */ new WeakMap(), ir = /* @__PURE__ */ new WeakMap(), ar = /* @__PURE__ */ new WeakMap(), Qe = /* @__PURE__ */ new WeakMap(), or = /* @__PURE__ */ new WeakMap(), cr = /* @__PURE__ */ new WeakMap(), lr = /* @__PURE__ */ new WeakMap(), wn = /* @__PURE__ */ new WeakMap(), fs = /* @__PURE__ */ new WeakMap(), he = /* @__PURE__ */ new WeakSet(), hs = function() {
      if (this.receivedMessages.length === 0)
        throw new E("stream ended without producing a Message with role=assistant");
      return this.receivedMessages.at(-1);
    }, Do = function() {
      if (this.receivedMessages.length === 0)
        throw new E("stream ended without producing a Message with role=assistant");
      const n = this.receivedMessages.at(-1).content.filter((s) => s.type === "text").map((s) => s.text);
      if (n.length === 0)
        throw new E("stream ended without producing a content block with type=text");
      return n.join(" ");
    }, ps = function() {
      this.ended || w(this, Fe, void 0);
    }, gs = function(n) {
      var i;
      if (this.ended)
        return;
      const s = c(this, he, "m", Ho).call(this, n);
      switch (this._emit("streamEvent", n, s), n.type) {
        case "content_block_delta": {
          const a = s.content.at(-1);
          switch (n.delta.type) {
            case "text_delta": {
              a.type === "text" && this._emit("text", n.delta.text, a.text || "");
              break;
            }
            case "citations_delta": {
              a.type === "text" && this._emit("citation", n.delta.citation, a.citations ?? []);
              break;
            }
            case "input_json_delta": {
              _s(a) && ((i = c(this, ve, "f").inputJson) != null && i.length) && this._emit("inputJson", n.delta.partial_json, a.input);
              break;
            }
            case "thinking_delta": {
              a.type === "thinking" && this._emit("thinking", n.delta.thinking, a.thinking);
              break;
            }
            case "signature_delta": {
              a.type === "thinking" && this._emit("signature", a.signature);
              break;
            }
            default:
              n.delta;
          }
          break;
        }
        case "message_stop": {
          this._addMessageParam(s), this._addMessage(Wo(s, c(this, Et, "f"), { logger: c(this, wn, "f") }), !0);
          break;
        }
        case "content_block_stop": {
          this._emit("contentBlock", s.content.at(-1));
          break;
        }
        case "message_start": {
          w(this, Fe, s);
          break;
        }
      }
    }, ms = function() {
      if (this.ended)
        throw new E("stream has ended, this shouldn't happen");
      const n = c(this, Fe, "f");
      if (!n)
        throw new E("request ended without sending any chunks");
      return w(this, Fe, void 0), Wo(n, c(this, Et, "f"), { logger: c(this, wn, "f") });
    }, Ho = function(n) {
      let s = c(this, Fe, "f");
      if (n.type === "message_start") {
        if (s)
          throw new E(`Unexpected event order, got ${n.type} before receiving "message_stop"`);
        return n.message;
      }
      if (!s)
        throw new E(`Unexpected event order, got ${n.type} before "message_start"`);
      switch (n.type) {
        case "message_stop":
          return s;
        case "message_delta":
          return s.stop_reason = n.delta.stop_reason, s.stop_sequence = n.delta.stop_sequence, s.stop_details = n.delta.stop_details, s.usage.output_tokens = n.usage.output_tokens, n.delta.container != null && (s.container = n.delta.container), n.usage.input_tokens != null && (s.usage.input_tokens = n.usage.input_tokens), n.usage.cache_creation_input_tokens != null && (s.usage.cache_creation_input_tokens = n.usage.cache_creation_input_tokens), n.usage.cache_read_input_tokens != null && (s.usage.cache_read_input_tokens = n.usage.cache_read_input_tokens), n.usage.server_tool_use != null && (s.usage.server_tool_use = n.usage.server_tool_use), n.usage.output_tokens_details != null && (s.usage.output_tokens_details = n.usage.output_tokens_details), s;
        case "content_block_start":
          return s.content.push({ ...n.content_block }), s;
        case "content_block_delta": {
          const i = s.content.at(n.index);
          switch (n.delta.type) {
            case "text_delta": {
              (i == null ? void 0 : i.type) === "text" && (s.content[n.index] = {
                ...i,
                text: (i.text || "") + n.delta.text
              });
              break;
            }
            case "citations_delta": {
              (i == null ? void 0 : i.type) === "text" && (s.content[n.index] = {
                ...i,
                citations: [...i.citations ?? [], n.delta.citation]
              });
              break;
            }
            case "input_json_delta": {
              if (i && _s(i)) {
                const a = (i[Pt] || "") + n.delta.partial_json;
                s.content[n.index] = $l(i, a);
              }
              break;
            }
            case "thinking_delta": {
              (i == null ? void 0 : i.type) === "thinking" && (s.content[n.index] = {
                ...i,
                thinking: i.thinking + n.delta.thinking
              });
              break;
            }
            case "signature_delta": {
              (i == null ? void 0 : i.type) === "thinking" && (s.content[n.index] = {
                ...i,
                signature: n.delta.signature
              });
              break;
            }
            default:
              n.delta;
          }
          return s;
        }
        case "content_block_stop": {
          const i = s.content.at(n.index);
          return i && _s(i) && Pt in i && Object.defineProperty(i, "input", {
            value: i.input,
            enumerable: !0,
            configurable: !0,
            writable: !0
          }), s;
        }
      }
    }, Symbol.asyncIterator)]() {
      const e = [], n = [];
      let s = !1;
      return this.on("streamEvent", (i) => {
        const a = n.shift();
        a ? a.resolve(i) : e.push(i);
      }), this.on("end", () => {
        s = !0;
        for (const i of n)
          i.resolve(void 0);
        n.length = 0;
      }), this.on("abort", (i) => {
        s = !0;
        for (const a of n)
          a.reject(i);
        n.length = 0;
      }), this.on("error", (i) => {
        s = !0;
        for (const a of n)
          a.reject(i);
        n.length = 0;
      }), {
        next: async () => e.length ? { value: e.shift(), done: !1 } : s ? { value: void 0, done: !0 } : new Promise((a, o) => n.push({ resolve: a, reject: o })).then((a) => a ? { value: a, done: !1 } : { value: void 0, done: !0 }),
        return: async () => (this.abort(), { value: void 0, done: !0 })
      };
    }
    toReadableStream() {
      return new Ut(this[Symbol.asyncIterator].bind(this), this.controller).toReadableStream();
    }
  }
  return r;
})();
class qo extends I {
  /**
   * Send a batch of Message creation requests.
   *
   * The Message Batches API can be used to process multiple Messages API requests at
   * once. Once a Message Batch is created, it begins processing immediately. Batches
   * can take up to 24 hours to complete.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatch = await client.messages.batches.create({
   *   requests: [
   *     {
   *       custom_id: 'my-custom-id-1',
   *       params: {
   *         max_tokens: 1024,
   *         messages: [
   *           { content: 'Hello, world', role: 'user' },
   *         ],
   *         model: 'claude-opus-5',
   *       },
   *     },
   *   ],
   * });
   * ```
   */
  create(t, e) {
    const { user_profile_id: n, workspace_id: s, ...i } = t;
    return this._client.post("/v1/messages/batches", {
      body: i,
      ...e,
      headers: p([
        {
          ...n != null ? { "anthropic-user-profile-id": n } : void 0,
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * This endpoint is idempotent and can be used to poll for Message Batch
   * completion. To access the results of a Message Batch, make a request to the
   * `results_url` field in the response.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatch = await client.messages.batches.retrieve(
   *   'message_batch_id',
   * );
   * ```
   */
  retrieve(t, e = {}, n) {
    const { workspace_id: s } = e ?? {};
    return this._client.get(_`/v1/messages/batches/${t}`, {
      ...n,
      headers: p([
        { ...s != null ? { "anthropic-workspace-id": s } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List all Message Batches within a Workspace. Most recently created batches are
   * returned first.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const messageBatch of client.messages.batches.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { workspace_id: n, ...s } = t ?? {};
    return this._client.getAPIList("/v1/messages/batches", Oe, {
      query: s,
      ...e,
      headers: p([
        { ...n != null ? { "anthropic-workspace-id": n } : void 0 },
        e == null ? void 0 : e.headers
      ])
    });
  }
  /**
   * Delete a Message Batch.
   *
   * Message Batches can only be deleted once they've finished processing. If you'd
   * like to delete an in-progress batch, you must first cancel it.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const deletedMessageBatch =
   *   await client.messages.batches.delete('message_batch_id');
   * ```
   */
  delete(t, e = {}, n) {
    const { workspace_id: s } = e ?? {};
    return this._client.delete(_`/v1/messages/batches/${t}`, {
      ...n,
      headers: p([
        { ...s != null ? { "anthropic-workspace-id": s } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Batches may be canceled any time before processing ends. Once cancellation is
   * initiated, the batch enters a `canceling` state, at which time the system may
   * complete any in-progress, non-interruptible requests before finalizing
   * cancellation.
   *
   * The number of canceled requests is specified in `request_counts`. To determine
   * which requests were canceled, check the individual results within the batch.
   * Note that cancellation may not result in any canceled requests if they were
   * non-interruptible.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatch = await client.messages.batches.cancel(
   *   'message_batch_id',
   * );
   * ```
   */
  cancel(t, e = {}, n) {
    const { workspace_id: s } = e ?? {};
    return this._client.post(_`/v1/messages/batches/${t}/cancel`, {
      ...n,
      headers: p([
        { ...s != null ? { "anthropic-workspace-id": s } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Streams the results of a Message Batch as a `.jsonl` file.
   *
   * Each line in the file is a JSON object containing the result of a single request
   * in the Message Batch. Results are not guaranteed to be in the same order as
   * requests. Use the `custom_id` field to match results to requests.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatchIndividualResponse =
   *   await client.messages.batches.results('message_batch_id');
   * ```
   */
  async results(t, e = {}, n) {
    const s = await this.retrieve(t, e, n);
    if (!s.results_url)
      throw new E(`No batch \`results_url\`; Has it finished processing? ${s.processing_status} - ${s.id}`);
    const { workspace_id: i } = e ?? {};
    return this._client.get(s.results_url, {
      ...n,
      headers: p([
        {
          Accept: "application/binary",
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ]),
      stream: !0,
      __binaryResponse: !0
    })._thenUnwrap((a, o) => Ml.fromResponse(o.response, o.controller));
  }
}
var Vo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.batches = new qo(this._client);
    }
    create(e, n) {
      const { user_profile_id: s, workspace_id: i, ...a } = e;
      a.model in zo && console.warn(`The model '${a.model}' is deprecated and will reach end-of-life on ${zo[a.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`), Sg.includes(a.model) && a.thinking && a.thinking.type === "enabled" && console.warn(`Using Claude with ${a.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);
      let o = (n == null ? void 0 : n.timeout) ?? this._client._options.timeout;
      if (!a.stream && o == null) {
        const u = Cl[a.model] ?? void 0;
        o = this._client.calculateNonstreamingTimeout(a.max_tokens, u);
      }
      const l = bl(a.tools, a.messages);
      return this._client.post("/v1/messages", {
        body: a,
        timeout: o ?? 6e5,
        ...n,
        headers: p([
          {
            ...s != null ? { "anthropic-user-profile-id": s } : void 0,
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          l,
          n == null ? void 0 : n.headers
        ]),
        stream: e.stream ?? !1
      });
    }
    /**
     * Send a structured list of input messages with text and/or image content, along with an expected `output_config.format` and
     * the response will be automatically parsed and available in the `parsed_output` property of the message.
     *
     * @example
     * ```ts
     * const message = await client.messages.parse({
     *   model: 'claude-sonnet-4-5-20250929',
     *   max_tokens: 1024,
     *   messages: [{ role: 'user', content: 'What is 2+2?' }],
     *   output_config: {
     *     format: zodOutputFormat(z.object({ answer: z.number() })),
     *   },
     * });
     *
     * console.log(message.parsed_output?.answer); // 4
     * ```
     */
    parse(e, n) {
      return this.create(e, n).then((s) => jl(s, e, { logger: this._client.logger ?? console }));
    }
    /**
     * Create a Message stream.
     *
     * If `output_config.format` is provided with a parseable format (like `zodOutputFormat()`),
     * the final message will include a `parsed_output` property with the parsed content.
     *
     * @example
     * ```ts
     * const stream = client.messages.stream({
     *   model: 'claude-sonnet-4-5-20250929',
     *   max_tokens: 1024,
     *   messages: [{ role: 'user', content: 'What is 2+2?' }],
     *   output_config: {
     *     format: zodOutputFormat(z.object({ answer: z.number() })),
     *   },
     * });
     *
     * const message = await stream.finalMessage();
     * console.log(message.parsed_output?.answer); // 4
     * ```
     */
    stream(e, n) {
      return Eg.createMessage(this, e, n, { logger: this._client.logger ?? console });
    }
    /**
     * Count the number of tokens in a Message.
     *
     * The Token Count API can be used to count the number of tokens in a Message,
     * including tools, images, and documents, without creating it.
     *
     * Learn more about token counting in our
     * [user guide](https://platform.claude.com/docs/en/build-with-claude/token-counting)
     *
     * @example
     * ```ts
     * const messageTokensCount =
     *   await client.messages.countTokens({
     *     messages: [{ content: 'Hello, world', role: 'user' }],
     *     model: 'claude-opus-5',
     *   });
     * ```
     */
    countTokens(e, n) {
      const { user_profile_id: s, workspace_id: i, ...a } = e;
      return this._client.post("/v1/messages/count_tokens", {
        body: a,
        ...n,
        headers: p([
          {
            ...s != null ? { "anthropic-user-profile-id": s } : void 0,
            ...i != null ? { "anthropic-workspace-id": i } : void 0
          },
          n == null ? void 0 : n.headers
        ])
      });
    }
  }
  return r.Batches = qo, r;
})();
const zo = {}, Sg = ["claude-mythos-preview", "claude-opus-4-6"];
class Xo extends I {
  /**
   * Get a specific model.
   *
   * The Models API response can be used to determine information about a specific
   * model or resolve a model alias to a model ID.
   *
   * @example
   * ```ts
   * const modelInfo = await client.models.retrieve('model_id');
   * ```
   */
  retrieve(t, e = {}, n) {
    const { betas: s, workspace_id: i } = e ?? {};
    return this._client.get(_`/v1/models/${t}`, {
      ...n,
      headers: p([
        {
          ...(s == null ? void 0 : s.toString()) != null ? { "anthropic-beta": s == null ? void 0 : s.toString() } : void 0,
          ...i != null ? { "anthropic-workspace-id": i } : void 0
        },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List available models.
   *
   * The Models API response can be used to determine which models are available for
   * use in the API. More recently released models are listed first.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const modelInfo of client.models.list()) {
   *   // ...
   * }
   * ```
   */
  list(t = {}, e) {
    const { betas: n, workspace_id: s, ...i } = t ?? {};
    return this._client.getAPIList("/v1/models", Oe, {
      query: i,
      ...e,
      headers: p([
        {
          ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0,
          ...s != null ? { "anthropic-workspace-id": s } : void 0
        },
        e == null ? void 0 : e.headers
      ])
    });
  }
}
class Ko extends I {
  /**
   * Create Skill Version
   *
   * @example
   * ```ts
   * const skillVersion = await client.skills.versions.create(
   *   'skill_id',
   *   { files: [fs.createReadStream('path/to/file')] },
   * );
   * ```
   */
  create(t, e, n) {
    const { workspace_id: s, ...i } = e;
    return this._client.post(_`/v1/skills/${t}/versions`, Wt({
      body: i,
      ...n,
      headers: p([
        { ...s != null ? { "anthropic-workspace-id": s } : void 0 },
        n == null ? void 0 : n.headers
      ])
    }, this._client, !1));
  }
  /**
   * Get Skill Version
   *
   * @example
   * ```ts
   * const skillVersion = await client.skills.versions.retrieve(
   *   'version',
   *   { skill_id: 'skill_id' },
   * );
   * ```
   */
  retrieve(t, e, n) {
    const { skill_id: s, workspace_id: i } = e;
    return this._client.get(_`/v1/skills/${s}/versions/${t}`, {
      ...n,
      headers: p([
        { ...i != null ? { "anthropic-workspace-id": i } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * List Skill Versions
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const skillVersion of client.skills.versions.list(
   *   'skill_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(t, e = {}, n) {
    const { workspace_id: s, ...i } = e ?? {};
    return this._client.getAPIList(_`/v1/skills/${t}/versions`, L, {
      query: i,
      ...n,
      headers: p([
        { ...s != null ? { "anthropic-workspace-id": s } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
  /**
   * Delete Skill Version
   *
   * @example
   * ```ts
   * const deletedSkillVersion =
   *   await client.skills.versions.delete('version', {
   *     skill_id: 'skill_id',
   *   });
   * ```
   */
  delete(t, e, n) {
    const { skill_id: s, workspace_id: i } = e;
    return this._client.delete(_`/v1/skills/${s}/versions/${t}`, {
      ...n,
      headers: p([
        { ...i != null ? { "anthropic-workspace-id": i } : void 0 },
        n == null ? void 0 : n.headers
      ])
    });
  }
}
var Yo = /* @__PURE__ */ (() => {
  class r extends I {
    constructor() {
      super(...arguments), this.versions = new Ko(this._client);
    }
    /**
     * Create Skill
     *
     * @example
     * ```ts
     * const skill = await client.skills.create({
     *   files: [fs.createReadStream('path/to/file')],
     * });
     * ```
     */
    create(e, n) {
      const { workspace_id: s, ...i } = e;
      return this._client.post("/v1/skills", Wt({
        body: i,
        ...n,
        headers: p([
          { ...s != null ? { "anthropic-workspace-id": s } : void 0 },
          n == null ? void 0 : n.headers
        ])
      }, this._client, !1));
    }
    /**
     * Get Skill
     *
     * @example
     * ```ts
     * const skill = await client.skills.retrieve('skill_id');
     * ```
     */
    retrieve(e, n = {}, s) {
      const { workspace_id: i } = n ?? {};
      return this._client.get(_`/v1/skills/${e}`, {
        ...s,
        headers: p([
          { ...i != null ? { "anthropic-workspace-id": i } : void 0 },
          s == null ? void 0 : s.headers
        ])
      });
    }
    /**
     * List Skills
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const skill of client.skills.list()) {
     *   // ...
     * }
     * ```
     */
    list(e = {}, n) {
      const { workspace_id: s, ...i } = e ?? {};
      return this._client.getAPIList("/v1/skills", L, {
        query: i,
        ...n,
        headers: p([
          { ...s != null ? { "anthropic-workspace-id": s } : void 0 },
          n == null ? void 0 : n.headers
        ])
      });
    }
    /**
     * Delete Skill
     *
     * @example
     * ```ts
     * const deletedSkill = await client.skills.delete('skill_id');
     * ```
     */
    delete(e, n = {}, s) {
      const { workspace_id: i } = n ?? {};
      return this._client.delete(_`/v1/skills/${e}`, {
        ...s,
        headers: p([
          { ...i != null ? { "anthropic-workspace-id": i } : void 0 },
          s == null ? void 0 : s.headers
        ])
      });
    }
  }
  return r.Versions = Ko, r;
})(), ws, ys, dr, Jo;
const kg = "\\n\\nHuman:", vg = "\\n\\nAssistant:";
var Tg = /* @__PURE__ */ (() => {
  class r {
    /**
     * The active credential provider. Default credential resolution runs once
     * at construction time. If it fails, the error is surfaced on every
     * request and the client must be reconstructed — there is no retry path.
     *
     * Clones returned by {@link withOptions} share the parent's auth state
     * (provider, token cache, pending resolution, and any resolution error)
     * unless the caller passes an explicit `apiKey`, `authToken`,
     * `credentials`, `config`, or `profile` override.
     */
    get credentials() {
      return this._authState.provider;
    }
    /**
     * API Client for interfacing with the Anthropic API.
     *
     * @param {string | null | undefined} [opts.apiKey=process.env['ANTHROPIC_API_KEY'] ?? null]
     * @param {string | null | undefined} [opts.authToken=process.env['ANTHROPIC_AUTH_TOKEN'] ?? null]
     * @param {string | null | undefined} [opts.webhookKey=process.env['ANTHROPIC_WEBHOOK_SIGNING_KEY'] ?? null]
     * @param {string} [opts.baseURL=process.env['ANTHROPIC_BASE_URL'] ?? https://api.anthropic.com] - Override the default base URL for the API.
     * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
     * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
     * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
     * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
     * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
     * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
     * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
     */
    constructor({ baseURL: e = C("ANTHROPIC_BASE_URL"), apiKey: n, authToken: s, webhookKey: i = C("ANTHROPIC_WEBHOOK_SIGNING_KEY") ?? null, ...a } = {}) {
      if (ws.add(this), this._requestAuthFlags = /* @__PURE__ */ new WeakMap(), dr.set(this, void 0), n === void 0 && (n = a.profile != null ? null : C("ANTHROPIC_API_KEY") ?? null), s === void 0 && (s = a.profile != null ? null : C("ANTHROPIC_AUTH_TOKEN") ?? null), a.profile != null && (a.credentials != null || a.config != null))
        throw new TypeError("Pass at most one of `profile`, `credentials`, or `config`.");
      const o = {
        apiKey: n,
        authToken: s,
        webhookKey: i,
        ...a,
        baseURL: e || "https://api.anthropic.com"
      };
      if (!o.dangerouslyAllowBrowser && ff())
        throw new E(`It looks like you're running in a browser-like environment.

This is disabled by default, as it risks exposing your secret API credentials to attackers.
If you understand the risks and have appropriate mitigations in place,
you can set the \`dangerouslyAllowBrowser\` option to \`true\`, e.g.,

new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
`);
      this.baseURL = o.baseURL, this._baseURLIsExplicit = a.__baseURLIsExplicit ?? !!e, this.timeout = o.timeout ?? ys.DEFAULT_TIMEOUT, this.logger = o.logger ?? console, this.logLevel = xr, this.logLevel = $s(o.logLevel, "ClientOptions.logLevel", F(this)) ?? $s(C("ANTHROPIC_LOG"), "process.env['ANTHROPIC_LOG']", F(this)) ?? xr, this.fetchOptions = o.fetchOptions, this.maxRetries = qr("maxRetries", o.maxRetries ?? 2), this.fetch = o.fetch ?? bf(), w(this, dr, Sf), this.middleware = [...o.middleware ?? []];
      const l = C("ANTHROPIC_CUSTOM_HEADERS");
      if (l) {
        const d = {};
        for (const h of l.split(`
`)) {
          const g = h.indexOf(":");
          g >= 0 && (d[h.substring(0, g).trim()] = h.substring(g + 1).trim());
        }
        o.defaultHeaders = { ...d, ...o.defaultHeaders };
      }
      const u = a.__auth;
      if (delete o.__auth, delete o.__baseURLIsExplicit, this._options = o, this.apiKey = typeof n == "string" ? n : null, this.authToken = s, this.webhookKey = i, u)
        this._authState = u, !this._baseURLIsExplicit && u.baseURL && (this.baseURL = u.baseURL);
      else if (this._authState = { provider: null, tokenCache: null, resolution: null, error: null, extraHeaders: {} }, this.apiKey == null && this.authToken == null) {
        const d = o.credentials ?? null;
        if (d)
          this._authState.provider = d, this._authState.tokenCache = this._makeTokenCache(d);
        else if (o.config != null) {
          const h = cl(o.config, this._credentialResolverOptions());
          this._authState.provider = h.provider, this._authState.tokenCache = this._makeTokenCache(h.provider), this._authState.extraHeaders = h.extraHeaders, this._applyCredentialBaseURL(h.baseURL);
        } else o.profile != null ? this._authState.resolution = this._resolveDefaultCredentials(o.profile) : this._shouldResolveDefaultCredentials() && (this._authState.resolution = this._resolveDefaultCredentials());
      }
    }
    /**
     * Whether to lazily resolve auth from the default credential chain when no
     * explicit auth is configured. Called once from the constructor, so
     * overrides must not depend on subclass instance state. Subclasses that
     * bring their own auth scheme return false so unrelated local credentials
     * are never resolved or allowed to supply a base URL.
     */
    _shouldResolveDefaultCredentials() {
      return !0;
    }
    /**
     * Stores a profile/config-supplied base URL on the shared auth state and, if
     * the caller did not pin `baseURL` via constructor option or env, adopts it
     * as this client's outbound API host. Precedence: ctor opt > env > profile >
     * hardcoded default.
     */
    _applyCredentialBaseURL(e) {
      if (!e)
        return;
      const n = e.replace(/\/+$/, "");
      this._authState.baseURL = n, this._baseURLIsExplicit || (this.baseURL = n);
    }
    /**
     * Options bag passed into the credential chain. `baseURL` here is only the
     * fallback host for the token-exchange POST when the config itself omits
     * `base_url`; the chain returns the config's own `base_url` (if any) on
     * {@link CredentialResult.baseURL}, which {@link _applyCredentialBaseURL}
     * then adopts for outbound API requests. The two are deliberately decoupled
     * so this fallback never round-trips into precedence.
     */
    _credentialResolverOptions() {
      return {
        baseURL: this.baseURL,
        fetch: this._credentialsFetch(),
        userAgent: this.getUserAgent(),
        onCacheWriteError: (e) => {
          F(this).debug("credential cache write failed (best-effort)", e);
        },
        onSafetyWarning: (e) => {
          F(this).warn(e);
        }
      };
    }
    /**
     * A `Fetch` for first-party credential token-exchange requests (OIDC
     * federation jwt-bearer grants, user-OAuth refresh grants) that routes
     * through this client's middleware chain, so middleware observes token
     * traffic like any other request. Only client-level middleware applies:
     * a minted token is shared across requests, so attributing the exchange
     * to any one request's per-request middleware would be arbitrary. For the
     * same reason, `ctx.options` is undefined for these requests.
     */
    _credentialsFetch() {
      return _a(this.fetch, this.middleware, void 0, this);
    }
    _makeTokenCache(e) {
      return new Ff(e, (n) => {
        F(this).debug("advisory token refresh failed; serving cached token", n);
      });
    }
    /**
     * Create a new client instance re-using the same options given to the
     * current client with optional overriding.
     */
    withOptions(e) {
      const n = "credentials" in e || "config" in e || "profile" in e, s = "apiKey" in e || "authToken" in e || n, i = {
        ...this._options,
        // Only forward baseURL when the caller (or env) explicitly chose it.
        // For a non-explicit parent, this.baseURL may have been mutated to the
        // profile-resolved host; pinning that as the clone's options.baseURL
        // would make _options on the clone misreport caller intent and would
        // leave the clone stuck on the parent's host across an auth override.
        // The clone instead receives the construction-time value via
        // ...this._options above and re-adopts the profile host through the
        // shared _authState.baseURL + __baseURLIsExplicit=false path.
        ...this._baseURLIsExplicit ? { baseURL: this.baseURL } : {},
        maxRetries: this.maxRetries,
        timeout: this.timeout,
        logger: this.logger,
        logLevel: this.logLevel,
        fetch: this.fetch,
        fetchOptions: this.fetchOptions,
        middleware: this.middleware,
        apiKey: this.apiKey,
        authToken: this.authToken,
        webhookKey: this.webhookKey,
        // credentials: this.credentials is a no-op when __auth is shared (the
        // ctor takes the inherited path and ignores options.credentials); when
        // overridesAuth is true via apiKey/authToken only, it lets the clone
        // build a fresh TokenCache around the parent's provider.
        credentials: this.credentials,
        // When the caller passes a structured-credential override, drop inherited
        // structured-credential options so only `...options` supplies them —
        // otherwise an inherited `credentials`/`config`/`profile` would trip the
        // mutual-exclusion check or precedence over the override.
        ...n ? { credentials: void 0, config: void 0, profile: void 0 } : {},
        ...e,
        // Always set __auth so any stale value from ...this._options is
        // overwritten. undefined means "build fresh auth from these options".
        __auth: s ? void 0 : this._authState,
        __baseURLIsExplicit: "baseURL" in e ? !0 : this._baseURLIsExplicit
      };
      return new this.constructor(i);
    }
    /**
     * Lazily resolves credentials from config files or environment variables.
     * Called once from the constructor when no explicit auth is provided, or
     * when an explicit `profile` was passed (in which case a missing/unresolved
     * profile is surfaced as an error instead of falling through to "no auth").
     * The returned promise is stored and awaited on the first request.
     */
    async _resolveDefaultCredentials(e) {
      try {
        const n = await Jf(this._credentialResolverOptions(), e);
        if (n)
          this._authState.provider = n.provider, this._authState.tokenCache = this._makeTokenCache(n.provider), this._authState.extraHeaders = n.extraHeaders, this._applyCredentialBaseURL(n.baseURL);
        else if (e != null)
          throw new E(`Profile "${e}" could not be resolved (no <config_dir>/configs/${e}.json found).`);
      } catch (n) {
        this._authState.error = n;
      } finally {
        this._authState.resolution = null;
      }
    }
    defaultQuery() {
      return this._options.defaultQuery;
    }
    validateHeaders({ values: e, nulls: n }) {
      if (!(e.get("x-api-key") || e.get("authorization"))) {
        if (this._authState.error)
          throw this._authState.error;
        if (!(this._authState.tokenCache || this._authState.resolution) && !(this.apiKey && e.get("x-api-key")) && !n.has("x-api-key") && !(this.authToken && e.get("authorization")) && !n.has("authorization"))
          throw new Error('Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted');
      }
    }
    _authFlags(e) {
      let n = this._requestAuthFlags.get(e);
      return n || (n = { usedTokenCache: !1, didRefreshFor401: !1 }, this._requestAuthFlags.set(e, n)), n;
    }
    async authHeaders(e) {
      if (this._authState.resolution && await this._authState.resolution, !this._authState.error) {
        if (this._authState.tokenCache && this.apiKey == null) {
          const n = await this._authState.tokenCache.getToken();
          return this._authFlags(e).usedTokenCache = !0, p([{ Authorization: `Bearer ${n}` }]);
        }
        return p([await this.apiKeyAuth(e), await this.bearerAuth(e)]);
      }
    }
    async apiKeyAuth(e) {
      if (this.apiKey != null)
        return p([{ "X-Api-Key": this.apiKey }]);
    }
    async bearerAuth(e) {
      if (this.authToken != null)
        return p([{ Authorization: `Bearer ${this.authToken}` }]);
    }
    stringifyQuery(e) {
      return If(e);
    }
    getUserAgent() {
      return `Anthropic/JS ${He}`;
    }
    makeStatusError(e, n, s, i) {
      return K.generate(e, n, s, i);
    }
    buildURL(e, n, s) {
      const i = !c(this, ws, "m", Jo).call(this) && s || this.baseURL, a = uf(e) ? new URL(e) : new URL(i + (i.endsWith("/") && e.startsWith("/") ? e.slice(1) : e)), o = this.defaultQuery(), l = Object.fromEntries(a.searchParams);
      return (!na(o) || !na(l)) && (n = { ...l, ...o, ...n }), typeof n == "object" && n && !Array.isArray(n) && (a.search = this.stringifyQuery(n)), a.toString();
    }
    _calculateNonstreamingTimeout(e) {
      if (3600 * e / 128e3 > 600)
        throw new E("Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#streaming-responses for more details");
      return 600 * 1e3;
    }
    /**
     * Used as a callback for mutating the given `FinalRequestOptions` object.
     */
    async prepareOptions(e) {
    }
    /**
     * Used as a callback for mutating the given `RequestInit` object.
     *
     * This is useful for cases where you want to add certain headers based off of
     * the request properties, e.g. `method` or `url`.
     *
     * Runs after all middleware (including {@link backendMiddleware}),
     * immediately before each underlying fetch call, so it sees exactly what
     * goes over the wire. Middleware may replay a request by calling `next()`
     * more than once, so this hook can run multiple times per attempt:
     * overrides must be idempotent and overwrite headers from a previous
     * invocation rather than append to them.
     */
    async prepareRequest(e, { url: n, options: s }) {
      var i;
      if (this._authState.tokenCache && this.apiKey == null) {
        const a = e.headers instanceof Headers ? e.headers : new Headers(e.headers);
        for (const [l, u] of Object.entries(this._authState.extraHeaders))
          a.has(l) || a.set(l, u);
        const o = (i = a.get("anthropic-beta")) == null ? void 0 : i.split(",").map((l) => l.trim());
        o != null && o.includes(Tr) || a.set("anthropic-beta", [...o ?? [], Tr].join(",")), e.headers = a;
      }
    }
    /**
     * Internal {@link Middleware} composed innermost in the chain — inside both
     * client-level and per-request middleware, immediately around the underlying
     * `fetch`. Subclasses for third-party backends override this to adapt the
     * canonical Anthropic-shaped request to the backend's wire shape (URL/body
     * rewriting, request signing) and to normalize the wire response back to the
     * canonical shape (e.g. AWS EventStream to SSE).
     *
     * Running inside the user's middleware means user middleware always observes
     * canonical Anthropic-shaped traffic, and the adaptation re-runs (e.g.
     * re-signs) on every `next()` invocation, covering whatever the middleware
     * mutated.
     *
     * Errors thrown here follow the middleware error policy: they propagate to
     * the caller as-is — no retries, no `APIConnectionError` wrapping — unless
     * retryable (see {@link Middleware}); throw a `RetryableError` to opt into
     * the retry path.
     */
    backendMiddleware() {
      return [];
    }
    get(e, n) {
      return this.methodRequest("get", e, n);
    }
    post(e, n) {
      return this.methodRequest("post", e, n);
    }
    patch(e, n) {
      return this.methodRequest("patch", e, n);
    }
    put(e, n) {
      return this.methodRequest("put", e, n);
    }
    delete(e, n) {
      return this.methodRequest("delete", e, n);
    }
    methodRequest(e, n, s) {
      return this.request(Promise.resolve(s).then((i) => ({ method: e, path: n, ...i })));
    }
    request(e, n = null) {
      return new hl(this, this.makeRequest(e, n, void 0));
    }
    async makeRequest(e, n, s) {
      var b, N, x;
      const i = await e;
      let a = qr("maxRetries", i.maxRetries ?? this.maxRetries);
      this.isStreamBody(i.body) && (a = 0), n == null && (n = a, this._requestAuthFlags.delete(i)), await this.prepareOptions(i);
      const { req: o, url: l, timeout: u } = await this.buildRequest(i, {
        retryCount: a - n
      }), d = "log_" + (Math.random() * (1 << 24) | 0).toString(16).padStart(6, "0"), h = s === void 0 ? "" : `, retryOf: ${s}`, g = Date.now();
      if ((b = i.signal) != null && b.aborted)
        throw new ye();
      const f = new AbortController(), m = await this.fetchWithTimeout(l, o, u, f, i, {
        requestLogID: d,
        retryOfRequestLogID: s
      }).catch(Sr), y = Date.now();
      if (m instanceof globalThis.Error) {
        st(f);
        const S = `retrying, ${n} attempts remaining`;
        if ((N = i.signal) != null && N.aborted)
          throw new ye();
        const A = Bt(m) || /timed? ?out/i.test(String(m) + ("cause" in m ? String(m.cause) : "")), P = this.middleware.length > 0 || !!((x = i.middleware) != null && x.length) || this.backendMiddleware().length > 0;
        if (P && !A && !ip(m))
          throw F(this).info(`[${d}] middleware error (not retryable)`), je(F(this), `[${d}] middleware error (not retryable)`, {
            retryOfRequestLogID: s,
            url: l,
            durationMs: y - g,
            message: m.message
          }), m;
        if (n)
          return F(this).info(`[${d}] connection ${A ? "timed out" : "failed"} - ${S}`), je(F(this), `[${d}] connection ${A ? "timed out" : "failed"} (${S})`, {
            retryOfRequestLogID: s,
            url: l,
            durationMs: y - g,
            message: m.message
          }), this.retryRequest(i, n, s ?? d);
        throw F(this).info(`[${d}] connection ${A ? "timed out" : "failed"} - error; no more retries left`), je(F(this), `[${d}] connection ${A ? "timed out" : "failed"} (error; no more retries left)`, {
          retryOfRequestLogID: s,
          url: l,
          durationMs: y - g,
          message: m.message
        }), A ? new ea() : P && !ul(m) ? m : new vn({ cause: m });
      }
      const v = [...m.headers.entries()].filter(([S]) => S === "request-id" || S === "anthropic-workspace-id").map(([S, A]) => ", " + S + ": " + JSON.stringify(A)).join(""), T = `[${d}${h}${v}] ${o.method} ${l} ${m.ok ? "succeeded" : "failed"} with status ${m.status} in ${y - g}ms`;
      if (!m.ok) {
        const S = await this.shouldRetry(m, i);
        if (n && S) {
          const Y = `retrying, ${n} attempts remaining`;
          return await Ef(m.body), st(f), F(this).info(`${T} - ${Y}`), je(F(this), `[${d}] response error (${Y})`, {
            retryOfRequestLogID: s,
            url: m.url,
            status: m.status,
            headers: m.headers,
            durationMs: y - g
          }), this.retryRequest(i, n, s ?? d, m.headers);
        }
        const A = S ? "error; no more retries left" : "error; not retryable";
        F(this).info(`${T} - ${A}`);
        const P = await m.text().catch((Y) => Sr(Y).message), U = zc(P), j = U ? void 0 : P;
        throw je(F(this), `[${d}] response error (${A})`, {
          retryOfRequestLogID: s,
          url: m.url,
          status: m.status,
          headers: m.headers,
          message: j,
          durationMs: Date.now() - g
        }), st(f), this.makeStatusError(m.status, U, j, m.headers);
      }
      return F(this).info(T), je(F(this), `[${d}] response start`, {
        retryOfRequestLogID: s,
        url: m.url,
        status: m.status,
        headers: m.headers,
        durationMs: y - g
      }), yf(m.body ?? m, f), { response: m, options: i, controller: f, requestLogID: d, retryOfRequestLogID: s, startTime: g };
    }
    getAPIList(e, n, s) {
      return this.requestAPIList(n, s && "then" in s ? s.then((i) => ({ method: "get", path: e, ...i })) : { method: "get", path: e, ...s });
    }
    requestAPIList(e, n) {
      const s = this.makeRequest(n, null, void 0);
      return new cp(this, s, e);
    }
    async fetchWithTimeout(e, n, s, i, a, o) {
      const { signal: l, method: u, ...d } = n || {}, h = this._makeAbort(i);
      l && (l.addEventListener("abort", h, { once: !0 }), wf(i, l, h));
      const g = globalThis.ReadableStream && d.body instanceof globalThis.ReadableStream || typeof d.body == "object" && d.body !== null && Symbol.asyncIterator in d.body, f = {
        signal: i.signal,
        ...g ? { duplex: "half" } : {},
        method: "GET",
        ...d
      };
      u && (f.method = u.toUpperCase());
      const m = this.fetch, y = async (x, S) => {
        const A = setTimeout(h, s);
        try {
          return await m.call(void 0, x, S);
        } finally {
          clearTimeout(A);
        }
      }, v = a === void 0 ? y : async (x, S = {}) => {
        const A = typeof x == "string" ? x : x instanceof URL ? x.href : x.url;
        return S.headers = S.headers instanceof Headers ? S.headers : new Headers(S.headers), await this.prepareRequest(S, { url: A, options: a }), o && je(F(this), `[${o.requestLogID}] sending request`, {
          retryOfRequestLogID: o.retryOfRequestLogID,
          method: S.method,
          url: A,
          options: a,
          headers: S.headers
        }), y(x, S);
      }, T = a == null ? void 0 : a.middleware, b = this.backendMiddleware(), N = T != null && T.length || b.length ? [...this.middleware, ...T ?? [], ...b] : this.middleware;
      return await _a(v, N, a, this)(e, f);
    }
    async shouldRetry(e, n) {
      const s = this._authFlags(n);
      if (e.status === 401 && this._authState.tokenCache && s.usedTokenCache && !s.didRefreshFor401)
        return s.didRefreshFor401 = !0, this._authState.tokenCache.invalidate(), !0;
      const i = e.headers.get("x-should-retry");
      return i === "true" ? !0 : i === "false" ? !1 : e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
    }
    async retryRequest(e, n, s, i) {
      let a;
      const o = i == null ? void 0 : i.get("retry-after-ms");
      if (o) {
        const u = parseFloat(o);
        Number.isNaN(u) || (a = u);
      }
      const l = i == null ? void 0 : i.get("retry-after");
      if (l && !a) {
        const u = parseFloat(l);
        Number.isNaN(u) ? a = Date.parse(l) - Date.now() : a = u * 1e3;
      }
      if (a === void 0 || !(a > 0 && a <= 2 ** 31 - 1)) {
        const u = e.maxRetries ?? this.maxRetries;
        a = this.calculateDefaultRetryTimeoutMillis(n, u);
      }
      return await rt(a, e.signal ?? void 0), this.makeRequest(e, n - 1, s);
    }
    calculateDefaultRetryTimeoutMillis(e, n) {
      const a = n - e, o = Math.min(0.5 * Math.pow(2, a), 8), l = 1 - Math.random() * 0.25;
      return o * l * 1e3;
    }
    calculateNonstreamingTimeout(e, n) {
      if (36e5 * e / 128e3 > 6e5 || n != null && e > n)
        throw new E("Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details");
      return 6e5;
    }
    async buildRequest(e, { retryCount: n = 0 } = {}) {
      const s = { ...e }, { method: i, path: a, query: o, defaultBaseURL: l } = s;
      this._authState.resolution && await this._authState.resolution, !this._baseURLIsExplicit && this._authState.baseURL && this.baseURL !== this._authState.baseURL && (this.baseURL = this._authState.baseURL);
      const u = this.buildURL(a, o, l);
      "timeout" in s && qr("timeout", s.timeout), s.timeout = s.timeout ?? this.timeout;
      const { bodyHeaders: d, body: h } = this.buildBody({ options: s }), g = await this.buildHeaders({ options: e, method: i, bodyHeaders: d, retryCount: n });
      return { req: {
        method: i,
        headers: g,
        ...s.signal && { signal: s.signal },
        ...globalThis.ReadableStream && h instanceof globalThis.ReadableStream && { duplex: "half" },
        ...h && { body: h },
        ...this.fetchOptions ?? {},
        ...s.fetchOptions ?? {}
      }, url: u, timeout: s.timeout };
    }
    async buildHeaders({ options: e, method: n, bodyHeaders: s, retryCount: i }) {
      const a = p([
        {
          Accept: "application/json",
          "User-Agent": this.getUserAgent(),
          "X-Stainless-Retry-Count": String(i),
          ...e.timeout ? { "X-Stainless-Timeout": String(Math.trunc(e.timeout / 1e3)) } : {},
          ...ci(),
          ...this._options.dangerouslyAllowBrowser ? { "anthropic-dangerous-direct-browser-access": "true" } : void 0,
          "anthropic-version": "2023-06-01"
        },
        await this.authHeaders(e),
        this._options.defaultHeaders,
        s,
        e.headers
      ]);
      return this.validateHeaders(a), a.values;
    }
    _makeAbort(e) {
      return () => e.abort();
    }
    buildBody({ options: { body: e, headers: n } }) {
      if (!e)
        return { bodyHeaders: void 0, body: void 0 };
      const s = p([n]);
      return (
        // Pass raw type verbatim
        ArrayBuffer.isView(e) || e instanceof ArrayBuffer || e instanceof DataView || typeof e == "string" && // Preserve legacy string encoding behavior for now
        s.values.has("content-type") || // `Blob` is superset of `File`
        globalThis.Blob && e instanceof globalThis.Blob || // `FormData` -> `multipart/form-data`
        e instanceof FormData || // `URLSearchParams` -> `application/x-www-form-urlencoded`
        e instanceof URLSearchParams || // Send chunked stream (each chunk has own `length`)
        globalThis.ReadableStream && e instanceof globalThis.ReadableStream ? { bodyHeaders: void 0, body: e } : this.isStreamBody(e) ? { bodyHeaders: void 0, body: Kc(e) } : typeof e == "object" && s.values.get("content-type") === "application/x-www-form-urlencoded" ? {
          bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
          body: this.stringifyQuery(e)
        } : c(this, dr, "f").call(this, { body: e, headers: s })
      );
    }
    /**
     * Whether `body` is sent as a stream, which can be read only once:
     * a `ReadableStream`, an async iterable or an iterator.
     */
    isStreamBody(e) {
      return globalThis.ReadableStream && e instanceof globalThis.ReadableStream ? !0 : typeof e == "object" && e !== null && (Symbol.asyncIterator in e || Symbol.iterator in e && "next" in e && typeof e.next == "function");
    }
  }
  return ys = r, dr = /* @__PURE__ */ new WeakMap(), ws = /* @__PURE__ */ new WeakSet(), Jo = function() {
    return this.baseURL !== "https://api.anthropic.com";
  }, r.Anthropic = ys, r.HUMAN_PROMPT = kg, r.AI_PROMPT = vg, r.DEFAULT_TIMEOUT = 6e5, r.AnthropicError = E, r.APIError = K, r.APIConnectionError = vn, r.APIConnectionTimeoutError = ea, r.APIUserAbortError = ye, r.NotFoundError = Wc, r.ConflictError = Dc, r.RateLimitError = qc, r.BadRequestError = jc, r.AuthenticationError = Bc, r.InternalServerError = Vc, r.PermissionDeniedError = Uc, r.UnprocessableEntityError = Hc, r.toFile = pp, r;
})(), Te = /* @__PURE__ */ (() => {
  class r extends Tg {
    constructor() {
      super(...arguments), this.completions = new Bo(this), this.messages = new Vo(this), this.models = new Xo(this), this.files = new Uo(this), this.skills = new Yo(this), this.beta = new jo(this);
    }
  }
  return r.Completions = Bo, r.Messages = Vo, r.Models = Xo, r.Files = Uo, r.Skills = Yo, r.Beta = jo, r;
})();
const Or = () => O.join(at.getPath("userData"), "anthropic-key.enc");
let Nt = null;
function Nn() {
  return _r.isEncryptionAvailable() ? !(process.platform === "linux" && _r.getSelectedStorageBackend() === "basic_text") : !1;
}
function Bl() {
  return tc(Or());
}
async function xg(r) {
  if (!Nn()) throw new Error("This system cannot encrypt the key");
  await Ir(Or(), _r.encryptString(r), { mode: 384 }), Nt = null;
}
async function Ag() {
  await Js(Or(), { force: !0 }), Nt = null;
}
async function Rg() {
  if (Nt) return Nt;
  if (!Bl() || !Nn()) return null;
  let r;
  try {
    r = _r.decryptString(await Ks(Or()));
  } catch {
    return null;
  }
  return Nt = new Te({ apiKey: r, authToken: null, maxRetries: 2, timeout: 6e4 }), Nt;
}
const W = (r, t, e = {}) => ({
  ok: !1,
  error: { code: r, message: t, ...e }
});
async function Ul() {
  if (!Re().aiEnabled) return W("disabled", "AI features are turned off in Settings.");
  if (!Nn()) return W("no_encryption", "This system cannot store the API key securely.");
  const r = await Rg();
  return r ? Zo.isOnline() ? { ok: !0, value: r } : W("offline", "No internet connection. AI features need to reach Anthropic.") : W("no_key", "Add an Anthropic API key in Settings to use AI features.");
}
function Wl(r) {
  var t;
  if (r instanceof Te.AuthenticationError)
    return W("invalid_key", "Anthropic rejected the API key. Check it in Settings.");
  if (r instanceof Te.PermissionDeniedError)
    return W("invalid_key", "This API key is not allowed to use that model.");
  if (r instanceof Te.NotFoundError)
    return W("invalid_key", "The chosen model is not available to this API key.");
  if (r instanceof Te.RateLimitError) {
    const e = Number((t = r.headers) == null ? void 0 : t.get("retry-after"));
    return W(
      "rate_limited",
      Number.isFinite(e) && e > 0 ? `Too many AI requests. Try again in ${Math.ceil(e)} seconds.` : "Too many AI requests. Wait a moment and try again.",
      Number.isFinite(e) && e > 0 ? { retryAfterSeconds: Math.ceil(e) } : {}
    );
  }
  return r instanceof Te.BadRequestError ? W("bad_request", "Anthropic could not process that request. It may be too long.") : r instanceof Te.InternalServerError ? W("unavailable", "Anthropic is busy or having trouble right now. Try again shortly.") : r instanceof Te.APIConnectionTimeoutError ? W("offline", "Anthropic took too long to answer. Check the internet connection and try again.") : r instanceof Te.APIConnectionError ? W("offline", "Could not reach Anthropic. Check the internet connection.") : r instanceof Te.APIError ? r.status === 402 ? W("billing", "The Anthropic account has a billing problem.") : W("unavailable", `Anthropic returned an error (${r.status ?? "unknown"}). Try again shortly.`) : (console.error("AI request failed", r), W("unavailable", "The AI request failed unexpectedly."));
}
async function Ig() {
  const r = await Ul();
  if (!r.ok) return r;
  try {
    return { ok: !0, value: { model: (await r.value.models.retrieve(Re().aiModel)).display_name } };
  } catch (t) {
    return Wl(t);
  }
}
const Go = 2e4;
function bs(r, t) {
  const e = r == null ? void 0 : r[t];
  if (typeof e != "string" || !e.trim()) throw new Error(`Missing ${t}`);
  if (e.length > Go) throw new Error(`${t} is longer than ${Go} characters`);
  return e.trim();
}
const ur = (r) => ({
  type: "object",
  properties: r,
  required: Object.keys(r),
  additionalProperties: !1
}), Dl = {
  formatLyrics: {
    system: 'You format worship song lyrics for a church presentation app. Put each section under a label line such as [Verse 1], [Pre-Chorus], [Chorus], [Bridge] or [Tag]. Within a section, put a blank line between slides, keeping two to four lines per slide. Keep every word of the lyrics exactly as given: do not rewrite, translate, add or drop lines. Remove chord symbols, section numbers written as text, and stray notes such as "x2" or "repeat". Return only the formatted lyrics.',
    prompt: (r) => `Format these lyrics:

${bs(r, "lyrics")}`,
    schema: ur({ lyrics: { type: "string" } }),
    maxTokens: 8e3,
    check: (r) => {
      const t = r.lyrics;
      if (typeof t != "string" || !t.trim()) throw new Error("No lyrics came back");
      return { lyrics: t.trim() };
    }
  },
  suggestScripture: {
    system: 'You help a church team choose Bible readings. Suggest three to six passages that fit the theme, from both Testaments where it fits. Give each reference in a standard form such as "John 3:16-18" or "Psalm 23" (book, chapter, and optionally verses) and a one-sentence reason it fits. Do not quote the verse text.',
    prompt: (r) => `Theme: ${bs(r, "theme")}`,
    schema: ur({
      suggestions: { type: "array", items: ur({ reference: { type: "string" }, reason: { type: "string" } }) }
    }),
    maxTokens: 2e3,
    check: (r) => {
      const t = r.suggestions;
      if (!Array.isArray(t)) throw new Error("No suggestions came back");
      return {
        suggestions: t.filter((e) => typeof (e == null ? void 0 : e.reference) == "string" && typeof (e == null ? void 0 : e.reason) == "string").slice(0, 6)
      };
    }
  },
  writeAnnouncement: {
    system: "You write church announcement slides. From the notes, write a short title (at most six words) and slide text: one to three short paragraphs separated by a blank line, each readable from the back of a room. Keep every date, time, place and contact from the notes exactly; do not invent details.",
    prompt: (r) => `Notes:

${bs(r, "notes")}`,
    schema: ur({ title: { type: "string" }, body: { type: "string" } }),
    maxTokens: 2e3,
    check: (r) => {
      const { title: t, body: e } = r;
      if (typeof t != "string" || !t.trim() || typeof e != "string") throw new Error("No announcement came back");
      return { title: t.trim(), body: e.trim() };
    }
  }
}, Ng = (r) => typeof r == "string" && r in Dl;
function Og(r) {
  return r === "claude-sonnet-5-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}
async function Mg(r, t) {
  const e = Dl[r];
  let n;
  try {
    n = e.prompt(t);
  } catch (l) {
    return W("bad_request", l instanceof Error ? l.message : "Invalid input");
  }
  const s = await Ul();
  if (!s.ok) return s;
  const i = Re().aiModel;
  let a;
  try {
    a = await s.value.beta.messages.create({
      model: i,
      max_tokens: e.maxTokens,
      ...Og(i),
      system: e.system,
      // These are short, well-specified jobs, so low effort keeps them quick and cheap.
      output_config: { effort: "low", format: { type: "json_schema", schema: e.schema } },
      messages: [{ role: "user", content: n }]
    });
  } catch (l) {
    return Wl(l);
  }
  if (a.stop_reason === "refusal")
    return W("refused", "The AI declined this request. Try rewording it.");
  if (a.stop_reason === "max_tokens")
    return W("bad_request", "The answer was too long to finish. Try a shorter input.");
  const o = a.content.find((l) => l.type === "text");
  if (!o || o.type !== "text") return W("bad_request", "The AI returned no answer.");
  try {
    return { ok: !0, value: e.check(JSON.parse(o.text)) };
  } catch {
    return W("bad_request", "The AI answer could not be used. Try again.");
  }
}
function Es() {
  const { aiEnabled: r, aiModel: t } = Re();
  return { enabled: r, model: t, hasKey: Bl(), encryptionAvailable: Nn() };
}
function Cg() {
  R.handle("ai:status", () => Es()), R.handle("ai:setKey", async (r, t) => {
    const e = typeof t == "string" ? t.trim() : "";
    return !e || /\s/.test(e) || e.length > 500 ? W("invalid_key", "That does not look like an API key.") : Nn() ? (await xg(e), { ok: !0, value: Es() }) : W("no_encryption", "This system cannot store the API key securely.");
  }), R.handle("ai:clearKey", async () => (await Ag(), Es())), R.handle("ai:test", () => Ig()), R.handle("ai:ask", (r, t, e) => Ng(t) ? Mg(t, e) : W("bad_request", "Unknown AI task."));
}
const Lg = ["show", "black", "clear", "logo"];
let Vs = { mode: "black", text: "", caption: "", theme: xe, fadeMs: 400, logoUrl: null };
function Pg(r) {
  const t = r;
  if (typeof t != "object" || t === null || !Lg.includes(t.mode) || typeof t.text != "string" || typeof t.caption != "string" || typeof t.theme != "object" || typeof t.fadeMs != "number" || !Number.isFinite(t.fadeMs) || t.logoUrl !== null && !(typeof t.logoUrl == "string" && t.logoUrl.startsWith("wd-media://")))
    throw new TypeError("Output state needs a mode, text, caption, theme, fade length and logo (or null)");
  return {
    mode: t.mode,
    text: t.text,
    caption: t.caption,
    theme: ot(t.theme),
    fadeMs: Math.min(1500, Math.max(0, t.fadeMs)),
    logoUrl: t.logoUrl
  };
}
function $g(r) {
  R.on("output:send", (t, e) => {
    var n;
    try {
      Vs = Pg(e);
    } catch (s) {
      console.error(s);
      return;
    }
    (n = r()) == null || n.webContents.send("output:state", Vs);
  });
}
function Fg(r) {
  r.webContents.send("output:state", Vs);
}
const Mr = O.dirname(Xl(import.meta.url));
process.env.APP_ROOT = O.join(Mr, "..");
const $t = process.env.VITE_DEV_SERVER_URL, tm = O.join(process.env.APP_ROOT, "dist-electron"), bi = O.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = $t ? O.join(process.env.APP_ROOT, "public") : bi;
Hh();
let Q, Ae = null, me = null;
function Hl(r, t) {
  $t ? r.loadURL(t ? `${$t}#${t}` : $t) : r.loadFile(O.join(bi, "index.html"), t ? { hash: t } : void 0);
}
function ql() {
  Q = new ct({
    icon: O.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: O.join(Mr, "preload.mjs")
    }
  }), Q.webContents.on("did-finish-load", () => {
    Q == null || Q.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), $t ? Q.loadURL($t) : Q.loadFile(O.join(bi, "index.html")), Q.on("closed", () => {
    Q = null, Ae == null || Ae.close(), me == null || me.close();
  });
}
function jg() {
  const r = Re().outputDisplay;
  if (r === "window") return null;
  const t = mr.getAllDisplays(), e = typeof r == "number" ? t.find((s) => s.id === r) : void 0;
  if (e) return e;
  const n = mr.getPrimaryDisplay().id;
  return t.find((s) => s.id !== n) ?? null;
}
function zs() {
  const r = jg(), t = new ct({
    title: "WorshipDeck Output",
    backgroundColor: "#000",
    ...r ? { ...r.bounds, fullscreen: !0, frame: !1 } : { width: 960, height: 540, resizable: !0 },
    webPreferences: {
      preload: O.join(Mr, "preload.mjs")
    }
  });
  Ae = t, t.webContents.on("did-finish-load", () => Fg(t)), t.on("closed", () => {
    Ae === t && (Ae = null);
  }), Hl(t, "/output");
}
function Bg() {
  if (me) {
    me.focus();
    return;
  }
  const r = new ct({
    title: "WorshipDeck Stage",
    width: 1280,
    height: 720,
    backgroundColor: "#000",
    webPreferences: {
      preload: O.join(Mr, "preload.mjs")
    }
  });
  me = r, r.webContents.on("did-finish-load", () => cf(r)), r.on("closed", () => {
    me === r && (me = null), Q == null || Q.webContents.send("stage:open-changed", !1);
  }), Hl(r, "/stage"), Q == null || Q.webContents.send("stage:open-changed", !0);
}
at.on("window-all-closed", () => {
  process.platform !== "darwin" && (at.quit(), Q = null);
});
at.on("activate", () => {
  ct.getAllWindows().length === 0 && (ql(), zs());
});
at.whenReady().then(() => {
  rd(), qh(), wd(), kd(), jd(), Uh(), Dh(), ef(), rf((r, t) => {
    r.outputDisplay !== t.outputDisplay && (Ae == null || Ae.destroy(), zs());
  }), of({ open: Bg, close: () => me == null ? void 0 : me.close(), getWindow: () => me }), nf(), Cg(), $g(() => Ae), ql(), zs();
});
export {
  E as A,
  Yg as D,
  Ua as M,
  bi as R,
  yi as T,
  $t as V,
  w as _,
  c as a,
  tm as b,
  Gp as c,
  Ps as d,
  ui as e,
  Lt as i,
  F as l,
  Za as p
};
