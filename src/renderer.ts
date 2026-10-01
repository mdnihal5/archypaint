import { PORT_COUNT, bezierAt, effectiveRoute, portPoint, type Rect } from "./connectors";
import type { GroupIndex } from "./groups";
import { drawCalcEl } from "./calc-view";
import { drawIconEl } from "./icons";
import { handlePoints, type El, type Kind, type Scene } from "./scene";
import { CONTAINER_KINDS, FRAME_HEADER, LANE_COL_HEADER, LANE_HEADER, LEGEND_PAD, LEGEND_ROW_H, LEGEND_TITLE_H, PATH_KINDS, labelPoint, laneCells, legendRows, shapeParts } from "./shape-geom";
import type { Theme } from "./theme";
import type { Viewport } from "./viewport";

const FONT = "13px 'JetBrains Mono','DejaVu Sans Mono',monospace";
const LINE_H = 18;

export interface GhostShape { kind: Kind; x: number; y: number; w: number; h: number; radius?: number; o?: 0 | 1 | 2 | 3 }
export interface ArrowStyle { cat: number; route: 0 | 1 | 2; edge: 0 | 1 | 2; dash: 0 | 1; head: 0 | 1 | 2; text: string }
export interface GhostArrow extends ArrowStyle { pts: number[] }

/**
 * Two stacked canvases: `static` holds every committed shape, group outline and the grid (redrawn
 * only when the scene or viewport changes); `live` holds selection, handles, guides and whatever is
 * being dragged (redrawn on every pointer move, but tiny). Nothing draws outside the frame loop, and
 * the loop is only ever scheduled by invalidate()/wake() — there is no self-rescheduling path.
 */
export class Renderer {
  readonly dragging = new Set<string>();
  readonly selected = new Set<string>();
  /** routed preview points for arrows attached to dragged shapes (id -> pts); cleared on drop */
  readonly livePts = new Map<string, number[]>();
  dragDx = 0; dragDy = 0;
  ghost: GhostShape | null = null;
  ghostArrow: GhostArrow | null = null;
  marquee: Rect | null = null;
  guideX: number[] = [];
  guideY: number[] = [];
  /** shape whose ports are shown (arrow tool hover) and the highlighted port (-1 none) */
  hoverRect: Rect | null = null; hoverPort = -1;
  groups: GroupIndex | null = null;
  /** find-bar matches: outlined on the live layer, `hiCur` drawn strongest */
  hi: readonly string[] = [];
  hiCur = "";
  /** present mode: ids not drawn (null = draw everything; the hot loops pay one null check) */
  hidden: ReadonlySet<string> | null = null;
  /** id of the element being text-edited: its label is not drawn under the textarea */
  hideText = "";
  /** runs at the start of each frame; input is coalesced and applied here */
  onBeforeFrame: (() => void) | null = null;

  /** perf counters */
  visibleCount = 0;
  lastFrameMs = 0;
  lastFrameAt = 0;
  degraded = false;
  private slow = 0;
  private ring = new Float32Array(240);
  private ri = 0;
  private samples: { js: number[]; dt: number[] } | null = null;
  private prevT = 0;

  private sctx: CanvasRenderingContext2D;
  private lctx: CanvasRenderingContext2D;
  private dpr = 1;
  private sDirty = true;
  private lDirty = true;
  private raf = 0;
  private inFrame = false;
  private destroyed = false;
  private visible: El[] = [];
  private draggedGroups = new Set<string>();
  private visNonce = -1;
  private visVp = -1;
  private cw = 0;
  private ch = 0;

  constructor(
    private scene: Scene, private vp: Viewport, private theme: Theme,
    private sc: HTMLCanvasElement, private lc: HTMLCanvasElement,
  ) {
    this.sctx = sc.getContext("2d", { alpha: true })!;
    this.lctx = lc.getContext("2d", { alpha: true })!;
    imageRepaint = () => this.invalidate(true, true);
  }

  resize(w: number, h: number, dpr: number): void {
    const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));
    if (cw === this.cw && ch === this.ch && dpr === this.dpr) return; // equality guard: no resize feedback loop
    this.dpr = dpr; this.cw = cw; this.ch = ch;
    this.sc.width = this.lc.width = cw;
    this.sc.height = this.lc.height = ch;
    this.vp.resize(w, h);
    this.invalidate(true, true);
  }

  invalidate(stat: boolean, live: boolean): void {
    if (stat) this.sDirty = true;
    if (live) this.lDirty = true;
    this.wake();
  }

  wake(): void {
    if (this.raf || this.inFrame || this.destroyed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** cancel any pending frame and stop scheduling — part of editor teardown */
  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0; this.onBeforeFrame = null; imageRepaint = null; imageDispose?.();
    this.visible.length = 0; this.dragging.clear(); this.selected.clear(); this.livePts.clear(); this.hi = [];
  }

  perfStart(): void { this.samples = { js: [], dt: [] }; this.prevT = 0; }
  perfStop() {
    const s = this.samples; this.samples = null;
    if (!s || !s.js.length) return null;
    const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]!;
    return { frames: s.js.length, jsP50: q(s.js, 0.5), jsP95: q(s.js, 0.95), jsMax: q(s.js, 1), dtP50: q(s.dt, 0.5), dtP95: q(s.dt, 0.95) };
  }
  /** p95 frame cost (ms) over the last ~240 frames */
  p95(): number {
    const a = Array.from(this.ring).filter((v) => v > 0).sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length * 0.95)]! : 0;
  }

  /** union bounds of the selection at rest (no drag offset) */
  selectionBox(): Rect | null { return this.selected.size ? this.scene.bounds(this.selected) : null; }

  private frame(t: number): void {
    this.raf = 0;
    if (this.destroyed) return;
    this.inFrame = true;
    const t0 = performance.now();
    this.onBeforeFrame?.();
    if (this.sDirty) { this.drawStatic(); this.sDirty = false; }
    if (this.lDirty) { this.drawLive(); this.lDirty = false; }
    this.inFrame = false;
    const ms = performance.now() - t0;
    this.lastFrameMs = ms; this.lastFrameAt = t;
    this.ring[this.ri++ % this.ring.length] = ms;
    // watchdog: three consecutive slow frames -> drop optional detail instead of freezing
    this.slow = ms > 100 ? this.slow + 1 : 0;
    if (this.slow >= 3 && !this.degraded) { this.degraded = true; this.invalidate(true, false); }
    if (this.samples) { this.samples.js.push(ms); if (this.prevT) this.samples.dt.push(t - this.prevT); this.prevT = t; }
  }

  private rebuildVisible(): void {
    if (this.visNonce === this.scene.nonce && this.visVp === this.vp.version) return;
    const vp = this.vp;
    this.scene.query(vp.x, vp.y, vp.x + vp.w / vp.zoom, vp.y + vp.h / vp.zoom, this.visible);
    this.visible.sort((a, b) => a.z - b.z);
    this.visNonce = this.scene.nonce; this.visVp = this.vp.version;
  }

  private drawStatic(): void {
    const ctx = this.sctx, vp = this.vp, z = vp.zoom, s = this.dpr * z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    ctx.setTransform(s, 0, 0, s, -vp.x * s, -vp.y * s);
    this.rebuildVisible();
    this.visibleCount = this.visible.length;
    this.drawContent(ctx, this.visible);
  }

  /** grid, group outlines and `els` (z-sorted) with the world transform already set */
  private drawContent(ctx: CanvasRenderingContext2D, els: readonly El[]): void {
    const z = this.vp.zoom;
    this.drawGrid(ctx);
    ctx.font = FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lod = z < (this.degraded ? 0.4 : 0.15);
    if (this.groups && this.scene.groups.size && !lod) this.drawGroups(ctx, false);
    const hid = this.hidden;
    for (let i = 0; i < els.length; i++) {
      const e = els[i]!;
      if (this.dragging.has(e.id) || (hid !== null && hid.has(e.id))) continue;
      drawEl(ctx, e, this.theme, z, lod, this.hideText === e.id);
    }
    ctx.globalAlpha = 1;
  }

  /** dashed, named boundary around each group; `onlyDragged` draws the live (offset) ones */
  private drawGroups(ctx: CanvasRenderingContext2D, onlyDragged: boolean): void {
    const th = this.theme, z = this.vp.zoom, vp = this.vp;
    const vx1 = vp.x + vp.w / z, vy1 = vp.y + vp.h / z;
    // groups touched by the drag, found from the dragged elements (O(dragged x depth)) rather than by scanning every member of every group
    const draggedGroups = this.draggedGroups;
    draggedGroups.clear();
    for (const id of this.dragging) { const e = this.scene.els.get(id); if (e) for (const g of e.groupIds) draggedGroups.add(g); }
    for (const g of this.scene.groups.values()) {
      const b = this.groups!.bounds(g.id);
      if (!b) continue;
      // present mode: a group outline appears only once every member has been revealed (its bounds would leak hidden layout)
      if (this.hidden !== null) { let any = false; for (const id of this.groups!.membersOf(g.id)) if (this.hidden.has(id)) { any = true; break; } if (any) continue; }
      const moved = draggedGroups.has(g.id);
      if (moved !== onlyDragged) continue;
      const x = b.x + (moved ? this.dragDx : 0), y = b.y + (moved ? this.dragDy : 0);
      if (x > vx1 || y > vy1 || x + b.w < vp.x || y + b.h < vp.y) continue;
      const col = th.cats[g.cat % th.cats.length]!;
      ctx.globalAlpha = 0.05; ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x, y, b.w, b.h, 14); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.6, 1 / z);
      ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);
      if (g.name && z >= 0.3) {
        ctx.fillStyle = col; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.fillText(g.name, x + 12, y - 8);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
      }
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const vp = this.vp, z = vp.zoom;
    if (z < 0.12) return;
    const x0 = vp.x, y0 = vp.y, x1 = vp.x + vp.w / z, y1 = vp.y + vp.h / z;
    const line = (step: number, color: string) => {
      ctx.beginPath();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.strokeStyle = color; ctx.lineWidth = 1 / z; ctx.stroke();
    };
    if (z >= 0.5) line(20, this.theme.grid);
    line(100, this.theme.gridMajor);
  }

  private drawLive(): void {
    const ctx = this.lctx, vp = this.vp, z = vp.zoom, s = this.dpr * z, th = this.theme;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    ctx.setTransform(s, 0, 0, s, -vp.x * s, -vp.y * s);
    ctx.font = FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (this.dragging.size) {
      if (this.groups && this.scene.groups.size) this.drawGroups(ctx, true);
      for (const id of this.dragging) {
        const e = this.scene.els.get(id);
        if (!e) continue;
        const lp = e.kind === "arrow" ? this.livePts.get(id) : undefined;
        if (lp) { drawArrow(ctx, e, th, z, lp, false); continue; }
        ctx.translate(this.dragDx, this.dragDy);
        drawEl(ctx, e, th, z, false, false);
        ctx.translate(-this.dragDx, -this.dragDy);
      }
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = th.red; ctx.fillStyle = th.paper; ctx.lineWidth = 1.4 / z;
    this.drawSelection(ctx, z);
    const g = this.ghost;
    if (g) {
      ctx.setLineDash([6 / z, 5 / z]); ctx.strokeStyle = th.red; ctx.lineWidth = 1.6 / z;
      strokeGhost(ctx, g); ctx.setLineDash([]);
    }
    if (this.hi.length) {
      const n = Math.min(this.hi.length, 400);
      for (let i = 0; i < n; i++) {
        const id = this.hi[i]!, e = this.scene.els.get(id);
        if (!e) continue;
        const cur = id === this.hiCur, pad = 4 / z;
        ctx.globalAlpha = cur ? 1 : 0.85; ctx.strokeStyle = cur ? th.red : th.cats[1]!; ctx.lineWidth = (cur ? 3 : 2) / z;
        ctx.setLineDash(cur ? [] : [6 / z, 4 / z]);
        ctx.strokeRect(e.x - pad, e.y - pad, e.w + 2 * pad, e.h + 2 * pad);
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (this.ghostArrow) drawArrow(ctx, this.ghostArrow as unknown as El, th, z, this.ghostArrow.pts, false);
    const m = this.marquee;
    if (m) {
      ctx.globalAlpha = 0.07; ctx.fillStyle = th.red; ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.globalAlpha = 1; ctx.setLineDash([5 / z, 4 / z]); ctx.strokeStyle = th.red; ctx.lineWidth = 1.2 / z; ctx.strokeRect(m.x, m.y, m.w, m.h); ctx.setLineDash([]);
    }
    if (this.guideX.length || this.guideY.length) {
      ctx.strokeStyle = th.red; ctx.lineWidth = 1 / z; ctx.globalAlpha = 0.75; ctx.beginPath();
      const y0 = vp.y, y1 = vp.y + vp.h / z, x0 = vp.x, x1 = vp.x + vp.w / z;
      for (const x of this.guideX) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (const y of this.guideY) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    const hr = this.hoverRect;
    if (hr) {
      ctx.lineWidth = 1.5 / z;
      for (let i = 0; i < PORT_COUNT; i++) {
        const pp = portPoint(hr, i);
        ctx.beginPath(); ctx.arc(pp[0], pp[1], (i === this.hoverPort ? 6 : 4.5) / z, 0, Math.PI * 2);
        ctx.fillStyle = i === this.hoverPort ? th.red : th.paper; ctx.strokeStyle = th.red; ctx.fill(); ctx.stroke();
      }
    }
  }

  private drawSelection(ctx: CanvasRenderingContext2D, z: number): void {
    if (!this.selected.size) return;
    const th = this.theme, hs = 8 / z;
    let single: El | null = null, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, nonArrow = 0;
    for (const id of this.selected) {
      const e = this.scene.els.get(id);
      if (!e) continue;
      if (this.selected.size === 1) single = e;
      const moved = this.dragging.has(id);
      const dx = moved ? this.dragDx : 0, dy = moved ? this.dragDy : 0;
      const lp = moved && e.kind === "arrow" ? this.livePts.get(id) : undefined;
      let ex = e.x + dx, ey = e.y + dy, ew = e.w, eh = e.h;
      if (lp) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i + 1 < lp.length; i += 2) { a = Math.min(a, lp[i]!); c = Math.max(c, lp[i]!); b = Math.min(b, lp[i + 1]!); d = Math.max(d, lp[i + 1]!); } ex = a; ey = b; ew = c - a; eh = d - b; }
      if (e.kind !== "arrow") nonArrow++;
      if (ex < x0) x0 = ex; if (ey < y0) y0 = ey; if (ex + ew > x1) x1 = ex + ew; if (ey + eh > y1) y1 = ey + eh;
      if (this.selected.size > 1 && e.kind !== "arrow") ctx.strokeRect(ex, ey, ew, eh);
    }
    if (x0 === Infinity) return;
    if (single && single.kind === "arrow") {
      const p = this.livePts.get(single.id) ?? single.pts, n = p.length;
      const off = this.dragging.has(single.id) && !this.livePts.has(single.id);
      const dx = off ? this.dragDx : 0, dy = off ? this.dragDy : 0;
      ctx.strokeStyle = th.red; ctx.lineWidth = 1.4 / z;
      for (const [px, py] of [[p[0]!, p[1]!], [p[n - 2]!, p[n - 1]!]] as const) {
        ctx.beginPath(); ctx.arc(px + dx, py + dy, 5 / z, 0, Math.PI * 2); ctx.fillStyle = th.paper; ctx.fill(); ctx.stroke();
      }
      return;
    }
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    ctx.strokeStyle = th.red; ctx.lineWidth = 1.4 / z; ctx.fillStyle = th.paper;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    if (nonArrow === 0) return;
    for (const [hx, hy] of handlePoints(box)) { ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs); ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs); }
  }
}

function tracePath(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (kind === "ellipse") ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (kind === "diamond") { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath(); }
  else if (r > 0) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

const P2D: typeof Path2D | null = typeof Path2D !== "undefined" ? Path2D : null;

/** outline of a shape being drawn (rubber band) for any drawable kind */
function strokeGhost(ctx: CanvasRenderingContext2D, g: GhostShape): void {
  if (PATH_KINDS.has(g.kind) && P2D) {
    const p = shapeParts({ kind: g.kind, x: g.x, y: g.y, w: g.w, h: g.h, edge: 1, radius: g.radius ?? 8, o: g.o ?? 0, n: 3, text: "" });
    if (p) { ctx.stroke(new P2D(p.body)); return; }
  }
  tracePath(ctx, PATH_KINDS.has(g.kind) || g.kind === "legend" ? "rect" : g.kind, g.x, g.y, g.w, g.h, g.radius ?? 8);
  ctx.stroke();
}

interface PathCache { x: number; y: number; w: number; h: number; edge: number; radius: number; o: number; tx: string; body: Path2D; detail: Path2D | null; open: boolean }
/** Path2D per element, rebuilt only when its geometry changed; keyed by element identity so removed elements are collectable */
const pathCache = new WeakMap<El, PathCache>();

function partsFor(e: El): PathCache | null {
  if (!P2D) return null;
  const tx = e.kind === "lane" ? e.text : "";
  let c = pathCache.get(e);
  if (c && c.x === e.x && c.y === e.y && c.w === e.w && c.h === e.h && c.edge === e.edge && c.radius === e.radius && c.o === e.o && c.tx === tx) return c;
  const p = shapeParts(e);
  if (!p) return null;
  c = { x: e.x, y: e.y, w: e.w, h: e.h, edge: e.edge, radius: e.radius, o: e.o, tx, body: new P2D(p.body), detail: p.detail ? new P2D(p.detail) : null, open: p.open };
  pathCache.set(e, c);
  return c;
}

const tmp: [number, number] = [0, 0];

/** connector: routed path, hollow port dot at the start, arrowhead/dot at the end, optional label */
export function drawArrow(ctx: CanvasRenderingContext2D, e: ArrowStyle, th: Theme, z: number, pts: readonly number[], lod: boolean): void {
  const n = pts.length;
  if (n < 4) return;
  const col = th.cats[e.cat % th.cats.length]!;
  ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 1 / z); ctx.lineJoin = e.edge === 0 ? "miter" : "round"; ctx.lineCap = "round";
  const curve = effectiveRoute(e.route, e.edge) === 2 && n === 8;
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  if (curve) ctx.bezierCurveTo(pts[2]!, pts[3]!, pts[4]!, pts[5]!, pts[6]!, pts[7]!);
  else if (e.edge === 1 && n > 4) {
    for (let i = 2; i + 3 < n; i += 2) {
      const px = pts[i - 2]!, py = pts[i - 1]!, cx = pts[i]!, cy = pts[i + 1]!, nx = pts[i + 2]!, ny = pts[i + 3]!;
      const r = Math.min(16, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
      ctx.arcTo(cx, cy, nx, ny, r);
    }
    ctx.lineTo(pts[n - 2]!, pts[n - 1]!);
  } else for (let i = 2; i < n; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  if (e.dash) ctx.setLineDash([8, 6]);
  ctx.stroke();
  if (e.dash) ctx.setLineDash([]);
  if (lod) return;
  ctx.fillStyle = th.paper;
  ctx.beginPath(); ctx.arc(pts[0]!, pts[1]!, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const ex = pts[n - 2]!, ey = pts[n - 1]!;
  let bx = pts[n - 4]!, by = pts[n - 3]!;
  if (curve) { bx = pts[4]!; by = pts[5]!; }
  const ang = Math.atan2(ey - by, ex - bx);
  if (e.head === 1) {
    ctx.beginPath();
    ctx.moveTo(ex - 11 * Math.cos(ang - 0.45), ey - 11 * Math.sin(ang - 0.45)); ctx.lineTo(ex, ey);
    ctx.lineTo(ex - 11 * Math.cos(ang + 0.45), ey - 11 * Math.sin(ang + 0.45)); ctx.stroke();
  } else if (e.head === 2) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, Math.PI * 2); ctx.fill(); }
  if (e.text && z >= 0.3) {
    let mx: number, my: number;
    if (curve) { bezierAt(pts, 0.5, tmp); mx = tmp[0]; my = tmp[1]; }
    else {
      let total = 0;
      for (let i = 0; i + 3 < n; i += 2) total += Math.hypot(pts[i + 2]! - pts[i]!, pts[i + 3]! - pts[i + 1]!);
      let acc = 0; mx = pts[0]!; my = pts[1]!;
      for (let i = 0; i + 3 < n; i += 2) {
        const l = Math.hypot(pts[i + 2]! - pts[i]!, pts[i + 3]! - pts[i + 1]!);
        if (acc + l >= total / 2) { const t = l ? (total / 2 - acc) / l : 0; mx = pts[i]! + (pts[i + 2]! - pts[i]!) * t; my = pts[i + 1]! + (pts[i + 3]! - pts[i + 1]!) * t; break; }
        acc += l;
      }
    }
    const w = ctx.measureText(e.text).width + 10;
    ctx.fillStyle = th.paper; ctx.fillRect(mx - w / 2, my - 10, w, 20);
    ctx.fillStyle = th.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(e.text, mx, my);
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number): void {
  if (text.indexOf("\n") < 0) { ctx.fillText(text, cx, cy); return; }
  const lines = text.split("\n");
  let y = cy - ((lines.length - 1) * LINE_H) / 2;
  for (const l of lines) { ctx.fillText(l, cx, y); y += LINE_H; }
}

function drawLegend(ctx: CanvasRenderingContext2D, e: El, th: Theme, z: number): void {
  ctx.globalAlpha = 1; ctx.fillStyle = th.card; ctx.beginPath(); ctx.roundRect(e.x, e.y, e.w, e.h, e.edge === 0 ? 0 : 8); ctx.fill();
  ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1.4, 1 / z); ctx.stroke(); ctx.globalAlpha = 1;
  if (z < 0.3) return;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = "700 11px 'JetBrains Mono','DejaVu Sans Mono',monospace"; ctx.fillStyle = th.mid;
  ctx.fillText("LEGEND", e.x + LEGEND_PAD, e.y + LEGEND_PAD + LEGEND_TITLE_H / 2 - 2);
  ctx.font = FONT;
  const rows = legendRows(e.text);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!, cy = e.y + LEGEND_PAD + LEGEND_TITLE_H + i * LEGEND_ROW_H + LEGEND_ROW_H / 2, x = e.x + LEGEND_PAD;
    if (r.swatch === "solid" || r.swatch === "dashed") {
      ctx.strokeStyle = th.mid; ctx.lineWidth = 2; ctx.lineCap = "round";
      if (r.swatch === "dashed") ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + 24, cy); ctx.stroke(); ctx.setLineDash([]);
    } else {
      const ci = Number(r.swatch.slice(1)), col = th.cats[(Number.isFinite(ci) ? ci : 0) % th.cats.length]!;
      ctx.globalAlpha = th.tint * 1.6; ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x + 4, cy - 7, 16, 14, 3); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.stroke();
    }
    ctx.fillStyle = th.ink; ctx.fillText(r.label, x + 34, cy);
  }
  ctx.textAlign = "center";
}

/** every kind drawn from shapeParts(): cylinder, cloud, hexagon, parallelogram, triangle, star, note, brace, badge, frame, lane */
function drawPathKind(ctx: CanvasRenderingContext2D, e: El, th: Theme, z: number, lod: boolean, hideText: boolean): void {
  const col = th.cats[e.cat % th.cats.length]!;
  const c = partsFor(e);
  if (!c) return;
  const lw = Math.max(2, 1 / z);
  ctx.lineJoin = e.edge === 0 ? "miter" : "round"; ctx.lineCap = "round";
  if (lod) {
    // containers must not paint over what they hold: outline only
    ctx.globalAlpha = CONTAINER_KINDS.has(e.kind) ? 0.5 : 0.55; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(c.body);
    if (!CONTAINER_KINDS.has(e.kind) && !c.open) { ctx.fillStyle = col; ctx.fill(c.body); }
    ctx.globalAlpha = 1; return;
  }
  if (c.open) { ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(c.body); return; }
  const container = CONTAINER_KINDS.has(e.kind);
  if (e.fill === 1) { ctx.globalAlpha = container ? th.tint * 0.55 : th.tint; ctx.fillStyle = col; ctx.fill(c.body); }
  else if (e.fill === 2) { ctx.globalAlpha = container ? 0.16 : 1; ctx.fillStyle = col; ctx.fill(c.body); }
  if (e.kind === "lane") {
    ctx.globalAlpha = th.tint * 1.4; ctx.fillStyle = col;
    if (e.o === 1) ctx.fillRect(e.x, e.y, e.w, LANE_COL_HEADER); else ctx.fillRect(e.x, e.y, LANE_HEADER, e.h);
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = lw;
  const dashed = e.kind === "frame" ? e.dash !== 0 : e.dash === 1;
  if (dashed) ctx.setLineDash([9, 7]);
  ctx.stroke(c.body);
  if (dashed) ctx.setLineDash([]);
  if (c.detail) {
    // on a solid fill the rim / fold would vanish in the same colour: draw it in paper instead
    if (e.fill === 2 && e.kind !== "lane") ctx.strokeStyle = th.paper;
    ctx.globalAlpha = e.kind === "lane" ? 0.8 : 0.75; ctx.lineWidth = e.kind === "lane" ? 1.4 : Math.max(1.5, 1 / z); ctx.stroke(c.detail); ctx.globalAlpha = 1;
  }
  if (z < 0.3 || hideText) return;
  ctx.globalAlpha = 1;
  if (e.kind === "frame") {
    if (e.text) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = col; ctx.fillText(e.text, e.x + 12, e.y + FRAME_HEADER / 2); ctx.textAlign = "center"; }
    return;
  }
  if (e.kind === "lane") {
    ctx.fillStyle = th.ink;
    for (const cell of laneCells(e)) {
      ctx.save(); ctx.translate(cell.cx, cell.cy); if (cell.rot) ctx.rotate(-Math.PI / 2);
      ctx.fillText(cell.text, 0, 0, Math.max(20, cell.w)); ctx.restore();
    }
    return;
  }
  if (e.kind === "badge") {
    const d = Math.min(e.w, e.h);
    ctx.font = `700 ${Math.max(10, Math.round(d * 0.46))}px 'JetBrains Mono','DejaVu Sans Mono',monospace`;
    ctx.fillStyle = e.fill === 2 ? th.paper : th.ink; ctx.fillText(String(e.n), e.x + e.w / 2, e.y + e.h / 2 + 1);
    ctx.font = FONT; return;
  }
  if (e.text) {
    const [lx, ly] = labelPoint(e);
    ctx.fillStyle = e.fill === 2 ? th.paper : th.ink;
    drawLabel(ctx, e.text, lx, ly);
  }
}

/* ---- image elements: the real drawer lives in the lazy ./images chunk; until it loads (or if it never does) a placeholder is drawn */
export type ImageDrawer = (ctx: CanvasRenderingContext2D, e: El, th: Theme, z: number, hideText: boolean) => void;
let imageDrawer: ImageDrawer | null = null;
let imageRepaint: (() => void) | null = null;
let imageChunkLoading = false, imageChunkTried = -1e9;
let imageDispose: (() => void) | null = null;
/** `dispose` frees what the drawer holds (decoded bitmaps); the renderer calls it on destroy */
export function setImageDrawer(f: ImageDrawer | null, dispose?: () => void): void { imageDrawer = f; imageDispose = dispose ?? null; }
/** called by the images chunk when a bitmap finished loading: one repaint, never a loop */
export function requestImageRepaint(): void { imageRepaint?.(); }
function ensureImageChunk(): void {
  if (imageDrawer || imageChunkLoading || performance.now() - imageChunkTried < 4000) return; // a failing chunk is retried at most every 4 s
  imageChunkLoading = true; imageChunkTried = performance.now();
  import("./images").then(() => imageRepaint?.()).catch(() => {}).finally(() => { imageChunkLoading = false; });
}

export function drawEl(ctx: CanvasRenderingContext2D, e: El, th: Theme, z: number, lod: boolean, hideText: boolean): void {
  if (e.kind === "calc") { drawCalcEl(ctx, e, th, z, lod, hideText); ctx.globalAlpha = 1; return; }
  if (e.kind === "arrow") { drawArrow(ctx, e, th, z, e.pts, lod); return; }
  if (PATH_KINDS.has(e.kind)) { drawPathKind(ctx, e, th, z, lod, hideText); ctx.globalAlpha = 1; return; }
  if (e.kind === "legend") { if (lod) { ctx.globalAlpha = 0.4; ctx.fillStyle = th.mid; ctx.fillRect(e.x, e.y, e.w, e.h); ctx.globalAlpha = 1; } else drawLegend(ctx, e, th, z); return; }
  const col = th.cats[e.cat % th.cats.length]!;
  if (lod) { ctx.globalAlpha = 0.55; ctx.fillStyle = col; ctx.fillRect(e.x, e.y, e.w, e.h); return; }
  if (e.kind === "icon") { drawIconEl(ctx, e, th, z, hideText); ctx.globalAlpha = 1; return; } // label included: it must not be drawn twice
  if (e.kind === "image") {
    if (imageDrawer) imageDrawer(ctx, e, th, z, hideText);
    else { ctx.globalAlpha = th.tint * 1.4; ctx.fillStyle = col; ctx.fillRect(e.x, e.y, e.w, e.h); ensureImageChunk(); }
    ctx.globalAlpha = 1; return;
  }
  else if (e.kind !== "text") {
    tracePath(ctx, e.kind, e.x, e.y, e.w, e.h, e.radius);
    if (e.fill === 1) { ctx.globalAlpha = th.tint; ctx.fillStyle = col; ctx.fill(); }
    else if (e.fill === 2) { ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fill(); }
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 1 / z); ctx.stroke();
  }
  if (e.text && z >= 0.3 && !hideText) {
    ctx.globalAlpha = 1; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = e.fill === 2 && e.kind !== "text" ? th.paper : th.ink;
    drawLabel(ctx, e.text, e.x + e.w / 2, e.y + e.h / 2);
  }
  ctx.globalAlpha = 1;
}
