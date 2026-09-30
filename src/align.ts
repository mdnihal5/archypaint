/** Pure alignment / distribution / size-matching maths over "blocks" (an element, or a whole group treated as one box). */

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export interface Box { id: string; x: number; y: number; w: number; h: number }
export interface Delta { dx: number; dy: number }

export function unionOf(boxes: readonly Box[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** align every block to the selection bounds; blocks that already sit there are omitted */
export function alignBoxes(boxes: readonly Box[], mode: AlignMode): Map<string, Delta> {
  const out = new Map<string, Delta>();
  const u = unionOf(boxes);
  if (!u || boxes.length < 2) return out;
  for (const b of boxes) {
    let dx = 0, dy = 0;
    switch (mode) {
      case "left": dx = u.x - b.x; break;
      case "center": dx = u.x + u.w / 2 - (b.x + b.w / 2); break;
      case "right": dx = u.x + u.w - (b.x + b.w); break;
      case "top": dy = u.y - b.y; break;
      case "middle": dy = u.y + u.h / 2 - (b.y + b.h / 2); break;
      case "bottom": dy = u.y + u.h - (b.y + b.h); break;
    }
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) out.set(b.id, { dx, dy });
  }
  return out;
}

/** equalise the gaps between blocks along an axis; the outermost two stay where they are (needs >= 3 blocks) */
export function distributeBoxes(boxes: readonly Box[], axis: "h" | "v"): Map<string, Delta> {
  const out = new Map<string, Delta>();
  if (boxes.length < 3) return out;
  const pos = (b: Box) => (axis === "h" ? b.x : b.y), len = (b: Box) => (axis === "h" ? b.w : b.h);
  const s = [...boxes].sort((a, b) => pos(a) - pos(b) || (a.id < b.id ? -1 : 1));
  const first = s[0]!, last = s[s.length - 1]!;
  const span = pos(last) + len(last) - pos(first);
  let total = 0;
  for (const b of s) total += len(b);
  const gap = (span - total) / (s.length - 1);
  let cur = pos(first) + len(first) + gap;
  for (let i = 1; i < s.length - 1; i++) {
    const b = s[i]!, d = cur - pos(b);
    if (Math.abs(d) > 1e-9) out.set(b.id, axis === "h" ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    cur += len(b) + gap;
  }
  return out;
}

/** new sizes so every block matches the largest one in the chosen dimension (top-left stays fixed) */
export function matchSizes(boxes: readonly Box[], dim: "w" | "h" | "both"): Map<string, { w: number; h: number }> {
  const out = new Map<string, { w: number; h: number }>();
  if (boxes.length < 2) return out;
  let mw = 0, mh = 0;
  for (const b of boxes) { mw = Math.max(mw, b.w); mh = Math.max(mh, b.h); }
  for (const b of boxes) {
    const w = dim === "h" ? b.w : mw, h = dim === "w" ? b.h : mh;
    if (w !== b.w || h !== b.h) out.set(b.id, { w, h });
  }
  return out;
}

/** is `inner` completely inside `outer`? */
export function insideBox(outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
