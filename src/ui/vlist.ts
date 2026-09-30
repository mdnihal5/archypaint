/** Fixed-row-height windowing: which rows to render for a scroll position. Pure, so it is unit-tested. */
export interface Win { start: number; end: number; offset: number; total: number }

export function windowRows(scrollTop: number, viewH: number, rowH: number, count: number, overscan = 4): Win {
  const total = count * rowH;
  if (count <= 0 || rowH <= 0 || viewH <= 0) return { start: 0, end: 0, offset: 0, total };
  const st = Math.min(Math.max(0, scrollTop), Math.max(0, total - viewH));
  const start = Math.max(0, Math.floor(st / rowH) - overscan);
  const end = Math.min(count, Math.ceil((st + viewH) / rowH) + overscan);
  return { start, end, offset: start * rowH, total };
}

/** scrollTop that brings row `i` fully into view, or null if it already is */
export function revealScrollTop(i: number, scrollTop: number, viewH: number, rowH: number): number | null {
  const top = i * rowH, bottom = top + rowH;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewH) return bottom - viewH;
  return null;
}
