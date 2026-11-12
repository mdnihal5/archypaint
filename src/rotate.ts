/**
 * Rotation of an element about its own centre. `angle` is radians, clockwise on screen (the canvas convention), absent = 0.
 * Only free text uses it so far; everything here is allocation-free (callers pass the out-parameter).
 */
export interface Box { x: number; y: number; w: number; h: number }
type Rotated = Box & { angle?: number | undefined };

/** how far above a text's top edge its rotate handle sits, in screen px */
export const ROT_HANDLE_PX = 26;
/** rotation snap step: 15 degrees */
export const SNAP = Math.PI / 12;

/** an angle folded into (-PI, PI] */
export function normAngle(a: number): number {
  const t = Math.PI * 2;
  let r = a % t;
  if (r > Math.PI) r -= t; else if (r <= -Math.PI) r += t;
  return r;
}

/** `a` rounded to the nearest 15 degrees, or left alone when `free` (Shift) */
export function snapAngle(a: number, free: boolean): number { return free ? a : Math.round(a / SNAP) * SNAP; }

/** a stored angle that is worth keeping: finite and not (nearly) zero. Everything else reads as "not rotated". */
export function cleanAngle(a: unknown): number | undefined {
  if (typeof a !== "number" || !Number.isFinite(a)) return undefined;
  const r = normAngle(a);
  return Math.abs(r) < 1e-6 ? undefined : r;
}

/** the axis-aligned bounds of the rotated rectangle, written into `out` (the plain rectangle when there is no angle) */
export function aabbInto(e: Rotated, out: Box): Box {
  const a = e.angle;
  if (!a) { out.x = e.x; out.y = e.y; out.w = e.w; out.h = e.h; return out; }
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = e.w * c + e.h * s, h = e.w * s + e.h * c, cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  out.x = cx - w / 2; out.y = cy - h / 2; out.w = w; out.h = h;
  return out;
}

/** world point -> the element's own (unrotated) frame, written into `out` */
export function toLocal(e: Rotated, px: number, py: number, out: [number, number]): void {
  const a = e.angle ?? 0, cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  if (!a) { out[0] = px; out[1] = py; return; }
  const c = Math.cos(a), s = Math.sin(a), dx = px - cx, dy = py - cy;
  out[0] = cx + dx * c + dy * s; out[1] = cy - dx * s + dy * c;
}

/** a point in the element's own frame -> the world, written into `out` */
export function toWorld(e: Rotated, lx: number, ly: number, out: [number, number]): void {
  const a = e.angle ?? 0, cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  if (!a) { out[0] = lx; out[1] = ly; return; }
  const c = Math.cos(a), s = Math.sin(a), dx = lx - cx, dy = ly - cy;
  out[0] = cx + dx * c - dy * s; out[1] = cy + dx * s + dy * c;
}
