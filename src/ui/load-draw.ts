import { labelBlock, pointAtT } from "../connectors";
import { isDarkPaper } from "../logos";
import { LIMITER, QUEUE } from "../load/graph";
import { fmt } from "../load/model";

/** Pure helpers of the Load view's drawing (no DOM, no canvas): colours, text, level of detail, chip placement, coalescing. */

export const CHIP_FS = 11;
/** an arrow carrying less than this (requests/s) shows nothing: a clean diagram has no "0/s" chips */
export const MIN_RATE = 0.5;
/** below this zoom the numbers would be under ~6 px tall: text goes, bars stay */
export const TEXT_MIN_ZOOM = 0.6;
/** a bar narrower than this on screen is noise */
export const BAR_MIN_PX = 14;

export interface LoadColours { ok: string; warn: string; bad: string }
/** status colours per theme, all >= 4.5:1 against that theme's paper (asserted in load-draw.test.ts) */
export const LIGHT_LOAD: LoadColours = { ok: "#0f7a5a", warn: "#9a6314", bad: "#c53030" };
export const DARK_LOAD: LoadColours = { ok: "#4fd1a5", warn: "#f0b84a", bad: "#ff7a6e" };
export const loadColours = (paper: string): LoadColours => (isDarkPaper(paper) ? DARK_LOAD : LIGHT_LOAD);

export type Level = "ok" | "warn" | "bad";
/** green below 70 %, amber below 100 %, red from 100 %; NaN (no capacity) has no level */
export function level(util: number): Level | null {
  return util !== util ? null : util >= 1 ? "bad" : util >= 0.7 ? "warn" : "ok";
}

export interface Lod { text: boolean; bar: boolean }
export const lod = (zoom: number, nodeW: number): Lod => ({ text: zoom >= TEXT_MIN_ZOOM, bar: nodeW * zoom >= BAR_MIN_PX });

export const rateText = (r: number): string => fmt(r) + "/s";
export const pctText = (u: number): string => (u >= 9.995 ? ">999%" : Math.round(u * 100) + "%");

export interface Readout { frac: number; level: Level; line: string; extra: string }
/**
 * What sits under a node that has a capacity: bar fill, "6.0k of 9.0k · 67%", and (only when non-zero) a red second line:
 * "rejected X/s" (limiter), "backlog +X/s" (queue growth), "dropped X/s" (everything else). `cap` is Infinity-free here.
 */
export function readout(role: number, inn: number, cap: number, util: number, dropped: number, growth: number, backlog = -1): Readout | null {
  const lv = level(util);
  if (lv === null) return null;
  let extra = "";
  if (role === QUEUE) {
    if (backlog >= 0) { if (backlog >= 1) extra = "backlog " + fmt(backlog); } // a timeline frame: the depth now
    else if (growth >= MIN_RATE) extra = "backlog +" + rateText(growth);
  }
  else if (dropped >= MIN_RATE) extra = (role === LIMITER ? "rejected " : "dropped ") + rateText(dropped);
  return { frac: Math.min(1, util), level: lv, line: `${fmt(inn)} of ${fmt(cap)} · ${pctText(util)}`, extra };
}

const overlap = (ax: number, ay: number, aw: number, ah: number, plates: readonly number[], pad: number): number => {
  let area = 0;
  for (let i = 0; i < plates.length; i += 4) {
    const w = Math.min(ax + aw + pad, plates[i]! + plates[i + 2]!) - Math.max(ax - pad, plates[i]!);
    const h = Math.min(ay + ah + pad, plates[i + 1]! + plates[i + 3]!) - Math.max(ay - pad, plates[i + 1]!);
    if (w > 0 && h > 0) area += w * h;
  }
  return area;
};

/** where along an arrow a chip is tried: the middle first, then alternating outwards */
export const CHIP_TS: readonly number[] = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

/**
 * Centre of the chip: the first t in CHIP_TS where it does not touch any label plate of the arrow (`plates` is flow.ts's
 * plateRects output). On an arrow too short or too crowded for that, the chip moves BESIDE the line (one plate-height up or
 * down along the normal) at the middle; if even that is taken, the least overlapping spot wins. out = [x, y].
 */
export function placeChip(pts: readonly number[], curve: boolean, w: number, h: number, plates: readonly number[], out: [number, number]): void {
  if (plates.length === 0) { pointAtT(pts, curve, 0.5, out); return; }
  let bx = 0, by = 0, best = Infinity;
  const tryAt = (x: number, y: number): boolean => {
    const a = overlap(x - w / 2, y - h / 2, w, h, plates, 2);
    if (a < best) { best = a; bx = x; by = y; }
    return a === 0;
  };
  for (const t of CHIP_TS) { pointAtT(pts, curve, t, out); if (tryAt(out[0], out[1])) { out[0] = bx; out[1] = by; return; } }
  let ph = 0;
  for (let i = 3; i < plates.length; i += 4) ph = Math.max(ph, plates[i]!);
  const off = ph / 2 + h / 2 + 2;
  pointAtT(pts, curve, 0.5, out);
  const x = out[0], y = out[1];
  pointAtT(pts, curve, 0.52, out);
  const dx = out[0] - x, dy = out[1] - y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  // prefer the side above the line (smaller y)
  const up = ny < 0 ? 1 : -1;
  if (!tryAt(x + nx * off * up, y + ny * off * up)) tryAt(x - nx * off * up, y - ny * off * up);
  out[0] = bx; out[1] = by;
}

/** chip plate size: the same box the renderer gives a connector label (`labelBlock`), at the chip's smaller size */
export function chipSize(text: string, measure: (s: string) => number): { w: number; h: number } {
  const b = labelBlock(text, CHIP_FS, measure);
  return { w: b.w, h: b.h };
}

/**
 * Coalesce any number of schedule() calls into ONE `fn` run on the next frame. Nothing is pending after the run or after
 * cancel(), so an idle view costs no timers or frames. `raf`/`caf` are injectable (tests use fake timers).
 */
export function createCoalescer(fn: () => void, raf: (cb: () => void) => number, caf: (id: number) => void): { schedule(): void; cancel(): void; pending(): boolean } {
  let id = 0, on = false;
  return {
    schedule() { if (on) return; on = true; id = raf(() => { on = false; id = 0; fn(); }); },
    cancel() { if (on) { caf(id); on = false; id = 0; } },
    pending: () => on,
  };
}
