import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHIP_TS, createCoalescer, DARK_LOAD, level, LIGHT_LOAD, loadColours, lod, pctText, placeChip, rateText, readout, chipSize, TEXT_MIN_ZOOM } from "./load-draw";
import { bunch, loadCount, loadSpeed, plateRects } from "./flow";
import { DARK, LIGHT } from "../theme";
import { contrast } from "./contrast";
import { LIMITER, QUEUE, SERVICE } from "../load/graph";
import { Scene } from "../scene";
import { DEFAULTS, parseSettings } from "./settings";

describe("load colours", () => {
  it("every status colour reads on its theme's paper (>= 4.5:1)", () => {
    for (const k of ["ok", "warn", "bad"] as const) {
      expect(contrast(LIGHT_LOAD[k], LIGHT.paper), `light ${k}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK_LOAD[k], DARK.paper), `dark ${k}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("picks the palette from the paper", () => { expect(loadColours(LIGHT.paper)).toBe(LIGHT_LOAD); expect(loadColours(DARK.paper)).toBe(DARK_LOAD); });
});

describe("level thresholds", () => {
  it("green < 70 %, amber < 100 %, red >= 100 %, none without capacity", () => {
    expect(level(0)).toBe("ok"); expect(level(0.699)).toBe("ok");
    expect(level(0.7)).toBe("warn"); expect(level(0.999)).toBe("warn");
    expect(level(1)).toBe("bad"); expect(level(7)).toBe("bad");
    expect(level(NaN)).toBeNull();
  });
});

describe("text", () => {
  it("formats rates and percentages", () => {
    expect(rateText(5400)).toBe("5.4k/s"); expect(rateText(12)).toBe("12/s"); expect(rateText(2_500_000)).toBe("2.5M/s");
    expect(pctText(0.67)).toBe("67%"); expect(pctText(1.39)).toBe("139%"); expect(pctText(1e6)).toBe(">999%");
  });
  it("node readout: bar, line, and the red line only when non-zero", () => {
    expect(readout(SERVICE, 6000, 9000, 6000 / 9000, 0, 0)).toEqual({ frac: 6000 / 9000, level: "ok", line: "6.0k of 9.0k · 67%", extra: "" });
    const over = readout(SERVICE, 20000, 9000, 20000 / 9000, 11000, 0)!;
    expect(over.level).toBe("bad"); expect(over.frac).toBe(1); expect(over.extra).toBe("dropped 11.0k/s");
    expect(readout(LIMITER, 15000, 5000, 3, 10000, 0)!.extra).toBe("rejected 10.0k/s");
    expect(readout(QUEUE, 2350, 2000, 1.175, 0, 350)!.extra).toBe("backlog +350/s");
    expect(readout(QUEUE, 1000, 2000, 0.5, 0, 0)!.extra).toBe("");
    expect(readout(SERVICE, 10, 0, NaN, 0, 0)).toBeNull();
  });
});

describe("level of detail", () => {
  it("text goes below the zoom threshold, the bar goes when the node is a few px wide", () => {
    expect(lod(TEXT_MIN_ZOOM, 100).text).toBe(true); expect(lod(TEXT_MIN_ZOOM - 0.01, 100).text).toBe(false);
    expect(lod(0.3, 100)).toEqual({ text: false, bar: true });
    expect(lod(0.1, 100).bar).toBe(false); expect(lod(1, 100).bar).toBe(true);
  });
});

describe("chip placement", () => {
  const measure = (fs: number) => (t: string) => t.length * fs * 0.6;
  const arrow = (labels: { t: number; text: string }[]) => new Scene().add({ kind: "arrow", x: 0, y: 0, w: 400, h: 1, pts: [0, 0, 400, 0], src: "a", dst: "b", head: 1, route: 0, labels });
  const place = (a: ReturnType<typeof arrow>, w: number, h: number) => {
    const plates: number[] = []; plateRects(a, measure, plates);
    const out: [number, number] = [0, 0]; placeChip(a.pts, false, w, h, plates, out); return { out, plates };
  };
  it("sits at the middle of an unlabelled arrow", () => { expect(place(arrow([]), 40, 17).out).toEqual([200, 0]); });
  it("a label elsewhere does not move it", () => { expect(place(arrow([{ t: 0.1, text: "x" }]), 40, 17).out[0]).toBe(200); });
  it("moves along the arrow off a label at the middle when there is room, and then clears it", () => {
    const { out, plates } = place(arrow([{ t: 0.5, text: "https" }]), 40, 17);
    expect(out[0]).not.toBe(200); expect(out[1]).toBe(0);
    const cx = out[0] - 20, lx = plates[0]!, lw = plates[2]!;
    expect(cx + 40 <= lx || cx >= lx + lw).toBe(true);
  });
  it("on an arrow too short to clear its label, the chip sits beside the line, above it, touching no plate", () => {
    const s = new Scene();
    const a = s.add({ kind: "arrow", x: 0, y: 0, w: 120, h: 1, pts: [0, 0, 120, 0], src: "a", dst: "b", head: 1, route: 0, labels: [{ t: 0.5, text: "HTTPS" }] });
    const { out, plates } = place(a, 56, 17);
    expect(out[1]).toBeLessThan(0);
    expect(out[1] + 8.5 <= plates[1]!).toBe(true); // chip bottom edge above the plate's top edge
  });
  it("when every spot is taken it still returns a position instead of failing", () => {
    const labels = CHIP_TS.map((t) => ({ t, text: "wwwwwwwwwwwwwwwwwwwwww" }));
    expect(() => place(arrow(labels), 40, 17)).not.toThrow();
  });
  it("chip size is the connector label box (labelBlock) at the chip's text size", () => {
    expect(chipSize("5.4k/s", (s) => s.length * 6)).toEqual({ w: 6 * 6 + 10, h: Math.round(11 * 1.5) });
  });
});

describe("recompute coalescing", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const make = (fn: () => void) => createCoalescer(fn, (cb) => setTimeout(cb, 16) as unknown as number, (id) => clearTimeout(id));
  it("many schedules in one frame run once; idle runs nothing", () => {
    const fn = vi.fn(); const c = make(fn);
    vi.advanceTimersByTime(1000); expect(fn).not.toHaveBeenCalled();
    for (let i = 0; i < 50; i++) c.schedule();
    expect(c.pending()).toBe(true);
    vi.advanceTimersByTime(16); expect(fn).toHaveBeenCalledTimes(1); expect(c.pending()).toBe(false);
    vi.advanceTimersByTime(1000); expect(fn).toHaveBeenCalledTimes(1);
    c.schedule(); vi.advanceTimersByTime(16); expect(fn).toHaveBeenCalledTimes(2);
  });
  it("cancel leaves nothing pending", () => {
    const fn = vi.fn(); const c = make(fn);
    c.schedule(); c.cancel(); expect(c.pending()).toBe(false);
    vi.advanceTimersByTime(100); expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("flow follows the rate (Load view only)", () => {
  it("speed rises with the rate on a log scale and stays clamped", () => {
    expect(loadSpeed(0, false)).toBeCloseTo(0.5, 5);
    expect(loadSpeed(10, false)).toBeLessThan(loadSpeed(1000, false));
    expect(loadSpeed(1e4, false)).toBeCloseTo(1.4, 1); expect(loadSpeed(1e12, false)).toBeCloseTo(1.4, 5);
  });
  it("a saturated destination slows the dots to a crawl", () => { expect(loadSpeed(5000, true)).toBeCloseTo(loadSpeed(5000, false) * 0.3, 8); });
  it("density is 1..6 dots and grows with the rate", () => {
    expect(loadCount(0)).toBe(1); expect(loadCount(5400)).toBe(5); expect(loadCount(1e9)).toBe(6);
    expect(loadCount(100)).toBeLessThanOrEqual(loadCount(100000));
  });
  it("bunching keeps dots inside the arrow and pulls them towards its end", () => {
    expect(bunch(0, 200)).toBe(0); expect(bunch(100, 200)).toBeLessThan(100); expect(bunch(199.9, 200)).toBeLessThan(200);
    let prev = -1; for (let d = 0; d < 200; d += 10) { const b = bunch(d, 200); expect(b).toBeGreaterThan(prev); prev = b; }
  });
});

describe("settings", () => {
  it("Load view is off by default and survives a stored value", () => {
    expect(DEFAULTS.load).toBe(false);
    expect(parseSettings(null).load).toBe(false);
    expect(parseSettings('{"load":true}').load).toBe(true);
    expect(parseSettings('{"load":"yes"}').load).toBe(false);
  });
});
