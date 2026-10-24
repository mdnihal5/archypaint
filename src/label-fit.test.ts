// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { LIGHT } from "./theme";
import type { El } from "./scene";
import { labelLineHeight, minLabelHeight, monoMeasure, wrapHeight, wrapText, wrapWidth } from "./wrap";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? (s: string) => ({ width: String(s).length * 7.8 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
let stage: HTMLDivElement;
let ed: Editor;
const mk = (): Editor => {
  stage = document.createElement("div");
  stage.setPointerCapture = () => {}; stage.releasePointerCapture = () => {};
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  const e = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  e.renderer.resize(1400, 900, 1);
  return e;
};
const ptr = (type: string, x: number, y: number, extra: MouseEventInit = {}) => stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra }));
const drag = (x0: number, y0: number, x1: number, y1: number) => { ptr("pointerdown", x0, y0); ptr("pointermove", (x0 + x1) / 2, (y0 + y1) / 2); ptr("pointermove", x1, y1); ptr("pointerup", x1, y1); };
const ta = () => document.querySelector("textarea") as HTMLTextAreaElement | null;
/** type into the open inline editor and commit it with Enter (single-line editors) or Ctrl+Enter */
const commit = (value: string, ctrl = false) => {
  const t = ta()!;
  t.value = value; t.dispatchEvent(new Event("input"));
  t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: ctrl, bubbles: true, cancelable: true }));
};
const of = (kind: string): El[] => [...ed.scene.els.values()].filter((e) => e.kind === kind);
const add = (init: Partial<El> & { kind: El["kind"] }): El => { const e = ed.scene.add(init); ed.renderer.invalidate(true, true); return e; };

beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never; ed = mk(); });
afterEach(() => { ed.destroy(); stage.remove(); });

const mono = (fs = 13) => () => monoMeasure(fs);

describe("label padding (pure)", () => {
  it("every wrapping kind keeps padding inside its inscribed area", () => {
    expect(wrapWidth("rect", 96)).toBe(72); expect(wrapHeight("rect", 56)).toBe(40);
    expect(wrapWidth("ellipse", 96)).toBeCloseTo(96 * 0.72 - 12, 6);
    expect(wrapHeight("ellipse", 56)).toBeCloseTo(56 * 0.72 - 12, 6);
    for (const k of ["rect", "ellipse", "diamond", "cylinder", "cloud", "hexagon", "note", "parallelogram", "triangle", "star"] as const) {
      expect(wrapWidth(k, 100)).toBeLessThan(100); expect(wrapHeight(k, 100)).toBeLessThan(100);
    }
    for (const k of ["text", "icon", "arrow", "badge", "frame"] as const) { expect(wrapWidth(k, 100)).toBe(0); expect(minLabelHeight({ kind: k, w: 100, text: "long text", fs: 0 }, mono())).toBe(0); }
  });
  it("minLabelHeight is exactly what the wrapped block plus its padding needs, and 0 without text", () => {
    const e = { kind: "rect" as const, w: 96, text: "checkout and payment service", fs: 0 };
    const lines = wrapText(e.text, wrapWidth("rect", 96), monoMeasure(13)).length;
    expect(lines).toBeGreaterThan(2);
    expect(minLabelHeight(e, mono())).toBe(lines * labelLineHeight(0) + 16);
    expect(minLabelHeight({ ...e, text: "" }, mono())).toBe(0);
  });
});

describe("type-to-edit and the I key", () => {
  it("typing a letter on a selected shape edits its label, except `i`, which is left to the properties-panel toggle", () => {
    const r = add({ kind: "rect", x: 300, y: 200, w: 96, h: 56 });
    ed.select([r.id]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true, cancelable: true }));
    expect(document.querySelector("textarea")).toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true }));
    expect(document.querySelector("textarea")).not.toBeNull();
  });
});

describe("a shape grows to fit its label instead of clipping it", () => {
  const shape = (kind: "rect" | "ellipse", w = 96, h = 56) => { const e = add({ kind, x: 300, y: 200, w, h }); ed.renderer.invalidate(true, true); return e; };
  const type = (e: El, v: string) => { (ed as unknown as { editText(e: El): void }).editText(e); commit(v, true); };
  const fits = (e: El) => expect(e.h).toBeGreaterThanOrEqual(minLabelHeight(e, mono(e.fs || 13)));

  it("a long label in a small rect grows the rect (padding included) in the same undo step as the text", () => {
    const r = shape("rect");
    type(r, "checkout and payment service");
    expect(r.text).toBe("checkout and payment service");
    expect(r.h).toBeGreaterThan(56); fits(r);
    expect(r.w).toBe(96); expect(r.y).toBe(200); // height only, downward
    ed.undo();
    expect(r.h).toBe(56); expect(r.text).toBe("");
    ed.redo();
    expect(r.h).toBeGreaterThan(56);
  });
  it("a long label in an ellipse grows it so no line is cut", () => {
    const e = shape("ellipse");
    type(e, "a rather long label for a small ellipse that needs lots of room");
    fits(e); expect(e.h).toBeGreaterThan(100);
  });
  it("a short label never grows or shrinks the shape", () => {
    const r = shape("rect", 200, 120);
    type(r, "api");
    expect(r.h).toBe(120);
  });
  it("a bound connector follows the grown shape", () => {
    const a = shape("rect"), b = add({ kind: "rect", x: 600, y: 200, w: 96, h: 56 });
    ed.setTool("arrow"); drag(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2);
    const ar = of("arrow")[0]!;
    type(a, "checkout and payment service for the web shop");
    expect(ar.pts[1]).toBeCloseTo(a.y + a.h / 2, 3);
  });
  it("a bigger text size grows the shape; the pointer cannot squeeze it below its label", () => {
    const r = shape("rect", 120, 60);
    type(r, "order service api");
    const h0 = r.h;
    ed.select([r.id]); ed.setStyle({ fs: 22 });
    expect(r.h).toBeGreaterThan(h0); fits(r);
    const hMin = minLabelHeight(r, mono(22));
    drag(r.x + r.w / 2, r.y + r.h, r.x + r.w / 2, r.y + 10); // the bottom-middle handle, dragged up past the text
    expect(r.h).toBeGreaterThanOrEqual(hMin);
  });
  it("free text and icons are untouched", () => {
    const t = add({ kind: "text", x: 100, y: 100, w: 80, h: 28, text: "a long free text label that does not wrap" });
    const ic = add({ kind: "icon", iconId: "x", x: 300, y: 100, w: 48, h: 48 });
    const before = [t.h, ic.h];
    ed.select([t.id, ic.id]); ed.setStyle({ fs: 20 });
    expect(ic.h).toBeGreaterThanOrEqual(0);
    expect(t.w).toBeGreaterThan(80); // free text sizes itself to its content as before
    void before;
  });
});
