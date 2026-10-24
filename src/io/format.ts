import { normHex } from "../theme";
import { MAX_BRANCH_DEPTH, cleanLabels, cleanSegs, migrateArrowText } from "../connectors";
import type { ElJSON, GroupInfo, SceneJSON } from "../scene";

/** The `.archypaint` file format: versioned, validated, deterministic (one element per line, fixed key order). */
export const APP = "archypaint" as const;
/** 2: connectors carry `labels` (several, each at a position t along the line) instead of one centred `text`; elements may carry `fs` (text size) */
export const FORMAT_VERSION = 2;

export const LIMITS = {
  maxElements: 200_000,
  maxGroups: 50_000,
  maxFileChars: 64 * 1024 * 1024,
  maxText: 20_000,
  maxName: 200,
  maxId: 64,
  maxPts: 4096,
  maxGroupIds: 32,
  maxCoord: 1e9,
  maxDepth: 12,
  minZoom: 0.05,
  maxZoom: 8,
} as const;

const KINDS = ["rect", "ellipse", "diamond", "text", "arrow", "icon", "cylinder", "cloud", "hexagon", "parallelogram", "triangle", "star", "note", "brace", "badge", "frame", "lane", "legend", "image", "calc"] as const;
const ID_RE = /^[A-Za-z0-9_-]+$/;

export interface ArchMeta { name: string; created: number; updated: number }
export interface ArchView { x: number; y: number; zoom: number }
export type Settings = Record<string, unknown>;

export interface ArchFile {
  app: typeof APP;
  version: number;
  meta: ArchMeta;
  view: ArchView;
  settings: Settings;
  scene: SceneJSON;
  /** unknown top-level keys, kept so a newer file survives an older app's round trip */
  extra: Record<string, unknown>;
  /** unknown per-element keys, by element id */
  elExtra: Record<string, Record<string, unknown>>;
}

export type FormatErrorCode = "too_large" | "bad_json" | "not_archypaint" | "unsupported_version" | "invalid" | "too_many_elements" | "too_deep";
export interface FormatError { code: FormatErrorCode; message: string; path?: string }
export type Parsed<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: FormatError };

class Bad extends Error {
  constructor(readonly code: FormatErrorCode, message: string, readonly path?: string) { super(message); }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function fnum(v: unknown, path: string, lo: number = -LIMITS.maxCoord, hi: number = LIMITS.maxCoord): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Bad("invalid", `${path}: expected a finite number`, path);
  if (v < lo || v > hi) throw new Bad("invalid", `${path}: ${v} is outside ${lo}..${hi}`, path);
  return v;
}
function fint(v: unknown, path: string, lo: number, hi: number): number {
  const n = fnum(v, path, lo, hi);
  if (!Number.isInteger(n)) throw new Bad("invalid", `${path}: expected an integer`, path);
  return n;
}
function fstr(v: unknown, path: string, max: number): string {
  if (typeof v !== "string") throw new Bad("invalid", `${path}: expected a string`, path);
  if (v.length > max) throw new Bad("invalid", `${path}: string longer than ${max}`, path);
  return v;
}
function fbool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new Bad("invalid", `${path}: expected a boolean`, path);
  return v;
}
function oneOf<T extends number>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== "number" || !(allowed as readonly number[]).includes(v)) throw new Bad("invalid", `${path}: expected one of ${allowed.join(", ")}`, path);
  return v as T;
}
const opt = <T>(v: unknown, dflt: T, f: (v: unknown) => T): T => (v === undefined ? dflt : f(v));

/** iterative depth check (a recursive one would itself be a stack-overflow vector) */
export function depthOf(root: unknown, limit: number): number {
  let max = 0;
  const stack: Array<[unknown, number]> = [[root, 1]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (typeof v !== "object" || v === null) continue;
    if (d > max) max = d;
    if (d > limit) return d;
    for (const c of Array.isArray(v) ? v : Object.values(v)) stack.push([c, d + 1]);
  }
  return max;
}

function plain(v: unknown, path: string): Record<string, unknown> {
  if (!isObj(v)) throw new Bad("invalid", `${path}: expected an object`, path);
  if (depthOf(v, LIMITS.maxDepth) > LIMITS.maxDepth) throw new Bad("too_deep", `${path}: nested deeper than ${LIMITS.maxDepth}`, path);
  return v;
}

/* ---------------------------------------------------------------- element field tables */

const EL_KNOWN = new Set(["id", "kind", "x", "y", "w", "h", "z", "version", "cat", "hex", "fill", "edge", "radius", "text", "groupIds", "iconId", "img", "locked", "n", "o", "src", "dst", "sp", "dp", "route", "dash", "head", "pts", "fs", "align", "labels", "segs", "st", "dt"]);
const ROOT_KNOWN = new Set(["app", "version", "meta", "view", "settings", "scene"]);

function readEl(raw: unknown, i: number, extras: Record<string, Record<string, unknown>>): ElJSON {
  const p = `scene.els[${i}]`;
  if (!isObj(raw)) throw new Bad("invalid", `${p}: expected an object`, p);
  const id = fstr(raw.id, `${p}.id`, LIMITS.maxId);
  if (!ID_RE.test(id)) throw new Bad("invalid", `${p}.id: only letters, digits, _ and - allowed`, `${p}.id`);
  const kind = fstr(raw.kind, `${p}.kind`, 16);
  if (!(KINDS as readonly string[]).includes(kind)) throw new Bad("invalid", `${p}.kind: unknown kind "${kind}"`, `${p}.kind`);
  let pts: number[] = [];
  if (raw.pts !== undefined) {
    if (!Array.isArray(raw.pts) || raw.pts.length > LIMITS.maxPts || raw.pts.length % 2 !== 0) throw new Bad("invalid", `${p}.pts: expected an even-length array of at most ${LIMITS.maxPts} numbers`, `${p}.pts`);
    pts = raw.pts.map((n, k) => fnum(n, `${p}.pts[${k}]`));
  }
  let groupIds: string[] = [];
  if (raw.groupIds !== undefined) {
    if (!Array.isArray(raw.groupIds) || raw.groupIds.length > LIMITS.maxGroupIds) throw new Bad("invalid", `${p}.groupIds: expected an array of at most ${LIMITS.maxGroupIds} ids`, `${p}.groupIds`);
    groupIds = raw.groupIds.map((g, k) => fstr(g, `${p}.groupIds[${k}]`, LIMITS.maxId));
  }
  const el: ElJSON = {
    id, kind: kind as ElJSON["kind"],
    x: fnum(raw.x, `${p}.x`), y: fnum(raw.y, `${p}.y`),
    w: fnum(raw.w, `${p}.w`, 0, LIMITS.maxCoord), h: fnum(raw.h, `${p}.h`, 0, LIMITS.maxCoord),
    z: opt(raw.z, i + 1, (v) => fint(v, `${p}.z`, 0, 2 ** 31)),
    version: opt(raw.version, 1, (v) => fint(v, `${p}.version`, 0, 2 ** 31)),
    cat: opt(raw.cat, 0, (v) => fint(v, `${p}.cat`, 0, 255)),
    fill: opt(raw.fill, 1, (v) => oneOf(v, `${p}.fill`, [0, 1, 2, 3] as const)),
    edge: opt(raw.edge, 1, (v) => oneOf(v, `${p}.edge`, [0, 1, 2] as const)),
    radius: opt(raw.radius, 8, (v) => fnum(v, `${p}.radius`, 0, 1e4)),
    text: opt(raw.text, "", (v) => fstr(v, `${p}.text`, LIMITS.maxText)),
    groupIds,
    iconId: opt(raw.iconId, "", (v) => fstr(v, `${p}.iconId`, LIMITS.maxId)),
    img: opt(raw.img, "", (v) => fstr(v, `${p}.img`, LIMITS.maxId)),
    locked: opt(raw.locked, false, (v) => fbool(v, `${p}.locked`)),
    n: opt(raw.n, 0, (v) => fint(v, `${p}.n`, 0, 99999)),
    o: opt(raw.o, 0, (v) => oneOf(v, `${p}.o`, [0, 1, 2, 3] as const)),
    src: opt(raw.src, "", (v) => fstr(v, `${p}.src`, LIMITS.maxId)),
    dst: opt(raw.dst, "", (v) => fstr(v, `${p}.dst`, LIMITS.maxId)),
    sp: opt(raw.sp, -1, (v) => oneOf(v, `${p}.sp`, [-1, 0, 1, 2, 3, 4, 5, 6, 7] as const)),
    dp: opt(raw.dp, -1, (v) => oneOf(v, `${p}.dp`, [-1, 0, 1, 2, 3, 4, 5, 6, 7] as const)),
    route: opt(raw.route, 1, (v) => oneOf(v, `${p}.route`, [0, 1, 2] as const)),
    dash: opt(raw.dash, 0, (v) => oneOf(v, `${p}.dash`, [0, 1] as const)),
    head: opt(raw.head, 1, (v) => oneOf(v, `${p}.head`, [0, 1, 2] as const)),
    pts,
  };
  const hx = normHex(raw.hex); if (hx) el.hex = hx;
  if (raw.fs !== undefined) { const f = fnum(raw.fs, `${p}.fs`, 0, 200); if (f >= 1) el.fs = Math.round(f); }
  if (raw.align === "left" || raw.align === "right") el.align = raw.align; // absent (or "center", or anything else) = centred
  if (kind === "arrow") {
    const ls = cleanLabels(raw.labels); if (ls.length) el.labels = ls; migrateArrowText(el);
    const sg = cleanSegs(raw.segs); if (sg) el.segs = sg;
    if (raw.st !== undefined) el.st = fnum(raw.st, `${p}.st`, 0, 1);
    if (raw.dt !== undefined) el.dt = fnum(raw.dt, `${p}.dt`, 0, 1);
  }
  let ex: Record<string, unknown> | null = null;
  for (const k of Object.keys(raw)) if (!EL_KNOWN.has(k)) (ex ??= {})[k] = plain({ v: raw[k] }, `${p}.${k}`).v;
  if (ex) extras[id] = ex;
  return el;
}

function readGroup(raw: unknown, i: number): GroupInfo {
  const p = `scene.groups[${i}]`;
  if (!isObj(raw)) throw new Bad("invalid", `${p}: expected an object`, p);
  const id = fstr(raw.id, `${p}.id`, LIMITS.maxId);
  if (!ID_RE.test(id)) throw new Bad("invalid", `${p}.id: only letters, digits, _ and - allowed`, `${p}.id`);
  return {
    id,
    name: opt(raw.name, "", (v) => fstr(v, `${p}.name`, LIMITS.maxName)),
    cat: opt(raw.cat, 0, (v) => fint(v, `${p}.cat`, 0, 255)),
    collapsed: opt(raw.collapsed, false, (v) => fbool(v, `${p}.collapsed`)),
    locked: opt(raw.locked, false, (v) => fbool(v, `${p}.locked`)),
  };
}

/* ---------------------------------------------------------------- migration */

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
/** MIGRATIONS[n] upgrades a version-n document to n+1. Version 0 = a bare `{els, groups}` scene with no header. */
export const MIGRATIONS: Record<number, Migration> = {
  0: (raw) => {
    const now = Date.now();
    return {
      app: APP, version: 1,
      meta: { name: "untitled", created: now, updated: now },
      view: { x: 0, y: 0, zoom: 1 }, settings: {},
      scene: isObj(raw.scene) ? raw.scene : { els: raw.els ?? [], groups: raw.groups ?? [] },
    };
  },
  // 1 -> 2: nothing to rewrite in the raw document: readEl turns a version-1 arrow's single `text` into one label at t = 0.5, and the new fields are optional
  1: (raw) => ({ ...raw, version: 2 }),
};

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let v = typeof raw.version === "number" ? raw.version : 0;
  if (!Number.isInteger(v) || v < 0) throw new Bad("invalid", "version: expected a non-negative integer", "version");
  if (v > FORMAT_VERSION) throw new Bad("unsupported_version", `this file is version ${v}; this app reads up to version ${FORMAT_VERSION} — update archypaint to open it`, "version");
  if (v === 0 && raw.app !== undefined && raw.app !== APP) throw new Bad("not_archypaint", "not an archypaint file", "app");
  if (v === 0 && raw.app === undefined && !Array.isArray(raw.els) && !isObj(raw.scene)) throw new Bad("not_archypaint", "not an archypaint file", "app");
  let cur = raw;
  while (v < FORMAT_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Bad("unsupported_version", `no migration from version ${v}`, "version");
    cur = m(cur); v = typeof cur.version === "number" ? cur.version : v + 1;
  }
  return cur;
}

/* ---------------------------------------------------------------- validate / parse */

export function validateFile(input: unknown): Parsed<ArchFile> {
  try {
    if (!isObj(input)) throw new Bad("not_archypaint", "not an archypaint file");
    const warnings: string[] = [];
    const raw = migrate(input);
    if (raw.app !== APP) throw new Bad("not_archypaint", "not an archypaint file", "app");

    const m = isObj(raw.meta) ? raw.meta : {};
    const now = Date.now();
    const meta: ArchMeta = {
      name: opt(m.name, "untitled", (v) => fstr(v, "meta.name", LIMITS.maxName)),
      created: opt(m.created, now, (v) => fnum(v, "meta.created", 0, 8.64e15)),
      updated: opt(m.updated, now, (v) => fnum(v, "meta.updated", 0, 8.64e15)),
    };
    const vw = isObj(raw.view) ? raw.view : {};
    let zoom = opt(vw.zoom, 1, (v) => fnum(v, "view.zoom", 1e-6, 1e6));
    if (zoom < LIMITS.minZoom || zoom > LIMITS.maxZoom) { warnings.push(`view.zoom ${zoom} clamped`); zoom = Math.min(LIMITS.maxZoom, Math.max(LIMITS.minZoom, zoom)); }
    const view: ArchView = { x: opt(vw.x, 0, (v) => fnum(v, "view.x")), y: opt(vw.y, 0, (v) => fnum(v, "view.y")), zoom };
    const settings = raw.settings === undefined ? {} : plain(raw.settings, "settings");

    const sc = raw.scene;
    if (!isObj(sc)) throw new Bad("invalid", "scene: expected an object", "scene");
    const rawEls = sc.els ?? [];
    const rawGroups = sc.groups ?? [];
    if (!Array.isArray(rawEls)) throw new Bad("invalid", "scene.els: expected an array", "scene.els");
    if (!Array.isArray(rawGroups)) throw new Bad("invalid", "scene.groups: expected an array", "scene.groups");
    if (rawEls.length > LIMITS.maxElements) throw new Bad("too_many_elements", `scene.els: ${rawEls.length} elements exceeds the limit of ${LIMITS.maxElements}`, "scene.els");
    if (rawGroups.length > LIMITS.maxGroups) throw new Bad("too_many_elements", `scene.groups: exceeds the limit of ${LIMITS.maxGroups}`, "scene.groups");

    const elExtra: Record<string, Record<string, unknown>> = {};
    const els: ElJSON[] = [];
    const seen = new Set<string>();
    let dupes = 0;
    for (let i = 0; i < rawEls.length; i++) {
      const e = readEl(rawEls[i], i, elExtra);
      if (seen.has(e.id)) { dupes++; delete elExtra[e.id]; continue; }
      seen.add(e.id); els.push(e);
    }
    if (dupes) warnings.push(`${dupes} element(s) with duplicate ids dropped`);
    const groups: GroupInfo[] = [];
    const gseen = new Set<string>();
    for (let i = 0; i < rawGroups.length; i++) {
      const g = readGroup(rawGroups[i], i);
      if (!gseen.has(g.id)) { gseen.add(g.id); groups.push(g); }
    }
    // a connector end may be bound to an element or to a group (its boundary has ports like a shape's); anything else is dangling
    let repaired = 0;
    for (const e of els) {
      if (e.kind !== "arrow") continue;
      if (e.src && !seen.has(e.src) && !gseen.has(e.src)) { e.src = ""; repaired++; }
      if (e.dst && !seen.has(e.dst) && !gseen.has(e.dst)) { e.dst = ""; repaired++; }
    }
    if (repaired) warnings.push(`${repaired} dangling arrow binding(s) cleared`);
    // an end bound to another arrow must not make a cycle or hang deeper than MAX_BRANCH_DEPTH: such ends are freed (geometry stays)
    const byId = new Map<string, ElJSON>();
    for (const e of els) if (e.kind === "arrow") byId.set(e.id, e);
    const hostsOf = (e: ElJSON): ElJSON[] => [byId.get(e.src), byId.get(e.dst)].filter((h): h is ElJSON => h !== undefined);
    const reach = (from: ElJSON, target: string, n: number): boolean => n <= 0 || hostsOf(from).some((h) => h.id === target || reach(h, target, n - 1));
    const depthOf = (e: ElJSON, n: number): number => (n > MAX_BRANCH_DEPTH ? Infinity : hostsOf(e).reduce((m, h) => Math.max(m, 1 + depthOf(h, n + 1)), 0));
    let freed = 0;
    for (const e of byId.values()) {
      for (const end of ["src", "dst"] as const) {
        const h = byId.get(e[end]);
        if (!h) continue;
        if (h.id === e.id || reach(h, e.id, MAX_BRANCH_DEPTH + 1) || 1 + depthOf(h, 0) > MAX_BRANCH_DEPTH) { e[end] = ""; delete e[end === "src" ? "st" : "dt"]; freed++; }
      }
    }
    if (freed) warnings.push(`${freed} arrow-to-arrow binding(s) cleared (cycle or too deep)`);

    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(raw)) if (!ROOT_KNOWN.has(k)) extra[k] = plain({ v: raw[k] }, k).v;

    return { ok: true, warnings, value: { app: APP, version: FORMAT_VERSION, meta, view, settings, scene: { els, groups }, extra, elExtra } };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: { code: e.code, message: e.message, ...(e.path ? { path: e.path } : {}) } };
    return { ok: false, error: { code: "invalid", message: e instanceof Error ? e.message : String(e) } };
  }
}

/** text -> validated file. Never throws; check `.ok`. */
export function parseArch(text: string): Parsed<ArchFile> {
  if (text.length > LIMITS.maxFileChars) return { ok: false, error: { code: "too_large", message: `file is larger than ${LIMITS.maxFileChars / 1048576} MB` } };
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (e) { return { ok: false, error: { code: e instanceof RangeError ? "too_deep" : "bad_json", message: e instanceof Error ? e.message : "not valid JSON" } }; }
  return validateFile(raw);
}

/* ---------------------------------------------------------------- serialise (deterministic) */

const r3 = (n: number): number => Math.round(n * 1000) / 1000 + 0; // 3 dp; `+ 0` turns -0 into 0

/** structurally-typed so live `El` objects (with spatial-index fields) can be passed without copying */
export type ElLike = Omit<ElJSON, never>;

/** fixed key order; arrow-only, icon-only and default-valued fields are omitted so files stay small and diff cleanly */
export function orderEl(e: ElLike, extra?: Record<string, unknown>): string {
  const o: Record<string, unknown> = { id: e.id, kind: e.kind, x: r3(e.x), y: r3(e.y), w: r3(e.w), h: r3(e.h), z: e.z, version: e.version, cat: e.cat, fill: e.fill, edge: e.edge, radius: r3(e.radius) };
  if (e.text) o.text = e.text;
  if (e.locked) o.locked = true;
  if (e.hex) o.hex = e.hex;
  if (e.fs) o.fs = e.fs;
  if (e.align === "left" || e.align === "right") o.align = e.align;
  if (e.kind === "arrow" && e.labels && e.labels.length) o.labels = e.labels.map((l) => ({ t: r3(l.t), text: l.text }));
  if (e.groupIds.length) o.groupIds = e.groupIds;
  if (e.kind === "icon") o.iconId = e.iconId;
  if (e.kind === "image") o.img = e.img;
  if (e.n) o.n = e.n;
  if (e.o) o.o = e.o;
  if (e.kind !== "arrow" && e.dash) o.dash = e.dash;
  if (e.kind === "arrow") {
    if (e.segs && e.segs.length) o.segs = e.segs;
    if (e.src && e.st !== undefined) o.st = r3(e.st);
    if (e.dst && e.dt !== undefined) o.dt = r3(e.dt);
    o.src = e.src; o.dst = e.dst; o.sp = e.sp; o.dp = e.dp; o.route = e.route; o.dash = e.dash; o.head = e.head; o.pts = e.pts.map(r3);
  }
  if (extra) for (const k of Object.keys(extra).sort()) if (!(k in o) && !EL_KNOWN.has(k)) o[k] = extra[k];
  return JSON.stringify(o);
}

export function stableStringify(v: unknown, depth = 0): string {
  if (depth > 64) throw new Error("stableStringify: nesting too deep");
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x, depth + 1)).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k], depth + 1)}`).join(",")}}`;
}

export interface Header { meta: ArchMeta; view: ArchView; settings: Settings; groups: GroupInfo[]; extra?: Record<string, unknown> }

export function headerPart(h: Header): { head: string; tail: string } {
  const view = { x: r3(h.view.x), y: r3(h.view.y), zoom: r3(h.view.zoom) };
  const head = `{\n"app":"${APP}",\n"version":${FORMAT_VERSION},\n"meta":${stableStringify(h.meta)},\n"view":${stableStringify(view)},\n"settings":${stableStringify(h.settings)},\n"scene":{"groups":${stableStringify(h.groups)},"els":[`;
  let tail = "\n]}";
  if (h.extra) for (const k of Object.keys(h.extra).sort()) if (!ROOT_KNOWN.has(k)) tail += `,\n${JSON.stringify(k)}:${stableStringify(h.extra[k])}`;
  return { head, tail: tail + "\n}\n" };
}

/** synchronous serialise — for small documents, tests and the page-hide flush. Sorted by z for stable diffs. */
export function serializeArch(f: Pick<ArchFile, "meta" | "view" | "settings" | "scene"> & Partial<Pick<ArchFile, "extra" | "elExtra">>): string {
  const { head, tail } = headerPart({ meta: f.meta, view: f.view, settings: f.settings, groups: f.scene.groups, ...(f.extra ? { extra: f.extra } : {}) });
  const els = [...f.scene.els].sort((a, b) => a.z - b.z);
  return head + (els.length ? "\n" : "") + els.map((e) => orderEl(e, f.elExtra?.[e.id])).join(",\n") + tail;
}
