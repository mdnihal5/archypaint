import { describe, expect, it } from "vitest";
import { Scene } from "../scene";
import { buildRows, rowIndexOf } from "./layers-model";

function mk() {
  const s = new Scene();
  const a = s.add({ kind: "rect", text: "a" }), b = s.add({ kind: "rect", text: "b" }), c = s.add({ kind: "rect", text: "c" }), d = s.add({ kind: "rect", text: "d" });
  return { s, a, b, c, d };
}

describe("buildRows", () => {
  it("lists shapes topmost first", () => {
    const { s } = mk();
    expect(buildRows(s, new Set()).map((r) => r.label)).toEqual(["d", "c", "b", "a"]);
  });
  it("nests members under a named group, placed at its topmost member", () => {
    const { s, a, c } = mk();
    s.groups.set("g1", { id: "g1", name: "compute-tier", cat: 3, collapsed: false, locked: false });
    s.patch(a, { groupIds: ["g1"] }); s.patch(c, { groupIds: ["g1"] });
    const rows = buildRows(s, new Set());
    expect(rows.map((r) => `${r.depth}:${r.label}`)).toEqual(["0:d", "0:compute-tier", "1:c", "1:a", "0:b"]);
    expect(rows[1]!.kind).toBe("group");
    expect(rows[1]!.members).toEqual([c.id, a.id]);
  });
  it("collapsed groups hide their children but keep the group row", () => {
    const { s, a, c } = mk();
    s.groups.set("g1", { id: "g1", name: "tier", cat: 0, collapsed: false, locked: false });
    s.patch(a, { groupIds: ["g1"] }); s.patch(c, { groupIds: ["g1"] });
    const rows = buildRows(s, new Set(["g1"]));
    expect(rows.map((r) => r.label)).toEqual(["d", "tier", "b"]);
    expect(rows[1]!.expanded).toBe(false);
  });
  it("nests groups deepest -> shallowest (Excalidraw order) and labels an unnamed group", () => {
    const { s, a, b } = mk();
    s.groups.set("outer", { id: "outer", name: "outer", cat: 0, collapsed: false, locked: false });
    s.patch(a, { groupIds: ["inner", "outer"] }); s.patch(b, { groupIds: ["outer"] });
    const rows = buildRows(s, new Set());
    expect(rows.map((r) => `${r.depth}:${r.label}`)).toEqual(["0:d", "0:c", "0:outer", "1:b", "1:group", "2:a"]);
  });
  it("falls back to icon id, then kind, for unlabeled shapes", () => {
    const s = new Scene();
    s.add({ kind: "icon", iconId: "load-balancer-l7" }); s.add({ kind: "ellipse" });
    expect(buildRows(s, new Set()).map((r) => r.label)).toEqual(["ellipse", "load-balancer-l7"]);
  });
  it("rowIndexOf finds a row or -1", () => {
    const { s, a } = mk();
    const rows = buildRows(s, new Set());
    expect(rowIndexOf(rows, a.id)).toBe(3);
    expect(rowIndexOf(rows, "nope")).toBe(-1);
  });
  it("builds 5,000 shapes (60 grouped) fast enough to run once per frame", () => {
    const s = new Scene();
    s.groups.set("g", { id: "g", name: "g", cat: 0, collapsed: false, locked: false });
    for (let i = 0; i < 5000; i++) s.add({ kind: "rect", x: i, groupIds: i % 80 === 0 ? ["g"] : [] });
    const t0 = performance.now();
    const rows = buildRows(s, new Set());
    const ms = performance.now() - t0;
    expect(rows.length).toBe(5000 + 1); // every shape once, plus the one group row
    expect(ms).toBeLessThan(60);
  });
});
