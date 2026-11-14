import type { Algo, LoadSpec, Role } from "./types";
import { detectRole } from "./detect";

/**
 * Compact load graph built from the drawing. Pure data, no DOM.
 *
 * v1 limits (deliberate, documented):
 *  - a node is any non-arrow element that is the bound end of at least one arrow;
 *  - an edge is an arrow bound at BOTH ends to such nodes, direction src -> dst whatever the arrowheads
 *    (a two-headed arrow is still one src -> dst flow);
 *  - free ends, arrow-to-arrow branches (end names another arrow) and group endpoints are ignored;
 *  - an edge INTO an entry node is treated as a return/response path: it carries nothing and is left out of its
 *    source's split (otherwise a "response" arrow would be modelled as fresh traffic).
 */
export const ROLES: readonly Role[] = ["entry", "service", "lb", "limiter", "cache", "queue", "db"];
export const ENTRY = 0, SERVICE = 1, LB = 2, LIMITER = 3, CACHE = 4, QUEUE = 5, DB = 6;
export const ALGOS: readonly Algo[] = ["token", "leaky", "fixed", "sliding"];
export const TOKEN = 0, LEAKY = 1, FIXED = 2, SLIDING = 3;
/** default service time in ms per role, indexed by role code */
export const DEFAULT_MS: readonly number[] = [0, 20, 1, 1, 1, 2, 8];
export const MAX_NODES = 3000, MAX_EDGES = 6000;

export interface ElLike {
  id: string; kind: string; iconId: string; text: string; src: string; dst: string;
  load?: LoadSpec | undefined;
}
export interface TooLarge { tooLarge: true; nodes: number; edges: number }

export interface Graph {
  tooLarge?: false;
  n: number; m: number;
  ids: string[]; names: string[]; eids: string[];
  nodeIndex: Map<string, number>; edgeIndex: Map<string, number>;
  /** role / limiter-algo codes (see constants above) */
  role: Uint8Array; algo: Uint8Array;
  /** effective capacity: cap*rep (limiter: min(limit, cap*rep); queue: drain rate); Infinity when hasCap = 0 */
  cap: Float64Array; hasCap: Uint8Array;
  ms: Float64Array;
  rate: Float64Array; retries: Float64Array; backoff: Uint8Array;
  spikeMult: Float64Array; spikeStart: Float64Array; spikeDur: Float64Array;
  hit: Float64Array; depth: Float64Array; burst: Float64Array;
  esrc: Int32Array; edst: Int32Array;
  /** per edge: share of the source's output * fan-out x (0 for edges into entries) */
  coef: Float64Array;
  /** CSR of live edges: out-edges and in-edges of node v are outEdge[outStart[v]..outStart[v+1]) etc. */
  outStart: Int32Array; outEdge: Int32Array; inStart: Int32Array; inEdge: Int32Array;
  /** evaluation order: reverse DFS post-order from the entries (topological for DAGs) */
  ord: Int32Array;
  entries: Int32Array;
}

export function isTooLarge(g: Graph | TooLarge): g is TooLarge { return g.tooLarge === true }

const num = (v: unknown, def: number, lo: number, hi: number): number =>
  typeof v === "number" && v === v ? (v < lo ? lo : v > hi ? hi : v) : def;

function firstLine(s: string): string { const i = s.indexOf("\n"); return (i < 0 ? s : s.slice(0, i)).trim() }

export function buildGraph(
  els: Iterable<ElLike>,
  roleOf: (e: { kind: string; iconId: string; text: string }) => Role | null = detectRole,
): Graph | TooLarge {
  const byId = new Map<string, ElLike>();
  const arrows: ElLike[] = [];
  for (const e of els) { if (e.kind === "arrow") arrows.push(e); else byId.set(e.id, e); }

  const nodeIndex = new Map<string, number>();
  const nodes: ElLike[] = [];
  const touch = (id: string): number => {
    if (!id) return -1;
    let i = nodeIndex.get(id);
    if (i !== undefined) return i;
    const e = byId.get(id);
    if (!e) return -1;
    i = nodes.push(e) - 1; nodeIndex.set(id, i);
    return i;
  };
  const es: number[] = [], ed: number[] = [], eEl: ElLike[] = [];
  for (const a of arrows) {
    const s = touch(a.src), d = touch(a.dst);
    if (nodes.length > MAX_NODES) return { tooLarge: true, nodes: nodes.length, edges: es.length };
    if (s >= 0 && d >= 0) {
      es.push(s); ed.push(d); eEl.push(a);
      if (es.length > MAX_EDGES) return { tooLarge: true, nodes: nodes.length, edges: es.length };
    }
  }
  const n = nodes.length, m = es.length;
  const g: Graph = {
    n, m, ids: [], names: [], eids: eEl.map((a) => a.id), nodeIndex, edgeIndex: new Map(),
    role: new Uint8Array(n), algo: new Uint8Array(n), cap: new Float64Array(n), hasCap: new Uint8Array(n),
    ms: new Float64Array(n), rate: new Float64Array(n), retries: new Float64Array(n), backoff: new Uint8Array(n),
    spikeMult: new Float64Array(n).fill(1), spikeStart: new Float64Array(n), spikeDur: new Float64Array(n),
    hit: new Float64Array(n), depth: new Float64Array(n), burst: new Float64Array(n),
    esrc: Int32Array.from(es), edst: Int32Array.from(ed), coef: new Float64Array(m),
    outStart: new Int32Array(n + 1), outEdge: new Int32Array(m), inStart: new Int32Array(n + 1), inEdge: new Int32Array(m),
    ord: new Int32Array(n), entries: new Int32Array(0),
  };
  for (let e = 0; e < m; e++) g.edgeIndex.set(g.eids[e]!, e);

  // effective spec per node = stored `load` over role defaults
  const entryList: number[] = [];
  for (let i = 0; i < n; i++) {
    const el = nodes[i]!, sp: LoadSpec = el.load ?? {};
    const r = sp.role !== undefined && ROLES.includes(sp.role) ? sp.role : (roleOf(el) ?? "service");
    const rc = ROLES.indexOf(r);
    g.ids.push(el.id);
    g.names.push(firstLine(el.text) || (el.iconId ? el.iconId.replace(/^logo-/, "") : r));
    g.role[i] = rc;
    if (rc === ENTRY) entryList.push(i);
    const rep = num(sp.rep, 1, 1, 1000);
    const total = sp.cap === undefined ? Infinity : num(sp.cap, Infinity, 0, 1e12) * rep;
    const lim = rc === LIMITER && sp.limit !== undefined ? num(sp.limit, Infinity, 0, 1e12) : Infinity;
    const cap = Math.min(total, lim);
    g.cap[i] = cap; g.hasCap[i] = cap < Infinity ? 1 : 0;
    g.ms[i] = num(sp.ms, DEFAULT_MS[rc]!, 0, 60000);
    g.rate[i] = rc === ENTRY ? num(sp.rate, 0, 0, 1e12) : 0;
    g.retries[i] = num(sp.retries, 0, 0, 5);
    g.backoff[i] = sp.backoff === 1 ? 1 : 0;
    if (sp.spike && sp.spike.length === 3) {
      g.spikeMult[i] = num(sp.spike[0], 1, 0, 100); g.spikeStart[i] = num(sp.spike[1], 0, 0, 1e6); g.spikeDur[i] = num(sp.spike[2], 0, 0, 1e6);
    }
    g.hit[i] = num(sp.hit, 80, 0, 100) / 100;
    g.depth[i] = num(sp.depth, 100000, 0, 1e12);
    g.algo[i] = Math.max(0, ALGOS.indexOf(sp.algo ?? "token"));
    g.burst[i] = sp.burst === undefined ? cap : num(sp.burst, cap, 0, 1e12);
  }
  g.entries = Int32Array.from(entryList);

  // live edges into CSR (edges into an entry are return paths and are dropped)
  const live = new Uint8Array(m);
  for (let e = 0; e < m; e++) {
    if (g.role[ed[e]!] === ENTRY) continue;
    live[e] = 1; g.outStart[es[e]! + 1]!++; g.inStart[ed[e]! + 1]!++;
  }
  for (let i = 0; i < n; i++) { g.outStart[i + 1]! += g.outStart[i]!; g.inStart[i + 1]! += g.inStart[i]!; }
  const po = g.outStart.slice(0, n), pi = g.inStart.slice(0, n);
  for (let e = 0; e < m; e++) if (live[e]) { g.outEdge[po[es[e]!]!++] = e; g.inEdge[pi[ed[e]!]!++] = e; }

  // split: outgoing edges share the node's output by weight `w` (default 1), each multiplied by fan-out `x`.
  // An lb whose out-edges have NO explicit weight splits by downstream capacity when all of them have one
  // ("spread by capacity"), else evenly.
  for (let v = 0; v < n; v++) {
    const a = g.outStart[v]!, b = g.outStart[v + 1]!;
    if (a === b) continue;
    let anyW = false, allCap = true;
    for (let k = a; k < b; k++) {
      const e = g.outEdge[k]!;
      if (eEl[e]!.load?.w !== undefined) anyW = true;
      if (!g.hasCap[ed[e]!]) allCap = false;
    }
    const spread = g.role[v] === LB && !anyW && allCap;
    let sum = 0;
    for (let k = a; k < b; k++) {
      const e = g.outEdge[k]!;
      const w = spread ? g.cap[ed[e]!]! : num(eEl[e]!.load?.w, 1, 0, 1e6);
      g.coef[e] = w; sum += w;
    }
    for (let k = a; k < b; k++) {
      const e = g.outEdge[k]!;
      g.coef[e] = sum > 0 ? (g.coef[e]! / sum) * num(eEl[e]!.load?.x, 1, 0, 100) : 0;
    }
  }

  // evaluation order: iterative DFS from entries, then from anything not yet seen; reverse post-order
  const seen = new Uint8Array(n), post: number[] = [], stack = new Int32Array(n), pos = new Int32Array(n);
  const dfs = (root: number) => {
    if (seen[root]) return;
    let sp = 0; stack[sp++] = root; seen[root] = 1; pos[root] = g.outStart[root]!;
    while (sp) {
      const v = stack[sp - 1]!;
      if (pos[v]! < g.outStart[v + 1]!) {
        const w = ed[g.outEdge[pos[v]!++]!]!;
        if (!seen[w]) { seen[w] = 1; pos[w] = g.outStart[w]!; stack[sp++] = w; }
      } else { post.push(v); sp--; }
    }
  };
  for (const r of entryList) dfs(r);
  for (let i = 0; i < n; i++) dfs(i);
  for (let i = 0; i < n; i++) g.ord[i] = post[n - 1 - i]!;
  return g;
}
