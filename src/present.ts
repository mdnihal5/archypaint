/**
 * Present mode, pure part: which elements appear at which step, and where the camera goes. No DOM, no scene access,
 * deterministic (every tie is broken by id), so it is cheap to test and can be reasoned about without a browser.
 */

export interface PEl {
  id: string; kind: string;
  x: number; y: number; w: number; h: number;
  /** badge number (kind "badge") */
  n: number;
  groupIds: readonly string[];
  /** arrows: bound element ids ("" = free end) */
  src: string; dst: string;
}

export type PlanMode = "badges" | "reading";
export interface Plan { steps: string[][]; mode: PlanMode }

/** an element farther than this from every badge (and not grouped with one) is "not covered" and appears at the end */
export const FAR = 600;
/** reading order bands: centres within the same 100-unit row are ordered left to right */
const ROW = 100;

const cx = (e: PEl): number => e.x + e.w / 2;
const cy = (e: PEl): number => e.y + e.h / 2;
const isArrow = (e: PEl): boolean => e.kind === "arrow";
const isContainer = (e: PEl): boolean => e.kind === "frame" || e.kind === "lane";
const cmpReading = (a: { x: number; y: number; id: string }, b: { x: number; y: number; id: string }): number =>
  Math.round(a.y / ROW) - Math.round(b.y / ROW) || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const inside = (c: PEl, e: PEl): boolean => cx(e) >= c.x && cx(e) <= c.x + c.w && cy(e) >= c.y && cy(e) <= c.y + c.h;

/** the one-line explanation shown when a presentation starts */
export function planHint(mode: PlanMode): string {
  return mode === "badges"
    ? "Steps follow your numbered badges · → next · ← back · Esc exit"
    : "Steps follow groups, then shapes, top-left to bottom-right · → next · ← back · Esc exit";
}

/**
 * Steps, each a list of element ids revealed together. Every element appears exactly once.
 *  1. Numbered badges (kind "badge", n > 0) define the steps, in numeric order (equal numbers share a step). A shape
 *     joins the step of a badge it is grouped with, else of the nearest badge within FAR; containers join the earliest
 *     step of what they contain; an arrow joins the later of its two bound endpoints.
 *  2. Without badges: each top-level group (reading order), then each loose shape (reading order). Arrows as above.
 *  3. Anything not covered (unbound arrows, shapes far from every badge) forms a last step.
 */
export function computeSteps(els: readonly PEl[]): Plan {
  if (!els.length) return { steps: [], mode: "reading" };
  const badges = els.filter((e) => e.kind === "badge" && e.n > 0);
  return badges.length ? byBadges(els, badges) : byReading(els);
}

function finish(els: readonly PEl[], step: Map<string, number>, count: number, mode: PlanMode): Plan {
  const steps: string[][] = Array.from({ length: count }, () => []);
  const rest: string[] = [];
  for (const e of els) {
    const s = step.get(e.id);
    if (s === undefined || s >= count) rest.push(e.id); else steps[s]!.push(e.id);
  }
  const out = steps.filter((s) => s.length);
  if (rest.length) out.push(rest);
  return { steps: out, mode };
}

/** arrows join the later of their bound endpoints; with none bound they are uncovered (undefined) */
function placeArrows(els: readonly PEl[], step: Map<string, number>, fallback?: (a: PEl) => number | undefined): void {
  for (const a of els) {
    if (!isArrow(a)) continue;
    let s: number | undefined;
    let any = false;
    for (const id of [a.src, a.dst]) {
      if (!id) continue;
      any = true;
      const v = step.get(id);
      s = v === undefined ? Infinity : Math.max(s ?? -1, v);
    }
    if (!any && fallback) s = fallback(a);
    if (s !== undefined && Number.isFinite(s)) step.set(a.id, s);
  }
}

function byBadges(els: readonly PEl[], badges: readonly PEl[]): Plan {
  const nums = [...new Set(badges.map((b) => b.n))].sort((a, b) => a - b);
  const idx = new Map(nums.map((n, i) => [n, i]));
  const badgeStep = new Map<string, number>(badges.map((b) => [b.id, idx.get(b.n)!]));
  const step = new Map<string, number>(badgeStep);

  const nearest = (x: number, y: number): number | undefined => {
    let best = Infinity, bs: number | undefined;
    for (const b of badges) {
      const d = Math.hypot(cx(b) - x, cy(b) - y), s = badgeStep.get(b.id)!;
      if (d < best || (d === best && s < (bs ?? Infinity))) { best = d; bs = s; }
    }
    return best <= FAR ? bs : undefined;
  };

  const shapes = els.filter((e) => !isArrow(e) && !isContainer(e) && !badgeStep.has(e.id));
  for (const e of shapes) {
    let s: number | undefined;
    if (e.groupIds.length) for (const b of badges) if (b.groupIds.some((g) => e.groupIds.includes(g))) s = Math.min(s ?? Infinity, badgeStep.get(b.id)!);
    s ??= nearest(cx(e), cy(e));
    if (s !== undefined) step.set(e.id, s);
  }
  for (const c of els.filter(isContainer)) {
    let s: number | undefined;
    for (const e of els) if (e !== c && !isArrow(e) && !isContainer(e) && inside(c, e)) { const v = step.get(e.id); if (v !== undefined) s = Math.min(s ?? Infinity, v); }
    s ??= nearest(cx(c), cy(c));
    if (s !== undefined) step.set(c.id, s);
  }
  placeArrows(els, step, (a) => nearest(cx(a), cy(a)));
  return finish(els, step, nums.length, "badges");
}

function byReading(els: readonly PEl[]): Plan {
  const plain = els.filter((e) => !isArrow(e));
  const members = (c: PEl): PEl[] => plain.filter((e) => e !== c && !isContainer(e) && inside(c, e));
  const holders = new Set(plain.filter((c) => isContainer(c) && members(c).length).map((c) => c.id)); // containers that hold something ride with it

  const groups = new Map<string, PEl[]>();
  const loose: PEl[] = [];
  for (const e of plain) {
    if (holders.has(e.id)) continue;
    const g = e.groupIds.length ? e.groupIds[e.groupIds.length - 1]! : "";
    if (g) { const a = groups.get(g); if (a) a.push(e); else groups.set(g, [e]); } else loose.push(e);
  }
  const box = (list: PEl[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of list) { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  };
  const units: { x: number; y: number; id: string; ids: string[] }[] = [];
  for (const [g, list] of groups) units.push({ ...box(list), id: `g:${g}`, ids: list.map((e) => e.id) });
  units.sort(cmpReading);
  const looseUnits = loose.map((e) => ({ x: cx(e), y: cy(e), id: e.id, ids: [e.id] })).sort(cmpReading);

  const step = new Map<string, number>();
  [...units, ...looseUnits].forEach((u, i) => { for (const id of u.ids) step.set(id, i); });
  for (const c of plain) {
    if (!holders.has(c.id)) continue;
    let s = Infinity;
    for (const e of members(c)) { const v = step.get(e.id); if (v !== undefined) s = Math.min(s, v); }
    if (Number.isFinite(s)) step.set(c.id, s);
  }
  placeArrows(els, step);
  return finish(els, step, units.length + looseUnits.length, "reading");
}

/* ------------------------------------------------------------------ camera */

export interface View { x: number; y: number; zoom: number }
export interface Box { x: number; y: number; w: number; h: number }

/**
 * Where the camera should be to keep `b` (the newest step) in view, or null when it already is. Prefers panning at the
 * current zoom; zooms out only when the step cannot fit; never zooms in. `vw`/`vh` are screen pixels.
 */
export function cameraFor(view: View, vw: number, vh: number, b: Box, margin = 40): View | null {
  const z = view.zoom;
  const sx0 = (b.x - view.x) * z, sy0 = (b.y - view.y) * z, sx1 = sx0 + b.w * z, sy1 = sy0 + b.h * z;
  if (sx0 >= margin && sy0 >= margin && sx1 <= vw - margin && sy1 <= vh - margin) return null;
  let nz = z;
  const fit = Math.min((vw - 2 * margin) / Math.max(1, b.w), (vh - 2 * margin) / Math.max(1, b.h));
  if (fit < z) nz = Math.max(0.05, fit);
  return { zoom: nz, x: b.x + b.w / 2 - vw / (2 * nz), y: b.y + b.h / 2 - vh / (2 * nz) };
}
