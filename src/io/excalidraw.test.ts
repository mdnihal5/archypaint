import { describe, expect, it } from "vitest";
import { LIGHT } from "../theme";
import { fromExcalidraw, nearestCat, toExcalidraw } from "./excalidraw";
import { LIMITS } from "./format";
import { el } from "./testkit";

type O = Record<string, unknown>;
const ex = (type: string, id: string, p: O = {}): O => ({ id, type, x: 0, y: 0, width: 96, height: 60, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeStyle: "solid", roundness: null, groupIds: [], isDeleted: false, ...p });
const file = (elements: O[], extra: O = {}) => ({ type: "excalidraw", version: 2, source: "test", elements, appState: {}, files: {}, ...extra });

describe("Excalidraw import: bindings in BOTH formats", () => {
  const r1 = ex("rectangle", "r1", { x: 0, y: 20 });
  const r2 = ex("rectangle", "r2", { x: 220, y: 20 });

  it("older format {elementId, focus, gap}: ports are derived from where the arrow ends", () => {
    const arrow = ex("arrow", "a1", { x: 100, y: 50, width: 120, height: 0, points: [[0, 0], [120, 0]], endArrowhead: "arrow",
      startBinding: { elementId: "r1", focus: 0.1, gap: 4 }, endBinding: { elementId: "r2", focus: -0.2, gap: 8 } });
    const r = fromExcalidraw(file([r1, r2, arrow]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.scene.els.find((e) => e.kind === "arrow")!;
    const ids = r.scene.els.filter((e) => e.kind === "rect").map((e) => e.id);
    expect(a.src).toBe(ids[0]); expect(a.dst).toBe(ids[1]);
    expect(a.sp).toBe(1); expect(a.dp).toBe(3);
    expect(a.pts).toEqual([100, 50, 220, 50]);
    expect(a.head).toBe(1);
  });

  it("current format {elementId, fixedPoint, mode}: the port comes from fixedPoint", () => {
    const arrow = ex("arrow", "a1", { x: 50, y: 20, width: 0, height: -60, points: [[0, 0], [0, -40]],
      startBinding: { elementId: "r1", fixedPoint: [0.5, 0], mode: "orbit" }, endBinding: { elementId: "r2", fixedPoint: [0, 0.5], mode: "inside" } });
    const r = fromExcalidraw(file([r1, r2, arrow]));
    const a = r.ok ? r.scene.els.find((e) => e.kind === "arrow")! : null;
    expect(a).toMatchObject({ sp: 0, dp: 3 });
  });

  it("a binding to a deleted or unsupported element leaves that end free, with a warning", () => {
    const arrow = ex("arrow", "a1", { points: [[0, 0], [10, 0]], startBinding: { elementId: "nope", focus: 0, gap: 1 }, endBinding: { elementId: "img", focus: 0, gap: 1 } });
    const r = fromExcalidraw(file([arrow, ex("image", "img")]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.scene.els.find((e) => e.kind === "arrow")!;
    expect(a.src).toBe(""); expect(a.dst).toBe("");
    expect(r.warnings.join(" ")).toMatch(/left free/);
    expect(r.warnings.join(" ")).toMatch(/image/);
  });

  it("maps routing, heads and dash", () => {
    const mk = (p: O) => { const r = fromExcalidraw(file([ex("arrow", "a", { points: [[0, 0], [50, 50]], ...p })])); return r.ok ? r.scene.els[0]! : null; };
    expect(mk({ elbowed: true })).toMatchObject({ route: 1 });
    expect(mk({ roundness: { type: 2 } })).toMatchObject({ route: 2 });
    expect(mk({})).toMatchObject({ route: 0, head: 1 });
    expect(mk({ endArrowhead: null })).toMatchObject({ head: 0 });
    expect(mk({ endArrowhead: "dot" })).toMatchObject({ head: 2 });
    expect(mk({ strokeStyle: "dashed" })).toMatchObject({ dash: 1 });
  });
});

describe("Excalidraw import: shapes, labels, groups, skipping", () => {
  it("maps shapes, merges bound labels into their container, maps rounding and fill", () => {
    const r = fromExcalidraw(file([
      ex("rectangle", "r", { roundness: { type: 3 }, backgroundColor: "#a5d8ff", boundElements: [{ type: "text", id: "t" }] }),
      ex("text", "t", { containerId: "r", text: "api" }),
      ex("ellipse", "o"), ex("diamond", "d"), ex("text", "free", { text: "note" }),
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.els.map((e) => e.kind)).toEqual(["rect", "ellipse", "diamond", "text"]);
    expect(r.scene.els[0]).toMatchObject({ text: "api", edge: 1, fill: 1 });
    expect(r.scene.els[1]).toMatchObject({ fill: 0 });
    expect(r.scene.els[3]).toMatchObject({ kind: "text", text: "note" });
  });

  it("skips deleted, freedraw, frames and images, and says so; rotation is reported", () => {
    const r = fromExcalidraw(file([ex("rectangle", "a", { angle: 0.5 }), ex("rectangle", "gone", { isDeleted: true }), ex("freedraw", "f"), ex("frame", "fr"), ex("image", "i")]));
    expect(r.ok && r.scene.els).toHaveLength(1);
    const w = r.ok ? r.warnings.join(" | ") : "";
    expect(w).toMatch(/freedraw/); expect(w).toMatch(/frame/); expect(w).toMatch(/image/); expect(w).toMatch(/rotated/);
  });

  it("group ids map to short ids, shared members keep sharing", () => {
    const r = fromExcalidraw(file([ex("rectangle", "a", { groupIds: ["G-uuid-1", "outer"] }), ex("rectangle", "b", { groupIds: ["G-uuid-1"] })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.els[0]!.groupIds[0]).toBe(r.scene.els[1]!.groupIds[0]);
    expect(r.scene.els[0]!.groupIds).toHaveLength(2);
  });

  it("colours map to the nearest category; deterministic tie-break", () => {
    expect(nearestCat("#1971c2", LIGHT).cat).toBe(0); // blue -> data
    expect(nearestCat("#2f9e44", LIGHT).cat).toBe(2); // green -> network
    expect(nearestCat("not-a-colour").dist).toBe(Infinity);
    expect(nearestCat("#abc")).toEqual(nearestCat("#aabbcc"));
  });
});

describe("Excalidraw import: refusing bad input", () => {
  it("rejects non-Excalidraw / malformed / oversized input with a message", () => {
    for (const bad of [null, 5, "x", [], {}, { type: "other" }, { type: "excalidraw" }]) expect(fromExcalidraw(bad).ok).toBe(false);
    const big = { type: "excalidraw", elements: new Array(LIMITS.maxElements + 1).fill({}) };
    const r = fromExcalidraw(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Too many/);
  });
  it("ignores elements with non-finite geometry instead of failing the import", () => {
    const r = fromExcalidraw(file([ex("rectangle", "a", { width: NaN }), ex("rectangle", "b"), ex("arrow", "c", { points: [[0, 0]] }), ex("rectangle", "d", { x: "1" })]));
    expect(r.ok && r.scene.els).toHaveLength(1);
    expect(r.ok && r.warnings.join(" ")).toMatch(/invalid geometry/);
  });
  it("survives hostile customData", () => {
    const r = fromExcalidraw(file([ex("rectangle", "a", { customData: { archypaint: { kind: "arrow", cat: "x", fill: 99, iconId: 5, radius: -1 } } })]));
    expect(r.ok && r.scene.els[0]).toMatchObject({ kind: "rect", cat: 6, fill: 0, radius: 0 }); // invalid customData ignored: values come from the Excalidraw attributes
  });
});

describe("Excalidraw export and round trip", () => {
  const doc = {
    els: [
      el({ id: "e1", kind: "rect", x: 0, y: 0, w: 120, h: 70, text: "api", cat: 3, fill: 2, edge: 0, radius: 0, z: 1, groupIds: ["g1"] }),
      el({ id: "e2", kind: "icon", x: 240, y: 0, w: 96, h: 96, iconId: "sql-database", cat: 0, text: "", z: 2, groupIds: ["g1"] }),
      el({ id: "e3", kind: "arrow", x: 120, y: 35, w: 120, h: 13, pts: [120, 35, 180, 35, 180, 48, 240, 48], src: "e1", dst: "e2", sp: 1, dp: 3, route: 1, head: 2, dash: 1, text: "sql", z: 3 }),
      el({ id: "e4", kind: "text", x: 0, y: 200, w: 60, h: 20, text: "note", z: 4 }),
      el({ id: "e5", kind: "diamond", x: 300, y: 200, w: 80, h: 80, cat: 5, fill: 0, z: 5 }),
    ],
    groups: [{ id: "g1", name: "compute tier", cat: 3, collapsed: false, locked: false }],
  };

  it("writes both binding formats, bound elements, labels, and a valid envelope", () => {
    const j = toExcalidraw(doc) as { type: string; elements: O[] };
    expect(j.type).toBe("excalidraw");
    const arrow = j.elements.find((e) => e.type === "arrow")!;
    expect(arrow.startBinding).toMatchObject({ elementId: "e1", fixedPoint: [1, 0.5], focus: 0, gap: 4, mode: "orbit" });
    expect(arrow.endBinding).toMatchObject({ elementId: "e2", fixedPoint: [0, 0.5] });
    expect(arrow.endArrowhead).toBe("dot"); expect(arrow.strokeStyle).toBe("dashed"); expect(arrow.elbowed).toBe(true);
    expect((j.elements.find((e) => e.id === "e1")!.boundElements as O[]).map((b) => b.type).sort()).toEqual(["arrow", "text"]);
    expect(j.elements.filter((e) => e.type === "text" && e.containerId).length).toBe(3); // api, icon label, arrow label
    expect(JSON.stringify(j)).not.toContain("NaN");
  });

  it("the icon becomes a labelled rectangle (documented loss)", () => {
    const j = toExcalidraw(doc) as { elements: O[] };
    const icon = j.elements.find((e) => e.id === "e2")!;
    expect(icon.type).toBe("rectangle");
    expect(j.elements.find((e) => e.containerId === "e2")).toMatchObject({ text: "sql-database" });
  });

  it("archypaint -> Excalidraw JSON -> archypaint preserves what matters", () => {
    const r = fromExcalidraw(JSON.parse(JSON.stringify(toExcalidraw(doc))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byKind = (k: string) => r.scene.els.filter((e) => e.kind === k);
    expect(r.scene.els).toHaveLength(5);
    expect(r.warnings).toEqual([]);
    const icon = byKind("icon")[0]!;
    expect(icon).toMatchObject({ iconId: "sql-database", cat: 0, text: "", w: 96, h: 96 });
    const box = byKind("rect")[0]!;
    expect(box).toMatchObject({ text: "api", cat: 3, fill: 2, edge: 0, w: 120, h: 70 });
    const a = byKind("arrow")[0]!;
    expect(a).toMatchObject({ src: box.id, dst: icon.id, sp: 1, dp: 3, route: 1, head: 2, dash: 1, text: "sql" });
    expect(a.pts).toEqual([120, 35, 180, 35, 180, 48, 240, 48]);
    expect(byKind("diamond")[0]).toMatchObject({ cat: 5, fill: 0 });
    expect(byKind("text")[0]).toMatchObject({ text: "note" });
    // group name survives, members still share the (re-numbered) group id
    expect(r.scene.groups).toHaveLength(1);
    expect(r.scene.groups[0]).toMatchObject({ name: "compute tier", cat: 3 });
    expect(box.groupIds).toEqual([r.scene.groups[0]!.id]);
    expect(icon.groupIds).toEqual([r.scene.groups[0]!.id]);
  });
});
