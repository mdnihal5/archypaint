// @vitest-environment jsdom
// A group selected as a whole is styled as a group: its OUTLINE colour and tint change, the members keep their own style.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "./editor";
import { exportGroups } from "./groups";
import { parseArch, serializeArch } from "./io/format";
import { toExcalidraw, fromExcalidraw } from "./io/excalidraw";
import { buildSvg } from "./io/svg";
import { drawEl } from "./renderer";
import type { El } from "./scene";
import { LIGHT } from "./theme";

vi.hoisted(() => { (globalThis as { Path2D?: unknown }).Path2D = class { constructor(public d?: string) {} }; });
const fakeCtx = new Proxy({}, { get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined), set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; } });
let stage: HTMLDivElement, ed: Editor;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div");
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT }); ed.renderer.resize(800, 600, 1);
});
afterEach(() => { ed.destroy(); stage.remove(); });

function grouped() {
  const a = ed.scene.add({ kind: "rect", x: 0, y: 0, w: 100, h: 60, cat: 1, fill: 1, text: "a" }), b = ed.scene.add({ kind: "rect", x: 200, y: 0, w: 100, h: 60, cat: 2, fill: 1, text: "b" });
  ed.select([a.id, b.id]);
  const gid = ed.group("backend")!;
  ed.select([a.id, b.id]);
  return { a, b, gid, g: () => ed.scene.groups.get(gid)! };
}
const outline = (gid: string) => exportGroups([...ed.scene.els.values()], ed.scene.groups.values(), () => 2).find((o) => o.id === gid)!;

describe("a whole group selected: colour, custom hex and fill go to the group", () => {
  it("colour swatch and hex recolour the group outline; the members are untouched; one undo step each", () => {
    const { a, b, gid, g } = grouped();
    ed.setStyle({ cat: 5 });
    expect(g().cat).toBe(5);
    ed.setStyle({ hex: "#12ab34" });
    expect(g().hex).toBe("#12ab34");
    expect([a.cat, b.cat, a.hex, b.hex]).toEqual([1, 2, undefined, undefined]);
    ed.undo(); expect(g().hex).toBeUndefined(); expect(g().cat).toBe(5);
    ed.undo(); expect(g().cat).not.toBe(5);
    ed.redo(); ed.redo();
    expect(ed.scene.groups.get(gid)!.hex).toBe("#12ab34");
  });
  it("fill outline / tint / solid sets the group tint; members keep their fill", () => {
    const { a, b, g } = grouped();
    ed.setStyle({ fill: 0 }); expect(g().fill).toBe(0);
    ed.setStyle({ fill: 2 }); expect(g().fill).toBe(2);
    ed.setStyle({ fill: 1 }); expect(g().fill).toBe(1);
    expect([a.fill, b.fill]).toEqual([1, 1]);
  });
  it("other controls (text size) still reach the members; a PART of a group styles its elements", () => {
    const { a, b, g } = grouped();
    ed.setStyle({ fs: 20 });
    expect([a.fs, b.fs]).toEqual([20, 20]);
    ed.select([a.id]); ed.setStyle({ cat: 7 });
    expect(a.cat).toBe(7); expect(g().cat).not.toBe(7);
  });
  it("a locked group is not restyled", () => {
    const { gid, g } = grouped();
    ed.setGroupLocked(gid, true);
    ed.setStyle({ cat: 5, hex: "#ffffff" });
    expect(g().hex).toBeUndefined();
  });
  it("the outline is drawn, exported (SVG, PNG draw path, Excalidraw) and saved in the group's colour and tint", () => {
    const { a, b, gid, g } = grouped();
    ed.setStyle({ hex: "#12ab34" }); ed.setStyle({ fill: 2 });
    const o = outline(gid);
    expect(o).toMatchObject({ hex: "#12ab34", fill: 2 });
    const svg = buildSvg([a, b] as never, LIGHT, { padding: 8, background: false, icons: () => null, groups: [o] });
    expect(svg).toContain('fill="#12ab34" fill-opacity="0.16" stroke="#12ab34"');
    ed.setStyle({ fill: 0 });
    expect(buildSvg([a, b] as never, LIGHT, { padding: 8, background: false, icons: () => null, groups: [outline(gid)] })).toContain('fill="none" stroke="#12ab34"');
    // canvas
    const calls: string[] = [];
    const cx = new Proxy({ font: "13px x" } as Record<string, unknown>, { get: (t, k: string) => (k === "measureText" ? () => ({ width: 10 }) : k in t ? t[k] : (...x: unknown[]) => { calls.push(`${k}(${x.join(",")})`); }), set: (t, k: string, v) => { t[k] = v; calls.push(`${k}=${v}`); return true; } }) as unknown as CanvasRenderingContext2D;
    (ed.renderer as unknown as { drawGroups(c: CanvasRenderingContext2D, d: boolean): void }).drawGroups(cx, false);
    expect(calls.join("|")).toContain("strokeStyle=#12ab34");
    expect(calls.join("|")).not.toMatch(/globalAlpha=0\.(05|16)/); // fill 0: no wash
    void drawEl;
    // Excalidraw outline keeps the colour
    const doc = { els: [a, b].map((e) => ed.scene.snapshot(e)), groups: [{ ...g() }] };
    const ex = toExcalidraw(doc as never) as { elements: Array<{ id: string; strokeColor: string }> };
    expect(ex.elements.find((e) => e.id === `${gid}_outline`)!.strokeColor).toBe("#12ab34");
    const back = fromExcalidraw(ex);
    expect(back.ok && back.scene.groups[0]).toMatchObject({ hex: "#12ab34", fill: 0 });
  });
  it("persists in the file; a group written before has no hex / fill and loads exactly as it did", () => {
    const { a, b, g } = grouped();
    ed.setStyle({ hex: "#12ab34", fill: 2 });
    const text = serializeArch({ meta: { name: "n", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: { els: [a, b].map((e) => ed.scene.snapshot(e)), groups: [{ ...g() }] } });
    const p = parseArch(text);
    expect(p.ok && p.value.scene.groups[0]).toMatchObject({ hex: "#12ab34", fill: 2 });
    const old = serializeArch({ meta: { name: "n", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: { els: [], groups: [{ id: "g1", name: "old", cat: 3, collapsed: false, locked: false }] } });
    expect(old).not.toContain("hex"); expect(old).not.toContain('"fill"');
    const q = parseArch(old);
    expect(q.ok && q.value.scene.groups[0]).toEqual({ id: "g1", name: "old", cat: 3, collapsed: false, locked: false });
  });
  it("a duplicated group keeps its colour and tint", () => {
    const { g } = grouped();
    ed.setStyle({ hex: "#12ab34", fill: 2 });
    ed.duplicateSelection();
    const copies = [...ed.scene.groups.values()].filter((x) => x.id !== g().id);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ hex: "#12ab34", fill: 2 });
  });
});
void (null as unknown as El);
