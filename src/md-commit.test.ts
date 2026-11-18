// @vitest-environment jsdom
// Committing an edit of a markdown text sizes the box from the rendered layout; if the lazy chunk is not loaded yet, the commit waits for it
// so the resize still lands in the SAME history entry (one undo step), never as a second one.
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

describe("committing markdown text", () => {
  it("toggling markdown before the chunk is loaded still lands on the right element and is one undo step", async () => {
    expect(mdLib()).toBeNull();
    const t = ed.scene.add({ kind: "text", x: 100, y: 100, w: 60, h: 28, text: "# a\n- b" });
    ed.select([t.id]); ed.setStyle({ md: 1 }); ed.clearSelection(); // the user clicks away while the chunk loads
    await new Promise((r) => setTimeout(r, 50));
    const want = mdLib()!.size("# a\n- b", 13);
    expect(t.md).toBe(1); expect([t.w, t.h]).toEqual([want.w, want.h]);
    ed.undo(); expect(t.md).toBeUndefined(); expect([t.w, t.h]).toEqual([60, 28]);
  });
  it("chunk loaded: the commit is synchronous and sized from the layout", async () => {
    const t = ed.scene.add({ kind: "text", x: 100, y: 100, w: 60, h: 28, text: "old", md: 1 });
    await edit(t.id, "## A\nplain");
    const want = mdLib()!.size("## A\nplain", 13);
    expect([t.w, t.h]).toEqual([want.w, want.h]);
  });
  it("a plain text is still measured as plain", async () => {
    const t = ed.scene.add({ kind: "text", x: 100, y: 100, w: 60, h: 28, text: "old" });
    await edit(t.id, "# not md");
    expect(t.w).toBe(Math.ceil("# not md".length * 7) + 16);
  });
});
