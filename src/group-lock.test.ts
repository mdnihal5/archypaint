// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import type { GroupIndex } from "./groups";
import type { El } from "./scene";
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
  e.renderer.resize(1400, 900, 1);
  return e;
};
const ptr = (type: string, x: number, y: number, extra: MouseEventInit = {}) => stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra }));
const drag = (x0: number, y0: number, x1: number, y1: number) => { ptr("pointerdown", x0, y0); ptr("pointermove", (x0 + x1) / 2, (y0 + y1) / 2); ptr("pointermove", x1, y1); ptr("pointerup", x1, y1); };
const click = (x: number, y: number) => { ptr("pointerdown", x, y); ptr("pointerup", x, y); };
const dbl = (x: number, y: number) => { click(x, y); click(x, y); ptr("dblclick", x, y, { detail: 2 }); };
const key = (k: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
const ta = () => document.querySelector("textarea") as HTMLTextAreaElement | null;
const add = (init: Partial<El> & { kind: El["kind"] }): El => { const e = ed.scene.add(init); ed.renderer.invalidate(true, true); return e; };
const gix = () => (ed as unknown as { groupIdx: GroupIndex }).groupIdx;

beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never; ed = mk(); });
afterEach(() => { ed.destroy(); stage.remove(); });

function lockedGroup() {
  const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60, text: "a" }), b = add({ kind: "rect", x: 300, y: 100, w: 100, h: 60, text: "b" });
  ed.select([a.id, b.id]);
  const gid = ed.group("backend")!;
  return { a, b, gid };
}

describe("group lock", () => {
  it("selectedGroup is the group only when the selection is exactly that whole group", () => {
    const { a, b, gid } = lockedGroup();
    expect(ed.selectedGroup()).toBe(gid);
    ed.select([a.id]); expect(ed.selectedGroup()).toBeNull();
    const c = add({ kind: "rect", x: 600, y: 100 });
    ed.select([a.id, b.id, c.id]); expect(ed.selectedGroup()).toBeNull();
  });
  it("toggleLock on a selected group sets GroupInfo.locked (not the members' own lock), and again unlocks; one undo step each", () => {
    const { a, b, gid } = lockedGroup();
    ed.select([a.id, b.id]);
    ed.toggleLock();
    expect(ed.scene.groups.get(gid)!.locked).toBe(true);
    expect(a.locked || b.locked).toBe(false);
    expect(ed.scene.isLocked(a)).toBe(true);
    ed.undo(); expect(ed.scene.groups.get(gid)!.locked).toBe(false);
    ed.redo(); expect(ed.scene.groups.get(gid)!.locked).toBe(true);
    ed.toggleLock(); expect(ed.scene.groups.get(gid)!.locked).toBe(false);
    expect(ed.scene.isLocked(a)).toBe(false);
  });
  it("a locked group cannot be moved by dragging a member, dragging its interior, or by the arrow keys", () => {
    const { a, b, gid } = lockedGroup();
    ed.setGroupLocked(gid, true);
    drag(150, 130, 250, 230); // on member a
    drag(250, 130, 250, 230); // empty space inside the boundary
    ed.select([a.id, b.id]); key("ArrowRight", { shiftKey: true });
    expect([a.x, a.y, b.x, b.y]).toEqual([100, 100, 300, 100]);
    expect(ed.selection().size).toBe(2); // it can still be selected (that is how you unlock it)
  });
  it("cannot be resized: no resize handles act on it", () => {
    const { a, b, gid } = lockedGroup();
    ed.setGroupLocked(gid, true);
    ed.select([a.id, b.id]);
    drag(400, 160, 500, 260); // the south-east handle of the selection box
    expect([a.w, a.h, b.w, b.h]).toEqual([100, 60, 100, 60]);
  });
  it("cannot be deleted (Delete key, deleteSelection, cut), but an unlocked neighbour can", () => {
    const { a, b, gid } = lockedGroup();
    const loose = add({ kind: "rect", x: 700, y: 100 });
    ed.setGroupLocked(gid, true);
    ed.select([a.id, b.id, loose.id]);
    key("Delete");
    expect(ed.scene.els.has(a.id) && ed.scene.els.has(b.id)).toBe(true);
    expect(ed.scene.els.has(loose.id)).toBe(false);
    ed.select([a.id, b.id]); ed.deleteSelection(); ed.cut();
    expect(ed.scene.els.size).toBe(2);
  });
  it("members cannot be edited: no text editor on double-click, Enter or typing; style, rename and ungroup are refused", () => {
    const { a, b, gid } = lockedGroup();
    ed.setGroupLocked(gid, true);
    ed.select([a.id]); key("Enter"); expect(ta()).toBeNull();
    key("x"); expect(ta()).toBeNull();
    dbl(150, 130); expect(ta()).toBeNull();
    const tag = gix().tagBox(gid)!; dbl(tag.x + 10, tag.y + 8); expect(ta()).toBeNull();
    ed.select([a.id, b.id]);
    ed.setStyle({ cat: 5, fs: 26, align: "left" }); expect([a.cat, a.fs, a.align]).toEqual([0, undefined, undefined]);
    ed.renameGroup(gid, "other"); expect(ed.scene.groups.get(gid)!.name).toBe("backend");
    ed.ungroup(); expect(ed.scene.groups.has(gid)).toBe(true);
    expect(ed.align && (ed.align("left"), ed.matchSize("both"), true)).toBe(true);
    expect([a.x, b.x, a.w, b.w]).toEqual([100, 300, 100, 100]);
  });
  it("after unlocking everything works again", () => {
    const { a, b, gid } = lockedGroup();
    ed.setGroupLocked(gid, true); ed.setGroupLocked(gid, false);
    ed.select([a.id, b.id]); key("ArrowRight");
    expect(a.x).toBe(101);
    ed.select([a.id]); key("Enter"); expect(ta()).not.toBeNull();
  });
  it("the lock round-trips through the document's group table", () => {
    const { gid } = lockedGroup();
    ed.setGroupLocked(gid, true);
    const json = ed.scene.toJSON();
    expect(json.groups.find((g) => g.id === gid)!.locked).toBe(true);
  });
});

describe("Ctrl+G on an existing group", () => {
  it("is a no-op when the selection is exactly one top-level group: no duplicate group, no history step", () => {
    const { a, b, gid } = lockedGroup();
    ed.setGroupLocked(gid, false);
    ed.select([a.id, b.id]);
    expect(ed.canGroup()).toBe(false);
    const groups = ed.scene.groups.size, undos = ed.canUndo();
    expect(ed.group()).toBeNull();
    expect(ed.scene.groups.size).toBe(groups);
    expect(ed.scene.els.get(a.id)!.groupIds).toEqual([gid]);
    expect(ed.canUndo()).toBe(undos);
  });
  it("still groups when the membership differs: an added element, a removed one, or two groups", () => {
    const { a, b, gid } = lockedGroup();
    ed.setGroupLocked(gid, false);
    const c = add({ kind: "rect", x: 600, y: 100, w: 50, h: 50 });
    ed.select([a.id, b.id, c.id]);
    expect(ed.canGroup()).toBe(true);
    const outer = ed.group("outer")!;
    expect(ed.scene.els.get(a.id)!.groupIds).toEqual([gid, outer]); // the old group is nested inside the new one
    ed.select([a.id, b.id, c.id]);
    expect(ed.canGroup()).toBe(false); // now exactly `outer`
    // part of a group: 2 of 3 members
    ed.select([a.id, b.id]);
    expect(ed.canGroup()).toBe(true);
    // two separate groups
    const d = add({ kind: "rect", x: 800, y: 100, w: 50, h: 50 }), e2 = add({ kind: "rect", x: 900, y: 100, w: 50, h: 50 });
    ed.select([d.id, e2.id]); ed.group("g2");
    ed.select([a.id, b.id, c.id, d.id, e2.id]);
    expect(ed.canGroup()).toBe(true); // two groups together are not one group
  });
});
