// @vitest-environment jsdom
// A commit of a markdown text while the lazy chunk is still unloaded (own file: the chunk stays loaded once it arrives).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { mdLib } from "./md-hook";
import { LIGHT } from "./theme";

const fakeCtx = new Proxy({}, { get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? (s: string) => ({ width: s.length * 7 }) : k in t ? t[k] : () => undefined), set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; } });
let stage: HTMLDivElement, ed: Editor;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div");
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT }); ed.renderer.resize(1400, 900, 1);
});
afterEach(() => { ed.destroy(); stage.remove(); });

async function edit(id: string, value: string): Promise<void> {
  ed.select([id]); ed.editSelection();
  const ta = stage.querySelector("textarea")!;
  ta.value = value; ta.dispatchEvent(new Event("input")); ta.dispatchEvent(new Event("blur"));
  await new Promise((r) => setTimeout(r, 50));
}

describe("committing markdown text before the chunk exists", () => {
  it("chunk not loaded yet: the commit waits for it, sizes from the layout, and is ONE undo step", async () => {
    expect(mdLib()).toBeNull();
    const t = ed.scene.add({ kind: "text", x: 100, y: 100, w: 60, h: 28, text: "old", md: 1 });
    await edit(t.id, "# Title\n- one\n- two");
    expect(mdLib()).not.toBeNull();
    const want = mdLib()!.size("# Title\n- one\n- two", 13);
    expect(t.text).toBe("# Title\n- one\n- two");
    expect([t.w, t.h]).toEqual([want.w, want.h]);
    ed.undo();
    expect(t.text).toBe("old"); expect([t.w, t.h]).toEqual([60, 28]); // a single undo restores text and size together
  });
});
