import { CACHE, ENTRY, FIXED, LEAKY, LIMITER, QUEUE, SLIDING, TOKEN, type Graph } from "./graph";

/**
 * Fluid load model. Everything here is an ESTIMATE from rates (requests/s), not a simulation of individual requests
 * and not a load test. Latency is a MEAN (service time inflated by 1/(1-util), clamped at util 0.95 plus a "saturated"
 * flag); there are no percentiles. Fully deterministic; no randomness, no clocks.
 *
 * Numeric hygiene: every value written to a result is finite (inputs are clamped, intermediate rates are clamped to
 * BIG). The ONE sentinel is `util`, which is NaN for a node with no capacity (hasCap = 0): "no capacity" has no ratio.
 */
const BIG = 1e15;
const MAX_PASSES = 64;
const TOL = 1e-4;
const clampBig = (x: number) => (x > BIG ? BIG : x);

/** util = in / capacity, finite (a zero-capacity node that receives traffic reads as 1e6, i.e. hopelessly over) */
const ratio = (a: number, c: number) => (c > 0 ? Math.min(a / c, 1e6) : a > 0 ? 1e6 : 0);

export function fmt(n: number): string {
  const a = Math.abs(n);
  return a >= 1e6 ? (n / 1e6).toFixed(1) + "M" : a >= 1e5 ? Math.round(n / 1e3) + "k" : a >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n));
}

export interface Steady {
  g: Graph;
  converged: boolean; passes: number;
  /** per node: arriving rate, handled rate, shed rate (limiter: rejected/429), queue backlog growth per second */
  in: Float64Array; served: Float64Array; dropped: Float64Array; growth: Float64Array;
  /** in / capacity; NaN when hasCap = 0. A queue's util is in / drain rate. */
  util: Float64Array;
  /** mean latency this node adds in ms (when sat = 1 the number is only a floor: do not print it) */
  lat: Float64Array; sat: Uint8Array;
  /** entries: requests/s actually injected incl. retries, and injected / rate (1 for non-entries) */
  injected: Float64Array; amp: Float64Array;
  /** entries: expected end-to-end mean latency in ms, traffic-weighted over downstream paths; e2eSat = a saturated node is on a path */
  e2e: Float64Array; e2eSat: Uint8Array;
  /** per edge: carried rate */
  edge: Float64Array;
  warnings: string[];
}

/**
 * Steady state (t -> infinity). Per role:
 *  entry   produces `rate` (+ retries, below); ignores arriving edges.
 *  service/db/lb  served = min(in, cap*rep); the excess is dropped. (cap absent = unlimited)
 *  limiter admits min(in, limit); the excess is rejected (reported in `dropped`).
 *  cache   served = min(in, cap); only misses (1 - hit) flow on. An overloaded cache sheds its excess; real clients often fall
 *          back to the DB (stampede) and v1 does not model that.
 *  queue   passes min(in, drain); the excess accumulates: `growth` per second (in = served + growth, dropped = 0).
 * Output of a node is split over its live out-edges: edge = output * share(w) * x (see graph.ts).
 * Retries: failures F (everything dropped/rejected anywhere) are attributed to entries by their share of the base rate
 * and come back as F * retries * (backoff ? 0.35 : 1), never more than rate * (1 + retries * factor) per entry.
 * Cycles: Gauss-Seidel fixed point in evaluation order, <= 64 passes, tolerance 1e-4 (relative); every update is
 * monotone, so it climbs to the least fixed point; a loop with gain >= 1 will not settle -> converged = false + warning.
 */
export function steady(g: Graph): Steady {
  const { n, m, ord, outStart, outEdge, inStart, inEdge, edst, coef, role, cap, hasCap, entries } = g;
  const inn = new Float64Array(n), served = new Float64Array(n), dropped = new Float64Array(n), growth = new Float64Array(n);
  const util = new Float64Array(n), lat = new Float64Array(n), sat = new Uint8Array(n);
  const injected = new Float64Array(n), amp = new Float64Array(n).fill(1), outv = new Float64Array(n);
  const edge = new Float64Array(m);
  let totRate = 0;
  for (const j of entries) { injected[j] = g.rate[j]!; totRate += g.rate[j]!; }

  // `blown` = a value hit the BIG clamp: a diverging loop that sits on the clamp must not look converged
  let converged = false, passes = 0, blown = false;
  while (passes < MAX_PASSES && !converged) {
    passes++;
    let changed = false, F = 0;
    for (let k = 0; k < n; k++) {
      const v = ord[k]!, r = role[v]!, c = cap[v]!;
      let a = 0;
      if (r === ENTRY) a = injected[v]!;
      else for (let q = inStart[v]!; q < inStart[v + 1]!; q++) a += edge[inEdge[q]!]!;
      if (a > BIG) { a = BIG; blown = true; }
      let s: number, d = 0, o: number, gr = 0;
      if (r === ENTRY) { s = a; o = a; }
      else if (r === QUEUE) { o = Math.min(a, c); s = o; gr = a - o; }
      else { s = Math.min(a, c); d = a - s; o = r === CACHE ? s * (1 - g.hit[v]!) : s; }
      inn[v] = a; served[v] = s; dropped[v] = d; growth[v] = gr; outv[v] = o;
      util[v] = hasCap[v] ? ratio(a, c) : NaN;
      F += d;
      for (let q = outStart[v]!; q < outStart[v + 1]!; q++) {
        const e = outEdge[q]!;
        let nr = o * coef[e]!;
        if (nr > BIG) { nr = BIG; blown = true; }
        if (Math.abs(nr - edge[e]!) > TOL * nr + 1e-9) changed = true;
        edge[e] = nr;
      }
    }
    for (const j of entries) {
      const R = g.retries[j]! * (g.backoff[j] ? 0.35 : 1), base = g.rate[j]!;
      const want = Math.min(base + (totRate > 0 ? F * (base / totRate) * R : 0), base * (1 + R));
      if (Math.abs(want - injected[j]!) > TOL * want + 1e-9) changed = true;
      injected[j] = want;
    }
    converged = !changed && !blown;
  }

  for (const j of entries) amp[j] = g.rate[j]! > 0 ? injected[j]! / g.rate[j]! : 1;

  // mean latency per node: service time / (1 - min(util, 0.95)); util >= 1 is saturated
  for (let v = 0; v < n; v++) {
    const u = util[v]!;
    sat[v] = hasCap[v] && u >= 1 ? 1 : 0;
    lat[v] = g.ms[v]! / (1 - (hasCap[v] ? Math.min(u, 0.95) : 0));
  }
  // end-to-end: L[v] = lat[v] + sum over carrying out-edges of (pass fraction * share * x) * L[dst]; bounded passes (cycles)
  const L = Float64Array.from(lat), S = Uint8Array.from(sat);
  for (let p = 0; p < MAX_PASSES; p++) {
    let changed = false;
    for (let k = n - 1; k >= 0; k--) {
      const v = ord[k]!, pass = inn[v]! > 0 ? outv[v]! / inn[v]! : 1;
      let acc = lat[v]!, sv = sat[v]!;
      for (let q = outStart[v]!; q < outStart[v + 1]!; q++) {
        const e = outEdge[q]!;
        if (edge[e]! <= 0) continue;
        acc += pass * coef[e]! * L[edst[e]!]!;
        if (S[edst[e]!]) sv = 1;
      }
      acc = Math.min(acc, 1e9);
      if (Math.abs(acc - L[v]!) > TOL * acc + 1e-9 || sv !== S[v]) changed = true;
      L[v] = acc; S[v] = sv;
    }
    if (!changed) break;
  }

  const warnings: string[] = [];
  for (let v = 0; v < n; v++) {
    const nm = g.names[v]!, r = role[v]!;
    if (r === ENTRY) { if (amp[v]! > 1.2) warnings.push(`Retry amplification x${amp[v]!.toFixed(1)} at ${nm}`); }
    else if (r === QUEUE) { if (growth[v]! > 0.5) warnings.push(`${nm} backlog grows ${fmt(growth[v]!)}/s`); }
    else if (r === LIMITER) { if (dropped[v]! > 0.5) warnings.push(`${nm} rejects ${fmt(dropped[v]!)}/s (429)`); }
    else if (hasCap[v] && util[v]! > 1) warnings.push(`${nm} over capacity ${Math.round(util[v]! * 100)}%, drops ${fmt(dropped[v]!)}/s`);
  }
  if (!converged) warnings.push("A loop in the diagram did not settle: these numbers are the last estimate, not a steady state");

  return { g, converged, passes, in: inn, served, dropped, growth, util, lat, sat, injected, amp, e2e: L, e2eSat: S, edge, warnings };
}

export interface Timeline {
  steps: number; dt: number; nodes: number; edges: number;
  /** frame-major: [step * edges + e] */
  edgeRate: Float32Array;
  /** frame-major: [step * nodes + v]. util NaN where the node has no capacity. backlog: queue depth / buffered requests / leaky-bucket fill. wait: ms a request waits in that buffer. */
  util: Float32Array; dropped: Float32Array; backlog: Float32Array; wait: Float32Array;
  /** per step: total injected by entries / max(total base rate now, 1 s ago) (retry amplification, <= 1 + retries * factor) */
  amp: Float32Array;
}

/**
 * Time-stepped fluid simulation (deterministic, fixed dt), one sweep per step in evaluation order, so cost is
 * O(steps * (nodes + edges)). Back-edges of cycles read the previous step's value (a natural one-step delay).
 *  entry    rate * spike multiplier inside [start, start+dur); retries return exactly 1 s after the failure, bounded by
 *           base(t - 1 s) * retries * factor, so retries keep coming for ~1 s after a spike ends, then decay
 *           (invariant: retry rate at t <= base(t - 1 s) * retries * factor).
 *  service/db/lb/cache  serves up to capacity; the surplus waits in a buffer of 1 s of capacity (adds wait = buffer/cap),
 *           beyond that it is dropped.
 *  limiter  token: bucket `burst` (>= one step of refill) starts full, refills limit/s; leaky: queue of size burst drained
 *           at limit (smooths, adds wait, overflow rejected); fixed: 1 s windows count admitted, reset each window (a burst
 *           straddling a boundary can pass ~2x); sliding: admits so the admitted count over any rolling 1 s <= limit.
 *  queue    backlog grows by (in - drain), clamped at depth (overflow dropped).
 * Spike times are compared on the step grid; a spike shorter than dt may be missed.
 */
export function timeline(g: Graph, o: { dt?: number; T?: number } = {}): Timeline {
  const { n, m, ord, outStart, outEdge, coef, role, cap, hasCap, entries, edst, esrc } = g;
  const dt = Math.min(10, Math.max(0.001, o.dt ?? 0.1));
  const S = Math.max(1, Math.round(1 / dt));
  const steps = Math.max(0, Math.min(Math.round((o.T ?? 60) / dt), Math.floor(6e7 / (n + m + 1))));
  const tl: Timeline = {
    steps, dt, nodes: n, edges: m,
    edgeRate: new Float32Array(steps * m), util: new Float32Array(steps * n), dropped: new Float32Array(steps * n),
    backlog: new Float32Array(steps * n), wait: new Float32Array(steps * n), amp: new Float32Array(steps),
  };
  const tok = new Float64Array(n), cnt = new Float64Array(n), buf = new Float64Array(n), run = new Float64Array(n);
  const ringOff = new Int32Array(n).fill(-1);
  let nRing = 0;
  for (let v = 0; v < n; v++) {
    if (role[v] !== LIMITER || !hasCap[v]) continue;
    if (g.algo[v] === TOKEN) tok[v] = Math.max(g.burst[v]!, cap[v]! * dt);
    else if (g.algo[v] === SLIDING) { ringOff[v] = nRing; nRing += S; }
  }
  const ring = new Float64Array(nRing), failRing = new Float64Array(S), sumRing = new Float64Array(S);
  // inflow accumulators, filled by scatter as each node emits (no gather pass, no per-step edge copy).
  // A back-edge (its target is evaluated at or before its source) feeds `nxt`, i.e. arrives one step later.
  const acc = new Float64Array(n), nxt = new Float64Array(n), back = new Uint8Array(m), posOf = new Int32Array(n);
  for (let k = 0; k < n; k++) posOf[ord[k]!] = k;
  for (let e = 0; e < m; e++) back[e] = posOf[edst[e]!]! <= posOf[esrc[e]!]! ? 1 : 0;
  // base rate of each entry over the last S steps: a retry is bounded by the base rate when the failure happened
  const entPos = new Int32Array(n), baseRing = new Float64Array(entries.length * S);
  entries.forEach((j, k) => { entPos[j] = k; });
  let totRate = 0;
  for (const j of entries) totRate += g.rate[j]!;

  for (let i = 0; i < steps; i++) {
    const t = i * dt, slot = i % S, oF = i * n, oE = i * m;
    const Fold = failRing[slot]!;
    for (let v = 0; v < n; v++) { acc[v] = nxt[v]!; nxt[v] = 0; }
    let F = 0, injected = 0, baseSum = 0;
    for (let k = 0; k < n; k++) {
      const v = ord[k]!, r = role[v]!, c = cap[v]!;
      let a = 0, s: number, d = 0, out: number, u = hasCap[v] ? 0 : NaN, wt = 0;
      if (r === ENTRY) {
        const inSpike = t >= g.spikeStart[v]! - 1e-9 && t < g.spikeStart[v]! + g.spikeDur[v]! - 1e-9;
        const base = g.rate[v]! * (inSpike ? g.spikeMult[v]! : 1);
        const R = g.retries[v]! * (g.backoff[v] ? 0.35 : 1);
        const tot = totRate > 0 ? totRate : 1;
        const bi = entPos[v]! * S + slot, oldBase = baseRing[bi]!; // base(t - 1 s)
        baseRing[bi] = base;
        a = base + Math.min(Fold * (g.rate[v]! / tot) * R, oldBase * R);
        injected += a; baseSum += base;
        s = a; out = a;
      } else {
        a = acc[v]!;
        if (hasCap[v]) u = ratio(a, c);
        if (r === LIMITER) {
          if (!hasCap[v]) { s = a; }
          else if (g.algo[v] === TOKEN) {
            const tm = Math.max(g.burst[v]!, c * dt);
            tok[v] = Math.min(tm, tok[v]! + c * dt);
            s = Math.min(a, tok[v]! / dt); tok[v] = tok[v]! - s * dt; d = a - s;
          } else if (g.algo[v] === LEAKY) {
            const avail = a + buf[v]! / dt;
            s = Math.min(avail, c);
            let q2 = Math.max(0, buf[v]! + (a - s) * dt);
            if (q2 > g.burst[v]!) { d = (q2 - g.burst[v]!) / dt; q2 = g.burst[v]!; }
            buf[v] = q2; wt = c > 0 ? (q2 / c) * 1000 : 0;
          } else if (g.algo[v] === FIXED) {
            if (slot === 0) cnt[v] = 0;
            s = Math.min(a, Math.max(0, c - cnt[v]!) / dt); cnt[v] = cnt[v]! + s * dt; d = a - s;
          } else { // SLIDING: ring holds the admitted count of the last S steps; the oldest slot is freed first
            const idx = ringOff[v]! + slot;
            run[v] = Math.max(0, run[v]! - ring[idx]!);
            s = Math.min(a, Math.max(0, c - run[v]!) / dt);
            ring[idx] = s * dt; run[v] = run[v]! + s * dt; d = a - s;
          }
          out = s;
        } else if (!hasCap[v]) { s = a; out = r === CACHE ? s * (1 - g.hit[v]!) : s; }
        else {
          // service / db / lb / cache buffer 1 s of capacity; queue buffers `depth` and drains at cap
          const bmax = r === QUEUE ? g.depth[v]! : c;
          const avail = a + buf[v]! / dt;
          s = Math.min(avail, c);
          let b = Math.max(0, buf[v]! + (a - s) * dt);
          if (b > bmax) { d = (b - bmax) / dt; b = bmax; }
          buf[v] = b; wt = c > 0 ? (b / c) * 1000 : 0;
          out = r === CACHE ? s * (1 - g.hit[v]!) : s;
        }
      }
      F += d;
      for (let q = outStart[v]!; q < outStart[v + 1]!; q++) {
        const e = outEdge[q]!, r2 = clampBig(out * coef[e]!);
        tl.edgeRate[oE + e] = r2;
        const dd = edst[e]!;
        if (back[e]) nxt[dd] = nxt[dd]! + r2; else acc[dd] = acc[dd]! + r2;
      }
      tl.util[oF + v] = u; tl.dropped[oF + v] = d; tl.backlog[oF + v] = buf[v]!; tl.wait[oF + v] = wt;
    }
    failRing[slot] = F;
    // relative to the larger of the base now and 1 s ago (when the retried requests failed), so a spike's retry tail
    // after the spike ends reads as at most 1 + retries * factor, not as injected / the lower post-spike base
    const denom = Math.max(baseSum, sumRing[slot]!); sumRing[slot] = baseSum;
    tl.amp[i] = denom > 0 ? injected / denom : 1;
  }
  return tl;
}
