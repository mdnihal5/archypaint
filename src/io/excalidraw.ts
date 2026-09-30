import type { ElJSON, GroupInfo, SceneJSON } from "../scene";
import { LIGHT, type Theme } from "../theme";
import { NEW_KINDS, legendRows } from "../shape-geom";
import { APP, FORMAT_VERSION, LIMITS, validateFile } from "./format";

const ELLIPSE_LIKE: ReadonlySet<string> = new Set(["ellipse", "cloud", "badge"]);
const DIAMOND_LIKE: ReadonlySet<string> = new Set(["diamond", "hexagon", "parallelogram", "triangle", "star"]);

/**
 * Excalidraw <-> archypaint. Import understands BOTH arrow-binding formats (older {elementId, focus, gap} and current
 * {elementId, fixedPoint, mode}); export writes BOTH so older and newer Excalidraw builds can read it.
 * Anything archypaint-specific (icons, categories, fill/edge style, ports) rides in `customData.archypaint`, so a file
 * that went through Excalidraw comes back intact; a file authored in Excalidraw maps to the nearest archypaint equivalent.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const clampC = (v: number) => Math.max(-LIMITS.maxCoord, Math.min(LIMITS.maxCoord, v));

export type ExResult = { ok: true; scene: SceneJSON; warnings: string[] } | { ok: false; message: string };

/* ------------------------------------------------------------------ colour */

function hexToRgb(h: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(h.trim());
  if (!m) return null;
  let x = m[1]!;
  if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** nearest category by RGB distance; ties resolve to the lower index so the mapping is deterministic */
export function nearestCat(hex: string, th: Theme = LIGHT): { cat: number; dist: number } {
  const c = hexToRgb(hex);
  if (!c) return { cat: 0, dist: Infinity };
  let best = 0, bd = Infinity;
  th.cats.forEach((h, i) => {
    const r = hexToRgb(h)!;
    const d = Math.hypot(c[0] - r[0], c[1] - r[1], c[2] - r[2]);
    if (d < bd) { bd = d; best = i; }
  });
  return { cat: best, dist: bd };
}
const mix = (hex: string, w: number): string => { const c = hexToRgb(hex) ?? [0, 0, 0]; return toHex(c[0] + (255 - c[0]) * w, c[1] + (255 - c[1]) * w, c[2] + (255 - c[2]) * w); };

/* ------------------------------------------------------------------ import */

const SHAPES: Record<string, ElJSON["kind"]> = { rectangle: "rect", ellipse: "ellipse", diamond: "diamond" };
const KINDS = ["rect", "ellipse", "diamond", "text", "arrow", "icon", ...NEW_KINDS];

function portFromNorm(nx: number, ny: number): 0 | 1 | 2 | 3 {
  return Math.abs(nx) >= Math.abs(ny) ? (nx >= 0 ? 1 : 3) : ny >= 0 ? 2 : 0;
}

function bindingPort(b: unknown, target: { x: number; y: number; w: number; h: number }, px: number, py: number): -1 | 0 | 1 | 2 | 3 {
  if (isObj(b) && Array.isArray(b.fixedPoint) && b.fixedPoint.length === 2) {
    const fx = num(b.fixedPoint[0]), fy = num(b.fixedPoint[1]);
    if (fx !== null && fy !== null) return portFromNorm(fx - 0.5, fy - 0.5);
  }
  // older format has no anchor: derive the side from where the arrow actually ends
  if (target.w <= 0 || target.h <= 0) return -1;
  return portFromNorm((px - (target.x + target.w / 2)) / (target.w / 2), (py - (target.y + target.h / 2)) / (target.h / 2));
}

function cdOf(el: Obj): Obj | null {
  const cd = el.customData;
  if (!isObj(cd)) return null;
  const a = cd[APP];
  return isObj(a) ? a : null;
}

export function fromExcalidraw(input: unknown, th: Theme = LIGHT): ExResult {
  if (!isObj(input)) return { ok: false, message: "Not an Excalidraw file (expected a JSON object)." };
  if (input.type !== "excalidraw" && input.type !== "excalidraw/clipboard") return { ok: false, message: "Not an Excalidraw file (missing type: \"excalidraw\")." };
  if (!Array.isArray(input.elements)) return { ok: false, message: "Excalidraw file has no elements array." };
  if (input.elements.length > LIMITS.maxElements) return { ok: false, message: `Too many elements (${input.elements.length}); the limit is ${LIMITS.maxElements}.` };

  const warnings: string[] = [];
  const skipped = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  // pass 1: which elements survive, and their new ids
  const live: Obj[] = [];
  for (const raw of input.elements) {
    if (!isObj(raw) || raw.isDeleted === true || typeof raw.type !== "string" || typeof raw.id !== "string") continue;
    live.push(raw);
  }
  const byEx = new Map<string, Obj>();
  for (const e of live) byEx.set(e.id as string, e);

  const labelOf = new Map<string, string>(); // container ex-id -> text
  const labelIds = new Set<string>();
  for (const e of live) {
    if (e.type !== "text") continue;
    const cid = typeof e.containerId === "string" ? e.containerId : "";
    const c = cid ? byEx.get(cid) : undefined;
    if (c && (str(c.type) in SHAPES || c.type === "arrow")) {
      const t = str(e.text) || str(e.originalText);
      if (labelOf.has(cid)) bump(skipped, "extra bound label"); else labelOf.set(cid, t);
      labelIds.add(e.id as string);
    }
  }

  const keep: Obj[] = [];
  for (const e of live) {
    const t = e.type as string;
    if (labelIds.has(e.id as string)) continue;
    if (t in SHAPES || t === "text" || t === "arrow" || t === "line") keep.push(e);
    else bump(skipped, t);
  }
  const idMap = new Map<string, string>();
  keep.forEach((e, i) => idMap.set(e.id as string, `e${(i + 1).toString(36)}`));

  const gMap = new Map<string, string>();
  const gid = (g: string): string => { let v = gMap.get(g); if (!v) { v = `g${(gMap.size + 1).toString(36)}`; gMap.set(g, v); } return v; };

  const groupNames = new Map<string, GroupInfo>();
  const top = isObj(input[APP]) ? (input[APP] as Obj) : null;
  if (top && Array.isArray(top.groups)) for (const g of top.groups) if (isObj(g) && typeof g.id === "string") groupNames.set(g.id, { id: "", name: str(g.name).slice(0, LIMITS.maxName), cat: num(g.cat) ?? 0, collapsed: g.collapsed === true, locked: g.locked === true });

  let rotated = 0, farColour = 0, badGeom = 0;
  const out: ElJSON[] = [];
  const shapeGeom = new Map<string, { x: number; y: number; w: number; h: number }>(); // new id -> box, for binding ports

  for (const e of keep) {
    const exId = e.id as string, id = idMap.get(exId)!;
    const t = e.type as string;
    const x = num(e.x), y = num(e.y), w0 = num(e.width), h0 = num(e.height);
    if (x === null || y === null || w0 === null || h0 === null) { badGeom++; idMap.delete(exId); continue; }
    if ((num(e.angle) ?? 0) !== 0) rotated++;
    const cd = cdOf(e);
    const sc = str(e.strokeColor);
    const nc = sc ? nearestCat(sc, th) : { cat: 0, dist: 0 };
    if (nc.dist > 80) farColour++;
    const groupIds = Array.isArray(e.groupIds) ? e.groupIds.filter((g): g is string => typeof g === "string").slice(0, LIMITS.maxGroupIds).map(gid) : [];
    const base: ElJSON = {
      id, kind: "rect", x: clampC(x), y: clampC(y), w: Math.min(LIMITS.maxCoord, Math.abs(w0)), h: Math.min(LIMITS.maxCoord, Math.abs(h0)),
      z: out.length + 1, version: 1, cat: nc.cat, fill: 1, radius: 8, text: labelOf.get(exId) ?? "", edge: 1, groupIds, iconId: "", locked: e.locked === true, n: 0, o: 0,
      src: "", dst: "", sp: -1, dp: -1, route: 1, dash: 0, head: 1, pts: [],
    };
    if (t in SHAPES) {
      base.kind = SHAPES[t]!;
      const bg = str(e.backgroundColor);
      base.fill = !bg || bg === "transparent" ? 0 : 1;
      const rounded = e.roundness !== null && e.roundness !== undefined;
      base.edge = rounded ? 1 : 0;
      base.radius = rounded ? 8 : 0;
      if (str(e.strokeStyle) === "dashed" || str(e.strokeStyle) === "dotted") base.dash = 1;
    } else if (t === "text") {
      base.kind = "text"; base.text = str(e.text) || str(e.originalText); base.fill = 0;
      if (base.text.length > LIMITS.maxText) base.text = base.text.slice(0, LIMITS.maxText);
    } else {
      // arrow / line: Excalidraw points are relative to (x, y)
      const pts: number[] = [];
      if (Array.isArray(e.points)) for (const p of e.points.slice(0, LIMITS.maxPts / 2)) {
        if (!Array.isArray(p)) continue;
        const px = num(p[0]), py = num(p[1]);
        if (px !== null && py !== null) pts.push(clampC(x + px), clampC(y + py));
      }
      if (pts.length < 4) { badGeom++; idMap.delete(exId); continue; }
      base.kind = "arrow"; base.pts = pts; base.fill = 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]!); x1 = Math.max(x1, pts[i]!); y0 = Math.min(y0, pts[i + 1]!); y1 = Math.max(y1, pts[i + 1]!); }
      base.x = x0; base.y = y0; base.w = x1 - x0; base.h = y1 - y0;
      base.route = e.elbowed === true ? 1 : e.roundness !== null && e.roundness !== undefined ? 2 : 0;
      base.dash = str(e.strokeStyle) === "dashed" || str(e.strokeStyle) === "dotted" ? 1 : 0;
      const eh = e.endArrowhead;
      base.head = t === "line" ? 0 : eh === null ? 0 : eh === undefined ? 1 : eh === "dot" || eh === "circle" || eh === "circle_outline" ? 2 : 1;
      base.edge = 1;
    }
    // exact archypaint attributes win when present (this is the round-trip path)
    if (cd) {
      if (typeof cd.kind === "string" && KINDS.includes(cd.kind) && ((cd.kind === "icon" || NEW_KINDS.has(cd.kind)) ? t in SHAPES : cd.kind === base.kind)) base.kind = cd.kind as ElJSON["kind"];
      const ci = num(cd.cat); if (ci !== null && Number.isInteger(ci) && ci >= 0 && ci < 256) base.cat = ci;
      for (const [k, allowed] of [["fill", [0, 1, 2]], ["edge", [0, 1, 2]], ["route", [0, 1, 2]], ["dash", [0, 1]], ["head", [0, 1, 2]], ["sp", [-1, 0, 1, 2, 3]], ["dp", [-1, 0, 1, 2, 3]]] as const) {
        const v = num(cd[k]); if (v !== null && (allowed as readonly number[]).includes(v)) (base as unknown as Record<string, number>)[k] = v;
      }
      const r = num(cd.radius); if (r !== null && r >= 0 && r <= 1e4) base.radius = r;
      if (typeof cd.iconId === "string" && cd.iconId.length <= LIMITS.maxId) base.iconId = cd.iconId;
      const cn = num(cd.n); if (cn !== null && Number.isInteger(cn) && cn >= 0 && cn <= 99999) base.n = cn;
      const co = num(cd.o); if (co !== null && [0, 1, 2, 3].includes(co)) base.o = co as 0 | 1 | 2 | 3;
      if (base.kind === "legend" && typeof cd.rawText === "string") base.text = cd.rawText.slice(0, LIMITS.maxText);
      if (base.kind === "badge") base.text = "";
      if (base.kind === "icon" && base.text === base.iconId) base.text = ""; // the export labels an icon with its id; that label is not user text
    }
    out.push(base);
    if (base.kind !== "arrow") shapeGeom.set(id, { x: base.x, y: base.y, w: base.w, h: base.h });
    if (base.kind === "arrow") (base as ElJSON & { _exArrow?: Obj })._exArrow = e; // resolved below, once all ids exist
  }

  // pass 2: arrow bindings (both formats) -> src/dst + ports
  let unboundBindings = 0;
  for (const a of out) {
    const holder = a as ElJSON & { _exArrow?: Obj };
    const ex = holder._exArrow;
    delete holder._exArrow;
    if (!ex) continue;
    const bind = (b: unknown, end: 0 | 1) => {
      if (!isObj(b) || typeof b.elementId !== "string") return;
      const nid = idMap.get(b.elementId);
      const geom = nid ? shapeGeom.get(nid) : undefined;
      if (!nid || !geom) { unboundBindings++; return; }
      const i = end === 0 ? 0 : a.pts.length - 2;
      const port = bindingPort(b, geom, a.pts[i]!, a.pts[i + 1]!);
      if (end === 0) { a.src = nid; if (!cdOf(ex)) a.sp = port; } else { a.dst = nid; if (!cdOf(ex)) a.dp = port; }
    };
    bind(ex.startBinding, 0); bind(ex.endBinding, 1);
    // keep exact ports from customData when present (already applied above), otherwise use the derived ones
  }

  // group names (looked up by ORIGINAL id) -> GroupInfo under the NEW id
  const groups: GroupInfo[] = [];
  for (const [orig, nid] of gMap) { const g = groupNames.get(orig); if (g) groups.push({ ...g, id: nid }); }

  if (skipped.size) for (const [k, c] of skipped) warnings.push(`${c} ${k} element(s) skipped — not supported`);
  if (rotated) warnings.push(`${rotated} rotated element(s) imported unrotated`);
  if (farColour) warnings.push(`${farColour} element(s) use colours far from any category; mapped to the nearest`);
  if (badGeom) warnings.push(`${badGeom} element(s) with invalid geometry skipped`);
  if (unboundBindings) warnings.push(`${unboundBindings} arrow end(s) bound to a missing or unsupported element were left free`);

  const v = validateFile({ app: APP, version: FORMAT_VERSION, scene: { els: out, groups } });
  if (!v.ok) return { ok: false, message: `Imported drawing failed validation: ${v.error.message}` };
  return { ok: true, scene: v.value.scene, warnings: [...warnings, ...v.warnings] };
}

/* ------------------------------------------------------------------ export */

const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const FIXED: Record<number, [number, number]> = { 0: [0.5, 0], 1: [1, 0.5], 2: [0.5, 1], 3: [0, 0.5] };

export function toExcalidraw(scene: SceneJSON, th: Theme = LIGHT): Obj {
  const els = [...scene.els].sort((a, b) => a.z - b.z);
  const byId = new Map(els.map((e) => [e.id, e]));
  const out: Obj[] = [];
  const bound = new Map<string, Array<{ type: string; id: string }>>();
  const addBound = (id: string, b: { type: string; id: string }) => { const l = bound.get(id); if (l) l.push(b); else bound.set(id, [b]); };

  const common = (e: ElJSON, type: string): Obj => {
    const c = th.cats[e.cat % th.cats.length]!;
    return {
      id: e.id, type, x: e.x, y: e.y, width: e.w, height: e.h, angle: 0,
      strokeColor: c, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: e.dash ? "dashed" : "solid",
      roughness: 0, opacity: 100, groupIds: [...e.groupIds], frameId: null, index: null, roundness: null,
      seed: hash(e.id), version: Math.max(1, e.version), versionNonce: hash(e.id + ":" + e.version), isDeleted: false,
      boundElements: [], updated: 1, link: null, locked: e.locked,
    };
  };
  const meta = (e: ElJSON): Obj => ({ [APP]: { kind: e.kind, cat: e.cat, fill: e.fill, edge: e.edge, radius: e.radius, iconId: e.iconId, route: e.route, dash: e.dash, head: e.head, sp: e.sp, dp: e.dp, n: e.n, o: e.o, ...(e.kind === "legend" ? { rawText: e.text } : {}) } });

  const labels: Obj[] = [];
  const label = (containerId: string, text: string, cx: number, cy: number, boxW: number): void => {
    const lines = text.split("\n");
    const w = Math.max(10, Math.min(boxW, Math.max(...lines.map((l) => l.length)) * 9.6)), h = lines.length * 20;
    const id = `${containerId}_t`;
    labels.push({
      id, type: "text", x: cx - w / 2, y: cy - h / 2, width: w, height: h, angle: 0, strokeColor: th.ink, backgroundColor: "transparent", fillStyle: "solid",
      strokeWidth: 1, strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null, index: null, roundness: null, seed: hash(id), version: 1,
      versionNonce: hash(id), isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
      text, fontSize: 16, fontFamily: 3, textAlign: "center", verticalAlign: "middle", containerId, originalText: text, autoResize: true, lineHeight: 1.25,
    });
    addBound(containerId, { type: "text", id });
  };

  for (const e of els) {
    const c = th.cats[e.cat % th.cats.length]!;
    if (e.kind === "arrow") {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i + 1 < e.pts.length; i += 2) pts.push([e.pts[i]! - e.pts[0]!, e.pts[i + 1]! - e.pts[1]!]);
      if (pts.length < 2) pts.push([e.w, e.h]);
      const el = common(e, "arrow");
      const x0 = e.pts[0] ?? e.x, y0 = e.pts[1] ?? e.y;
      const mk = (id: string, port: number, ex: number, ey: number) => {
        const t = byId.get(id);
        if (!t || t.kind === "arrow") return null;
        let fp = FIXED[port];
        if (!fp) fp = t.w > 0 && t.h > 0 ? [Math.min(1, Math.max(0, (ex - t.x) / t.w)), Math.min(1, Math.max(0, (ey - t.y) / t.h))] : [0.5, 0.5];
        addBound(id, { type: "arrow", id: e.id });
        return { elementId: id, focus: 0, gap: 4, fixedPoint: fp, mode: "orbit" };
      };
      Object.assign(el, {
        x: x0, y: y0, width: e.w, height: e.h, points: pts, lastCommittedPoint: null,
        startBinding: e.src ? mk(e.src, e.sp, x0, y0) : null,
        endBinding: e.dst ? mk(e.dst, e.dp, e.pts[e.pts.length - 2] ?? x0, e.pts[e.pts.length - 1] ?? y0) : null,
        startArrowhead: null, endArrowhead: e.head === 0 ? null : e.head === 2 ? "dot" : "arrow",
        elbowed: e.route === 1, roundness: e.route === 2 ? { type: 2 } : null, customData: meta(e),
      });
      out.push(el);
      if (e.text) { const mx = e.x + e.w / 2, my = e.y + e.h / 2; label(e.id, e.text, mx, my, 200); }
      continue;
    }
    if (e.kind === "text") {
      const el = common(e, "text");
      Object.assign(el, { text: e.text, originalText: e.text, fontSize: 16, fontFamily: 3, textAlign: "center", verticalAlign: "middle", containerId: null, autoResize: true, lineHeight: 1.25, boundElements: null, customData: meta(e) });
      out.push(el);
      continue;
    }
    // icons and the newer shapes become the nearest native shape (rectangle / ellipse / diamond); their real kind rides in customData
    const type = ELLIPSE_LIKE.has(e.kind) ? "ellipse" : DIAMOND_LIKE.has(e.kind) ? "diamond" : "rectangle";
    const el = common(e, type);
    Object.assign(el, {
      backgroundColor: e.fill === 0 ? "transparent" : e.fill === 1 ? mix(c, 0.87) : c,
      roundness: e.edge === 0 || type === "diamond" ? null : { type: 3 },
      customData: meta(e),
    });
    out.push(el);
    const txt = e.kind === "icon" ? e.text || e.iconId : e.kind === "badge" ? String(e.n) : e.kind === "legend" ? legendRows(e.text).map((r) => r.label).join("\n") : e.text;
    if (txt) label(e.id, txt, e.x + e.w / 2, e.y + e.h / 2, e.w - 8);
  }
  for (const el of out) { const b = bound.get(el.id as string); if (b && el.type !== "text") el.boundElements = b; }

  return {
    type: "excalidraw", version: 2, source: "archypaint",
    elements: [...out, ...labels],
    appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    files: {},
    [APP]: { version: FORMAT_VERSION, groups: scene.groups },
  };
}
