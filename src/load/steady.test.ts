import { describe, expect, it } from "vitest";
import { buildGraph, isTooLarge, type ElLike } from "./graph";
import { steady, type Steady } from "./model";
import { mk } from "./testkit";
import type { LoadSpec } from "./types";

const run = (nodes: Record<string, LoadSpec>, edges: [string, string, LoadSpec?][]) => steady(mk(nodes, edges));
const f = (s: Steady, k: "in" | "served" | "dropped" | "growth" | "util" | "lat" | "injected" | "amp" | "e2e", id: string) => s[k][s.g.nodeIndex.get(id)!]!;
const edge = (s: Steady, i: number) => s.edge[i]!;
const C = (a: number, b: number, d = 6) => expect(a).toBeCloseTo(b, d);

describe("steady: per-role semantics (hand-computed)", () => {
  it("linear chain: entry 100 -> svc cap 60 -> db cap 1000", () => {
    const s = run({ c: { role: "entry", rate: 100 }, a: { role: "service", cap: 60 }, d: { role: "db", cap: 1000 } }, [["c", "a"], ["a", "d"]]);
    // a: in 100, served min(100,60)=60, dropped 40, util 100/60. d: in 60, util 0.06
    C(f(s, "in", "a"), 100); C(f(s, "served", "a"), 60); C(f(s, "dropped", "a"), 40); C(f(s, "util", "a"), 100 / 60);
    C(f(s, "in", "d"), 60); C(f(s, "util", "d"), 0.06);
    C(edge(s, 0), 100); C(edge(s, 1), 60);
    expect(s.converged).toBe(true);
    expect(s.warnings.some((w) => w.includes("over capacity 167%"))).toBe(true);
  });

  it("cache: hit 80% of 1000 answered locally, misses (200) go to the db", () => {
    const s = run({ c: { role: "entry", rate: 1000 }, r: { role: "cache", hit: 80 }, d: { role: "db" } }, [["c", "r"], ["r", "d"]]);
    C(f(s, "served", "r"), 1000); C(f(s, "in", "d"), 1000 * (1 - 0.8)); // 200
  });

  it("cache default hit is 80%", () => {
    const s = run({ c: { role: "entry", rate: 500 }, r: { role: "cache" }, d: { role: "db" } }, [["c", "r"], ["r", "d"]]);
    C(f(s, "in", "d"), 100);
  });

  it("fan-out x: one request becomes 3 downstream calls", () => {
    const s = run({ c: { role: "entry", rate: 100 }, a: { role: "service" }, d: { role: "db" } }, [["c", "a"], ["a", "d", { x: 3 }]]);
    C(f(s, "in", "d"), 300);
  });

  it("weights: output 100 split 3:1 -> 75 / 25", () => {
    const s = run({ c: { role: "entry", rate: 100 }, a: { role: "service" }, b: { role: "db" }, d: { role: "db" } },
      [["c", "a"], ["a", "b", { w: 3 }], ["a", "d", { w: 1 }]]);
    C(f(s, "in", "b"), 75); C(f(s, "in", "d"), 25);
  });

  it("default split without weights is even", () => {
    const s = run({ c: { role: "entry", rate: 90 }, a: { role: "service" }, b: { role: "db" }, d: { role: "db" }, e: { role: "db" } },
      [["c", "a"], ["a", "b"], ["a", "d"], ["a", "e"]]);
    C(f(s, "in", "b"), 30); C(f(s, "in", "e"), 30);
  });

  it("lb spreads by downstream capacity: 400 over caps 300 / 100 -> 300 / 100 (both at 100%)", () => {
    const s = run({ c: { role: "entry", rate: 400 }, l: { role: "lb" }, a: { role: "service", cap: 300 }, b: { role: "service", cap: 100 } },
      [["c", "l"], ["l", "a"], ["l", "b"]]);
    C(f(s, "in", "a"), 300); C(f(s, "in", "b"), 100); C(f(s, "dropped", "a"), 0);
  });

  it("lb: replicas count in capacity (cap 100 x rep 3 = 300 vs 100)", () => {
    const s = run({ c: { role: "entry", rate: 400 }, l: { role: "lb" }, a: { role: "service", cap: 100, rep: 3 }, b: { role: "service", cap: 100 } },
      [["c", "l"], ["l", "a"], ["l", "b"]]);
    C(f(s, "in", "a"), 300);
  });

  it("lb falls back to an even split when a target has no capacity, or when weights are explicit", () => {
    const a = run({ c: { role: "entry", rate: 400 }, l: { role: "lb" }, a: { role: "service", cap: 300 }, b: { role: "service" } }, [["c", "l"], ["l", "a"], ["l", "b"]]);
    C(f(a, "in", "a"), 200);
    const b = run({ c: { role: "entry", rate: 400 }, l: { role: "lb" }, a: { role: "service", cap: 300 }, b: { role: "service", cap: 100 } }, [["c", "l"], ["l", "a", { w: 1 }], ["l", "b", { w: 1 }]]);
    C(f(b, "in", "a"), 200); C(f(b, "in", "b"), 200); C(f(b, "dropped", "b"), 100);
  });

  it("limiter: in 80, limit 50 -> admits 50, rejects 30 (429), downstream sees 50", () => {
    const s = run({ c: { role: "entry", rate: 80 }, g: { role: "limiter", limit: 50 }, a: { role: "service" } }, [["c", "g"], ["g", "a"]]);
    C(f(s, "served", "g"), 50); C(f(s, "dropped", "g"), 30); C(f(s, "in", "a"), 50); C(f(s, "util", "g"), 1.6);
    expect(s.warnings).toContain("g rejects 30/s (429)");
  });

  it("limiter limit absent uses cap*rep; with both, the smaller wins", () => {
    const a = run({ c: { role: "entry", rate: 100 }, g: { role: "limiter", cap: 20, rep: 2 }, a: { role: "service" } }, [["c", "g"], ["g", "a"]]);
    C(f(a, "in", "a"), 40);
    const b = run({ c: { role: "entry", rate: 100 }, g: { role: "limiter", cap: 20, rep: 2, limit: 25 }, a: { role: "service" } }, [["c", "g"], ["g", "a"]]);
    C(f(b, "in", "a"), 25);
  });

  it("queue: in 100, drain 40 -> out 40, backlog grows 60/s, flagged", () => {
    const s = run({ c: { role: "entry", rate: 100 }, q: { role: "queue", cap: 40 }, d: { role: "db" } }, [["c", "q"], ["q", "d"]]);
    C(f(s, "growth", "q"), 60); C(f(s, "in", "d"), 40); C(f(s, "dropped", "q"), 0); C(f(s, "util", "q"), 2.5);
    expect(s.warnings).toContain("q backlog grows 60/s");
    expect(s.sat[s.g.nodeIndex.get("q")!]).toBe(1);
  });

  it("queue below drain rate: no growth, passes everything", () => {
    const s = run({ c: { role: "entry", rate: 30 }, q: { role: "queue", cap: 40 }, d: { role: "db" } }, [["c", "q"], ["q", "d"]]);
    C(f(s, "growth", "q"), 0); C(f(s, "in", "d"), 30);
  });

  it("the mock's shop topology, hand-computed", () => {
    // clients 30000 -> gateway limit 20000 (rejects 10000) -> app cap 3000*3 = 9000 (drops 11000)
    // app serves 9000, split evenly over cache and kafka (4500 each); cache hit 90% -> 450 misses -> db; kafka drains 1000 (grows 3500)
    // db in 450 + 1000 = 1450
    const s = run({
      c: { role: "entry", rate: 30000 }, g: { role: "limiter", limit: 20000 }, a: { role: "service", cap: 3000, rep: 3 },
      r: { role: "cache", hit: 90 }, q: { role: "queue", cap: 1000 }, d: { role: "db", cap: 2000 },
    }, [["c", "g"], ["g", "a"], ["a", "r"], ["a", "q"], ["r", "d"], ["q", "d"]]);
    C(f(s, "dropped", "g"), 10000); C(f(s, "dropped", "a"), 11000); C(f(s, "in", "r"), 4500); C(f(s, "growth", "q"), 3500);
    C(f(s, "in", "d"), 1450); C(f(s, "util", "d"), 0.725);
  });
});

describe("steady: retries", () => {
  const retryGraph = (e: LoadSpec) => run({ c: { role: "entry", rate: 100, ...e }, g: { role: "limiter", limit: 50 }, a: { role: "service" } }, [["c", "g"], ["g", "a"]]);

  it("no backoff, 3 retries: grows until the bound 100*(1+3) = 400 (x4.0)", () => {
    // inj = min(100 + 3*(inj - 50), 400): slope 3 > 1, so it climbs to the clip. F = 350.
    const s = retryGraph({ retries: 3 });
    C(f(s, "injected", "c"), 400); C(f(s, "amp", "c"), 4); expect(s.converged).toBe(true);
    expect(s.warnings).toContain("Retry amplification x4.0 at c");
  });
  it("backoff factor 0.35, 3 retries: bound 100*(1+1.05) = 205 (x2.05)", () => {
    const s = retryGraph({ retries: 3, backoff: 1 });
    C(f(s, "injected", "c"), 205); C(f(s, "amp", "c"), 2.05);
  });
  it("backoff, 1 retry: interior fixed point inj = 100 + 0.35*(inj - 50) -> inj = 82.5 / 0.65 = 126.923", () => {
    const s = retryGraph({ retries: 1, backoff: 1 });
    C(f(s, "injected", "c"), 82.5 / 0.65, 1); expect(s.converged).toBe(true);
  });
  it("no failures, no amplification", () => {
    const s = run({ c: { role: "entry", rate: 40, retries: 5 }, g: { role: "limiter", limit: 50 }, a: { role: "service" } }, [["c", "g"], ["g", "a"]]);
    C(f(s, "amp", "c"), 1); C(f(s, "in", "a"), 40);
  });
  it("never exceeds (1 + R*f) * rate, over a grid of rates / retries / backoff / capacities", () => {
    for (const rate of [1, 10, 1000, 123456]) for (const retries of [0, 1, 2, 5]) for (const backoff of [0, 1] as const) for (const lim of [0.5, 7, 500, 1e9]) {
      const s = run({ c: { role: "entry", rate, retries, backoff }, g: { role: "limiter", limit: lim }, a: { role: "service", cap: lim } }, [["c", "g"], ["g", "a"]]);
      const bound = rate * (1 + retries * (backoff ? 0.35 : 1));
      expect(f(s, "injected", "c")).toBeLessThanOrEqual(bound * (1 + 1e-12));
      expect(f(s, "injected", "c")).toBeGreaterThanOrEqual(rate);
    }
  });
  it("two entries: failures attributed by traffic share (one retries, one does not)", () => {
    // rates 100 (retries 1) and 300 (none) into limit 200: F = 400 - 200 = 200 at first; entry A gets 200 * 100/400 * 1 = 50 -> bound 100*(1+1)=200
    // fixed point: inj_A = 100 + (inj_A + 300 - 200) * 0.25 = 125 + 0.25 inj_A -> 166.667
    const s = run({ a: { role: "entry", rate: 100, retries: 1 }, b: { role: "entry", rate: 300 }, g: { role: "limiter", limit: 200 }, x: { role: "service" } },
      [["a", "g"], ["b", "g"], ["g", "x"]]);
    C(f(s, "injected", "a"), 125 / 0.75, 1); C(f(s, "injected", "b"), 300);
  });
});

describe("steady: cycles", () => {
  it("feedback loop converges: in_A = 100 + 0.5*in_B, in_B = 0.5*in_A -> in_A = 133.33, in_B = db = 66.67", () => {
    const s = run({ c: { role: "entry", rate: 100 }, a: { role: "service" }, b: { role: "service" }, d: { role: "db" } },
      [["c", "a"], ["a", "b"], ["a", "d"], ["b", "a", { x: 0.5 }]]);
    expect(s.converged).toBe(true);
    C(f(s, "in", "a"), 400 / 3, 2); C(f(s, "in", "b"), 200 / 3, 2); C(f(s, "in", "d"), 200 / 3, 2);
  });
  it("a loop with gain 2 does not settle: converged=false, a warning, and still only finite numbers", () => {
    const s = run({ c: { role: "entry", rate: 100 }, a: { role: "service" }, b: { role: "service" } }, [["c", "a"], ["a", "b", { x: 2 }], ["b", "a"]]);
    expect(s.converged).toBe(false);
    expect(s.warnings.some((w) => w.includes("did not settle"))).toBe(true);
    for (const arr of [s.in, s.served, s.dropped, s.edge, s.lat, s.e2e]) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
  });
  it("a self-loop with gain 0.5 converges: in = 100 + 0.5 in = 200", () => {
    const s = run({ c: { role: "entry", rate: 100 }, a: { role: "service" } }, [["c", "a"], ["a", "a", { x: 0.5 }]]);
    expect(s.converged).toBe(true); C(f(s, "in", "a"), 200, 1);
  });
  it("a deep chain (200 nodes, deeper than the pass limit) is exact in a couple of passes", () => {
    const nodes: Record<string, LoadSpec> = { c: { role: "entry", rate: 10 } }, edges: [string, string][] = [];
    let prev = "c";
    for (let i = 0; i < 200; i++) { nodes["n" + i] = { role: "service" }; edges.push([prev, "n" + i]); prev = "n" + i; }
    const s = run(nodes, edges);
    expect(s.converged).toBe(true); expect(s.passes).toBeLessThanOrEqual(2); C(f(s, "in", "n199"), 10);
  });
  it("a response arrow back into the entry carries nothing and does not steal share", () => {
    const s = run({ c: { role: "entry", rate: 100 }, a: { role: "service" } }, [["c", "a"], ["a", "c"]]);
    C(f(s, "in", "a"), 100); C(edge(s, 1), 0); expect(s.converged).toBe(true);
  });
});

describe("steady: invariants and edge cases", () => {
  it("conservation in = served + dropped + growth at every node, on random graphs of every role", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const roles = ["service", "lb", "limiter", "cache", "queue", "db"] as const;
    for (let trial = 0; trial < 60; trial++) {
      const nodes: Record<string, LoadSpec> = {}, edges: [string, string, LoadSpec?][] = [];
      const N = 3 + Math.floor(rnd() * 12);
      for (let i = 0; i < N; i++) {
        const role = i < 2 ? "entry" : roles[Math.floor(rnd() * roles.length)]!;
        nodes["n" + i] = { role, rate: role === "entry" ? rnd() * 5000 : undefined as never, retries: Math.floor(rnd() * 4), backoff: rnd() < 0.5 ? 1 : 0,
          cap: rnd() < 0.7 ? rnd() * 3000 : undefined as never, limit: rnd() * 2000, hit: rnd() * 100 };
      }
      for (let k = 0; k < N * 2; k++) edges.push(["n" + Math.floor(rnd() * N), "n" + Math.floor(rnd() * N), { w: rnd() < 0.3 ? rnd() * 5 : undefined as never, x: rnd() < 0.3 ? rnd() * 3 : undefined as never }]);
      const s = steady(mk(nodes, edges));
      for (let v = 0; v < s.g.n; v++) {
        expect(Math.abs(s.in[v]! - (s.served[v]! + s.dropped[v]! + s.growth[v]!))).toBeLessThan(1e-6);
        for (const arr of [s.in, s.served, s.dropped, s.growth, s.lat, s.e2e, s.injected, s.amp]) expect(Number.isFinite(arr[v]!)).toBe(true);
        expect(Number.isFinite(s.util[v]!) || s.g.hasCap[v] === 0).toBe(true);
      }
      for (const e of s.edge) expect(Number.isFinite(e)).toBe(true);
    }
  });

  it("empty graph", () => {
    const g = buildGraph([]);
    expect(isTooLarge(g)).toBe(false);
    const s = steady(g as never);
    expect(s.converged).toBe(true); expect(s.in.length).toBe(0); expect(s.warnings).toEqual([]);
  });

  it("nodes with no capacity: pass through, util is NaN (the one sentinel), nothing dropped", () => {
    const s = run({ c: { role: "entry", rate: 250 }, a: { role: "service" }, d: { role: "db" } }, [["c", "a"], ["a", "d"]]);
    expect(Number.isNaN(f(s, "util", "a"))).toBe(true); C(f(s, "in", "d"), 250); C(f(s, "dropped", "a"), 0);
    C(f(s, "lat", "a"), 20); // service default 20 ms, no util inflation without a capacity
  });

  it("zero rate: everything zero, amp 1, no warnings", () => {
    const s = run({ c: { role: "entry", rate: 0, retries: 3 }, a: { role: "service", cap: 10 } }, [["c", "a"]]);
    C(f(s, "in", "a"), 0); C(f(s, "amp", "c"), 1); C(f(s, "util", "a"), 0); expect(s.warnings).toEqual([]);
  });

  it("entry with no rate set produces nothing (documented default 0)", () => {
    const s = run({ c: { role: "entry" }, a: { role: "service" } }, [["c", "a"]]);
    C(f(s, "in", "a"), 0);
  });

  it("hostile numbers (0, negative, NaN, Infinity, huge) never leak NaN/Infinity", () => {
    const s = run({
      c: { role: "entry", rate: Infinity, retries: 99 }, a: { role: "service", cap: 0 }, b: { role: "service", cap: -5, rep: -3 },
      d: { role: "db", cap: NaN, ms: Infinity }, e: { role: "cache", hit: 1e9 }, q: { role: "queue", cap: 1e308, rep: 1000, depth: -1 },
    }, [["c", "a"], ["c", "b", { w: -1, x: Infinity }], ["a", "d"], ["b", "e"], ["e", "q"], ["q", "d", { w: NaN }]]);
    for (const arr of [s.in, s.served, s.dropped, s.growth, s.lat, s.e2e, s.injected, s.amp, s.edge]) for (const v of arr) expect(Number.isFinite(v)).toBe(true);
    for (let v = 0; v < s.g.n; v++) expect(Number.isFinite(s.util[v]!) || s.g.hasCap[v] === 0).toBe(true);
  });

  it("zero-capacity node reads as hopelessly over (1e6), not Infinity", () => {
    const s = run({ c: { role: "entry", rate: 10 }, a: { role: "service", cap: 0 } }, [["c", "a"]]);
    C(f(s, "util", "a"), 1e6); C(f(s, "dropped", "a"), 10); expect(s.sat[s.g.nodeIndex.get("a")!]).toBe(1);
  });

  it("latency: service time / (1 - util); saturated nodes are flagged and propagate to the entry's end-to-end", () => {
    // svc ms 20, util 0.5 -> 40 ms; db ms 8 util 0.25 -> 10.667. e2e = 0 + 40 + 1*10.667
    const s = run({ c: { role: "entry", rate: 50 }, a: { role: "service", cap: 100 }, d: { role: "db", cap: 200 } }, [["c", "a"], ["a", "d"]]);
    C(f(s, "lat", "a"), 40); C(f(s, "lat", "d"), 8 / 0.75, 6);
    C(f(s, "e2e", "c"), 40 + 8 / 0.75, 6); expect(s.e2eSat[0]).toBe(0);
    const hot = run({ c: { role: "entry", rate: 500 }, a: { role: "service", cap: 100 } }, [["c", "a"]]);
    expect(hot.sat[hot.g.nodeIndex.get("a")!]).toBe(1); expect(hot.e2eSat[hot.g.nodeIndex.get("c")!]).toBe(1);
    C(f(hot, "lat", "a"), 20 / 0.05, 6); // util clamped at 0.95: a floor, flagged, not to be printed
  });

  it("end-to-end is traffic-weighted: cache hit 90% -> 0.1 of requests reach the db", () => {
    // c -> cache(1 ms) -> db(8 ms), no caps: e2e = 1 + (1-0.9)*8 = 1.8
    const s = run({ c: { role: "entry", rate: 100 }, r: { role: "cache", hit: 90 }, d: { role: "db" } }, [["c", "r"], ["r", "d"]]);
    C(f(s, "e2e", "c"), 1.8);
  });
});

describe("buildGraph", () => {
  const box = (id: string): ElLike => ({ id, kind: "rect", iconId: "", text: id, src: "", dst: "", load: undefined });
  const arrow = (id: string, src: string, dst: string): ElLike => ({ id, kind: "arrow", iconId: "", text: "", src, dst, load: undefined });

  it("ignores free ends, arrow-to-arrow branches and unknown ids; keeps bound-at-both-ends only", () => {
    const g = buildGraph([box("a"), box("b"), arrow("e0", "a", "b"), arrow("free", "a", ""), arrow("branch", "e0", "b"), arrow("ghost", "a", "zzz")]);
    if (isTooLarge(g)) throw new Error();
    expect(g.m).toBe(1); expect(g.n).toBe(2);
  });
  it("two-headed arrow is still src -> dst", () => {
    const g = buildGraph([box("a"), box("b"), { ...arrow("e0", "a", "b"), load: undefined }]);
    if (isTooLarge(g)) throw new Error();
    expect(g.ids[g.esrc[0]!]).toBe("a"); expect(g.ids[g.edst[0]!]).toBe("b");
  });
  it("elements that touch no arrow are not nodes", () => {
    const g = buildGraph([box("a"), box("b"), box("lonely"), arrow("e0", "a", "b")]);
    if (isTooLarge(g)) throw new Error();
    expect(g.nodeIndex.has("lonely")).toBe(false);
  });
  it("role: stored > detected > service", () => {
    const g = buildGraph([{ ...box("r"), iconId: "logo-redis" }, { ...box("k"), iconId: "logo-redis", load: { role: "queue" } }, box("p"), arrow("e0", "r", "k"), arrow("e1", "k", "p")]);
    if (isTooLarge(g)) throw new Error();
    expect([...g.role]).toEqual([4, 5, 1]);
  });
  it("too large: 3001 nodes or 6001 edges returns a marker instead of computing", () => {
    const els: ElLike[] = [];
    for (let i = 0; i < 3001; i++) els.push(box("n" + i));
    for (let i = 0; i < 3000; i++) els.push(arrow("e" + i, "n" + i, "n" + (i + 1)));
    const big = buildGraph(els);
    expect(isTooLarge(big)).toBe(true);
    const ok = buildGraph(els.filter((e) => e.id !== "n3000" && e.id !== "e2999")); // exactly 3000 nodes is fine
    expect(isTooLarge(ok)).toBe(false);
    const els2: ElLike[] = [box("a"), box("b")];
    for (let i = 0; i < 6001; i++) els2.push(arrow("x" + i, "a", "b"));
    expect(isTooLarge(buildGraph(els2))).toBe(true);
    expect(isTooLarge(buildGraph(els2.slice(0, 2 + 6000)))).toBe(false); // exactly the limit is fine
  });
});
