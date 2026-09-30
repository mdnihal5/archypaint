// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { LIGHT } from "./theme";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
let stage: HTMLDivElement;
let ed: Editor;
const ptr = (type: string, x: number, y: number, extra: MouseEventInit = {}) => stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra }));
const drag = (x0: number, y0: number, x1: number, y1: number) => { ptr("pointerdown", x0, y0); ptr("pointermove", (x0 + x1) / 2, (y0 + y1) / 2); ptr("pointermove", x1, y1); ptr("pointerup", x1, y1); };
const key = (k: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));

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

function withShape() {
  ed.setTool("rect"); drag(100, 100, 220, 180);
  const r = [...ed.scene.els.values()][0]!;
  return r;
}

describe("view-only mode", () => {
  it("every command that would change the document does nothing", () => {
    const r = withShape();
    ed.select([r.id]);
    const before = JSON.stringify(ed.scene.toJSON());
    ed.setReadOnly(true);
    expect(ed.readOnly).toBe(true);
    ed.select([r.id]);
    ed.deleteSelection(); ed.duplicateSelection(); ed.setStyle({ cat: 4 }); ed.group("x"); ed.nudge(10, 10); ed.bringToFront(); ed.placeIcon("cache");
    ed.insertLegend(); ed.align("left"); ed.toggleLock();
    ed.undo(); ed.redo();
    expect(JSON.stringify(ed.scene.toJSON())).toBe(before);
  });
  it("pointer gestures cannot move, resize, draw or edit; a drag pans the view instead", () => {
    const r = withShape();
    const x0 = r.x, y0 = r.y, w0 = r.w;
    ed.setReadOnly(true);
    const vx = ed.vp.x;
    drag(160, 140, 400, 300); // would move the shape
    expect([r.x, r.y, r.w]).toEqual([x0, y0, w0]);
    expect(ed.vp.x).not.toBe(vx); // panned
    const n = ed.scene.els.size;
    ed.setTool("rect"); drag(500, 500, 600, 600);
    stage.dispatchEvent(new MouseEvent("dblclick", { clientX: 700, clientY: 700, bubbles: true })); // would create a text
    expect(ed.scene.els.size).toBe(n);
  });
  it("keys (Delete, tool letters, Ctrl+A/D, arrows) are ignored", () => {
    const r = withShape();
    ed.setReadOnly(true);
    ed.select([r.id]);
    key("Delete"); key("a", { ctrlKey: true }); key("d", { ctrlKey: true }); key("ArrowRight"); key("r");
    expect(ed.scene.els.has(r.id)).toBe(true);
    expect(ed.scene.els.size).toBe(1);
    expect(ed.tool).toBe("select");
  });
  it("turning it on clears the selection and text editing; turning it off restores editing", () => {
    const r = withShape();
    ed.select([r.id]);
    ed.setReadOnly(true);
    expect(ed.selection().size).toBe(0);
    ed.setReadOnly(false);
    ed.select([r.id]);
    ed.deleteSelection();
    expect(ed.scene.els.size).toBe(0);
  });
  it("load() still works (that is how a shared document gets in) and does not make the document dirty", () => {
    ed.setReadOnly(true);
    ed.load({ els: [], groups: [] });
    ed.markSaved();
    expect(ed.dirty()).toBe(false);
  });
});
