import type { El } from "../scene";

/** the ribbon's style controls; a control is shown when it does something for at least one selected element */
export type StyleCap = "colour" | "fill" | "edge" | "dash" | "size" | "align" | "route";
export type Caps = Record<StyleCap, boolean>;
const NONE: Caps = { colour: false, fill: false, edge: false, dash: false, size: false, align: false, route: false };
const BOX = { colour: true, fill: true, edge: true, dash: true, size: true, align: true, route: false } as const;
const KIND_CAPS: Record<string, Caps> = {
  text: { ...BOX, edge: false, dash: false }, // a free label: ink colour, an optional tint / solid box behind it
  rect: BOX,
  ellipse: { ...BOX, edge: false }, diamond: { ...BOX, edge: false },
  cylinder: BOX, cloud: BOX, hexagon: BOX, parallelogram: BOX, triangle: BOX, star: BOX, note: BOX,
  brace: { ...BOX, fill: false, size: false, align: false },
  frame: { ...BOX, align: false }, // the title is always at the left
  lane: { ...BOX, size: false, align: false }, badge: { ...BOX, size: false, align: false },
  icon: { ...BOX, dash: false, align: false },
  arrow: { colour: true, fill: false, edge: true, dash: true, size: true, align: false, route: true },
  legend: { ...NONE, edge: true },
  calc: { ...NONE, colour: true, fill: true },
  image: NONE,
};
/** which style controls apply to one element (a bare brand logo, fill "none", has no tile: colour and edge appear once it gets one) */
export function styleCaps(e: Pick<El, "kind" | "iconId" | "fill">): Caps {
  const c = KIND_CAPS[e.kind] ?? NONE;
  return e.kind === "icon" && e.fill === 3 ? { ...c, colour: false, edge: false } : c;
}
/** true when the control applies to at least one of `els` */
export const anyCap = (els: readonly El[], cap: StyleCap): boolean => els.some((e) => styleCaps(e)[cap]);

/** the shared value of `get` across `els`, or undefined when empty or mixed */
export function commonValue<T>(els: readonly El[], get: (e: El) => T): T | undefined {
  if (!els.length) return undefined;
  const v = get(els[0]!);
  for (let i = 1; i < els.length; i++) if (get(els[i]!) !== v) return undefined;
  return v;
}

/** deepest group id present in every element's groupIds, or null (deepest = lowest index, Excalidraw order) */
export function commonGroupId(els: readonly El[]): string | null {
  if (!els.length) return null;
  outer: for (const gid of els[0]!.groupIds) {
    for (let i = 1; i < els.length; i++) if (!els[i]!.groupIds.includes(gid)) continue outer;
    return gid;
  }
  return null;
}

/** first `cap` selected elements: enough to reflect current style without O(selection) work on select-all */
export function selectionEls(els: ReadonlyMap<string, El>, sel: ReadonlySet<string>, cap = 400): El[] {
  const out: El[] = [];
  for (const id of sel) { const e = els.get(id); if (e) out.push(e); if (out.length >= cap) break; }
  return out;
}
