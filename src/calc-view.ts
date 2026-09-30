import type { CalcRow } from "./calc";
import type { El } from "./scene";
import type { Theme } from "./theme";

/**
 * Entry-side glue for capacity notes (kind "calc"). The evaluator (src/calc.ts, ~5 KB) is a lazy chunk: the renderer asks
 * calcRows() for an element's results; until the chunk has loaded it draws the raw lines and a repaint is requested when
 * it lands. Results are cached per element and recomputed only when its text or version changed — never per frame.
 */
export const CALC_LINE = 20;
export const CALC_PAD = 12;
const CHAR_W = 7.9; // mono 13px advance
const RESULT_W = 132; // room kept for the right-hand result column

export const SAMPLE = "# capacity estimate\ndau = 10M\nreqs_per_user = 20\nqps = dau * reqs_per_user / day\npeak = qps * 3\nstorage_per_day = dau * reqs_per_user * 2KB";

/** note size for a text: one row per line, wide enough for the longest line plus the result column */
export function calcSize(text: string): { w: number; h: number } {
  const lines = text.split("\n", 40);
  let longest = 0;
  for (const l of lines) if (l.length > longest) longest = l.length;
  return { w: Math.round(Math.max(280, Math.min(640, longest * CHAR_W + RESULT_W + 2 * CALC_PAD))), h: 2 * CALC_PAD + Math.max(3, lines.length) * CALC_LINE + 6 };
}

type Mod = typeof import("./calc");
type Draw = typeof import("./calc-draw").drawCalc;
let mod: Mod | null = null;
let draw: Draw | null = null;
let loading: Promise<Mod> | null = null;
let failedAt = -1e9;
const ready = new Set<() => void>();
const cache = new WeakMap<object, { v: number; t: string; rows: CalcRow[] }>();

/** start loading the evaluator (idempotent). A failed load can be retried by calling again. */
export function ensureCalc(): Promise<Mod> {
  if (mod) return Promise.resolve(mod);
  loading ??= Promise.all([import("./calc"), import("./calc-draw")]).then(([m, d]) => { mod = m; draw = d.drawCalc; for (const f of [...ready]) f(); return m; }, (e) => { loading = null; failedAt = performance.now(); throw e; });
  return loading;
}

/** background load from a draw path: a failed load is retried at most every 4 s, never once per frame */
function kick(): void { if (!mod && performance.now() - failedAt > 4000) void ensureCalc().catch(() => {}); }

/** called whenever the evaluator finishes loading; returns an unsubscribe fn */
export function onCalcReady(cb: () => void): () => void { ready.add(cb); return () => { ready.delete(cb); }; }

/** rows for a calc element, or null while the evaluator is still loading (the caller draws the raw text) */
export function calcRows(e: { version: number; text: string }): CalcRow[] | null {
  const c = cache.get(e);
  if (c && c.v === e.version && c.t === e.text) return c.rows;
  if (!mod) { kick(); return null; }
  const rows = mod.evalCalc(e.text);
  cache.set(e, { v: e.version, t: e.text, rows });
  return rows;
}

/** draw a capacity note: the real renderer lives in the lazy chunk; until it lands, a plain outline keeps the note visible */
export function drawCalcEl(ctx: CanvasRenderingContext2D, e: El, th: Theme, z: number, lod: boolean, hideText: boolean): void {
  if (draw) { draw(ctx, e, th, z, lod, hideText); return; }
  kick();
  ctx.globalAlpha = th.tint; ctx.fillStyle = th.cats[e.cat % th.cats.length]!; ctx.fillRect(e.x, e.y, e.w, e.h);
  ctx.globalAlpha = 1; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2; ctx.strokeRect(e.x, e.y, e.w, e.h);
}
