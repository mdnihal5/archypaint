import { arrowDist } from "./connectors";
import { hitShape } from "./shape-geom";

export type Kind =
  | "rect" | "ellipse" | "diamond" | "text" | "arrow" | "icon"
  | "cylinder" | "cloud" | "hexagon" | "parallelogram" | "triangle" | "star"
  | "note" | "brace" | "badge" | "frame" | "lane" | "legend";
export type FillStyle = 0 | 1 | 2; // outline, tint, solid
export type EdgeStyle = 0 | 1 | 2; // sharp, round, soft
export type Route = 0 | 1 | 2; // straight, elbow, curve
export type Head = 0 | 1 | 2; // none, arrow, dot

/** side ports: 0 top, 1 right, 2 bottom, 3 left, -1 automatic */
export type Port = -1 | 0 | 1 | 2 | 3;

export interface El {
  id: string;
  kind: Kind;
  x: number; y: number; w: number; h: number;
  z: number;
  version: number;
  cat: number;
  fill: FillStyle;
  radius: number;
  text: string;
  /** sharp / round / soft: boxes use radius, arrows use corner style, icon tiles use tile radius */
  edge: EdgeStyle;
  /** group membership, deepest -> shallowest (Excalidraw-compatible); names live in Scene.groups */
  groupIds: string[];
  /** icon id from the icon library ("" when not an icon) */
  iconId: string;
  locked: boolean;
  /** badge: its number; lane: number of lanes (kept in step with the lines of `text`); otherwise unused */
  n: number;
  /** orientation: brace 0 "{" 1 "}" 2 tip-up 3 tip-down; lane 0 rows (header at left) 1 columns (header on top); otherwise unused */
  o: 0 | 1 | 2 | 3;
  /** arrows only: bound element ids ("" = free end), ports, routing, dash, head, and the routed polyline (flat x,y pairs, world space) */
  src: string; dst: string; sp: Port; dp: Port; route: Route; dash: 0 | 1; head: Head; pts: number[];
  /** spatial-index bookkeeping (cell range + query dedupe stamp) — never serialised */
  gx0: number; gy0: number; gx1: number; gy1: number; seen: number;
}

export type ElInit = Partial<Omit<El, "id" | "z" | "version" | "gx0" | "gy0" | "gx1" | "gy1" | "seen">> & { kind: Kind };

export interface GroupInfo { id: string; name: string; cat: number; collapsed: boolean; locked: boolean }

/** persisted element: everything except spatial-index bookkeeping */
export type ElJSON = Omit<El, "gx0" | "gy0" | "gx1" | "gy1" | "seen">;
export interface SceneJSON { els: ElJSON[]; groups: GroupInfo[] }

const CELL = 256;
const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);

/** Uniform grid over element bounds: O(cells touched) culling and hit-testing instead of O(n). */
class Grid {
  private cells = new Map<number, El[]>();
  private stamp = 0;

  insert(e: El): void {
    e.gx0 = Math.floor(e.x / CELL); e.gy0 = Math.floor(e.y / CELL);
    e.gx1 = Math.floor((e.x + e.w) / CELL); e.gy1 = Math.floor((e.y + e.h) / CELL);
    for (let cx = e.gx0; cx <= e.gx1; cx++)
      for (let cy = e.gy0; cy <= e.gy1; cy++) {
        const k = key(cx, cy);
        const c = this.cells.get(k);
        if (c) c.push(e); else this.cells.set(k, [e]);
      }
  }

  remove(e: El): void {
    for (let cx = e.gx0; cx <= e.gx1; cx++)
      for (let cy = e.gy0; cy <= e.gy1; cy++) {
        const k = key(cx, cy);
        const c = this.cells.get(k);
        if (!c) continue;
        const i = c.indexOf(e);
        if (i >= 0) { c[i] = c[c.length - 1]!; c.pop(); }
        if (c.length === 0) this.cells.delete(k);
      }
  }

  query(x0: number, y0: number, x1: number, y1: number, out: El[]): void {
    out.length = 0;
    const s = ++this.stamp;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const c = this.cells.get(key(cx, cy));
        if (!c) continue;
        for (let i = 0; i < c.length; i++) {
          const e = c[i]!;
          if (e.seen === s) continue;
          e.seen = s;
          if (e.x <= x1 && e.x + e.w >= x0 && e.y <= y1 && e.y + e.h >= y0) out.push(e);
        }
      }
  }
}

export class Scene {
  readonly els = new Map<string, El>();
  readonly groups = new Map<string, GroupInfo>();
  /** bumps on every structural or geometric change; renderer caches key off it */
  nonce = 0;
  private grid = new Grid();
  private zc = 0;
  private idc = 0;
  private scratch: El[] = [];

  add(init: ElInit): El {
    const e: El = {
      id: `e${(++this.idc).toString(36)}`, z: ++this.zc, version: 1,
      x: 0, y: 0, w: 96, h: 58, cat: 0, fill: 1, radius: 8, text: "", edge: 1, groupIds: [], iconId: "", locked: false, n: 0, o: 0,
      src: "", dst: "", sp: -1, dp: -1, route: 1, dash: 0, head: 1, pts: [],
      gx0: 0, gy0: 0, gx1: 0, gy1: 0, seen: 0, ...init,
    };
    this.els.set(e.id, e);
    this.grid.insert(e);
    this.nonce++;
    return e;
  }

  /** move/resize: reindex only when the element is actually in the grid */
  set(e: El, x: number, y: number, w = e.w, h = e.h): void {
    this.grid.remove(e);
    e.x = x; e.y = y; e.w = w; e.h = h;
    e.version++;
    this.grid.insert(e);
    this.nonce++;
  }

  /** change non-geometric properties (style, text, ids); cheap — does not touch the spatial index */
  patch(e: El, p: Partial<Omit<El, "id" | "x" | "y" | "w" | "h" | "gx0" | "gy0" | "gx1" | "gy1" | "seen">>): void {
    Object.assign(e, p);
    e.version++;
    this.nonce++;
  }

  clear(): void {
    this.els.clear(); this.groups.clear(); this.grid = new Grid(); this.zc = 0; this.idc = 0; this.nonce++;
  }

  /** replace the whole scene (load / undo of bulk operations). Restores ids and z exactly. */
  replaceAll(data: SceneJSON): void {
    this.clear();
    let maxZ = 0;
    for (const j of data.els) {
      const e = { ...j, gx0: 0, gy0: 0, gx1: 0, gy1: 0, seen: 0 } as El;
      this.els.set(e.id, e); this.grid.insert(e);
      if (e.z > maxZ) maxZ = e.z;
      const n = parseInt(e.id.slice(1), 36); if (Number.isFinite(n) && n > this.idc) this.idc = n;
    }
    this.zc = maxZ;
    for (const g of data.groups) this.groups.set(g.id, { ...g });
    this.nonce++;
  }

  toJSON(): SceneJSON {
    const els: ElJSON[] = [];
    for (const e of this.els.values()) {
      const { gx0: _a, gy0: _b, gx1: _c, gy1: _d, seen: _s, ...rest } = e;
      void _a; void _b; void _c; void _d; void _s;
      els.push({ ...rest, groupIds: [...rest.groupIds], pts: [...rest.pts] });
    }
    els.sort((a, b) => a.z - b.z);
    return { els, groups: [...this.groups.values()].map((g) => ({ ...g })) };
  }

  /** union bounds of the given elements (or all); null when empty */
  bounds(ids?: Iterable<string>): { x: number; y: number; w: number; h: number } | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const it = ids ? [...ids].map((i) => this.els.get(i)).filter((e): e is El => !!e) : this.els.values();
    for (const e of it) { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** copy of an element without spatial-index fields (arrays copied) */
  snapshot(e: El): ElJSON {
    const { gx0: _a, gy0: _b, gx1: _c, gy1: _d, seen: _s, ...rest } = e;
    void _a; void _b; void _c; void _d; void _s;
    return { ...rest, groupIds: [...rest.groupIds], pts: [...rest.pts] };
  }

  /** overwrite an existing element with a snapshot and reindex (history undo/redo) */
  restoreEl(e: El, j: ElJSON): void {
    this.grid.remove(e);
    Object.assign(e, j, { groupIds: [...j.groupIds], pts: [...j.pts] });
    this.grid.insert(e);
    e.version++;
    this.nonce++;
  }

  /** add an element from a snapshot, keeping its id and z */
  insertJSON(j: ElJSON): El {
    const e = { ...j, groupIds: [...j.groupIds], pts: [...j.pts], gx0: 0, gy0: 0, gx1: 0, gy1: 0, seen: 0 } as El;
    this.els.set(e.id, e); this.grid.insert(e);
    if (e.z > this.zc) this.zc = e.z;
    const n = parseInt(e.id.slice(1), 36); if (Number.isFinite(n) && n > this.idc) this.idc = n;
    this.nonce++;
    return e;
  }

  /** fresh unused id (for paste/duplicate) */
  newId(): string { return `e${(++this.idc).toString(36)}`; }

  /** next z above everything (used when duplicating / bringing to front) */
  nextZ(): number { return ++this.zc; }

  remove(e: El): void {
    this.grid.remove(e);
    this.els.delete(e.id);
    this.nonce++;
  }

  query(x0: number, y0: number, x1: number, y1: number, out: El[]): void {
    this.grid.query(x0, y0, x1, y1, out);
  }

  /** topmost element under a world point (ellipse/diamond tested exactly) */
  hit(px: number, py: number, slop = 0): El | null {
    this.grid.query(px - slop, py - slop, px + slop, py + slop, this.scratch);
    let best: El | null = null;
    for (const e of this.scratch) {
      if (best && e.z < best.z) continue;
      if (contains(e, px, py, slop)) best = e;
    }
    return best;
  }
}

function contains(e: El, px: number, py: number, slop: number): boolean {
  if (e.kind === "arrow") return arrowDist(e, px, py) <= Math.max(slop, 4);
  if (px < e.x || px > e.x + e.w || py < e.y || py > e.y + e.h) return false;
  if (e.kind !== "rect" && e.kind !== "text" && e.kind !== "icon" && e.kind !== "ellipse" && e.kind !== "diamond") return hitShape(e, px, py, slop);
  if (e.kind === "ellipse") {
    const rx = e.w / 2, ry = e.h / 2;
    const dx = (px - (e.x + rx)) / rx, dy = (py - (e.y + ry)) / ry;
    return dx * dx + dy * dy <= 1;
  }
  if (e.kind === "diamond") {
    const dx = Math.abs(px - (e.x + e.w / 2)) / (e.w / 2), dy = Math.abs(py - (e.y + e.h / 2)) / (e.h / 2);
    return dx + dy <= 1;
  }
  return true;
}

/** the 8 resize handle positions of a box: nw, n, ne, e, se, s, sw, w */
export function handlePoints(b: { x: number; y: number; w: number; h: number }): [number, number][] {
  const { x, y, w, h } = b, mx = x + w / 2, my = y + h / 2;
  return [[x, y], [mx, y], [x + w, y], [x + w, my], [x + w, y + h], [mx, y + h], [x, y + h], [x, my]];
}
