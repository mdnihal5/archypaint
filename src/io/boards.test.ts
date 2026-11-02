// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "../editor";
import type { HistState } from "../history";
import { LIGHT } from "../theme";
import { createBoards, migrateLegacy, recoverLegacy, STASH_STEPS, sweepTrash, type BoardsApi, type BoardsHost } from "./boards";
import { serializeArch } from "./format";
import { createIO, type IO } from "./index";
import { bkey, INDEX, memKV, type DocRec, type IndexRec, type KV } from "./storage";
import { el } from "./testkit";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});

interface Tab { ed: Editor; io: IO; stage: HTMLElement; bm: () => Promise<BoardsApi> }
const tabs: Tab[] = [];
function tab(kv: KV): Tab {
  const stage = document.createElement("div");
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  const ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  ed.renderer.resize(800, 600, 1);
  const io = createIO(ed, stage, { kv });
  const t = { ed, io, stage, bm: () => io.boards() };
  tabs.push(t);
  return t;
}
const add = (t: Tab, id: string) => t.ed.importElements({ els: [el({ id, x: Math.random() * 500, text: id })], groups: [] }, false);
const texts = (t: Tab) => [...t.ed.scene.els.values()].map((e) => e.text).sort();
const settle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const names = async (t: Tab) => (await (await t.bm()).list()).map((r) => r.name);

beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never; });
afterEach(() => { for (const t of tabs.splice(0)) { t.io.dispose(); t.ed.destroy(); t.stage.remove(); } vi.useRealTimers(); });

describe("boards: create, rename, duplicate, delete + undo", () => {
  it("create opens an empty board; the old one is kept; rename and duplicate work on any board", async () => {
    const kv = memKV(), t = tab(kv);
    await t.io.restore();
    t.io.setDocName("first"); add(t, "a1");
    const bm = await t.bm();
    const id2 = (await bm.create("second"))!;
    expect(t.io.boardId()).toBe(id2);
    expect(t.ed.scene.els.size).toBe(0);
    expect(t.io.docName()).toBe("second");
    expect(await names(t)).toEqual(["second", "first"]);

    const first = (await bm.list()).find((r) => r.name === "first")!;
    await bm.rename(first.id, "  renamed  ");
    expect(await names(t)).toEqual(["second", "renamed"]);

    const dup = (await bm.duplicate(first.id))!;
    expect(t.io.boardId()).toBe(id2); // duplicating does not switch
    expect(await names(t)).toContain("renamed copy");
    await bm.switchTo(dup);
    expect(texts(t)).toEqual(["a1"]); // the copy has the content
  });

  it("delete removes the row at once and undo puts the board (and its content) back", async () => {
    const kv = memKV(), t = tab(kv);
    await t.io.restore();
    add(t, "keep"); t.io.setDocName("one");
    const bm = await t.bm();
    await bm.create("two"); add(t, "x2");
    const one = (await bm.list()).find((r) => r.name === "one")!;
    const r = (await bm.remove(one.id))!;
    expect(await names(t)).toEqual(["two"]);
    expect(await r.undo()).toBe(true);
    expect(await names(t)).toEqual(["two", "one"]);
    await bm.switchTo(one.id);
    expect(texts(t)).toEqual(["keep"]);
  });

  it("deleting the open board opens another; deleting the last one leaves a fresh empty board", async () => {
    const kv = memKV(), t = tab(kv);
    await t.io.restore();
    t.io.setDocName("only"); add(t, "o");
    const bm = await t.bm();
    const r = (await bm.remove(t.io.boardId()))!;
    expect(t.ed.scene.els.size).toBe(0);
    expect(await names(t)).toEqual(["untitled"]);
    expect(await r.undo()).toBe(true); // came back, and is open again
    expect(t.io.docName()).toBe("only");
    expect(texts(t)).toEqual(["o"]);
  });

  it("after the undo window the records are really deleted, and an undo then fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const kv = memKV(), t = tab(kv);
    await t.io.restore();
    add(t, "a"); t.io.setDocName("gone");
    const bm = await t.bm();
    await bm.create("stay");
    const gone = (await bm.list()).find((r) => r.name === "gone")!;
    const r = (await bm.remove(gone.id))!;
    expect(kv.data.has(bkey(gone.id, "current"))).toBe(true); // still there: undoable
    await vi.advanceTimersByTimeAsync(7100);
    expect(kv.data.has(bkey(gone.id, "current"))).toBe(false);
    expect(kv.data.has(bkey(gone.id, "backup"))).toBe(false);
    expect(((kv.data.get(INDEX)) as IndexRec).trash).toEqual([]);
    expect(await r.undo()).toBe(false);
  });

  it("a deleted board left in the trash (tab closed) is swept at the next startup, but not while still young", async () => {
    const kv = memKV();
    kv.data.set(bkey("old", "current"), { key: bkey("old", "current"), text: "x", name: "old", savedAt: 1, fileDirty: false });
    kv.data.set(bkey("new", "current"), { key: bkey("new", "current"), text: "x", name: "new", savedAt: 1, fileDirty: false });
    const meta = { id: "old", name: "old", savedAt: 1 };
    kv.data.set(INDEX, { key: INDEX, active: "k", boards: [], trash: [{ id: "old", at: 0, meta }, { id: "new", at: 99_000, meta: { ...meta, id: "new" } }] } as IndexRec);
    expect(await sweepTrash(kv, 100_000)).toBe(1);
    expect(kv.data.has(bkey("old", "current"))).toBe(false);
    expect(kv.data.has(bkey("new", "current"))).toBe(true);
  });
});

describe("boards: switching keeps each board's scene and undo", () => {
  it("switching away and back restores the scene and Ctrl+Z still undoes that board's steps", async () => {
    const kv = memKV(), t = tab(kv);
    await t.io.restore();
    t.io.setDocName("A"); add(t, "a1"); add(t, "a2");
    const bm = await t.bm();
    const A = t.io.boardId();
    const B = (await bm.create("B"))!;
    add(t, "b1");
    expect(texts(t)).toEqual(["b1"]);
    await bm.switchTo(A);
    expect(texts(t)).toEqual(["a1", "a2"]);
    expect(t.ed.canUndo()).toBe(true);
    t.ed.undo();
    expect(texts(t)).toEqual(["a1"]); // A's own history, not B's
    t.ed.redo();
    await bm.switchTo(B);
    expect(texts(t)).toEqual(["b1"]);
    t.ed.undo();
    expect(texts(t)).toEqual([]);
    expect(t.ed.canUndo()).toBe(false);
  });

  it("keeps only the last 20 steps of a board that was left", async () => {
    const kv = memKV(), t = tab(kv);
    await t.io.restore();
    for (let i = 0; i < 30; i++) add(t, `s${i}`);
    const bm = await t.bm(), A = t.io.boardId();
    const B = (await bm.create("B"))!;
    await bm.switchTo(A);
    let n = 0;
    while (t.ed.canUndo()) { t.ed.undo(); n++; }
    expect(n).toBe(STASH_STEPS);
    expect(t.ed.scene.els.size).toBe(30 - STASH_STEPS);
    expect(B).toBeTruthy();
  });

  it("a stale stash is dropped when another tab changed the board meanwhile", async () => {
    const kv = memKV(), t1 = tab(kv), t2 = tab(kv);
    await t1.io.restore();
    add(t1, "a1"); add(t1, "a2");
    const bm = await t1.bm(), A = t1.io.boardId();
    await bm.create("B");
    await t2.io.restore(); // t2 opens the active board (B); switch it to A and edit
    await (await t2.bm()).switchTo(A);
    add(t2, "from-t2"); await t2.io.boards().then((b) => b.list()); // list() flushes
    await bm.switchTo(A);
    expect(texts(t1)).toEqual(["a1", "a2", "from-t2"]);
    expect(t1.ed.canUndo()).toBe(false); // history of the old scene must not be applied to the new one
  });
});

describe("boards: storage layout and migration", () => {
  const doc = (name: string, text: string, savedAt: number): DocRec => ({ key: "current", text, name, savedAt, fileDirty: false });
  const file = (label: string) => serializeArch({ meta: { name: label, created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: { els: [el({ id: "m1", text: label })], groups: [] } });

  it("copies current, backup, view and handle into board b0 in one step and leaves the old keys as a read-only snapshot", async () => {
    const kv = memKV();
    const cur = doc("Legacy", "CUR", 5), bak = { ...doc("Legacy", "BAK", 4), key: "backup" as const };
    kv.data.set("current", cur); kv.data.set("backup", bak);
    kv.data.set("view", { key: "view", x: 3, y: 4, zoom: 2 }); kv.data.set("handle", { key: "handle", handle: { name: "f" } });
    const ix = (await migrateLegacy(kv))!;
    expect(ix.boards).toEqual([{ id: "b0", name: "Legacy", savedAt: 5 }]);
    expect(ix.active).toBe("b0");
    expect(kv.data.get(bkey("b0", "current"))).toMatchObject({ text: "CUR", key: "b:b0:current" });
    expect(kv.data.get(bkey("b0", "backup"))).toMatchObject({ text: "BAK", key: "b:b0:backup" });
    expect(kv.data.get(bkey("b0", "view"))).toMatchObject({ x: 3, y: 4, zoom: 2 });
    expect(kv.data.get(bkey("b0", "handle"))).toMatchObject({ handle: { name: "f" } });
    for (const k of ["current", "backup", "view", "handle"]) expect(kv.data.has(k)).toBe(true); // an old cached build or stale tab still finds its sheet
    expect(ix.legacy).toEqual({ at: 5 });
    expect(await migrateLegacy(kv)).toEqual(ix); // idempotent: a second tab does nothing
  });

  it("migrates a store that only has a backup (the current was never written or was lost)", async () => {
    const kv = memKV();
    kv.data.set("backup", { ...doc("Only backup", "BAK", 7), key: "backup" });
    const ix = (await migrateLegacy(kv))!;
    expect(ix.boards[0]).toMatchObject({ id: "b0", name: "Only backup" });
    expect(kv.data.get(bkey("b0", "backup"))).toMatchObject({ text: "BAK" });
    expect(kv.data.has(bkey("b0", "current"))).toBe(false);
    expect(kv.data.has("backup")).toBe(true);
  });

  it("nothing to migrate: no index is invented", async () => {
    expect(await migrateLegacy(memKV())).toBeUndefined();
  });

  it("restore() on an old store opens the migrated sheet with its content and name; backup-only restores from the backup", async () => {
    const kv = memKV();
    kv.data.set("current", doc("Old sheet", file("old content"), 5));
    kv.data.set("view", { key: "view", x: 10, y: 20, zoom: 1 });
    const t = tab(kv);
    expect(await t.io.restore()).toBe(true);
    expect(t.io.docName()).toBe("Old sheet");
    expect(texts(t)).toEqual(["old content"]);
    expect(t.io.boardId()).toBe("b0");

    const kv2 = memKV();
    kv2.data.set("backup", { ...doc("Rescued", file("from backup"), 5), key: "backup" });
    const t2 = tab(kv2);
    expect(await t2.io.restore()).toBe(true);
    expect(texts(t2)).toEqual(["from backup"]);
    expect(t2.io.docName()).toBe("Rescued");
  });

  it("an old build writing the legacy keys after the migration is recovered as a new board, once", async () => {
    const kv = memKV();
    kv.data.set("current", doc("Old sheet", file("old content"), 5));
    const t1 = tab(kv);
    await t1.io.restore(); // migrates to b0
    const msgs: string[] = [];
    t1.io.onMessage((m) => msgs.push(m.text));
    expect(await names(t1)).toEqual(["Old sheet"]);
    // a stale tab / cached old build keeps saving into the legacy layout
    kv.data.set("current", doc("Old sheet", file("edited by old build"), 99));
    const t2 = tab(kv);
    const msgs2: string[] = [];
    t2.io.onMessage((m) => msgs2.push(m.text));
    await t2.io.restore();
    await settle(50);
    expect(t2.io.docName()).toBe("Old sheet"); // the migrated board stays the open one
    expect((await names(t2)).sort()).toEqual(["Old sheet", "Old sheet (recovered)"]);
    expect(msgs2.filter((m) => m.includes("recovered"))).toHaveLength(1);
    const rec = (await (await t2.bm()).list()).find((r) => r.name === "Old sheet (recovered)")!;
    await (await t2.bm()).switchTo(rec.id);
    expect(texts(t2)).toEqual(["edited by old build"]);
    // the same legacy write is never imported twice
    const t3 = tab(kv);
    await t3.io.restore();
    await settle(50);
    expect((await names(t3)).filter((n) => n.includes("recovered"))).toHaveLength(1);
    expect(await recoverLegacy(kv)).toBeUndefined();
    // a LATER write by the old build is a new recovery
    kv.data.set("current", doc("Old sheet", file("again"), 120));
    expect(await recoverLegacy(kv)).toMatchObject({ name: "Old sheet (recovered)" });
  });

  it("persistence round trip: boards, names, content and the open board survive a restart", async () => {
    const kv = memKV(), t = tab(kv);
    await t.io.restore();
    t.io.setDocName("alpha"); add(t, "a");
    const bm = await t.bm();
    await bm.create("beta"); add(t, "b");
    await bm.create("gamma"); add(t, "c");
    await bm.switchTo((await bm.list()).find((r) => r.name === "beta")!.id);
    await (await t.bm()).list(); // flushes
    const t2 = tab(kv);
    expect(await t2.io.restore()).toBe(true);
    expect(t2.io.docName()).toBe("beta");
    expect(texts(t2)).toEqual(["b"]);
    expect((await names(t2)).sort()).toEqual(["alpha", "beta", "gamma"]);
    await (await t2.bm()).switchTo((await (await t2.bm()).list()).find((r) => r.name === "gamma")!.id);
    expect(texts(t2)).toEqual(["c"]);
  });

  it("file Open goes into a NEW board named after the file and never overwrites the open one", async () => {
    const kv = memKV(), t = tab(kv);
    await t.io.restore();
    t.io.setDocName("mine"); add(t, "keepme");
    const text = file("from file");
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = async () => [{ name: "shared-design.archypaint", getFile: async () => new File([text], "shared-design.archypaint"), createWritable: async () => ({}) }];
    await t.io.open();
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    expect(t.io.docName()).toBe("shared-design");
    expect(texts(t)).toEqual(["from file"]);
    const mine = (await (await t.bm()).list()).find((r) => r.name === "mine")!;
    await (await t.bm()).switchTo(mine.id);
    expect(texts(t)).toEqual(["keepme"]);
  });
});

describe("boards: two tabs", () => {
  it("a write by a tab that missed another tab's newer write is saved as a copy, never over it", async () => {
    const kv = memKV(), t1 = tab(kv), t2 = tab(kv);
    await t1.io.restore(); t1.io.setDocName("shared"); add(t1, "t1-a");
    await (await t1.bm()).list(); // saved
    await t2.io.restore();
    expect(texts(t2)).toEqual(["t1-a"]);
    add(t1, "t1-b"); await (await t1.bm()).list(); // t1 writes again: t2's view is now behind
    add(t2, "t2-x");
    await (await t2.bm()).list(); // t2 writes: conflict
    const board = t1.io.boardId();
    expect(t2.io.boardId()).not.toBe(board);
    expect(t2.io.docName()).toBe("shared (copy)");
    expect(String((kv.data.get(bkey(board, "current")) as DocRec).text)).toContain("t1-b");
    expect(String((kv.data.get(bkey(board, "current")) as DocRec).text)).not.toContain("t2-x"); // t1's board is untouched
    expect(String((kv.data.get(bkey(t2.io.boardId(), "current")) as DocRec).text)).toContain("t2-x");
    expect((await names(t1)).sort()).toEqual(["shared", "shared (copy)"]);
  });

  it("a board deleted and purged by another tab is not silently recreated: the editing tab saves its work as a copy", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const kv = memKV(), t1 = tab(kv), t2 = tab(kv);
    await t1.io.restore(); t1.io.setDocName("doomed"); add(t1, "a");
    await (await t1.bm()).list();
    await t2.io.restore();
    expect(t2.io.docName()).toBe("doomed");
    const doomed = t1.io.boardId();
    await (await t1.bm()).remove(doomed);
    await vi.advanceTimersByTimeAsync(7100); // purged
    expect(kv.data.has(bkey(doomed, "current"))).toBe(false);
    add(t2, "t2-work");
    await (await t2.bm()).list();
    expect(t2.io.boardId()).not.toBe(doomed);
    expect(String((kv.data.get(bkey(t2.io.boardId(), "current")) as DocRec).text)).toContain("t2-work");
  });

  it("the same tab writing again (autosave, then the unload flush) is never a conflict", async () => {
    const kv = memKV(), t = tab(kv);
    await t.io.restore(); add(t, "a");
    const id = t.io.boardId();
    await (await t.bm()).list();
    add(t, "b"); await (await t.bm()).list();
    add(t, "c"); await (await t.bm()).list();
    expect(t.io.boardId()).toBe(id);
    expect((kv.data.get(INDEX) as IndexRec).boards).toHaveLength(1);
  });
});

describe("boards: memory stays bounded", () => {
  it("the stash of boards that are not open is bounded by a global snapshot budget, oldest board first", async () => {
    const hist = (w: number): HistState => ({ undo: [{ label: "x", key: "", t: 0, ch: [], gch: [] }], redo: [], weight: w });
    let open = "b0", w = 40;
    const kv = memKV();
    const index: IndexRec = { key: INDEX, active: "b0", boards: Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, name: `n${i}`, savedAt: i })) };
    kv.data.set(INDEX, index);
    const host: BoardsHost = {
      kv, id: () => open, name: () => open, flush: async () => true, stamp: () => null, loadRecords: async () => ({}),
      takeHistory: () => hist(w), activate: (id) => { open = id; return true; }, setName() {}, clean: (n) => n, say() {},
    };
    const api = createBoards(host, { stashBudget: 100 });
    for (let i = 1; i < 30; i++) await api.switchTo(`b${i}`);
    const s = api.stashed();
    expect(s.snapshots).toBeLessThanOrEqual(100);
    expect(s.boards).toBeLessThanOrEqual(2); // 40 each, budget 100
    api.dispose();
    expect(api.stashed()).toEqual({ boards: 0, snapshots: 0 });
  });
});
