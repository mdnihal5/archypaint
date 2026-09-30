import { insideBox } from "./align";
import type { El, Scene } from "./scene";
import { CONTAINER_KINDS, LEGEND_PAD, LEGEND_ROW_H, LEGEND_TITLE_H, legendHeight } from "./shape-geom";

/** next number for a newly placed step badge: one more than the highest existing (1 when there are none) */
export function nextBadgeNumber(els: Iterable<{ kind: string; n: number }>): number {
  let m = 0;
  for (const e of els) if (e.kind === "badge" && e.n > m) m = e.n;
  return m + 1;
}

/** close gaps and duplicates: badges keep their relative order (by number, then creation order) and become 1..N */
export function renumberBadges(els: Iterable<{ id: string; kind: string; n: number; z: number }>): Map<string, number> {
  const list: Array<{ id: string; n: number; z: number }> = [];
  for (const e of els) if (e.kind === "badge") list.push(e);
  list.sort((a, b) => a.n - b.n || a.z - b.z);
  const out = new Map<string, number>();
  list.forEach((b, i) => { if (b.n !== i + 1) out.set(b.id, i + 1); });
  return out;
}

/** elements a container carries when it is dragged: everything fully inside it (arrows included), excluding locked ones */
export function frameChildren(scene: Scene, f: El, out: El[], scratch: El[]): void {
  scene.query(f.x, f.y, f.x + f.w, f.y + f.h, scratch);
  for (const c of scratch) {
    if (c === f || c.locked) continue;
    if (insideBox(f, c)) out.push(c);
  }
}
export const isContainer = (kind: string): boolean => CONTAINER_KINDS.has(kind);

/** legend content from what the document actually uses: category rows, then solid/dashed line rows */
export function buildLegend(els: Iterable<{ kind: string; cat: number; dash: number }>, catNames: readonly string[]): { text: string; w: number; h: number } {
  const cats = new Set<number>();
  let solid = false, dashed = false;
  for (const e of els) {
    if (e.kind === "legend" || e.kind === "text" || e.kind === "frame" || e.kind === "lane" || e.kind === "badge" || e.kind === "brace") continue;
    cats.add(e.cat);
    if (e.kind === "arrow") { if (e.dash) dashed = true; else solid = true; }
  }
  const rows: string[] = [];
  const list = cats.size ? [...cats].sort((a, b) => a - b) : catNames.map((_, i) => i);
  for (const c of list) rows.push(`c${c}|${catNames[c % catNames.length]}`);
  if (solid) rows.push("solid|solid = sync call");
  if (dashed) rows.push("dashed|dashed = async");
  return { text: rows.join("\n"), w: 200, h: legendHeight(rows.length) };
}
export const LEGEND_LAYOUT = { pad: LEGEND_PAD, row: LEGEND_ROW_H, title: LEGEND_TITLE_H };
