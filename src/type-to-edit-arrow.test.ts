// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { LIGHT } from "./theme";
import type { El } from "./scene";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
let stage: HTMLDivElement;
let ed: Editor;
const key = (k: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
const ta = () => document.querySelector("textarea") as HTMLTextAreaElement | null;
const add = (init: Partial<El> & { kind: El["kind"] }): El => ed.scene.add(init);
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div");
  stage.setPointerCapture = () => {}; stage.releasePointerCapture = () => {};
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  ed.renderer.resize(1400, 900, 1);
});
afterEach(() => { ed.destroy(); stage.remove(); });

const arrow = (p: Partial<El> = {}) => add({ kind: "arrow", x: 100, y: 100, w: 200, h: 0, pts: [100, 100, 200, 100, 200, 100, 300, 100], route: 0, fill: 0, ...p });

describe("typing a printable key with one connector selected starts a label", () => {
  it("opens the editor with the typed character (caret at the end), like a shape", () => {
    const a = arrow(); ed.select([a.id]);
    key("h");
    expect(ta()).not.toBeNull(); expect(ta()!.value).toBe("h");
    expect(ta()!.selectionStart).toBe(1);
  });
  it("commits as the connector's label", () => {
    const a = arrow(); ed.select([a.id]);
    key("h"); ta()!.value = "http"; ta()!.dispatchEvent(new Event("input"));
    ta()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(a.labels?.map((l) => l.text)).toEqual(["http"]);
  });
  it("with an existing label it appends to the first label", () => {
    const a = arrow({ labels: [{ t: 0.3, text: "grpc" }] }); ed.select([a.id]);
    key("s"); expect(ta()!.value).toBe("grpcs");
  });
  it("Enter still works, and the typed key does not also fire a tool shortcut (r would pick the rectangle tool)", () => {
    const a = arrow(); ed.select([a.id]);
    key("r"); expect(ta()).not.toBeNull(); expect(ed.tool).toBe("select");
    ta()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(ta()).toBeNull();
    key("Enter"); expect(ta()).not.toBeNull();
  });
  it("is refused for a locked connector, several selected things, and with Ctrl / Alt held", () => {
    const a = arrow({ locked: true }); ed.select([a.id]); key("h"); expect(ta()).toBeNull();
    const b = arrow(), c = add({ kind: "rect", x: 0, y: 300 });
    ed.select([b.id, c.id]); key("h"); expect(ta()).toBeNull();
    ed.select([b.id]); key("h", { ctrlKey: true }); key("h", { altKey: true }); expect(ta()).toBeNull();
  });
});
