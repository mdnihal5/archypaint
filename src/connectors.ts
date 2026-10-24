import type { ArrowLabel, El, EdgeStyle, Port, Route, Scene } from "./scene";
import { outlinePort } from "./shape-geom";

export interface Rect { x: number; y: number; w: number; h: number; /** element kind, so ports of polygon shapes land on the real outline */ kind?: string; /** corner radius, so corner ports sit on the rounded outline */ radius?: number }
/** one end of a connector: either glued to a shape's port (rect set) or a free point */
export interface Anchor { rect: Rect | null; pt: readonly [number, number]; port: Port }

type P = [number, number];
const DIRS: readonly P[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const STUB = 18;

/** soft edge turns an elbow into a bezier; straight and curve are unaffected */
export function effectiveRoute(route: Route, edge: EdgeStyle): Route {
  return route === 1 && edge === 2 ? 2 : route;
}

/** ports per shape: 4 side midpoints + 4 corners */
export const PORT_COUNT = 8;
const K45 = Math.SQRT1_2;
/** the two sides a corner port can leave through: [horizontal, vertical] */
const CORNER_SIDES: readonly [number, number][] = [[3, 0], [1, 0], [1, 2], [3, 2]];

function cornerPoint(r: Rect, c: number): P {
  const sx = c === 1 || c === 2 ? 1 : -1, sy = c >= 2 ? 1 : -1;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (r.kind === "ellipse") return [cx + sx * (r.w / 2) * K45, cy + sy * (r.h / 2) * K45];
  if (r.kind === "diamond") return [cx + sx * r.w / 4, cy + sy * r.h / 4];
  const inset = Math.min(r.radius ?? 0, r.w / 2, r.h / 2) * (1 - K45);
  return [sx < 0 ? r.x + inset : r.x + r.w - inset, sy < 0 ? r.y + inset : r.y + r.h - inset];
}

export function portPoint(r: Rect, side: number): P {
  if (r.kind !== undefined) { const o = outlinePort(r, side); if (o) return [o[0], o[1]]; }
  if (side >= 4) return cornerPoint(r, side - 4);
  switch (side) {
    case 0: return [r.x + r.w / 2, r.y];
    case 1: return [r.x + r.w, r.y + r.h / 2];
    case 2: return [r.x + r.w / 2, r.y + r.h];
    default: return [r.x, r.y + r.h / 2];
  }
}

/** side of `r` facing the point (tx,ty) */
export function nearestSide(r: Rect, tx: number, ty: number): 0 | 1 | 2 | 3 {
  const dx = (tx - (r.x + r.w / 2)) / (r.w / 2 || 1), dy = (ty - (r.y + r.h / 2)) / (r.h / 2 || 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

interface Resolved { p: P; side: number; stub: number }

function resolve(a: Anchor, other: Anchor): Resolved {
  const tx = other.rect ? other.rect.x + other.rect.w / 2 : other.pt[0];
  const ty = other.rect ? other.rect.y + other.rect.h / 2 : other.pt[1];
  if (a.rect) {
    if (a.port >= 4) { // a corner leaves through whichever adjacent side faces the other end more
      const p = portPoint(a.rect, a.port), [h, v] = CORNER_SIDES[a.port - 4]!;
      return { p, side: Math.abs(tx - p[0]) > Math.abs(ty - p[1]) ? h : v, stub: STUB };
    }
    const side = a.port >= 0 ? a.port : nearestSide(a.rect, tx, ty);
    return { p: portPoint(a.rect, side), side, stub: STUB };
  }
  const dx = tx - a.pt[0], dy = ty - a.pt[1];
  const side = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 1 : 3) : dy >= 0 ? 2 : 0;
  return { p: [a.pt[0], a.pt[1]], side, stub: 0 };
}

const EPS = 0.01;

function segHitsRect(a: P, b: P, r: Rect): boolean {
  // shrunk by 1 so touching the boundary (ports) does not count
  const x0 = r.x + 1, y0 = r.y + 1, x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
  if (x1 <= x0 || y1 <= y0) return false;
  const sx0 = Math.min(a[0], b[0]), sx1 = Math.max(a[0], b[0]), sy0 = Math.min(a[1], b[1]), sy1 = Math.max(a[1], b[1]);
  return sx1 > x0 && sx0 < x1 && sy1 > y0 && sy0 < y1;
}

function clean(pts: P[]): P[] {
  const out: P[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (l && Math.abs(l[0] - p[0]) < EPS && Math.abs(l[1] - p[1]) < EPS) continue;
    out.push(p);
  }
  // drop collinear middle points
  const res: P[] = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i]!, a = res[res.length - 1], n = out[i + 1];
    if (a && n) {
      const c = (p[0] - a[0]) * (n[1] - p[1]) - (p[1] - a[1]) * (n[0] - p[0]);
      const dot = (p[0] - a[0]) * (n[0] - p[0]) + (p[1] - a[1]) * (n[1] - p[1]);
      if (Math.abs(c) < EPS && dot >= 0) continue;
    }
    res.push(p);
  }
  return res;
}

function score(path: P[], ra: Rect | null, rb: Rect | null): number {
  let len = 0, pen = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!;
    len += Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (ra && segHitsRect(a, b, ra)) pen += 1e6;
    if (rb && segHitsRect(a, b, rb)) pen += 1e6;
    const c = path[i + 2];
    if (c) { const d = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]); if (d < -EPS) pen += 1e5; }
  }
  return pen + (path.length - 2) * 1000 + len;
}

/**
 * Pure routing: a FIXED, finite list of candidate paths is scored and the best wins — there is no
 * search loop, so overlapping or degenerate shapes cannot make it spin. Returns flat x,y pairs:
 * straight = 4 numbers, elbow = polyline, curve = 8 numbers (start, 2 controls, end).
 */
export function routeArrow(a: Anchor, b: Anchor, route: Route): number[] {
  const A = resolve(a, b), B = resolve(b, a);
  const p0 = A.p, q0 = B.p;
  if (route === 0) return [p0[0], p0[1], q0[0], q0[1]];
  const sd = DIRS[A.side]!, ed = DIRS[B.side]!;
  if (route === 2) {
    const k = Math.max(30, Math.min(160, Math.hypot(q0[0] - p0[0], q0[1] - p0[1]) * 0.4));
    return [p0[0], p0[1], p0[0] + sd[0] * k, p0[1] + sd[1] * k, q0[0] + ed[0] * k, q0[1] + ed[1] * k, q0[0], q0[1]];
  }
  const p1: P = [p0[0] + sd[0] * A.stub, p0[1] + sd[1] * A.stub];
  const q1: P = [q0[0] + ed[0] * B.stub, q0[1] + ed[1] * B.stub];
  const hs = sd[0] !== 0, he = ed[0] !== 0;
  const mx = (p1[0] + q1[0]) / 2, my = (p1[1] + q1[1]) / 2;
  const ra = a.rect, rb = b.rect;
  const cands: P[][] = [];
  const top = Math.min(p1[1], q1[1], ra ? ra.y : Infinity, rb ? rb.y : Infinity) - 24;
  const bot = Math.max(p1[1], q1[1], ra ? ra.y + ra.h : -Infinity, rb ? rb.y + rb.h : -Infinity) + 24;
  const lft = Math.min(p1[0], q1[0], ra ? ra.x : Infinity, rb ? rb.x : Infinity) - 24;
  const rgt = Math.max(p1[0], q1[0], ra ? ra.x + ra.w : -Infinity, rb ? rb.x + rb.w : -Infinity) + 24;
  if (hs && he) {
    cands.push([p1, [mx, p1[1]], [mx, q1[1]], q1], [p1, [p1[0], top], [q1[0], top], q1], [p1, [p1[0], bot], [q1[0], bot], q1]);
  } else if (!hs && !he) {
    cands.push([p1, [p1[0], my], [q1[0], my], q1], [p1, [lft, p1[1]], [lft, q1[1]], q1], [p1, [rgt, p1[1]], [rgt, q1[1]], q1]);
  } else if (hs) {
    cands.push([p1, [q1[0], p1[1]], q1], [p1, [p1[0], q1[1]], q1], [p1, [mx, p1[1]], [mx, q1[1]], q1]);
  } else {
    cands.push([p1, [p1[0], q1[1]], q1], [p1, [q1[0], p1[1]], q1], [p1, [p1[0], my], [q1[0], my], q1]);
  }
  let best: P[] | null = null, bs = Infinity;
  for (const c of cands) {
    const path = clean([p0, ...c, q0]);
    const s = score(path, ra, rb);
    if (s < bs) { bs = s; best = path; }
  }
  let out = best ?? [p0, q0];
  if (out.length < 2) out = [p0, q0]; // identical endpoints collapse to one point after cleaning
  const flat: number[] = [];
  for (const p of out) flat.push(p[0], p[1]);
  return flat;
}

export function bboxOfPts(pts: readonly number[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i]!, y = pts[i + 1]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** where a branch end sits: the point a fraction t along arrow `id`'s path (false when `id` is not an arrow) */
export type HostPt = (id: string, t: number, out: [number, number]) => boolean;
/** id -> rectangle; may also carry `host`, which resolves arrow-bound (branch) ends. Drag previews wrap it and keep `host`. */
export type RectOf = ((id: string) => Rect | null) & { host?: HostPt };

const hp: [number, number] = [0, 0];

/** anchors of an arrow; `rectOf` lets a drag preview substitute moved rectangles */
export function anchorsOf(e: El, rectOf: RectOf): [Anchor, Anchor] {
  const n = e.pts.length;
  const s: [number, number] = [e.pts[0] ?? e.x, e.pts[1] ?? e.y], t: [number, number] = [e.pts[n - 2] ?? e.x + e.w, e.pts[n - 1] ?? e.y + e.h];
  const sr = e.src ? rectOf(e.src) : null, dr = e.dst ? rectOf(e.dst) : null;
  // a branch end (bound to another arrow at fraction st / dt of its path) is a free point that follows the host's path
  if (!sr && e.src && rectOf.host?.(e.src, e.st ?? 0.5, hp)) { s[0] = hp[0]; s[1] = hp[1]; }
  if (!dr && e.dst && rectOf.host?.(e.dst, e.dt ?? 0.5, hp)) { t[0] = hp[0]; t[1] = hp[1]; }
  return [
    { rect: sr, pt: s, port: sr ? e.sp : -1 },
    { rect: dr, pt: t, port: dr ? e.dp : -1 },
  ];
}

export function computeArrowPts(e: El, rectOf: RectOf): number[] {
  const [a, b] = anchorsOf(e, rectOf);
  const route = effectiveRoute(e.route, e.edge);
  const pts = routeArrow(a, b, route);
  return route === 1 && e.segs && e.segs.length ? applySegs(pts, e.segs) : pts;
}

/* ---- manual elbow segments ----------------------------------------------------------------------------------------- */

/**
 * An elbow arrow remembers where the user pushed its INTERIOR segments (not the two that touch the ends, so the ends never move).
 * `segs` is flat pairs [code, d]: code = 2 * index + (vertical ? 1 : 0), index counting segments of the auto-routed path (0 = first),
 * d = how far the segment sits from where the router puts it, perpendicular to itself. An offset from the router's own position
 * (not an absolute coordinate) follows the arrow when its shapes move, so a big move can never strand the bend in empty space.
 * An entry whose index or orientation no longer exists in the auto path (the route changed shape) is ignored, not applied wrongly.
 */
export const MAX_SEG_PAIRS = 8;
/** an elbow segment shorter than this on screen gets no handle (it would sit on top of its neighbours' corners) */
export const SEG_MIN_PX = 28;
const segFlags: number[] = [];

/** shift the recorded segments of an auto-routed orthogonal path (in place); every move keeps the path orthogonal */
export function applySegs(p: number[], segs: readonly number[]): number[] {
  const nv = p.length >> 1;
  segFlags.length = 0;
  for (let s = 0; s + 1 < segs.length; s += 2) {
    const k = (segs[s]! as number) >> 1;
    let f = 0; // 1 = horizontal, 2 = vertical
    if (k >= 1 && k <= nv - 3) {
      const dx = Math.abs(p[2 * k]! - p[2 * k + 2]!), dy = Math.abs(p[2 * k + 1]! - p[2 * k + 3]!);
      if (dy < EPS && dx >= EPS) f = 1; else if (dx < EPS && dy >= EPS) f = 2;
    }
    segFlags.push(f);
  }
  for (let s = 0, i = 0; s + 1 < segs.length; s += 2, i++) {
    const code = segs[s]!, d = segs[s + 1]!, k = code >> 1, f = segFlags[i]!;
    if (!Number.isFinite(d) || f === 0 || (f === 2) !== ((code & 1) === 1)) continue;
    const o = f === 1 ? 1 : 0;
    p[2 * k + o] = p[2 * k + o]! + d; p[2 * k + 2 + o] = p[2 * k + 2 + o]! + d;
  }
  return p;
}

/** visit the interior segments of a polyline: index k, midpoint, orientation and length. Allocation-free. */
export function eachInteriorSeg(p: readonly number[], fn: (k: number, mx: number, my: number, vertical: boolean, len: number) => void): void {
  const nv = p.length >> 1;
  for (let k = 1; k <= nv - 3; k++) {
    const ax = p[2 * k]!, ay = p[2 * k + 1]!, bx = p[2 * k + 2]!, by = p[2 * k + 3]!;
    const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    if (dx < EPS && dy < EPS) continue;
    if (dy < EPS) fn(k, (ax + bx) / 2, ay, false, dx); else if (dx < EPS) fn(k, ax, (ay + by) / 2, true, dy);
  }
}

/** `segs` with the entry for `code` set to offset `d` (a near-zero offset removes it); undefined when nothing is left */
export function withSeg(segs: readonly number[] | undefined, code: number, d: number): number[] | undefined {
  const out: number[] = [];
  if (segs) for (let i = 0; i + 1 < segs.length; i += 2) if (segs[i] !== code) out.push(segs[i]!, segs[i + 1]!);
  if (Math.abs(d) >= 0.5 && Number.isFinite(d) && out.length / 2 < MAX_SEG_PAIRS) out.push(code, Math.round(d * 100) / 100);
  return out.length ? out : undefined;
}

/** coerce untrusted segment data into valid pairs (finite, bounded count and magnitude); undefined when none survive */
export function cleanSegs(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: number[] = [];
  for (let i = 0; i + 1 < raw.length && out.length / 2 < MAX_SEG_PAIRS; i += 2) {
    const c = raw[i], d = raw[i + 1];
    if (typeof c !== "number" || typeof d !== "number" || !Number.isInteger(c) || c < 2 || c > 1e4 || !Number.isFinite(d) || Math.abs(d) > 1e6 || out.includes(c)) continue;
    out.push(c, d);
  }
  return out.length ? out : undefined;
}

/** an id names an element (an arrow is not a rectangle: it resolves through `.host`) or, failing that, a group (its padded bounds) */
export function sceneRectOf(scene: Scene): RectOf {
  const f: RectOf = (id) => {
    const t = scene.els.get(id);
    if (t) return t.kind !== "arrow" ? t : null;
    return scene.groupRect ? scene.groupRect(id) : null;
  };
  f.host = (id, t, out) => {
    const h = scene.els.get(id);
    if (!h || h.kind !== "arrow") return false;
    pointAtT(h.pts, isCurve(h), t, out);
    return true;
  };
  return f;
}

/* ---- branches: an arrow end bound to a point on another arrow --------------------------------------------------------- */

/** deepest chain of host arrows a branch may hang from (A on B on C ...). Deeper bindings are refused; load repairs them. */
export const MAX_BRANCH_DEPTH = 4;

/** how many hosts deep `e` hangs: 0 = bound to no arrow. Infinity when the chain is cyclic or longer than MAX_BRANCH_DEPTH. */
export function hostDepth(scene: Scene, e: El, seen = 0): number {
  if (seen > MAX_BRANCH_DEPTH) return Infinity;
  let m = 0;
  for (let i = 0; i < 2; i++) {
    const id = i === 0 ? e.src : e.dst, h = id ? scene.els.get(id) : undefined;
    if (h && h.kind === "arrow") m = Math.max(m, 1 + hostDepth(scene, h, seen + 1));
  }
  return m;
}

function reaches(scene: Scene, from: El, target: string, n: number): boolean {
  if (n <= 0) return true; // too deep counts as a cycle
  for (let i = 0; i < 2; i++) {
    const id = i === 0 ? from.src : from.dst;
    if (!id) continue;
    if (id === target) return true;
    const h = scene.els.get(id);
    if (h && h.kind === "arrow" && reaches(scene, h, target, n - 1)) return true;
  }
  return false;
}

/** may arrow `arrowId` (an existing one, or "" for a new arrow) bind an end to arrow `hostId`? Refuses itself, cycles and over-deep chains. */
export function canBindToArrow(scene: Scene, arrowId: string, hostId: string): boolean {
  const h = scene.els.get(hostId);
  if (!h || h.kind !== "arrow" || hostId === arrowId) return false;
  if (arrowId && reaches(scene, h, arrowId, MAX_BRANCH_DEPTH + 1)) return false;
  return 1 + hostDepth(scene, h) <= MAX_BRANCH_DEPTH;
}

/* ---- connector labels: positions along the routed path ------------------------------------------------------------- */

const NO_LABELS: readonly ArrowLabel[] = [];
const LEGACY: ArrowLabel[] = [{ t: 0.5, text: "" }];

/**
 * The labels an arrow carries. Files and callers written before multi-label support keep a single centred label in `text`;
 * that reads as one label at t = 0.5 (the same object is reused, so treat the result as read-only and do not hold it).
 */
export function arrowLabels(e: { labels?: readonly ArrowLabel[] | undefined; text: string }): readonly ArrowLabel[] {
  if (e.labels && e.labels.length) return e.labels;
  if (!e.text) return NO_LABELS;
  LEGACY[0]!.text = e.text;
  return LEGACY;
}

export const MAX_LABELS = 12;
export const MAX_LABEL_TEXT = 200;

/** coerce untrusted label data (a file, the clipboard, an import) into valid labels: bad entries drop, t clamps to [0,1], text is bounded */
export function cleanLabels(raw: unknown): ArrowLabel[] {
  const out: ArrowLabel[] = [];
  if (!Array.isArray(raw)) return out;
  for (const l of raw) {
    if (out.length >= MAX_LABELS) break;
    if (typeof l !== "object" || l === null) continue;
    const { t, text } = l as { t?: unknown; text?: unknown };
    if (typeof text !== "string" || text === "") continue;
    out.push({ t: typeof t === "number" && Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5, text: text.slice(0, MAX_LABEL_TEXT) });
  }
  return out;
}

/** move a legacy single `text` on an arrow into `labels` (one label at t = 0.5); a no-op for anything else */
export function migrateArrowText<T extends { kind: string; text: string; labels?: ArrowLabel[] | undefined }>(e: T): T {
  if (e.kind !== "arrow") return e;
  if (!e.labels || e.labels.length === 0) {
    if (e.text) e.labels = [{ t: 0.5, text: e.text.slice(0, MAX_LABEL_TEXT) }];
    else delete e.labels;
  }
  if (e.labels) e.text = "";
  return e;
}

const SAMPLES = 24;

/** visit the drawn path as straight pieces: the polyline itself, or 24 chords of the bezier. Allocation-free. */
type SegFn = (ax: number, ay: number, bx: number, by: number) => void;
function eachSeg(p: readonly number[], curve: boolean, fn: SegFn): void {
  if (curve && p.length === 8) {
    const q: [number, number] = [0, 0]; let lx = p[0]!, ly = p[1]!;
    for (let i = 1; i <= SAMPLES; i++) { bezierAt(p, i / SAMPLES, q); fn(lx, ly, q[0], q[1]); lx = q[0]; ly = q[1]; }
    return;
  }
  for (let i = 0; i + 3 < p.length; i += 2) fn(p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!);
}

// module-level scratch + hoisted visitors: positioning a label allocates nothing (it runs for every label on every static frame)
const st = { total: 0, target: 0, acc: 0, x: 0, y: 0, done: false, best: Infinity, bt: 0, px: 0, py: 0 };
const sumLen = (ax: number, ay: number, bx: number, by: number): void => { st.total += Math.hypot(bx - ax, by - ay); };
const seekPoint = (ax: number, ay: number, bx: number, by: number): void => {
  if (st.done) return;
  const l = Math.hypot(bx - ax, by - ay);
  if (st.acc + l >= st.target) { const u = l ? (st.target - st.acc) / l : 0; st.x = ax + (bx - ax) * u; st.y = ay + (by - ay) * u; st.done = true; return; }
  st.acc += l; st.x = bx; st.y = by;
};
const seekNearest = (ax: number, ay: number, bx: number, by: number): void => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
  const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((st.px - ax) * dx + (st.py - ay) * dy) / l2));
  const d = Math.hypot(st.px - (ax + u * dx), st.py - (ay + u * dy));
  if (d < st.best) { st.best = d; st.bt = (st.acc + u * l) / st.total; }
  st.acc += l;
};

/** the point a fraction `t` of the way along the path (by length), written to `out`. A path of zero length yields its start. */
export function pointAtT(p: readonly number[], curve: boolean, t: number, out: [number, number]): void {
  st.total = 0; eachSeg(p, curve, sumLen);
  st.x = p[0] ?? 0; st.y = p[1] ?? 0;
  st.target = Math.max(0, Math.min(1, t)) * st.total; st.acc = 0; st.done = false;
  eachSeg(p, curve, seekPoint);
  out[0] = st.x; out[1] = st.y;
}

/** the t in [0,1] of the point on the path nearest to (px,py) — what dragging a label along its line sets */
export function nearestT(p: readonly number[], curve: boolean, px: number, py: number): number {
  st.total = 0; eachSeg(p, curve, sumLen);
  if (st.total === 0) return 0.5;
  st.best = Infinity; st.bt = 0; st.acc = 0; st.px = px; st.py = py;
  eachSeg(p, curve, seekNearest);
  return st.bt;
}

/** is the arrow drawn as a bezier (curve route and the 8-number control-point form)? */
export function isCurve(e: { route: Route; edge: EdgeStyle; pts: readonly number[] }): boolean {
  return effectiveRoute(e.route, e.edge) === 2 && e.pts.length === 8;
}

/** sampled point on a cubic given 8 numbers, t in [0,1] */
export function bezierAt(p: readonly number[], t: number, out: [number, number]): void {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  out[0] = a * p[0]! + b * p[2]! + c * p[4]! + d * p[6]!;
  out[1] = a * p[1]! + b * p[3]! + c * p[5]! + d * p[7]!;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** distance from a point to the drawn connector path */
export function arrowDist(e: El, px: number, py: number): number {
  const p = e.pts;
  if (p.length < 4) return Infinity;
  let d = Infinity;
  if (effectiveRoute(e.route, e.edge) === 2 && p.length === 8) {
    const q: [number, number] = [0, 0]; let lx = p[0]!, ly = p[1]!;
    for (let i = 1; i <= 16; i++) { bezierAt(p, i / 16, q); d = Math.min(d, segDist(px, py, lx, ly, q[0], q[1])); lx = q[0]; ly = q[1]; }
    return d;
  }
  for (let i = 0; i + 3 < p.length; i += 2) d = Math.min(d, segDist(px, py, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!));
  return d;
}

export interface RerouteResult { id: string; pts: number[] }

/**
 * Recompute every arrow whose src/dst is in `ids`, then (branches) every arrow bound to one of those arrows, level by level.
 * The closure is capped at MAX_BRANCH_DEPTH + 1 levels and each arrow is visited once, so a cycle cannot loop. Results come out
 * hosts-first and each branch is routed against its host's fresh path.
 */
export function rerouteBound(scene: Scene, ids: ReadonlySet<string>): RerouteResult[] {
  const rectOf = sceneRectOf(scene);
  let hit = ids;
  if (scene.groups.size) {
    // an arrow bound to a group follows when any member moves or resizes: widen the set with the moved elements' groups
    let ext: Set<string> | null = null;
    for (const id of ids) {
      const m = scene.els.get(id);
      if (m) for (const g of m.groupIds) (ext ??= new Set(ids)).add(g);
    }
    if (ext) hit = ext;
  }
  const todo: El[] = [];
  let branches = false;
  for (const e of scene.els.values()) {
    if (e.kind !== "arrow") continue;
    if (hit.has(e.src) || hit.has(e.dst)) todo.push(e);
    if (!branches && ((e.src && scene.els.get(e.src)?.kind === "arrow") || (e.dst && scene.els.get(e.dst)?.kind === "arrow"))) branches = true;
  }
  if (branches) {
    const inSet = new Set<string>(todo.map((e) => e.id));
    let frontier = new Set<string>([...inSet, ...ids]);
    for (let lvl = 0; lvl <= MAX_BRANCH_DEPTH && frontier.size; lvl++) {
      const next = new Set<string>();
      for (const e of scene.els.values()) {
        if (e.kind !== "arrow" || inSet.has(e.id) || !(frontier.has(e.src) || frontier.has(e.dst))) continue;
        inSet.add(e.id); next.add(e.id); todo.push(e);
      }
      frontier = next;
    }
    const depth = new Map<string, number>();
    for (const e of todo) depth.set(e.id, hostDepth(scene, e));
    todo.sort((p, q) => depth.get(p.id)! - depth.get(q.id)!);
  }
  const out: RerouteResult[] = [];
  if (!branches) { for (const e of todo) out.push({ id: e.id, pts: computeArrowPts(e, rectOf) }); return out; }
  const fresh = new Map<string, number[]>();
  const live: RectOf = (id) => rectOf(id);
  live.host = (id, t, o) => {
    const h = scene.els.get(id);
    if (!h || h.kind !== "arrow") return false;
    pointAtT(fresh.get(id) ?? h.pts, isCurve(h), t, o);
    return true;
  };
  for (const e of todo) { const pts = computeArrowPts(e, live); fresh.set(e.id, pts); out.push({ id: e.id, pts }); }
  return out;
}

/**
 * The polyline an elbow arrow is actually DRAWN along when its corners are round (edge 1): the same circular arcs the
 * renderer's arcTo makes (radius min(16, half of each adjoining segment)), sampled. The flow dots walk this, so they follow
 * the visible line around corners instead of cutting to the sharp corner point.
 */
export function roundedPolyline(p: readonly number[], maxR = 16, steps = 6): number[] {
  const n = p.length;
  if (n < 6) return Array.from(p);
  const out: number[] = [p[0]!, p[1]!];
  for (let i = 2; i + 3 < n; i += 2) {
    const px = p[i - 2]!, py = p[i - 1]!, cx = p[i]!, cy = p[i + 1]!, nx = p[i + 2]!, ny = p[i + 3]!;
    const l1 = Math.hypot(px - cx, py - cy), l2 = Math.hypot(nx - cx, ny - cy);
    if (!(l1 > 0 && l2 > 0)) { out.push(cx, cy); continue; }
    const r = Math.min(maxR, l1 / 2, l2 / 2);
    const ux = (px - cx) / l1, uy = (py - cy) / l1, vx = (nx - cx) / l2, vy = (ny - cy) / l2;
    const phi = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (phi < 1e-3 || Math.PI - phi < 1e-3) { out.push(cx, cy); continue; } // folded back or straight through: no arc
    const d = r / Math.tan(phi / 2);
    const t1x = cx + ux * d, t1y = cy + uy * d, t2x = cx + vx * d, t2y = cy + vy * d;
    let bx = ux + vx, by = uy + vy; const bl = Math.hypot(bx, by); bx /= bl; by /= bl;
    const h = r / Math.sin(phi / 2), ox = cx + bx * h, oy = cy + by * h;
    const a1 = Math.atan2(t1y - oy, t1x - ox), a2 = Math.atan2(t2y - oy, t2x - ox);
    let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    out.push(t1x, t1y);
    for (let k = 1; k < steps; k++) { const a = a1 + (da * k) / steps; out.push(ox + Math.cos(a) * r, oy + Math.sin(a) * r); }
    out.push(t2x, t2y);
  }
  out.push(p[n - 2]!, p[n - 1]!);
  return out;
}
