import type { IconMeta } from "./icon-pack";
import { SHAPES, type ShapeDef } from "./shapes";
import { CATEGORIES } from "./theme";

/** bundled pack order in the UI (user packs follow, shapes last) and their display names */
export const PACK_ORDER = ["core", "generic2", "oss", "aws", "gcp", "azure"] as const;
const PACK_LABEL: Record<string, string> = { core: "Core", generic2: "Generic", oss: "Open source", aws: "AWS", gcp: "Google Cloud", azure: "Azure", shapes: "Shapes" };
/** vendor packs get the "original drawings, not affiliated" note */
export const VENDOR_PACKS: ReadonlySet<string> = new Set(["oss", "aws", "gcp", "azure"]);
export const sectionLabel = (pack: string): string => PACK_LABEL[pack] ?? (pack.startsWith("user-") ? pack.slice(5) : pack);
const packRank = (p: string): number => { const i = (PACK_ORDER as readonly string[]).indexOf(p); return i >= 0 ? i : p === "shapes" ? 99 : 50; };

const catRank = (c: string): number => { const i = (CATEGORIES as readonly string[]).indexOf(c); return i < 0 ? 99 : i; };

export interface Entry {
  kind: "icon" | "shape";
  id: string;
  name: string;
  category: string;
  /** shape entries: the editor tool to activate */
  tool?: string;
  aliases: readonly string[];
  /** pack the icon lives in ("shapes" for shape entries), vendor group and display name — used for grouping and filtering */
  pack: string; vendor: string; section: string; lsec: string;
  /** lowercase search fields, built once */
  lid: string; lname: string; lcat: string; laliases: string[];
  words: string[]; awords: string[];
}
export interface Hit { e: Entry; score: number }

const split = (s: string): string[] => s.split(/[\s\-_/]+/).filter(Boolean);

export function makeEntry(kind: Entry["kind"], id: string, name: string, category: string, aliases: readonly string[], tool?: string, pack = kind === "shape" ? "shapes" : "core", vendor = ""): Entry {
  const laliases = aliases.map((a) => a.toLowerCase());
  return {
    kind, id, name, category, tool, aliases, pack, vendor, section: sectionLabel(pack), lsec: sectionLabel(pack).toLowerCase(),
    lid: id.toLowerCase(), lname: name.toLowerCase(), lcat: category.toLowerCase(), laliases,
    words: split(id.toLowerCase() + " " + name.toLowerCase()), awords: laliases.flatMap(split),
  };
}

type IconLike = Pick<IconMeta, "id" | "name" | "aliases" | "category"> & Partial<Pick<IconMeta, "pack" | "vendor">>;

/** icon entries from the pack index + shape entries from src/shapes.ts (the editing workstream owns that list) */
export function buildIndex(icons: readonly IconLike[], shapes: readonly ShapeDef[] = SHAPES): Entry[] {
  const out = icons.map((i) => makeEntry("icon", i.id, i.name, i.category, i.aliases, undefined, i.pack ?? "core", i.vendor ?? ""));
  for (const d of shapes) out.push(makeEntry("shape", d.id, d.name, "shape", d.aliases, d.tool));
  return out;
}

/** subsequence match score 0..10 (0 = no match); tighter spans score higher */
function fuzzy(hay: string, t: string): number {
  let hi = 0, first = -1, last = -1;
  for (let ti = 0; ti < t.length; ti++) {
    const c = t.charCodeAt(ti);
    while (hi < hay.length && hay.charCodeAt(hi) !== c) hi++;
    if (hi >= hay.length) return 0;
    if (first < 0) first = hi;
    last = hi++;
  }
  const span = last - first + 1;
  return Math.max(1, 10 - Math.min(9, span - t.length));
}

const wordStarts = (words: string[], t: string): boolean => {
  for (let i = 0; i < words.length; i++) if (words[i]!.startsWith(t)) return true;
  return false;
};

/** score one token against one entry: exact > prefix > alias > substring > fuzzy. 0 = no match. */
export function scoreToken(e: Entry, t: string): number {
  if (e.lid === t || e.lname === t) return 100;
  for (let i = 0; i < e.laliases.length; i++) if (e.laliases[i] === t) return 90;
  if (e.lid.startsWith(t) || e.lname.startsWith(t)) return 80;
  if (wordStarts(e.words, t)) return 70;
  for (let i = 0; i < e.laliases.length; i++) if (e.laliases[i]!.startsWith(t)) return 60;
  if (wordStarts(e.awords, t)) return 55;
  if (e.lid.includes(t) || e.lname.includes(t)) return 45;
  for (let i = 0; i < e.laliases.length; i++) if (e.laliases[i]!.includes(t)) return 35;
  if (e.lcat.startsWith(t) || e.lsec.startsWith(t)) return 15;
  const f = Math.max(fuzzy(e.lid, t), fuzzy(e.lname, t));
  return f ? 15 + f : 0;
}

/** recycled Hit objects, so a keystroke allocates no per-result objects */
const POOL: Hit[] = [];

/**
 * Filter + rank into `out` (reused across keystrokes; caller owns it). Returns the count.
 * `category` restricts to one category and `source` to one pack ("all"/null = no restriction). Recents get a small boost on an empty query.
 */
export function search(index: readonly Entry[], query: string, category: string | null, out: Hit[], limit: number, recent?: ReadonlySet<string>, source?: string | null): number {
  const q = query.trim().toLowerCase();
  const multi = q.includes(" ") ? q.split(/\s+/) : null;
  let n = 0;
  for (let i = 0; i < index.length; i++) {
    const e = index[i]!;
    if (category && category !== "all" && e.category !== category) continue;
    if (source && source !== "all" && e.pack !== source) continue;
    let score: number;
    if (!q) score = recent?.has(e.id) ? 50 : 1;
    else if (multi) {
      score = 0;
      for (let k = 0; k < multi.length; k++) { const s = scoreToken(e, multi[k]!); if (!s) { score = 0; break; } score += s; }
    } else score = scoreToken(e, q);
    if (score <= 0) continue;
    let h = POOL[n];
    if (h) { h.e = e; h.score = score; } else { h = { e, score }; POOL[n] = h; }
    out[n++] = h;
  }
  out.length = n;
  if (q) out.sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length || (a.e.name < b.e.name ? -1 : 1));
  else out.sort((a, b) => b.score - a.score || packRank(a.e.pack) - packRank(b.e.pack) || catRank(a.e.category) - catRank(b.e.category) || (a.e.name < b.e.name ? -1 : 1)); // browse: pack order, canonical category order, then A-Z
  if (n > limit) out.length = limit;
  return out.length;
}

/** reorder so entries of one category are contiguous; groups ordered by their best score (stable) */
export function groupByCategory(hits: Hit[]): Hit[] {
  const best = new Map<string, number>();
  for (const h of hits) best.set(h.e.category, Math.max(best.get(h.e.category) ?? 0, h.score));
  return hits.map((h, i) => ({ h, i })).sort((a, b) => (best.get(b.h.e.category)! - best.get(a.h.e.category)!) || catRank(a.h.e.category) - catRank(b.h.e.category) || a.i - b.i).map((x) => x.h);
}


/** reorder so entries of one pack (section) are contiguous; sections ordered by best score, ties by canonical pack order */
export function groupBySection(hits: Hit[]): Hit[] {
  const best = new Map<string, number>();
  for (const h of hits) best.set(h.e.pack, Math.max(best.get(h.e.pack) ?? 0, h.score));
  return hits.map((h, i) => ({ h, i })).sort((a, b) => (best.get(b.h.e.pack)! - best.get(a.h.e.pack)!) || packRank(a.h.e.pack) - packRank(b.h.e.pack) || (a.h.e.pack < b.h.e.pack ? -1 : a.h.e.pack > b.h.e.pack ? 1 : 0) || a.i - b.i).map((x) => x.h);
}
