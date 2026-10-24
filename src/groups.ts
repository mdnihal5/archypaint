import type { El, Scene } from "./scene";

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Lazy group-membership index. Groups are a shared id in each member's groupIds
 * (deepest -> shallowest, Excalidraw-compatible); names live in Scene.groups. The index is rebuilt
 * only when the scene changed AND at least one group exists, so it costs nothing without groups.
 */
export class GroupIndex {
  private nonce = -1;
  private members = new Map<string, string[]>();
  /** bounds per group, valid for the current scene nonce: drawGroups asks for every group on every static frame (every pan frame) */
  private boxes = new Map<string, Box | null>();
  constructor(private scene: Scene) {}

  private ensure(): void {
    if (this.nonce === this.scene.nonce) return;
    this.nonce = this.scene.nonce;
    this.members.clear();
    this.boxes.clear();
    if (this.scene.groups.size === 0) return;
    for (const e of this.scene.els.values()) {
      for (const g of e.groupIds) {
        const a = this.members.get(g);
        if (a) a.push(e.id); else this.members.set(g, [e.id]);
      }
    }
  }

  membersOf(gid: string): readonly string[] { this.ensure(); return this.members.get(gid) ?? EMPTY; }

  /**
   * the ids selected by clicking `e`: the topmost group not yet "entered" (double-clicked into),
   * or just the element when it is not grouped or every group above it was entered.
   */
  unit(e: El, entered: ReadonlySet<string>): readonly string[] {
    for (let i = e.groupIds.length - 1; i >= 0; i--) {
      const g = e.groupIds[i]!;
      if (!entered.has(g)) return this.membersOf(g);
    }
    return [e.id];
  }

  /** the group that `unit` would select (undefined when the element is loose) */
  unitGroup(e: El, entered: ReadonlySet<string>): string | undefined {
    for (let i = e.groupIds.length - 1; i >= 0; i--) if (!entered.has(e.groupIds[i]!)) return e.groupIds[i];
    return undefined;
  }

  /** padded bounds of a group; nested groups get a wider boundary so outlines never coincide */
  bounds(gid: string): Box | null {
    this.ensure();
    const hit = this.boxes.get(gid);
    if (hit !== undefined) return hit;
    const b = this.computeBounds(gid);
    this.boxes.set(gid, b);
    return b;
  }

  /**
   * the group whose drawn boundary holds the point: anywhere inside its padded box, or on its name tag above the top edge.
   * The smallest such box wins (an inner group over its parent); groups the user entered (double-clicked into) are skipped, so
   * their empty space falls through to the marquee exactly as before. Returns the id of the group CLICKING there selects: the
   * topmost not-yet-entered group above the hit one (a nested group selects as part of its parent, like clicking a member does).
   */
  hitBoundary(px: number, py: number, entered: ReadonlySet<string>, slop = 0): string | undefined {
    this.ensure();
    if (this.scene.groups.size === 0) return undefined;
    let best: string | undefined, area = Infinity;
    for (const g of this.scene.groups.values()) {
      if (entered.has(g.id)) continue;
      const b = this.bounds(g.id);
      if (!b) continue;
      const inside = px >= b.x - slop && px <= b.x + b.w + slop && py >= b.y - slop && py <= b.y + b.h + slop;
      const tag = g.name !== "" && this.onTag(g.name, b, px, py);
      if (!inside && !tag) continue;
      const a = b.w * b.h;
      if (a < area) { area = a; best = g.id; }
    }
    if (best === undefined) return undefined;
    const first = this.scene.els.get(this.membersOf(best)[0] ?? "");
    return (first && this.unitGroup(first, entered)) ?? best;
  }

  /** the name tag is drawn left-aligned 12 units in from the box, with its baseline 8 above the top edge */
  onTag(name: string, b: Box, px: number, py: number): boolean {
    return px >= b.x + 8 && px <= b.x + 16 + name.length * TAG_CHAR_W && py >= b.y - 8 - TAG_H && py <= b.y;
  }

  /** the group whose name tag is under the point (a double-click there edits the name in place) */
  tagAt(px: number, py: number): string | undefined {
    this.ensure();
    let best: string | undefined, area = Infinity;
    for (const g of this.scene.groups.values()) {
      if (g.name === "") continue;
      const b = this.bounds(g.id);
      if (b && this.onTag(g.name, b, px, py) && b.w * b.h < area) { area = b.w * b.h; best = g.id; }
    }
    return best;
  }

  /** world-space rectangle of a group's name tag (what a double-click edits) */
  tagBox(gid: string): Box | null {
    const b = this.bounds(gid), g = this.scene.groups.get(gid);
    if (!b || !g) return null;
    const w = Math.max(48, g.name.length * TAG_CHAR_W + 8);
    return { x: b.x + 8, y: b.y - 8 - TAG_H, w, h: TAG_H + 8 };
  }

  private computeBounds(gid: string): Box | null {
    const ids = this.membersOf(gid), els: El[] = [];
    for (const id of ids) { const e = this.scene.els.get(id); if (e) els.push(e); }
    return groupBox(els, gid);
  }
}
const EMPTY: readonly string[] = [];
/** the monospace 13px tag: about 7.8 units per character, 16 tall */
const TAG_CHAR_W = 7.9, TAG_H = 16;

/** padded outline of group `gid` around its members (`els` = those members); nested groups get a wider boundary so outlines never coincide */
export function groupBox(els: readonly Pick<El, "x" | "y" | "w" | "h" | "groupIds">[], gid: string): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, depth = 0;
  for (const e of els) {
    if (e.x < x0) x0 = e.x; if (e.y < y0) y0 = e.y;
    if (e.x + e.w > x1) x1 = e.x + e.w; if (e.y + e.h > y1) y1 = e.y + e.h;
    depth = Math.max(depth, e.groupIds.indexOf(gid));
  }
  if (x0 === Infinity) return null;
  const pad = 12 + 10 * depth;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

export interface GroupOutline { id: string; name: string; cat: number; box: Box }
/**
 * outlines to draw for an export of `els`: every group whose members are ALL among `els` (a partial selection would draw a boundary
 * around only some members), parents and children both, in scene order. Pure: the same numbers the canvas uses.
 */
export function exportGroups(els: readonly Pick<El, "id" | "x" | "y" | "w" | "h" | "groupIds">[], groups: Iterable<{ id: string; name: string; cat: number }>, allMembers: (gid: string) => number): GroupOutline[] {
  const by = new Map<string, Pick<El, "id" | "x" | "y" | "w" | "h" | "groupIds">[]>();
  for (const e of els) for (const g of e.groupIds) { const a = by.get(g); if (a) a.push(e); else by.set(g, [e]); }
  const out: GroupOutline[] = [];
  for (const g of groups) {
    const m = by.get(g.id);
    if (!m || m.length !== allMembers(g.id)) continue;
    const box = groupBox(m, g.id);
    if (box) out.push({ id: g.id, name: g.name, cat: g.cat, box });
  }
  return out;
}
/** how far a group's name tag reaches above its box (baseline 8 above, plus the text height) and the box's right edge for a name of `chars` characters */
export const TAG_RISE = 24;
export const tagReach = (box: Box, chars: number): number => box.x + 12 + chars * TAG_CHAR_W;
