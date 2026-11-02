// @vitest-environment jsdom
// Connector labels may have several lines (Shift+Enter in the editor); Enter still commits.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { labelBlock } from "./connectors";
import { createEditor, type Editor } from "./editor";
import { fromExcalidraw, toExcalidraw } from "./io/excalidraw";
import { buildSvg } from "./io/svg";
import { drawArrow } from "./renderer";
import { LIGHT } from "./theme";
import type { El } from "./scene";

const fakeCtx = new Proxy({}, { get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined), set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; } });
let stage: HTMLDivElement, ed: Editor;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div"); stage.setPointerCapture = () => {}; stage.releasePointerCapture = () => {};
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT }); ed.renderer.resize(1400, 900, 1);
});
afterEach(() => { ed.destroy(); stage.remove(); });
const key = (k: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
const ta = () => document.querySelector("textarea") as HTMLTextAreaElement | null;
const arrow = (extra: Partial<El> = {}) => ed.scene.add({ kind: "arrow", x: 0, y: 0, w: 200, h: 0, pts: [0, 0, 200, 0], ...extra });
function rec() {
  const log: string[] = [];
  const ctx = new Proxy({ font: "13px x" } as Record<string, unknown>, { get: (t, k: string) => (k === "measureText" ? (s: string) => ({ width: s.length * 6 }) : k in t ? t[k] : (...a: unknown[]) => { log.push(`${k}(${a.map((v) => (typeof v === "number" ? Math.round(v * 10) / 10 : String(v))).join(",")})`); }), set: (t, k: string, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

describe("multi-line connector labels", () => {
  it("Shift+Enter inserts a newline (the editor stays open), Enter commits, the breaks are kept", () => {
    const a = arrow();
    ed.select([a.id]); key("Enter");
    const t = ta()!;
    t.value = "line one\nline two"; t.dispatchEvent(new Event("input"));
    const shift = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    t.dispatchEvent(shift);
    expect(shift.defaultPrevented).toBe(false); // the browser inserts the newline
    expect(ta()).toBe(t);
    t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(ta()).toBeNull();
    expect(ed.scene.els.get(a.id)!.labels).toEqual([{ t: 0.5, text: "line one\nline two" }]);
  });
  it("blank lines and stray spaces are tidied, a label of only blanks is removed, old single-line labels are unchanged", () => {
    const a = arrow({ labels: [{ t: 0.5, text: "plain  words" }] });
    ed.select([a.id]); key("Enter");
    const t = ta()!; t.value = "  a  b \n\n\n  c  \n"; t.dispatchEvent(new Event("input"));
    t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(a.labels).toEqual([{ t: 0.5, text: "a b\nc" }]);
    const b = arrow({ labels: [{ t: 0.5, text: "keep" }] });
    expect(b.labels).toEqual([{ t: 0.5, text: "keep" }]);
  });
  it("the block geometry covers every line (the plate, the hit box)", () => {
    expect(labelBlock("ab", 13, (s) => s.length * 6)).toEqual({ lines: ["ab"], w: 22, h: 20, pitch: 17 });
    const m = labelBlock("ab\nlonger one", 13, (s) => s.length * 6);
    expect(m.lines).toEqual(["ab", "longer one"]);
    expect(m.w).toBe(10 * 6 + 10);
    expect(m.h).toBe(20 + 17);
  });
  it("canvas: each line is drawn centred on the label point, one plate sized to all lines", () => {
    const a = arrow({ labels: [{ t: 0.5, text: "one\ntwo" }] });
    const r = rec(); drawArrow(r.ctx, a as never, LIGHT, 1, a.pts, false);
    const texts = r.log.filter((l) => l.startsWith("fillText"));
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe("fillText(one,100,-8.5)"); expect(texts[1]).toBe("fillText(two,100,8.5)");
    expect(r.log).toContain("fillRect(86,-18.5,28,37)"); // 3 chars = 18 + 10 wide, 20 + 17 tall
  });
  it("SVG keeps the breaks as lines", () => {
    const a = arrow({ labels: [{ t: 0.5, text: "one\ntwo" }] });
    const svg = buildSvg([ed.scene.snapshot(a)] as never, LIGHT, { padding: 8, background: false, icons: () => null });
    expect(svg).toContain(">one</tspan>"); expect(svg).toContain(">two</tspan>");
  });
  it("Excalidraw keeps the breaks, and they come back on import", () => {
    const a = arrow({ labels: [{ t: 0.5, text: "one\ntwo" }] });
    const ex = toExcalidraw({ els: [ed.scene.snapshot(a)], groups: [] } as never) as { elements: Array<{ type: string; text?: string }> };
    expect(ex.elements.find((e) => e.type === "text")!.text).toBe("one\ntwo");
    const back = fromExcalidraw(ex);
    expect(back.ok && back.scene.els.find((e) => e.kind === "arrow")!.labels).toEqual([{ t: 0.5, text: "one\ntwo" }]);
  });
});
