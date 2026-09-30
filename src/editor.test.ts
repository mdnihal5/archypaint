// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "./editor";
import { LIGHT } from "./theme";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
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
  e.renderer.resize(1200, 800, 1);
  return e;
};
const ptr = (type: string, x: number, y: number, extra: MouseEventInit = {}) => stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra }));
const drag = (x0: number, y0: number, x1: number, y1: number, extra: MouseEventInit = {}) => { ptr("pointerdown", x0, y0, extra); ptr("pointermove", (x0 + x1) / 2, (y0 + y1) / 2, extra); ptr("pointermove", x1, y1, extra); ptr("pointerup", x1, y1, extra); };
const key = (k: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));
const sh = (kind: string) => [...ed.scene.els.values()].filter((e) => e.kind === kind);

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  ed = mk();
});
afterEach(() => { ed.destroy(); stage.remove(); });

function twoBoxes() {
  ed.setTool("rect"); drag(100, 100, 220, 180);
  ed.setTool("rect"); drag(500, 300, 620, 380);
  const [a, b] = sh("rect");
  return [a!, b!] as const;
}

describe("drawing, connecting, moving", () => {
  it("draws shapes with the tools (drag and click) and selects the new one", () => {
    ed.setTool("ellipse"); drag(50, 50, 200, 150);
    expect(sh("ellipse")).toHaveLength(1);
    expect(ed.selection().size).toBe(1);
    expect(ed.tool).toBe("select");
    ed.setTool("diamond"); ptr("pointerdown", 400, 400); ptr("pointerup", 400, 400);
    expect(sh("diamond")[0]!.w).toBe(96); // click without drag -> default size
  });

  it("an arrow binds to shapes and follows when a shape moves; undo restores", () => {
    const [a, b] = twoBoxes();
    ed.setTool("arrow"); drag(160, 140, 560, 340);
    const ar = sh("arrow")[0]!;
    expect(ar.src).toBe(a.id); expect(ar.dst).toBe(b.id);
    const startX = ar.pts[0]!, startY = ar.pts[1]!;
    ed.clearSelection();
    drag(160, 120, 160, 420); // move box a down by 300 (grid snapping may add up to 5)
    expect(a.y).toBeGreaterThan(300);
    expect(ar.pts[1]).not.toBe(startY);
    expect(ar.src).toBe(a.id);
    ed.undo();
    expect(a.y).toBe(100); expect(ar.pts[0]).toBe(startX); expect(ar.pts[1]).toBe(startY);
    ed.redo();
    expect(a.y).toBeGreaterThan(300);
  });

  it("deleting a shape detaches its arrows instead of deleting them; undo re-attaches", () => {
    const [a] = twoBoxes();
    ed.setTool("arrow"); drag(160, 140, 560, 340);
    ed.select([a.id]); ed.deleteSelection();
    const ar = sh("arrow")[0]!;
    expect(ar.src).toBe(""); expect(ar.dst).not.toBe("");
    ed.undo();
    expect(sh("arrow")[0]!.src).toBe(a.id);
    expect(sh("rect")).toHaveLength(2);
  });

  it("resizes by a handle and reroutes bound arrows", () => {
    const [a] = twoBoxes();
    ed.setTool("arrow"); drag(160, 140, 560, 340);
    const before = a.w;
    ed.select([a.id]);
    drag(a.x + a.w, a.y + a.h, a.x + a.w + 100, a.y + a.h + 60); // se handle
    expect(a.w).toBeGreaterThan(before + 90);
    const ar = sh("arrow")[0]!;
    expect(ar.src).toBe(a.id);
    ed.undo();
    expect(a.w).toBe(before);
  });

  it("marquee selects contained shapes; shift-click toggles", () => {
    const [a, b] = twoBoxes();
    ed.clearSelection();
    drag(50, 50, 700, 450);
    expect([...ed.selection()].sort()).toEqual([a.id, b.id].sort());
    ed.clearSelection();
    ptr("pointerdown", 160, 140); ptr("pointerup", 160, 140);
    ptr("pointerdown", 560, 340, { shiftKey: true }); ptr("pointerup", 560, 340, { shiftKey: true });
    expect(ed.selection().size).toBe(2);
  });
});

describe("groups, z-order, style, clipboard", () => {
  it("group / rename / ungroup are undoable and select the whole group on click", () => {
    const [a, b] = twoBoxes();
    ed.select([a.id, b.id]);
    const gid = ed.group("edge")!;
    expect(ed.scene.groups.get(gid)!.name).toBe("edge");
    expect(a.groupIds).toEqual([gid]);
    ed.clearSelection();
    ptr("pointerdown", 160, 140); ptr("pointerup", 160, 140);
    expect(ed.selection().size).toBe(2); // clicking a member selects the group
    ed.renameGroup(gid, "renamed");
    expect(ed.scene.groups.get(gid)!.name).toBe("renamed");
    ed.ungroup();
    expect(ed.scene.groups.size).toBe(0); expect(a.groupIds).toEqual([]);
    ed.undo(); ed.undo();
    expect(ed.scene.groups.get(gid)!.name).toBe("edge");
    ed.undo();
    expect(ed.scene.groups.size).toBe(0);
  });

  it("nested groups: outer selects everything, entering drills one level", () => {
    ed.setTool("rect"); drag(0, 0, 100, 80); ed.setTool("rect"); drag(200, 0, 300, 80); ed.setTool("rect"); drag(400, 0, 500, 80);
    const [a, b, c] = sh("rect");
    ed.select([a!.id, b!.id]); const inner = ed.group("inner")!;
    ed.select([a!.id, b!.id, c!.id]); const outer = ed.group("outer")!;
    expect(a!.groupIds).toEqual([inner, outer]);
    ed.clearSelection(); ptr("pointerdown", 50, 40); ptr("pointerup", 50, 40);
    expect(ed.selection().size).toBe(3);
    stage.dispatchEvent(new MouseEvent("dblclick", { clientX: 50, clientY: 40, bubbles: true }));
    expect(ed.selection().size).toBe(2); // now the inner group
  });

  it("z-order commands change stacking and undo restores it", () => {
    const [a, b] = twoBoxes();
    ed.select([a.id]); ed.bringToFront();
    expect(a.z).toBeGreaterThan(b.z);
    ed.sendToBack();
    expect(a.z).toBeLessThan(b.z);
    ed.undo(); expect(a.z).toBeGreaterThan(b.z);
    ed.undo(); expect(a.z).toBeLessThan(b.z);
  });

  it("forward/backward step past an overlapping element only", () => {
    ed.setTool("rect"); drag(0, 0, 100, 100); ed.setTool("rect"); drag(50, 50, 150, 150); ed.setTool("rect"); drag(80, 80, 180, 180);
    const [a, b, c] = sh("rect");
    ed.select([a!.id]); ed.bringForward();
    expect(a!.z).toBeGreaterThan(b!.z); expect(a!.z).toBeLessThan(c!.z);
    ed.sendBackward();
    expect(a!.z).toBeLessThan(b!.z);
  });

  it("setStyle changes fill/edge/category on the selection; edge derives radius; arrows re-route", () => {
    const [a] = twoBoxes();
    ed.select([a.id]); ed.setStyle({ fill: 2, edge: 0, cat: 3 });
    expect(a.fill).toBe(2); expect(a.radius).toBe(0); expect(a.cat).toBe(3);
    ed.setStyle({ edge: 2 }); expect(a.radius).toBe(18);
    ed.setStyle({ radius: 5 }); expect(a.radius).toBe(5);
    ed.undo(); expect(a.radius).toBe(18);
    ed.setTool("arrow"); drag(160, 140, 560, 340);
    const ar = sh("arrow")[0]!;
    ed.select([ar.id]); ed.setStyle({ edge: 2 }); expect(ar.pts.length).toBe(8);
    ed.setStyle({ edge: 0, route: 0 }); expect(ar.pts.length).toBe(4);
  });

  it("duplicate, copy/paste (with sanitising) and cut", () => {
    const [a, b] = twoBoxes();
    ed.select([a.id, b.id]); ed.group("g");
    ed.duplicateSelection();
    expect(sh("rect")).toHaveLength(4); expect(ed.scene.groups.size).toBe(2);
    ed.select([a.id]);
    const snap = ed.scene.snapshot(a);
    const dirty = { ...snap, cat: 99, fill: 9, text: "x".repeat(5000), pts: [1, "no", 3] };
    const s = "archypaint:" + JSON.stringify({ els: [dirty, { ...snap, x: "evil" }, { kind: "nope" }], groups: [] });
    const before = ed.scene.els.size;
    expect(ed.paste(s)).toBe(true); // only the one valid element is pasted, and it is sanitised
    expect(ed.scene.els.size).toBe(before + 1);
    const pasted = [...ed.scene.els.values()].pop()!;
    expect(pasted.cat).toBe(7); expect(pasted.fill).toBe(1); expect(pasted.text.length).toBe(2000); expect(pasted.pts).toEqual([21, 23]); // sanitised, then offset by the paste step
    expect(ed.paste("archypaint:" + JSON.stringify({ els: [{ ...snap, x: "evil" }] }))).toBe(false);
    expect(ed.paste("not json")).toBe(false);
    expect(ed.paste("archypaint:" + JSON.stringify({ els: [] }))).toBe(false);
    for (const e of ed.scene.els.values()) { expect(Number.isFinite(e.x)).toBe(true); expect(Number.isFinite(e.w)).toBe(true); }
  });

  it("keyboard: undo/redo, select all, delete, nudge, ignored inside inputs", () => {
    twoBoxes();
    key("a", { ctrlKey: true }); expect(ed.selection().size).toBe(2);
    const a = sh("rect")[0]!, x = a.x;
    key("ArrowRight", { shiftKey: true }); expect(a.x).toBe(x + 10);
    key("Delete"); expect(sh("rect")).toHaveLength(0);
    key("z", { ctrlKey: true }); expect(sh("rect")).toHaveLength(2);
    key("z", { ctrlKey: true, shiftKey: true }); expect(sh("rect")).toHaveLength(0);
    const inp = document.createElement("input"); document.body.append(inp);
    ed.undo();
    const n = sh("rect").length;
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(sh("rect")).toHaveLength(n);
    inp.remove();
  });

  it("dirty tracking and load reset history", () => {
    expect(ed.dirty()).toBe(false);
    twoBoxes(); expect(ed.dirty()).toBe(true);
    ed.markSaved(); expect(ed.dirty()).toBe(false);
    ed.undo(); expect(ed.dirty()).toBe(true);
    ed.load(ed.scene.toJSON()); expect(ed.canUndo()).toBe(false); expect(ed.dirty()).toBe(false);
  });
});

describe("teardown and idle behaviour", () => {
  it("every listener added is removed by destroy()", () => {
    ed.destroy(); stage.remove();
    const adds = new Map<string, number>();
    const tag = (t: EventTarget) => (t === window ? "window" : t === document ? "document" : "el");
    const oa = EventTarget.prototype.addEventListener, or = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...r: never[]) { const k = `${tag(this)}:${type}`; adds.set(k, (adds.get(k) ?? 0) + 1); return (oa as Function).call(this, type, ...r); } as never;
    EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, ...r: never[]) { const k = `${tag(this)}:${type}`; adds.set(k, (adds.get(k) ?? 0) - 1); return (or as Function).call(this, type, ...r); } as never;
    try {
      const e2 = mk();
      e2.setTool("rect"); drag(10, 10, 100, 100); // exercises text editor? no: open one
      stage.dispatchEvent(new MouseEvent("dblclick", { clientX: 50, clientY: 50, bubbles: true })); // opens a textarea overlay
      e2.destroy();
      const leaked = [...adds.entries()].filter(([, n]) => n !== 0);
      expect(leaked).toEqual([]);
      expect(stage.querySelector("textarea")).toBeNull();
      ed = mk(); // afterEach destroys this one
    } finally { EventTarget.prototype.addEventListener = oa; EventTarget.prototype.removeEventListener = or; }
  });

  it("no frame is scheduled while idle, and none after destroy", async () => {
    twoBoxes();
    await new Promise((r) => setTimeout(r, 60)); // let pending frames drain
    const spy = vi.spyOn(window, "requestAnimationFrame");
    await new Promise((r) => setTimeout(r, 120));
    expect(spy).not.toHaveBeenCalled();
    ed.destroy();
    ed.renderer.invalidate(true, true); ed.renderer.wake();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    ed = mk();
  });

  it("history stays bounded", () => {
    ed.setTool("rect"); drag(10, 10, 100, 100);
    const a = sh("rect")[0]!; ed.select([a.id]);
    for (let i = 0; i < 400; i++) ed.setStyle({ cat: i % 8 === a.cat ? (i + 1) % 8 : i % 8 });
    let n = 0; while (ed.canUndo()) { ed.undo(); n++; }
    expect(n).toBeLessThanOrEqual(200);
  });
});
