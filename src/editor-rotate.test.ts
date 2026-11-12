// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { ROT_HANDLE_PX } from "./rotate";
import type { El } from "./scene";
import { LIGHT } from "./theme";

const D = Math.PI / 180;
const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
let stage: HTMLDivElement;
let ed: Editor;
const ptr = (type: string, x: number, y: number, extra: MouseEventInit = {}) => stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra }));
const drag = (x0: number, y0: number, x1: number, y1: number, extra: MouseEventInit = {}) => { ptr("pointerdown", x0, y0, extra); ptr("pointermove", (x0 + x1) / 2, (y0 + y1) / 2, extra); ptr("pointermove", x1, y1, extra); ptr("pointerup", x1, y1, extra); };

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

/** a 100 x 30 text at (200, 200): centre (250, 215), selected. Screen = world while the view is at its origin. */
function text(angle?: number, x = 200, y = 200): El {
  const e = ed.scene.add({ kind: "text", text: "hello", x, y, w: 100, h: 30, fill: 0, ...(angle !== undefined ? { angle } : {}) });
  ed.select([e.id]);
  return e;
}
/** the rotate handle of an unrotated 100x30 text at (200,200), straight above the centre */
const handleAt = (e: El, angle = e.angle ?? 0): [number, number] => {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2, d = e.h / 2 + ROT_HANDLE_PX; // up in the local frame, turned by the angle
  return [cx + d * Math.sin(angle), cy - d * Math.cos(angle)];
};
/** the point at `deg` clockwise from straight up, `r` from the centre */
const around = (e: El, deg: number, r = 120): [number, number] => [e.x + e.w / 2 + r * Math.sin(deg * D), e.y + e.h / 2 - r * Math.cos(deg * D)];

describe("rotating a free text", () => {
  it("dragging the handle rotates about the centre and snaps to 15 degrees", () => {
    const e = text(), [hx, hy] = handleAt(e), [tx, ty] = around(e, 40);
    drag(hx, hy, tx, ty);
    expect(e.angle).toBeCloseTo(45 * D, 6); // 40 deg -> nearest multiple of 15
    expect([e.x, e.y, e.w, e.h]).toEqual([200, 200, 100, 30]); // the box itself does not move
  });
  it("Shift = free rotation (no snapping)", () => {
    const e = text(), [hx, hy] = handleAt(e), [tx, ty] = around(e, 40);
    drag(hx, hy, tx, ty, { shiftKey: true });
    expect(e.angle).toBeCloseTo(40 * D, 6);
  });
  it("snaps back to 0 (clears the angle) when dragged to upright, and works negative", () => {
    const e = text(-30 * D), [hx, hy] = handleAt(e), [tx, ty] = around(e, 3);
    drag(hx, hy, tx, ty);
    expect(e.angle).toBeUndefined();
    const f = text(), [h2x, h2y] = handleAt(f), [t2x, t2y] = around(f, -31);
    drag(h2x, h2y, t2x, t2y);
    expect(f.angle).toBeCloseTo(-30 * D, 6);
  });
  it("one undo step per drag, redo reapplies it", () => {
    const e = text(), [hx, hy] = handleAt(e);
    drag(hx, hy, ...around(e, 40));
    expect(e.angle).toBeCloseTo(45 * D, 6);
    ed.undo();
    expect(e.angle).toBeUndefined();
    expect(ed.canUndo()).toBe(false); // exactly one step
    ed.redo();
    expect(e.angle).toBeCloseTo(45 * D, 6);
  });
  it("pressing the handle without moving changes nothing and leaves no undo step", () => {
    const e = text(), [hx, hy] = handleAt(e);
    drag(hx, hy, hx, hy);
    expect(e.angle).toBeUndefined();
    expect(ed.canUndo()).toBe(false);
  });
  it("the handle is only for a single selected text: not for shapes, not for two texts, not when locked", () => {
    ed.setTool("rect"); drag(100, 400, 220, 480);
    const r = [...ed.scene.els.values()].find((x) => x.kind === "rect")!;
    ed.select([r.id]);
    drag(160, 400 - 8 - ROT_HANDLE_PX, 300, 300); // where the handle would be: just a marquee/pan, no angle on a shape
    expect(r.angle).toBeUndefined();
    const a = text(), b = text(undefined, 500, 200);
    ed.select([a.id, b.id]);
    drag(...handleAt(a), ...around(a, 40));
    expect(a.angle).toBeUndefined();
    ed.select([a.id]); a.locked = true;
    drag(...handleAt(a), ...around(a, 40));
    expect(a.angle).toBeUndefined();
  });
  it("read-only mode blocks it", () => {
    const e = text(), [hx, hy] = handleAt(e);
    ed.setReadOnly(true);
    drag(hx, hy, ...around(e, 40));
    expect(e.angle).toBeUndefined();
  });
});

describe("a rotated text in the editor", () => {
  it("clicking inside the turned box selects it; clicking in the old box but outside the turned one does not", () => {
    const e = text(90 * D); // 100 x 30 -> 30 wide, 100 tall around (250, 215)
    ed.clearSelection();
    drag(250, 255, 252, 255); // 40 below the centre: inside only when rotated
    expect(ed.selection().has(e.id)).toBe(true);
    ed.clearSelection();
    drag(295, 215, 296, 215); // inside the old box, outside the turned one: marquee, nothing selected
    expect(ed.selection().size).toBe(0);
  });
  it("marquee selects by the turned bounds", () => {
    const e = text(90 * D); // turned bounds x 235..265, y 165..265
    ed.clearSelection();
    drag(180, 150, 320, 240); // covers the old box, but not the turned one's lower half
    expect(ed.selection().size).toBe(0);
    drag(180, 150, 320, 290);
    expect(ed.selection().has(e.id)).toBe(true);
  });
  it("moving keeps the angle", () => {
    const e = text(30 * D);
    ed.clearSelection();
    drag(250, 215, 350, 315);
    expect(e.angle).toBeCloseTo(30 * D, 9);
    expect(e.x).toBeGreaterThan(250);
  });
  it("resizing works in the text's own frame: a handle turned to face south grows the width, the opposite edge stays put", () => {
    const e = text(90 * D); // local east (+x) now points down: that handle is at (250, 265)
    drag(250, 265, 250, 305); // pull it 40 further south
    expect(e.angle).toBeCloseTo(90 * D, 9);
    expect(e.w).toBeCloseTo(140, 6); expect(e.h).toBeCloseTo(30, 6);
    // the west edge midpoint was (250, 165) and must not have moved: new centre (250, 235)
    expect(e.x + e.w / 2).toBeCloseTo(250, 6); expect(e.y + e.h / 2).toBeCloseTo(235, 6);
    ed.undo();
    expect([e.x, e.y, e.w, e.h]).toEqual([200, 200, 100, 30]);
    expect(e.angle).toBeCloseTo(90 * D, 9);
  });
  it("duplicate keeps the angle", () => {
    const e = text(30 * D);
    ed.duplicateSelection();
    const copies = [...ed.scene.els.values()].filter((x) => x.id !== e.id);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.angle).toBeCloseTo(30 * D, 9);
  });
  it("align uses the turned bounding box", () => {
    const a = text(90 * D, 100, 100), b = ed.scene.add({ kind: "text", text: "b", x: 300, y: 300, w: 60, h: 20, fill: 0 }); // a's turned bounds: x 135..165
    ed.select([a.id, b.id]);
    ed.align("left");
    expect(b.x).toBeCloseTo(135, 6);
    expect(a.x).toBe(100);
  });
  it("the edit overlay is rotated with the text", () => {
    const e = text(30 * D);
    ed.editSelection();
    const ta = stage.querySelector("textarea")!;
    expect(ta.style.transform).toContain("rotate(");
    expect(e.angle).toBeCloseTo(30 * D, 9);
    ed.undo?.();
  });
  it("the unrotated overlay is unchanged (no rotate in its transform)", () => {
    text();
    ed.editSelection();
    expect(stage.querySelector("textarea")!.style.transform).not.toContain("rotate");
  });
  it("copy and paste keep the angle; pasted junk or an angle on a shape is dropped", () => {
    const e = text(30 * D);
    const core = ed as unknown as { copyText(): string | null; pasteText(s: string): boolean };
    const json = core.copyText()!;
    expect(core.pasteText(json)).toBe(true);
    const pasted = [...ed.scene.els.values()].filter((x) => x.id !== e.id);
    expect(pasted).toHaveLength(1);
    expect(pasted[0]!.angle).toBeCloseTo(30 * D, 9);
    const data = JSON.parse(json.slice(json.indexOf("{")));
    data.els[0].angle = "x"; data.els.push({ ...data.els[0], id: "zz", kind: "rect", angle: 1 });
    expect(core.pasteText(JSON.stringify(data))).toBe(true);
    for (const x of ed.scene.els.values()) if (x.id !== e.id && x !== pasted[0]) expect(x.angle).toBeUndefined();
  });
  it("a connector bound to the text follows its turned ports", () => {
    const e = text();
    ed.setTool("arrow"); drag(250, 215, 600, 215);
    const ar = [...ed.scene.els.values()].find((x) => x.kind === "arrow")!;
    expect(ar.src).toBe(e.id);
    expect(ar.pts[0]).toBeCloseTo(300, 6); // leaves the east side of the upright text
    ed.select([e.id]);
    drag(...handleAt(e), ...around(e, 90));
    expect(e.angle).toBeCloseTo(90 * D, 6);
    expect(ar.pts[0]).toBeCloseTo(265, 4); // the side that now faces the target is the old top: 15 right of the centre
    expect(ar.pts[1]).toBeCloseTo(215, 4);
    ed.undo();
    expect(ar.pts[0]).toBeCloseTo(300, 6); // one undo step restores both
  });
});
