import type { El, ElJSON, GroupInfo, Scene } from "./scene";

export interface Change { id: string; before: ElJSON | null; after: ElJSON | null }
export interface GChange { id: string; before: GroupInfo | null; after: GroupInfo | null }
export interface Entry { label: string; key: string; t: number; ch: Change[]; gch: GChange[] }

interface Tx { els: Map<string, ElJSON | null>; groups: Map<string, GroupInfo | null> }

function sameEl(a: ElJSON | null, b: ElJSON | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k of Object.keys(a) as (keyof ElJSON)[]) {
    const x = a[k], y = b[k];
    if (x === y) continue;
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i])) continue;
    return false;
  }
  return true;
}
const sameGroup = (a: GroupInfo | null, b: GroupInfo | null) =>
  a === b || (!!a && !!b && a.name === b.name && a.cat === b.cat && a.collapsed === b.collapsed && a.locked === b.locked);

/**
 * Patch-based undo: a transaction records, for each element it touches, the state BEFORE the first
 * touch; at commit the AFTER state is read back. Only touched elements are stored (never a scene
 * clone), depth is capped, and undone/redone entries hold plain data only — no live element refs,
 * so removed elements are not retained.
 */
/** snapshots one entry holds (each Change keeps up to two element copies) */
const weightOf = (en: Entry): number => en.ch.length * 2 + en.gch.length;

export class History {
  /** bumps on every commit/undo/redo — the editor's "dirty" counter */
  rev = 0;
  /** max undo steps */
  cap = 200;
  /**
   * Max element snapshots across both stacks. The step cap alone does not bound memory: one "select all 5,000 and move"
   * step stores 10,000 element copies, so 200 of them would be ~2M copies (hundreds of MB). ~100k copies is tens of MB.
   * The oldest steps are dropped first; the newest step is always kept even if it alone is over the limit.
   */
  maxSnapshots = 100_000;
  private weight = 0;
  private undoS: Entry[] = [];
  private redoS: Entry[] = [];
  private tx: Tx | null = null;
  constructor(private scene: Scene) {}

  get active(): boolean { return this.tx !== null; }
  canUndo(): boolean { return this.undoS.length > 0; }
  canRedo(): boolean { return this.redoS.length > 0; }
  size(): number { return this.undoS.length + this.redoS.length; }

  begin(): void { if (!this.tx) this.tx = { els: new Map(), groups: new Map() }; }

  touch(e: El | undefined): void {
    if (!e || !this.tx || this.tx.els.has(e.id)) return;
    this.tx.els.set(e.id, this.scene.snapshot(e));
  }
  /** mark an element as created inside this transaction (before = nothing) */
  created(e: El): void { if (this.tx && !this.tx.els.has(e.id)) this.tx.els.set(e.id, null); }
  touchGroup(id: string): void {
    if (!this.tx || this.tx.groups.has(id)) return;
    const g = this.scene.groups.get(id);
    this.tx.groups.set(id, g ? { ...g } : null);
  }

  /** finish the transaction; returns false (and records nothing) when nothing really changed */
  commit(label: string, key = ""): boolean {
    const tx = this.tx; this.tx = null;
    if (!tx) return false;
    const ch: Change[] = [], gch: GChange[] = [];
    for (const [id, before] of tx.els) {
      const cur = this.scene.els.get(id);
      const after = cur ? this.scene.snapshot(cur) : null;
      if (!sameEl(before, after)) ch.push({ id, before, after });
    }
    for (const [id, before] of tx.groups) {
      const g = this.scene.groups.get(id);
      const after = g ? { ...g } : null;
      if (!sameGroup(before, after)) gch.push({ id, before, after });
    }
    if (!ch.length && !gch.length) return false;
    const now = performance.now();
    const last = this.undoS[this.undoS.length - 1];
    if (key && last && last.key === key && now - last.t < 600 && this.redoS.length === 0) {
      const byId = new Map(last.ch.map((c) => [c.id, c]));
      const w0 = weightOf(last);
      for (const c of ch) { const o = byId.get(c.id); if (o) o.after = c.after; else last.ch.push(c); }
      const gById = new Map(last.gch.map((c) => [c.id, c]));
      for (const c of gch) { const o = gById.get(c.id); if (o) o.after = c.after; else last.gch.push(c); }
      last.t = now;
      this.weight += weightOf(last) - w0;
    } else {
      const en: Entry = { label, key, t: now, ch, gch };
      this.undoS.push(en);
      this.weight += weightOf(en);
    }
    for (const r of this.redoS) this.weight -= weightOf(r);
    this.redoS.length = 0;
    while (this.undoS.length > 1 && (this.undoS.length > this.cap || this.weight > this.maxSnapshots)) this.weight -= weightOf(this.undoS.shift()!);
    this.rev++;
    return true;
  }

  /** roll back everything the open transaction touched (Escape during a live drag/resize) */
  abort(): string[] {
    const tx = this.tx; this.tx = null;
    if (!tx) return [];
    const ids: string[] = [];
    for (const [id, before] of tx.els) { this.apply(id, before); ids.push(id); }
    for (const [id, before] of tx.groups) this.applyGroup(id, before);
    return ids;
  }

  private apply(id: string, state: ElJSON | null): void {
    const cur = this.scene.els.get(id);
    if (!state) { if (cur) this.scene.remove(cur); }
    else if (cur) this.scene.restoreEl(cur, state);
    else this.scene.insertJSON(state);
  }
  private applyGroup(id: string, g: GroupInfo | null): void {
    if (g) this.scene.groups.set(id, { ...g }); else this.scene.groups.delete(id);
  }

  /** returns ids of elements whose state changed (for selection restore) or null if nothing to undo */
  undo(): string[] | null {
    const en = this.undoS.pop();
    if (!en) return null;
    for (const c of en.ch) this.apply(c.id, c.before);
    for (const c of en.gch) this.applyGroup(c.id, c.before);
    this.redoS.push(en);
    this.rev++; this.scene.nonce++;
    return en.ch.filter((c) => c.before).map((c) => c.id);
  }
  redo(): string[] | null {
    const en = this.redoS.pop();
    if (!en) return null;
    for (const c of en.ch) this.apply(c.id, c.after);
    for (const c of en.gch) this.applyGroup(c.id, c.after);
    this.undoS.push(en);
    this.rev++; this.scene.nonce++;
    return en.ch.filter((c) => c.after).map((c) => c.id);
  }

  clear(): void { this.undoS.length = 0; this.redoS.length = 0; this.tx = null; this.weight = 0; }
  /** stored element snapshots across both stacks (tests / diagnostics) */
  snapshots(): number { return this.weight; }
}
