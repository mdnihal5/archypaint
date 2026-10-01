import type { El, EdgeStyle, Port, Route, Scene } from "./scene";
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

export type RectOf = (id: string) => Rect | null;

/** anchors of an arrow; `rectOf` lets a drag preview substitute moved rectangles */
export function anchorsOf(e: El, rectOf: RectOf): [Anchor, Anchor] {
  const n = e.pts.length;
  const s: [number, number] = [e.pts[0] ?? e.x, e.pts[1] ?? e.y], t: [number, number] = [e.pts[n - 2] ?? e.x + e.w, e.pts[n - 1] ?? e.y + e.h];
  const sr = e.src ? rectOf(e.src) : null, dr = e.dst ? rectOf(e.dst) : null;
  return [
    { rect: sr, pt: s, port: sr ? e.sp : -1 },
    { rect: dr, pt: t, port: dr ? e.dp : -1 },
  ];
}

export function computeArrowPts(e: El, rectOf: RectOf): number[] {
  const [a, b] = anchorsOf(e, rectOf);
  return routeArrow(a, b, effectiveRoute(e.route, e.edge));
}

export function sceneRectOf(scene: Scene): RectOf {
  return (id) => { const t = scene.els.get(id); return t && t.kind !== "arrow" ? t : null; };
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
 * ONE batched pass: recompute every arrow whose src/dst is in `ids`. Arrows never bind to arrows,
 * so a single pass reaches the fixed point — there is no propagation and nothing to cap beyond the
 * arrow count itself (loop is a plain for-of over the arrows list).
 */
export function rerouteBound(scene: Scene, ids: ReadonlySet<string>): RerouteResult[] {
  const out: RerouteResult[] = [];
  const rectOf = sceneRectOf(scene);
  for (const e of scene.els.values()) {
    if (e.kind !== "arrow") continue;
    if (!(ids.has(e.src) || ids.has(e.dst))) continue;
    out.push({ id: e.id, pts: computeArrowPts(e, rectOf) });
  }
  return out;
}
