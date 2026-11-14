import type { Algo, LoadSpec, Role } from "../load/types";
import type { Graph } from "../load/graph";
import { detectRole } from "../load/detect";

/**
 * Pure logic of the Load card, scenario bar and chart (no DOM): which fields a role shows, typed-number parsing and
 * formatting ("10k", "2.5M"), UI validation (the same ranges as cleanLoad in io/format.ts, asserted by a test), card placement,
 * and the scenario time span.
 */

export const ROLE_LABEL: Record<Role, string> = { entry: "Entry", service: "Service", lb: "Load balancer", limiter: "Rate limiter", cache: "Cache", queue: "Queue", db: "Database" };
export const ROLE_ORDER: readonly Role[] = ["entry", "service", "lb", "limiter", "cache", "queue", "db"];
export const ALGO_LABEL: Record<Algo, string> = { token: "Token bucket", leaky: "Leaky bucket", fixed: "Fixed window", sliding: "Sliding window" };
export const ALGO_ORDER: readonly Algo[] = ["token", "leaky", "fixed", "sliding"];
export const ALGO_TEXT: Record<Algo, string> = {
  token: "Bursts up to the bucket size, then holds the steady rate.",
  leaky: "Smooths everything to one constant outflow; queues the rest.",
  fixed: "Counts per window. Cheap, but allows 2\u00d7 at a window edge.",
  sliding: "Counts over the last second. Smooth, no edge burst.",
};
/** tiny glyph paths (viewBox 0 0 64 30), one per algorithm */
export const ALGO_GLYPH: Record<Algo, string> = {
  token: "M2 26h12V8h10v18h10V8h10v18h14",
  leaky: "M2 26h60M2 14h60",
  fixed: "M2 26h18V6h10v20h4V6h10v20h18",
  sliding: "M2 24c10 0 8-14 18-14s8 14 18 14 8-14 18-14",
};

export type NumKey = "rate" | "retries" | "cap" | "rep" | "hit" | "depth" | "limit" | "burst" | "w" | "x";
export interface NumField { key: NumKey; label: string; min: number; max: number; int: boolean; unit: string; hint: string; placeholder: string }

const F = (key: NumKey, label: string, min: number, max: number, int: boolean, unit: string, hint: string, placeholder = ""): NumField => ({ key, label, min, max, int, unit, hint, placeholder });
/** ranges mirror LOAD_NUM in io/format.ts (load-fields.test.ts asserts they clamp identically) */
export const NUM: Record<NumKey, NumField> = {
  rate: F("rate", "Requests/s", 0, 1e9, false, "/s", "Requests per second this entry produces", "0"),
  retries: F("retries", "Retries per failure", 0, 5, true, "", "How many times a client retries a failed request", "0"),
  cap: F("cap", "Capacity per replica", 0, 1e9, false, "/s", "Requests per second one replica can serve", "unlimited"),
  rep: F("rep", "Replicas", 1, 1000, true, "", "Number of identical copies", "1"),
  hit: F("hit", "Hit rate", 0, 100, false, "%", "Share of requests answered from the cache", "80"),
  depth: F("depth", "Max depth", 0, 1e9, false, "", "Messages the queue holds before it drops new ones", "100k"),
  limit: F("limit", "Limit", 0, 1e9, false, "/s", "Requests per second let through", "none"),
  burst: F("burst", "Burst", 0, 1e9, false, "", "Bucket size: how much can pass at once", "= limit"),
  w: F("w", "Share weight", 0, 1000, false, "", "Relative share of the source's traffic sent along this arrow", "1"),
  x: F("x", "Calls per request", 0, 100, false, "", "How many downstream calls one request makes along this arrow", "1"),
};
/** spike [multiplier, start s, duration s] ranges, same as cleanLoad */
export const SPIKE = { mult: { min: 1, max: 100 }, start: { min: 0, max: 600 }, dur: { min: 1, max: 600 } } as const;
export const SPIKE_DEFAULT: [number, number, number] = [5, 5, 20];

/** which numeric fields a role shows, in order. Boolean/choice controls are handled by the card itself (see `extras`). */
export function fieldsFor(role: Role | "arrow", spec: LoadSpec = {}): NumKey[] {
  switch (role) {
    case "entry": return ["rate", "retries"];
    case "limiter": return spec.algo === "fixed" || spec.algo === "sliding" ? ["limit"] : ["limit", "burst"];
    case "service": case "db": case "lb": return ["cap", "rep"];
    case "cache": return ["hit", "cap"];
    case "queue": return ["cap", "depth"];
    case "arrow": return ["w", "x"];
  }
}
/** label override per role (a queue's capacity is its drain rate; a cache's is its own throughput) */
export function labelFor(role: Role | "arrow", key: NumKey): string {
  if (role === "queue" && key === "cap") return "Drain rate";
  if (role === "cache" && key === "cap") return "Capacity";
  return NUM[key].label;
}

/* ------------------------------------------------------------------ numbers */

/** "10k" -> 10000, "2.5M" -> 2.5e6, "1,000" -> 1000, "90%" -> 90, "1e3" -> 1000. null when it is not a number. */
export function parseNum(s: string): number | null {
  let t = s.trim().replace(/,/g, "").replace(/%$/, "").trim();
  if (t === "") return null;
  let mul = 1;
  const m = /[kKmMbB]$/.exec(t);
  if (m) { mul = m[0] === "k" || m[0] === "K" ? 1e3 : m[0] === "b" || m[0] === "B" ? 1e9 : 1e6; t = t.slice(0, -1).trim(); }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t) * mul;
  return Number.isFinite(n) ? n : null;
}

const trim = (x: number): string => String(parseFloat(x.toFixed(2)));
/** display form: 1500 -> "1.5k", 2500000 -> "2.5M", 80 -> "80" (display only; the focused input shows the exact number) */
export function formatNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return trim(n / 1e6) + "M";
  if (a >= 1e3) return trim(n / 1e3) + "k";
  return trim(n);
}

export type Checked = { ok: true; value: number | undefined } | { ok: false; msg: string };
/** validate typed text for a field. Empty = "use the default" (value undefined). Out of range / not a number = not ok (never clamped silently). */
export function checkNum(f: NumField, text: string): Checked {
  if (text.trim() === "") return { ok: true, value: undefined };
  const n = parseNum(text);
  if (n === null) return { ok: false, msg: "Type a number, like 500 or 10k" };
  if (n < f.min || n > f.max) return { ok: false, msg: `${formatNum(f.min)} to ${formatNum(f.max)}` };
  return { ok: true, value: f.int ? Math.round(n) : n };
}
export function checkSpike(i: 0 | 1 | 2, text: string): Checked {
  const r = i === 0 ? SPIKE.mult : i === 1 ? SPIKE.start : SPIKE.dur;
  const n = parseNum(text);
  if (n === null) return { ok: false, msg: "Type a number" };
  if (n < r.min || n > r.max) return { ok: false, msg: `${r.min} to ${r.max}` };
  return { ok: true, value: n };
}

/* ------------------------------------------------------------------ role */

export type DetectSource = "logo" | "icon" | "shape" | "label" | null;
/** where a detected role came from, for the "detected from ..." line; null = nothing detected */
export function detectSource(e: { kind: string; iconId: string; text: string }): DetectSource {
  if (detectRole({ kind: e.kind, iconId: e.iconId, text: "" }) !== null) return e.iconId ? (e.iconId.startsWith("logo-") ? "logo" : "icon") : "shape";
  return detectRole(e) !== null ? "label" : null;
}

/** kinds that can take a role: boxes, icons, logos. Text, frames, notes of the drawing itself and the like cannot. */
const NODE_KINDS = new Set(["rect", "ellipse", "diamond", "cylinder", "cloud", "hexagon", "parallelogram", "triangle", "star", "icon", "image"]);
export const canHaveRole = (kind: string): boolean => NODE_KINDS.has(kind);

/* ------------------------------------------------------------------ placement */

export interface Box { x: number; y: number; w: number; h: number }
export interface Bounds { l: number; t: number; r: number; b: number }
const hit = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where the card goes: beside the anchor (the selected element's screen box), preferring the right; flips to the left when the right
 * side does not fit; clamped inside `bounds` (which already exclude the top cluster and the dock). `avoid` boxes (chart, properties
 * panel) are dodged when a side is free of them. Returns the top-left corner.
 */
export function placeCard(anchor: Box, size: { w: number; h: number }, bounds: Bounds, avoid: readonly Box[] = [], gap = 14): { x: number; y: number; side: "r" | "l" } {
  const maxX = Math.max(bounds.l, bounds.r - size.w), maxY = Math.max(bounds.t, bounds.b - size.h);
  const y = Math.min(maxY, Math.max(bounds.t, anchor.y - 6));
  const clampX = (x: number) => Math.min(maxX, Math.max(bounds.l, x));
  const right = anchor.x + anchor.w + gap, left = anchor.x - gap - size.w;
  const fitsR = right + size.w <= bounds.r, fitsL = left >= bounds.l;
  const sides: ("r" | "l")[] = fitsR ? ["r", "l"] : fitsL ? ["l", "r"] : (bounds.r - (anchor.x + anchor.w) >= anchor.x - bounds.l ? ["r", "l"] : ["l", "r"]);
  let first: { x: number; y: number; side: "r" | "l" } | null = null;
  for (const s of sides) {
    const x = clampX(s === "r" ? right : left);
    const c = { x, y, side: s };
    first ??= c;
    if (!avoid.some((a) => hit({ x, y, w: size.w, h: size.h }, a))) return c;
  }
  return first!;
}

/* ------------------------------------------------------------------ scenario */

export interface Spike { mult: number; start: number; dur: number }
/** the entries of a graph that carry a spike, as [node index, spike] */
export function spikesOf(g: Graph): { v: number; s: Spike }[] {
  const out: { v: number; s: Spike }[] = [];
  for (const v of g.entries) if (g.spikeDur[v]! > 0) out.push({ v, s: { mult: g.spikeMult[v]!, start: g.spikeStart[v]!, dur: g.spikeDur[v]! } });
  return out;
}
/** timeline length in seconds: at least 60, or the end of the last spike plus 20 s to watch the recovery */
export function scenarioT(spikes: readonly Spike[]): number {
  let t = 60;
  for (const s of spikes) t = Math.max(t, s.start + s.dur + 20);
  return t;
}
export const TL_DT = 0.1;
/** frame index for a time in seconds, clamped to [0, steps - 1] */
export function frameAt(t: number, steps: number): number {
  return Math.max(0, Math.min(steps - 1, Math.floor(t / TL_DT + 1e-9)));
}
export function spikeLabel(sp: readonly { s: Spike }[]): string {
  if (sp.length === 0) return "";
  const a = sp[0]!.s, t = `Spike \u00d7${trim(a.mult)} for ${trim(a.dur)} s`;
  return sp.length > 1 ? `${t} (+${sp.length - 1} more)` : t;
}
export const fmtTime = (t: number): string => t.toFixed(1) + " s";
