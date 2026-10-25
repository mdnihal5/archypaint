import { alignBoxes, distributeBoxes, matchSizes, unionOf, type AlignMode, type Box, type Delta } from "./align";
import { MAX_LABEL_TEXT, MAX_LABELS, cleanSegs, arrowLabels, bboxOfPts, cleanLabels, computeArrowPts, isCurve, migrateArrowText, pointAtT, rerouteBound, sceneRectOf } from "./connectors";
import { calcSize, ensureCalc, onCalcReady, SAMPLE as CALC_SAMPLE } from "./calc-view";
import { buildLegend, renumberBadges as renumberPlan } from "./edit-ops";
import type { EditorAPI, EditorEvent, StyleProps } from "./editor-api";
import { GroupIndex } from "./groups";
import { History } from "./history";
import { Controller, type Core, type Tool } from "./input";
import { Renderer } from "./renderer";
import { Scene, isPort, type ArrowLabel, type El, type ElInit, type ElJSON, type GroupInfo, type Port, type SceneJSON } from "./scene";
import { braceVertical, NEW_KINDS } from "./shape-geom";
import { COLOUR_NAMES, normHex, type Theme } from "./theme";
import { installImageInput } from "./images-input";
import { iconStrip } from "./icons";
import { logoBox } from "./icon-pack";
import { minLabelHeight } from "./wrap";
import { isLogoId } from "./logos";
import { measureText, TextEditor, textWidth, type EditAnchor, type EditTarget } from "./text-edit";

/** an icon placed from the palette: a tile this many world units square (label strip included) */
const ICON_SIZE = 48; // placed icons: about two thirds of the old 72
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
/** kinds with no inline text editor at all / kinds that cannot be started by just typing (they have structured text or numbers) */
const NO_EDIT = new Set(["brace", "legend"]);
const NO_TYPE = new Set(["badge", "calc", "lane", "frame", "image"]);
const KINDS = new Set(["rect", "ellipse", "diamond", "text", "arrow", "icon", "calc", "image", ...NEW_KINDS]);

export function createEditor(d: EditorDeps): Editor {
  const scene = new Scene();
  const vp = new Viewport();
  const renderer = new Renderer(scene, vp, d.theme, d.staticCanvas, d.liveCanvas);
  const hist = new History(scene);
  const groupIdx = new GroupIndex(scene);
  renderer.groups = groupIdx;
  scene.groupRect = (id) => groupIdx.bounds(id); // connectors bind to a group's padded boundary like to a shape
  const text = new TextEditor(d.stage, vp);
  const entered = new Set<string>();
  const subs = new Map<EditorEvent, Set<() => void>>();
  const notices = new Set<(m: { level: "info" | "warn" | "error"; text: string }) => void>();
  const defaults: StyleProps = { cat: 0, fill: 0, edge: 1, radius: 8, dash: 0, route: 1 }; // outline fill, round edges
  let savedRev = 0, gc = 0, pasteN = 0, destroyed = false, readOnly = false;
  let styleClip: Partial<StyleProps> | null = null;

  const emit = (ev: EditorEvent) => { if (!destroyed) subs.get(ev)?.forEach((f) => f()); };
  const after = () => { renderer.invalidate(true, true); emit("change"); emit("history"); };

  /** run `fn` as one undo step (or join the caller's open transaction) */
  function run<T>(label: string, fn: () => T, key = ""): T {
    if (readOnly) return undefined as T; // view-only: nothing may change the document
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
        src: idMap.get(j.src) ?? gMap.get(j.src) ?? "", dst: idMap.get(j.dst) ?? gMap.get(j.dst) ?? "", // an end bound to a duplicated group follows the copy
        labels: j.labels?.map((l) => ({ ...l })), segs: j.segs ? [...j.segs] : undefined,
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

  /** connectors bound to a group that no longer exists keep their geometry but lose the binding */
  function detachFromGroups(gone: ReadonlySet<string>): void {
    if (!gone.size) return;
    for (const a of scene.els.values()) {
      if (a.kind !== "arrow" || !(gone.has(a.src) || gone.has(a.dst))) continue;
      hist.touch(a); scene.patch(a, { src: gone.has(a.src) ? "" : a.src, dst: gone.has(a.dst) ? "" : a.dst });
    }
  }

  /**
   * adds to `ids` every unlocked connector bound to something being deleted: a shape, a group losing all its members, or
   * another connector (a branch off a deleted line), to a fixpoint. The removal goes through hist.touch, so undo brings
   * every connector back with its bindings, labels and segments as they were.
   */
  function withEdges(ids: Set<string>): void {
    for (let grew = true; grew;) {
      grew = false;
      const goneGroups = new Set<string>();
      if (scene.groups.size) {
        for (const id of ids) for (const g of scene.els.get(id)?.groupIds ?? []) {
          if (!goneGroups.has(g) && groupIdx.membersOf(g).every((m) => ids.has(m))) goneGroups.add(g);
        }
      }
      for (const a of scene.els.values()) {
        if (a.kind !== "arrow" || ids.has(a.id) || scene.isLocked(a)) continue;
        if (ids.has(a.src) || ids.has(a.dst) || goneGroups.has(a.src) || goneGroups.has(a.dst)) { ids.add(a.id); grew = true; }
      }
    }
  }

  function pruneGroups(): void {
    const gone = new Set<string>();
    for (const g of [...scene.groups.keys()]) {
      if (groupIdx.membersOf(g).length === 0) { hist.touchGroup(g); scene.groups.delete(g); gone.add(g); }
    }
    detachFromGroups(gone);
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
    let v = value.replace(/\s+$/g, "");
    if (el.kind === "badge") {
      const n = Math.floor(Number(v.trim()));
      if (Number.isFinite(n) && n >= 0 && n <= 99999 && n !== el.n) run("edit badge", () => { hist.touch(el); scene.patch(el, { n }); });
      return;
    }
    if (el.kind === "calc") {
      if (v === el.text) return; // a repeat commit (blur after Enter, focus loss) must not add an empty undo step
      const s = calcSize(v); // the note grows and shrinks with its lines; results recompute lazily, once per version
      run("edit calculation", () => { hist.touch(el); scene.set(el, el.x, el.y, s.w, s.h); scene.patch(el, { text: v }); });
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
      if (el.kind === "text") { const m = measureText(v, el.fs); const cx = el.x + el.w / 2, cy = el.y + el.h / 2; scene.set(el, cx - m.w / 2, cy - m.h / 2, m.w, m.h); }
      if (el.kind === "icon") {
        // the name lives in a strip under the tile: the box grows by the strip when a name appears and shrinks when it goes, so the tile never changes size
        v = v.replace(/\s*\n\s*/g, " ");
        if ((el.text !== "") !== (v !== "")) scene.set(el, el.x, el.y, el.w, iconBoxH(el, el.fs, el.fs, v !== ""));
        scene.patch(el, { text: v });
        rerouteIds(new Set([el.id])); // a bound connector follows the new box
        return;
      }
      scene.patch(el, { text: v });
      growToFit(el);
    });
  };

  /**
   * A shape whose wrapped label is taller than the shape can hold (with its padding) grows taller to fit it, the way a container does in Excalidraw.
   * Height only: the width is the user's, and the wrap follows it. Callers run inside a transaction and have touched `el`. Never shrinks.
   */
  function growToFit(el: El): void {
    const need = minLabelHeight(el, () => (t) => textWidth(t, el.fs || 0));
    if (need > el.h + 0.5) { scene.set(el, el.x, el.y, el.w, need); rerouteIds(new Set([el.id])); }
  }

  /** height of an icon's box for a label state: the tile (unchanged) plus the strip when it has a name */
  function iconBoxH(el: El, oldFs: number | undefined, newFs: number | undefined, hasLabel: boolean): number {
    const tile = Math.max(4, Math.min(el.w, el.h - (el.text !== "" ? iconStrip(oldFs) : 0)));
    return tile + (hasLabel ? iconStrip(newFs) : 0);
  }

  const openText = (target: EditTarget, onDone: (v: string) => void, onClosed?: () => void, initial?: string, anchor?: () => EditAnchor, caretEnd = false): void => {
    text.open(target, (_t, v) => onDone(v), () => { onClosed?.(); emit("edit"); }, initial, anchor, caretEnd);
    emit("edit");
  };

  /** the overlay for an icon's name: under its tile, one line */
  const iconAnchor = (e: El) => (): EditAnchor => ({ cx: e.x + e.w / 2, cy: e.text ? e.y + e.h - iconStrip(e.fs) / 2 : e.y + e.h + iconStrip(e.fs) / 2, w: Math.max(e.w + 16, 80), fs: e.fs || 12, fit: true, single: true });

  // ---- connector labels --------------------------------------------------------------------

  /** a mutable copy of an arrow's labels (a legacy centred `text` becomes the first one) */
  const labelsOf = (a: El): ArrowLabel[] => arrowLabels(a).map((l) => ({ t: l.t, text: l.text }));

  function commitLabel(id: string, idx: number, t: number, value: string): void {
    const a = scene.els.get(id);
    if (!a || a.kind !== "arrow") return;
    const v = value.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_TEXT);
    const ls = labelsOf(a), cur = idx >= 0 ? ls[idx] : undefined;
    if (cur ? cur.text === v && a.text === "" : v === "") return; // nothing changed: no empty undo step
    if (cur) { if (v === "") ls.splice(idx, 1); else cur.text = v; }
    else if (ls.length < MAX_LABELS) ls.push({ t, text: v });
    run(cur && v === "" ? "remove label" : "edit label", () => { hist.touch(a); scene.patch(a, { labels: ls.length ? ls : undefined, text: "" }); });
  }

  /** open the label editor for label `idx` of arrow `a`, or (idx < 0) a new label at `t` */
  function editLabel(a: El, idx: number, t: number, seed?: string): void {
    if (scene.isLocked(a) || readOnly || a.kind !== "arrow") return;
    const cur = idx >= 0 ? arrowLabels(a)[idx] : undefined;
    const at = cur ? cur.t : Math.max(0, Math.min(1, t));
    const out: [number, number] = [0, 0];
    // a typed character opens the editor with it appended to the label (like a shape's label), caret at the end
    openText(a, (v) => commitLabel(a.id, cur ? idx : -1, at, v), undefined, (cur?.text ?? "") + (seed ?? ""), () => {
      pointAtT(a.pts, isCurve(a), at, out);
      return { cx: out[0], cy: out[1], w: 60, fs: a.fs || 13, fit: true, single: true };
    }, seed !== undefined);
  }

  // ---- group names -------------------------------------------------------------------------

  function editGroupName(gid: string): void {
    const g = scene.groups.get(gid), tag = groupIdx.tagBox(gid);
    if (!g || !tag || readOnly || g.locked) return;
    const stand: EditTarget = { x: tag.x, y: tag.y, w: tag.w, h: tag.h, kind: "text", text: g.name, fs: undefined, align: undefined };
    openText(stand, (v) => api.renameGroup(gid, v.replace(/\s+/g, " ").trim().slice(0, 40)), undefined, g.name, () => {
      const b = groupIdx.bounds(gid), cur = scene.groups.get(gid);
      // the tag sits above the group's top-left corner (the label is drawn there); the overlay is centred on where the text would be
      const w = Math.max(48, textWidth(cur?.name ?? "") + 8);
      return b ? { cx: b.x + 12 + w / 2 - 4, cy: b.y - 8 - 8, w: 60, fs: 13, fit: true, single: true } : { cx: stand.x, cy: stand.y, w: 60, fs: 13, fit: true, single: true };
    });
  }

  /** align/distribute act on "blocks": each selected element, except that a group counts as one box */
  function arrange(plan: (boxes: Box[]) => Map<string, Delta>, label: string, min: number): void {
    const blocks = new Map<string, El[]>();
    for (const id of sel()) {
      const e = scene.els.get(id);
      if (!e || e.kind === "arrow" || scene.isLocked(e)) continue;
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
    get readOnly() { return readOnly; },
    get hideIcons() { return renderer.hideIcons; },
    setHideIcons(on: boolean) { if (renderer.hideIcons === on) return; renderer.hideIcons = on; renderer.invalidate(true, true); },
    setReadOnly(on: boolean) {
      if (on === readOnly) return;
      readOnly = on; ctl.readOnly = on;
      if (on) { if (text.isOpen) text.close(false); setSel([]); entered.clear(); ctl.setTool("select"); }
      emit("tool");
    },
    get toolLocked() { return ctl.toolLocked; },
    setToolLock(on: boolean) { ctl.setToolLock(on); },
    get editing() { return text.isOpen; },
    editSelection(seed) {
      if (readOnly) return false;
      if (sel().size > 1) { // a whole group selected: Enter renames it
        if (seed !== undefined) return false;
        const first = scene.els.get([...sel()][0]!), gid = first?.groupIds[first.groupIds.length - 1];
        const members = gid ? groupIdx.membersOf(gid) : [];
        if (gid === undefined || members.length !== sel().size || !members.every((m) => sel().has(m))) return false;
        editGroupName(gid);
        return true;
      }
      if (sel().size !== 1) return false;
      const e = scene.els.get([...sel()][0]!);
      if (!e || scene.isLocked(e) || NO_EDIT.has(e.kind) || (seed !== undefined && NO_TYPE.has(e.kind))) return false;
      core.editText(e, seed);
      return true;
    },
    editGroupName, editLabel,
    selection: () => renderer.selected,
    select(ids) { setSel(ids); },
    clearSelection() { setSel([]); entered.clear(); },
    selectAll() { setSel(scene.els.keys()); },

    deleteSelection() {
      const doomed = [...sel()].filter((id) => { const e = scene.els.get(id); return !e || !scene.isLocked(e); });
      if (!doomed.length) return;
      run("delete", () => {
        const ids = new Set(doomed);
        withEdges(ids);
        const lostGroups = new Set<string>();
        if (scene.groups.size) for (const id of ids) for (const g of scene.els.get(id)?.groupIds ?? []) lostGroups.add(g);
        for (const id of ids) {
          const e = scene.els.get(id);
          if (!e) continue;
          hist.touch(e);
          scene.remove(e);
        }
        // only locked arrows can still point at a deleted shape: they keep their geometry but lose the binding
        for (const a of scene.els.values()) {
          if (a.kind !== "arrow") continue;
          if (ids.has(a.src) || ids.has(a.dst)) { hist.touch(a); scene.patch(a, { src: ids.has(a.src) ? "" : a.src, dst: ids.has(a.dst) ? "" : a.dst }); }
        }
        for (const id of ids) renderer.selected.delete(id);
        pruneGroups();
        // a connector bound to a group that lost members re-fits the smaller boundary
        const shrunk = new Set<string>();
        for (const g of lostGroups) if (scene.groups.has(g)) shrunk.add(g);
        if (shrunk.size) rerouteIds(shrunk);
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
      for (const id of ids) { const m = scene.els.get(id); if (m && scene.groupLocked(m)) return null; } // a locked group's membership is frozen
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
      for (const g of tops) if (scene.groups.get(g)?.locked) return; // unlock first
      run("ungroup", () => {
        for (const g of tops) {
          for (const id of [...groupIdx.membersOf(g)]) {
            const e = scene.els.get(id);
            if (e) { hist.touch(e); scene.patch(e, { groupIds: e.groupIds.filter((x) => x !== g) }); }
          }
          hist.touchGroup(g); scene.groups.delete(g); entered.delete(g);
        }
        detachFromGroups(tops);
        scene.nonce++;
      });
    },
    renameGroup(id, name) {
      const g = scene.groups.get(id);
      if (!g || g.name === name || g.locked) return;
      run("rename group", () => { hist.touchGroup(id); g.name = name; scene.nonce++; });
    },
    bringToFront() { reorder("front"); }, bringForward() { reorder("forward"); },
    sendBackward() { reorder("backward"); }, sendToBack() { reorder("back"); },
    setStyle(p) {
      if (!sel().size) return;
      run("style", () => {
        for (const id of sel()) {
          const e = scene.els.get(id);
          if (!e || scene.groupLocked(e)) continue;
          hist.touch(e);
          const patch: Partial<El> = {};
          if (p.cat !== undefined) patch.cat = p.cat;
          if (p.hex !== undefined) patch.hex = normHex(p.hex) || undefined;
          if (p.fill !== undefined) patch.fill = p.fill;
          if (p.dash !== undefined) patch.dash = p.dash;
          if (p.route !== undefined) { patch.route = p.route; if (p.route !== e.route) patch.segs = undefined; } // a manual elbow shape belongs to the elbow route
          if (p.edge !== undefined) { patch.edge = p.edge; if (e.kind !== "arrow") patch.radius = edgeRadius(p.edge); }
          if (p.radius !== undefined) patch.radius = p.radius;
          if (p.align !== undefined) patch.align = p.align === "center" ? undefined : p.align;
          if (p.fs !== undefined) patch.fs = p.fs > 0 ? Math.max(6, Math.min(96, Math.round(p.fs))) : undefined;
          if (p.o !== undefined && e.kind === "brace") {
            if (braceVertical(e.o) !== braceVertical(p.o)) scene.set(e, e.x + e.w / 2 - e.h / 2, e.y + e.h / 2 - e.w / 2, e.h, e.w);
            patch.o = p.o;
          } else if (p.o !== undefined && e.kind === "lane") patch.o = p.o === 1 ? 1 : 0;
          const oldFs = e.fs;
          scene.patch(e, patch);
          if (p.fs !== undefined && e.text) {
            if (e.kind === "text") { const m = measureText(e.text, e.fs); const cx = e.x + e.w / 2, cy = e.y + e.h / 2; scene.set(e, cx - m.w / 2, cy - m.h / 2, m.w, m.h); }
            else if (e.kind === "icon") { scene.set(e, e.x, e.y, e.w, iconBoxH(e, oldFs, e.fs, true)); rerouteIds(new Set([e.id])); }
            else growToFit(e); // a bigger text size may need a taller shape
          }
          if (e.kind === "arrow" && (p.edge !== undefined || p.route !== undefined)) applyArrow(e, computeArrowPts(e, sceneRectOf(scene)));
        }
      });
    },
    defaults,
    setDefaults(p) { Object.assign(defaults, p); if (p.edge !== undefined && p.radius === undefined) defaults.radius = edgeRadius(p.edge); },

    async insertImage(blob, at) {
      const m = await import("./images"); // heavy: sanitiser, codec, store, cache — only when an image is actually inserted
      if (destroyed) throw new Error("The editor was closed.");
      const p = await m.prepareImage(blob);
      if (destroyed) throw new Error("The editor was closed.");
      const sz = m.fitInsertSize(p.w, p.h);
      const cx = at?.x ?? vp.x + vp.w / vp.zoom / 2, cy = at?.y ?? vp.y + vp.h / vp.zoom / 2;
      return run("insert image", () => {
        const e = newEl({ kind: "image", img: p.key, x: cx - sz.w / 2, y: cy - sz.h / 2, w: sz.w, h: sz.h, fill: 0 });
        setSel([e.id]);
        return e;
      });
    },
    notice(level, text) { for (const f of [...notices]) f({ level, text }); },
    onNotice(cb) { notices.add(cb); return () => { notices.delete(cb); }; },

    placeIcon(iconId, at) {
      const cx = at?.x ?? vp.x + vp.w / vp.zoom / 2, cy = at?.y ?? vp.y + vp.h / vp.zoom / 2;
      return run("place icon", () => {
        // a brand logo is placed bare (no tile); a wordmark gets a box as wide as its aspect asks, so it is legible rather than a thin line in a square
        const logo = isLogoId(iconId), vb = logo ? logoBox(iconId) : null;
        const w = vb && vb[2]! / vb[3]! > 1.35 ? Math.round(ICON_SIZE * Math.min(2.4, (vb[2]! / vb[3]!) * 0.85)) : ICON_SIZE;
        const e = newEl({ kind: "icon", iconId, x: cx - w / 2, y: cy - ICON_SIZE / 2, w, h: ICON_SIZE, ...(logo ? { fill: 3 as const } : {}) });
        setSel([e.id]);
        return e;
      });
    },

    align(mode: AlignMode) { arrange((b) => alignBoxes(b, mode), "align", 2); },
    distribute(axis) { arrange((b) => distributeBoxes(b, axis), "distribute", 3); },
    matchSize(dim) {
      const els: El[] = [];
      for (const id of sel()) { const e = scene.els.get(id); if (e && e.kind !== "arrow" && !scene.isLocked(e) && e.groupIds.length === 0) els.push(e); }
      const plan = matchSizes(els.map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h })), dim);
      if (!plan.size) return;
      run("match size", () => {
        for (const [id, sz] of plan) { const e = scene.els.get(id)!; hist.touch(e); scene.set(e, e.x, e.y, sz.w, sz.h); }
        rerouteIds(new Set(plan.keys()));
      });
    },
    selectedGroup() {
      if (sel().size < 2) return null; // a lone member is an element, not "a group selected"
      const first = scene.els.get([...sel()][0]!);
      if (!first) return null;
      for (let i = first.groupIds.length - 1; i >= 0; i--) {
        const gid = first.groupIds[i]!, m = groupIdx.membersOf(gid);
        if (m.length === sel().size && m.every((id) => sel().has(id))) return gid;
      }
      return null;
    },
    setGroupLocked(id, locked) {
      const g = scene.groups.get(id);
      if (!g || g.locked === locked) return;
      run(locked ? "lock group" : "unlock group", () => { hist.touchGroup(id); g.locked = locked; scene.nonce++; });
    },
    setLocked(locked) {
      const gid = api.selectedGroup();
      if (gid !== null) { api.setGroupLocked(gid, locked); return; } // a whole group selected: the lock is the group's
      const els = [...sel()].map((id) => scene.els.get(id)).filter((e): e is El => !!e && e.locked !== locked);
      if (!els.length) return;
      run(locked ? "lock" : "unlock", () => { for (const e of els) { hist.touch(e); scene.patch(e, { locked }); } });
    },
    toggleLock() {
      const gid = api.selectedGroup();
      if (gid !== null) { api.setGroupLocked(gid, !scene.groups.get(gid)!.locked); return; }
      let anyUnlocked = false;
      for (const id of sel()) if (scene.els.get(id)?.locked === false) { anyUnlocked = true; break; }
      api.setLocked(anyUnlocked);
    },
    copyStyle() {
      let e: El | undefined;
      for (const id of sel()) { const c = scene.els.get(id); if (c && (!e || (e.kind === "arrow" && c.kind !== "arrow"))) e = c; }
      if (!e) return false;
      styleClip = { cat: e.cat, hex: e.hex ?? "", fill: e.fill, edge: e.edge, dash: e.dash, fs: e.fs ?? 0, align: e.align ?? "center" };
      if (e.kind !== "arrow") styleClip.radius = e.radius;
      return true;
    },
    pasteStyle() { if (styleClip && sel().size) api.setStyle({ ...styleClip }); },
    insertLegend() {
      const lg = [...sel()].map((id) => scene.els.get(id)).find((e) => e?.kind === "legend");
      const built = buildLegend(scene.els.values(), COLOUR_NAMES);
      return run("legend", () => {
        if (lg) { hist.touch(lg); scene.set(lg, lg.x, lg.y, built.w, built.h); scene.patch(lg, { text: built.text }); setSel([lg.id]); return lg; }
        const z = vp.zoom, cx = vp.x + vp.w / z / 2, cy = vp.y + vp.h / z / 2;
        const e = newEl({ kind: "legend", x: cx - built.w / 2, y: cy - built.h / 2, w: built.w, h: built.h, text: built.text, cat: 6, fill: 1 });
        setSel([e.id]);
        return e;
      });
    },
    insertCalc(text = CALC_SAMPLE) {
      void ensureCalc().catch(() => {}); // start loading the evaluator now so the first draw already has results
      const s = calcSize(text), z = vp.zoom, cx = vp.x + vp.w / z / 2, cy = vp.y + vp.h / z / 2;
      return run("capacity note", () => {
        const e = newEl({ kind: "calc", x: Math.round(cx - s.w / 2), y: Math.round(cy - s.h / 2), w: s.w, h: s.h, text, cat: 7, fill: 1 });
        setSel([e.id]);
        return e;
      });
    },
    applyPositions(pos, label = "arrange") {
      const moved = new Set<string>();
      run(label, () => {
        for (const [id, p] of pos) {
          const e = scene.els.get(id);
          if (!e || scene.isLocked(e) || e.kind === "arrow" || !Number.isFinite(p.x) || !Number.isFinite(p.y) || (e.x === p.x && e.y === p.y)) continue;
          hist.touch(e); scene.set(e, p.x, p.y); moved.add(id);
        }
        rerouteIds(moved); // one batched pass: bound arrows follow, nothing cascades
      });
    },
    async tidy(scope) {
      const sc = scope ?? (renderer.selected.size >= 2 ? "selection" : "all");
      const { runTidy } = await import("./tidy");
      if (destroyed) return 0;
      const r = runTidy(api, sc);
      if (r.moved && sc === "all") api.zoomToFit();
      return r.moved;
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
      if (readOnly) return;
      if (text.isOpen) text.close(false);
      const ids = hist.undo();
      if (!ids) return;
      renderer.livePts.clear(); renderer.dragging.clear();
      setSel(ids.length ? ids : [...sel()]); // a group-only step (rename, lock) touches no element: keep the selection (setSel drops ids that no longer exist)
      after(); emit("selection");
    },
    redo() {
      if (readOnly) return;
      if (text.isOpen) text.close(false);
      const ids = hist.redo();
      if (!ids) return;
      renderer.livePts.clear(); renderer.dragging.clear();
      setSel(ids.length ? ids : [...sel()]); // a group-only step (rename, lock) touches no element: keep the selection (setSel drops ids that no longer exist)
      after(); emit("selection");
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
      offCalc(); offImages(); ctl.destroy(); text.destroy(); renderer.destroy(); hist.clear(); subs.clear(); entered.clear(); notices.clear();
    },

    copy() { const s = core.copyText(); if (s && navigator.clipboard?.writeText) navigator.clipboard.writeText(s).catch(() => {}); },
    cut() { core.cut(); },
    paste(t) { return core.pasteText(t); },
    importElements(data, fit = true) {
      const els = (Array.isArray(data?.els) ? data.els : []).filter((j) => j && KINDS.has(j.kind) && typeof j.x === "number" && typeof j.y === "number" && typeof j.w === "number" && typeof j.h === "number").slice(0, 10_000);
      if (!els.length) return [];
      let ids: string[] = [];
      run("import", () => { ids = cloneInto(els.map(sanitize), Array.isArray(data.groups) ? data.groups : [], 0, 0); setSel(ids); });
      if (fit) api.focusOn(ids);
      return ids;
    },
    nudge(dx, dy) { core.nudge(dx, dy); },
  };

  const core: Core = Object.assign(api, {
    groupIdx, entered,
    setSel, unitIds: (e: El) => groupIdx.unit(e, entered), newEl, rerouteIds, applyArrow, emit, edgeRadius,
    duplicateIds(ids: readonly string[], dx: number, dy: number): string[] {
      const { els, groups } = serialize(ids);
      return cloneInto(els, groups, dx, dy);
    },
    editText(e: El, seed?: string) {
      if (scene.isLocked(e) || readOnly) return;
      if (e.kind === "arrow") { const ls = arrowLabels(e); editLabel(e, ls.length ? 0 : -1, 0.5, seed); return; }
      renderer.hideText = e.id; renderer.invalidate(true, false);
      const initial = e.kind === "badge" ? String(e.n) : seed !== undefined ? e.text + seed : undefined;
      openText(e, (v) => commitText(e, v, false), () => { renderer.hideText = ""; renderer.invalidate(true, false); }, initial, e.kind === "icon" ? iconAnchor(e) : undefined, seed !== undefined);
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
      openText(e, (v) => commitText(e, v, true), () => {
        renderer.hideText = "";
        if (scene.els.has(e.id) && !e.text) { scene.remove(e); }
        renderer.invalidate(true, true);
      });
    },
    nudge(dx: number, dy: number) {
      if (!sel().size) return;
      run("nudge", () => {
        const ids = new Set(sel());
        for (const id of ids) {
          const e = scene.els.get(id);
          if (!e || scene.isLocked(e)) continue;
          hist.touch(e);
          if (e.kind === "arrow") {
            // a bound arrow stays glued to what it is bound to: it only moves when its shapes move with it
            const stays = (b: string) => b === "" || ids.has(b) || (scene.groups.has(b) && groupIdx.membersOf(b).length > 0 && groupIdx.membersOf(b).every((m) => ids.has(m)));
            if (!stays(e.src) || !stays(e.dst)) continue;
            applyArrow(e, e.pts.map((v, i) => (i % 2 ? v + dy : v + dx)));
          } else scene.set(e, e.x + dx, e.y + dy);
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
  // the evaluator is a lazy chunk: when it lands, repaint so capacity notes switch from raw lines to results
  const offCalc = onCalcReady(() => { if (!destroyed) renderer.invalidate(true, false); });
  const offImages = installImageInput(api, d.stage); // drop / paste of image files (tiny; the pipeline itself is lazy)
  return api;
}

/** pasted data comes from outside: coerce every field to a safe value before it enters the scene */
function sanitize(j: ElJSON): ElJSON {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 2000) : "");
  const el: ElJSON = {
    ...j, x: num(j.x, 0), y: num(j.y, 0), w: Math.max(1, num(j.w, 100)), h: Math.max(1, num(j.h, 60)),
    cat: Math.max(0, Math.min(COLOUR_NAMES.length - 1, Math.floor(num(j.cat, 0)))), hex: normHex(j.hex) || undefined, fill: ([0, 1, 2, 3].includes(j.fill) ? j.fill : 1) as 0 | 1 | 2 | 3,
    edge: ([0, 1, 2].includes(j.edge) ? j.edge : 1) as 0 | 1 | 2, radius: Math.max(0, num(j.radius, 8)), text: str(j.text), iconId: str(j.iconId), img: str(j.img).slice(0, 64),
    groupIds: Array.isArray(j.groupIds) ? j.groupIds.filter((g) => typeof g === "string") : [],
    pts: Array.isArray(j.pts) ? j.pts.filter((v) => typeof v === "number" && Number.isFinite(v)).slice(0, 64) : [],
    n: Math.max(0, Math.min(99999, Math.floor(num(j.n, 0)))), o: ([0, 1, 2, 3].includes(j.o) ? j.o : 0) as 0 | 1 | 2 | 3,
    src: str(j.src), dst: str(j.dst), locked: !!j.locked, dash: (j.dash === 1 ? 1 : 0) as 0 | 1,
    route: ([0, 1, 2].includes(j.route) ? j.route : 1) as 0 | 1 | 2, head: ([0, 1, 2].includes(j.head) ? j.head : 1) as 0 | 1 | 2,
    sp: (isPort(j.sp) ? j.sp : -1) as Port, dp: (isPort(j.dp) ? j.dp : -1) as Port,
  };
  const fs = num(j.fs, 0);
  if (fs >= 6 && fs <= 96) el.fs = Math.round(fs); else delete el.fs;
  const sg = cleanSegs(j.segs);
  if (sg) el.segs = sg; else delete el.segs;
  const unit = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined);
  const st = unit(j.st), dt = unit(j.dt);
  if (st !== undefined) el.st = st; else delete el.st;
  if (dt !== undefined) el.dt = dt; else delete el.dt;
  if (el.kind === "arrow") { el.labels = cleanLabels(j.labels); return migrateArrowText(el); }
  delete el.labels; delete el.segs; delete el.st; delete el.dt;
  return el;
}
