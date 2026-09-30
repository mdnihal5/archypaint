import type { El } from "../scene";

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
