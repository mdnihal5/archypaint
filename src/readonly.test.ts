// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { LIGHT } from "./theme";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
let stage: HTMLDivElement;
let ed: Editor;
const ptr = (type: string, x: number, y: number, extra: MouseEventInit = {}) => stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra }));
const drag = (x0: number, y0: number, x1: number, y1: number) => { ptr("pointerdown", x0, y0); ptr("pointermove", (x0 + x1) / 2, (y0 + y1) / 2); ptr("pointermove", x1, y1); ptr("pointerup", x1, y1); };
const key = (k: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div");
  stage.setPointerCapture = () => {}; stage.releasePointerCapture = () => {};
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  ed.renderer.resize(1200, 800, 1);
});
afterEach(() => { ed.destroy(); stage.remove(); });

function withShape() {
  ed.setTool("rect"); drag(100, 100, 220, 180);
  const r = [...ed.scene.els.values()][0]!;
  return r;
}

describe("view-only mode", () => {
  it("every command that would change the document does nothing", () => {
    const r = withShape();
    ed.select([r.id]);
    const before = JSON.stringify(ed.scene.toJSON());
    ed.setReadOnly(true);
    expect(ed.readOnly).toBe(true);
    ed.select([r.id]);
    ed.deleteSelection(); ed.duplicateSelection(); ed.setStyle({ cat: 4 }); ed.group("x"); ed.nudge(10, 10); ed.bringToFront(); ed.placeIcon("cache");
    ed.insertLegend(); ed.align("left"); ed.toggleLock();
    ed.undo(); ed.redo();
    expect(JSON.stringify(ed.scene.toJSON())).toBe(before);
  });
  it("pointer gestures cannot move, resize, draw or edit; a drag pans the view instead", () => {
    const r = withShape();
    const x0 = r.x, y0 = r.y, w0 = r.w;
    ed.setReadOnly(true);
    const vx = ed.vp.x;
    drag(160, 140, 400, 300); // would move the shape
    expect([r.x, r.y, r.w]).toEqual([x0, y0, w0]);
    expect(ed.vp.x).not.toBe(vx); // panned
    const n = ed.scene.els.size;
    ed.setTool("rect"); drag(500, 500, 600, 600);
    stage.dispatchEvent(new MouseEvent("dblclick", { clientX: 700, clientY: 700, bubbles: true })); // would create a text
    expect(ed.scene.els.size).toBe(n);
  });
  it("keys (Delete, tool letters, Ctrl+A/D, arrows) are ignored", () => {
    const r = withShape();
    ed.setReadOnly(true);
    ed.select([r.id]);
    key("Delete"); key("a", { ctrlKey: true }); key("d", { ctrlKey: true }); key("ArrowRight"); key("r");
    expect(ed.scene.els.has(r.id)).toBe(true);
    expect(ed.scene.els.size).toBe(1);
    expect(ed.tool).toBe("select");
  });
  it("turning it on clears the selection and text editing; turning it off restores editing", () => {
    const r = withShape();
    ed.select([r.id]);
    ed.setReadOnly(true);
    expect(ed.selection().size).toBe(0);
    ed.setReadOnly(false);
    ed.select([r.id]);
    ed.deleteSelection();
    expect(ed.scene.els.size).toBe(0);
  });
  it("load() still works (that is how a shared document gets in) and does not make the document dirty", () => {
    ed.setReadOnly(true);
    ed.load({ els: [], groups: [] });
    ed.markSaved();
    expect(ed.dirty()).toBe(false);
  });
});

describe("view-only mode: the inline-edit and group / label gestures are blocked too", () => {
  const ta = () => document.querySelector("textarea");
  const click = (x: number, y: number) => { ptr("pointerdown", x, y); ptr("pointerup", x, y); };
  const dbl = (x: number, y: number) => { click(x, y); click(x, y); stage.dispatchEvent(new MouseEvent("dblclick", { clientX: x, clientY: y, bubbles: true, detail: 2 })); };
  const kd = (k: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
  /** a labelled connector, and a two-box group with a name, on a document that is then switched to view-only */
  function scene() {
    const a = ed.scene.add({ kind: "rect", x: 100, y: 100, w: 100, h: 60, text: "a" }), b = ed.scene.add({ kind: "rect", x: 300, y: 100, w: 100, h: 60, text: "b" });
    ed.select([a.id, b.id]);
    const gid = ed.group("backend")!;
    const arrow = ed.scene.add({ kind: "arrow", x: 100, y: 400, w: 200, h: 0, pts: [100, 400, 200, 400, 200, 400, 300, 400], route: 0, fill: 0, labels: [{ t: 0.5, text: "http" }] });
    ed.clearSelection();
    ed.setReadOnly(true);
    return { a, b, gid, arrow };
  }
  it("double-click on a shape, on a connector's label, on a group name tag or on empty space opens no editor and adds nothing", () => {
    const { a, gid, arrow } = scene();
    const n = ed.scene.els.size;
    dbl(150, 130); dbl(200, 400); dbl(150, 400);
    const g = (ed as unknown as { groupIdx: { tagBox(id: string): { x: number; y: number } } }).groupIdx.tagBox(gid);
    dbl(g.x + 10, g.y + 8); dbl(700, 700);
    expect(ta()).toBeNull(); expect(ed.scene.els.size).toBe(n);
    expect([a.text, arrow.labels![0]!.text, ed.scene.groups.get(gid)!.name]).toEqual(["a", "http", "backend"]);
  });
  it("typing a character (type-to-edit) and Enter open nothing, for a shape, a connector and a whole group", () => {
    const { a, b, arrow } = scene();
    for (const ids of [[a.id], [arrow.id], [a.id, b.id]]) { ed.select(ids); kd("x"); kd("Enter"); expect(ta()).toBeNull(); }
    expect(a.text).toBe("a"); expect(ed.tool).toBe("select");
  });
  it("the editing API itself refuses: editSelection, editLabel, editGroupName", () => {
    const { a, gid, arrow } = scene();
    ed.select([a.id]);
    expect(ed.editSelection()).toBe(false); expect(ed.editSelection("x")).toBe(false);
    ed.editLabel(arrow, 0, 0.5); ed.editLabel(arrow, -1, 0.2, "z"); ed.editGroupName(gid);
    expect(ta()).toBeNull();
  });
  it("dragging a connector label does not slide it (the drag pans instead)", () => {
    const { arrow } = scene();
    const vx = ed.vp.x;
    drag(200, 400, 280, 400);
    expect(arrow.labels![0]!.t).toBe(0.5);
    expect(ed.vp.x).not.toBe(vx);
  });
  it("dragging a group by its interior or its tag moves nothing (pans)", () => {
    const { a, b, gid } = scene();
    const tag = (ed as unknown as { groupIdx: { tagBox(id: string): { x: number; y: number } } }).groupIdx.tagBox(gid);
    const vx = ed.vp.x;
    drag(250, 130, 330, 230); drag(tag.x + 10, tag.y + 8, tag.x + 10, tag.y + 80);
    expect([a.x, a.y, b.x, b.y]).toEqual([100, 100, 300, 100]);
    expect(ed.vp.x).not.toBe(vx);
  });
  it("group lock cannot be toggled and styles / alignment cannot be set", () => {
    const { a, b, gid } = scene();
    ed.select([a.id, b.id]);
    ed.toggleLock(); ed.setGroupLocked(gid, true); ed.setStyle({ align: "left", fs: 26 });
    expect(ed.scene.groups.get(gid)!.locked).toBe(false); expect([a.align, a.fs]).toEqual([undefined, undefined]);
  });
});
