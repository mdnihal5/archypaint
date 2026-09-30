import type { Scene } from "./scene";

export interface Match { /** element ids this match covers (a group-name match covers all its members) */ ids: readonly string[]; label: string }

/**
 * Lazy search index over labels, icon names, arrow labels and group names. The lowercase haystack strings are
 * built once per scene version (not per keystroke); a query only scans those strings.
 */
export class FindIndex {
  private nonce = -1;
  private hay: string[] = [];
  private targets: string[][] = [];
  private labels: string[] = [];
  constructor(private scene: Scene) {}

  private ensure(): void {
    if (this.nonce === this.scene.nonce) return;
    this.nonce = this.scene.nonce;
    this.hay.length = 0; this.targets.length = 0; this.labels.length = 0;
    const members = new Map<string, string[]>();
    for (const e of this.scene.els.values()) {
      for (const g of e.groupIds) { const a = members.get(g); if (a) a.push(e.id); else members.set(g, [e.id]); }
      let s = e.text;
      if (e.kind === "icon") s += " " + e.iconId.replace(/-/g, " ");
      if (e.kind === "lane") s = s.replace(/\n/g, " ");
      if (!s.trim()) continue;
      this.hay.push(s.toLowerCase()); this.targets.push([e.id]); this.labels.push(e.text || e.iconId);
    }
    for (const g of this.scene.groups.values()) {
      const ids = members.get(g.id);
      if (!ids || !g.name.trim()) continue;
      this.hay.push(g.name.toLowerCase()); this.targets.push(ids); this.labels.push(g.name);
    }
  }

  /** every entry containing all whitespace-separated tokens (order: creation order); empty query -> no matches */
  search(query: string, limit = 5000): Match[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    this.ensure();
    const toks = q.split(/\s+/);
    const out: Match[] = [];
    outer: for (let i = 0; i < this.hay.length; i++) {
      const h = this.hay[i]!;
      for (const t of toks) if (h.indexOf(t) < 0) continue outer;
      out.push({ ids: this.targets[i]!, label: this.labels[i]! });
      if (out.length >= limit) break;
    }
    return out;
  }
}
