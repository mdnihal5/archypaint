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

  it("adoptCurrent() saves the copy as a board of its own and keeps the stored sheet (migrated) without loading it", async () => {
    const ed = fakeEditor(); const kv = memKV();
    kv.data.set("current", { key: "current", text: "{}", name: "mine", savedAt: 1, fileDirty: false }); // the old single-document layout
    const io = createIO(ed, document.createElement("div"), { kv });
    ed.scene.add({ kind: "rect", text: "shared" });
    ed.markSaved(); // as openSharedFromHash does after loading: the shared document is "clean", so nothing would be written without adoptCurrent
    io.adoptCurrent();
    await settle(900);
    const copies = [...kv.data.values()].filter((r) => r.key.endsWith(":current") && r.key !== "b:b0:current") as Array<{ text: string }>;
    expect(copies).toHaveLength(1);
    expect(copies[0]!.text).toContain('"text":"shared"');
    expect((kv.data.get("b:b0:current") as { name: string }).name).toBe("mine"); // the user's own sheet survived, under board b0
    expect((kv.data.get("current") as { name: string }).name).toBe("mine"); // the old keys stay as a read-only snapshot
    expect((ed.load as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0); // and nothing was loaded over the copy
    io.dispose();
  });
});

describe("createIO newDoc (File > New)", () => {
  it("opens a NEW empty board without asking: nothing is destroyed, the old board stays in the list", async () => {
    const ed = fakeEditor() as unknown as EditorAPI & { load: ReturnType<typeof vi.fn> };
    (ed as unknown as { takeHistory: () => unknown }).takeHistory = () => ({ undo: [], redo: [], weight: 0 });
    const subs: Array<() => void> = [];
    (ed as unknown as { on: (ev: string, f: () => void) => () => void }).on = (ev, f) => { if (ev === "change") subs.push(f); return () => {}; };
    const confirm = vi.fn(() => false), opts = { kv: memKV() };
    const prev = window.confirm; window.confirm = confirm;
    const io = createIO(ed, document.createElement("div"), opts);
    await io.restore(); // arms autosave, as at startup
    const first = io.boardId();
    ed.scene.add({ kind: "rect" }); // unsaved edit: the old behaviour would have prompted
    for (const f of subs) f(); // the edit reaches autosave, as a real change event does
    io.newDoc();
    await vi.waitFor(() => expect(io.boardId()).not.toBe(first));
    expect(confirm).not.toHaveBeenCalled();
    expect(ed.load).toHaveBeenCalledWith({ els: [], groups: [] }, undefined);
    const rows = await (await io.boards()).list();
    expect(rows.map((r) => r.id)).toContain(first);
    expect(rows.length).toBe(2);
    window.confirm = prev;
    io.dispose();
  });
});
