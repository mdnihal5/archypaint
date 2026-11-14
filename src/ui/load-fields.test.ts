import { describe, expect, it } from "vitest";
import { cleanLoad } from "../io/format";
import { mk } from "../load/testkit";
import { steady, timeline } from "../load/model";
import {
  NUM, SPIKE, checkNum, checkSpike, detectSource, fieldsFor, formatNum, frameAt, labelFor, parseNum, placeCard, scenarioT, spikeLabel, spikesOf, type NumKey,
} from "./load-fields";
import { FrameSrc, steadySrc } from "./load-src";
import { chartData, chartLine } from "./load-scenario";
import { readout } from "./load-draw";
import { QUEUE } from "../load/graph";

describe("parseNum", () => {
  it("reads plain numbers, k / M suffixes, commas, percent and exponents", () => {
    expect(parseNum("500")).toBe(500);
    expect(parseNum("10k")).toBe(10000);
    expect(parseNum(" 2.5M ")).toBe(2.5e6);
    expect(parseNum("1,000")).toBe(1000);
    expect(parseNum("90%")).toBe(90);
    expect(parseNum("1e3")).toBe(1000);
    expect(parseNum(".5k")).toBe(500);
  });
  it("rejects anything else", () => {
    for (const t of ["", "k", "abc", "1.2.3", "10kk", "--1", "1 2", "NaN", "Infinity", "0x10"]) expect(parseNum(t), t).toBeNull();
  });
});

describe("formatNum", () => {
  it("k / M with trailing zeros trimmed", () => {
    expect(formatNum(0)).toBe("0");
    expect(formatNum(80)).toBe("80");
    expect(formatNum(2.5)).toBe("2.5");
    expect(formatNum(1500)).toBe("1.5k");
    expect(formatNum(20000)).toBe("20k");
    expect(formatNum(2.5e6)).toBe("2.5M");
    expect(formatNum(1e9)).toBe("1000M");
  });
  it("round-trips what a person types", () => {
    for (const n of [0, 7, 250, 1500, 10000, 2.5e6]) expect(parseNum(formatNum(n))).toBe(n);
  });
});

describe("checkNum / checkSpike", () => {
  it("empty means default (undefined), in-range commits, out of range and junk are rejected, never clamped", () => {
    expect(checkNum(NUM.cap, "")).toEqual({ ok: true, value: undefined });
    expect(checkNum(NUM.cap, "10k")).toEqual({ ok: true, value: 10000 });
    expect(checkNum(NUM.cap, "-1").ok).toBe(false);
    expect(checkNum(NUM.cap, "2000M").ok).toBe(false);
    expect(checkNum(NUM.cap, "abc").ok).toBe(false);
    expect(checkNum(NUM.rep, "2.6")).toEqual({ ok: true, value: 3 });
    expect(checkNum(NUM.rep, "0").ok).toBe(false);
    expect(checkNum(NUM.retries, "6").ok).toBe(false);
    expect(checkNum(NUM.hit, "90%")).toEqual({ ok: true, value: 90 });
    expect(checkSpike(0, "0").ok).toBe(false);
    expect(checkSpike(0, "100")).toEqual({ ok: true, value: 100 });
    expect(checkSpike(1, "0")).toEqual({ ok: true, value: 0 });
    expect(checkSpike(2, "0").ok).toBe(false);
    expect(checkSpike(2, "601").ok).toBe(false);
  });
  it("the UI ranges are the ranges cleanLoad enforces (no drift from io/format.ts)", () => {
    for (const k of Object.keys(NUM) as NumKey[]) {
      const f = NUM[k], arrow = k === "w" || k === "x";
      const at = (v: number) => (cleanLoad({ [k]: v }, arrow) as Record<string, number>)[k];
      expect(at(f.min - 1), k + " min").toBe(f.min);
      expect(at(f.max + 1), k + " max").toBe(f.max);
      expect(at(f.min), k).toBe(f.min); expect(at(f.max), k).toBe(f.max);
    }
    const sp = (a: number, b: number, c: number) => cleanLoad({ spike: [a, b, c] }, false)!.spike!;
    expect(sp(SPIKE.mult.min - 1, SPIKE.start.min - 1, SPIKE.dur.min - 1)).toEqual([SPIKE.mult.min, SPIKE.start.min, SPIKE.dur.min]);
    expect(sp(SPIKE.mult.max + 1, SPIKE.start.max + 1, SPIKE.dur.max + 1)).toEqual([SPIKE.mult.max, SPIKE.start.max, SPIKE.dur.max]);
  });
});

describe("role -> fields", () => {
  it("each role shows exactly its fields", () => {
    expect(fieldsFor("entry")).toEqual(["rate", "retries"]);
    expect(fieldsFor("service")).toEqual(["cap", "rep"]);
    expect(fieldsFor("db")).toEqual(["cap", "rep"]);
    expect(fieldsFor("lb")).toEqual(["cap", "rep"]);
    expect(fieldsFor("cache")).toEqual(["hit", "cap"]);
    expect(fieldsFor("queue")).toEqual(["cap", "depth"]);
    expect(fieldsFor("arrow")).toEqual(["w", "x"]);
  });
  it("burst only for token and leaky limiters", () => {
    expect(fieldsFor("limiter", {})).toEqual(["limit", "burst"]);
    expect(fieldsFor("limiter", { algo: "leaky" })).toEqual(["limit", "burst"]);
    expect(fieldsFor("limiter", { algo: "fixed" })).toEqual(["limit"]);
    expect(fieldsFor("limiter", { algo: "sliding" })).toEqual(["limit"]);
  });
  it("a queue's capacity is its drain rate", () => { expect(labelFor("queue", "cap")).toBe("Drain rate"); expect(labelFor("service", "cap")).toBe("Capacity per replica"); });
  it("says where a detected role came from", () => {
    expect(detectSource({ kind: "icon", iconId: "logo-redis", text: "" })).toBe("logo");
    expect(detectSource({ kind: "cylinder", iconId: "", text: "" })).toBe("shape");
    expect(detectSource({ kind: "rect", iconId: "", text: "Kafka" })).toBe("label");
    expect(detectSource({ kind: "rect", iconId: "", text: "billing" })).toBeNull();
  });
});

describe("placeCard", () => {
  const B = { l: 8, t: 60, r: 1000, b: 700 }, S = { w: 280, h: 200 };
  it("prefers the right of the element, beside its top", () => {
    const p = placeCard({ x: 100, y: 300, w: 100, h: 60 }, S, B);
    expect(p).toEqual({ x: 214, y: 294, side: "r" });
  });
  it("flips to the left near the right edge", () => {
    const p = placeCard({ x: 800, y: 300, w: 100, h: 60 }, S, B);
    expect(p.side).toBe("l"); expect(p.x).toBe(800 - 14 - 280);
  });
  it("clamps inside the bounds vertically (never under the cluster or over the dock)", () => {
    expect(placeCard({ x: 100, y: 10, w: 100, h: 60 }, S, B).y).toBe(60);
    expect(placeCard({ x: 100, y: 690, w: 100, h: 60 }, S, B).y).toBe(700 - 200);
  });
  it("clamps horizontally when neither side fits", () => {
    const p = placeCard({ x: 20, y: 300, w: 900, h: 60 }, S, B);
    expect(p.x).toBeGreaterThanOrEqual(8); expect(p.x + 280).toBeLessThanOrEqual(1000);
  });
  it("a card taller than the bounds pins to the top", () => { expect(placeCard({ x: 100, y: 300, w: 10, h: 10 }, { w: 280, h: 900 }, B).y).toBe(60); });
  it("dodges an avoid box when the other side is free", () => {
    const p = placeCard({ x: 500, y: 300, w: 100, h: 60 }, S, B, [{ x: 600, y: 200, w: 300, h: 300 }]);
    expect(p.side).toBe("l");
  });
  it("keeps the preferred side when both are blocked", () => {
    const p = placeCard({ x: 500, y: 300, w: 100, h: 60 }, S, B, [{ x: 0, y: 0, w: 1000, h: 700 }]);
    expect(p.side).toBe("r");
  });
});

const shop = (spike?: [number, number, number], extra: object = {}) => mk(
  { c: { role: "entry", rate: 1000, ...(spike ? { spike } : {}), ...extra }, a: { role: "service", cap: 500 }, q: { role: "queue", cap: 100 } },
  [["c", "a"], ["a", "q"]],
);

describe("scenario time", () => {
  it("T = max(60, start + dur + 20)", () => {
    expect(scenarioT([])).toBe(60);
    expect(scenarioT([{ mult: 5, start: 5, dur: 20 }])).toBe(60);
    expect(scenarioT([{ mult: 5, start: 100, dur: 50 }])).toBe(170);
    expect(scenarioT([{ mult: 5, start: 5, dur: 20 }, { mult: 2, start: 300, dur: 10 }])).toBe(330);
  });
  it("finds the spikes of a graph and labels them", () => {
    expect(spikesOf(shop())).toEqual([]);
    const sp = spikesOf(shop([5, 5, 20]));
    expect(sp).toHaveLength(1);
    expect(spikeLabel(sp)).toBe("Spike ×5 for 20 s");
  });
  it("frameAt maps seconds to a clamped frame", () => {
    expect(frameAt(0, 600)).toBe(0); expect(frameAt(1.23, 600)).toBe(12); expect(frameAt(0.3, 600)).toBe(3);
    expect(frameAt(-5, 600)).toBe(0); expect(frameAt(999, 600)).toBe(599);
  });
});

describe("frame source", () => {
  const g = shop([5, 5, 20]);
  const st = steady(g), tl = timeline(g, { dt: 0.1, T: 60 });
  it("steady source reads the steady result", () => {
    const s = steadySrc(st);
    expect(s.frame).toBe(false);
    expect(s.edge(0)).toBeCloseTo(st.edge[0]!, 6);
    expect(s.backlog(0)).toBe(-1);
    expect(s.amp()).toBe(1);
  });
  it("a frame source reads the timeline at .i and switches frames without allocating", () => {
    const f = new FrameSrc(st, tl);
    f.i = 0; const a = f.edge(0);
    f.i = 100; const b = f.edge(0); // t = 10 s, inside the spike
    expect(a).toBeCloseTo(1000, 3); expect(b).toBeCloseTo(5000, 3);
    expect(f.frame).toBe(true);
    const a1 = g.nodeIndex.get("a")!, q = g.nodeIndex.get("q")!;
    expect(f.util(a1)).toBeGreaterThan(1); expect(f.sat(a1)).toBe(true);
    f.i = 0; expect(f.sat(a1)).toBe(true); // 1000/s into capacity 500 is saturated even before the spike
    f.i = 300; expect(f.backlog(q)).toBeGreaterThan(0);
  });
  it("a node over capacity shows its dropped rate and the queue its depth in the readout", () => {
    const f = new FrameSrc(st, tl); f.i = 150;
    const q = g.nodeIndex.get("q")!;
    const ro = readout(QUEUE, f.in(q), g.cap[q]!, f.util(q), f.dropped(q), f.growth(q), f.backlog(q));
    expect(ro?.extra).toMatch(/^backlog \d/);
    const ro2 = readout(QUEUE, 500, 100, 5, 0, 400);
    expect(ro2?.extra).toBe("backlog +400/s");
  });
});

describe("chart data", () => {
  const g = shop([5, 5, 20]), tl = timeline(g, { dt: 0.1, T: 60 });
  it("takes the busiest nodes, the biggest queue backlog and the peak amplification", () => {
    const cd = chartData(g, tl);
    expect(cd.series.length).toBeGreaterThanOrEqual(2);
    expect(cd.series[0]!.peak).toBeGreaterThanOrEqual(cd.series[1]!.peak);
    expect(cd.series.length).toBeLessThanOrEqual(3);
    expect(cd.queue?.name).toBe("q");
    expect(cd.queue!.peak).toBeGreaterThan(0);
    expect(cd.series[0]!.data).toHaveLength(tl.steps);
  });
  it("the text line shows peaks when stopped and live values at a frame", () => {
    const cd = chartData(g, tl);
    expect(chartLine(cd, tl, null)).toMatch(/q backlog peaks at/);
    expect(chartLine(cd, tl, 200)).toMatch(/q backlog .* \(peak /);
  });
  it("retries show amplification", () => {
    const g2 = shop([5, 5, 20], { retries: 3 }), t2 = timeline(g2, { dt: 0.1, T: 60 }), cd = chartData(g2, t2);
    expect(cd.ampPeak).toBeGreaterThan(1.5);
    expect(chartLine(cd, t2, null)).toMatch(/amplification peaks at ×/);
  });
});
