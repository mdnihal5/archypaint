// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { LIGHT } from "./theme";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
let stage: HTMLDivElement, ed: Editor;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div");
  stage.setPointerCapture = () => { throw new Error("the canvas must not capture a pointer that started in the edit box"); };
  stage.releasePointerCapture = () => {};
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  ed.renderer.resize(1400, 900, 1);
});
afterEach(() => { ed.destroy(); stage.remove(); });

const on = (t: EventTarget, type: string, x: number, y: number) => t.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }));

describe("pointer gestures inside the inline text editor stay in the editor", () => {
  it("dragging across the edit box to select words neither moves the text nor closes the editor", () => {
    const t = ed.scene.add({ kind: "text", x: 100, y: 100, w: 400, h: 40, cat: 6, fill: 0, text: "every correct process should agree" });
    ed.select([t.id]);
    expect(ed.editSelection()).toBe(true);
    const ta = stage.querySelector("textarea")!;
    expect(ta).not.toBeNull();
    on(ta, "pointerdown", 220, 120); on(ta, "pointermove", 300, 160); on(ta, "pointermove", 380, 200); on(ta, "pointerup", 380, 200);
    on(ta, "dblclick", 380, 200);
    expect([t.x, t.y]).toEqual([100, 100]);
    expect(stage.querySelector("textarea")).toBe(ta);
    expect(ed.editing).toBe(true);
  });
  it("the canvas around the editor still works: pressing outside commits as before", () => {
    const t = ed.scene.add({ kind: "text", x: 100, y: 100, w: 400, h: 40, cat: 6, fill: 0, text: "hello" });
    ed.select([t.id]); ed.editSelection();
    stage.setPointerCapture = () => {};
    const ta = stage.querySelector("textarea")!;
    ta.blur(); ta.dispatchEvent(new Event("blur"));
    on(stage, "pointerdown", 900, 700); on(stage, "pointerup", 900, 700);
    expect(stage.querySelector("textarea")).toBeNull();
  });
});
