/**
 * On-demand official logos (lazy chunk). Nothing here runs until a logo is first requested.
 *
 * Rules this module enforces:
 *   - No network before the user opts in (isOptedIn). A logo already in the browser cache is used without the network.
 *   - One fixed URL shape (pinned simple-icons version on jsDelivr) and only slugs from the catalog: a document cannot
 *     make us request anything else.
 *   - Every downloaded file is treated as hostile: capped while reading, matched against an exact grammar (one <svg
 *     viewBox="0 0 24 24"> with one <path>), re-checked with the same allow-list that guards user icon packs, and only
 *     OUR markup (<path d fill=currentColor>) is ever installed. The file itself is never kept or inserted.
 *   - Bounded: 6 s timeout, one retry, 3 concurrent requests, in-flight de-dupe, a 60 s cool-down after a failure, and a
 *     byte-capped LRU cache (logos on the canvas are never evicted).
 *   - Never throws to callers: results are "ok" | "failed" | "blocked".
 */
import { hasLogoIcon, installLogoIcon, LOGO_PREFIX, parseIconMarkup, removeLogoIcon, ROOT_STROKE } from "./icon-pack";
import { logoUrl, LOGOS, type Logo } from "./logos-catalog";
import { markupProblem, PATH_CHARS } from "./user-packs";

export type LogoResult = "ok" | "failed" | "blocked";

export const OPT_IN_KEY = "archypaint.logos.optin";
export const RESTRICTED_KEY = "archypaint.logos.restricted";
/** largest file we will read (the biggest real mark is ~11.9 KB) and longest path we will accept */
export const MAX_SVG = 12 * 1024;
export const MAX_PATH_D = 12_000;
export const CACHE_MAX = 200 * 1024;
const TIMEOUT_MS = 6000, COOLDOWN_MS = 60_000, CONCURRENCY = 3;

/* ------------------------------------------------------------------ opt-in flags (localStorage, try/catch) */

const read = (k: string): boolean => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };
const write = (k: string, v: boolean): void => { try { if (v) localStorage.setItem(k, "1"); else localStorage.removeItem(k); } catch { /* private mode: applies for this session only */ } };
let sessionOpt: boolean | null = null, sessionRestricted: boolean | null = null;

export const isOptedIn = (): boolean => sessionOpt ?? read(OPT_IN_KEY);
export const showRestricted = (): boolean => sessionRestricted ?? read(RESTRICTED_KEY);
export function setOptedIn(v: boolean): void { sessionOpt = v; write(OPT_IN_KEY, v); blocked.clear(); }
export function setShowRestricted(v: boolean): void { sessionRestricted = v; write(RESTRICTED_KEY, v); blocked.clear(); }

/* ------------------------------------------------------------------ validation */

const SVG_RE = /^<svg((?:\s+[A-Za-z:]+="[^"]*")*)\s*>(?:<title>[^<>]{0,120}<\/title>)?<path d="([^"]*)"\s*\/><\/svg>\s*$/;
const SVG_ATTRS: Record<string, string> = { role: "img", viewBox: "0 0 24 24", xmlns: "http://www.w3.org/2000/svg" };

/** null when the downloaded file is exactly what we expect; otherwise why not. Returns the path data through `out`. */
export function svgProblem(text: unknown, out?: { d: string }): string | null {
  if (typeof text !== "string" || !text) return "empty file";
  if (text.length > MAX_SVG) return "file too large";
  const m = SVG_RE.exec(text);
  if (!m) return "not a single-path 24x24 SVG";
  const seen = new Set<string>();
  for (const a of m[1]!.matchAll(/\s+([A-Za-z:]+)="([^"]*)"/g)) {
    if (SVG_ATTRS[a[1]!] !== a[2] || seen.has(a[1]!)) return `unexpected <svg> attribute "${a[1]}"`;
    seen.add(a[1]!);
  }
  if (SVG_ATTRS.viewBox && !seen.has("viewBox")) return "missing viewBox";
  const d = m[2]!;
  if (!d || d.length > MAX_PATH_D) return "bad path length";
  if (!PATH_CHARS.test(d) || !/^[Mm]/.test(d.trimStart())) return "bad path data";
  if (out) out.d = d;
  return null;
}

/** our own glyph markup for a validated path; re-checked with the user-pack grammar and parsed once as a last guard */
export function glyphMarkup(d: string): string | null {
  const markup = `<path d="${d}" fill="currentColor" stroke="none"/>`;
  if (markupProblem(markup, { maxMarkup: MAX_PATH_D + 200, maxPath: MAX_PATH_D })) return null;
  try {
    const ops = parseIconMarkup(markup, ROOT_STROKE.glyph);
    if (ops.length !== 1 || /NaN|undefined|Infinity/.test(ops[0]!.d)) return null;
  } catch { return null; }
  return markup;
}

/* ------------------------------------------------------------------ environment (replaceable in tests) */

interface Row { slug: string; d: string; bytes: number; used: number }
export interface LogoStore { all(): Promise<Row[]>; put(r: Row): Promise<void>; delete(slug: string): Promise<void>; close(): void }
export interface LogoEnv {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  store: () => LogoStore;
  now: () => number;
}

export function memLogoStore(): LogoStore & { data: Map<string, Row> } {
  const data = new Map<string, Row>();
  return { data, async all() { return [...data.values()].map((r) => ({ ...r })); }, async put(r) { data.set(r.slug, { ...r }); }, async delete(s) { data.delete(s); }, close() {} };
}

function idbLogoStore(): LogoStore {
  let dbp: Promise<IDBDatabase> | null = null, closed = false;
  const open = (): Promise<IDBDatabase> => {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
    return (dbp ??= new Promise((res, rej) => {
      const r = indexedDB.open("archypaint-logos", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("svg", { keyPath: "slug" }); };
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbp = null; }; if (closed) db.close(); res(db); };
      r.onerror = () => { dbp = null; rej(r.error); };
      r.onblocked = () => { dbp = null; rej(new Error("IndexedDB blocked")); };
    }));
  };
  const done = (tx: IDBTransaction): Promise<void> => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error("aborted")); });
  return {
    async all() { const db = await open(); return new Promise<Row[]>((res, rej) => { const q = db.transaction("svg").objectStore("svg").getAll(); q.onsuccess = () => res(q.result as Row[]); q.onerror = () => rej(q.error); }); },
    async put(r) { const db = await open(); const tx = db.transaction("svg", "readwrite"); tx.objectStore("svg").put(r); await done(tx); },
    async delete(s) { const db = await open(); const tx = db.transaction("svg", "readwrite"); tx.objectStore("svg").delete(s); await done(tx); },
    close() { closed = true; dbp?.then((d) => d.close()).catch(() => {}); dbp = null; },
  };
}

const defaultEnv: LogoEnv = { fetch: (u, i) => fetch(u, i), store: idbLogoStore, now: () => Date.now() };
let env: LogoEnv = defaultEnv;
let store: LogoStore | null = null;
const getStore = (): LogoStore => (store ??= env.store());

/* ------------------------------------------------------------------ state */

const bySlug = new Map<string, Logo>(LOGOS.map((l) => [l.slug, l]));
const cache = new Map<string, Row>(); // what the browser cache holds (bytes + LRU stamp); the path data stays in the row
let cacheLoaded: Promise<void> | null = null;
const inflight = new Map<string, Promise<LogoResult>>();
const failedAt = new Map<string, number>();
const blocked = new Set<string>();
let active = 0;
const waiters: Array<() => void> = [];
let inUse: (() => ReadonlySet<string>) | null = null;
export let lastError = "";

/** tests: swap the fetch / storage / clock, or restore the defaults with null */
export function setLogoEnv(e: Partial<LogoEnv> | null): void {
  store?.close(); store = null;
  env = e ? { ...defaultEnv, ...e } : defaultEnv;
  cache.clear(); cacheLoaded = null; inflight.clear(); failedAt.clear(); blocked.clear(); waiters.length = 0; active = 0; lastError = ""; sessionOpt = sessionRestricted = null;
}
/** the palette tells us which logo ids are on the canvas: those are never evicted */
export function setInUseProbe(fn: (() => ReadonlySet<string>) | null): void { inUse = fn; }
export function closeLogos(): void { store?.close(); store = null; cacheLoaded = null; cache.clear(); inflight.clear(); waiters.length = 0; inUse = null; }
export const logoCacheBytes = (): number => { let n = 0; for (const r of cache.values()) n += r.bytes; return n; };
export const logoBySlug = (slug: string): Logo | undefined => bySlug.get(slug);

function loadCache(): Promise<void> {
  return (cacheLoaded ??= getStore().all().then((rows) => {
    for (const r of rows) if (r && typeof r.slug === "string" && typeof r.d === "string" && bySlug.has(r.slug) && !svgProblemD(r.d)) cache.set(r.slug, { slug: r.slug, d: r.d, bytes: r.bytes | 0, used: r.used | 0 });
  }, () => { /* no storage: logos still work for this session */ }));
}
const svgProblemD = (d: string): boolean => !d || d.length > MAX_PATH_D || !PATH_CHARS.test(d);

/* ------------------------------------------------------------------ network */

async function readCapped(res: Response, max: number): Promise<string | null> {
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > max) { try { await res.body?.cancel(); } catch { /* ignore */ } return null; }
  const body = res.body;
  if (!body || typeof body.getReader !== "function") { const t = await res.text(); return t.length > max ? null : t; }
  const reader = body.getReader(), dec = new TextDecoder();
  let out = "", got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.byteLength;
    if (got > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}

type Fetched = { kind: "ok"; d: string; bytes: number } | { kind: "retry" } | { kind: "fail"; why: string };

async function fetchOnce(slug: string): Promise<Fetched> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await env.fetch(logoUrl(slug), { signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    if (res.status >= 500 || res.status === 429) return { kind: "retry" };
    if (!res.ok) return { kind: "fail", why: `HTTP ${res.status}` };
    const text = await readCapped(res, MAX_SVG);
    if (text === null) return { kind: "fail", why: "file too large" };
    const out = { d: "" };
    const bad = svgProblem(text, out);
    if (bad) return { kind: "fail", why: bad };
    return { kind: "ok", d: out.d, bytes: text.length };
  } catch { return { kind: "retry" }; } // network error, timeout (abort) or blocked: transient
  finally { clearTimeout(timer); }
}

async function download(slug: string): Promise<Fetched> {
  let r = await fetchOnce(slug);
  if (r.kind === "retry") r = await fetchOnce(slug); // exactly one retry
  return r.kind === "retry" ? { kind: "fail", why: "network error" } : r;
}

function acquire(): Promise<void> {
  if (active < CONCURRENCY) { active++; return Promise.resolve(); }
  return new Promise((res) => waiters.push(() => { active++; res(); }));
}
function release(): void { active--; waiters.shift()?.(); }

/* ------------------------------------------------------------------ install + cache */

function install(logo: Logo, d: string): boolean {
  const glyph = glyphMarkup(d);
  if (!glyph) return false;
  installLogoIcon({ id: LOGO_PREFIX + logo.slug, name: logo.name, aliases: logo.aliases, category: logo.category, glyph });
  return true;
}

async function evict(keep: string): Promise<boolean> {
  if (logoCacheBytes() <= CACHE_MAX) return true;
  const used = inUse?.() ?? new Set<string>();
  const victims = [...cache.values()].filter((r) => r.slug !== keep && !used.has(LOGO_PREFIX + r.slug)).sort((a, b) => a.used - b.used);
  for (const v of victims) {
    if (logoCacheBytes() <= CACHE_MAX) break;
    cache.delete(v.slug);
    removeLogoIcon(LOGO_PREFIX + v.slug);
    try { await getStore().delete(v.slug); } catch { /* best effort */ }
  }
  return logoCacheBytes() <= CACHE_MAX * 2; // logos on the canvas may push past the soft cap, never past twice it
}

async function resolve(slug: string, force: boolean): Promise<LogoResult> {
  const logo = bySlug.get(slug);
  if (!logo) { lastError = "unknown logo"; return "failed"; }
  const id = LOGO_PREFIX + slug;
  if (hasLogoIcon(id)) { const r = cache.get(slug); if (r) r.used = env.now(); return "ok"; }
  await loadCache();
  const hit = cache.get(slug);
  if (hit && install(logo, hit.d)) { hit.used = env.now(); return "ok"; }
  if (hit) { cache.delete(slug); void getStore().delete(slug).catch(() => {}); } // corrupt row: drop it
  // the network: only for an opted-in user, only for unrestricted brands unless they enabled restricted ones
  if (!isOptedIn() || (logo.restricted && !showRestricted())) { blocked.add(slug); return "blocked"; }
  const t = failedAt.get(slug);
  if (!force && t !== undefined && env.now() - t < COOLDOWN_MS) return "failed";
  await acquire();
  let r: Fetched;
  try { r = await download(slug); } finally { release(); }
  if (r.kind !== "ok") { failedAt.set(slug, env.now()); lastError = r.kind === "fail" ? r.why : "network error"; return "failed"; }
  failedAt.delete(slug);
  const row: Row = { slug, d: r.d, bytes: r.bytes, used: env.now() };
  cache.set(slug, row);
  if (!(await evict(slug)) || !install(logo, r.d)) { cache.delete(slug); lastError = "logo cache is full"; return "failed"; }
  try { await getStore().put(row); } catch { /* not persisted: fine for this session */ }
  return "ok";
}

/**
 * Make `slug` available as icon `logo-<slug>`: installed already, else from the browser cache, else downloaded (opted-in
 * users only). `force` skips the post-failure cool-down (an explicit retry click).
 */
export function ensureLogo(slug: string, o?: { force?: boolean }): Promise<LogoResult> {
  if (!/^[a-z0-9]{1,40}$/.test(slug)) { lastError = "bad logo id"; return Promise.resolve("failed"); }
  if (blocked.has(slug)) return Promise.resolve("blocked");
  const cur = inflight.get(slug);
  if (cur) return cur;
  const p = resolve(slug, !!o?.force).catch((): LogoResult => { lastError = "unexpected error"; return "failed"; }).finally(() => { inflight.delete(slug); });
  inflight.set(slug, p);
  return p;
}

/** a document drew an icon `logo-<slug>` that is not installed: restore it (cache first; network only when opted in) */
export function restoreLogo(slug: string): Promise<LogoResult> { return ensureLogo(slug); }
