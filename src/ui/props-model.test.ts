import { describe, expect, it } from "vitest";
import { Scene } from "../scene";
import { commonGroupId, commonValue, selectionEls } from "./props-model";

describe("props-model", () => {
  it("commonValue: shared value, mixed -> undefined, empty -> undefined", () => {
    const s = new Scene();
    const a = s.add({ kind: "rect", fill: 1 }), b = s.add({ kind: "rect", fill: 1 }), c = s.add({ kind: "rect", fill: 2 });
    expect(commonValue([a, b], (e) => e.fill)).toBe(1);
    expect(commonValue([a, b, c], (e) => e.fill)).toBeUndefined();
    expect(commonValue([], (e) => e.fill)).toBeUndefined();
  });
  it("commonGroupId: deepest group present in all selected elements", () => {
    const s = new Scene();
    const a = s.add({ kind: "rect", groupIds: ["inner", "outer"] }), b = s.add({ kind: "rect", groupIds: ["outer"] }), c = s.add({ kind: "rect" });
    expect(commonGroupId([a])).toBe("inner");
    expect(commonGroupId([a, b])).toBe("outer");
    expect(commonGroupId([a, b, c])).toBeNull();
    expect(commonGroupId([])).toBeNull();
  });
  it("selectionEls caps the work on select-all and skips stale ids", () => {
    const s = new Scene();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(s.add({ kind: "rect" }).id);
    ids.add("ghost");
    expect(selectionEls(s.els, ids, 400).length).toBe(400);
    expect(selectionEls(s.els, new Set(["ghost"])).length).toBe(0);
  });
});
