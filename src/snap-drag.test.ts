// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { Snap } from "./snap";
import { LIGHT } from "./theme";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
let stage: HTMLDivElement, ed: Editor;
const ptr = (type: string, x: number, y: number, extra: MouseEventInit = {}) => {
  stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra }));
  if (type === "pointermove") ed.renderer.onBeforeFrame?.(); // moves are applied once per frame: run that step
};
const key = (k: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div");
  stage.setPointerCapture = () => {}; stage.releasePointerCapture = () => {};
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  ed.renderer.resize(1200, 800, 1);
});
afterEach(() => { ed.destroy(); stage.remove(); });

describe("Snap (pure)", () => {
  it("picks the nearest line within the threshold and reports it", () => {
    const s = new Snap(); s.reset(6);
    s.try3(100, 90, 97, 120);
    expect(s.g).toBe(97); expect(s.d).toBe(-3);
  });
  it("nothing within the threshold leaves d=0 and g=NaN; NaN never matches", () => {
    const s = new Snap(); s.reset(6);
    s.try3(100, 50, 60, 200); s.try3(NaN, 100, 100, 100);
    expect(s.d).toBe(0); expect(Number.isNaN(s.g)).toBe(true);
  });
  it("a later, closer line wins; ties keep the first", () => {
    const s = new Snap(); s.reset(6);
    s.try3(10, 14, 12, 12); s.try3(10, 8, 12, 9);
    expect(s.g).toBe(9);
    s.try3(10, 11, 9, 9);
    expect(s.g).toBe(9);
  });
});

describe("guides while resizing and drawing", () => {
  const two = () => {
    const a = ed.scene.add({ kind: "rect", x: 100, y: 100, w: 120, h: 80 });
    const n = ed.scene.add({ kind: "rect", x: 500, y: 240, w: 120, h: 80 });
    ed.renderer.invalidate(true, true);
    return [a, n] as const;
  };
  it("resizing a rect's right edge near a neighbour's edge snaps flush, shows a guide, and clears it on pointer up", () => {
    const [a] = two(); ed.select([a.id]);
    ptr("pointerdown", 220, 140); ptr("pointermove", 400, 140); ptr("pointermove", 497, 140);
    expect(a.x + a.w).toBe(500);
    expect(ed.renderer.guideX).toEqual([500]);
    ptr("pointerup", 497, 140);
    expect(a.x + a.w).toBe(500);
    expect(ed.renderer.guideX).toEqual([]); expect(ed.renderer.guideY).toEqual([]);
  });
  it("a corner drag snaps both axes to a neighbour's centre lines", () => {
    const [a] = two(); ed.select([a.id]);
    ptr("pointerdown", 220, 180); ptr("pointermove", 400, 250); ptr("pointermove", 558, 277);
    expect(a.x + a.w).toBe(560); expect(a.y + a.h).toBe(280);
    expect(ed.renderer.guideX).toEqual([560]); expect(ed.renderer.guideY).toEqual([280]);
    ptr("pointerup", 558, 277);
    expect(ed.renderer.guideX.length + ed.renderer.guideY.length).toBe(0);
  });
  it("far from any neighbour nothing snaps and no guide shows; snap off disables it; Escape clears guides", () => {
    const [a] = two(); ed.select([a.id]);
    ptr("pointerdown", 220, 140); ptr("pointermove", 300, 140);
    expect(a.x + a.w).toBe(300); expect(ed.renderer.guideX).toEqual([]);
    ptr("pointermove", 497, 140); expect(ed.renderer.guideX).toEqual([500]);
    key("Escape");
    expect(ed.renderer.guideX).toEqual([]); expect(a.w).toBe(120);
    ed.snap = false;
    ptr("pointerdown", 220, 140); ptr("pointermove", 497, 140);
    expect(a.x + a.w).toBe(497); expect(ed.renderer.guideX).toEqual([]);
    ptr("pointerup", 497, 140);
  });
  it("Shift (aspect lock) and rotated elements do not snap", () => {
    const [a] = two(); ed.select([a.id]);
    ptr("pointerdown", 220, 180, { shiftKey: true }); ptr("pointermove", 497, 330, { shiftKey: true });
    expect(ed.renderer.guideX).toEqual([]); ptr("pointerup", 497, 330, { shiftKey: true });
    ed.undo();
    const r = ed.scene.add({ kind: "text", x: 100, y: 400, w: 120, h: 40, angle: 0.5, text: "hi" } as never);
    ed.renderer.invalidate(true, true); ed.select([r.id]);
    ptr("pointerdown", 220, 420); ptr("pointermove", 497, 420);
    expect(ed.renderer.guideX).toEqual([]); ptr("pointerup", 497, 420);
  });
  it("drawing a rect: the moving corner snaps to a neighbour and guides vanish on release and on Escape", () => {
    two(); ed.setTool("rect");
    ptr("pointerdown", 100, 400); ptr("pointermove", 300, 450); ptr("pointermove", 497, 297);
    expect(ed.renderer.ghost!.x + ed.renderer.ghost!.w).toBe(500);
    expect(ed.renderer.guideX).toEqual([500]);
    ptr("pointerup", 497, 297);
    expect(ed.renderer.guideX).toEqual([]); expect(ed.renderer.guideY).toEqual([]);
    ed.setTool("rect");
    ptr("pointerdown", 100, 400); ptr("pointermove", 497, 450);
    expect(ed.renderer.guideX).toEqual([500]);
    key("Escape");
    expect(ed.renderer.guideX).toEqual([]);
  });
});
