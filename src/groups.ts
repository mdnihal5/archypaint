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

  private computeBounds(gid: string): Box | null {
    const ids = this.membersOf(gid);
    if (!ids.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, depth = 0;
    for (const id of ids) {
      const e = this.scene.els.get(id);
      if (!e) continue;
      if (e.x < x0) x0 = e.x; if (e.y < y0) y0 = e.y;
      if (e.x + e.w > x1) x1 = e.x + e.w; if (e.y + e.h > y1) y1 = e.y + e.h;
      depth = Math.max(depth, e.groupIds.indexOf(gid));
    }
    if (x0 === Infinity) return null;
    const pad = 12 + 10 * depth;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  }
}
const EMPTY: readonly string[] = [];
