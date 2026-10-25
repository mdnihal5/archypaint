import { portInto, listPorts, anchorsOf, arrowDist, arrowLabels, MAX_BRANCH_DEPTH, SEG_MIN_PX, canBindToArrow, computeArrowPts, eachElbowSeg, LAST_K, segMapOf, hostDepth, withSeg, effectiveRoute, isCurve, migrateArrowText, nearestT, pointAtT, routeArrow, sceneRectOf, type Anchor, type Rect, type RectOf } from "./connectors";
import type { EditorAPI, EditorEvent } from "./editor-api";
import type { GroupIndex } from "./groups";
import type { History } from "./history";
import type { Renderer } from "./renderer";
import { handlePoints, type El, type ElInit, type Kind, type Port, type Scene } from "./scene";
import type { AlignMode } from "./align";
import { frameChildren, isContainer, nextBadgeNumber } from "./edit-ops";
import { textWidth } from "./text-edit";
import { minLabelHeight } from "./wrap";
import type { Viewport } from "./viewport";

export type ShapeTool = "rect" | "ellipse" | "diamond" | "cylinder" | "cloud" | "hexagon" | "parallelogram" | "triangle" | "star" | "note" | "brace" | "badge" | "frame" | "lane";
/** "legend" and "renumber" are one-shot commands routed through setTool so the palette can trigger them */
export type Tool = "select" | "hand" | "arrow" | "line" | "text" | ShapeTool | "legend" | "renumber";

/** default size of a shape created by a plain click */
export const SHAPE_SIZE: Record<ShapeTool, { w: number; h: number }> = {
  rect: { w: 96, h: 56 }, ellipse: { w: 96, h: 56 }, diamond: { w: 96, h: 64 },
  cylinder: { w: 72, h: 88 }, cloud: { w: 116, h: 76 }, hexagon: { w: 96, h: 84 }, parallelogram: { w: 116, h: 62 },
  triangle: { w: 88, h: 76 }, star: { w: 88, h: 84 }, note: { w: 116, h: 92 }, brace: { w: 22, h: 116 },
  badge: { w: 28, h: 28 }, frame: { w: 320, h: 220 }, lane: { w: 420, h: 240 },
};
export const isShapeTool = (t: Tool): t is ShapeTool => t in SHAPE_SIZE;
const isArrowTool = (t: Tool): boolean => t === "arrow" || t === "line";
type Mode = "none" | "pan" | "move" | "create" | "marquee" | "resize" | "arrow" | "arrowEnd" | "arrowSeg" | "text" | "label";

/** internal surface the controller needs from the editor (EditorAPI + a few engine hooks) */
export interface Core extends EditorAPI {
  readonly renderer: Renderer;
  readonly hist: History;
  readonly groupIdx: GroupIndex;
  readonly entered: Set<string>;
  snap: boolean;
  setSel(ids: Iterable<string>): void;
  unitIds(e: El): readonly string[];
  newEl(init: ElInit): El;
  duplicateIds(ids: readonly string[], dx: number, dy: number): string[];
  rerouteIds(ids: ReadonlySet<string>): void;
  applyArrow(e: El, pts: number[]): void;
  editText(e: El, seed?: string): void;
  createTextAt(x: number, y: number): void;
  nudge(dx: number, dy: number): void;
  copyText(): string | null;
  pasteText(s: string): boolean;
  /** send an element behind everything (containers are created behind their contents) */
  toBack(e: El): void;
  insertLegend(): El | null;
  renumberBadges(): void;
  align(mode: AlignMode): void;
  distribute(axis: "h" | "v"): void;
  matchSize(dim: "w" | "h" | "both"): void;
  copyStyle(): boolean;
  pasteStyle(): void;
  toggleLock(): void;
  cut(): void;
  emit(ev: EditorEvent): void;
  edgeRadius(edge: number): number;
}

const HANDLE_CURSORS = ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize", "nwse-resize", "ns-resize", "nesw-resize", "ew-resize"];
const GRID = 10;
const MIN_SIZE = 16;


/**
 * Handlers only RECORD the latest input; apply() — called once at the start of each frame —
 * acts on it. So a 1000 Hz mouse or a wheel storm costs one unit of work per frame, and no
 * handler ever draws or writes reactive state. Every listener is registered through on() and
 * removed by destroy().
 */
export class Controller {
  tool: Tool = "select";
  onTool: (t: Tool) => void = () => {};

  private mode: Mode = "none";
  private space = false;
  private sx = 0; private sy = 0;
  private wx0 = 0; private wy0 = 0;
  private mx = 0; private my = 0; private moved = false; private hoverMoved = false;
  private wdx = 0; private wdy = 0; private wz = 1; private wzx = 0; private wzy = 0; private wheel = false;
  private shift = false;
  private cursor = "";
  private offs: (() => void)[] = [];
  private scene: Scene; private vp: Viewport; private r: Renderer;

  // move state
  private origins = new Map<string, { x: number; y: number }>();
  private moveBox: Rect | null = null;
  private movArrows: El[] = [];
  private scratch: El[] = [];
  private dupTx = false;
  // resize state
  private handle = -1;
  private rbox: Rect | null = null;
  private rorig = new Map<string, Rect>();
  private rlock = false;
  // arrow state
  private aStart: Anchor | null = null;
  /** view-only: pointer drag pans, every editing gesture and key is ignored (shared links, presentations) */
  readOnly = false;
  private aStartId = ""; private aStartPort = -1;
  private arrowEl: El | null = null; private endIsDst = true;
  // branch state: the arrow an arrow is starting / ending on, and where along it (fraction of its path)
  private aStartT = 0; private aStartHost = false; private endT = 0; private endHost = false;
  private hpt: [number, number] = [0, 0]; private ppt: [number, number] = [0, 0]; private plist: number[] = []; private bpt: [number, number] = [0, 0];
  // elbow-segment drag state: the segment's code (see connectors applySegs), the router's own coordinate for it, the live offsets
  private segCode = 0; private segVertical = false; private segAuto = 0; private segNext: number[] | undefined = undefined; private segLive: number[] | null = null;
  private sbest = Infinity; private sk = -1; private sv = false; private spx = 0; private spy = 0; private stol = 0;
  // label-drag state: the arrow and the index of the label being slid along it
  private lblArrow: El | null = null; private lblIdx = -1;
  private lpt: [number, number] = [0, 0];
  private pasteN = 0;
  private styleKeyAt = -1e9;

  constructor(private stage: HTMLElement, private core: Core) {
    this.scene = core.scene; this.vp = core.vp; this.r = core.renderer;
    this.r.onBeforeFrame = () => this.apply();
    this.on(stage, "pointerdown", (e) => this.down(e as PointerEvent));
    this.on(stage, "pointermove", (e) => this.move(e as PointerEvent));
    this.on(stage, "pointerup", (e) => this.up(e as PointerEvent));
    this.on(stage, "pointercancel", (e) => this.up(e as PointerEvent));
    this.on(stage, "dblclick", (e) => this.dbl(e as MouseEvent));
    this.on(stage, "wheel", (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.on(stage, "contextmenu", (e) => e.preventDefault());
    this.on(window, "keydown", (e) => this.key(e as KeyboardEvent, true));
    this.on(window, "keyup", (e) => this.key(e as KeyboardEvent, false));
    this.on(window, "copy", (e) => this.clip(e as ClipboardEvent, "copy"));
    this.on(window, "cut", (e) => this.clip(e as ClipboardEvent, "cut"));
    this.on(window, "paste", (e) => this.clip(e as ClipboardEvent, "paste"));
    this.on(window, "blur", () => { this.space = false; });
  }

  private on(t: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    t.addEventListener(type, fn, opts);
    this.offs.push(() => t.removeEventListener(type, fn, opts));
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0; this.origins.clear(); this.rorig.clear(); this.movArrows.length = 0; this.scratch.length = 0;
    this.r.onBeforeFrame = null;
  }

  /** double-click a creation tool (or Q): it stays active after each shape until unlocked or another tool is chosen */
  toolLocked = false;
  static lockable(t: Tool): boolean { return t === "arrow" || t === "line" || t === "text" || isShapeTool(t); }
  setToolLock(on: boolean): void {
    const next = on && Controller.lockable(this.tool);
    if (next === this.toolLocked) return;
    this.toolLocked = next;
    this.onTool(this.tool);
  }
  /** what a finished creation does: back to select, unless the tool is locked */
  private doneCreating(): void { if (!this.toolLocked) this.setTool("select"); }

  setTool(t: Tool): void {
    if (t === "legend") { this.core.insertLegend(); return; }
    if (t === "renumber") { this.core.renumberBadges(); return; }
    if (this.tool === t) return;
    this.toolLocked = false; // choosing a different tool always drops the lock: single click = one use, as before
    this.tool = t; this.r.hoverRect = null; this.r.hoverPort = -1;
    this.onTool(t); this.r.invalidate(false, true);
    this.setCursor(t === "select" ? "" : t === "hand" ? "grab" : "crosshair");
  }

  private setCursor(c: string): void { if (c !== this.cursor) { this.cursor = c; this.stage.style.cursor = c; } }

  private pt(e: PointerEvent | WheelEvent | MouseEvent): [number, number] {
    const b = this.stage.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  }

  // ---- pointer -----------------------------------------------------------------------------

  private down(e: PointerEvent): void {
    if (e.button === 2) return;
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* the pointer already ended (or the event is synthetic): dragging still works without capture */ }
    const [x, y] = this.pt(e);
    this.sx = this.mx = x; this.sy = this.my = y; this.moved = false;
    this.shift = e.shiftKey;
    const z = this.vp.zoom;
    const wx = this.wx0 = this.vp.toWorldX(x), wy = this.wy0 = this.vp.toWorldY(y);
    const core = this.core, r = this.r;
    if (this.readOnly || e.button === 1 || this.space || this.tool === "hand") { this.mode = "pan"; this.setCursor("grabbing"); return; }

    if (this.tool === "select") {
      if (this.startHandle(wx, wy)) return;
      const hit = this.scene.hit(wx, wy, 4 / z);
      if ((!hit || hit.kind === "arrow") && !e.shiftKey && this.startLabelDrag(wx, wy)) return;
      // empty space inside a group's drawn boundary (or its name tag) belongs to the group: pressing there grabs the whole group
      const gid = hit ? undefined : core.groupIdx.hitBoundary(wx, wy, core.entered);
      const unit = hit ? core.unitIds(hit) : gid !== undefined ? core.groupIdx.membersOf(gid) : null;
      if (unit && unit.length) {
        if (e.shiftKey) {
          const all = unit.every((id) => r.selected.has(id));
          const next = new Set(r.selected);
          for (const id of unit) { if (all) next.delete(id); else next.add(id); }
          core.setSel(next);
          this.mode = "none";
          return;
        }
        if (hit ? !r.selected.has(hit.id) : !unit.every((id) => r.selected.has(id))) core.setSel(unit);
        // a connector glued to a shape, icon, group or another arrow never comes unglued by dragging its body: on an elbow the drag pushes
        // the segment under the pointer, anything else just selects. Only an arrow with both ends free translates; ends detach by their handles.
        if (hit && hit.kind === "arrow" && unit.length === 1 && (hit.src || hit.dst)) {
          this.mode = "none";
          if (!this.scene.isLocked(hit) && Controller.elbowOf(hit) && this.segAt(hit, wx, wy, false)) this.beginSeg(hit);
          return;
        }
        if (e.altKey) { core.hist.begin(); this.dupTx = true; core.setSel(core.duplicateIds([...r.selected], 0, 0)); }
        this.beginMove();
        return;
      }
      if (!e.shiftKey) { core.setSel([]); core.entered.clear(); }
      this.mode = "marquee"; return;
    }
    if (isArrowTool(this.tool)) { this.beginArrow(wx, wy); return; }
    if (this.tool === "text") { this.mode = "text"; return; }
    this.mode = "create";
  }

  /** hoisted visitors for segment picking (no closure per pointer move) */
  private pickSeg = (code: number, mx: number, my: number, vertical: boolean, len: number): void => {
    const along = Math.max(0, Math.abs(vertical ? this.spy - my : this.spx - mx) - len / 2), across = Math.abs(vertical ? this.spx - mx : this.spy - my);
    const d = Math.hypot(along, across);
    if (d <= this.stol && d < this.sbest) { this.sbest = d; this.sk = code; this.sv = vertical; }
  };
  private pickHandle = (code: number, mx: number, my: number, vertical: boolean, len: number): void => {
    if (len * this.vp.zoom < SEG_MIN_PX) return;
    const d = Math.hypot(this.spx - mx, this.spy - my);
    if (d <= this.stol && d < this.sbest) { this.sbest = d; this.sk = code; this.sv = vertical; }
  };

  /** elbow arrows (sharp or round corners) have draggable segments; a soft elbow is a curve and has none */
  private static elbowOf(e: El): boolean { return e.kind === "arrow" && effectiveRoute(e.route, e.edge) === 1; }

  /** the interior segment of `a` nearest the point (handle = near its midpoint handle only, otherwise anywhere on the segment) */
  private segAt(a: El, wx: number, wy: number, handleOnly: boolean): boolean {
    this.spx = wx; this.spy = wy; this.sbest = Infinity; this.sk = -1;
    this.stol = (handleOnly ? 9 : 8) / this.vp.zoom;
    eachElbowSeg(a, this.scene, a.pts, handleOnly ? this.pickHandle : this.pickSeg);
    return this.sk >= 0;
  }

  /** begin dragging segment `this.sk` of arrow `a`: the router's own position for it is the zero of the offset */
  private beginSeg(a: El): boolean {
    const scene = this.scene, base = sceneRectOf(scene);
    if (!segMapOf(a, scene)) return false; // the stored path is stale against the router: leave it alone
    const auto = computeArrowPts({ ...a, segs: undefined } as El, base);
    const k = (this.sk >> 1) === LAST_K ? (auto.length >> 1) - 2 : this.sk >> 1; // segment index in the auto path
    this.segVertical = this.sv; this.segCode = this.sk;
    this.segAuto = auto[2 * k + (this.sv ? 0 : 1)]!;
    this.segNext = a.segs; this.segLive = null;
    this.arrowEl = a; this.mode = "arrowSeg";
    this.core.hist.begin(); this.core.hist.touch(a);
    this.r.dragging.add(a.id); this.r.livePts.set(a.id, [...a.pts]);
    this.r.invalidate(true, true);
    return true;
  }

  private applySeg(wx: number, wy: number): void {
    const a = this.arrowEl!, r = this.r;
    let c = this.segVertical ? wx : wy;
    if (this.core.snap && this.vp.zoom >= 0.4) c = Math.round(c / GRID) * GRID;
    this.segNext = withSeg(a.segs, this.segCode, c - this.segAuto);
    r.livePts.set(a.id, computeArrowPts({ ...a, segs: this.segNext } as El, sceneRectOf(this.scene)));
    r.invalidate(false, true);
  }

  private finishSeg(): void {
    const core = this.core, r = this.r, a = this.arrowEl!;
    const pts = r.livePts.get(a.id);
    if (pts && this.segLive !== null) {
      this.scene.patch(a, { segs: this.segNext });
      core.applyArrow(a, pts);
      core.hist.commit("move segment");
      core.emit("change"); core.emit("history");
    } else core.hist.commit("noop");
    r.dragging.delete(a.id); r.livePts.delete(a.id);
    this.arrowEl = null; this.segLive = null;
    r.invalidate(true, true);
  }

  private startHandle(wx: number, wy: number): boolean {
    const r = this.r, z = this.vp.zoom, hs = 9 / z;
    if (!r.selected.size) return false;
    if (r.selected.size === 1) {
      const e = this.scene.els.get([...r.selected][0]!);
      if (e && e.kind === "arrow") {
        const p = e.pts, n = p.length;
        const ends: [number, number][] = [[p[0]!, p[1]!], [p[n - 2]!, p[n - 1]!]];
        for (let i = 0; i < 2; i++) {
          if (Math.abs(wx - ends[i]![0]) <= hs && Math.abs(wy - ends[i]![1]) <= hs) {
            this.arrowEl = e; this.endIsDst = i === 1; this.mode = "arrowEnd";
            this.core.hist.begin(); this.core.hist.touch(e);
            r.dragging.add(e.id); r.livePts.set(e.id, [...e.pts]);
            r.invalidate(true, true); // repaint the static layer without it, or the old arrow stays under the live one
            return true;
          }
        }
        if (Controller.elbowOf(e) && !this.scene.isLocked(e) && this.segAt(e, wx, wy, true)) return this.beginSeg(e);
        return false;
      }
    }
    const box = r.selectionBox();
    if (!box) return false;
    let anyShape = false;
    for (const id of r.selected) { const se = this.scene.els.get(id); if (se && se.kind !== "arrow" && !this.scene.isLocked(se)) { anyShape = true; break; } }
    if (!anyShape) return false;
    const pts = handlePoints(box);
    for (let i = 0; i < 8; i++) {
      if (Math.abs(wx - pts[i]![0]) <= hs && Math.abs(wy - pts[i]![1]) <= hs) {
        this.handle = i; this.rbox = box; this.rorig.clear(); this.rlock = false;
        this.core.hist.begin();
        for (const id of r.selected) {
          const e = this.scene.els.get(id);
          if (!e || e.kind === "arrow" || this.scene.isLocked(e)) continue;
          this.core.hist.touch(e); this.rorig.set(id, { x: e.x, y: e.y, w: e.w, h: e.h });
        }
        if (r.selected.size === 1) { const k1 = this.scene.els.get([...r.selected][0]!)?.kind; if (k1 === "icon" || k1 === "badge" || k1 === "image") this.rlock = true; }
        this.mode = "resize";
        return true;
      }
    }
    return false;
  }

  private beginMove(): void {
    const r = this.r, scene = this.scene;
    this.mode = "move"; this.origins.clear(); this.movArrows.length = 0;
    r.dragDx = r.dragDy = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of r.selected) {
      const e = scene.els.get(id);
      if (!e || scene.isLocked(e)) continue;
      // a connector glued to something that is not moving stays put: it only stretches with its shapes, it never floats off them or detaches
      if (e.kind === "arrow" && ((e.src && !r.selected.has(e.src) && !this.groupSelected(e.src)) || (e.dst && !r.selected.has(e.dst) && !this.groupSelected(e.dst)))) continue;
      this.origins.set(id, { x: e.x, y: e.y });
      r.dragging.add(id);
      if (e.kind !== "arrow") { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); }
    }
    this.moveBox = x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    // dragging a frame / swimlane carries everything fully inside it
    const kids: El[] = [];
    for (const id of [...this.origins.keys()]) {
      const c = scene.els.get(id);
      if (c && isContainer(c.kind)) frameChildren(scene, c, kids, this.scratch);
    }
    for (const c of kids) if (c.kind !== "arrow" && !this.origins.has(c.id)) { this.origins.set(c.id, { x: c.x, y: c.y }); r.dragging.add(c.id); }
    // a connector inside a moving frame travels with it only when everything it is bound to travels too (it never detaches)
    for (const c of kids) {
      if (c.kind !== "arrow" || this.origins.has(c.id)) continue;
      if ((c.src && !this.origins.has(c.src) && !this.groupMoves(c.src)) || (c.dst && !this.origins.has(c.dst) && !this.groupMoves(c.dst))) continue;
      this.origins.set(c.id, { x: c.x, y: c.y }); r.dragging.add(c.id);
    }
    // arrows attached to moving shapes follow live (rerouted each frame on the live layer); branches follow their host arrow, level by level
    const seenA = new Set<string>();
    for (let lvl = 0, grew = true; grew && lvl <= MAX_BRANCH_DEPTH; lvl++) {
      grew = false;
      for (const a of scene.els.values()) {
        if (a.kind !== "arrow" || seenA.has(a.id)) continue;
        if ((a.src && (r.dragging.has(a.src) || this.groupMoves(a.src))) || (a.dst && (r.dragging.has(a.dst) || this.groupMoves(a.dst)))) {
          if (!r.selected.has(a.id) || !r.dragging.has(a.id)) { r.dragging.add(a.id); }
          seenA.add(a.id); this.movArrows.push(a); grew = true;
        }
      }
    }
    if (this.movArrows.length > 1) this.movArrows.sort((p, q) => hostDepth(scene, p) - hostDepth(scene, q));
    r.invalidate(true, true);
  }

  /** is `id` a group all of whose members are being dragged? (a connector bound to the group follows it) */
  private groupMoves(id: string): boolean {
    if (!this.scene.groups.has(id)) return false;
    const m = this.core.groupIdx.membersOf(id);
    if (!m.length) return false;
    for (let i = 0; i < m.length; i++) if (!this.origins.has(m[i]!)) return false;
    return true;
  }
  /** is `id` a group all of whose members are selected? */
  private groupSelected(id: string): boolean {
    if (!this.scene.groups.has(id)) return false;
    const m = this.core.groupIdx.membersOf(id);
    if (!m.length) return false;
    for (let i = 0; i < m.length; i++) if (!this.r.selected.has(m[i]!)) return false;
    return true;
  }

  // ---- connector labels ---------------------------------------------------------------------

  /** the label (and its arrow) under a world point: its text box is centred on its position along the path */
  private labelHit(wx: number, wy: number): { arrow: El; idx: number } | null {
    const z = this.vp.zoom, pad = 6 / z;
    this.scene.query(wx - pad, wy - pad, wx + pad, wy + pad, this.scratch);
    let best: { arrow: El; idx: number } | null = null, bz = -Infinity;
    for (const a of this.scratch) {
      if (a.kind !== "arrow" || a.z < bz) continue;
      const ls = arrowLabels(a);
      for (let i = 0; i < ls.length; i++) {
        const l = ls[i]!;
        pointAtT(a.pts, isCurve(a), l.t, this.lpt);
        const w = textWidth(l.text, a.fs || 13) + 10, h = Math.round((a.fs || 13) * 1.5);
        if (Math.abs(wx - this.lpt[0]) <= w / 2 + 2 && Math.abs(wy - this.lpt[1]) <= h / 2 + 2) { best = { arrow: a, idx: i }; bz = a.z; }
      }
    }
    return best;
  }

  private startLabelDrag(wx: number, wy: number): boolean {
    const hit = this.labelHit(wx, wy);
    if (!hit || this.scene.isLocked(hit.arrow)) return false;
    this.core.setSel([hit.arrow.id]);
    this.lblArrow = hit.arrow; this.lblIdx = hit.idx; this.mode = "label";
    this.core.hist.begin(); this.core.hist.touch(hit.arrow);
    return true;
  }

  private applyLabel(wx: number, wy: number): void {
    const a = this.lblArrow;
    if (!a) return;
    migrateArrowText(a); // a legacy centred text becomes the first label the moment it is moved
    const l = a.labels?.[this.lblIdx];
    if (!l) return;
    l.t = nearestT(a.pts, isCurve(a), wx, wy);
    this.scene.patch(a, {}); // version + nonce bump, no allocation
    this.r.invalidate(true, true);
  }

  private beginArrow(wx: number, wy: number): void {
    const a = this.anchorAt(wx, wy, "");
    this.aStart = a.rect ? { rect: a.rect, pt: [wx, wy], port: a.port as Port } : a.host ? { rect: null, pt: [this.bpt[0], this.bpt[1]], port: -1 } : { rect: null, pt: [wx, wy], port: -1 };
    this.aStartId = a.id; this.aStartPort = a.port; this.aStartHost = a.host; this.aStartT = a.t;
    this.mode = "arrow";
  }

  /** shape under the point (with a little slop) and the port to attach to (-1 = automatic) */
  private anchorAt(wx: number, wy: number, exclude: string): { id: string; rect: Rect | null; port: number; host: boolean; t: number } {
    const z = this.vp.zoom;
    this.scene.query(wx - 8 / z, wy - 8 / z, wx + 8 / z, wy + 8 / z, this.scratch);
    let best: El | null = null;
    for (const e of this.scratch) {
      if (e.kind === "arrow" || e.kind === "legend" || isContainer(e.kind)) continue;
      if (!best || e.z > best.z) best = e;
    }
    if (!best) return this.hostAt(wx, wy, exclude) ?? this.groupAnchorAt(wx, wy);
    return { id: best.id, rect: best, port: this.nearestPort(best, wx, wy), host: false, t: 0 };
  }

  /**
   * An arrow's line is a connection target too (a branch): the nearest arrow path within a few pixels, shapes having been tried first.
   * Writes the projected point to `this.bpt`. `exclude` is the arrow being edited: it, and anything that would make a cycle, is refused.
   */
  private hostAt(wx: number, wy: number, exclude: string): { id: string; rect: null; port: number; host: true; t: number } | null {
    const tol = 8 / this.vp.zoom;
    let best: El | null = null, bd = tol, n = 0;
    for (const e of this.scratch) {
      if (e.kind !== "arrow" || e.id === exclude) continue;
      if (++n > 64) break;
      const d = arrowDist(e, wx, wy);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best || !canBindToArrow(this.scene, exclude, best.id)) return null;
    const t = nearestT(best.pts, isCurve(best), wx, wy);
    pointAtT(best.pts, isCurve(best), t, this.bpt);
    return { id: best.id, rect: null, port: -1, host: true, t };
  }

  private nearestPort(r: Rect, wx: number, wy: number): number {
    let port = -1, bd = 14 / this.vp.zoom;
    const list = listPorts(r, this.vp.zoom, this.plist), p = this.ppt;
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      portInto(r, s, p);
      const d = Math.hypot(p[0] - wx, p[1] - wy);
      if (d < bd) { bd = d; port = s; }
    }
    return port;
  }

  /**
   * A group's boundary is a connection target like a shape: near its drawn outline (not its empty interior, which an arrow drawn
   * across a group must be free to start in) the arrow binds to the group, with the same ports. The innermost group wins.
   */
  private groupAnchorAt(wx: number, wy: number): { id: string; rect: Rect | null; port: number; host: boolean; t: number } {
    const none = { id: "", rect: null, port: -1, host: false, t: 0 }, band = 10 / this.vp.zoom;
    if (this.scene.groups.size === 0) return none;
    let best: Rect | null = null, bid = "", area = Infinity;
    for (const g of this.scene.groups.values()) {
      const b = this.core.groupIdx.bounds(g.id);
      if (!b) continue;
      const dx = Math.min(Math.abs(wx - b.x), Math.abs(wx - (b.x + b.w))), dy = Math.min(Math.abs(wy - b.y), Math.abs(wy - (b.y + b.h)));
      const inX = wx >= b.x - band && wx <= b.x + b.w + band, inY = wy >= b.y - band && wy <= b.y + b.h + band;
      if (!inX || !inY || Math.min(dx, dy) > band) continue; // inside the padded box but not near its outline: not a hit
      if (b.w * b.h < area) { area = b.w * b.h; best = b; bid = g.id; }
    }
    return best ? { id: bid, rect: best, port: this.nearestPort(best, wx, wy), host: false, t: 0 } : none;
  }

  private move(e: PointerEvent): void {
    this.shift = e.shiftKey;
    [this.mx, this.my] = this.pt(e);
    if (this.mode === "none") { this.hoverMoved = true; this.r.wake(); return; }
    this.moved = true;
    this.r.wake();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const [x, y] = this.pt(e);
    if (e.ctrlKey || e.metaKey) { this.wz *= Math.exp(-e.deltaY * 0.01); this.wzx = x; this.wzy = y; }
    else { this.wdx += e.deltaX; this.wdy += e.deltaY; }
    this.wheel = true; this.r.wake();
  }

  /** called at the start of every frame: coalesced input becomes one unit of work */
  private apply(): void {
    const vp = this.vp, r = this.r, core = this.core;
    if (this.wheel) {
      if (this.wz !== 1) vp.zoomAt(this.wzx, this.wzy, this.wz);
      if (this.wdx || this.wdy) vp.panBy(-this.wdx, -this.wdy);
      this.wz = 1; this.wdx = this.wdy = 0; this.wheel = false;
      r.invalidate(true, true);
      core.emit("viewport");
    }
    if (this.hoverMoved) { this.hoverMoved = false; this.hover(); }
    if (!this.moved) return;
    this.moved = false;
    const wx = vp.toWorldX(this.mx), wy = vp.toWorldY(this.my);
    switch (this.mode) {
      case "pan":
        vp.panBy(this.mx - this.sx, this.my - this.sy); this.sx = this.mx; this.sy = this.my;
        r.invalidate(true, true); core.emit("viewport"); break;
      case "move": this.applyMove(wx, wy); break;
      case "marquee":
        r.marquee = { x: Math.min(this.wx0, wx), y: Math.min(this.wy0, wy), w: Math.abs(wx - this.wx0), h: Math.abs(wy - this.wy0) };
        r.invalidate(false, true); break;
      case "create": {
        if (!isShapeTool(this.tool)) break;
        let w = Math.abs(wx - this.wx0), h = Math.abs(wy - this.wy0);
        if (this.shift || this.tool === "badge") { w = h = Math.max(w, h); }
        let x = wx < this.wx0 ? this.wx0 - w : this.wx0, y = wy < this.wy0 ? this.wy0 - h : this.wy0;
        let o: 0 | 1 | 2 | 3 = 0;
        if (this.tool === "brace") ({ x, y, w, h, o } = braceBox(this.wx0, this.wy0, wx, wy));
        r.ghost = { kind: this.tool, x, y, w, h, o, radius: core.edgeRadius(core.defaults.edge) };
        r.invalidate(false, true); break;
      }
      case "resize": this.applyResize(wx, wy); break;
      case "arrow": this.applyArrowDrag(wx, wy); break;
      case "arrowEnd": this.applyArrowEnd(wx, wy); break;
      case "arrowSeg": this.segLive = this.segLive ?? []; this.applySeg(wx, wy); break;
      case "label": this.applyLabel(wx, wy); break;
      default: break;
    }
  }

  private hover(): void {
    const r = this.r, vp = this.vp;
    const wx = vp.toWorldX(this.mx), wy = vp.toWorldY(this.my);
    if (isArrowTool(this.tool)) {
      const a = this.anchorAt(wx, wy, "");
      const changed = r.hoverRect !== a.rect || r.hoverPort !== a.port || this.hoverHost(a.host);
      r.hoverRect = a.rect ? { x: a.rect.x, y: a.rect.y, w: a.rect.w, h: a.rect.h, kind: a.rect.kind, radius: a.rect.radius } : null; r.hoverPort = a.port;
      if (changed) r.invalidate(false, true);
      return;
    }
    if (this.tool !== "select") return;
    const z = vp.zoom, hs = 9 / z;
    let c = "";
    const box = r.selectionBox();
    if (box && r.selected.size) {
      const pts = handlePoints(box);
      for (let i = 0; i < 8; i++) if (Math.abs(wx - pts[i]![0]) <= hs && Math.abs(wy - pts[i]![1]) <= hs) { c = HANDLE_CURSORS[i]!; break; }
    }
    if (!c && r.selected.size === 1) { // an elbow arrow's segment handle: the cursor says which way it slides
      const a = this.scene.els.get(r.selected.values().next().value as string);
      if (a && Controller.elbowOf(a) && this.segAt(a, wx, wy, true)) c = this.sv ? "ew-resize" : "ns-resize";
    }
    if (!c && (this.scene.hit(wx, wy, 4 / z) || this.core.groupIdx.hitBoundary(wx, wy, this.core.entered))) c = "move";
    this.setCursor(c);
  }

  /** show / hide the branch ring at `this.bpt`; true when what is drawn changed */
  private hoverHost(on: boolean): boolean {
    const r = this.r, cur = r.hoverPt;
    if (!on) { if (cur === null) return false; r.hoverPt = null; return true; }
    if (cur !== null && cur[0] === this.bpt[0] && cur[1] === this.bpt[1]) return false;
    this.hpt[0] = this.bpt[0]; this.hpt[1] = this.bpt[1]; r.hoverPt = this.hpt;
    return true;
  }

  // ---- move --------------------------------------------------------------------------------

  private applyMove(wx: number, wy: number): void {
    const r = this.r;
    let dx = wx - this.wx0, dy = wy - this.wy0;
    r.guideX.length = 0; r.guideY.length = 0;
    if (this.core.snap && this.moveBox) [dx, dy] = this.snapDelta(dx, dy);
    r.dragDx = dx; r.dragDy = dy;
    if (this.movArrows.length) {
      const scene = this.scene;
      const base = sceneRectOf(scene);
      const rectOf: RectOf = (id: string): Rect | null => {
        const t = base(id);
        if (!t) return t;
        const moving = scene.els.has(id) ? r.dragging.has(id) && this.origins.has(id) : this.groupMoves(id);
        return moving ? { x: t.x + dx, y: t.y + dy, w: t.w, h: t.h } : t;
      };
      rectOf.host = (id, t, out) => { // a branch end follows its host arrow: the host's live path while it re-routes, or its translated path while it is dragged
        const h = scene.els.get(id);
        if (!h || h.kind !== "arrow") return false;
        const lp = r.livePts.get(id);
        pointAtT(lp ?? h.pts, isCurve(h), t, out);
        if (!lp && this.origins.has(id)) { out[0] += dx; out[1] += dy; }
        return true;
      };
      for (const a of this.movArrows) {
        // an arrow that is itself moving keeps its free ends where they are dragged to
        if (this.origins.has(a.id) && !(a.src && !this.origins.has(a.src) && !this.groupMoves(a.src)) && !(a.dst && !this.origins.has(a.dst) && !this.groupMoves(a.dst))) {
          const moved = a.pts.map((v, i) => (i % 2 ? v + dy : v + dx));
          const ea = { ...a, pts: moved };
          r.livePts.set(a.id, computeArrowPts(ea as El, rectOf));
        } else r.livePts.set(a.id, computeArrowPts(a, rectOf));
      }
    }
    r.invalidate(false, true);
  }

  private snapDelta(dx: number, dy: number): [number, number] {
    const r = this.r, b = this.moveBox!, z = this.vp.zoom, thr = 6 / z;
    const mine = (o: number, s: number) => [o, o + s / 2, o + s];
    this.scene.query(b.x + dx - 80 / z, b.y + dy - 80 / z, b.x + dx + b.w + 80 / z, b.y + dy + b.h + 80 / z, this.scratch);
    let bx = thr, by = thr, ax = 0, ay = 0, gx = NaN, gy = NaN;
    let n = 0;
    for (const c of this.scratch) {
      if (c.kind === "arrow" || r.dragging.has(c.id)) continue;
      if (++n > 64) break;
      const cx = [c.x, c.x + c.w / 2, c.x + c.w], cy = [c.y, c.y + c.h / 2, c.y + c.h];
      const mxs = mine(b.x + dx, b.w), mys = mine(b.y + dy, b.h);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const ddx = cx[i]! - mxs[j]!; if (Math.abs(ddx) < bx) { bx = Math.abs(ddx); ax = ddx; gx = cx[i]!; }
        const ddy = cy[i]! - mys[j]!; if (Math.abs(ddy) < by) { by = Math.abs(ddy); ay = ddy; gy = cy[i]!; }
      }
    }
    if (!Number.isNaN(gx)) { dx += ax; r.guideX.push(gx); }
    else if (z >= 0.4) dx = Math.round((b.x + dx) / GRID) * GRID - b.x;
    if (!Number.isNaN(gy)) { dy += ay; r.guideY.push(gy); }
    else if (z >= 0.4) dy = Math.round((b.y + dy) / GRID) * GRID - b.y;
    return [dx, dy];
  }

  private finishMove(): void {
    const r = this.r, core = this.core, scene = this.scene;
    const dx = r.dragDx, dy = r.dragDy;
    if (this.origins.size && (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001 || this.dupTx)) {
      core.hist.begin();
      for (const [id, o] of this.origins) {
        const e = scene.els.get(id);
        if (!e) continue;
        core.hist.touch(e);
        if (e.kind === "arrow") {
          // only arrows whose bound ends all travel too (or that have none) are in `origins`: a bound arrow is never torn from its shapes
          const pts = e.pts.map((v, i) => (i % 2 ? v + dy : v + dx));
          core.applyArrow(e, pts);
          continue;
        }
        scene.set(e, o.x + dx, o.y + dy);
      }
      core.rerouteIds(new Set(this.origins.keys()));
      core.hist.commit(this.dupTx ? "duplicate" : "move");
      core.emit("change"); core.emit("history");
    } else if (core.hist.active) core.hist.commit("noop");
    this.endMove();
  }

  private endMove(): void {
    const r = this.r;
    this.dupTx = false;
    this.origins.clear(); this.movArrows.length = 0; r.dragging.clear(); r.livePts.clear();
    r.dragDx = r.dragDy = 0; r.guideX.length = 0; r.guideY.length = 0; this.moveBox = null;
    r.invalidate(true, true);
  }

  // ---- resize ------------------------------------------------------------------------------

  private applyResize(wx: number, wy: number): void {
    const b = this.rbox!, h = this.handle, core = this.core, scene = this.scene;
    let l = b.x, rr = b.x + b.w, t = b.y, bt = b.y + b.h;
    if (h === 0 || h === 6 || h === 7) l = wx;
    if (h === 2 || h === 3 || h === 4) rr = wx;
    if (h === 0 || h === 1 || h === 2) t = wy;
    if (h === 4 || h === 5 || h === 6) bt = wy;
    if (rr - l < MIN_SIZE) { if (h === 0 || h === 6 || h === 7) l = rr - MIN_SIZE; else rr = l + MIN_SIZE; }
    if (bt - t < MIN_SIZE) { if (h === 0 || h === 1 || h === 2) t = bt - MIN_SIZE; else bt = t + MIN_SIZE; }
    if (this.shift || this.rlock) {
      const ratio = b.w / (b.h || 1);
      let w = rr - l, hh = bt - t;
      const corner = h === 0 || h === 2 || h === 4 || h === 6;
      if (corner) {
        const s = Math.max(w / b.w, hh / b.h); w = b.w * s; hh = b.h * s;
        if (h === 0 || h === 6) l = rr - w; else rr = l + w;
        if (h === 0 || h === 2) t = bt - hh; else bt = t + hh;
      } else if (h === 1 || h === 5) { w = hh * ratio; const c = (l + rr) / 2; l = c - w / 2; rr = c + w / 2; }
      else { hh = w / ratio; const c = (t + bt) / 2; t = c - hh / 2; bt = c + hh / 2; }
    }
    const sx = (rr - l) / (b.w || 1), sy = (bt - t) / (b.h || 1);
    for (const [id, o] of this.rorig) {
      const e = scene.els.get(id);
      if (!e) continue;
      scene.set(e, l + (o.x - b.x) * sx, t + (o.y - b.y) * sy, Math.max(4, o.w * sx), Math.max(4, o.h * sy));
      // a shape cannot be squeezed below its label: the text would run out of it
      const need = minLabelHeight(e, () => (s) => textWidth(s, e.fs || 0));
      if (need > e.h) scene.set(e, e.x, e.y, e.w, need);
    }
    core.rerouteIds(new Set(this.rorig.keys()));
    this.r.invalidate(true, true);
  }

  // ---- arrows ------------------------------------------------------------------------------

  private endAnchor(wx: number, wy: number, exclude: string): Anchor {
    const a = this.anchorAt(wx, wy, exclude);
    this.r.hoverRect = a.rect ? { x: a.rect.x, y: a.rect.y, w: a.rect.w, h: a.rect.h, kind: a.rect.kind, radius: a.rect.radius } : null; this.r.hoverPort = a.port;
    this.hoverHost(a.host);
    this.endTarget = a.id; this.endPort = a.port; this.endHost = a.host; this.endT = a.t;
    return a.rect ? { rect: a.rect, pt: [wx, wy], port: a.port as Port } : { rect: null, pt: a.host ? [this.bpt[0], this.bpt[1]] : [wx, wy], port: -1 };
  }
  private endTarget = ""; private endPort = -1;

  private applyArrowDrag(wx: number, wy: number): void {
    const d = this.core.defaults, r = this.r;
    const b = this.endAnchor(wx, wy, "");
    const pts = routeArrow(this.aStart!, b, effectiveRoute(d.route, d.edge));
    r.ghostArrow = { pts, cat: d.cat, route: d.route, edge: d.edge, dash: d.dash, head: this.tool === "line" ? 0 : 1, text: "" };
    r.invalidate(false, true);
  }

  private applyArrowEnd(wx: number, wy: number): void {
    const e = this.arrowEl!, r = this.r, base = sceneRectOf(this.scene);
    const b = this.endAnchor(wx, wy, e.id);
    const [sa, da] = anchorsOf(e, base);
    const pts = this.endIsDst ? routeArrow(sa, b, effectiveRoute(e.route, e.edge)) : routeArrow(b, da, effectiveRoute(e.route, e.edge));
    r.livePts.set(e.id, pts);
    r.invalidate(false, true);
  }

  private finishArrow(): void {
    const core = this.core, r = this.r;
    const g = r.ghostArrow;
    r.ghostArrow = null; r.hoverRect = null; r.hoverPort = -1;
    if (g) {
      const d = core.defaults;
      const dstId = this.endTarget, srcId = this.aStartId;
      const long = Math.hypot(g.pts[g.pts.length - 2]! - g.pts[0]!, g.pts[g.pts.length - 1]! - g.pts[1]!) > 10;
      if (long || (srcId && dstId && srcId !== dstId)) {
        core.hist.begin();
        const bb = bboxOf(g.pts);
        const a = core.newEl({
          kind: "arrow", ...bb, pts: g.pts, src: srcId, dst: dstId, sp: this.aStartPort as Port, dp: this.endPort as Port,
          route: d.route, edge: d.edge, dash: d.dash, cat: d.cat, fill: 0, radius: 0, head: g.head,
          ...(this.aStartHost && srcId ? { st: this.aStartT } : {}), ...(this.endHost && dstId ? { dt: this.endT } : {}),
        });
        core.hist.commit("arrow");
        core.setSel([a.id]); this.doneCreating();
        core.emit("change"); core.emit("history");
      }
    }
    this.aStart = null; this.endTarget = ""; this.endPort = -1; this.endHost = false; this.aStartHost = false; r.hoverPt = null;
    r.invalidate(true, true);
  }

  private finishArrowEnd(): void {
    const core = this.core, r = this.r, e = this.arrowEl!;
    const pts = r.livePts.get(e.id);
    if (pts) {
      if (this.endIsDst) { e.dst = this.endTarget; e.dp = this.endPort as Port; e.dt = this.endHost ? this.endT : undefined; }
      else { e.src = this.endTarget; e.sp = this.endPort as Port; e.st = this.endHost ? this.endT : undefined; }
      e.segs = undefined; // re-ending a connector changes its route: a manual elbow shape no longer applies
      core.applyArrow(e, pts);
      core.hist.commit("edit arrow");
      core.emit("change"); core.emit("history");
    } else core.hist.commit("noop");
    r.dragging.delete(e.id); r.livePts.delete(e.id);
    this.arrowEl = null; this.endTarget = ""; this.endPort = -1; this.endHost = false; r.hoverRect = null; r.hoverPort = -1; r.hoverPt = null;
    r.invalidate(true, true);
  }

  // ---- pointer up / cancel -----------------------------------------------------------------

  private up(e: PointerEvent): void {
    if (this.mode === "none") return;
    this.apply();
    const r = this.r, core = this.core, vp = this.vp;
    const wx = vp.toWorldX(this.mx), wy = vp.toWorldY(this.my);
    const wasClick = !this.moved && Math.hypot(this.mx - this.sx, this.my - this.sy) < 4 && Math.hypot(wx - this.wx0, wy - this.wy0) * vp.zoom < 4;
    switch (this.mode) {
      case "move": this.finishMove(); break;
      case "resize":
        core.hist.commit("resize"); this.rorig.clear(); this.rbox = null; this.handle = -1; core.emit("change"); core.emit("history");
        r.invalidate(true, true); break;
      case "marquee": this.finishMarquee(wx, wy); break;
      case "create": this.finishCreate(wx, wy, wasClick); break;
      case "arrow": this.finishArrow(); break;
      case "arrowEnd": this.finishArrowEnd(); break;
      case "arrowSeg": this.finishSeg(); break;
      case "label":
        if (core.hist.commit("move label")) { core.emit("change"); core.emit("history"); }
        this.lblArrow = null; this.lblIdx = -1; r.invalidate(true, true); break;
      case "text": if (wasClick) core.createTextAt(wx, wy); this.doneCreating(); break;
      case "pan": this.setCursor(this.tool === "hand" ? "grab" : this.tool === "select" ? "" : "crosshair"); break;
      default: break;
    }
    this.mode = "none";
    try { this.stage.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    core.emit("change");
  }

  private finishCreate(wx: number, wy: number, click: boolean): void {
    const core = this.core, r = this.r;
    const g = r.ghost; r.ghost = null;
    const tool = this.tool;
    if (!isShapeTool(tool)) { r.invalidate(false, true); return; }
    const kind: Kind = tool;
    const size = SHAPE_SIZE[tool];
    let x: number, y: number, w: number, h: number, o: 0 | 1 | 2 | 3 = 0;
    if (click || !g || g.w < 8 || g.h < 8) {
      ({ w, h } = size); x = wx - w / 2; y = wy - h / 2;
      if (kind === "brace") { x = wx - w / 2; y = wy - h / 2; }
    } else ({ x, y, w, h } = g);
    if (kind === "brace" && g && !(click || g.w < 8 || g.h < 8)) o = g.o ?? 0;
    if (kind === "brace" && (click || !g)) o = 0;
    const init: ElInit = { kind, x, y, w, h };
    if (kind === "brace") init.o = o;
    if (kind === "badge") { init.n = nextBadgeNumber(this.scene.els.values()); init.fill = 2; init.w = init.h = 32; init.x = wx - 16; init.y = wy - 16; }
    if (kind === "note") { init.cat = 7; init.fill = 1; }
    if (kind === "frame") { init.dash = 1; init.fill = 1; init.cat = 6; init.text = "region"; }
    if (kind === "lane") { init.text = "lane 1\nlane 2\nlane 3"; init.n = 3; init.o = 0; init.cat = 6; init.fill = 1; init.dash = 0; }
    core.hist.begin();
    const el = core.newEl(init);
    if (isContainer(kind)) core.toBack(el);
    core.hist.commit("create");
    core.setSel([el.id]); this.doneCreating();
    r.invalidate(true, true); core.emit("history");
  }

  private finishMarquee(wx: number, wy: number): void {
    const r = this.r, core = this.core;
    const m = r.marquee; r.marquee = null;
    if (m && (m.w > 3 || m.h > 3)) {
      this.scene.query(m.x, m.y, m.x + m.w, m.y + m.h, this.scratch);
      const ids = new Set<string>(this.shift ? r.selected : []);
      for (const e of this.scratch) {
        if (e.x >= m.x && e.y >= m.y && e.x + e.w <= m.x + m.w && e.y + e.h <= m.y + m.h) for (const id of core.unitIds(e)) ids.add(id);
      }
      core.setSel(ids);
    }
    void wx; void wy;
    r.invalidate(false, true);
  }

  private cancel(): void {
    const r = this.r, core = this.core;
    if (this.mode === "resize" || this.mode === "arrowEnd" || this.mode === "arrowSeg" || this.mode === "label" || (this.mode === "move" && this.dupTx)) {
      const ids = core.hist.abort();
      for (const id of ids) void id;
    }
    r.ghost = null; r.ghostArrow = null; r.marquee = null; r.hoverRect = null; r.hoverPort = -1; r.hoverPt = null;
    this.endMove(); this.rorig.clear(); this.rbox = null; this.handle = -1; this.arrowEl = null; this.aStart = null; this.lblArrow = null; this.lblIdx = -1;
    this.mode = "none";
    core.emit("change");
  }

  // ---- double click ------------------------------------------------------------------------

  private dbl(e: MouseEvent): void {
    if (this.readOnly) return;
    const [x, y] = this.pt(e);
    const wx = this.vp.toWorldX(x), wy = this.vp.toWorldY(y), core = this.core;
    const hit = this.scene.hit(wx, wy, 4 / this.vp.zoom);
    // a connector's label: edit it where it sits; a double-click elsewhere on the line adds a label at that spot
    if (!hit || hit.kind === "arrow") {
      const lh = this.labelHit(wx, wy);
      if (lh) { core.setSel([lh.arrow.id]); core.editLabel(lh.arrow, lh.idx, 0); return; }
    }
    if (!hit) {
      const tag = core.groupIdx.tagAt(wx, wy);
      if (tag !== undefined) { core.editGroupName(tag); return; }
      core.createTextAt(wx, wy); return;
    }
    if (hit.kind === "arrow") {
      if (this.scene.isLocked(hit)) return;
      core.setSel([hit.id]);
      core.editLabel(hit, -1, nearestT(hit.pts, isCurve(hit), wx, wy));
      return;
    }
    const top = core.groupIdx.unitGroup(hit, core.entered);
    if (top) { core.entered.add(top); core.setSel(core.unitIds(hit)); return; }
    if (hit.kind === "legend") { core.setSel([hit.id]); core.insertLegend(); return; }
    if (hit.kind === "brace" || this.scene.isLocked(hit)) return;
    core.editText(hit);
  }

  // ---- keyboard / clipboard ----------------------------------------------------------------

  private key(e: KeyboardEvent, down: boolean): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.code === "Space") { this.space = down; if (down) { e.preventDefault(); this.setCursor("grab"); } else this.setCursor(this.tool === "select" ? "" : this.cursor === "grab" ? "" : this.cursor); return; }
    if (!down || this.readOnly) return;
    const core = this.core, mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === "Escape") { if (this.mode !== "none") this.cancel(); else { core.setSel([]); core.entered.clear(); core.setTool("select"); } return; }
    if (e.altKey && e.shiftKey && !mod) {
      const A: Record<string, AlignMode> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom", KeyH: "center", KeyV: "middle" };
      const m = A[e.code];
      if (m) { e.preventDefault(); core.align(m); return; }
      if (e.code === "KeyX") { e.preventDefault(); core.distribute("h"); return; }
      if (e.code === "KeyY") { e.preventDefault(); core.distribute("v"); return; }
      if (e.code === "KeyS") { e.preventDefault(); core.matchSize("both"); return; }
      return;
    }
    if (mod && e.altKey) {
      if (k === "c") { e.preventDefault(); this.styleKeyAt = performance.now(); core.copyStyle(); }
      else if (k === "v") { e.preventDefault(); this.styleKeyAt = performance.now(); core.pasteStyle(); }
      return;
    }
    // Enter edits the selected thing's text; typing a character does too (a shape, icon or note takes the text you type). Both are only
    // for a single selection in the select tool (Enter also renames a selected whole group), so a tool letter still works with nothing, or several things, selected.
    if (!mod && !e.altKey && this.tool === "select" && core.selection().size >= 1) {
      const onButton = t && (t.tagName === "BUTTON" || t.tagName === "SELECT" || t.tagName === "A");
      if (e.key === "Enter" && !e.shiftKey && !onButton) { if (core.editSelection()) { e.preventDefault(); return; } }
      else if (e.key.length === 1 && e.key !== " " && e.key !== "i" && e.key !== "I" && core.selection().size === 1) { // `i` is the properties panel key (ui/keys.ts): it never starts a label
        if (core.editSelection(e.key)) { e.preventDefault(); return; } }
    }
    if (mod) {
      if (k === "l" && e.shiftKey) { e.preventDefault(); core.toggleLock(); return; }
      if (k === "z") { e.preventDefault(); if (e.shiftKey) core.redo(); else core.undo(); }
      else if (k === "y") { e.preventDefault(); core.redo(); }
      else if (k === "g") { e.preventDefault(); if (e.shiftKey) core.ungroup(); else core.group(); }
      else if (k === "a") { e.preventDefault(); core.selectAll(); }
      else if (k === "d") { e.preventDefault(); core.duplicateSelection(); }
      else if (e.code === "BracketRight") { e.preventDefault(); if (e.shiftKey) core.bringToFront(); else core.bringForward(); }
      else if (e.code === "BracketLeft") { e.preventDefault(); if (e.shiftKey) core.sendToBack(); else core.sendBackward(); }
      else if (k === "0") { e.preventDefault(); core.resetView(); }
      return;
    }
    if (e.code === "Digit1" && e.shiftKey) { core.zoomToFit(); return; }
    if (k === "=" || k === "+") { core.zoomBy(1.25); return; }
    if (k === "-") { core.zoomBy(0.8); return; }
    const map: Record<string, Tool> = { v: "select", r: "rect", o: "ellipse", d: "diamond", a: "arrow", t: "text", h: "hand" };
    if (map[k] && !e.altKey) { core.setTool(map[k]!); return; }
    if (k === "q" && !e.altKey) { this.setToolLock(!this.toolLocked); return; }
    if (k === "delete" || k === "backspace") { e.preventDefault(); core.deleteSelection(); return; }
    const step = e.shiftKey ? 10 : 1;
    if (k === "arrowleft") { e.preventDefault(); core.nudge(-step, 0); }
    else if (k === "arrowright") { e.preventDefault(); core.nudge(step, 0); }
    else if (k === "arrowup") { e.preventDefault(); core.nudge(0, -step); }
    else if (k === "arrowdown") { e.preventDefault(); core.nudge(0, step); }
  }

  private clip(e: ClipboardEvent, kind: "copy" | "cut" | "paste"): void {
    if (this.readOnly) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const core = this.core;
    if (performance.now() - this.styleKeyAt < 80) return; // Ctrl+Alt+C / V are style commands, not clipboard ones
    if (kind === "paste") {
      const s = e.clipboardData?.getData("text/plain") ?? "";
      if (s.startsWith("archypaint:")) { e.preventDefault(); this.pasteN++; core.pasteText(s); }
      return;
    }
    const s = core.copyText();
    if (!s) return;
    e.preventDefault();
    try { e.clipboardData?.setData("text/plain", s); } catch { /* fail soft: internal copy still works */ }
    this.pasteN = 0;
    if (kind === "cut") core.cut();
  }
}

function bboxOf(pts: readonly number[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) { x0 = Math.min(x0, pts[i]!); x1 = Math.max(x1, pts[i]!); y0 = Math.min(y0, pts[i + 1]!); y1 = Math.max(y1, pts[i + 1]!); }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** brace dragged from (x0,y0) to (x1,y1): a mostly-horizontal drag makes a horizontal brace, otherwise vertical */
export function braceBox(x0: number, y0: number, x1: number, y1: number): { x: number; y: number; w: number; h: number; o: 0 | 1 | 2 | 3 } {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), depth = 28;
  const left = Math.min(x0, x1), top = Math.min(y0, y1);
  if (dx > dy * 1.4) return { x: left, y: y0 - depth / 2, w: Math.max(depth, dx), h: depth, o: 2 };
  return { x: x0 - depth / 2, y: top, w: depth, h: Math.max(depth, dy), o: 0 };
}
