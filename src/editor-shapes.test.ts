// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { SHAPE_SIZE, type ShapeTool, type Tool } from "./input";
import { buildSvg } from "./io/svg";
import { fromExcalidraw, toExcalidraw } from "./io/excalidraw";
import { parseArch, serializeArch } from "./io/format";
import { wellFormed } from "./io/testkit";
import { LIGHT } from "./theme";
import type { El } from "./scene";
import { NEW_KINDS } from "./shape-geom";

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
const of = (kind: string): El[] => [...ed.scene.els.values()].filter((e) => e.kind === kind);
const draw = (tool: Tool, x0: number, y0: number, x1: number, y1: number) => { ed.setTool(tool); drag(x0, y0, x1, y1); };

beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never; ed = mk(); });
afterEach(() => { ed.destroy(); stage.remove(); });

describe("new shapes: tools create the right kind and size", () => {
  const SHAPES = Object.keys(SHAPE_SIZE).filter((k) => !["rect", "ellipse", "diamond", "brace", "badge"].includes(k)) as ShapeTool[];
  it("a click makes the default size, centred on the click; the tool returns to select", () => {
    for (const k of SHAPES) {
      ed.setTool(k); click(600, 400);
      const e = of(k)[0]!;
      expect(e, k).toBeTruthy();
      expect([e.w, e.h], k).toEqual([SHAPE_SIZE[k].w, SHAPE_SIZE[k].h]);
      expect(e.x + e.w / 2, k).toBeCloseTo(600, 5);
      expect(ed.tool).toBe("select"); expect(ed.selection().has(e.id)).toBe(true);
      ed.scene.remove(e);
    }
  });
  it("a drag makes a custom size", () => {
    draw("hexagon", 200, 200, 420, 340);
    const e = of("hexagon")[0]!;
    expect([e.x, e.y, e.w, e.h]).toEqual([200, 200, 220, 140]);
  });
  it("a brace follows the drag direction: mostly vertical -> {, mostly horizontal -> up-pointing brace", () => {
    draw("brace", 300, 200, 310, 420);
    const v = of("brace")[0]!;
    expect(v.o).toBe(0); expect(v.h).toBeGreaterThan(200); expect(v.w).toBe(28);
    draw("brace", 300, 600, 620, 610);
    const hz = of("brace")[1]!;
    expect(hz.o).toBe(2); expect(hz.w).toBeGreaterThan(300); expect(hz.h).toBe(28);
  });
  it("orientation change swaps a brace's box about its centre and is one undo step", () => {
    draw("brace", 300, 200, 310, 420);
    const b = of("brace")[0]!, cx = b.x + b.w / 2, cy = b.y + b.h / 2, w0 = b.w, h0 = b.h;
    ed.setStyle({ o: 2 });
    expect([b.o, b.w, b.h]).toEqual([2, h0, w0]);
    expect(b.x + b.w / 2).toBeCloseTo(cx, 6); expect(b.y + b.h / 2).toBeCloseTo(cy, 6);
    ed.undo();
    expect([b.o, b.w, b.h]).toEqual([0, w0, h0]);
  });
  it("the line tool draws an arrow without a head", () => {
    ed.setTool("line"); drag(200, 200, 500, 300);
    const a = of("arrow")[0]!;
    expect(a).toBeTruthy(); expect(a.head).toBe(0);
  });
});

describe("step badges", () => {
  it("auto-increment on placement; renumber closes gaps; renumber is one undo step", () => {
    for (let i = 0; i < 3; i++) { ed.setTool("badge"); click(200 + i * 100, 300); }
    expect(of("badge").map((b) => b.n)).toEqual([1, 2, 3]);
    expect(of("badge").every((b) => b.w === 32 && b.h === 32 && b.fill === 2)).toBe(true);
    ed.select([of("badge")[1]!.id]); ed.deleteSelection();
    ed.renumberBadges();
    expect(of("badge").map((b) => b.n).sort()).toEqual([1, 2]);
    ed.undo();
    expect(of("badge").map((b) => b.n).sort()).toEqual([1, 3]);
  });
  it("the palette command tools work through setTool", () => {
    for (let i = 0; i < 2; i++) { ed.setTool("badge"); click(200 + i * 100, 300); }
    ed.scene.patch(of("badge")[1]!, { n: 9 });
    ed.setTool("renumber");
    expect(of("badge").map((b) => b.n)).toEqual([1, 2]);
    ed.setTool("legend");
    expect(of("legend")).toHaveLength(1);
  });
});

describe("frames and swimlanes", () => {
  it("are created BEHIND everything and never steal clicks meant for their contents", () => {
    draw("rect", 300, 300, 400, 360);
    const r = of("rect")[0]!;
    draw("frame", 200, 200, 700, 500);
    const f = of("frame")[0]!;
    expect(f.z).toBeLessThan(r.z);
    expect(f.dash).toBe(1);
    ed.clearSelection();
    click(350, 330);
    expect([...ed.selection()]).toEqual([r.id]); // the rect, not the frame
    ed.clearSelection();
    click(600, 450); // empty interior of the frame
    expect(ed.selection().size).toBe(0);
    click(400, 208); // the header band
    expect([...ed.selection()]).toEqual([f.id]);
  });
  it("dragging a frame carries the shapes fully inside it (and their arrows); one undo restores everything", () => {
    draw("frame", 200, 200, 700, 500); const f = of("frame")[0]!;
    draw("rect", 250, 260, 350, 320); const a = of("rect")[0]!;
    draw("rect", 500, 360, 600, 420); const b = of("rect")[1]!;
    draw("rect", 900, 260, 1000, 320); const out = of("rect")[2]!;
    ed.setTool("arrow"); drag(300, 290, 550, 390);
    const ar = of("arrow")[0]!;
    expect([ar.src, ar.dst]).toEqual([a.id, b.id]);
    const before = { a: [a.x, a.y], b: [b.x, b.y], f: [f.x, f.y], out: [out.x, out.y], p: [...ar.pts] };
    ed.clearSelection();
    drag(450, 210, 500, 240); // grab the header, move by (50, 30)
    expect([f.x, f.y]).toEqual([before.f[0]! + 50, before.f[1]! + 30]);
    expect([a.x, a.y]).toEqual([before.a[0]! + 50, before.a[1]! + 30]);
    expect([b.x, b.y]).toEqual([before.b[0]! + 50, before.b[1]! + 30]);
    expect([out.x, out.y]).toEqual(before.out);
    expect(ar.pts[0]).toBeCloseTo(before.p[0]! + 50, 3);
    expect(ar.src).toBe(a.id); expect(ar.dst).toBe(b.id);
    ed.undo();
    expect([a.x, a.y]).toEqual(before.a); expect([f.x, f.y]).toEqual(before.f); expect([b.x, b.y]).toEqual(before.b);
  });
  it("arrows cannot bind to a frame; a locked shape inside stays put", () => {
    draw("frame", 200, 200, 700, 500);
    draw("rect", 250, 260, 350, 320); const a = of("rect")[0]!;
    ed.select([a.id]); ed.setLocked(true); ed.clearSelection();
    ed.setTool("arrow"); drag(600, 400, 900, 400);
    expect(of("arrow")[0]!.src).toBe(""); // started on the frame's empty interior: free end
    ed.setTool("select"); ed.clearSelection();
    const x0 = a.x;
    drag(450, 210, 500, 240);
    expect(a.x).toBe(x0);
  });
  it("swimlane: default three lanes, names editable through the text (lines), n follows", () => {
    ed.setTool("lane"); click(600, 400);
    const l = of("lane")[0]!;
    expect(l.n).toBe(3); expect(l.text.split("\n")).toHaveLength(3);
    ed.setStyle({ o: 1 }); expect(l.o).toBe(1);
    ed.setStyle({ o: 3 }); expect(l.o).toBe(0); // lanes only have two orientations
  });
});

describe("align, distribute, match size", () => {
  const three = () => {
    draw("rect", 100, 100, 160, 140); draw("rect", 300, 220, 400, 300); draw("rect", 560, 150, 620, 200);
    const [a, b, c] = of("rect") as [El, El, El];
    ed.selectAll();
    return [a, b, c] as const;
  };
  it("align left / middle are single undo steps and re-route bound arrows once", () => {
    const [a, b, c] = three();
    ed.align("left");
    expect([a.x, b.x, c.x]).toEqual([100, 100, 100]);
    ed.undo();
    expect([a.x, b.x, c.x]).toEqual([100, 300, 560]);
    ed.selectAll(); // undo leaves only the touched shapes selected
    ed.align("middle");
    const mids = [a, b, c].map((e) => e.y + e.h / 2);
    expect(new Set(mids.map((v) => Math.round(v * 1e3))).size).toBe(1);
  });
  it("distribute makes equal gaps and needs three shapes", () => {
    const [a, b, c] = three();
    ed.distribute("h");
    const s = [a, b, c].sort((p, q) => p.x - q.x);
    expect(s[1]!.x - (s[0]!.x + s[0]!.w)).toBeCloseTo(s[2]!.x - (s[1]!.x + s[1]!.w), 6);
    ed.undo();
    ed.select([a.id, b.id]);
    const x = b.x; ed.distribute("h"); expect(b.x).toBe(x); // two shapes: no-op
  });
  it("a group is aligned as one block", () => {
    const [a, b, c] = three();
    ed.select([a.id, b.id]); ed.group();
    ed.selectAll();
    const dxab = b.x - a.x;
    ed.align("right");
    expect(b.x - a.x).toBe(dxab); // members keep their relative layout
    expect(Math.max(a.x + a.w, b.x + b.w)).toBeCloseTo(c.x + c.w, 6);
  });
  it("match size uses the largest; locked shapes are skipped", () => {
    const [a, b, c] = three();
    ed.select([c.id]); ed.setLocked(true);
    ed.selectAll();
    ed.matchSize("both");
    expect([a.w, a.h]).toEqual([b.w, b.h]);
    expect([a.w, a.h]).toEqual([100, 80]); // the largest UNLOCKED one
    expect([c.w, c.h]).toEqual([60, 50]);
  });
  it("arrows bound to aligned shapes follow in the same undo step", () => {
    draw("rect", 100, 100, 200, 160); draw("rect", 500, 300, 600, 360);
    const [a, b] = of("rect") as [El, El];
    ed.setTool("arrow"); drag(150, 130, 550, 330);
    const ar = of("arrow")[0]!;
    ed.select([a.id, b.id]);
    const endY = () => ar.pts[ar.pts.length - 1]!;
    const y0 = endY();
    ed.align("top");
    expect(endY()).not.toBe(y0); // the end followed b
    expect(b.y).toBe(a.y);
    ed.undo();
    expect(endY()).toBe(y0);
  });
});

describe("lock, copy style, legend", () => {
  it("locked shapes cannot be moved, deleted, nudged or text-edited; unlocking restores that", () => {
    draw("rect", 200, 200, 300, 260); const r = of("rect")[0]!;
    ed.setLocked(true);
    expect(r.locked).toBe(true);
    drag(250, 230, 350, 330); expect([r.x, r.y]).toEqual([200, 200]);
    ed.deleteSelection(); expect(ed.scene.els.has(r.id)).toBe(true);
    ed.nudge(10, 10); expect(r.x).toBe(200);
    ed.toggleLock(); expect(r.locked).toBe(false);
    ed.deleteSelection(); expect(ed.scene.els.has(r.id)).toBe(false);
  });
  it("copy style / paste style transfers category, fill, edge and dash", () => {
    draw("rect", 100, 100, 200, 160); draw("ellipse", 300, 100, 400, 160);
    const [r, el] = [of("rect")[0]!, of("ellipse")[0]!];
    ed.select([r.id]); ed.setStyle({ cat: 4, fill: 2, edge: 0, dash: 1 });
    expect(ed.copyStyle()).toBe(true);
    ed.select([el.id]); ed.pasteStyle();
    expect([el.cat, el.fill, el.edge, el.dash]).toEqual([4, 2, 0, 1]);
    expect(el.radius).toBe(0);
    ed.undo(); expect([el.cat, el.fill]).toEqual([0, 1]);
  });
  it("insert legend lists what is used; running it again on the selected legend refreshes it in place", () => {
    draw("rect", 100, 100, 200, 160); ed.setStyle({ cat: 3 });
    const lg = ed.insertLegend()!;
    expect(lg.kind).toBe("legend"); expect(lg.text).toBe("c3|compute");
    draw("ellipse", 300, 100, 400, 160); ed.setStyle({ cat: 5 });
    ed.select([lg.id]);
    const again = ed.insertLegend()!;
    expect(again.id).toBe(lg.id); expect(of("legend")).toHaveLength(1);
    expect(lg.text).toBe("c3|compute\nc5|security");
    expect(lg.h).toBeGreaterThan(24 + 2 * 22);
  });
});

describe("focus / highlight / panTo (find bar and minimap support)", () => {
  it("focusOn selects and centres the view on the elements; panTo centres on a point", () => {
    draw("rect", 100, 100, 160, 140); const r = of("rect")[0]!;
    ed.scene.set(r, 5000, 3000, 60, 40);
    ed.focusOn([r.id]);
    expect(ed.selection().has(r.id)).toBe(true);
    const vp = ed.vp;
    expect(vp.x + vp.w / vp.zoom / 2).toBeCloseTo(5030, 3); expect(vp.y + vp.h / vp.zoom / 2).toBeCloseTo(3020, 3);
    ed.panTo(-40, 90);
    expect(vp.x + vp.w / vp.zoom / 2).toBeCloseTo(-40, 6); expect(vp.y + vp.h / vp.zoom / 2).toBeCloseTo(90, 6);
  });
  it("highlight sets and clears the live-layer matches", () => {
    ed.highlight(["a", "b"], "a"); expect(ed.renderer.hi).toEqual(["a", "b"]); expect(ed.renderer.hiCur).toBe("a");
    ed.highlight([]); expect(ed.renderer.hi).toEqual([]);
  });
});

describe("persistence and export of every new kind", () => {
  const seedAll = () => {
    let x = 0;
    for (const k of NEW_KINDS) {
      const e = ed.scene.add({ kind: k as never, x: (x += 200), y: 100, w: k === "brace" ? 28 : 120, h: k === "brace" ? 100 : 90, n: k === "badge" ? 7 : k === "lane" ? 3 : 0, o: k === "brace" ? 2 : k === "lane" ? 1 : 0, dash: k === "frame" ? 1 : 0, text: k === "lane" ? "a\nb\nc" : k === "legend" ? "c0|data\nsolid|sync" : `${k} label`, cat: x % 8 });
      void e;
    }
  };
  it(".archypaint format: every new kind round-trips exactly (n, o, dash included)", () => {
    seedAll();
    const scene = ed.scene.toJSON();
    const text = serializeArch({ meta: { name: "t", created: 1, updated: 2 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene });
    const p = parseArch(text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const key = (e: { id: string }) => e.id;
    const norm = (els: typeof scene.els) => els.map((e) => ({ ...e, pts: [] as number[], version: 0 })).sort((a, b) => key(a).localeCompare(key(b)));
    expect(norm(p.value.scene.els)).toEqual(norm(scene.els));
    expect(p.value.scene.els.find((e) => e.kind === "badge")!.n).toBe(7);
    expect(p.value.scene.els.find((e) => e.kind === "frame")!.dash).toBe(1);
  });
  it("SVG export of every kind is well-formed and never leaves NaN behind", () => {
    seedAll();
    const svg = buildSvg([...ed.scene.els.values()], LIGHT, { background: true, padding: 24, icons: () => null });
    expect(wellFormed(svg)).toBeNull();
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(svg).toContain("LEGEND");
  });
  it("Excalidraw: new kinds export as the nearest native shape and come back as themselves", () => {
    seedAll();
    const scene = ed.scene.toJSON();
    const ex = toExcalidraw(scene) as { elements: Array<{ type: string; customData?: { archypaint?: { kind?: string } } }> };
    const types = new Set(ex.elements.map((e) => e.type));
    expect([...types].every((t) => ["rectangle", "ellipse", "diamond", "text", "arrow"].includes(t))).toBe(true);
    const back = fromExcalidraw(ex);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const kinds = back.scene.els.map((e) => e.kind).sort();
    expect(kinds).toEqual(scene.els.map((e) => e.kind).sort());
    expect(back.scene.els.find((e) => e.kind === "badge")!.n).toBe(7);
    expect(back.scene.els.find((e) => e.kind === "brace")!.o).toBe(2);
    expect(back.scene.els.find((e) => e.kind === "legend")!.text).toBe("c0|data\nsolid|sync");
  });
});

describe("leaks and loops", () => {
  it("100 create/undo cycles of every new shape leave the scene and history clean", () => {
    for (let i = 0; i < 100; i++) {
      for (const k of ["cylinder", "cloud", "note", "frame", "lane", "badge"] as const) { ed.setTool(k); click(300 + (i % 5) * 10, 300); }
      for (let j = 0; j < 6; j++) ed.undo();
    }
    expect(ed.scene.els.size).toBe(0);
    expect(ed.hist.size()).toBeLessThanOrEqual(ed.hist.cap * 2 + 600);
    expect(ed.renderer.selected.size).toBe(0);
  });
  it("destroy clears the find highlight and drags", () => {
    ed.highlight(["x"], "x");
    ed.destroy();
    expect(ed.renderer.hi).toEqual([]);
  });
});
