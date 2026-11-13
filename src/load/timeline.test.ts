import { describe, expect, it } from "vitest";
import { timeline, type Timeline } from "./model";
import { mk } from "./testkit";
import { buildGraph, isTooLarge, type ElLike, type Graph } from "./graph";
import type { LoadSpec } from "./types";

const tl = (nodes: Record<string, LoadSpec>, edges: [string, string, LoadSpec?][], o?: { dt?: number; T?: number }) => {
  const g = mk(nodes, edges);
  return { g, t: timeline(g, o) };
};
const er = (t: Timeline, step: number, e: number) => t.edgeRate[step * t.edges + e]!;
const series = (t: Timeline, e: number) => Array.from({ length: t.steps }, (_, i) => er(t, i, e));
const nodeSeries = (g: Graph, t: Timeline, arr: Float32Array, id: string) => Array.from({ length: t.steps }, (_, i) => arr[i * t.nodes + g.nodeIndex.get(id)!]!);
/** largest admitted amount over any `w` consecutive steps */
const maxRolling = (xs: number[], w: number, dt: number) => {
  let best = 0;
  for (let i = 0; i + w <= xs.length; i++) { let s = 0; for (let k = i; k < i + w; k++) s += xs[k]! * dt; best = Math.max(best, s); }
  return best;
};

describe("timeline: entry", () => {
  it("spike [x5, start 2 s, 3 s]: 100/s outside, 500/s inside [2, 5) (steps 20..49 at dt 0.1)", () => {
    const { t } = tl({ c: { role: "entry", rate: 100, spike: [5, 2, 3] }, a: { role: "service" } }, [["c", "a"]], { T: 10 });
    expect(t.steps).toBe(100);
    const s = series(t, 0);
    for (let i = 0; i < 100; i++) expect(s[i]).toBeCloseTo(i >= 20 && i < 50 ? 500 : 100, 3);
  });
  it("retries return 1 s late and never exceed base*(1+R*f) per step", () => {
    // limiter 50 (bucket 0 -> holds one step of refill, so rejects start at step 0) in front of 100/s clients with 3 retries: amp in [1, 4]; first second has no retries yet
    const { t } = tl({ c: { role: "entry", rate: 100, retries: 3 }, g: { role: "limiter", limit: 50, burst: 0 }, a: { role: "service" } }, [["c", "g"], ["g", "a"]], { T: 20 });
    for (let i = 0; i < 10; i++) expect(t.amp[i]).toBeCloseTo(1, 5);
    expect(t.amp[10]!).toBeGreaterThan(1);
    for (let i = 0; i < t.steps; i++) { expect(t.amp[i]!).toBeLessThanOrEqual(4 + 1e-5); expect(t.amp[i]!).toBeGreaterThanOrEqual(1); }
    expect(t.amp[t.steps - 1]!).toBeCloseTo(4, 3);
  });
  it("amplification stays <= 1 + R even in a spike's retry tail (x5 spike, 3 retries)", () => {
    // before the fix the tail read injected / post-spike base: (100 + 3*500) / 100 = x16. Now the denominator is
    // max(base now, base 1 s ago), so the tail is at most (100 + 3*500) / 500 = 3.2 and never above 1 + 3 = 4
    const { t } = tl({ c: { role: "entry", rate: 100, retries: 3, spike: [5, 2, 2] }, g: { role: "limiter", limit: 50, burst: 0 }, a: { role: "service" } }, [["c", "g"], ["g", "a"]], { T: 12 });
    let peak = 0;
    for (let i = 0; i < t.steps; i++) peak = Math.max(peak, t.amp[i]!);
    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThanOrEqual(4 + 1e-6);
  });

  it("spike end: retries continue ~1 s at the spike-era bound, then decay", () => {
    // base 100, x5 for [2,4) -> 500/s; limiter 50 (bucket 0) rejects almost everything; 2 retries, no backoff.
    // retry(t) <= base(t-1s)*2: up to 1000/s while t-1 is inside the spike (t in [3,5)), 200/s once t >= 5
    const { t } = tl({ c: { role: "entry", rate: 100, retries: 2, spike: [5, 2, 2] }, g: { role: "limiter", limit: 50, burst: 0 }, a: { role: "service" } }, [["c", "g"], ["g", "a"]], { T: 12 });
    const inj = (i: number) => er(t, i, 0), base = (i: number) => (i >= 20 && i < 40 ? 500 : 100);
    for (let i = 0; i < t.steps; i++) {
      const retry = inj(i) - base(i);
      const old = i >= 10 ? base(i - 10) : 0;
      expect(retry).toBeLessThanOrEqual(old * 2 + 1e-2);
    }
    // at t = 4.0..4.9 the spike is over but the bound still reflects base(t-1) = 500: retries well above the post-spike 2*100 bound
    expect(inj(45) - 100).toBeGreaterThan(200 + 1);
    // from t = 5.0 the bound is back to 2*100
    expect(inj(55) - 100).toBeLessThanOrEqual(200 + 1e-2);
  });
  it("backoff caps amplification at 1 + 3*0.35 = 2.05", () => {
    const { t } = tl({ c: { role: "entry", rate: 100, retries: 3, backoff: 1 }, g: { role: "limiter", limit: 50, burst: 0 }, a: { role: "service" } }, [["c", "g"], ["g", "a"]], { T: 20 });
    expect(Math.max(...t.amp)).toBeLessThanOrEqual(2.05 + 1e-5);
    expect(t.amp[t.steps - 1]!).toBeCloseTo(2.05, 3);
  });
});

describe("timeline: rate limiter algorithms (dt 0.1, so 10 steps per second)", () => {
  const lim = (spec: LoadSpec, entry: LoadSpec, T = 60) => tl({ c: { role: "entry", ...entry }, g: { role: "limiter", ...spec }, a: { role: "service" } }, [["c", "g"], ["g", "a"]], { T });

  it("token bucket: bucket 300 starts full, so 1000/s passes ~4 steps, then clamps to the refill rate 100/s", () => {
    // per step refill 10. step 0: tokens 300 -> admits 1000/s (100 req) -> 200; step 1: 210 -> 110; step 2: 120 -> 20; step 3: 30 -> 300/s? no:
    // admit = min(1000, tokens/dt): steps 0..2 have tokens/dt = 3000, 2100, 1200 -> all 1000/s; step 3 has 30 tokens -> 300/s
    const { t } = lim({ limit: 100, burst: 300, algo: "token" }, { rate: 1000 });
    const s = series(t, 1);
    expect(s.slice(0, 4)).toEqual([1000, 1000, 1000, 300]);
    // step 3 empties the bucket; from step 4 only the refill (10 per step = 100/s) is available
    expect(s[4]).toBeCloseTo(100, 2);
    for (let i = 4; i < t.steps; i++) expect(s[i]).toBeCloseTo(100, 2);
    // total = initial 300 + refill actually added (599 steps * 10; the first refill is cut by the full bucket) = 6290
    expect(s.reduce((a, b) => a + b * 0.1, 0)).toBeCloseTo(6290, -1);
  });

  it("fixed window: a burst straddling the boundary passes ~2x the limit; sliding never exceeds the limit over any rolling second", () => {
    // base 10/s, spike x100 = 1000/s for [0.5, 1.5); limit 100
    // fixed: window 0 had 5 steps * 1 = 5 admitted, spike step 5 admits the remaining 95; window 1 opens at 1.0 and admits 100 -> 195 within 1 s
    const entry: LoadSpec = { rate: 10, spike: [100, 0.5, 1] };
    const fx = lim({ limit: 100, algo: "fixed" }, entry, 5), sl = lim({ limit: 100, algo: "sliding" }, entry, 5);
    const mf = maxRolling(series(fx.t, 1), 10, 0.1), ms = maxRolling(series(sl.t, 1), 10, 0.1);
    expect(mf).toBeGreaterThan(190); expect(mf).toBeLessThan(200 + 1e-3);
    expect(ms).toBeLessThanOrEqual(100 + 1e-2);
    expect(mf).toBeGreaterThan(ms * 1.8);
  });

  it("fixed window: within one window never more than the limit", () => {
    const { t } = lim({ limit: 100, algo: "fixed" }, { rate: 1000 }, 5);
    const s = series(t, 1);
    for (let w = 0; w < 5; w++) expect(s.slice(w * 10, w * 10 + 10).reduce((a, b) => a + b * 0.1, 0)).toBeCloseTo(100, 2);
  });

  it("leaky bucket smooths: a 4x spike leaves at the drain rate (max 100/s), token bucket with a big burst lets it through (200/s)", () => {
    const entry: LoadSpec = { rate: 50, spike: [4, 1, 1] };
    const lk = lim({ limit: 100, burst: 500, algo: "leaky" }, entry, 10), tk = lim({ limit: 100, burst: 500, algo: "token" }, entry, 10);
    expect(Math.max(...series(lk.t, 1))).toBeLessThanOrEqual(100 + 1e-3);
    expect(Math.max(...series(tk.t, 1))).toBeCloseTo(200, 2);
    // leaky queue: the spike adds (200-100)/s * 1 s = 100 queued, then drains at 50/s net -> empty by t = 4; wait = backlog/limit
    const bl = nodeSeries(lk.g, lk.t, lk.t.backlog, "g");
    expect(Math.max(...bl)).toBeCloseTo(100, 2); expect(bl[bl.length - 1]).toBeCloseTo(0, 3);
    expect(Math.max(...nodeSeries(lk.g, lk.t, lk.t.wait, "g"))).toBeCloseTo(1000, 1); // 100 queued / 100 per s = 1 s
  });

  it("leaky bucket: queue overflow is rejected", () => {
    const { g, t } = lim({ limit: 100, burst: 50, algo: "leaky" }, { rate: 1000 }, 5);
    expect(Math.max(...nodeSeries(g, t, t.dropped, "g"))).toBeGreaterThan(800);
    for (const v of nodeSeries(g, t, t.backlog, "g")) expect(v).toBeLessThanOrEqual(50 + 1e-3);
  });
});

describe("timeline: queue, service buffer", () => {
  it("queue fills during a spike then drains: peak = (300-150)*2 s = 300, empty by t = 3 + 300/50 = 9", () => {
    const { g, t } = tl({ c: { role: "entry", rate: 100, spike: [3, 1, 2] }, q: { role: "queue", cap: 150 }, d: { role: "db" } }, [["c", "q"], ["q", "d"]], { T: 20 });
    const b = nodeSeries(g, t, t.backlog, "q");
    for (let i = 0; i < 10; i++) expect(b[i]).toBe(0);
    expect(Math.max(...b)).toBeCloseTo(300, 1); expect(b[29]).toBeCloseTo(300, 1);
    expect(b[b.length - 1]).toBeCloseTo(0, 3);
    expect(b[85]).toBeCloseTo(20, 1);           // net drain 5 per step from step 30: 300 - 5*56
    expect(b[89]).toBeCloseTo(0, 1);            // empty at step 89 (t = 9)
    expect(Math.max(...series(t, 1))).toBeCloseTo(150, 2); // db sees at most the drain rate
  });
  it("queue depth clamps and the overflow is dropped", () => {
    const { g, t } = tl({ c: { role: "entry", rate: 1000 }, q: { role: "queue", cap: 100, depth: 200 }, d: { role: "db" } }, [["c", "q"], ["q", "d"]], { T: 10 });
    const b = nodeSeries(g, t, t.backlog, "q");
    expect(Math.max(...b)).toBeCloseTo(200, 2);
    // steady: drops (1000 - 100) per s once full
    expect(nodeSeries(g, t, t.dropped, "q")[t.steps - 1]).toBeCloseTo(900, 1);
  });
  it("service buffers 1 s of capacity before dropping: cap 100, in 300 -> buffer fills at 200/s, full after 0.5 s, then drops 200/s", () => {
    const { g, t } = tl({ c: { role: "entry", rate: 300 }, a: { role: "service", cap: 100 } }, [["c", "a"]], { T: 5 });
    const b = nodeSeries(g, t, t.backlog, "a"), d = nodeSeries(g, t, t.dropped, "a"), w = nodeSeries(g, t, t.wait, "a");
    expect(b[0]).toBeCloseTo(20, 3);        // (300-100)*0.1
    expect(Math.max(...b)).toBeCloseTo(100, 2);
    expect(d[1]).toBeCloseTo(0, 3); expect(d[t.steps - 1]).toBeCloseTo(200, 2);
    expect(w[t.steps - 1]).toBeCloseTo(1000, 1); // full buffer = 1 s of capacity
  });
  it("service with spare capacity keeps an empty buffer and util = in/cap", () => {
    const { g, t } = tl({ c: { role: "entry", rate: 50 }, a: { role: "service", cap: 100 } }, [["c", "a"]], { T: 2 });
    expect(nodeSeries(g, t, t.util, "a")[5]).toBeCloseTo(0.5, 5); expect(nodeSeries(g, t, t.backlog, "a")[5]).toBe(0);
  });
});

describe("timeline: determinism, bounds, hygiene", () => {
  const nodes: Record<string, LoadSpec> = {
    c: { role: "entry", rate: 5000, retries: 2, spike: [3, 5, 10] }, g: { role: "limiter", limit: 4000, burst: 6000, algo: "sliding" },
    a: { role: "service", cap: 1500, rep: 3 }, r: { role: "cache", hit: 90 }, q: { role: "queue", cap: 800 }, d: { role: "db", cap: 1200 },
  };
  const edges: [string, string][] = [["c", "g"], ["g", "a"], ["a", "r"], ["a", "q"], ["r", "d"], ["q", "d"]];
  it("two runs are bit-identical", () => {
    const a = tl(nodes, edges).t, b = tl(nodes, edges).t;
    for (const k of ["edgeRate", "util", "dropped", "backlog", "wait", "amp"] as const) expect(a[k]).toEqual(b[k]);
  });
  it("no Infinity anywhere; NaN only in util of capacity-less nodes", () => {
    const { g, t } = tl(nodes, edges);
    for (const k of ["edgeRate", "dropped", "backlog", "wait", "amp"] as const) for (const v of t[k]) expect(Number.isFinite(v)).toBe(true);
    for (let i = 0; i < t.steps; i++) for (let v = 0; v < t.nodes; v++) { const u = t.util[i * t.nodes + v]!; expect(Number.isFinite(u) || g.hasCap[v] === 0).toBe(true); }
  });
  it("flow conservation at the limiter each step: in = out + dropped (token / fixed / sliding)", () => {
    for (const algo of ["token", "fixed", "sliding"] as const) {
      const { g, t } = tl({ c: { role: "entry", rate: 700, spike: [2, 1, 2] }, g: { role: "limiter", limit: 300, burst: 400, algo }, a: { role: "service" } }, [["c", "g"], ["g", "a"]], { T: 6 });
      const d = nodeSeries(g, t, t.dropped, "g");
      for (let i = 0; i < t.steps; i++) expect(er(t, i, 0)).toBeCloseTo(er(t, i, 1) + d[i]!, 2);
    }
  });
  it("hostile numbers and dt/T extremes do not blow up", () => {
    const g = mk({ c: { role: "entry", rate: Infinity, retries: 99, spike: [NaN, -1, 0] as never }, a: { role: "service", cap: 0 }, l: { role: "limiter", limit: 0, burst: 0 } }, [["c", "a"], ["a", "l"], ["l", "c"]]);
    for (const o of [{ dt: 0.1, T: 5 }, { dt: 0, T: 0.01 }, { dt: 100, T: -5 }, {}]) {
      const t = timeline(g, o);
      for (const k of ["edgeRate", "dropped", "backlog", "wait", "amp"] as const) for (const v of t[k]) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it("empty graph", () => {
    const g = buildGraph([]);
    expect(isTooLarge(g)).toBe(false);
    const t = timeline(g as Graph, { T: 1 });
    expect(t.steps).toBe(10); expect(t.edgeRate.length).toBe(0); expect(t.amp[0]).toBe(1);
  });
  it("a cycle runs (back-edges read the previous step) and stays bounded by the clamp", () => {
    const { t } = tl({ c: { role: "entry", rate: 100 }, a: { role: "service" }, b: { role: "service" } }, [["c", "a"], ["a", "b"], ["b", "a", { x: 0.5 }]], { T: 20 });
    const s = series(t, 0); // edge c->a constant
    expect(s[t.steps - 1]).toBeCloseTo(100, 3);
    expect(series(t, 1)[t.steps - 1]).toBeGreaterThan(100); // a's inflow includes the feedback
  });
});

describe("timeline: performance", () => {
  it("600 steps x 6000-edge random DAG (2000 nodes, every role) runs well under a generous bound", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const roles = ["service", "lb", "limiter", "cache", "queue", "db"] as const, algos = ["token", "leaky", "fixed", "sliding"] as const;
    const N = 2000, els: ElLike[] = [];
    for (let i = 0; i < N; i++) {
      const entry = i < 20;
      const load: LoadSpec = entry ? { role: "entry", rate: 2000, retries: 2, spike: [4, 10, 20] }
        : { role: roles[Math.floor(rnd() * 6)]!, cap: 800 + rnd() * 800, limit: 700, algo: algos[Math.floor(rnd() * 4)]! };
      els.push({ id: "n" + i, kind: "rect", iconId: "", text: "n" + i, src: "", dst: "", load });
    }
    for (let e = 0; e < 6000; e++) { const a = Math.floor(rnd() * (N - 1)), b = a + 1 + Math.floor(rnd() * Math.min(50, N - 1 - a)); els.push({ id: "e" + e, kind: "arrow", iconId: "", text: "", src: "n" + a, dst: "n" + b, load: undefined }); }
    const g = buildGraph(els);
    if (isTooLarge(g)) throw new Error("too large");
    expect(g.m).toBe(6000);
    timeline(g, { T: 6 }); // warm the JIT
    const t0 = performance.now();
    const t = timeline(g, { dt: 0.1, T: 60 });
    const ms = performance.now() - t0;
    console.log(`timeline perf: ${t.steps} steps x ${g.m} edges / ${g.n} nodes = ${ms.toFixed(1)} ms`);
    expect(t.steps).toBe(600);
    expect(ms).toBeLessThan(1000);
    for (const v of t.edgeRate) if (!Number.isFinite(v)) throw new Error("non-finite");
  });
});
