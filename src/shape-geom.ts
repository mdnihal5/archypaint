/**
 * Pure geometry for the drawable shapes beyond rect/ellipse/diamond: SVG path data (used by the canvas via
 * Path2D AND by SVG export, so both look identical), point-in-shape tests, and connector ports that sit on the
 * real outline. No DOM, no scene import — everything takes plain numbers, so it is trivially unit-testable.
 */

export interface GeomEl { kind: string; x: number; y: number; w: number; h: number; edge: number; radius: number; o: number; n: number; text: string }
export interface Rect { x: number; y: number; w: number; h: number; kind?: string }

export const PATH_KINDS: ReadonlySet<string> = new Set(["cylinder", "cloud", "hexagon", "parallelogram", "triangle", "star", "note", "brace", "badge", "frame", "lane"]);
/** kinds that hold other shapes: they sit behind their contents and only their header / border is clickable */
export const CONTAINER_KINDS: ReadonlySet<string> = new Set(["frame", "lane"]);
export const NEW_KINDS: ReadonlySet<string> = new Set([...PATH_KINDS, "legend"]);

export const FRAME_HEADER = 28;
export const LANE_HEADER = 32;
export const LANE_COL_HEADER = 28;

const r2 = (v: number): string => String(Math.round(v * 100) / 100 + 0);
const P = (x: number, y: number): string => `${r2(x)} ${r2(y)}`;

type Pt = readonly [number, number];

/* ------------------------------------------------------------------ polygons (unit box) */

const HEX: readonly Pt[] = [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]];
const TRI: readonly Pt[] = [[0.5, 0], [1, 1], [0, 1]];

function starUnit(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 === 0 ? 1 : 0.4;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return pts.map(([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)] as Pt);
}
const STAR = starUnit();

/* cloud: cubic bumps in a rough unit box, then normalised so the outline exactly fills [0,1]^2 */
type Cub = readonly [number, number, number, number, number, number, number, number];
const CLOUD_RAW: readonly Cub[] = [
  [0.20, 0.86, 0.02, 0.86, 0.00, 0.54, 0.17, 0.50],
  [0.17, 0.50, 0.08, 0.26, 0.34, 0.10, 0.47, 0.27],
  [0.47, 0.27, 0.54, 0.02, 0.88, 0.04, 0.88, 0.34],
  [0.88, 0.34, 1.02, 0.36, 1.02, 0.86, 0.80, 0.86],
];

function bez(c: Cub, t: number): Pt {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
}

function cloudUnit(): { segs: Cub[]; poly: Pt[] } {
  const raw: Pt[] = [];
  for (const c of CLOUD_RAW) for (let i = 0; i < 12; i++) raw.push(bez(c, i / 12));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of raw) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const nx = (x: number) => (x - x0) / (x1 - x0), ny = (y: number) => (y - y0) / (y1 - y0);
  const segs = CLOUD_RAW.map((c) => [nx(c[0]), ny(c[1]), nx(c[2]), ny(c[3]), nx(c[4]), ny(c[5]), nx(c[6]), ny(c[7])] as unknown as Cub);
  return { segs, poly: raw.map(([x, y]) => [nx(x), ny(y)] as Pt) };
}
const CLOUD = cloudUnit();

/** parallelogram slant */
export const paraSkew = (w: number): number => w * 0.2;

/** polygon of a straight-edged shape in world space, or null for kinds that are not polygons */
export function polygonOf(kind: string, x: number, y: number, w: number, h: number): number[] | null {
  let unit: readonly Pt[] | null = null;
  if (kind === "hexagon") unit = HEX;
  else if (kind === "triangle") unit = TRI;
  else if (kind === "star") unit = STAR;
  else if (kind === "cloud") unit = CLOUD.poly;
  else if (kind === "parallelogram") {
    const s = paraSkew(w);
    return [x + s, y, x + w, y, x + w - s, y + h, x, y + h];
  }
  if (!unit) return null;
  const out: number[] = [];
  for (const [ux, uy] of unit) out.push(x + ux * w, y + uy * h);
  return out;
}

export function pointInPoly(poly: readonly number[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i]!, yi = poly[i + 1]!, xj = poly[j]!, yj = poly[j + 1]!;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** first intersection of a ray from (ox,oy) along (dx,dy) with the polygon boundary, or null */
export function rayPoly(poly: readonly number[], ox: number, oy: number, dx: number, dy: number): Pt | null {
  let best = Infinity;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ax = poly[j]!, ay = poly[j + 1]!, bx = poly[i]!, by = poly[i + 1]!;
    const ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
    const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return best === Infinity ? null : [ox + dx * best, oy + dy * best];
}

const SIDE_DIR: readonly Pt[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Connector port on the REAL outline for polygon-like shapes (triangle, parallelogram, star, cloud, hexagon):
 * a ray from the centre towards `side`. Null for kinds whose outline touches the bounding-box side midpoints
 * (the caller then uses the plain box port).
 */
export function outlinePort(r: Rect, side: number): Pt | null {
  const k = r.kind;
  if (k !== "triangle" && k !== "parallelogram" && k !== "star" && k !== "cloud") return null;
  const poly = polygonOf(k, r.x, r.y, r.w, r.h);
  if (!poly) return null;
  const d = SIDE_DIR[side] ?? SIDE_DIR[3]!;
  return rayPoly(poly, r.x + r.w / 2, r.y + r.h / 2, d[0], d[1]);
}

/* ------------------------------------------------------------------ path data */

/** rounded-rect path with a single radius (0 = sharp) */
export function rrectPath(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r === 0) return `M${P(x, y)}H${r2(x + w)}V${r2(y + h)}H${r2(x)}Z`;
  return `M${P(x + r, y)}H${r2(x + w - r)}A${r2(r)} ${r2(r)} 0 0 1 ${P(x + w, y + r)}V${r2(y + h - r)}A${r2(r)} ${r2(r)} 0 0 1 ${P(x + w - r, y + h)}H${r2(x + r)}A${r2(r)} ${r2(r)} 0 0 1 ${P(x, y + h - r)}V${r2(y + r)}A${r2(r)} ${r2(r)} 0 0 1 ${P(x + r, y)}Z`;
}

const polyD = (poly: readonly number[]): string => {
  let d = "";
  for (let i = 0; i < poly.length; i += 2) d += `${i ? "L" : "M"}${P(poly[i]!, poly[i + 1]!)}`;
  return d + "Z";
};

/** lid height of a cylinder */
export const cylLid = (h: number, w: number): number => Math.max(4, Math.min(22, h * 0.14, w * 0.25));
export const noteFold = (w: number, h: number): number => Math.max(8, Math.min(24, w * 0.2, h * 0.3));

export function braceVertical(o: number): boolean { return o === 0 || o === 1; }

/** curly brace along the long axis; tip at v=0, back at v=D (local u runs along the length L) */
function bracePath(e: GeomEl): string {
  const vertical = braceVertical(e.o);
  const L = vertical ? e.h : e.w, D = vertical ? e.w : e.h;
  const r = Math.max(1, Math.min(D / 2, L / 4)), m = D / 2, c = L / 2;
  const map = (u: number, v: number): string => {
    if (e.o === 0) return P(e.x + v, e.y + u);
    if (e.o === 1) return P(e.x + D - v, e.y + u);
    if (e.o === 2) return P(e.x + u, e.y + v);
    return P(e.x + u, e.y + D - v);
  };
  return `M${map(0, D)}Q${map(0, m)} ${map(r, m)}L${map(c - r, m)}Q${map(c, m)} ${map(c, 0)}Q${map(c, m)} ${map(c + r, m)}L${map(L - r, m)}Q${map(L, m)} ${map(L, D)}`;
}

export function laneNames(e: { text: string; n: number }): string[] {
  const lines = e.text === "" ? [] : e.text.split("\n");
  const count = Math.max(1, Math.min(24, lines.length || e.n || 3));
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(lines[i] ?? `lane ${i + 1}`);
  return out;
}

export interface LaneCell { text: string; cx: number; cy: number; rot: boolean; w: number }
/** header cells of a swimlane: where each lane's name goes (rotated -90 deg for row lanes) */
export function laneCells(e: GeomEl): LaneCell[] {
  const names = laneNames(e), k = names.length, out: LaneCell[] = [];
  for (let i = 0; i < k; i++) {
    if (e.o === 1) { const cw = e.w / k; out.push({ text: names[i]!, cx: e.x + cw * (i + 0.5), cy: e.y + LANE_COL_HEADER / 2, rot: false, w: cw - 8 }); }
    else { const rh = e.h / k; out.push({ text: names[i]!, cx: e.x + LANE_HEADER / 2, cy: e.y + rh * (i + 0.5), rot: true, w: rh - 8 }); }
  }
  return out;
}

function lanePaths(e: GeomEl): { body: string; detail: string } {
  const body = rrectPath(e.x, e.y, e.w, e.h, e.edge === 0 ? 0 : Math.min(e.radius, 10));
  const k = laneNames(e).length;
  let d = "";
  if (e.o === 1) {
    d += `M${P(e.x, e.y + LANE_COL_HEADER)}H${r2(e.x + e.w)}`;
    for (let i = 1; i < k; i++) d += `M${P(e.x + (e.w / k) * i, e.y)}V${r2(e.y + e.h)}`;
  } else {
    d += `M${P(e.x + LANE_HEADER, e.y)}V${r2(e.y + e.h)}`;
    for (let i = 1; i < k; i++) d += `M${P(e.x, e.y + (e.h / k) * i)}H${r2(e.x + e.w)}`;
  }
  return { body, detail: d };
}

export interface Parts { body: string; detail: string; /** stroke only, never filled */ open: boolean }

/** outline (`body`) and stroke-only extras (`detail`) of a path-drawn shape */
export function shapeParts(e: GeomEl): Parts | null {
  const { x, y, w, h } = e;
  switch (e.kind) {
    case "cylinder": {
      const ry = cylLid(h, w), rx = w / 2;
      return {
        body: `M${P(x, y + ry)}A${r2(rx)} ${r2(ry)} 0 0 1 ${P(x + w, y + ry)}V${r2(y + h - ry)}A${r2(rx)} ${r2(ry)} 0 0 1 ${P(x, y + h - ry)}Z`,
        detail: `M${P(x, y + ry)}A${r2(rx)} ${r2(ry)} 0 0 0 ${P(x + w, y + ry)}`, open: false,
      };
    }
    case "cloud": {
      const s = CLOUD.segs;
      let d = `M${P(x + s[0]![0] * w, y + s[0]![1] * h)}`;
      for (const c of s) d += `C${P(x + c[2] * w, y + c[3] * h)} ${P(x + c[4] * w, y + c[5] * h)} ${P(x + c[6] * w, y + c[7] * h)}`;
      return { body: d + "Z", detail: "", open: false };
    }
    case "hexagon": case "triangle": case "star": case "parallelogram":
      return { body: polyD(polygonOf(e.kind, x, y, w, h)!), detail: "", open: false };
    case "note": {
      const f = noteFold(w, h);
      return { body: `M${P(x, y)}H${r2(x + w)}V${r2(y + h - f)}L${P(x + w - f, y + h)}H${r2(x)}Z`, detail: `M${P(x + w - f, y + h)}V${r2(y + h - f)}H${r2(x + w)}`, open: false };
    }
    case "brace": return { body: bracePath(e), detail: "", open: true };
    case "badge": {
      const d = Math.min(w, h) / 2, cx = x + w / 2, cy = y + h / 2;
      return { body: `M${P(cx - d, cy)}A${r2(d)} ${r2(d)} 0 1 0 ${P(cx + d, cy)}A${r2(d)} ${r2(d)} 0 1 0 ${P(cx - d, cy)}Z`, detail: "", open: false };
    }
    case "frame": return { body: rrectPath(x, y, w, h, e.edge === 0 ? 0 : Math.min(e.radius + 4, 20)), detail: "", open: false };
    case "lane": { const p = lanePaths(e); return { ...p, open: false }; }
    default: return null;
  }
}

/** where a shape's centred label sits (some shapes have a lid / apex that shifts the visual centre) */
export function labelPoint(e: GeomEl): Pt {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  if (e.kind === "cylinder") return [cx, cy + cylLid(e.h, e.w) / 2];
  if (e.kind === "triangle") return [cx, cy + e.h * 0.16];
  if (e.kind === "star") return [cx, cy + e.h * 0.06];
  if (e.kind === "note") return [cx, cy - noteFold(e.w, e.h) / 4];
  return [cx, cy];
}

/* ------------------------------------------------------------------ hit testing */

function nearBorder(e: GeomEl, px: number, py: number, band: number): boolean {
  const inX = px >= e.x && px <= e.x + e.w, inY = py >= e.y && py <= e.y + e.h;
  if (!inX || !inY) return false;
  return px - e.x <= band || e.x + e.w - px <= band || py - e.y <= band || e.y + e.h - py <= band;
}

/** does the point hit this shape? Containers only answer on their header / border, so they never steal clicks meant for contents. */
export function hitShape(e: GeomEl, px: number, py: number, slop: number): boolean {
  if (px < e.x - slop || px > e.x + e.w + slop || py < e.y - slop || py > e.y + e.h + slop) return false;
  switch (e.kind) {
    case "frame": return py - e.y <= FRAME_HEADER || nearBorder(e, px, py, Math.max(6, slop));
    case "lane": {
      const hdr = e.o === 1 ? py - e.y <= LANE_COL_HEADER : px - e.x <= LANE_HEADER;
      return hdr || nearBorder(e, px, py, Math.max(6, slop));
    }
    case "badge": {
      const d = Math.min(e.w, e.h) / 2, dx = px - (e.x + e.w / 2), dy = py - (e.y + e.h / 2);
      return dx * dx + dy * dy <= (d + slop) * (d + slop);
    }
    case "cylinder": case "note": case "brace": case "legend": return true;
    default: {
      const poly = polygonOf(e.kind, e.x, e.y, e.w, e.h);
      if (poly) return pointInPoly(poly, px, py) || slop > 0 && polyNear(poly, px, py, slop);
      return true;
    }
  }
}

function polyNear(poly: readonly number[], px: number, py: number, d: number): boolean {
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ax = poly[j]!, ay = poly[j + 1]!, bx = poly[i]!, by = poly[i + 1]!;
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2));
    if (Math.hypot(px - (ax + t * ex), py - (ay + t * ey)) <= d) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ legend text ("swatch|label" per line) */

export interface LegendRow { swatch: string; label: string }
export function legendRows(text: string): LegendRow[] {
  const out: LegendRow[] = [];
  for (const line of text.split("\n").slice(0, 40)) {
    const i = line.indexOf("|");
    if (i > 0) out.push({ swatch: line.slice(0, i), label: line.slice(i + 1) });
  }
  return out;
}
export const LEGEND_ROW_H = 22;
export const LEGEND_PAD = 12;
export const LEGEND_TITLE_H = 24;
export const legendHeight = (rows: number): number => LEGEND_PAD * 2 + LEGEND_TITLE_H + rows * LEGEND_ROW_H;
