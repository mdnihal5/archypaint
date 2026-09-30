// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorAPI } from "../editor-api";
import { Scene } from "../scene";
import { Viewport } from "../viewport";
import { createIO } from "./index";
import { memKV } from "./storage";

function fakeEditor() {
  const scene = new Scene();
  let saved = scene.nonce;
  const ed = {
    scene, vp: new Viewport(),
    dirty: () => scene.nonce !== saved,
    markSaved: vi.fn(() => { saved = scene.nonce; }),
    on: () => () => {},
    load: vi.fn(), resetView: vi.fn(), zoomToFit: vi.fn(), zoomBy: vi.fn(),
  };
  return ed as unknown as EditorAPI & { markSaved: ReturnType<typeof vi.fn> };
}

type W = Window & { showSaveFilePicker?: unknown };
afterEach(() => { delete (window as W).showSaveFilePicker; });

describe("createIO save", () => {
  it("edits made while the save is in flight stay unsaved (the discard prompt must still protect them)", async () => {
    const ed = fakeEditor();
    ed.scene.add({ kind: "rect" });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    (window as W).showSaveFilePicker = async () => ({
      name: "doc.archypaint", getFile: async () => new File([], "doc.archypaint"),
      createWritable: async () => { await gate; return { write: async () => {}, close: async () => {} }; },
    });
    const io = createIO(ed, document.createElement("div"), { kv: memKV() });
    const saving = io.save();
    await new Promise((r) => setTimeout(r, 0));
    ed.scene.add({ kind: "ellipse" }); // user keeps drawing while the picker / write is pending
    release();
    await saving;
    expect(ed.markSaved).not.toHaveBeenCalled();
    expect(ed.dirty()).toBe(true);
    io.dispose();
  });

  it("a save with no concurrent edit marks the document saved", async () => {
    const ed = fakeEditor();
    ed.scene.add({ kind: "rect" });
    (window as W).showSaveFilePicker = async () => ({
      name: "doc.archypaint", getFile: async () => new File([], "doc.archypaint"),
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
    const io = createIO(ed, document.createElement("div"), { kv: memKV() });
    await io.save();
    expect(ed.markSaved).toHaveBeenCalledOnce();
    expect(ed.dirty()).toBe(false);
    io.dispose();
  });
});

describe("adoptCurrent (make an editable copy of a shared link)", () => {
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("a document opened WITHOUT restore() is never autosaved, however it changes", async () => {
    const ed = fakeEditor(); const kv = memKV();
    const io = createIO(ed, document.createElement("div"), { kv });
    ed.scene.add({ kind: "rect" }); // the shared document "loaded"
    io.setDocName("shared name");
    io.updateSettings({ bg: "plain" });
    await settle(900); // past the autosave debounce
    window.dispatchEvent(new Event("pagehide"));
    await settle(20);
    expect(kv.data.size).toBe(0); // nothing written: the user's own autosaved sheet is safe
    io.dispose();
  });

  it("adoptCurrent() makes it the autosaved document without loading the stored one", async () => {
    const ed = fakeEditor(); const kv = memKV();
    kv.data.set("current", { key: "current", text: "{}", name: "mine", savedAt: 1, fileDirty: false });
    const io = createIO(ed, document.createElement("div"), { kv });
    ed.scene.add({ kind: "rect", text: "shared" });
    ed.markSaved(); // as openSharedFromHash does after loading: the shared document is "clean", so nothing would be written without adoptCurrent
    io.adoptCurrent();
    await settle(900);
    const rec = kv.data.get("current") as { text: string } | undefined;
    expect(rec).toBeDefined();
    expect(rec!.text).toContain('"text":"shared"'); // the copy replaced the previous autosave, on purpose
    expect((ed.load as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0); // and nothing was loaded over the copy
    io.dispose();
  });
});
