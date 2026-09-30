import type { EditorAPI } from "./editor-api";
import { iconMeta } from "./icon-pack";
import { layoutGraph } from "./layout";
import { Scene, type ElInit, type ElJSON, type GroupInfo, type Kind } from "./scene";
import type { GNode, Graph, IconResolver, ShapeName } from "./textdsl";
import { CATEGORIES } from "./theme";

/* ------------------------------------------------------------------ icon matching (injected into the parser) */

const norm = (s: string): string => {
  let o = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122) || c > 127) o += s[i];
    else if (c >= 65 && c <= 90) o += String.fromCharCode(c + 32);
  }
  return o.toLowerCase();
};

export interface IconLike { id: string; name: string; aliases: readonly string[]; pack?: string }

/**
 * Conservative icon matching. `exact` (bare names in a chain) accepts only a normalised id, name, or alias that points at ONE
 * icon — an alias shared by several icons is ambiguous and matches nothing, so a wrong icon is never chosen silently.
 * `loose` (when the user writes `name: something`) additionally accepts a unique prefix, then a unique substring (>= 3 characters).
 */
export function makeResolver(icons: readonly IconLike[]): IconResolver {
  const byId = new Map<string, string>();
  const byName = new Map<string, Set<string>>();
  const byAlias = new Map<string, Set<string>>();
  const fields: { id: string; parts: string[]; pack: string }[] = [];
  const push = (m: Map<string, Set<string>>, k: string, id: string): void => { if (!k) return; const s = m.get(k); if (s) s.add(id); else m.set(k, new Set([id])); };
  for (const ic of icons) {
    byId.set(norm(ic.id), ic.id);
    push(byName, norm(ic.name), ic.id);
    for (const a of ic.aliases) push(byAlias, norm(a), ic.id);
    fields.push({ id: ic.id, parts: [norm(ic.id), norm(ic.name), ...ic.aliases.map(norm)], pack: ic.pack ?? "" });
  }
  const only = (s: Set<string> | undefined): string | null => (s && s.size === 1 ? [...s][0]! : null);
  const exact = (name: string): string | null => {
    const n = norm(name);
    if (!n) return null;
    return byId.get(n) ?? only(byName.get(n)) ?? only(byAlias.get(n)) ?? null;
  };
  /** ids matching by unique-prefix then substring, best first: the core pack before vendor packs, then the shortest id */
  const ranked = (n: string): string[] => {
    for (const mode of ["prefix", "contains"] as const) {
      const hit = fields.filter((f) => f.parts.some((p) => (mode === "prefix" ? p.startsWith(n) : p.includes(n))));
      if (hit.length) return hit.sort((a, b) => (a.pack === "core" ? 0 : 1) - (b.pack === "core" ? 0 : 1) || a.id.length - b.id.length || (a.id < b.id ? -1 : 1)).map((f) => f.id);
    }
    return [];
  };
  return {
    exact,
    loose(name) {
      const hit = exact(name);
      if (hit) return hit;
      const n = norm(name);
      if (n.length < 3) return null;
      const r = ranked(n);
      return r.length === 1 ? r[0]! : null; // several candidates: loose never guesses (see pick)
    },
    pick(name) {
      const n = norm(name);
      if (n.length < 3) return null;
      const r = ranked(n);
      return r.length > 1 ? { id: r[0]!, others: r.slice(1) } : null;
    },
    ambiguous(name) {
      const n = norm(name);
      if (!n || byId.has(n)) return [];
      const s = new Set<string>([...(byName.get(n) ?? []), ...(byAlias.get(n) ?? [])]);
      return s.size > 1 ? [...s].sort() : [];
    },
  };
}

/* ------------------------------------------------------------------ graph -> elements */

const KIND: Record<ShapeName, Kind> = {
  box: "rect", round: "rect", ellipse: "ellipse", diamond: "diamond", cylinder: "cylinder", cloud: "cloud",
  hexagon: "hexagon", parallelogram: "parallelogram", triangle: "triangle", star: "star", note: "note",
};
const EDGE_RADIUS = [0, 8, 18] as const;
/** clear space between existing content and an import placed below it */
const PLACE_GAP = 100;

export interface BuildDefaults { cat: number; fill: 0 | 1 | 2; edge: 0 | 1 | 2; route: 0 | 1 | 2 }
export interface BuildOpts {
  defaults: BuildDefaults;
  /** world point the result is centred on */
  center: { x: number; y: number };
  /** category index for an icon id (null: use the default) */
  categoryOf?(iconId: string): number | null;
}
/** `x`/`y`/`w`/`h`: world bounds of the placed nodes */
export interface Built { els: ElJSON[]; groups: GroupInfo[]; nodes: number; edges: number; groupCount: number; icons: number; x: number; y: number; w: number; h: number }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** node size from its label and shape: wide enough for the text, tall enough for its lines */
export function sizeOf(n: GNode): { w: number; h: number } {
  const lines = n.label.split("\n");
  let longest = 0;
  for (const l of lines) if (l.length > longest) longest = l.length;
  if (n.iconId) return { w: Math.round(clamp(longest * 8 + 16, 80, 180)), h: 98 }; // the icon tile is min(w, h - label strip)
  let w = clamp(longest * 8.2 + 36, 96, 280), h = Math.max(56, 30 + 18 * lines.length);
  switch (n.shape) {
    case "diamond": w *= 1.3; h *= 1.5; break;
    case "ellipse": w *= 1.15; h *= 1.3; break;
    case "cylinder": h += 28; break;
    case "hexagon": w *= 1.15; break;
    case "cloud": w *= 1.2; h *= 1.25; break;
    case "note": h = Math.max(h, 72); break;
    case "triangle": case "star": w *= 1.3; h *= 1.6; break;
    default: break;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

let tplCache: ElJSON | null = null;
/** every field at its current default, taken from a real Scene so new element fields are picked up automatically */
function template(): ElJSON {
  if (!tplCache) { const s = new Scene(); tplCache = s.snapshot(s.add({ kind: "rect" })); }
  return tplCache;
}

/** Lay out a parsed graph and produce fully-formed element snapshots (ids local to the result; the editor remaps them). Pure. */
export function buildElements(g: Graph, o: BuildOpts): Built {
  const sizes = new Map<string, { w: number; h: number }>();
  for (const n of g.nodes) sizes.set(n.key, sizeOf(n));
  const pos = layoutGraph(
    g.nodes.map((n) => ({ id: n.key, ...sizes.get(n.key)!, ...(n.group ? { cluster: n.group } : {}) })),
    g.edges.map((e) => ({ from: e.from, to: e.to })),
    { direction: g.direction },
  );
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of g.nodes) {
    const p = pos.get(n.key) ?? { x: 0, y: 0 }, s = sizes.get(n.key)!;
    if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
    if (p.x + s.w > x1) x1 = p.x + s.w; if (p.y + s.h > y1) y1 = p.y + s.h;
  }
  if (x0 === Infinity) { x0 = y0 = 0; x1 = y1 = 0; }
  const dx = Math.round(o.center.x - (x0 + x1) / 2), dy = Math.round(o.center.y - (y0 + y1) / 2);

  // groups: ids local to this import; nested groups list deepest -> shallowest on each member (Excalidraw-compatible)
  const gid = new Map<string, string>();
  const groups: GroupInfo[] = g.groups.map((gr, i) => {
    const id = `ig${i + 1}`;
    gid.set(gr.key, id);
    return { id, name: gr.name, cat: i % CATEGORIES.length, collapsed: false, locked: false };
  });
  const parentOf = new Map(g.groups.map((gr) => [gr.key, gr.parent]));
  const groupIds = (key: string): string[] => {
    const out: string[] = [];
    for (let k = key, guard = 0; k && guard < 64; guard++) { const id = gid.get(k); if (id) out.push(id); k = parentOf.get(k) ?? ""; }
    return out;
  };

  // Snapshots are stamped from one template (a real Scene supplies every current default), not added to a scratch scene: the editor
  // builds the live scene itself, so building one here too would double the work of a large import.
  const tpl = template();
  let seq = 0;
  const els: ElJSON[] = [];
  const make = (init: ElInit): ElJSON => {
    const id = `i${(++seq).toString(36)}`;
    const e = { ...tpl, ...init, id, z: seq, version: 1, groupIds: init.groupIds ?? [], pts: [] } as ElJSON;
    els.push(e);
    return e;
  };
  const idOf = new Map<string, string>();
  let icons = 0;
  for (const n of g.nodes) {
    const s = sizes.get(n.key)!, p = pos.get(n.key) ?? { x: 0, y: 0 };
    const edge = n.shape === "round" ? 2 : o.defaults.edge;
    const init: ElInit = {
      kind: n.iconId ? "icon" : KIND[n.shape], x: p.x + dx, y: p.y + dy, w: s.w, h: s.h, text: n.label,
      cat: o.defaults.cat, fill: o.defaults.fill, edge, radius: EDGE_RADIUS[edge], groupIds: groupIds(n.group),
    };
    if (n.iconId) { init.iconId = n.iconId; icons++; const c = o.categoryOf?.(n.iconId); if (c !== null && c !== undefined && c >= 0) init.cat = c; }
    idOf.set(n.key, make(init).id);
  }
  for (const e of g.edges) {
    make({
      kind: "arrow", src: idOf.get(e.from)!, dst: idOf.get(e.to)!, sp: -1, dp: -1, route: o.defaults.route, edge: o.defaults.edge,
      dash: e.dashed ? 1 : 0, head: 1, text: e.label, cat: o.defaults.cat, fill: 0, radius: 0, x: 0, y: 0, w: 1, h: 1,
    });
  }
  return { els, groups, nodes: g.nodes.length, edges: g.edges.length, groupCount: groups.length, icons, x: x0 + dx, y: y0 + dy, w: x1 - x0, h: y1 - y0 };
}

/** screen space the chrome covers while something is selected (tool strip on the left, properties panel on the right); none on narrow screens, where the panels collapse */
export function chromeReserve(viewportW: number): { left: number; right: number } {
  return viewportW >= 900 ? { left: 84, right: 304 } : { left: 0, right: 0 };
}

/** Zoom so the box fits the free area between the chrome and centre it there. Uses only the public view API (zoomBy + panTo). */
export function fitInFreeArea(editor: EditorAPI, box: { x: number; y: number; w: number; h: number }): void {
  const vp = editor.vp, r = chromeReserve(vp.w);
  const freeW = Math.max(120, vp.w - r.left - r.right), freeH = Math.max(120, vp.h - 120);
  const z = clamp(Math.min(freeW / (box.w + 120), freeH / (box.h + 120)), 0.15, 1.6);
  if (Math.abs(z - vp.zoom) > 1e-6) editor.zoomBy(z / vp.zoom);
  // the content centre should land at the middle of the free area; the viewport centre is that point shifted by the reserved margins
  editor.panTo(box.x + box.w / 2 + (vp.w / 2 - (r.left + freeW / 2)) / vp.zoom, box.y + box.h / 2);
}

/** Insert a parsed graph into the editor as ONE undo step, centred in the current view, selected and zoomed to fit the free area. Returns null when there is nothing to import. */
export function importGraph(editor: EditorAPI, g: Graph, fit = true): Built | null {
  if (g.errors.length || !g.nodes.length) return null;
  const vp = editor.vp;
  // built around the origin, then moved: an empty sheet gets it centred in the view; a sheet with content gets it BELOW that content,
  // so an import never lands on top of existing work
  const built = buildElements(g, {
    defaults: { cat: editor.defaults.cat, fill: editor.defaults.fill, edge: editor.defaults.edge, route: editor.defaults.route },
    center: { x: 0, y: 0 },
    categoryOf: (id) => { const c = iconMeta(id)?.category; const i = c ? (CATEGORIES as readonly string[]).indexOf(c) : -1; return i >= 0 ? i : null; },
  });
  const existing = editor.scene.bounds();
  const tx = Math.round(existing ? existing.x + existing.w / 2 : vp.x + vp.w / vp.zoom / 2);
  const ty = Math.round(existing ? existing.y + existing.h + PLACE_GAP + built.h / 2 : vp.y + vp.h / vp.zoom / 2);
  for (const e of built.els) { e.x += tx; e.y += ty; }
  built.x += tx; built.y += ty;
  const ids = editor.importElements({ els: built.els, groups: built.groups }, false);
  if (!ids.length) return null;
  if (fit) fitInFreeArea(editor, { x: built.x, y: built.y, w: built.w, h: built.h });
  return built;
}
