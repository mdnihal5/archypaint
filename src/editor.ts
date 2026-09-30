import { alignBoxes, distributeBoxes, matchSizes, unionOf, type AlignMode, type Box, type Delta } from "./align";
import { bboxOfPts, computeArrowPts, rerouteBound, sceneRectOf } from "./connectors";
import { buildLegend, renumberBadges as renumberPlan } from "./edit-ops";
import type { EditorAPI, EditorEvent, StyleProps } from "./editor-api";
import { GroupIndex } from "./groups";
import { History } from "./history";
import { Controller, type Core, type Tool } from "./input";
import { Renderer } from "./renderer";
import { Scene, type El, type ElInit, type ElJSON, type GroupInfo, type SceneJSON } from "./scene";
import { braceVertical, NEW_KINDS } from "./shape-geom";
import { CATEGORIES, type Theme } from "./theme";
import { measureText, TextEditor } from "./text-edit";
import { Viewport } from "./viewport";

export interface EditorDeps { stage: HTMLElement; staticCanvas: HTMLCanvasElement; liveCanvas: HTMLCanvasElement; theme: Theme }
export type Editor = EditorAPI & {
  readonly renderer: Renderer;
  readonly theme: Theme;
  /** snap moved shapes to neighbours' edges and a 10-unit grid */
  snap: boolean;
  copy(): void;
  cut(): void;
  paste(text: string): boolean;
  nudge(dx: number, dy: number): void;
  readonly hist: History;
};

const EDGE_RADIUS = [0, 8, 18] as const;
const CLIP_PREFIX = "archypaint:";
const KINDS = new Set(["rect", "ellipse", "diamond", "text", "arrow", "icon", ...NEW_KINDS]);

export function createEditor(d: EditorDeps): Editor {
  const scene = new Scene();
  const vp = new Viewport();
  const renderer = new Renderer(scene, vp, d.theme, d.staticCanvas, d.liveCanvas);
  const hist = new History(scene);
  const groupIdx = new GroupIndex(scene);
  renderer.groups = groupIdx;
  const text = new TextEditor(d.stage, vp);
  const entered = new Set<string>();
  const subs = new Map<EditorEvent, Set<() => void>>();
  const defaults: StyleProps = { cat: 0, fill: 1, edge: 1, radius: 8, dash: 0, route: 1 };
  let savedRev = 0, gc = 0, pasteN = 0, destroyed = false;
  let styleClip: Partial<StyleProps> | null = null;

  const emit = (ev: EditorEvent) => { if (!destroyed) subs.get(ev)?.forEach((f) => f()); };
  const after = () => { renderer.invalidate(true, true); emit("change"); emit("history"); };

  /** run `fn` as one undo step (or join the caller's open transaction) */
  function run<T>(label: string, fn: () => T, key = ""): T {
    const own = !hist.active;
    if (own) hist.begin();
    try { return fn(); }
    finally {
      if (own) { hist.commit(label, key); after(); }
    }
  }

  const edgeRadius = (edge: number) => EDGE_RADIUS[edge] ?? 8;
  const sel = () => renderer.selected;

  function setSel(ids: Iterable<string>): void {
    const next = new Set<string>();
    for (const id of ids) if (scene.els.has(id)) next.add(id);
    if (next.size === renderer.selected.size && [...next].every((i) => renderer.selected.has(i))) return;
    renderer.selected.clear();
    for (const id of next) renderer.selected.add(id);
    renderer.invalidate(false, true);
    emit("selection");
  }

  function newEl(init: ElInit): El {
    const edge = init.edge ?? defaults.edge;
    const e = scene.add({ edge, radius: init.radius ?? edgeRadius(edge), fill: defaults.fill, cat: defaults.cat, dash: defaults.dash, route: defaults.route, ...init });
    hist.created(e);
    return e;
  }

  function applyArrow(e: El, pts: number[]): void {
    const b = bboxOfPts(pts);
    scene.set(e, b.x, b.y, b.w, b.h);
    e.pts = pts;
  }

  function rerouteIds(ids: ReadonlySet<string>): void {
    // ONE pass: arrows never bind to arrows, so nothing here can cascade or loop
    for (const r of rerouteBound(scene, ids)) {
      const e = scene.els.get(r.id);
      if (!e) continue;
      hist.touch(e);
      applyArrow(e, r.pts);
    }
  }

  /** clone snapshots into fresh elements (duplicate / paste); ends bound outside the set are detached */
  function cloneInto(list: readonly ElJSON[], groups: readonly GroupInfo[], dx: number, dy: number): string[] {
    const idMap = new Map<string, string>();
    for (const j of list) idMap.set(j.id, scene.newId());
    const gMap = new Map<string, string>();
    for (const j of list) for (const g of j.groupIds) if (!gMap.has(g)) gMap.set(g, `g${(++gc).toString(36)}${Math.random().toString(36).slice(2, 5)}`);
    for (const [old, nid] of gMap) {
      const info = groups.find((g) => g.id === old);
      hist.touchGroup(nid);
      scene.groups.set(nid, { id: nid, name: info?.name ?? "group", cat: info?.cat ?? 0, collapsed: false, locked: false });
    }
    const out: string[] = [];
    for (const j of [...list].sort((a, b) => a.z - b.z)) {
      const { id: _id, z: _z, version: _v, ...rest } = j;
      void _id; void _z; void _v;
      const e = scene.add({
        ...rest, x: j.x + dx, y: j.y + dy, groupIds: j.groupIds.map((g) => gMap.get(g)!),
        pts: j.pts.map((v, i) => (i % 2 ? v + dy : v + dx)),
        src: idMap.get(j.src) ?? "", dst: idMap.get(j.dst) ?? "",
      } as ElInit);
      // scene.add assigned its own id; re-key to the pre-allocated one so bindings match
      scene.els.delete(e.id);
      const want = idMap.get(j.id)!;
      e.id = want; scene.els.set(want, e);
      hist.created(e);
      out.push(want);
    }
    for (const id of out) {
      const e = scene.els.get(id)!;
      if (e.kind === "arrow" && (e.src || e.dst)) applyArrow(e, computeArrowPts(e, sceneRectOf(scene)));
    }
    return out;
  }

  function serialize(ids: Iterable<string>): { els: ElJSON[]; groups: GroupInfo[] } {
    const els: ElJSON[] = [], gs = new Map<string, GroupInfo>();
    for (const id of ids) {
      const e = scene.els.get(id);
      if (!e) continue;
      els.push(scene.snapshot(e));
      for (const g of e.groupIds) { const info = scene.groups.get(g); if (info) gs.set(g, { ...info }); }
    }
    return { els, groups: [...gs.values()] };
  }

  function pruneGroups(): void {
    for (const g of [...scene.groups.keys()]) {
      if (groupIdx.membersOf(g).length === 0) { hist.touchGroup(g); scene.groups.delete(g); }
    }
    scene.nonce++;
  }

  // ---- z-order -----------------------------------------------------------------------------

  function sortedAll(): El[] { return [...scene.els.values()].sort((a, b) => a.z - b.z); }
  function renumber(): void {
    let i = 0;
    for (const e of sortedAll()) { hist.touch(e); scene.patch(e, { z: ++i }); }
  }
  function reorder(mode: "front" | "back" | "forward" | "backward"): void {
    if (!sel().size) return;
    run(`z-order ${mode}`, () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const all = sortedAll();
        const S = all.filter((e) => sel().has(e.id));
        if (!S.length) return;
        const setS = new Set(S.map((e) => e.id));
        const box = scene.bounds(setS)!;
        const others: El[] = [];
        const scratch: El[] = [];
        scene.query(box.x, box.y, box.x + box.w, box.y + box.h, scratch);
        for (const e of scratch) if (!setS.has(e.id)) others.push(e);
        let zs: number[] | null = null;
        if (mode === "front") zs = S.map(() => scene.nextZ());
        else if (mode === "back") { const min = all[0]!.z; zs = S.map((_, i) => min - S.length + i); }
        else if (mode === "forward") {
          const maxS = S[S.length - 1]!.z;
          const above = others.filter((e) => e.z > maxS).sort((a, b) => a.z - b.z)[0];
          if (!above) return;
          const next = all.find((e) => e.z > above.z);
          const gap = next ? (next.z - above.z) / (S.length + 1) : 1;
          if (gap < 1e-6) { renumber(); continue; }
          zs = S.map((_, i) => above.z + gap * (i + 1));
        } else {
          const minS = S[0]!.z;
          const below = others.filter((e) => e.z < minS).sort((a, b) => b.z - a.z)[0];
          if (!below) return;
          let prev: El | undefined;
          for (const e of all) { if (e.z < below.z) prev = e; else break; }
          const gap = prev ? (below.z - prev.z) / (S.length + 1) : 1;
          if (gap < 1e-6) { renumber(); continue; }
          zs = S.map((_, i) => below.z - gap * (S.length - i));
        }
        S.forEach((e, i) => { hist.touch(e); scene.patch(e, { z: zs![i]! }); });
        return;
      }
    });
  }

  // ---- text --------------------------------------------------------------------------------

  const commitText = (el: El, value: string, isNew: boolean): void => {
    const v = value.replace(/\s+$/g, "");
    if (el.kind === "badge") {
      const n = Math.floor(Number(v.trim()));
      if (Number.isFinite(n) && n >= 0 && n <= 99999 && n !== el.n) run("edit badge", () => { hist.touch(el); scene.patch(el, { n }); });
      return;
    }
    if (el.kind === "lane") {
      const lines = v.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 24);
      if (!lines.length) return;
      run("edit lanes", () => { hist.touch(el); scene.patch(el, { text: lines.join("\n"), n: lines.length }); });
      return;
    }
    if (el.kind === "text" && v === "") { if (scene.els.has(el.id)) scene.remove(el); renderer.selected.delete(el.id); renderer.invalidate(true, true); emit("selection"); return; }
    run("edit text", () => {
      if (isNew) hist.created(el); else hist.touch(el);
      if (el.kind === "text") { const m = measureText(v); const cx = el.x + el.w / 2, cy = el.y + el.h / 2; scene.set(el, cx - m.w / 2, cy - m.h / 2, m.w, m.h); }
      scene.patch(el, { text: v });
    });
  };

  /** align/distribute act on "blocks": each selected element, except that a group counts as one box */
  function arrange(plan: (boxes: Box[]) => Map<string, Delta>, label: string, min: number): void {
    const blocks = new Map<string, El[]>();
    for (const id of sel()) {
      const e = scene.els.get(id);
      if (!e || e.kind === "arrow" || e.locked) continue;
      const key = e.groupIds.length ? e.groupIds[e.groupIds.length - 1]! : e.id;
      const a = blocks.get(key);
      if (a) a.push(e); else blocks.set(key, [e]);
    }
    if (blocks.size < min) return;
    const boxes: Box[] = [];
    for (const [key, els] of blocks) { const u = unionOf(els.map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h })))!; boxes.push({ id: key, ...u }); }
    const deltas = plan(boxes);
    if (!deltas.size) return;
    run(label, () => {
      const moved = new Set<string>();
      for (const [key, d] of deltas) for (const e of blocks.get(key)!) { hist.touch(e); scene.set(e, e.x + d.dx, e.y + d.dy); moved.add(e.id); }
      rerouteIds(moved); // one batched pass: bound arrows follow, nothing cascades
    });
  }

  const api: Editor = {
    scene, vp, renderer, theme: d.theme, hist, snap: true,
    get tool() { return ctl.tool; },
    setTool(t: Tool) { ctl.setTool(t); },
    selection: () => renderer.selected,
    select(ids) { setSel(ids); },
    clearSelection() { setSel([]); entered.clear(); },
    selectAll() { setSel(scene.els.keys()); },

    deleteSelection() {
      const doomed = [...sel()].filter((id) => !scene.els.get(id)?.locked);
      if (!doomed.length) return;
      run("delete", () => {
        const ids = new Set(doomed);
        for (const id of ids) {
          const e = scene.els.get(id);
          if (!e) continue;
          hist.touch(e);
          scene.remove(e);
        }
        // arrows still pointing at a deleted shape keep their geometry but lose the binding
        for (const a of scene.els.values()) {
          if (a.kind !== "arrow") continue;
          if (ids.has(a.src) || ids.has(a.dst)) { hist.touch(a); scene.patch(a, { src: ids.has(a.src) ? "" : a.src, dst: ids.has(a.dst) ? "" : a.dst }); }
        }
        for (const id of ids) renderer.selected.delete(id);
        pruneGroups();
      });
      emit("selection");
    },
    duplicateSelection() {
      if (!sel().size) return;
      run("duplicate", () => { setSel(core.duplicateIds([...sel()], 20, 20)); });
    },
    group(name) {
      const ids = [...sel()];
      if (ids.length < 2) return null;
      return run("group", () => {
        const gid = `g${(++gc).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        hist.touchGroup(gid);
        let cat = defaults.cat;
        for (const id of ids) {
          const e = scene.els.get(id)!;
          hist.touch(e); cat = e.cat;
          scene.patch(e, { groupIds: [...e.groupIds, gid] });
        }
        scene.groups.set(gid, { id: gid, name: name ?? `group ${scene.groups.size + 1}`, cat, collapsed: false, locked: false });
        scene.nonce++;
        return gid;
      });
    },
    ungroup() {
      const tops = new Set<string>();
      for (const id of sel()) { const e = scene.els.get(id); const g = e?.groupIds[e.groupIds.length - 1]; if (g) tops.add(g); }
      if (!tops.size) return;
      run("ungroup", () => {
        for (const g of tops) {
          for (const id of [...groupIdx.membersOf(g)]) {
            const e = scene.els.get(id);
            if (e) { hist.touch(e); scene.patch(e, { groupIds: e.groupIds.filter((x) => x !== g) }); }
          }
          hist.touchGroup(g); scene.groups.delete(g); entered.delete(g);
        }
        scene.nonce++;
      });
    },
    renameGroup(id, name) {
      const g = scene.groups.get(id);
      if (!g || g.name === name) return;
      run("rename group", () => { hist.touchGroup(id); g.name = name; scene.nonce++; });
    },
    bringToFront() { reorder("front"); }, bringForward() { reorder("forward"); },
    sendBackward() { reorder("backward"); }, sendToBack() { reorder("back"); },
    setStyle(p) {
      if (!sel().size) return;
      run("style", () => {
        for (const id of sel()) {
          const e = scene.els.get(id);
          if (!e) continue;
          hist.touch(e);
          const patch: Partial<El> = {};
          if (p.cat !== undefined) patch.cat = p.cat;
          if (p.fill !== undefined) patch.fill = p.fill;
          if (p.dash !== undefined) patch.dash = p.dash;
          if (p.route !== undefined) patch.route = p.route;
          if (p.edge !== undefined) { patch.edge = p.edge; if (e.kind !== "arrow") patch.radius = edgeRadius(p.edge); }
          if (p.radius !== undefined) patch.radius = p.radius;
          if (p.o !== undefined && e.kind === "brace") {
            if (braceVertical(e.o) !== braceVertical(p.o)) scene.set(e, e.x + e.w / 2 - e.h / 2, e.y + e.h / 2 - e.w / 2, e.h, e.w);
            patch.o = p.o;
          } else if (p.o !== undefined && e.kind === "lane") patch.o = p.o === 1 ? 1 : 0;
          scene.patch(e, patch);
          if (e.kind === "arrow" && (p.edge !== undefined || p.route !== undefined)) applyArrow(e, computeArrowPts(e, sceneRectOf(scene)));
        }
      });
    },
    defaults,
    setDefaults(p) { Object.assign(defaults, p); if (p.edge !== undefined && p.radius === undefined) defaults.radius = edgeRadius(p.edge); },

    placeIcon(iconId, at) {
      const cx = at?.x ?? vp.x + vp.w / vp.zoom / 2, cy = at?.y ?? vp.y + vp.h / vp.zoom / 2;
      return run("place icon", () => {
        const e = newEl({ kind: "icon", iconId, x: cx - 48, y: cy - 48, w: 96, h: 96 });
        setSel([e.id]);
        return e;
      });
    },

    align(mode: AlignMode) { arrange((b) => alignBoxes(b, mode), "align", 2); },
    distribute(axis) { arrange((b) => distributeBoxes(b, axis), "distribute", 3); },
    matchSize(dim) {
      const els: El[] = [];
      for (const id of sel()) { const e = scene.els.get(id); if (e && e.kind !== "arrow" && !e.locked && e.groupIds.length === 0) els.push(e); }
      const plan = matchSizes(els.map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h })), dim);
      if (!plan.size) return;
      run("match size", () => {
        for (const [id, sz] of plan) { const e = scene.els.get(id)!; hist.touch(e); scene.set(e, e.x, e.y, sz.w, sz.h); }
        rerouteIds(new Set(plan.keys()));
      });
    },
    setLocked(locked) {
      const els = [...sel()].map((id) => scene.els.get(id)).filter((e): e is El => !!e && e.locked !== locked);
      if (!els.length) return;
      run(locked ? "lock" : "unlock", () => { for (const e of els) { hist.touch(e); scene.patch(e, { locked }); } });
    },
    toggleLock() {
      let anyUnlocked = false;
      for (const id of sel()) if (scene.els.get(id)?.locked === false) { anyUnlocked = true; break; }
      api.setLocked(anyUnlocked);
    },
    copyStyle() {
      let e: El | undefined;
      for (const id of sel()) { const c = scene.els.get(id); if (c && (!e || (e.kind === "arrow" && c.kind !== "arrow"))) e = c; }
      if (!e) return false;
      styleClip = { cat: e.cat, fill: e.fill, edge: e.edge, dash: e.dash };
      if (e.kind !== "arrow") styleClip.radius = e.radius;
      return true;
    },
    pasteStyle() { if (styleClip && sel().size) api.setStyle({ ...styleClip }); },
    insertLegend() {
      const lg = [...sel()].map((id) => scene.els.get(id)).find((e) => e?.kind === "legend");
      const built = buildLegend(scene.els.values(), CATEGORIES);
      return run("legend", () => {
        if (lg) { hist.touch(lg); scene.set(lg, lg.x, lg.y, built.w, built.h); scene.patch(lg, { text: built.text }); setSel([lg.id]); return lg; }
        const z = vp.zoom, cx = vp.x + vp.w / z / 2, cy = vp.y + vp.h / z / 2;
        const e = newEl({ kind: "legend", x: cx - built.w / 2, y: cy - built.h / 2, w: built.w, h: built.h, text: built.text, cat: 6, fill: 1 });
        setSel([e.id]);
        return e;
      });
    },
    renumberBadges() {
      const plan = renumberPlan(scene.els.values());
      if (!plan.size) return;
      run("renumber badges", () => { for (const [id, n] of plan) { const e = scene.els.get(id)!; hist.touch(e); scene.patch(e, { n }); } });
    },

    panTo(x, y) {
      vp.x = x - vp.w / vp.zoom / 2; vp.y = y - vp.h / vp.zoom / 2; vp.version++;
      renderer.invalidate(true, true); emit("viewport");
    },
    focusOn(ids) {
      const b = scene.bounds(ids);
      if (!b) return;
      const z = Math.max(0.15, Math.min(1.6, Math.min(vp.w / (b.w + 200), vp.h / (b.h + 200))));
      vp.zoom = z; vp.x = b.x + b.w / 2 - vp.w / (2 * z); vp.y = b.y + b.h / 2 - vp.h / (2 * z); vp.version++;
      setSel(ids);
      renderer.invalidate(true, true); emit("viewport");
    },
    highlight(ids, current) {
      renderer.hi = ids; renderer.hiCur = current ?? "";
      renderer.invalidate(false, true);
    },

    undo() {
      if (text.isOpen) text.close(false);
      const ids = hist.undo();
      if (!ids) return;
      renderer.livePts.clear(); renderer.dragging.clear();
      setSel(ids); after(); emit("selection");
    },
    redo() {
      if (text.isOpen) text.close(false);
      const ids = hist.redo();
      if (!ids) return;
      renderer.livePts.clear(); renderer.dragging.clear();
      setSel(ids); after(); emit("selection");
    },
    canUndo: () => hist.canUndo(), canRedo: () => hist.canRedo(),

    zoomToFit() {
      const b = scene.bounds();
      if (!b) { api.resetView(); return; }
      const z = Math.max(0.05, Math.min(2, Math.min(vp.w / (b.w + 120), vp.h / (b.h + 120))));
      vp.zoom = z; vp.x = b.x + b.w / 2 - vp.w / (2 * z); vp.y = b.y + b.h / 2 - vp.h / (2 * z); vp.version++;
      renderer.invalidate(true, true); emit("viewport");
    },
    zoomBy(f) { vp.zoomAt(vp.w / 2, vp.h / 2, f); renderer.invalidate(true, true); emit("viewport"); },
    resetView() { vp.reset(); renderer.invalidate(true, true); emit("viewport"); },

    load(data: SceneJSON) {
      if (text.isOpen) text.close(false);
      scene.replaceAll(data);
      hist.clear(); renderer.selected.clear(); renderer.dragging.clear(); renderer.livePts.clear(); entered.clear();
      savedRev = hist.rev;
      renderer.invalidate(true, true); emit("selection"); emit("change"); emit("history");
    },
    dirty: () => hist.rev !== savedRev,
    markSaved() { savedRev = hist.rev; },

    on(ev, cb) { let s = subs.get(ev); if (!s) subs.set(ev, (s = new Set())); s.add(cb); return () => { s!.delete(cb); }; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ctl.destroy(); text.destroy(); renderer.destroy(); hist.clear(); subs.clear(); entered.clear();
    },

    copy() { const s = core.copyText(); if (s && navigator.clipboard?.writeText) navigator.clipboard.writeText(s).catch(() => {}); },
    cut() { core.cut(); },
    paste(t) { return core.pasteText(t); },
    nudge(dx, dy) { core.nudge(dx, dy); },
  };

  const core: Core = Object.assign(api, {
    groupIdx, entered,
    setSel, unitIds: (e: El) => groupIdx.unit(e, entered), newEl, rerouteIds, applyArrow, emit, edgeRadius,
    duplicateIds(ids: readonly string[], dx: number, dy: number): string[] {
      const { els, groups } = serialize(ids);
      return cloneInto(els, groups, dx, dy);
    },
    editText(e: El) {
      if (e.locked) return;
      renderer.hideText = e.id; renderer.invalidate(true, false);
      text.open(e, (el, v) => commitText(el, v, false), () => { renderer.hideText = ""; renderer.invalidate(true, false); }, e.kind === "badge" ? String(e.n) : undefined);
    },
    toBack(e: El) {
      let min = Infinity;
      for (const o of scene.els.values()) if (o !== e && o.z < min) min = o.z;
      scene.patch(e, { z: (min === Infinity ? e.z : min) - 1 });
    },
    createTextAt(x: number, y: number) {
      const m = measureText(" ");
      const e = scene.add({ kind: "text", x: x - m.w / 2, y: y - m.h / 2, w: m.w, h: m.h, cat: 6, fill: 0, radius: 0, text: "" });
      renderer.hideText = e.id;
      text.open(e, (el, v) => commitText(el, v, true), (committed) => {
        renderer.hideText = "";
        if (!committed && scene.els.has(e.id) && !e.text) { scene.remove(e); }
        renderer.invalidate(true, true);
      });
    },
    nudge(dx: number, dy: number) {
      if (!sel().size) return;
      run("nudge", () => {
        const ids = new Set(sel());
        for (const id of ids) {
          const e = scene.els.get(id);
          if (!e || e.locked) continue;
          hist.touch(e);
          if (e.kind === "arrow") applyArrow(e, e.pts.map((v, i) => (i % 2 ? v + dy : v + dx)));
          else scene.set(e, e.x + dx, e.y + dy);
        }
        rerouteIds(ids);
      }, "nudge");
    },
    copyText(): string | null {
      if (!sel().size) return null;
      const { els, groups } = serialize(sel());
      pasteN = 0;
      return CLIP_PREFIX + JSON.stringify({ els, groups });
    },
    pasteText(s: string): boolean {
      let data: { els: ElJSON[]; groups: GroupInfo[] };
      try { data = JSON.parse(s.startsWith(CLIP_PREFIX) ? s.slice(CLIP_PREFIX.length) : s); } catch { return false; }
      if (!data || !Array.isArray(data.els) || data.els.length === 0 || data.els.length > 5000) return false;
      const els = data.els.filter((j) => j && KINDS.has(j.kind) && typeof j.x === "number" && typeof j.y === "number" && typeof j.w === "number" && typeof j.h === "number");
      if (!els.length) return false;
      pasteN++;
      run("paste", () => { setSel(cloneInto(els.map(sanitize), Array.isArray(data.groups) ? data.groups : [], 20 * pasteN, 20 * pasteN)); });
      return true;
    },
    cut() { if (!sel().size) return; api.deleteSelection(); },
  });

  const ctl = new Controller(d.stage, core);
  ctl.onTool = () => emit("tool");
  // keep the text overlay glued to its element while panning/zooming
  api.on("viewport", () => text.place());
  return api;
}

/** pasted data comes from outside: coerce every field to a safe value before it enters the scene */
function sanitize(j: ElJSON): ElJSON {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 2000) : "");
  return {
    ...j, x: num(j.x, 0), y: num(j.y, 0), w: Math.max(1, num(j.w, 100)), h: Math.max(1, num(j.h, 60)),
    cat: Math.max(0, Math.min(7, Math.floor(num(j.cat, 0)))), fill: ([0, 1, 2].includes(j.fill) ? j.fill : 1) as 0 | 1 | 2,
    edge: ([0, 1, 2].includes(j.edge) ? j.edge : 1) as 0 | 1 | 2, radius: Math.max(0, num(j.radius, 8)), text: str(j.text), iconId: str(j.iconId),
    groupIds: Array.isArray(j.groupIds) ? j.groupIds.filter((g) => typeof g === "string") : [],
    pts: Array.isArray(j.pts) ? j.pts.filter((v) => typeof v === "number" && Number.isFinite(v)).slice(0, 64) : [],
    n: Math.max(0, Math.min(99999, Math.floor(num(j.n, 0)))), o: ([0, 1, 2, 3].includes(j.o) ? j.o : 0) as 0 | 1 | 2 | 3,
    src: str(j.src), dst: str(j.dst), locked: !!j.locked, dash: (j.dash === 1 ? 1 : 0) as 0 | 1,
    route: ([0, 1, 2].includes(j.route) ? j.route : 1) as 0 | 1 | 2, head: ([0, 1, 2].includes(j.head) ? j.head : 1) as 0 | 1 | 2,
    sp: ([-1, 0, 1, 2, 3].includes(j.sp) ? j.sp : -1) as -1 | 0 | 1 | 2 | 3, dp: ([-1, 0, 1, 2, 3].includes(j.dp) ? j.dp : -1) as -1 | 0 | 1 | 2 | 3,
  };
}
