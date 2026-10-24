import { describe, expect, it } from "vitest";
import { LIGHT } from "../theme";
import { fromExcalidraw, toExcalidraw } from "./excalidraw";
import { parseArch, serializeArch, FORMAT_VERSION } from "./format";
import { el } from "./testkit";

type O = Record<string, unknown>;
const meta = { name: "t", created: 1, updated: 1 };
const doc = (els: ReturnType<typeof el>[], groups: { id: string; name: string; cat: number; collapsed: boolean; locked: boolean }[] = []) =>
  ({ meta, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: { els, groups }, extra: {}, elExtra: {} }) as never;

describe("text alignment in the .archypaint format", () => {
  it("absent means centre: nothing is written for centre, and no version bump was needed", () => {
    const text = serializeArch(doc([el({ id: "a", text: "x" }), el({ id: "b", text: "y", align: "center" })]));
    expect(text).not.toContain("align");
    expect(FORMAT_VERSION).toBe(2);
  });
  it("left / right round-trip; junk is ignored", () => {
    const text = serializeArch(doc([el({ id: "a", text: "x", align: "left" }), el({ id: "b", text: "y", align: "right" })]));
    const p = parseArch(text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.scene.els.map((e) => e.align)).toEqual(["left", "right"]);
    const bad = text.replace('"align":"left"', '"align":"sideways"');
    const q = parseArch(bad);
    expect(q.ok && q.value.scene.els[0]!.align).toBeFalsy();
  });
  it("a file written before this field existed still opens, centred", () => {
    const p = parseArch(serializeArch(doc([el({ id: "a", text: "x" })])));
    expect(p.ok && p.value.scene.els[0]!.align).toBeUndefined();
  });
});

describe("Excalidraw export / import: alignment and group outlines", () => {
  const els = [el({ id: "a", x: 0, y: 0, w: 100, h: 60, text: "left one", align: "left", groupIds: ["g1"], z: 1 }), el({ id: "b", x: 200, y: 0, w: 100, h: 60, text: "right", align: "right", groupIds: ["g1"], z: 2 }), el({ id: "t", kind: "text", x: 0, y: 200, w: 80, h: 20, text: "free", align: "right", z: 3 }), el({ id: "c", x: 400, y: 0, text: "mid", z: 4 })];
  const groups = [{ id: "g1", name: "backend", cat: 2, collapsed: false, locked: false }];
  const out = toExcalidraw({ els, groups }, LIGHT) as { elements: O[] };
  const byId = (id: string) => out.elements.find((e) => e.id === id)!;

  it("textAlign is exported for shape labels and free text; centre stays centre", () => {
    expect(byId("a_t").textAlign).toBe("left"); expect(byId("b_t").textAlign).toBe("right");
    expect(byId("t").textAlign).toBe("right"); expect(byId("c_t").textAlign).toBe("center");
  });
  it("each group becomes a dashed, transparent, locked rectangle plus a left-aligned name, not a frame", () => {
    expect(out.elements.some((e) => e.type === "frame")).toBe(false);
    const o = byId("g1_outline");
    expect(o).toMatchObject({ type: "rectangle", strokeStyle: "dashed", backgroundColor: "transparent", locked: true, x: -12, y: -12, width: 324, height: 84 });
    expect(byId("g1_tag")).toMatchObject({ type: "text", text: "backend", textAlign: "left" });
    // beneath the content: it precedes every element in the array
    expect(out.elements.indexOf(o)).toBeLessThan(out.elements.indexOf(byId("a")));
  });
  it("round trip: alignment survives, the outline and its tag do NOT come back as shapes, the group does", () => {
    const back = fromExcalidraw(JSON.parse(JSON.stringify(out)));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.els).toHaveLength(4);
    expect(back.scene.els.map((e) => e.align)).toEqual(["left", "right", "right", undefined]);
    expect(back.scene.els.filter((e) => e.groupIds.length)).toHaveLength(2);
  });
  it("a plain Excalidraw text / bound label with textAlign right or left imports as aligned", () => {
    const base = { x: 0, y: 0, width: 96, height: 60, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeStyle: "solid", roundness: null, groupIds: [], isDeleted: false };
    const r = fromExcalidraw({ type: "excalidraw", version: 2, elements: [
      { ...base, id: "r", type: "rectangle" }, { ...base, id: "rt", type: "text", text: "in box", containerId: "r", textAlign: "left" },
      { ...base, id: "t", type: "text", text: "loose", textAlign: "right", containerId: null },
    ], appState: {}, files: {} });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.els.map((e) => [e.kind, e.align])).toEqual([["rect", "left"], ["text", "right"]]);
  });
});
