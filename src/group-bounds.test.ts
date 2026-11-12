// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { exportGroups, groupBox } from "./groups";
import { LIGHT } from "./theme";

const el = (o: Record<string, unknown>) => ({ id: "a", kind: "rect", x: 100, y: 100, w: 48, h: 66, text: "", groupIds: ["g"], ...o }) as never;

describe("a group's outline holds what its members draw", () => {
  it("an icon's name wider than the icon stays inside the outline, on both sides", () => {
    const name = "notification processing service"; // 31 chars: wider than the 48 unit tile
    const b = groupBox([el({ kind: "icon", text: name })], "g")!;
    const half = Math.min(name.length * 13 * 0.6, 140) / 2, cx = 124;
    expect(b.x).toBeLessThanOrEqual(cx - half);
    expect(b.x + b.w).toBeGreaterThanOrEqual(cx + half);
  });
  it("an icon with a short name keeps the plain padded box", () => {
    expect(groupBox([el({ kind: "icon", text: "db" })], "g")).toEqual({ x: 88, y: 88, w: 72, h: 90 });
  });
  it("free text wider than its stored box stays inside, using its longest line", () => {
    const b = groupBox([el({ kind: "text", w: 40, h: 40, text: "ab\nthis line is the long one" })], "g")!;
    const half = 26 * 13 * 0.6 / 2;
    expect(b.x).toBeLessThanOrEqual(120 - half);
    expect(b.x + b.w).toBeGreaterThanOrEqual(120 + half);
  });
  it("text size counts", () => {
    const small = groupBox([el({ kind: "icon", text: "a service name" })], "g")!, big = groupBox([el({ kind: "icon", text: "a service name", fs: 26 })], "g")!;
    expect(big.w).toBeGreaterThan(small.w);
  });
  it("a shape's label wraps inside the shape, so it does not widen the outline", () => {
    expect(groupBox([el({ w: 120, h: 60, text: "a label long enough to wrap around in the box" })], "g")).toEqual({ x: 88, y: 88, w: 144, h: 84 });
  });
  it("a long group name widens the outline to the right so the tag stays over it", () => {
    const name = "a long group name for the riders service tier";
    const plain = groupBox([el({ w: 60, h: 60 })], "g")!, b = groupBox([el({ w: 60, h: 60 })], "g", name)!;
    expect(b.x).toBe(plain.x);
    expect(b.x + b.w).toBeGreaterThanOrEqual(b.x + 12 + name.length * 7.9);
  });
  it("exports use the same outline", () => {
    const m = [el({ kind: "icon", text: "notification processing service" })];
    const [o] = exportGroups(m, [{ id: "g", name: "a long group name for the riders service tier", cat: 0 }], () => 1);
    expect(o!.box).toEqual(groupBox(m, "g", "a long group name for the riders service tier"));
  });
});

describe("connectors bound to a group follow its outline when text changes it", () => {
  const fakeCtx = new Proxy({}, {
    get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
    set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
  });
  let stage: HTMLDivElement, ed: Editor;
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
    stage = document.createElement("div");
    const a = document.createElement("canvas"), b = document.createElement("canvas");
    stage.append(a, b); document.body.append(stage);
    ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
    ed.renderer.resize(1400, 900, 1);
  });
  afterEach(() => { ed.destroy(); stage.remove(); });

  it("renaming a group to a longer name re-fits the line on its right side, and undo puts it back", () => {
    const m1 = ed.scene.add({ kind: "rect", x: 100, y: 100, w: 40, h: 40 }), m2 = ed.scene.add({ kind: "rect", x: 100, y: 160, w: 40, h: 40 });
    const out = ed.scene.add({ kind: "rect", x: 600, y: 130, w: 80, h: 40 });
    ed.select([m1.id, m2.id]);
    const gid = ed.group("g")!;
    const ar = ed.scene.add({ kind: "arrow", src: gid, dst: out.id, sp: 1, dp: 3, route: 0, head: 1, pts: [152, 150, 600, 150] });
    ed.renameGroup(gid, "a long group name for the riders tier");
    expect(ar.pts[0]).toBeCloseTo(88 + 24 + 37 * 7.9, 3);
    ed.undo();
    expect(ed.scene.groups.get(gid)!.name).toBe("g");
    expect(ed.scene.els.get(ar.id)!.pts[0]).toBe(152);
  });
});
