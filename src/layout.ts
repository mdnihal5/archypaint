/**
 * Graph layout: layered (Sugiyama-lite). Pure — no DOM, no scene access; deterministic (same input, same output).
 * Consumers (auto-tidy, text import) depend only on layoutGraph().
 *
 *   1. components   connected pieces are laid out separately and packed side by side; isolated nodes go to a grid
 *   2. cycles       an iterative DFS reverses back edges (no recursion: 2,000-node chains must not blow the stack)
 *   3. layers       longest path, then sources are pulled next to their first successor (shorter edges)
 *   4. dummies      long edges get one dummy node per crossed layer, so they bend around nodes like real edges do
 *   5. crossings    a few bounded barycenter sweeps, then members of one cluster (group) are made contiguous
 *   6. coordinates  per layer, the positions closest to the neighbours' mean that still respect node separation — solved
 *                   exactly with pool-adjacent-violators in O(n) — alternating down / up / both, four passes
 *
 * Cost: O(V+E) per sweep plus an O(V log V) sort per layer; hard caps (MAX_NODES, MAX_EDGES, dummy budget) fall back to
 * a plain grid so a pathological sheet can never stall the tab.
 */
export interface LNode { id: string; w: number; h: number; /** nodes sharing a cluster (e.g. a group) stay adjacent within a layer */ cluster?: string }
export interface LEdge { from: string; to: string }
export interface LayoutOpts {
  /** "LR": layers run left to right (default). "TB": top to bottom */
  direction?: "LR" | "TB";
  /** horizontal gap: between layers for LR, between nodes of a layer for TB (default 80) */
  gapX?: number;
  /** vertical gap: between nodes of a layer for LR, between layers for TB (default 60) */
  gapY?: number;
  /** above this many nodes the layout degrades to a grid (default 2000) */
  maxNodes?: number;
}
export interface Pos { x: number; y: number }

export const MAX_NODES = 2000;
export const MAX_EDGES = 8000;
const SWEEPS = 4;
const POS_PASSES = 4;
const DUMMY_GAP = 14;

const size = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 1);

/** row-major grid, used for isolated nodes and as the capped fallback */
export function gridLayout(nodes: readonly LNode[], opts: LayoutOpts = {}): Map<string, Pos> {
  const gx = opts.gapX ?? 80, gy = opts.gapY ?? 60, out = new Map<string, Pos>();
  const n = nodes.length;
  if (!n) return out;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
  let cw = 1, ch = 1;
  for (const nd of nodes) { cw = Math.max(cw, size(nd.w)); ch = Math.max(ch, size(nd.h)); }
  nodes.forEach((nd, i) => { if (!out.has(nd.id)) out.set(nd.id, { x: (i % cols) * (cw + gx), y: Math.floor(i / cols) * (ch + gy) }); });
  return out;
}

interface Comp { nodes: number[]; w: number; h: number; pos: Map<number, Pos> }

export function layoutGraph(nodes: readonly LNode[], edges: readonly LEdge[], opts: LayoutOpts = {}): Map<string, Pos> {
  const out = new Map<string, Pos>();
  if (!nodes.length) return out;
  if (nodes.length > (opts.maxNodes ?? MAX_NODES) || edges.length > MAX_EDGES) return gridLayout(nodes, opts);

  const LR = (opts.direction ?? "LR") === "LR";
  const gapMain = LR ? (opts.gapX ?? 80) : (opts.gapY ?? 60);
  const gapCross = LR ? (opts.gapY ?? 60) : (opts.gapX ?? 80);

  // ---- index the real nodes (first occurrence of an id wins) and sanitise the edges
  const ids: string[] = [], W: number[] = [], H: number[] = [], clusterName: (string | undefined)[] = [];
  const idx = new Map<string, number>();
  for (const nd of nodes) { if (idx.has(nd.id)) continue; idx.set(nd.id, ids.length); ids.push(nd.id); W.push(size(nd.w)); H.push(size(nd.h)); clusterName.push(nd.cluster); }
  const n = ids.length;
  const seen = new Set<number>();
  const eu: number[] = [], ev: number[] = [];
  for (const e of edges) {
    const u = idx.get(e.from), v = idx.get(e.to);
    if (u === undefined || v === undefined || u === v) continue; // unknown endpoint or self-loop: nothing to lay out
    const key = u * n + v;
    if (seen.has(key)) continue;
    seen.add(key); eu.push(u); ev.push(v);
  }
  const clusterId = new Int32Array(n).fill(-1);
  { const m = new Map<string, number>(); for (let i = 0; i < n; i++) { const c = clusterName[i]; if (c === undefined) continue; let k = m.get(c); if (k === undefined) { k = m.size; m.set(c, k); } clusterId[i] = k; } }

  // ---- components (union-find, path halving)
  const parent = new Int32Array(n); for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; } return a; };
  const deg = new Int32Array(n);
  for (let i = 0; i < eu.length; i++) { const a = find(eu[i]!), b = find(ev[i]!); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); deg[eu[i]!]!++; deg[ev[i]!]!++; }
  const byRoot = new Map<number, number[]>();
  const isolated: number[] = [];
  for (let i = 0; i < n; i++) {
    if (deg[i] === 0) { isolated.push(i); continue; }
    const r = find(i);
    const a = byRoot.get(r);
    if (a) a.push(i); else byRoot.set(r, [i]);
  }
  const outAdj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < eu.length; i++) outAdj[eu[i]!]!.push(ev[i]!);

  // ---- lay out each component, then pack them along the cross axis
  const comps: Comp[] = [];
  for (const list of byRoot.values()) {
    const c = layoutComponent(list, outAdj, W, H, clusterId, LR, gapMain, gapCross);
    if (!c) return gridLayout(nodes, opts); // dummy budget exceeded
    comps.push(c);
  }
  let cross = 0, mainExtent = 0;
  for (const c of comps) {
    const mainSize = LR ? c.w : c.h, crossSize = LR ? c.h : c.w;
    for (const [i, p] of c.pos) out.set(ids[i]!, LR ? { x: p.x, y: p.y + cross } : { x: p.x + cross, y: p.y });
    cross += crossSize + gapCross * 1.5;
    mainExtent = Math.max(mainExtent, mainSize);
  }
  // isolated nodes: a grid after the last component (or at the origin when there are none)
  if (isolated.length) {
    let cw = 1, ch = 1;
    for (const i of isolated) { cw = Math.max(cw, W[i]!); ch = Math.max(ch, H[i]!); }
    const along = Math.max(1, LR ? Math.floor((mainExtent + gapMain) / (cw + gapMain)) : Math.floor((mainExtent + gapCross) / (cw + gapCross)));
    const cols = Math.max(1, Math.min(along || 1, Math.ceil(Math.sqrt(isolated.length * 1.6))));
    isolated.forEach((i, k) => {
      const col = k % cols, row = Math.floor(k / cols);
      if (LR) out.set(ids[i]!, { x: col * (cw + gapMain), y: cross + row * (ch + gapCross) });
      else out.set(ids[i]!, { x: cross + col * (cw + gapCross), y: row * (ch + gapMain) });
    });
  }
  for (const p of out.values()) { p.x = Math.round(p.x * 10) / 10; p.y = Math.round(p.y * 10) / 10; }
  return out;
}

/** layers + order + coordinates for one connected component; null when the long-edge dummy budget is exceeded */
function layoutComponent(list: number[], outAdj: number[][], W: number[], H: number[], clusterId: Int32Array, LR: boolean, gapMain: number, gapCross: number): Comp | null {
  const m = list.length;
  const local = new Map<number, number>(); list.forEach((g, i) => local.set(g, i));

  // -- break cycles: iterative DFS in input order; an edge into a node still on the stack is reversed
  const state = new Uint8Array(m);
  const dagSeen = new Set<number>();
  const dagU: number[] = [], dagV: number[] = [];
  const addDag = (u: number, v: number) => { const k = u * m + v; if (dagSeen.has(k)) return; dagSeen.add(k); dagU.push(u); dagV.push(v); };
  const stackNode: number[] = [], stackPtr: number[] = [];
  for (let s = 0; s < m; s++) {
    if (state[s]) continue;
    state[s] = 1; stackNode.push(s); stackPtr.push(0);
    while (stackNode.length) {
      const top = stackNode.length - 1, u = stackNode[top]!, nb = outAdj[list[u]!]!;
      const p = stackPtr[top]!;
      if (p >= nb.length) { state[u] = 2; stackNode.pop(); stackPtr.pop(); continue; }
      stackPtr[top] = p + 1;
      const v = local.get(nb[p]!)!;
      if (state[v] === 1) addDag(v, u); // back edge: reverse it
      else { addDag(u, v); if (!state[v]) { state[v] = 1; stackNode.push(v); stackPtr.push(0); } }
    }
  }
  const E = dagU.length;
  const succ: number[][] = Array.from({ length: m }, () => []);
  const indeg = new Int32Array(m);
  for (let i = 0; i < E; i++) { succ[dagU[i]!]!.push(dagV[i]!); indeg[dagV[i]!]!++; }

  // -- layers: Kahn order, longest path
  const layer = new Int32Array(m);
  const topo: number[] = [];
  const deg2 = Int32Array.from(indeg);
  for (let i = 0; i < m; i++) if (deg2[i] === 0) topo.push(i);
  for (let h = 0; h < topo.length; h++) {
    const u = topo[h]!;
    for (const v of succ[u]!) { if (layer[v]! < layer[u]! + 1) layer[v] = layer[u]! + 1; if (--deg2[v]! === 0) topo.push(v); }
  }
  // sources sit next to their nearest successor instead of at layer 0 (shorter edges, fewer dummies)
  for (let i = 0; i < m; i++) {
    if (indeg[i] !== 0 || !succ[i]!.length) continue;
    let mn = Infinity; for (const v of succ[i]!) if (layer[v]! < mn) mn = layer[v]!;
    if (mn - 1 > layer[i]!) layer[i] = mn - 1;
  }
  let L = 0; for (let i = 0; i < m; i++) if (layer[i]! + 1 > L) L = layer[i]! + 1;

  // -- dummies for edges spanning several layers
  let dummies = 0;
  for (let i = 0; i < E; i++) dummies += layer[dagV[i]!]! - layer[dagU[i]!]! - 1;
  if (dummies > 8 * m + 200) return null;
  const total = m + dummies;
  const lay = new Int32Array(total); lay.set(layer);
  const ups: number[][] = Array.from({ length: total }, () => []);
  const downs: number[][] = Array.from({ length: total }, () => []);
  const layers: number[][] = Array.from({ length: L }, () => []);
  let next = m;
  for (const u of topo) layers[layer[u]!]!.push(u);
  for (const u of topo) {
    for (const v of succ[u]!) {
      let prev = u;
      for (let l = layer[u]! + 1; l < layer[v]!; l++) {
        const d = next++; lay[d] = l; layers[l]!.push(d);
        downs[prev]!.push(d); ups[d]!.push(prev); prev = d;
      }
      downs[prev]!.push(v); ups[v]!.push(prev);
    }
  }

  // -- crossing reduction: bounded barycenter sweeps
  const order = new Int32Array(total);
  const key = new Float64Array(total);
  for (const L2 of layers) L2.forEach((v, i) => { order[v] = i; });
  const cl = (v: number): number => (v < m ? clusterId[list[v]!]! : -1);
  const sortLayer = (vs: number[], nbrs: number[][]): boolean => {
    for (const v of vs) {
      const nb = nbrs[v]!;
      if (!nb.length) { key[v] = order[v]!; continue; }
      let s = 0; for (const w of nb) s += order[w]!;
      key[v] = s / nb.length;
    }
    let anyCluster = false;
    for (const v of vs) if (cl(v) >= 0) { anyCluster = true; break; }
    let sk: Map<number, number> | null = null;
    if (anyCluster) {
      sk = new Map();
      const cnt = new Map<number, number>();
      for (const v of vs) { const c = cl(v); if (c < 0) continue; sk.set(c, (sk.get(c) ?? 0) + key[v]!); cnt.set(c, (cnt.get(c) ?? 0) + 1); }
      for (const [c, s] of sk) sk.set(c, s / cnt.get(c)!);
    }
    const before = vs.slice();
    vs.sort((a, b) => {
      const ca = cl(a), cb = cl(b);
      const ka = ca >= 0 && sk ? sk.get(ca)! : key[a]!, kb = cb >= 0 && sk ? sk.get(cb)! : key[b]!;
      return ka - kb || ca - cb || key[a]! - key[b]! || order[a]! - order[b]!;
    });
    let changed = false;
    for (let i = 0; i < vs.length; i++) { if (vs[i] !== before[i]) changed = true; order[vs[i]!] = i; }
    return changed;
  };
  for (let s = 0; s < SWEEPS; s++) {
    let changed = false;
    for (let l = 1; l < L; l++) changed = sortLayer(layers[l]!, ups) || changed;
    for (let l = L - 2; l >= 0; l--) changed = sortLayer(layers[l]!, downs) || changed;
    if (!changed) break;
  }
  if (L > 0) sortLayer(layers[0]!, downs); // make clusters contiguous even in a graph that never changed order

  // -- coordinates
  const crossSize = (v: number): number => (v < m ? (LR ? H[list[v]!]! : W[list[v]!]!) : 0);
  const sep = (a: number, b: number): number => (crossSize(a) + crossSize(b)) / 2 + (a >= m || b >= m ? DUMMY_GAP : gapCross);
  const c = new Float64Array(total);
  for (const vs of layers) { let x = 0; for (let i = 0; i < vs.length; i++) { if (i) x += sep(vs[i - 1]!, vs[i]!); c[vs[i]!] = x; } }
  const d = new Float64Array(Math.max(...layers.map((v) => v.length), 1));
  const P = new Float64Array(d.length), bSum = new Float64Array(d.length), bCnt = new Int32Array(d.length), bStart = new Int32Array(d.length), y = new Float64Array(d.length);
  const place = (vs: number[], primary: number[][] | null, secondary: number[][] | null): void => {
    const k = vs.length;
    for (let i = 0; i < k; i++) {
      const v = vs[i]!;
      let s = 0, cntN = 0;
      if (primary) for (const w of primary[v]!) { s += c[w]!; cntN++; }
      if (secondary) for (const w of secondary[v]!) { s += c[w]!; cntN++; }
      d[i] = cntN ? s / cntN : c[v]!;
    }
    P[0] = 0;
    for (let i = 1; i < k; i++) P[i] = P[i - 1]! + sep(vs[i - 1]!, vs[i]!);
    // pool adjacent violators on t_i = d_i - P_i (non-decreasing fit) = closest positions respecting all separations
    let nb = 0;
    for (let i = 0; i < k; i++) {
      bSum[nb] = d[i]! - P[i]!; bCnt[nb] = 1; bStart[nb] = i; nb++;
      while (nb > 1 && bSum[nb - 2]! / bCnt[nb - 2]! > bSum[nb - 1]! / bCnt[nb - 1]!) {
        bSum[nb - 2]! += bSum[nb - 1]!; bCnt[nb - 2]! += bCnt[nb - 1]!; nb--;
      }
    }
    for (let b = 0; b < nb; b++) { const end = b + 1 < nb ? bStart[b + 1]! : k, mean = bSum[b]! / bCnt[b]!; for (let i = bStart[b]!; i < end; i++) y[i] = mean; }
    for (let i = 0; i < k; i++) c[vs[i]!] = y[i]! + P[i]!;
  };
  for (let p = 0; p < POS_PASSES; p++) {
    if (p % 2 === 0) for (let l = 1; l < L; l++) place(layers[l]!, ups, p >= 2 ? downs : null);
    else for (let l = L - 2; l >= 0; l--) place(layers[l]!, downs, p >= 2 ? ups : null);
  }

  // -- to x / y, origin at the component's top-left
  const mainSize = (v: number): number => (LR ? W[list[v]!]! : H[list[v]!]!);
  const layerSize = new Float64Array(L), layerStart = new Float64Array(L);
  for (let v = 0; v < m; v++) layerSize[lay[v]!] = Math.max(layerSize[lay[v]!]!, mainSize(v));
  for (let l = 1; l < L; l++) layerStart[l] = layerStart[l - 1]! + layerSize[l - 1]! + gapMain;
  let minC = Infinity, maxC = -Infinity;
  for (let v = 0; v < m; v++) { const h = crossSize(v) / 2; minC = Math.min(minC, c[v]! - h); maxC = Math.max(maxC, c[v]! + h); }
  const pos = new Map<number, Pos>();
  for (let v = 0; v < m; v++) {
    const g = list[v]!, l = lay[v]!;
    const along = layerStart[l]! + (layerSize[l]! - mainSize(v)) / 2, across = c[v]! - crossSize(v) / 2 - minC;
    pos.set(g, LR ? { x: along, y: across } : { x: across, y: along });
  }
  const mainTotal = L ? layerStart[L - 1]! + layerSize[L - 1]! : 0, crossTotal = maxC - minC;
  return { nodes: list, w: LR ? mainTotal : crossTotal, h: LR ? crossTotal : mainTotal, pos };
}
