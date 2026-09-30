import { describe, expect, it } from "vitest";
import { GroupIndex } from "./groups";
import { Scene } from "./scene";

describe("group index", () => {
  it("selects the topmost group; entering a group selects the next level", () => {
    const s = new Scene();
    const a = s.add({ kind: "rect", groupIds: ["inner", "outer"], x: 0, y: 0, w: 10, h: 10 });
    const b = s.add({ kind: "rect", groupIds: ["inner", "outer"], x: 20, y: 0, w: 10, h: 10 });
    const c = s.add({ kind: "rect", groupIds: ["outer"], x: 40, y: 0, w: 10, h: 10 });
    const d = s.add({ kind: "rect" });
    for (const g of ["inner", "outer"]) s.groups.set(g, { id: g, name: g, cat: 0, collapsed: false, locked: false });
    const gi = new GroupIndex(s);
    expect([...gi.unit(a, new Set())].sort()).toEqual([a.id, b.id, c.id].sort());
    expect([...gi.unit(a, new Set(["outer"]))].sort()).toEqual([a.id, b.id].sort());
    expect([...gi.unit(a, new Set(["outer", "inner"]))]).toEqual([a.id]);
    expect([...gi.unit(d, new Set())]).toEqual([d.id]);
    expect(gi.unitGroup(a, new Set())).toBe("outer");
  });
  it("nested boundaries are padded wider than inner ones and the index follows scene changes", () => {
    const s = new Scene();
    const a = s.add({ kind: "rect", groupIds: ["i", "o"], x: 0, y: 0, w: 10, h: 10 });
    s.groups.set("i", { id: "i", name: "i", cat: 0, collapsed: false, locked: false });
    s.groups.set("o", { id: "o", name: "o", cat: 0, collapsed: false, locked: false });
    const gi = new GroupIndex(s);
    expect(gi.bounds("o")!.w).toBeGreaterThan(gi.bounds("i")!.w);
    s.set(a, 500, 500);
    expect(gi.bounds("i")!.x).toBeGreaterThan(400);
    s.remove(a);
    expect(gi.membersOf("i")).toEqual([]);
  });
});
