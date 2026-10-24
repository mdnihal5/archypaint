/**
 * Icon pack: lazy loading, one-time SVG -> draw-op conversion, and search metadata.
 *
 * icons/scripts/build.mjs emits src/packs/index.json (search metadata for every drawn icon) and one
 * src/packs/<pack>.json per pack (the SVG markup); icons/scripts/build-logos.mjs adds src/packs/logos-index.json and one
 * src/packs/logos-<category>.json per brand-logo category. The indexes and each pack are separate chunks, fetched
 * on first need: drawing an icon requests only its own pack; the palette and exports request them all.
 * Each icon's SVG is converted ONCE into a small list of ops (path string + paint) and compiled to
 * Path2D lazily, so drawing is pure vector with no per-frame parsing and no bitmaps. The compiled cache
 * is bounded. A failed chunk load is retried at most every few seconds, never once per frame.
 */

import { ICON_ALIASES } from "./logos";
import { loadStoredUserPacks } from "./user-packs"; // circular with user-packs by design: both only call each other inside functions

export type Tier = "detail" | "glyph";

export interface Op {
  /** SVG path data */
  d: string;
  /** brand colour (logos only; "" = the caller's colour), and the replacements for the dark / light theme ("" = none) */
  c: string; cd: string; cl: string;
  fill: boolean; fo: number;
  stroke: boolean; so: number;
  dash: number[] | null;
  /** stroke width in the icon's own grid units */
  sw: number;
  /** compiled lazily (undefined in non-DOM environments) */
  p: Path2D | null;
}

export interface IconMeta {
  id: string; name: string; aliases: readonly string[]; category: string;
  /** pack (chunk) the SVG lives in: core, generic2, oss, aws, gcp, azure, logos-<category>, or user-<name> */
  pack: string;
  /** "logo" | "aws" | "gcp" | "azure" | "oss" | "user" | "" — grouping and disclaimer only */
  vendor: string;
  /** logos only, and only wordmarks / tall marks: the content box [x, y, w, h] inside the 24 grid, so a borderless logo can be scaled by its aspect */
  vb?: readonly number[];
}
interface Svg { detail: string; glyph: string }
export interface IndexJson {
  v: number; icons: [string, string, string[], string, string, string, number[]?][];
  /** logos index only: drawn vendor icons that a real logo replaces (not listed in the palette; saved diagrams still render them) */
  hides?: string[];
  /** logos index only: [pack, palette section label] in display order */
  groups?: [string, string][];
}
export interface PackJson { v: number; pack: string; icons: [string, string, string][] }

/** stroke width of the root <svg> per tier — icons inherit it unless an element overrides it */
export const ROOT_STROKE: Record<Tier, number> = { detail: 2, glyph: 1.75 };
export const TIER_GRID: Record<Tier, number> = { detail: 64, glyph: 24 };
/** attributes to put on a wrapping <svg> when embedding iconSvg() output */
export const ROOT_ATTRS = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

const ALLOWED = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"]);
const HEX6 = /^#[0-9a-f]{6}$/;
const num = (v: string | undefined, d = 0): number => (v === undefined || v === "" ? d : Number(v));

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([A-Za-z][\w:-]*)="([^"]*)"/g)) out[m[1]!] = m[2]!;
  return out;
}

function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (rx <= 0 || ry <= 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
}
const ellipsePath = (cx: number, cy: number, rx: number, ry: number): string =>
  `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
const pointsPath = (pts: string, close: boolean): string => {
  const n = pts.trim().split(/[\s,]+/).map(Number);
  let d = "";
  for (let i = 0; i + 1 < n.length; i += 2) d += `${i ? "L" : "M"}${n[i]} ${n[i + 1]}`;
  return close ? d + "Z" : d;
};

/** Pure: icon inner-SVG markup -> ops. Throws on any element outside the allowed set. */
export function parseIconMarkup(markup: string, rootStroke: number): Op[] {
  for (const t of markup.matchAll(/<\s*([A-Za-z][\w:-]*)/g)) {
    if (!ALLOWED.has(t[1]!)) throw new Error(`icon markup: unsupported element <${t[1]}>`);
  }
  const ops: Op[] = [];
  for (const m of markup.matchAll(/<([a-z]+)\b([^>]*?)\/?>/g)) {
    const tag = m[1]!, a = attrs(m[2]!);
    let d: string;
    switch (tag) {
      case "rect": {
        const rx = a.rx !== undefined ? num(a.rx) : num(a.ry), ry = a.ry !== undefined ? num(a.ry) : rx;
        d = rectPath(num(a.x), num(a.y), num(a.width), num(a.height), rx, ry); break;
      }
      case "circle": d = ellipsePath(num(a.cx), num(a.cy), num(a.r), num(a.r)); break;
      case "ellipse": d = ellipsePath(num(a.cx), num(a.cy), num(a.rx), num(a.ry)); break;
      case "line": d = `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`; break;
      case "polyline": d = pointsPath(a.points ?? "", false); break;
      case "polygon": d = pointsPath(a.points ?? "", true); break;
      default: d = a.d ?? "";
    }
    const fill = (a.fill ?? "none") !== "none";
    const stroke = (a.stroke ?? "currentColor") !== "none";
    const dash = a["stroke-dasharray"] ? a["stroke-dasharray"].trim().split(/[\s,]+/).map(Number) : null;
    const brand = (v: string | undefined): string => (v !== undefined && HEX6.test(v) ? v : ""); // only a literal #rrggbb is a brand colour
    ops.push({
      d, c: fill ? brand(a.fill) : "", cd: brand(a["data-d"]), cl: brand(a["data-l"]),
      fill, fo: num(a["fill-opacity"], 1), stroke, so: num(a["stroke-opacity"], 1),
      dash, sw: num(a["stroke-width"], rootStroke), p: null,
    });
  }
  return ops;
}

/* ------------------------------------------------------------------ pack state */

let index: IconMeta[] = [];
let byId = new Map<string, IconMeta>();
const svgs = new Map<string, Svg>();
const packsLoaded = new Set<string>();
let indexLoaded = false;
let version = 0;
const readyCbs = new Set<() => void>();
/** drawn vendor icons a real logo replaces (from the logos index): not listed, but they stay in `byId` so saved diagrams render them */
let hidden = new Set<string>();
/** palette sections of the logo packs, in display order: [pack, label] */
let logoGroups: [string, string][] = [];
let listed: IconMeta[] | null = null; // listIcons() cache, dropped whenever the index changes
const pending = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
const RETRY_MS = 4000;

/** true once the index is loaded; with a name, once that pack's SVG is loaded */
export const packLoaded = (name?: string): boolean => (name === undefined ? indexLoaded : packsLoaded.has(name));
/** bumps whenever the set of known icons changes (index load, user pack add/remove) */
export const packsVersion = (): number => version;

/** Subscribe to "something finished loading" (index, a pack, a user pack). Returns an unsubscribe fn. */
export function onIconsReady(cb: () => void): () => void {
  readyCbs.add(cb);
  return () => { readyCbs.delete(cb); };
}
const notify = (): void => { for (const cb of [...readyCbs]) cb(); };
/** the set of known icons changed (index / user packs): bump the version search indexes key off, then notify */
const fire = (): void => { version++; notify(); };

/** Install the search index directly (loader + tests). Bundled icons only: user packs are re-attached. */
export function installIndex(json: IndexJson): void {
  const user = index.filter((m) => m.vendor === "user");
  index = json.icons.map(([id, name, aliases, category, pack, vendor, vb]) => (vb && vb.length === 4 ? { id, name, aliases, category, pack, vendor, vb } : { id, name, aliases, category, pack, vendor }));
  for (const m of user) index.push(m);
  byId = new Map(index.map((m) => [m.id, m]));
  hidden = new Set(json.hides ?? []);
  logoGroups = json.groups ?? [];
  listed = null;
  indexLoaded = true;
  fire();
}

/** Install one pack's SVG markup directly (loader + tests). */
export function installPack(json: PackJson): void {
  for (const [id, detail, glyph] of json.icons) svgs.set(id, { detail, glyph });
  packsLoaded.add(json.pack);
  notify(); // SVG arrived for icons already in the index: repaint, but search metadata is unchanged
}

/** add a validated user pack (see user-packs.ts): metadata + SVG in one go */
export function installUserIcons(pack: string, rows: readonly { id: string; name: string; aliases: readonly string[]; category: string; detail: string; glyph: string }[]): void {
  removeUserIcons(pack, false);
  for (const r of rows) {
    const m: IconMeta = { id: r.id, name: r.name, aliases: r.aliases, category: r.category, pack, vendor: "user" };
    index.push(m); byId.set(m.id, m); svgs.set(m.id, { detail: r.detail, glyph: r.glyph });
  }
  packsLoaded.add(pack);
  listed = null;
  fire();
}

export function removeUserIcons(pack: string, notify = true): void {
  const gone = index.filter((m) => m.pack === pack);
  if (!gone.length && !packsLoaded.has(pack)) return;
  index = index.filter((m) => m.pack !== pack);
  for (const m of gone) { byId.delete(m.id); svgs.delete(m.id); compiled.detail.delete(m.id); compiled.glyph.delete(m.id); }
  packsLoaded.delete(pack);
  listed = null;
  if (notify) fire();
}

/* ---- loaders (replaceable in tests) */

const files = import.meta.glob<string>("./packs/*.json", { query: "?raw", import: "default" });
type Loader = (name: string) => Promise<string>;
const defaultLoader: Loader = async (name) => {
  const f = files[`./packs/${name}.json`];
  if (!f) throw new Error(`unknown icon pack "${name}"`);
  return f();
};
let loader: Loader = defaultLoader;
/** tests: replace (or, with null, restore) the chunk loader */
export function setPackLoader(fn: Loader | null): void { loader = fn ?? defaultLoader; }
/** tests: forget everything loaded */
export function resetPacks(): void {
  wanted.clear(); index = []; byId = new Map(); svgs.clear(); packsLoaded.clear(); pending.clear(); failedAt.clear(); compiled.detail.clear(); compiled.glyph.clear();
  hidden = new Set(); logoGroups = []; listed = null;
  indexLoaded = false; userLoaded = false; version = 0;
}

function load(key: string, run: () => Promise<void>, force: boolean): Promise<void> {
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const t = failedAt.get(key);
  if (!force && t !== undefined && performance.now() - t < RETRY_MS) return Promise.resolve();
  const p = run().then(() => { failedAt.delete(key); }, () => { failedAt.set(key, performance.now()); }).finally(() => { pending.delete(key); });
  pending.set(key, p);
  return p;
}

let userLoaded = false;
/** icons asked for before the index existed: their packs are requested as soon as it lands (bounded) */
const wanted = new Set<string>();

/** load the search index (and stored user packs). Idempotent; never throws. */
function ensureIndex(force: boolean): Promise<void> {
  if (indexLoaded && userLoaded) return Promise.resolve();
  return load("index", async () => {
    if (!indexLoaded) {
      // the drawn icons' index and the logos' index are one unit: if either fails, neither installs and the whole step is retried
      const [a, b] = await Promise.all([loader("index"), loader("logos-index")]);
      const drawn = JSON.parse(a) as IndexJson, logos = JSON.parse(b) as IndexJson;
      installIndex({ v: drawn.v, icons: [...logos.icons, ...drawn.icons], hides: logos.hides ?? [], groups: logos.groups ?? [] });
    }
    if (!userLoaded) {
      userLoaded = true; // set first: a failing store must not be retried on every frame
      try { await loadStoredUserPacks(); } catch { /* user packs are best effort */ }
    }
    const packsNeeded = new Set<string>();
    for (const id of wanted) { const m = byId.get(id); if (m && m.vendor !== "user" && !packsLoaded.has(m.pack)) packsNeeded.add(m.pack); }
    wanted.clear();
    for (const pk of packsNeeded) void ensurePack(pk, false);
  }, force);
}

/** load one bundled pack. Idempotent; never throws. */
export function ensurePack(name: string, force = true): Promise<void> {
  if (packsLoaded.has(name) || name.startsWith("user-")) return Promise.resolve();
  return load(`pack:${name}`, async () => { installPack(JSON.parse(await loader(name)) as PackJson); }, force);
}

/**
 * Load the index plus the packs needed: those of `ids`, or every bundled pack when omitted (palette / export paths).
 * Resolves when done; a failed chunk simply leaves those icons as plain tiles (retry with another call).
 */
export async function ensureIcons(ids?: readonly string[]): Promise<void> {
  await ensureIndex(true);
  const want = new Set<string>();
  if (ids) { for (const id of ids) { const m = byId.get(id); if (m && m.vendor !== "user") want.add(m.pack); } }
  else for (const m of index) if (m.vendor !== "user") want.add(m.pack);
  await Promise.all([...want].map((p) => ensurePack(p, true)));
}

/** every icon the palette and the text importer may offer: the drawn vendor icons that a logo replaces are left out (iconMeta still knows them) */
export function listIcons(): readonly IconMeta[] {
  if (!hidden.size) return index;
  return (listed ??= index.filter((m) => !hidden.has(m.id)));
}
export function iconMeta(id: string): IconMeta | null { return byId.get(resolveId(id)) ?? null; }
/** the content box of a non-square logo mark in the 24 grid, or null (square: use the whole grid) */
export function logoBox(id: string): readonly number[] | null { return byId.get(resolveId(id))?.vb ?? null; }
/** the logo categories, in display order: [pack, section label] */
export const logoPacks = (): readonly [string, string][] => logoGroups;
/** an old / renamed id -> the id that is stored (see ICON_ALIASES); unknown ids pass through */
const resolveId = (id: string): string => ICON_ALIASES[id] ?? id;

/** background kick used by drawing paths: cheap, idempotent, retry-throttled */
function want(id: string): void {
  if (!indexLoaded || !userLoaded) { if (wanted.size < 5000) wanted.add(id); void ensureIndex(false); return; }
  const m = byId.get(id);
  if (m && !packsLoaded.has(m.pack)) void ensurePack(m.pack, false);
}

/** raw inner-SVG markup (uses currentColor; wrap with ROOT_ATTRS + the tier's viewBox), or null if unknown/not loaded yet */
export function iconInner(id: string, tier: Tier): string | null {
  id = resolveId(id);
  const r = svgs.get(id);
  if (!r) { want(id); return null; }
  if (tier === "detail") return r.detail === "" ? `<g transform="scale(2.666667)">${r.glyph}</g>` : r.detail; // glyph-only icon: scaled 24 -> 64 grid, for export
  return r.glyph;
}

/** false for glyph-only icons (logos): the renderer must use the glyph tier at every size. True when unknown (not loaded yet). */
export function iconHasDetail(id: string): boolean { const r = svgs.get(resolveId(id)); return !r || r.detail !== ""; }

/* ------------------------------------------------------------------ compiled-op cache (bounded) */

/** at most this many compiled tiers are kept; beyond it the least recently compiled is evicted (a Map iterates in insertion order) */
export const MAX_COMPILED = 2048;
/** keyed by tier then id, so a draw builds no key string: this runs once per visible icon per frame */
const compiled: Record<Tier, Map<string, Op[]>> = { detail: new Map(), glyph: new Map() };

export function iconOps(id: string, tier: Tier): Op[] | null {
  id = resolveId(id);
  const cache = compiled[tier];
  const hit = cache.get(id);
  if (hit) return hit;
  if (tier === "detail" && svgs.get(id)?.detail === "") return null; // glyph-only icon: callers pick the glyph tier (iconHasDetail)
  const markup = iconInner(id, tier);
  if (markup === null) return null;
  const ops = parseIconMarkup(markup, ROOT_STROKE[tier]);
  if (typeof Path2D !== "undefined") for (const o of ops) o.p = new Path2D(o.d);
  if (compiledCount() >= MAX_COMPILED) {
    const other = tier === "detail" ? compiled.glyph : compiled.detail;
    const victim = cache.size >= other.size ? cache : other;
    const oldest = victim.keys().next();
    if (!oldest.done) victim.delete(oldest.value);
  }
  cache.set(id, ops);
  return ops;
}

export const compiledCount = (): number => compiled.detail.size + compiled.glyph.size;
