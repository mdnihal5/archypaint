import type { EditorAPI } from "./editor-api";
import { layoutGraph, type LEdge, type LNode, type Pos } from "./layout";
import type { El } from "./scene";

/**
 * Auto-tidy: read the scene, run the layered layout, and apply the result as ONE undoable move.
 * Lazy chunk — nothing here runs until the user asks for it, and nothing runs per frame.
 *
 *   graph      nodes are shapes / icons; edges are arrows bound at BOTH ends (free arrows are left alone)
 *   containers frames and swimlanes are laid out as single boxes; everything fully inside one moves with it, relative
 *              positions untouched (nested containers belong to their outermost one)
 *   clusters   members of a group stay adjacent
 *   pinned     annotations (legend, text, brace, badge, sticky/capacity notes) and locked elements are never laid out
 *              (they still travel with a container that holds them); free arrows stay where they are
 *   direction  the way the existing edges already point: mostly horizontal -> layers left to right, else top to bottom
 *   anchor     the result keeps the top-left corner of what was there and snaps to the 10-unit grid
 */
export interface TidyResult { /** elements repositioned (including container contents) */ moved: number; /** layout boxes */ nodes: number; edges: number; direction: "LR" | "TB" }

const GRID = 10;
const PINNED = new Set(["arrow", "legend", "text", "brace", "badge", "note", "calc"]);
const CONTAINER = new Set(["frame", "lane"]);
const snap = (v: number): number => Math.round(v / GRID) * GRID;

interface Box { x: number; y: number; w: number; h: number }
const inside = (a: Box, b: Box): boolean => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;

export function runTidy(editor: EditorAPI, scope: "selection" | "all"): TidyResult {
  const { scene } = editor;
  const sel = editor.selection();
  const pool: El[] = [];
  if (scope === "selection") { for (const id of sel) { const e = scene.els.get(id); if (e) pool.push(e); } }
  else for (const e of scene.els.values()) pool.push(e);

  // containers in scope own everything fully inside them (outermost wins) — even things that are not themselves in scope
  const containers = pool.filter((e) => CONTAINER.has(e.kind) && !e.locked).sort((a, b) => b.w * b.h - a.w * a.h);
  const ownerOf = new Map<string, string>(); // element id -> outermost container id
  const owned = new Map<string, El[]>();
  if (containers.length) {
    for (const e of scene.els.values()) {
      if (e.kind === "arrow" || e.locked) continue;
      for (const c of containers) { // largest first: the first container that holds e is the outermost
        if (c.id === e.id || !inside(e, c)) continue;
        ownerOf.set(e.id, c.id);
        const list = owned.get(c.id);
        if (list) list.push(e); else owned.set(c.id, [e]);
        break;
      }
    }
  }
  const nodes: El[] = pool.filter((e) => !e.locked && !PINNED.has(e.kind) && !ownerOf.has(e.id));
  const nodeIds = new Set(nodes.map((e) => e.id));
  const resolve = (id: string): string | null => { if (!id) return null; if (nodeIds.has(id)) return id; const o = ownerOf.get(id); return o && nodeIds.has(o) ? o : null; };

  const edges: LEdge[] = [];
  let dx = 0, dy = 0;
  for (const a of scene.els.values()) {
    if (a.kind !== "arrow" || !a.src || !a.dst) continue;
    const u = resolve(a.src), v = resolve(a.dst);
    if (!u || !v || u === v) continue;
    edges.push({ from: u, to: v });
    const s = scene.els.get(u)!, t = scene.els.get(v)!;
    dx += Math.abs(t.x + t.w / 2 - (s.x + s.w / 2)); dy += Math.abs(t.y + t.h / 2 - (s.y + s.h / 2));
  }
  let direction: "LR" | "TB" = "LR";
  if (edges.length) direction = dx >= dy ? "LR" : "TB";
  else {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of nodes) { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); }
    direction = x1 - x0 >= y1 - y0 ? "LR" : "TB";
  }
  if (nodes.length < 2) return { moved: 0, nodes: nodes.length, edges: edges.length, direction };

  const lnodes: LNode[] = nodes.map((e) => {
    const g = e.groupIds.length ? e.groupIds[e.groupIds.length - 1] : undefined;
    return g ? { id: e.id, w: e.w, h: e.h, cluster: g } : { id: e.id, w: e.w, h: e.h };
  });
  // keep the reading order the user already has: sort by where things are now, so equal-rank nodes do not swap at random
  lnodes.sort((a, b) => {
    const ea = scene.els.get(a.id)!, eb = scene.els.get(b.id)!;
    return direction === "LR" ? ea.x - eb.x || ea.y - eb.y || ea.z - eb.z : ea.y - eb.y || ea.x - eb.x || ea.z - eb.z;
  });
  const laid = layoutGraph(lnodes, edges, { direction });

  let ox = Infinity, oy = Infinity;
  for (const e of nodes) { ox = Math.min(ox, e.x); oy = Math.min(oy, e.y); }
  ox = snap(ox); oy = snap(oy);
  const target = new Map<string, Pos>();
  let moved = 0;
  for (const e of nodes) {
    const p = laid.get(e.id);
    if (!p) continue;
    const nx = snap(ox + p.x), ny = snap(oy + p.y);
    target.set(e.id, { x: nx, y: ny });
    const kids = owned.get(e.id);
    if (kids) for (const k of kids) target.set(k.id, { x: k.x + (nx - e.x), y: k.y + (ny - e.y) });
  }
  for (const [id, p] of target) { const e = scene.els.get(id)!; if (e.x !== p.x || e.y !== p.y) moved++; }
  if (moved) editor.applyPositions(target, "tidy layout");
  return { moved, nodes: nodes.length, edges: edges.length, direction };
}
