import { describe, expect, it } from "vitest";
import { revealScrollTop, windowRows } from "./vlist";

describe("windowRows", () => {
  it("renders only visible rows plus overscan for a huge list", () => {
    const w = windowRows(0, 260, 26, 5000, 4);
    expect(w.start).toBe(0);
    expect(w.end).toBe(14); // 10 visible + 4 overscan
    expect(w.total).toBe(5000 * 26);
  });
  it("windows the middle and offsets to the first rendered row", () => {
    const w = windowRows(26 * 1000, 260, 26, 5000, 4);
    expect(w.start).toBe(996);
    expect(w.end).toBe(1014);
    expect(w.offset).toBe(996 * 26);
  });
  it("clamps scrollTop past the end and handles empty / zero-height", () => {
    const w = windowRows(1e9, 260, 26, 100, 4);
    expect(w.end).toBe(100);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(windowRows(0, 260, 26, 0)).toEqual({ start: 0, end: 0, offset: 0, total: 0 });
    expect(windowRows(0, 0, 26, 50).end).toBe(0);
  });
  it("cost is independent of list size", () => {
    const a = windowRows(5000, 260, 26, 1000), b = windowRows(5000, 260, 26, 1_000_000);
    expect(b.end - b.start).toBe(a.end - a.start);
  });
});

describe("revealScrollTop", () => {
  it("returns null when the row is visible, else the minimal scroll", () => {
    expect(revealScrollTop(5, 0, 260, 26)).toBeNull();
    expect(revealScrollTop(30, 0, 260, 26)).toBe(30 * 26 + 26 - 260);
    expect(revealScrollTop(2, 200, 260, 26)).toBe(52);
  });
});
