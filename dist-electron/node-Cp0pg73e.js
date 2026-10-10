import { T as m, A as O, l as ze, e as dt, _ as y, D as ht, c as ft, a, d as mt, i as T, p as Ge } from "./main-Bkw9h2KG.js";
import { M as Ii } from "./main-Bkw9h2KG.js";
import * as I from "node:fs/promises";
import * as A from "node:fs";
import * as f from "node:path";
import * as Me from "node:child_process";
import * as ee from "node:crypto";
import * as ut from "node:readline";
import "node:os";
import * as Te from "node:stream";
import * as yt from "node:util";
function z(s) {
  if (s.inputSchema.type !== "object")
    throw new Error(`JSON schema for tool "${s.name}" must be an object, but got ${s.inputSchema.type}`);
  return {
    type: "custom",
    name: s.name,
    input_schema: s.inputSchema,
    description: s.description,
    run: s.run,
    parse: (e) => e,
    ...s.close ? { close: s.close } : {}
  };
}
const C = A.promises, ke = 448, wt = 384;
function ve(s, e) {
  const t = f.relative(s, e);
  return t === "" || !t.startsWith(".." + f.sep) && t !== ".." && !f.isAbsolute(t);
}
async function He(s, e) {
  for (const t of s)
    if (ve(await le(f.resolve(t)), e))
      return t;
}
const pt = 40;
function ye(s) {
  const e = s == null ? void 0 : s.code;
  return typeof e == "string" ? e : void 0;
}
async function le(s) {
  const e = [];
  let t = s, i = 0;
  for (; ; ) {
    let r;
    try {
      r = await C.realpath(t);
    } catch (n) {
      let o;
      try {
        o = (await C.lstat(t)).isSymbolicLink();
      } catch (c) {
        const l = ye(c);
        if (l !== "ENOENT" && l !== "ENOTDIR")
          throw c;
        const d = f.dirname(t);
        if (d === t)
          throw c;
        e.push(f.basename(t)), t = d;
        continue;
      }
      if (!o)
        throw n;
      if (++i > pt)
        throw Object.assign(new Error("too many levels of symbolic links"), { code: "ELOOP" });
      t = f.resolve(f.dirname(t), await C.readlink(t));
      continue;
    }
    return e.length ? f.join(r, ...e.reverse()) : r;
  }
}
async function _t(s, e, t) {
  const i = (t == null ? void 0 : t.allowedRoots) ?? [], r = await le(f.resolve(s));
  let n;
  try {
    n = await le(f.resolve(r, e));
  } catch (c) {
    throw new m(Q(c, `path ${JSON.stringify(e)}`));
  }
  if (ve(r, n) || await He(i, n) !== void 0)
    return n;
  const o = i.length ? "the session's working directory and its other permitted directories" : "the session's working directory";
  throw new m(`path ${JSON.stringify(e)} is outside ${o}`);
}
async function Ke(s, e) {
  const t = f.dirname(s), i = f.join(t, `.tmp-${process.pid}-${ee.randomUUID()}`), r = await C.stat(s).then((o) => o.mode & 511, () => {
  });
  let n;
  try {
    n = await C.open(i, "wx", wt), r !== void 0 && await n.chmod(r), await n.writeFile(e, "utf-8"), await n.sync(), await n.close(), n = void 0, await C.rename(i, s);
  } catch (o) {
    throw n && await n.close().catch(() => {
    }), await C.unlink(i).catch(() => {
    }), o;
  }
}
function Q(s, e) {
  const t = ye(s);
  switch (t) {
    case "ENOENT":
      return `${e}: no such file or directory`;
    case "EACCES":
    case "EPERM":
      return `${e}: permission denied`;
    case "ENOTDIR":
      return `${e}: not a directory`;
    case "EISDIR":
      return `${e}: is a directory`;
    case "ELOOP":
      return `${e}: too many levels of symbolic links`;
    case "ENAMETOOLONG":
      return `${e}: file name too long`;
    case "ENOSPC":
      return `${e}: no space left on device`;
    case "EMFILE":
    case "ENFILE":
      return `${e}: too many open files`;
    default:
      return `${e}: ${t !== void 0 ? `i/o error (${t})` : "i/o error"}`;
  }
}
const v = A.promises, St = yt.promisify(Me.execFile);
async function bi(s) {
  const { client: e, sessionId: t } = s;
  if (!e)
    return async () => {
    };
  const i = ze(e);
  let r = s.session;
  if (!r) {
    if (t === void 0)
      return async () => {
      };
    i.warn("AgentToolContext.sessionId is deprecated and costs an extra session fetch; fetch the session once and set `session` instead", { component: "agent-tool-context" }), r = await e.beta.sessions.retrieve(t);
  }
  const n = f.resolve(s.workdir, "skills"), o = [];
  for (const c of r.agent.skills)
    try {
      const l = await e.beta.skills.versions.retrieve(c.version, { skill_id: c.skill_id });
      let d = f.basename(l.name.trim());
      (d === "" || d === "." || d === "..") && (d = c.skill_id);
      const h = f.resolve(n, d);
      if (h !== n && !h.startsWith(n + f.sep)) {
        i.warn("skill name escapes the skills dir; skipping", {
          component: "agent-tool-context",
          name: l.name
        });
        continue;
      }
      const w = await e.beta.skills.versions.download(l.id, { skill_id: c.skill_id });
      await v.rm(h, { recursive: !0, force: !0 }), await v.mkdir(h, { recursive: !0, mode: ke }), o.push(h), await kt(w, h), i.info("downloaded skill", {
        component: "agent-tool-context",
        skill_id: c.skill_id,
        version: l.id,
        dest: h
      });
    } catch (l) {
      i.warn("failed to download skill", {
        component: "agent-tool-context",
        skill_id: c.skill_id,
        error: String(l)
      });
    }
  return async () => {
    for (const c of o)
      await v.rm(c, { recursive: !0, force: !0 }).catch((l) => {
        i.warn("failed to clean up skill", { component: "agent-tool-context", dest: c, error: String(l) });
      });
  };
}
function gt(s) {
  for (const e of s) {
    const t = e.trim();
    if (t && (f.isAbsolute(t) || t.split(/[\\/]/).includes("..")))
      throw new O(`refusing to extract unsafe archive member: ${t}`);
  }
}
const Ie = "skill archive listing is inconsistent; refusing to extract", bt = { unzip: /* @__PURE__ */ new Set(["-", "d", "?"]), tar: /* @__PURE__ */ new Set(["-", "d", "C"]) };
function Re(s) {
  const e = s.split(`
`);
  return e[e.length - 1] === "" && e.pop(), e;
}
function Et(s, e) {
  return /^[\x20-\x7E]+$/.test(e) && !/[\\^#]/.test(e) && !(s === "unzip" && e.startsWith("-"));
}
function Ot(s, e, t) {
  const i = Re(e), r = Re(t);
  if (i.length !== r.length)
    throw new O(Ie);
  const n = [], o = [];
  return i.forEach((c, l) => {
    if (bt[s].has(r[l].charAt(0))) {
      n.push(c);
      return;
    }
    if (!Et(s, c))
      throw new O(`refusing to extract archive: cannot safely exclude member ${JSON.stringify(c)}`);
    o.push(c);
  }), { plain: n, special: o };
}
async function Xe(s) {
  for (const e of await v.readdir(s, { withFileTypes: !0 }))
    if (e.isDirectory())
      await Xe(f.join(s, e.name));
    else if (!e.isFile())
      throw new O(Ie);
}
async function _e(s, e) {
  try {
    const { stdout: t } = await St(s, e);
    return t;
  } catch (t) {
    throw ye(t) === "ENOENT" ? new O(`skill extraction requires the \`${s}\` command, but it was not found on PATH`) : t;
  }
}
function Mt(s) {
  let e, t = !1;
  for (const i of s) {
    const r = i.trim().split("/").filter((o) => o !== "" && o !== ".");
    if (r.length === 0)
      continue;
    const n = r[0];
    if (e === void 0)
      e = n;
    else if (n !== e)
      return "";
    r.length > 1 && (t = !0);
  }
  return e !== void 0 && t ? e : "";
}
async function kt(s, e) {
  const t = f.join(e, `.skill-archive-${process.pid}-${Date.now()}`);
  if (!s.body)
    throw new O("skill download response had no body");
  await Te.promises.pipeline(Te.Readable.fromWeb(s.body), A.createWriteStream(t));
  const i = f.join(f.dirname(e), `.skill-stage-${process.pid}-${Date.now()}`), r = f.join(f.dirname(e), `.skill-exclude-${process.pid}-${Date.now()}`);
  try {
    const n = await It(t, 4), o = n.length >= 4 && n[0] === 80 && n[1] === 75 && n[2] === 3 && n[3] === 4, c = o ? "unzip" : "tar", l = await _e(c, o ? ["-Z1", t] : ["-tf", t]), d = await _e(c, o ? ["-Z", "--h", "--t", t] : ["-tvf", t]), { plain: h, special: w } = Ot(c, l, d);
    gt([...h, ...w]);
    const g = Mt(h);
    await v.mkdir(i, { recursive: !0, mode: ke }), h.length > 0 && await _e(c, await vt(c, t, i, w, r)), await Xe(i);
    const M = g ? f.join(i, g) : i, N = await v.readdir(M).catch((D) => {
      throw ye(D) === "ENOENT" ? new O(Ie) : D;
    });
    for (const D of N)
      await v.rename(f.join(M, D), f.join(e, D));
  } finally {
    await v.rm(t, { force: !0 }), await v.rm(r, { force: !0 }), await v.rm(i, { recursive: !0, force: !0 });
  }
}
async function vt(s, e, t, i, r) {
  const n = i.map((o) => o.replace(/[*?[\\]/g, "\\$&"));
  return s === "unzip" ? ["-oq", e, "-d", t, ...n.length > 0 ? ["-x", ...n] : []] : n.length === 0 ? ["-xf", e, "-C", t] : (await v.writeFile(r, n.join(`
`) + `
`, { flag: "wx", mode: 384 }), ["-xf", e, "-C", t, "-X", r]);
}
async function It(s, e) {
  const t = await v.open(s, "r");
  try {
    const i = Buffer.alloc(e), { bytesRead: r } = await t.read(i, 0, e, 0);
    return i.subarray(0, r);
  } finally {
    await t.close();
  }
}
const S = A.promises, Y = A.constants, Ve = 448, Nt = 384, Tt = 448, Ne = Y.O_NOFOLLOW ?? 0, Rt = Y.O_NONBLOCK ?? 0;
var _ = /* @__PURE__ */ (() => {
  class s extends Error {
    constructor(t, i) {
      super(`path ${JSON.stringify(i)} ${t}`), this.name = "FileStoreError", this.reason = t, this.relPath = i;
    }
  }
  return s.ESCAPES_ROOT = "escapes the store root", s.IS_A_SYMLINK = "is a symlink", s.NOT_A_FILE = "is not a regular file", s.NOT_A_DIRECTORY = "is not a directory", s.NOT_UTF8 = "is not valid utf-8", s.MOVE_DESTINATION_EXISTS = "already exists", s;
})();
function Je(s) {
  return s.startsWith("/") && !s.split("/").includes("..");
}
var Ee = /* @__PURE__ */ (() => {
  class s {
    /** @internal — use {@link FileStore.open} / {@link openFileStore}. */
    constructor(t, i, r = !1) {
      this.hashes = /* @__PURE__ */ new Map(), this.rootPath = t, this.removedOnDispose = i, this.decoder = r ? new TextDecoder("utf-8", { fatal: !0 }) : void 0;
    }
    /** Resolve `root`; creates nothing — only {@link createRoot} makes the folder. */
    static async open(t, i) {
      if (!Lt())
        throw new Error("FileStore requires O_NOFOLLOW support on this platform");
      let r = !1;
      try {
        await S.lstat(t);
      } catch (n) {
        if (n.code !== "ENOENT")
          throw n;
        r = !0;
      }
      return new s(f.resolve(t), r, (i == null ? void 0 : i.utf8) ?? !1);
    }
    /** Create the root directory and any missing ancestors; already existing is fine. */
    async createRoot() {
      await $t(this.rootPath);
    }
    /** The resolved root, and what {@link dispose} will do to it. */
    root() {
      return { path: this.rootPath, removedOnDispose: this.removedOnDispose };
    }
    /**
     * Remove the root iff `open` created it; pre-existing roots are kept.
     *
     * Wired to `Symbol.asyncDispose` at runtime when the host provides it, so
     * `await using` works on engines with explicit resource management.
     */
    async dispose() {
      this.removedOnDispose && await S.rm(this.rootPath, { recursive: !0, force: !0 });
    }
    /**
     * Write `data` (`string` UTF-8 or bytes) atomically to the file at `relPath`.
     *
     * Missing directories below the root are created; a missing root is not —
     * the write fails with `ENOENT`.
     */
    async put(t, i, r) {
      const n = t.replace(/\\/g, "/");
      if (n.endsWith("/") || n.endsWith("/.") || n === "" || n === ".")
        throw new _(_.NOT_A_FILE, t);
      const o = this.resolveUnderRoot(t), c = typeof i == "string" ? dt(i) : i;
      this.requireUtf8(t, c), await Le(this.rootPath, f.dirname(o)), await At(o, c, (r == null ? void 0 : r.executable) ?? !1);
    }
    /** The file's bytes; `null` when absent. */
    async get(t) {
      const i = this.resolveUnderRoot(t);
      let r;
      try {
        r = await Ze(t, i);
      } catch (o) {
        if (o.code === "ENOENT")
          return null;
        throw o;
      }
      let n;
      try {
        const o = await r.readFile();
        n = new Uint8Array(o.buffer, o.byteOffset, o.byteLength);
      } finally {
        await r.close();
      }
      return this.requireUtf8(t, n), n;
    }
    /** The relative path of every file under the directory `under`. */
    async ls(t = "/") {
      const i = this.resolveUnderRoot(t);
      return new Set((await $e(this.rootPath, t, i)).map(([r]) => r));
    }
    /**
     * Every symlink under `under` — listings skip them and reads refuse them,
     * so a caller that must know they exist asks here.
     */
    async findSymlinks(t = "/") {
      const i = this.resolveUnderRoot(t);
      return Ft(this.rootPath, t, i);
    }
    /**
     * `{relPath: sha256Hex}` of every file under the directory `under`.
     *
     * Unchanged files — same size, mtime, and ctime since the last call —
     * reuse their recorded hash instead of being re-read.
     */
    async hashtree(t = "/") {
      const i = this.resolveUnderRoot(t), r = oe.nowNs(), n = /* @__PURE__ */ Object.create(null);
      for (const [o, c] of await $e(this.rootPath, t, i)) {
        const l = await this.hashViaCache(o, c, r);
        l !== null && (n[o] = l);
      }
      return n;
    }
    /** One file's sha256; `null` when absent. Shares {@link hashtree}'s cache. */
    async hashFile(t) {
      const i = this.resolveUnderRoot(t);
      let r;
      try {
        r = await S.lstat(i, { bigint: !0 });
      } catch (o) {
        if (o.code === "ENOENT")
          return null;
        throw o;
      }
      if (r.isSymbolicLink())
        throw new _(_.IS_A_SYMLINK, t);
      if (!r.isFile())
        throw new _(_.NOT_A_FILE, t);
      const n = f.relative(this.rootPath, i).split(f.sep).join("/");
      return this.hashViaCache(n, i, oe.nowNs());
    }
    /**
     * Rename `src` to `dst`; an existing `dst` is refused. The banned store
     * root as either end does nothing.
     */
    async move(t, i) {
      const r = this.resolveUnderRoot(t), n = this.resolveUnderRoot(i);
      if (r === this.rootPath || n === this.rootPath)
        return;
      if (await S.stat(n).then(() => !0, () => !1))
        throw new _(_.MOVE_DESTINATION_EXISTS, i);
      await Le(this.rootPath, f.dirname(n)), await S.rename(r, n);
    }
    /** Delete a file or subtree; absent — and the banned store root — do nothing. */
    async remove(t) {
      const i = this.resolveUnderRoot(t);
      if (i === this.rootPath)
        return;
      let r;
      try {
        r = await S.lstat(i, { bigint: !0 });
      } catch (n) {
        if (n.code === "ENOENT")
          return;
        throw n;
      }
      if (r.isDirectory())
        await S.rm(i, { recursive: !0, force: !0 });
      else
        try {
          await S.unlink(i);
        } catch (n) {
          if (n.code !== "ENOENT")
            throw n;
        }
    }
    resolveUnderRoot(t) {
      const i = t.replace(/\\/g, "/").replace(/^\/+/, ""), r = i.split("/").filter((n) => n !== "" && n !== ".");
      if (f.posix.isAbsolute(i) || r.includes(".."))
        throw new _(_.ESCAPES_ROOT, t);
      return r.length === 0 ? this.rootPath : f.join(this.rootPath, ...r);
    }
    requireUtf8(t, i) {
      if (this.decoder)
        try {
          this.decoder.decode(i);
        } catch {
          throw new _(_.NOT_UTF8, t);
        }
    }
    async hashViaCache(t, i, r) {
      let n;
      try {
        n = await S.lstat(i, { bigint: !0 });
      } catch (l) {
        if (l.code === "ENOENT")
          return null;
        throw l;
      }
      if (!n.isFile())
        return null;
      const o = this.hashes.get(t);
      let c;
      if (o !== void 0 && Ct(o, n))
        c = o.sha;
      else
        try {
          c = await oe.hashFile(i);
        } catch (l) {
          const d = l.code;
          if (d === "ENOENT" || l instanceof _ || d === "ELOOP" || d === "EMLINK")
            return null;
          throw l;
        }
      return Wt(n, r) && this.hashes.set(t, { mtimeNs: n.mtimeNs, ctimeNs: n.ctimeNs, size: n.size, sha: c }), c;
    }
  }
  return s.isPathLegal = Je, s;
})();
function Lt() {
  return Ne !== 0;
}
async function $t(s) {
  const e = [];
  let t = s;
  for (; ; ) {
    try {
      await S.stat(t);
      break;
    } catch (r) {
      const n = r.code;
      if (n !== "ENOENT" && n !== "ENOTDIR" && n !== "ELOOP")
        throw r;
    }
    e.push(t);
    const i = f.dirname(t);
    if (i === t)
      break;
    t = i;
  }
  for (const i of e.reverse())
    try {
      await S.mkdir(i, { mode: Ve });
    } catch (r) {
      if (r.code !== "EEXIST")
        throw r;
    }
}
async function Le(s, e) {
  const t = f.relative(s, e);
  if (t === "")
    return;
  let i = s;
  for (const r of t.split(f.sep)) {
    i = f.join(i, r);
    try {
      await S.mkdir(i, { mode: Ve });
    } catch (n) {
      if (n.code !== "EEXIST")
        throw n;
    }
  }
}
async function At(s, e, t) {
  const i = t ? Tt : Nt, r = f.join(f.dirname(s), `.fs-${ee.randomBytes(8).toString("hex")}.tmp`);
  let n;
  try {
    n = await S.open(r, Y.O_WRONLY | Y.O_CREAT | Y.O_EXCL | Ne, i), await n.writeFile(e), await n.close(), n = void 0, await S.rename(r, s);
  } catch (o) {
    throw n && await n.close().catch(() => {
    }), await S.unlink(r).catch(() => {
    }), o;
  }
}
async function Ze(s, e) {
  let t;
  try {
    t = await S.open(e, Y.O_RDONLY | Ne | Rt);
  } catch (i) {
    const r = i.code;
    throw r === "ELOOP" || r === "EMLINK" ? new _(_.IS_A_SYMLINK, s) : i;
  }
  try {
    if (!(await t.stat()).isFile())
      throw new _(_.NOT_A_FILE, s);
  } catch (i) {
    throw await t.close().catch(() => {
    }), i;
  }
  return t;
}
async function Dt(s) {
  const e = ee.createHash("sha256"), t = await Ze(f.basename(s), s), i = new Uint8Array(1024 * 1024);
  try {
    for (; ; ) {
      const { bytesRead: r } = await t.read(i, 0, i.length);
      if (r === 0)
        break;
      e.update(i.subarray(0, r));
    }
  } finally {
    await t.close();
  }
  return e.digest("hex");
}
async function $e(s, e, t) {
  if (!await Pt(e, t))
    return [];
  const i = [];
  return await Qe(t, (r, n) => {
    n.isFile() && i.push([f.relative(s, r).split(f.sep).join("/"), r]);
  }), i.sort(), i;
}
async function Ft(s, e, t) {
  const i = (o) => f.relative(s, o).split(f.sep).join("/");
  let r;
  try {
    r = await S.lstat(t, { bigint: !0 });
  } catch (o) {
    const c = o.code;
    if (c === "ENOENT" || c === "ENOTDIR")
      return /* @__PURE__ */ new Set();
    throw o;
  }
  if (r.isSymbolicLink())
    return /* @__PURE__ */ new Set([i(t)]);
  if (!r.isDirectory())
    throw new _(_.NOT_A_DIRECTORY, e);
  const n = /* @__PURE__ */ new Set();
  return await Qe(t, (o, c) => {
    c.isSymbolicLink() && n.add(i(o));
  }), n;
}
async function Pt(s, e) {
  let t;
  try {
    t = await S.lstat(e, { bigint: !0 });
  } catch (i) {
    const r = i.code;
    if (r === "ENOENT" || r === "ENOTDIR")
      return !1;
    throw i;
  }
  if (!t.isDirectory())
    throw new _(_.NOT_A_DIRECTORY, s);
  return !0;
}
async function Qe(s, e) {
  const t = [s];
  for (; t.length; ) {
    const i = t.pop();
    let r;
    try {
      r = await S.readdir(i, { withFileTypes: !0 });
    } catch (n) {
      if (n.code === "ENOENT")
        continue;
      throw n;
    }
    for (const n of r) {
      const o = f.join(i, n.name);
      e(o, n), n.isDirectory() && !n.isSymbolicLink() && t.push(o);
    }
  }
}
function Ct(s, e) {
  return e.mtimeNs === s.mtimeNs && e.ctimeNs === s.ctimeNs && e.size === s.size;
}
function Wt(s, e) {
  return (s.mtimeNs > s.ctimeNs ? s.mtimeNs : s.ctimeNs) < e - oe.timestampTrustMarginNs;
}
const jt = 2000000000n, oe = {
  hashFile: Dt,
  timestampTrustMarginNs: jt,
  nowNs: () => BigInt(Date.now()) * 1000000n
}, Ut = Ee, Ae = Symbol.asyncDispose;
Ae && Object.defineProperty(Ee.prototype, Ae, {
  value: Ee.prototype.dispose,
  configurable: !0,
  writable: !0
});
var p, L, de, K, he, u, x, ae, R, et, ce, tt, it, Se, Oe, De, Fe, ge, Pe, Ce, re, ne, We, je;
const Ei = 3e4, G = ".anthropic-memory-store", rt = 1;
function Ue(s) {
  return ee.createHash("sha256").update(`version ${rt}
${s}`, "utf-8").digest("hex");
}
const xt = 3e4, Bt = 100, qt = 20, Yt = 16, zt = 32, Gt = 8, Ht = 50;
class X extends O {
  constructor(e, t) {
    super(e), this.name = "SessionMemoryError", t !== void 0 && (this.cause = t);
  }
}
class Kt {
  constructor(e, t, i) {
    this.mode = e, this.cap = t, this.waiveWindow = i, this.attempted = 0, this.capped = 0, this.suppressed = 0;
  }
  takeSlot() {
    return this.attempted >= this.cap ? (this.capped++, !1) : (this.attempted++, !0);
  }
}
class Oi {
  constructor(e, t) {
    p.add(this), L.set(this, void 0), de.set(this, void 0), K.set(this, void 0), he.set(this, void 0), u.set(this, void 0), x.set(this, void 0), ae.set(this, !1), R.set(this, []), y(this, L, e), y(this, de, t.workdir), y(this, K, t.syncIntervalMs ?? ht), ft(a(this, K, "f"), "syncIntervalMs"), y(this, he, t.syncDeletions ?? "enabled"), y(this, u, ze(e)), y(this, x, Date.now());
  }
  /**
   * Every attached store's root directory.
   *
   * The worker lists these as the file tools' allowed roots so a store
   * mounted outside the workdir stays reachable.
   */
  get roots() {
    return a(this, R, "f").map((e) => e.files.root().path);
  }
  /**
   * Root directories of stores attached read-only.
   *
   * The file tools consult this to refuse writes into read-only stores.
   */
  get readOnlyRoots() {
    return a(this, R, "f").filter((e) => e.readOnly).map((e) => e.files.root().path);
  }
  /**
   * Download every attached store's memories to disk.
   *
   * `session` arrives already fetched — one snapshot shared with the skills
   * download, so the two cannot disagree about the resources.
   */
  async download(e) {
    for (const t of e.resources) {
      if (t.type !== "memory_store")
        continue;
      const i = a(this, p, "m", et).call(this, t);
      let r;
      try {
        if (r = {
          memoryStoreId: t.memory_store_id,
          // utf8: a binary file is refused at put/get, not mid-sync.
          files: await Ut.open(i, { utf8: !0 }),
          readOnly: t.access === "read_only",
          baseline: /* @__PURE__ */ new Map(),
          refusedShas: /* @__PURE__ */ new Map(),
          pendingDeletes: /* @__PURE__ */ new Map()
        }, !r.files.root().removedOnDispose)
          throw new X(`something already exists at the memory store's path: ${i} (memory_store_id=${t.memory_store_id}); it must not exist when the session starts`);
        try {
          await r.files.createRoot();
        } catch (n) {
          throw B(n) ? new X(`cannot create the memory store's folder: ${i} (memory_store_id=${t.memory_store_id}): ${n}; the worker host must make this mount path writable`, n) : n;
        }
        await a(this, p, "m", Oe).call(this, r), a(this, u, "f").info("downloaded memories", {
          count: r.baseline.size,
          memory_store_id: r.memoryStoreId,
          dest: r.files.root().path
        }), a(this, R, "f").push(r);
      } catch (n) {
        throw r && await r.files.dispose().catch(() => {
        }), n instanceof X ? n : new X(`failed to download memory store memory_store_id=${t.memory_store_id}: ${n}`, n);
      }
    }
    y(this, x, Date.now());
  }
  /**
   * The session's last sync — skips the delete wait, so calling it twice
   * would undo the protection; it throws instead.
   */
  async finish() {
    if (a(this, ae, "f"))
      throw new O("finish() was already called: it is the session's last sync and runs once");
    y(this, ae, !0), await this.syncAll(!0);
  }
  /** @internal — reconcile every store once; the tests' deterministic driver */
  async syncAll(e) {
    await Promise.all(a(this, R, "f").map((t) => a(this, p, "m", tt).call(this, t, e))), y(this, x, Date.now());
  }
  /** Sync when `syncIntervalMs` has elapsed since the last one. Never throws. */
  async syncIfDue() {
    Date.now() - a(this, x, "f") < a(this, K, "f") || await this.syncAll(!1);
  }
  /**
   * Upload new and changed files; send no deletes and pull nothing.
   *
   * The push-only rescue pass for a session ending on an error or
   * cancel — best-effort, bounded by the caller: once `signal` aborts no
   * further upload starts, each store cut off part-way logs how many
   * changed files it had not finished uploading, and this resolves without
   * waiting for requests already in flight. Each store uploads up to
   * {@link UPLOAD_CONCURRENCY} files at a time. Skips read-only stores,
   * refused files, files the server already holds, and folders that fail
   * the marker check. Never throws.
   */
  async flushWrites(e) {
    await Promise.all(a(this, R, "f").map((t) => a(this, p, "m", it).call(this, t, e)));
  }
  /**
   * Remove every store directory that {@link SessionMemoryStores.download}
   * created. Pre-existing directories are left alone — that is
   * {@link FileStore.dispose}'s own rule. A folder that fails the marker
   * check is kept too — sync left it as found, so must dispose.
   */
  async dispose() {
    for (const e of a(this, R, "f")) {
      const t = e.files.root();
      try {
        const i = await a(this, p, "m", ce).call(this, e);
        if (!i.markerOk && Object.keys(i.files).length > 0) {
          a(this, u, "f").warn(`${i.distrustReason}; leaving the memory store folder on disk`, {
            root: t.path,
            memory_store_id: e.memoryStoreId
          });
          continue;
        }
        await e.files.dispose();
      } catch (i) {
        if (!(i instanceof _) && !B(i))
          throw i;
        a(this, u, "f").warn("failed to remove the memory store folder", {
          root: e.files.root().path,
          memory_store_id: e.memoryStoreId,
          error: String(i)
        });
        continue;
      }
      t.removedOnDispose && a(this, u, "f").info("removed memory store dir", {
        dest: t.path,
        memory_store_id: e.memoryStoreId
      });
    }
  }
}
L = /* @__PURE__ */ new WeakMap(), de = /* @__PURE__ */ new WeakMap(), K = /* @__PURE__ */ new WeakMap(), he = /* @__PURE__ */ new WeakMap(), u = /* @__PURE__ */ new WeakMap(), x = /* @__PURE__ */ new WeakMap(), ae = /* @__PURE__ */ new WeakMap(), R = /* @__PURE__ */ new WeakMap(), p = /* @__PURE__ */ new WeakSet(), et = function(e) {
  if (e.mount_path) {
    if (!Je(e.mount_path))
      throw new X(`memory store mount_path is not a clean absolute path: ${JSON.stringify(e.mount_path)} (memory_store_id=${e.memory_store_id})`);
    return e.mount_path;
  }
  return f.join(a(this, de, "f"), "memory", e.name || e.memory_store_id);
}, ce = async function(e) {
  const t = await e.files.hashtree(), i = t[G];
  return delete t[G], i === Ue(e.memoryStoreId) ? { files: t, markerOk: !0, distrustReason: null } : {
    files: t,
    markerOk: !1,
    distrustReason: i !== void 0 ? "the marker file does not match this store" : "the marker file is gone"
  };
}, tt = async function(e, t) {
  try {
    const i = await a(this, p, "m", ce).call(this, e), r = i.files;
    if (!i.markerOk) {
      if (Object.keys(r).length > 0) {
        a(this, u, "f").warn(`${i.distrustReason}; leaving the memory store folder as found and not syncing`, {
          root: e.files.root().path,
          memory_store_id: e.memoryStoreId
        });
        return;
      }
      await a(this, p, "m", Se).call(this, e, "the folder or its marker is gone");
      return;
    }
    if (Object.keys(r).length === 0 && e.baseline.size > 1) {
      await a(this, p, "m", Se).call(this, e, "every memory file is gone at once");
      return;
    }
    const n = /* @__PURE__ */ new Map();
    for await (const [h, w] of a(this, p, "m", re).call(this, e.memoryStoreId))
      n.set(h, w);
    const o = new Kt(a(this, he, "f"), Math.max(Gt, Math.min(Ht, Math.floor(e.baseline.size / 4))), t), c = [], l = /* @__PURE__ */ new Map(), d = [.../* @__PURE__ */ new Set([...n.keys(), ...Object.keys(r), ...e.baseline.keys()])].sort();
    for (const h of d) {
      const w = n.get(h), g = r[h], M = e.baseline.get(h);
      let N;
      g === void 0 && M !== void 0 && w !== void 0 && w.content_sha256 === M && !e.readOnly ? N = await a(this, p, "m", We).call(this, e, h, w, M, o) : N = await a(this, p, "m", De).call(this, e, h, w, g, c), N !== void 0 && l.set(h, N);
    }
    e.baseline = l, await a(this, p, "m", Pe).call(this, e, c), o.suppressed > 0 && a(this, u, "f").debug("remote deletes are disabled; locally deleted memories stay on the server", {
      count: o.suppressed,
      memory_store_id: e.memoryStoreId
    }), o.capped > 0 && a(this, u, "f").warn(`delete cap reached: ${o.mode === "log_only" ? "would send" : "sent"} ${o.attempted} deletes, held ${o.capped} for later syncs`, { memory_store_id: e.memoryStoreId });
  } catch (i) {
    a(this, u, "f").warn("memory sync failed", { memory_store_id: e.memoryStoreId, error: String(i) });
  }
}, it = async function(e, t) {
  const i = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Set(), n = async () => {
    if (e.readOnly)
      return;
    const o = await a(this, p, "m", ce).call(this, e);
    if (!o.markerOk) {
      a(this, u, "f").warn(`${o.distrustReason}; not uploading anything from the memory store folder`, {
        root: e.files.root().path,
        memory_store_id: e.memoryStoreId
      });
      return;
    }
    for (const [d, h] of Object.entries(o.files))
      h !== e.baseline.get(d) && e.refusedShas.get(d) !== h && (i.set(d, h), r.add(d));
    if (i.size === 0 || t != null && t.aborted)
      return;
    const c = /* @__PURE__ */ new Map();
    for await (const [d, h] of a(this, p, "m", re).call(this, e.memoryStoreId)) {
      if (t != null && t.aborted)
        return;
      c.set(d, h);
    }
    const l = [];
    for (const d of [...i.keys()].sort()) {
      const h = i.get(d), w = e.baseline.get(d), g = c.get(d);
      if (g !== void 0 && g.content_sha256 === h) {
        e.baseline.set(d, g.content_sha256), r.delete(d);
        continue;
      }
      if (g !== void 0 && g.content_sha256 !== w) {
        a(this, u, "f").warn("memory changed both locally and remotely; the flush leaves the remote version", {
          path: d,
          memory_store_id: e.memoryStoreId
        }), r.delete(d);
        continue;
      }
      l.push([d, h, g]);
    }
    await a(this, p, "m", Ce).call(this, e, l, r, t);
  };
  try {
    await Xt(n(), t), t != null && t.aborted && r.size > 0 && a(this, u, "f").warn(`memory flush cut off part-way; ${r.size} of ${i.size} changed files had not finished uploading`, { memory_store_id: e.memoryStoreId });
  } catch (o) {
    a(this, u, "f").warn("memory flush failed", { memory_store_id: e.memoryStoreId, error: String(o) });
  }
}, Se = /** Rebuild a destroyed folder from the server; sends no deletes, no uploads. */
async function(e, t) {
  a(this, u, "f").warn(`${t}; re-downloading the memory store folder instead of syncing`, {
    root: e.files.root().path,
    memory_store_id: e.memoryStoreId
  }), await e.files.createRoot(), await a(this, p, "m", Oe).call(this, e);
}, Oe = /**
 * Write the marker, then pull every remote memory. Baseline is cleared
 * first so a failed write never leaves an entry whose file is not on disk.
 * Every memory is needed here, so the listing carries the content — pages
 * cost far fewer round-trips than a request per memory.
 */
async function(e) {
  e.baseline = /* @__PURE__ */ new Map(), e.pendingDeletes.clear(), await e.files.put(G, `version ${rt}
${e.memoryStoreId}`);
  for await (const [t, i] of a(this, p, "m", re).call(this, e.memoryStoreId, "full"))
    await a(this, p, "m", ge).call(this, e, t, i.content ?? "") && e.baseline.set(t, i.content_sha256);
}, De = /**
 * Reconcile one path. Returns the sha to record in the baseline, or
 * `undefined` to drop the path from it.
 *
 * `pulls` is an output: when the remote version should be written to disk,
 * this appends `[rel, remote]` to it instead of writing — `rel` is the
 * file to write, `remote` the listed memory whose content `#pullAll` will
 * fetch and write there.
 */
async function(e, t, i, r, n) {
  const o = e.baseline.get(t);
  if (r !== void 0 && e.pendingDeletes.delete(t), !i) {
    if (r === void 0) {
      e.pendingDeletes.delete(t);
      return;
    }
    if (o !== void 0) {
      if (r === o) {
        const w = await a(this, p, "m", Fe).call(this, e, t, o);
        if (w === void 0)
          return;
        if (w === o)
          return o;
        r = w;
      }
      e.readOnly ? a(this, u, "f").warn("memory deleted remotely but edited locally; keeping the file, which a read-only store cannot push", { path: t, memory_store_id: e.memoryStoreId }) : e.refusedShas.get(t) !== r && a(this, u, "f").info("memory deleted remotely but edited locally; re-creating it from the file", {
        path: t,
        memory_store_id: e.memoryStoreId
      });
    }
    return e.readOnly || e.refusedShas.get(t) === r ? void 0 : await a(this, p, "m", ne).call(this, e, t, r, void 0);
  }
  const c = i.content_sha256, l = c !== o, d = r !== void 0 && r !== o && r !== c, h = !e.readOnly && d;
  return r === void 0 && o !== void 0 ? (l && (a(this, u, "f").warn("memory deleted locally but changed remotely; restoring the remote version", {
    path: t,
    memory_store_id: e.memoryStoreId
  }), e.pendingDeletes.delete(t), n.push([t, i])), o) : l ? r === c ? c : (d && a(this, u, "f").warn("memory changed both locally and remotely; keeping the remote version", {
    path: t,
    memory_store_id: e.memoryStoreId
  }), n.push([t, i]), o) : h ? e.refusedShas.get(t) === r ? c : await a(this, p, "m", ne).call(this, e, t, r, i) ?? c : c;
}, Fe = /**
 * Remove the file for a memory the server no longer has, if it still holds
 * `expectSha`. Returns `undefined` when the file is gone from disk,
 * `expectSha` when it must stay in the baseline (I/O error), or the file's
 * fresh sha when it was edited since the scan.
 */
async function(e, t, i) {
  let r;
  try {
    r = await e.files.hashFile(t);
  } catch (n) {
    if (!(n instanceof _) && !B(n))
      throw n;
    return i;
  }
  if (r !== null) {
    if (r !== i)
      return r;
    try {
      await e.files.remove(t);
    } catch (n) {
      if (!(n instanceof _) && !B(n))
        throw n;
      return a(this, u, "f").warn("failed to remove memory deleted remotely", {
        path: t,
        memory_store_id: e.memoryStoreId,
        error: String(n)
      }), i;
    }
  }
}, ge = /**
 * Write a memory's content to disk; `false` (and a warning) on failure.
 *
 * A `..` component in the wire path reaches here as {@link FileStoreError} —
 * that is the escape guard.
 */
async function(e, t, i) {
  try {
    await e.files.put(t, i);
  } catch (r) {
    if (!(r instanceof _) && !B(r))
      throw r;
    return a(this, u, "f").warn("failed to write memory", {
      path: t,
      memory_store_id: e.memoryStoreId,
      error: String(r)
    }), !1;
  }
  return !0;
}, Pe = /**
 * Fetch and write the given memories, {@link FETCH_CONCURRENCY} at a time.
 *
 * The sync's content pass: the listing carried no content, so each memory
 * is fetched individually and written as it arrives. On success the path's
 * baseline advances; on a failed fetch or write the old entry stays and the
 * next sync retries. A 404 means the memory was deleted after the listing —
 * the next sync reconciles it.
 */
async function(e, t) {
  if (t.length === 0)
    return;
  const i = async (o, c) => {
    let l;
    try {
      l = await a(this, L, "f").beta.memoryStores.memories.retrieve(c.id, {
        memory_store_id: e.memoryStoreId,
        view: "full"
      });
    } catch (d) {
      if (T(d, 404))
        return;
      a(this, u, "f").warn("failed to fetch memory content", {
        path: o,
        memory_store_id: e.memoryStoreId,
        error: String(d)
      });
      return;
    }
    await a(this, p, "m", ge).call(this, e, o, l.content ?? "") && e.baseline.set(o, l.content_sha256);
  }, r = t[Symbol.iterator](), n = async () => {
    for (const [o, c] of r)
      await i(o, c);
  };
  await Promise.all(Array.from({ length: Math.min(Yt, t.length) }, n));
}, Ce = /**
 * Upload the given files, {@link UPLOAD_CONCURRENCY} at a time, taking each
 * path off `unsent` as its upload returns. No upload starts once `signal`
 * aborts; the ones already in flight run to completion.
 */
async function(e, t, i, r) {
  const n = t[Symbol.iterator](), o = async () => {
    for (const [c, l, d] of n) {
      if (r != null && r.aborted)
        return;
      const h = await a(this, p, "m", ne).call(this, e, c, l, d);
      i.delete(c), h !== void 0 && e.baseline.set(c, h);
    }
  };
  await Promise.all(Array.from({ length: Math.min(zt, t.length) }, o));
}, re = /**
 * The store's memories keyed by relative path (the wire path's leading `/`
 * stripped — `#upload` re-prefixes it) — `basic` view (shas, no content) at
 * {@link LIST_PAGE_SIZE} per page unless the caller needs `full` pages.
 * `memory_prefix` rollups and the reserved marker path are skipped.
 */
async function* (e, t = "basic") {
  const i = t === "basic" ? Bt : qt;
  for await (const r of a(this, L, "f").beta.memoryStores.memories.list(e, { view: t, limit: i })) {
    if (r.type !== "memory")
      continue;
    const n = r.path.replace(/^\/+/, "");
    if (n === G) {
      a(this, u, "f").warn("the server listed the reserved marker path; skipping", {
        path: r.path,
        memory_store_id: e
      });
      continue;
    }
    yield [n, r];
  }
}, ne = /**
 * Push one local file; `undefined` keeps the old baseline so the next pass retries.
 *
 * A refusal the server would repeat (400/413, the utf-8 gate) enters
 * `refusedShas`: warned once, retried only after the file changes.
 */
async function s(e, t, i, r) {
  try {
    const n = await e.files.get(t);
    if (n === null)
      return;
    const o = mt(n), c = r ? await a(this, L, "f").beta.memoryStores.memories.update(r.id, {
      memory_store_id: e.memoryStoreId,
      content: o,
      precondition: { type: "content_sha256", content_sha256: r.content_sha256 }
    }) : await a(this, L, "f").beta.memoryStores.memories.create(e.memoryStoreId, {
      path: "/" + t,
      content: o
    });
    return e.refusedShas.delete(t), c.content_sha256;
  } catch (n) {
    if (r && T(n, 404))
      return await a(this, p, "m", s).call(this, e, t, i, void 0);
    const o = n instanceof _ || T(n, 400) || T(n, 413);
    r && T(n, 409) ? a(this, u, "f").warn("memory changed both locally and remotely; the upload was refused and the local edit loses", {
      path: t,
      memory_store_id: e.memoryStoreId
    }) : o && i !== void 0 ? (e.refusedShas.set(t, i), a(this, u, "f").warn("the server rejected this memory file, so it stays un-synced until its content changes", { path: t, memory_store_id: e.memoryStoreId, rejection: String(n) })) : a(this, u, "f").warn("failed to upload memory", {
      path: t,
      memory_store_id: e.memoryStoreId,
      error: String(n)
    });
    return;
  }
}, We = /** Send the server delete only after the wait, the cap, and a fresh re-check all clear. */
async function(e, t, i, r, n) {
  if (n.mode === "disabled")
    return n.suppressed++, r;
  let o = e.pendingDeletes.get(t);
  if (o === void 0 && (o = Date.now(), e.pendingDeletes.set(t, o)), !n.waiveWindow && Date.now() - o < xt)
    return r;
  let c, l;
  try {
    c = await e.files.hashFile(G) === Ue(e.memoryStoreId), l = await e.files.hashFile(t) === null;
  } catch (h) {
    if (!(h instanceof _) && !B(h))
      throw h;
    c = l = !1;
  }
  if (!c)
    return r;
  if (!l)
    return e.pendingDeletes.delete(t), r;
  if (!n.takeSlot())
    return r;
  if (n.mode === "log_only")
    return a(this, u, "f").info("log-only: sync would delete this memory on the server", {
      path: t,
      memory_store_id: e.memoryStoreId
    }), r;
  const d = await a(this, p, "m", je).call(this, e, t, i, r);
  return d === void 0 && e.pendingDeletes.delete(t), d;
}, je = async function(e, t, i, r) {
  try {
    await a(this, L, "f").beta.memoryStores.memories.delete(i.id, {
      memory_store_id: e.memoryStoreId,
      expected_content_sha256: r
    });
  } catch (n) {
    return T(n, 404) ? void 0 : (T(n, 409) || T(n, 412) ? a(this, u, "f").warn("memory deleted locally but changed remotely; keeping the remote version", {
      path: t,
      memory_store_id: e.memoryStoreId
    }) : a(this, u, "f").warn("failed to delete memory", {
      path: t,
      memory_store_id: e.memoryStoreId,
      error: String(n)
    }), r);
  }
  a(this, u, "f").info("propagated local deletion", { path: t, memory_store_id: e.memoryStoreId });
};
function B(s) {
  return typeof s == "object" && s !== null && typeof s.code == "string";
}
async function Xt(s, e) {
  if (!e) {
    await s;
    return;
  }
  let t;
  const i = new Promise((r) => {
    t = r, e.aborted && r();
  });
  e.addEventListener("abort", t, { once: !0 });
  try {
    await Promise.race([s, i]);
  } finally {
    e.removeEventListener("abort", t);
  }
}
var se, b, E, H, F, k, be, fe, V, me, ue, W, j, q, P, J, $, nt, xe;
const Be = 100 * 1024, st = 12e4, Vt = 256 * 1024, Jt = 64 * 1024, qe = Buffer.from(`
`), Z = 100 * 1024, Zt = 2e3, Qt = 200;
class ei extends O {
  constructor(e) {
    super(`bash command timed out after ${e}ms`), this.name = "BashTimeoutError", this.timeoutMs = e;
  }
}
const ti = /\x1b\[[0-9;?]*[ -/]*[@-~]/g, ii = I.glob;
function ot(s) {
  return s === void 0 ? Vt : s;
}
function U(s) {
  if (s !== void 0)
    throw new O("The `unrestrictedPaths` option you passed to the agent toolset (AgentToolContext) is no longer supported. The toolset's file tools (read, write, edit, glob, grep) are now always confined to the working directory plus the directories listed in `allowedRoots`. Remove `unrestrictedPaths` from your context; to let the file tools reach any other directory, add it to `allowedRoots`.");
}
function Mi(s) {
  return [
    si(s),
    oi(s),
    li(s),
    di(s),
    fi(s),
    mi(s)
  ];
}
async function te(s, e) {
  return U(s.unrestrictedPaths), _t(s.workdir, e, { allowedRoots: s.allowedRoots ?? [] });
}
function at(s, e) {
  return He(s.readOnlyRoots ?? [], e);
}
function ri() {
  const s = {};
  for (const [e, t] of Object.entries(process.env))
    e.startsWith("ANTHROPIC_") || (s[e] = t);
  return s;
}
var ni = /* @__PURE__ */ (() => {
  class s {
    constructor(t, i = ri()) {
      se.add(this), b.set(this, void 0), E.set(this, ""), H.set(this, !1), F.set(this, !1), k.set(this, null), y(this, b, Me.spawn("/bin/bash", ["--noprofile", "--norc"], {
        cwd: t,
        // `env` is the full base environment (the scrubbed process env by
        // default, or the verbatim replacement from `AgentToolContext.env`).
        // PS1/PS2/TERM are shell-control settings BashSession always applies so
        // the pipe-based sentinel exec parsing works — not part of the
        // user-facing environment.
        env: { ...i, PS1: "", PS2: "", TERM: "dumb" },
        stdio: ["pipe", "pipe", "pipe"],
        detached: !0
      })), a(this, b, "f").stdout.setEncoding("utf8"), a(this, b, "f").stderr.setEncoding("utf8"), a(this, b, "f").stdout.on("data", (r) => a(this, se, "m", be).call(this, r)), a(this, b, "f").stderr.on("data", (r) => a(this, se, "m", be).call(this, r)), a(this, b, "f").once("close", () => {
        y(this, F, !0);
        const r = a(this, k, "f");
        y(this, k, null), r == null || r.resolve();
      });
    }
    /** Whether the underlying shell process has exited. */
    get closed() {
      return a(this, F, "f");
    }
    async exec(t, i = {}) {
      if (a(this, F, "f"))
        throw new O("bash session terminated");
      const r = i.timeoutMs ?? st, n = i.signal;
      n == null || n.throwIfAborted(), y(this, E, ""), y(this, H, !1);
      const o = `__ANT_CMD_${ee.randomUUID()}_DONE__`, c = `${o.slice(0, 8)}''${o.slice(8)}`, l = `{ ${t}
} </dev/null 2>&1; printf '\\n${c}%d\\n' $?
`;
      if (a(this, b, "f").stdin.write(l), a(this, E, "f").indexOf(o) < 0) {
        const { promise: N, resolve: D } = Ge();
        y(this, k, { sentinel: o, resolve: D });
        let we, ie;
        try {
          await Promise.race([
            N,
            new Promise((lt, pe) => {
              we = setTimeout(() => pe(new ei(r)), r);
            }),
            new Promise((lt, pe) => {
              n && (ie = () => pe(n.reason), n.addEventListener("abort", ie, { once: !0 }));
            })
          ]);
        } finally {
          we && clearTimeout(we), ie && n && n.removeEventListener("abort", ie), y(this, k, null);
        }
      }
      const d = a(this, E, "f").indexOf(o);
      if (d < 0)
        throw new O("bash session terminated");
      const w = a(this, E, "f").slice(d + o.length).match(/^(-?\d+)/), g = w ? parseInt(w[1], 10) : -1;
      let M = a(this, E, "f").slice(0, d).replace(ti, "").replace(/\n+$/, "");
      return a(this, H, "f") && (M = `[output truncated]
${M}`), { output: M, exitCode: g };
    }
    close() {
      if (a(this, F, "f"))
        return;
      y(this, F, !0);
      const t = a(this, k, "f");
      y(this, k, null), t == null || t.resolve(), a(this, b, "f").stdout.destroy(), a(this, b, "f").stderr.destroy(), a(this, b, "f").stdin.destroy();
      try {
        process.kill(-a(this, b, "f").pid, "SIGKILL");
      } catch {
        a(this, b, "f").kill("SIGKILL");
      }
      a(this, b, "f").unref();
    }
  }
  return b = /* @__PURE__ */ new WeakMap(), E = /* @__PURE__ */ new WeakMap(), H = /* @__PURE__ */ new WeakMap(), F = /* @__PURE__ */ new WeakMap(), k = /* @__PURE__ */ new WeakMap(), se = /* @__PURE__ */ new WeakSet(), be = function(t) {
    if (y(this, E, a(this, E, "f") + t), a(this, E, "f").length > Be && (y(this, E, a(this, E, "f").slice(a(this, E, "f").length - Be)), y(this, H, !0)), a(this, k, "f") && a(this, E, "f").indexOf(a(this, k, "f").sentinel) >= 0) {
      const i = a(this, k, "f");
      y(this, k, null), i.resolve();
    }
  }, s;
})();
function si(s) {
  U(s.unrestrictedPaths);
  let e, t = Promise.resolve();
  return z({
    name: "bash",
    description: "Run a bash command in a persistent shell. State (cwd, env vars) persists across calls.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run" },
        restart: { type: "boolean", description: "Restart the persistent shell before running" },
        timeout_ms: { type: "integer", description: "Per-call timeout in milliseconds" }
      }
    },
    run: async ({ command: i, restart: r, timeout_ms: n }, o) => {
      const c = t, l = Ge();
      t = l.promise;
      try {
        await c;
      } catch {
      }
      try {
        if (r && (e == null || e.close(), e = void 0), !i) {
          if (r)
            return "bash session restarted";
          throw new m("bash: command is required");
        }
        e ?? (e = new ni(s.workdir, s.env));
        try {
          const { output: d, exitCode: h } = await e.exec(i, {
            timeoutMs: n ?? st,
            signal: o == null ? void 0 : o.signal
          });
          if (h !== 0)
            throw new m(d || `exit ${h}`);
          return d;
        } catch (d) {
          throw d instanceof m ? d : (e.close(), e = void 0, new m(`bash: ${d instanceof Error ? d.message : String(d)}`));
        }
      } finally {
        l.resolve();
      }
    },
    close: () => {
      e == null || e.close(), e = void 0;
    }
  });
}
function oi(s) {
  return U(s.unrestrictedPaths), z({
    name: "read",
    description: "Read a UTF-8 text file relative to the workdir.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        view_range: {
          type: "array",
          items: { type: "integer" },
          description: "[start_line, end_line] 1-indexed inclusive"
        }
      },
      required: ["file_path"]
    },
    run: async ({ file_path: e, view_range: t }) => {
      if (!e)
        throw new m("read: file_path is required");
      const i = await te(s, e);
      if (t != null && t.length && t.length !== 2)
        throw new m("read: view_range must be [start_line, end_line]");
      let r;
      try {
        const h = await I.stat(i);
        if (!h.isFile())
          throw new m(`read: ${e} is not a regular file`);
        const w = ot(s.maxFileBytes);
        if (w !== null && h.size > w) {
          if (!(t != null && t.length))
            throw new m(`read: ${e} is ${h.size} bytes, exceeds ${w}-byte limit. Use the view_range parameter to read specific line ranges, e.g. view_range: [1, 500].`);
          const [g, M] = t;
          return await ai(i, e, g, M, w);
        }
        r = await I.readFile(i, "utf8");
      } catch (h) {
        throw h instanceof m ? h : new m(`read: ${Q(h, e)}`);
      }
      if (!(t != null && t.length))
        return r;
      const [n, o] = t, c = r.split(`
`), l = Math.max(0, n - 1), d = o > 0 ? o : c.length;
      return c.slice(l, d).join(`
`);
    }
  });
}
async function ai(s, e, t, i, r) {
  const n = new ci(e, t, i, r);
  if (n.rangeIsEmpty())
    return "";
  const o = A.createReadStream(s, { highWaterMark: Jt });
  try {
    for await (const c of o)
      if (n.collectFrom(c), n.rangeIsCollected())
        break;
  } finally {
    o.destroy();
  }
  return n.text();
}
class ci {
  constructor(e, t, i, r) {
    fe.add(this), V.set(this, void 0), me.set(this, void 0), ue.set(this, void 0), W.set(this, void 0), j.set(this, void 0), q.set(this, void 0), P.set(this, 0), J.set(this, []), $.set(this, 0), y(this, V, e), y(this, me, t), y(this, ue, i), y(this, W, Math.max(0, t - 1)), y(this, j, i > 0 ? i : 1 / 0), y(this, q, r);
  }
  rangeIsEmpty() {
    return a(this, j, "f") <= a(this, W, "f");
  }
  rangeIsCollected() {
    return a(this, P, "f") >= a(this, j, "f");
  }
  collectFrom(e) {
    var t;
    let i = 0;
    for (; i < e.length && !this.rangeIsCollected(); ) {
      const r = e.indexOf(10, i), n = r < 0 ? e.length : r;
      if (a(this, P, "f") >= a(this, W, "f") && a(this, fe, "m", nt).call(this, e.subarray(i, n), r >= 0), r < 0)
        break;
      y(this, P, (t = a(this, P, "f"), t++, t)), i = r + 1;
    }
  }
  text() {
    return Buffer.concat(a(this, J, "f"), a(this, $, "f")).toString("utf8");
  }
}
V = /* @__PURE__ */ new WeakMap(), me = /* @__PURE__ */ new WeakMap(), ue = /* @__PURE__ */ new WeakMap(), W = /* @__PURE__ */ new WeakMap(), j = /* @__PURE__ */ new WeakMap(), q = /* @__PURE__ */ new WeakMap(), P = /* @__PURE__ */ new WeakMap(), J = /* @__PURE__ */ new WeakMap(), $ = /* @__PURE__ */ new WeakMap(), fe = /* @__PURE__ */ new WeakSet(), nt = function(e, t) {
  if (a(this, J, "f").push(e), y(this, $, a(this, $, "f") + e.length), t && a(this, P, "f") + 1 < a(this, j, "f") && (a(this, J, "f").push(qe), y(this, $, a(this, $, "f") + qe.length)), a(this, $, "f") > a(this, q, "f"))
    throw a(this, fe, "m", xe).call(this);
}, xe = function() {
  return a(this, j, "f") - a(this, W, "f") === 1 ? new m(`read: line ${a(this, W, "f") + 1} of ${a(this, V, "f")} alone exceeds ${a(this, q, "f")}-byte limit. The read tool cannot return part of a line, so view_range cannot narrow this further.`) : new m(`read: view_range [${a(this, me, "f")}, ${a(this, ue, "f")}] of ${a(this, V, "f")} exceeds ${a(this, q, "f")}-byte limit. Narrow the view_range to read a smaller portion.`);
};
function li(s) {
  return U(s.unrestrictedPaths), z({
    name: "write",
    description: "Write a UTF-8 text file relative to the workdir, creating parent directories as needed.",
    inputSchema: {
      type: "object",
      properties: { file_path: { type: "string" }, content: { type: "string" } },
      required: ["file_path", "content"]
    },
    run: async ({ file_path: e, content: t }) => {
      if (!e)
        throw new m("write: file_path is required");
      const i = await te(s, e), r = await at(s, i);
      if (r !== void 0)
        throw new m(`write: ${e} is inside read-only directory ${r}`);
      try {
        await I.mkdir(f.dirname(i), { recursive: !0, mode: ke }), await Ke(i, t ?? "");
      } catch (n) {
        throw new m(`write: ${Q(n, e)}`);
      }
      return `wrote ${Buffer.byteLength(t ?? "")} bytes to ${e}`;
    }
  });
}
function di(s) {
  return U(s.unrestrictedPaths), z({
    name: "edit",
    description: "Replace old_string with new_string in a file. old_string must be unique unless replace_all.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" }
      },
      required: ["file_path", "old_string", "new_string"]
    },
    run: async ({ file_path: e, old_string: t, new_string: i, replace_all: r }) => {
      if (!e)
        throw new m("edit: file_path is required");
      if (!t)
        throw new m("edit: old_string is required");
      const n = await te(s, e), o = await at(s, n);
      if (o !== void 0)
        throw new m(`edit: ${e} is inside read-only directory ${o}`);
      let c;
      try {
        const h = await I.stat(n);
        if (!h.isFile())
          throw new m(`edit: ${e} is not a regular file`);
        const w = ot(s.maxFileBytes);
        if (w !== null && h.size > w)
          throw new m(`edit: ${e} is ${h.size} bytes, exceeds ${w}-byte limit. The edit tool loads the whole file and cannot modify a file this large.`);
        c = await I.readFile(n, "utf8");
      } catch (h) {
        throw h instanceof m ? h : new m(`edit: ${Q(h, e)}`);
      }
      const l = c.split(t).length - 1;
      if (l === 0)
        throw new m(`edit: old_string not found in ${e}`);
      let d;
      if (r)
        d = c.split(t).join(i);
      else {
        if (l > 1)
          throw new m(`edit: old_string appears ${l} times in ${e} (must be unique)`);
        d = c.replace(t, () => i);
      }
      try {
        await Ke(n, d);
      } catch (h) {
        throw new m(`edit: write: ${Q(h, e)}`);
      }
      return `edited ${e} (${r ? l : 1} replacement(s))`;
    }
  });
}
function hi(s) {
  return s.split(/[\\/{},]/).includes("..");
}
function fi(s) {
  return U(s.unrestrictedPaths), z({
    name: "glob",
    description: "Match files under the workdir against a glob pattern. Results are mtime-sorted, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Directory to search in. Defaults to the workdir." }
      },
      required: ["pattern"]
    },
    run: async ({ pattern: e, path: t }) => {
      if (!e)
        throw new m("glob: pattern is required");
      if (f.isAbsolute(e))
        throw new m("glob: absolute pattern not permitted; pass a relative pattern (and optionally path)");
      if (hi(e))
        throw new m('glob: ".." is not permitted in the pattern');
      const i = t ? await te(s, t) : f.resolve(s.workdir), r = t ? i : await le(i), n = [];
      let o = ct;
      try {
        for await (const c of ii(e, {
          cwd: i,
          withFileTypes: !0,
          exclude: (l) => l.name === ".git" || l.name === "node_modules"
        })) {
          if (o-- <= 0)
            break;
          if (!c.isFile())
            continue;
          const l = f.join(c.parentPath, c.name);
          let d;
          try {
            d = await I.realpath(l);
          } catch {
            continue;
          }
          if (!ve(r, d))
            continue;
          let h = 0;
          try {
            h = (await I.stat(l)).mtimeMs;
          } catch {
          }
          n.push({ path: l, mtime: h });
        }
      } catch (c) {
        throw new m(`glob: ${c instanceof Error ? c.message : String(c)}`);
      }
      return n.length === 0 ? "no matches" : (n.sort((c, l) => l.mtime - c.mtime), n.slice(0, Qt).map((c) => c.path).join(`
`));
    }
  });
}
function mi(s) {
  return U(s.unrestrictedPaths), z({
    name: "grep",
    description: "Search file contents for a regex. Uses ripgrep if available, otherwise a built-in walker.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" }, path: { type: "string" } },
      required: ["pattern"]
    },
    run: async ({ pattern: e, path: t }, i) => {
      if (!e)
        throw new m("grep: pattern is required");
      let r = f.resolve(s.workdir);
      t && (r = await te(s, t));
      const n = await _i();
      return n ? ui(n, e, r, i == null ? void 0 : i.signal) : yi(e, r, i == null ? void 0 : i.signal);
    }
  });
}
function ui(s, e, t, i) {
  return new Promise((r, n) => {
    const o = Me.spawn(s, ["-n", "--no-heading", "-e", e, "--", t], {
      ...i ? { signal: i } : {}
    });
    let c = "", l = "", d = !1;
    o.stdout.on("data", (h) => {
      d || (c += h, c.length > Z && (d = !0, c = c.slice(0, Z), o.kill("SIGKILL")));
    }), o.stderr.on("data", (h) => l += h), o.on("close", (h) => {
      if (i != null && i.aborted)
        return n(new m("grep: aborted"));
      if (d)
        return r(c + `
[output truncated at ${Z} bytes]`);
      if (h === 0)
        return r(c);
      if (h === 1)
        return r("no matches");
      n(new m(`grep: rg failed: ${l || `exit ${h}`}`));
    }), o.on("error", (h) => {
      if (i != null && i.aborted)
        return n(new m("grep: aborted"));
      n(new m(`grep: rg failed: ${h.message}`));
    });
  });
}
async function yi(s, e, t) {
  let i;
  try {
    i = new RegExp(s);
  } catch (l) {
    throw new m(`grep: invalid regex: ${l instanceof Error ? l.message : String(l)}`);
  }
  const r = [];
  let n = Z;
  const o = (l) => (n -= l.length + 1, n < 0 ? (r.push(`[output truncated at ${Z} bytes]`), !1) : (r.push(l), !0)), c = await I.stat(e).catch(() => null);
  if (c != null && c.isFile() ? await Ye(e, i, o) : await pi(e, "", (l) => Ye(f.join(e, l), i, o), t), t != null && t.aborted)
    throw new m("grep: aborted");
  return r.length === 0 ? "no matches" : r.join(`
`);
}
async function Ye(s, e, t) {
  const i = A.createReadStream(s, { encoding: "utf8" }), r = ut.createInterface({ input: i, crlfDelay: 1 / 0 });
  let n = 0;
  try {
    for await (const o of r)
      if (n++, !(o.length > Zt) && e.test(o) && !t(`${s}:${n}:${o}`))
        return !1;
  } catch {
  } finally {
    i.destroy();
  }
  return !0;
}
const wi = 40, ct = 5e4;
async function pi(s, e, t, i) {
  let r = ct;
  async function n(o, c) {
    if (c > wi)
      return !0;
    if (i != null && i.aborted)
      return !1;
    let l;
    try {
      l = await I.readdir(f.join(s, o), { withFileTypes: !0 });
    } catch {
      return !0;
    }
    for (const d of l) {
      if (d.name === ".git" || d.name === "node_modules")
        continue;
      if (r-- <= 0 || i != null && i.aborted)
        return !1;
      const h = o ? f.join(o, d.name) : d.name;
      if (d.isDirectory()) {
        if (!await n(h, c + 1))
          return !1;
      } else if (d.isFile() && await t(h) === !1)
        return !1;
    }
    return !0;
  }
  await n(e, 0);
}
async function _i() {
  const s = (process.env.PATH ?? "").split(f.delimiter);
  for (const e of s) {
    const t = f.join(e, "rg");
    try {
      return await I.access(t, A.constants.X_OK), t;
    } catch {
    }
  }
  return null;
}
export {
  ni as BashSession,
  ei as BashTimeoutError,
  ht as DEFAULT_MEMORY_SYNC_INTERVAL_MS,
  G as MARKER_PATH,
  Ei as MEMORY_FLUSH_TIMEOUT_MS,
  Ii as MIN_MEMORY_SYNC_INTERVAL_MS,
  X as SessionMemoryError,
  Oi as SessionMemoryStores,
  Mi as betaAgentToolset20260401,
  si as betaBashTool,
  di as betaEditTool,
  fi as betaGlobTool,
  mi as betaGrepTool,
  oi as betaReadTool,
  li as betaWriteTool,
  kt as extractSkillArchive,
  te as resolvePath,
  bi as setupSkills
};
