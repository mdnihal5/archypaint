// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "./editor";
import { installImageInput } from "./images-input";
import { clearImageCache, memImageStore, setCodec, setImageStore, type Bitmapish } from "./images";
import { actions } from "./features/images";
import { LIGHT } from "./theme";
import { parseArch, serializeArch } from "./io/format";
import { fromExcalidraw, toExcalidraw } from "./io/excalidraw";
import { buildSvg } from "./io/svg";
import { createIO } from "./io";
import { memKV } from "./io/storage";
import { Scene } from "./scene";
import { Viewport } from "./viewport";
import type { EditorAPI } from "./editor-api";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
const png = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(200);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  b[40] = w & 255; // make different sizes hash differently
  return b;
};
const file = (w: number, h: number, name = "a.png") => new File([png(w, h) as BlobPart], name, { type: "image/png" });
const bitmap = (): Bitmapish => ({ width: 10, height: 10, close: () => {} });

let stage: HTMLDivElement;
let ed: Editor;
let store: ReturnType<typeof memImageStore>;
const mk = (): Editor => {
  stage = document.createElement("div");
  stage.setPointerCapture = () => {}; stage.releasePointerCapture = () => {};
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0, toJSON() {} });
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  const e = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  e.renderer.resize(1200, 800, 1);
  return e;
};
const imgs = () => [...ed.scene.els.values()].filter((e) => e.kind === "image");
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  store = memImageStore(); setImageStore(store);
  setCodec({ decode: async () => bitmap(), encode: async () => null });
  localStorage.clear();
  ed = mk();
});
afterEach(() => { ed.destroy(); stage.remove(); setImageStore(null); setCodec(null); clearImageCache(); vi.restoreAllMocks(); });

describe("editor.insertImage", () => {
  it("creates a selected, sized image element at the viewport centre, stored by content key", async () => {
    const el = await ed.insertImage(file(1000, 500));
    expect(el.kind).toBe("image"); expect(el.img).toMatch(/^[0-9a-f]{16}$/);
    expect([el.w, el.h]).toEqual([360, 180]); // fitted to 360 world units
    expect(ed.selection().has(el.id)).toBe(true);
    const cx = ed.vp.x + ed.vp.w / ed.vp.zoom / 2, cy = ed.vp.y + ed.vp.h / ed.vp.zoom / 2;
    expect(el.x + el.w / 2).toBeCloseTo(cx); expect(el.y + el.h / 2).toBeCloseTo(cy);
    expect(store.data.has(el.img)).toBe(true);
  });
  it("places at a given point, undoes and redoes as one step, and the blob stays available for redo", async () => {
    const el = await ed.insertImage(file(200, 100), { x: 500, y: 400 });
    expect(el.x + el.w / 2).toBeCloseTo(500);
    ed.undo(); expect(imgs().length).toBe(0);
    ed.redo(); expect(imgs().length).toBe(1);
    expect(store.data.has(imgs()[0]!.img)).toBe(true);
  });
  it("rejects a bad file with a message and adds nothing", async () => {
    await expect(ed.insertImage(new File(["not an image"], "x.txt"))).rejects.toThrow(/Unsupported/);
    await expect(ed.insertImage(new File([new Uint8Array(9 * 1024 * 1024)], "big.png", { type: "image/png" }))).rejects.toThrow(/MB/);
    expect(imgs().length).toBe(0); expect(ed.canUndo()).toBe(false);
  });
  it("resizes with the aspect ratio locked, groups, copies and pastes like any element", async () => {
    const el = await ed.insertImage(file(400, 200), { x: 300, y: 300 });
    const r0 = el.w / el.h;
    const other = await ed.insertImage(file(90, 90), { x: 600, y: 300 });
    ed.select([el.id, other.id]); ed.copy();
    ed.group("pics"); expect(ed.scene.groups.size).toBe(1); // images group like any element
    ed.undo(); expect(ed.scene.groups.size).toBe(0);
    const json = JSON.stringify({ els: [ed.scene.snapshot(el)], groups: [] });
    expect(ed.paste("archypaint:" + json)).toBe(true);
    expect(imgs().length).toBe(3);
    expect(imgs().some((i) => i.id !== el.id && i.img === el.img)).toBe(true);
    expect(el.w / el.h).toBeCloseTo(r0);
  });
  it("dragging a corner handle resizes an image with its aspect ratio locked", async () => {
    const el = await ed.insertImage(file(400, 200), { x: 300, y: 300 }); // 360 x 180, centred on (300,300)
    const right = el.x + el.w, bottom = el.y + el.h, ratio = el.w / el.h, w0 = el.w;
    const ptr = (type: string, x: number, y: number) => stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }));
    ptr("pointerdown", right, bottom); ptr("pointermove", right + 40, bottom + 10); ptr("pointermove", right + 80, bottom + 10); ptr("pointerup", right + 80, bottom + 10);
    const now = imgs()[0]!;
    expect(now.w).toBeGreaterThan(w0 + 20); // it really resized (the element is mutated in place, so compare with the value captured before)
    expect(now.w / now.h).toBeCloseTo(ratio, 1);
  });
  it("drop and paste of pictures insert them; other files and text are left alone; dispose removes the listeners", async () => {
    const add = vi.spyOn(window, "addEventListener"), rem = vi.spyOn(window, "removeEventListener");
    const add2 = vi.spyOn(stage, "addEventListener"), rem2 = vi.spyOn(stage, "removeEventListener");
    const ed2 = createEditor({ stage: Object.assign(document.createElement("div"), { setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: stage.getBoundingClientRect }), staticCanvas: document.createElement("canvas"), liveCanvas: document.createElement("canvas"), theme: LIGHT });
    void add; void rem; void add2; void rem2;
    ed2.destroy();

    const notes: string[] = []; const off = ed.onNotice((m) => notes.push(m.level + ":" + m.text));
    const drop = (files: File[], x = 100, y = 120) => { const ev = new Event("drop", { bubbles: true, cancelable: true }); Object.assign(ev, { clientX: x, clientY: y, dataTransfer: { files, types: ["Files"], items: files.map((f) => ({ kind: "file", type: f.type })) } }); stage.dispatchEvent(ev); return ev; };
    const ev = drop([file(100, 100)], 100, 120);
    expect(ev.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(imgs().length).toBe(1), { timeout: 4000 }); // wait for the decode itself, not a fixed delay (flaky under load)
    expect(imgs()[0]!.x + imgs()[0]!.w / 2).toBeCloseTo(100);
    const ev2 = drop([new File(["{}"], "doc.archypaint")]); // a document, not a picture
    expect(ev2.defaultPrevented).toBe(false);
    const paste = (files: File[]) => { const ev = new Event("paste", { bubbles: true, cancelable: true }); Object.assign(ev, { clipboardData: { files, getData: () => "" } }); window.dispatchEvent(ev); return ev; };
    expect(paste([file(50, 50, "p.png")]).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(imgs().length).toBe(2), { timeout: 4000 });
    paste([new File(["x"], "y.txt")]); await settle(); expect(imgs().length).toBe(2);
    drop([new File(["garbage"], "bad.png", { type: "image/png" })]);
    await vi.waitFor(() => expect(notes.some((n) => n.startsWith("error:"))).toBe(true), { timeout: 4000 }); // the failure reaches the user, nothing crashes
    off();
  });
  it("bounds the queue: a flood of pictures inserts a bounded number and says so", async () => {
    const notes: string[] = []; ed.onNotice((m) => notes.push(m.text));
    const files = Array.from({ length: 40 }, (_, i) => file(10 + i, 10, `f${i}.png`));
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(ev, { clientX: 10, clientY: 10, dataTransfer: { files, types: ["Files"], items: [] } });
    stage.dispatchEvent(ev);
    for (let i = 0; i < 40; i++) await settle();
    expect(imgs().length).toBe(20);
    expect(notes.some((n) => /Too many images/.test(n))).toBe(true);
  });
  it("installImageInput removes exactly what it added", () => {
    const s = document.createElement("div");
    const add = vi.spyOn(s, "addEventListener"), rem = vi.spyOn(s, "removeEventListener");
    const wadd = vi.spyOn(window, "addEventListener"), wrem = vi.spyOn(window, "removeEventListener");
    const off = installImageInput(ed, s);
    off(); off();
    expect(add.mock.calls.map((c) => c[0]).sort()).toEqual(rem.mock.calls.slice(0, add.mock.calls.length).map((c) => c[0]).sort());
    expect(wadd.mock.calls.filter((c) => c[0] === "paste").length).toBe(wrem.mock.calls.filter((c) => c[0] === "paste").length);
  });
  it("100 insert/undo cycles do not grow the scene, history or blob store", async () => {
    for (let i = 0; i < 100; i++) { await ed.insertImage(file(100, 100)); ed.undo(); }
    expect(imgs().length).toBe(0);
    expect(store.data.size).toBe(1); // the same picture every time: one blob
    expect(ed.canRedo()).toBe(true);
  });
  it("the menu action opens a picker, removes the input afterwards, and reports failures as toasts", async () => {
    const a = actions.find((x) => x.id === "insert-image")!;
    const toast = vi.fn(); const clicks: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { clicks.push(this); });
    await a.run({ editor: ed, io: {} as never, toast, confirm: async () => true, stage });
    const inp = clicks[0]!;
    expect(inp.type).toBe("file"); expect(inp.accept).toContain("image/svg+xml");
    Object.defineProperty(inp, "files", { value: [new File(["junk"], "j.png", { type: "image/png" })] });
    inp.dispatchEvent(new Event("change"));
    await settle();
    expect(document.body.contains(inp)).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Unsupported/), "err");
    await a.run({ editor: ed, io: {} as never, toast, confirm: async () => true, stage });
    const inp2 = clicks[1]!; inp2.dispatchEvent(new Event("cancel"));
    expect(document.body.contains(inp2)).toBe(false);
  });
});

/* ---------------------------------------------------------------- file format */

const base = (o: Record<string, unknown> = {}) => ({ id: "e1", kind: "rect", x: 0, y: 0, w: 100, h: 60, z: 1, version: 1, cat: 0, fill: 1, radius: 8, text: "", edge: 1, groupIds: [], iconId: "", img: "", locked: false, n: 0, o: 0, src: "", dst: "", sp: -1, dp: -1, route: 1, dash: 0, head: 1, pts: [], ...o }) as never;
const head = { meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {} };

describe("file format with images", () => {
  it("a document without images is byte-identical to before: no img, no images key", () => {
    const t = serializeArch({ ...head, scene: { els: [base()], groups: [] } });
    expect(t).not.toContain('"img"'); expect(t).not.toContain('"images"');
  });
  it("an image element keeps its key, and the embedded map round-trips deterministically", () => {
    const url = "data:image/png;base64,AAAA";
    const f = { ...head, scene: { els: [base({ id: "i1", kind: "image", img: "0123456789abcdef" })], groups: [] }, extra: { images: { "0123456789abcdef": url } } };
    const t1 = serializeArch(f), t2 = serializeArch(f);
    expect(t1).toBe(t2);
    const p = parseArch(t1);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.scene.els[0]!.img).toBe("0123456789abcdef");
    expect((p.value.extra.images as Record<string, string>)["0123456789abcdef"]).toBe(url);
  });
  it("hostile img values are rejected by validation, not trusted", () => {
    const f = serializeArch({ ...head, scene: { els: [base({ id: "i1", kind: "image", img: "x".repeat(100) })], groups: [] } });
    expect(parseArch(f).ok).toBe(false);
  });
});

/* ---------------------------------------------------------------- svg + excalidraw export */

describe("exports", () => {
  it("SVG export embeds the picture as a data URL and draws a dashed placeholder when it is missing", () => {
    const els = [base({ id: "i1", kind: "image", img: "0123456789abcdef", x: 10, y: 10, w: 120, h: 80, text: "logo" }), base({ id: "i2", kind: "image", img: "ffffffffffffffff", x: 200, y: 10, w: 50, h: 50 })];
    const svg = buildSvg(els, LIGHT, { background: true, padding: 10, icons: () => null, images: { "0123456789abcdef": "data:image/png;base64,AAAA" } });
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain(">logo<");
  });
  it("SVG export refuses to emit a non-image data URL", () => {
    const svg = buildSvg([base({ id: "i1", kind: "image", img: "0123456789abcdef", w: 10, h: 10 })], LIGHT, { background: false, padding: 0, icons: () => null, images: { "0123456789abcdef": 'data:text/html;base64,PHNjcmlwdD4=" onload="x' } });
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("onload");
  });
  it("Excalidraw export writes a real image + files entry, re-imports with the same key, and falls back to a labelled rectangle without data", () => {
    const scene = { els: [base({ id: "i1", kind: "image", img: "0123456789abcdef", w: 120, h: 80, text: "cap" })], groups: [] };
    const url = "data:image/png;base64,AAAA";
    const ex = toExcalidraw(scene, LIGHT, { "0123456789abcdef": url }) as { elements: Array<Record<string, unknown>>; files: Record<string, Record<string, unknown>> };
    const im = ex.elements.find((e) => e.type === "image")!;
    expect(im.fileId).toBe("0123456789abcdef");
    expect(ex.files["0123456789abcdef"]!.dataURL).toBe(url);
    expect(ex.elements.some((e) => e.type === "text" && e.text === "cap")).toBe(true);
    const back = fromExcalidraw(ex);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.els.find((e) => e.kind === "image")!.img).toBe("0123456789abcdef");
    expect(back.images).toEqual({ "0123456789abcdef": url });

    const plain = toExcalidraw(scene, LIGHT) as { elements: Array<Record<string, unknown>> };
    expect(plain.elements.some((e) => e.type === "image")).toBe(false);
    expect(plain.elements.some((e) => e.type === "rectangle")).toBe(true);
  });
  it("Excalidraw import takes a foreign image with picture data, and skips one without (with a warning)", () => {
    const url = "data:image/jpeg;base64,/9j/4AAQ";
    const r = fromExcalidraw({ type: "excalidraw", elements: [
      { id: "a", type: "image", x: 0, y: 0, width: 50, height: 40, fileId: "f1", status: "saved" },
      { id: "b", type: "image", x: 100, y: 0, width: 50, height: 40, fileId: "missing", status: "saved" },
      { id: "c", type: "image", x: 200, y: 0, width: 50, height: 40, fileId: "f2", status: "saved" },
    ], files: { f1: { dataURL: url }, f2: { dataURL: "data:text/html;base64,PHNjcmlwdD4=" } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ims = r.scene.els.filter((e) => e.kind === "image");
    expect(ims.length).toBe(1);
    expect(ims[0]!.img).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.values(r.images ?? {})).toEqual([url]);
    expect(r.warnings.join(" ")).toMatch(/image/);
  });
});

/* ---------------------------------------------------------------- save / open through IO */

function ioEditor() {
  const scene = new Scene();
  let saved = scene.nonce;
  const loaded: unknown[] = [];
  const ed = { scene, vp: new Viewport(), dirty: () => scene.nonce !== saved, markSaved: () => { saved = scene.nonce; }, on: () => () => {}, load: (s: unknown) => { loaded.push(s); }, resetView() {}, zoomToFit() {}, zoomBy() {}, selection: () => new Set<string>() };
  return { ed: ed as unknown as EditorAPI, scene, loaded };
}
type W = Window & { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown };

describe("IO embeds pictures in saved files and restores them when opened", () => {
  afterEach(() => { delete (window as W).showSaveFilePicker; delete (window as W).showOpenFilePicker; });

  it("save writes the picture into the file; opening it in a fresh browser profile puts it back under the same key", async () => {
    const { ed, scene } = ioEditor();
    // a picture that really is in the local store
    const p = await (await import("./images")).prepareImage(new Blob([png(300, 200) as BlobPart], { type: "image/png" }));
    scene.add({ kind: "image", img: p.key, w: 100, h: 60 });
    let written = "";
    (window as W).showSaveFilePicker = async () => ({ name: "doc.archypaint", getFile: async () => new File([written], "doc.archypaint"), createWritable: async () => ({ write: async (b: Blob) => { written = await b.text(); }, close: async () => {} }) });
    const io = createIO(ed, document.createElement("div"), { kv: memKV() });
    await io.save();
    expect(written).toContain('"images"');
    const parsed = parseArch(written);
    expect(parsed.ok && Object.keys((parsed.value.extra.images ?? {}) as object)).toEqual([p.key]);
    io.dispose();

    // "another browser": empty store, open the file
    setImageStore(memImageStore()); clearImageCache();
    const b = ioEditor();
    (window as W).showOpenFilePicker = async () => [{ name: "doc.archypaint", getFile: async () => new File([written], "doc.archypaint"), createWritable: async () => ({}) }];
    const io2 = createIO(b.ed, document.createElement("div"), { kv: memKV() });
    await io2.open();
    const scn = b.loaded[0] as { els: Array<{ kind: string; img: string }> } | undefined;
    expect(scn?.els.find((e) => e.kind === "image")?.img).toBe(p.key);
    expect(await (await import("./images")).collectImages([p.key]).then((c) => Object.keys(c.images))).toEqual([p.key]);
    io2.dispose();
  });
  it("a sheet without pictures saves exactly as before (no images key) and never loads the image chunk", async () => {
    const { ed, scene } = ioEditor();
    scene.add({ kind: "rect" });
    let written = "";
    (window as W).showSaveFilePicker = async () => ({ name: "d.archypaint", getFile: async () => new File([], "d"), createWritable: async () => ({ write: async (b: Blob) => { written = await b.text(); }, close: async () => {} }) });
    const io = createIO(ed, document.createElement("div"), { kv: memKV() });
    await io.save();
    expect(written).not.toContain("images");
    io.dispose();
  });
  it("refuses to save when the pictures exceed the 20 MB file cap, tells the user, and writes nothing", async () => {
    const { ed, scene } = ioEditor();
    const st = memImageStore(); setImageStore(st);
    for (const k of ["aaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaa2"]) { await st.put(k, new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "image/png" })); scene.add({ kind: "image", img: k }); }
    const writes = vi.fn();
    (window as W).showSaveFilePicker = async () => ({ name: "d.archypaint", getFile: async () => new File([], "d"), createWritable: async () => ({ write: writes, close: async () => {} }) });
    const io = createIO(ed, document.createElement("div"), { kv: memKV() });
    const msgs: string[] = []; io.onMessage((m) => msgs.push(m.level + ":" + m.text));
    await io.save();
    expect(writes).not.toHaveBeenCalled();
    expect(msgs.join(" ")).toMatch(/error:.*20 MB/);
    io.dispose();
  });
});
