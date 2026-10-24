// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { clampPos, loadPrefs, parsePrefs, savePrefs } from "./props-pos";

describe("props panel position", () => {
  it("clamps inside the viewport", () => {
    expect(clampPos({ x: -50, y: -9 }, 300, 200, 1000, 800)).toEqual({ x: 4, y: 4 });
    expect(clampPos({ x: 990, y: 790 }, 300, 200, 1000, 800)).toEqual({ x: 696, y: 596 });
    expect(clampPos({ x: 100, y: 120 }, 300, 200, 1000, 800)).toEqual({ x: 100, y: 120 });
  });
  it("a panel taller than the viewport pins to the top margin", () => {
    expect(clampPos({ x: 10, y: 300 }, 300, 900, 1000, 800)).toEqual({ x: 10, y: 4 });
  });
  it("parses prefs defensively", () => {
    expect(parsePrefs(null)).toEqual({ pos: null, open: false });
    expect(parsePrefs("{nope")).toEqual({ pos: null, open: false });
    expect(parsePrefs('{"pos":{"x":"a","y":2},"open":1}')).toEqual({ pos: null, open: false });
    expect(parsePrefs('{"hidden":false}')).toEqual({ pos: null, open: false }); // an older file never opens the panel by itself
    expect(parsePrefs('{"pos":{"x":10,"y":20},"open":true}')).toEqual({ pos: { x: 10, y: 20 }, open: true });
  });
  it("round-trips through localStorage and survives a throwing store", () => {
    savePrefs({ pos: { x: 5, y: 6 }, open: true });
    expect(loadPrefs()).toEqual({ pos: { x: 5, y: 6 }, open: true });
    const orig = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try { expect(loadPrefs()).toEqual({ pos: null, open: false }); expect(() => savePrefs({ pos: null, open: false })).not.toThrow(); }
    finally { Object.defineProperty(window, "localStorage", orig); }
  });
});
