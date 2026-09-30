import type { El, GroupInfo } from "../scene";

export interface Row {
  kind: "group" | "shape";
  id: string;
  depth: number;
  label: string;
  cat: number;
  /** group rows: every descendant shape id (used for select / highlight) */
  members: readonly string[];
  expanded: boolean;
  hasChildren: boolean;
}

interface GNode { id: string; children: Array<GNode | El>; ids: string[] }

export interface SceneLike { readonly els: ReadonlyMap<string, El>; readonly groups: ReadonlyMap<string, GroupInfo> }

/** row label: the shape's own text, else what it is. Structured kinds get a readable name instead of their raw text. */
export const shapeLabel = (e: El): string => {
  if (e.kind === "legend") return "legend";
  if (e.kind === "badge") return `step ${e.n}`;
  if (e.kind === "lane") return `swimlane · ${e.text.split("\n")[0] ?? ""}`;
  if (e.kind === "brace") return "brace";
  return e.text || e.iconId || e.kind;
};

/**
 * Flatten the scene into layer rows: topmost (highest z) first, groups placed at their topmost member and nested by
 * groupIds (deepest -> shallowest). O(n log n) in shape count, run at most once per frame by the layers updater; the
 * DOM cost is separate and bounded by the visible window.
 */
export function buildRows(scene: SceneLike, collapsed: ReadonlySet<string>): Row[] {
  const sorted = [...scene.els.values()].sort((a, b) => b.z - a.z);
  const root: GNode = { id: "", children: [], ids: [] };
  const nodes = new Map<string, GNode>();
  for (const e of sorted) {
    let parent = root;
    for (let i = e.groupIds.length - 1; i >= 0; i--) {
      const gid = e.groupIds[i]!;
      let n = nodes.get(gid);
      if (!n) { n = { id: gid, children: [], ids: [] }; nodes.set(gid, n); parent.children.push(n); }
      n.ids.push(e.id);
      parent = n;
    }
    parent.children.push(e);
  }
  const rows: Row[] = [];
  const walk = (n: GNode, depth: number) => {
    for (const c of n.children) {
      if ("children" in c) {
        const info = scene.groups.get(c.id);
        const first = scene.els.get(c.ids[0]!);
        const expanded = !collapsed.has(c.id);
        rows.push({ kind: "group", id: c.id, depth, label: info?.name || "group", cat: info?.cat ?? first?.cat ?? 0, members: c.ids, expanded, hasChildren: c.children.length > 0 });
        if (expanded) walk(c, depth + 1);
      } else {
        rows.push({ kind: "shape", id: c.id, depth, label: shapeLabel(c), cat: c.cat, members: [], expanded: false, hasChildren: false });
      }
    }
  };
  walk(root, 0);
  return rows;
}

/** row index of a shape or the group that contains it (when its groups are collapsed), or -1 */
export function rowIndexOf(rows: readonly Row[], id: string): number {
  for (let i = 0; i < rows.length; i++) if (rows[i]!.id === id) return i;
  return -1;
}
