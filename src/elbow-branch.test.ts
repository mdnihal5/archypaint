// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { fromExcalidraw, toExcalidraw } from "./io/excalidraw";
import { parseArch, serializeArch } from "./io/format";
import { LIGHT } from "./theme";
import type { El } from "./scene";
import { MAX_BRANCH_DEPTH, applySegs, canBindToArrow, cleanSegs, eachElbowSeg, eachInteriorSeg, hostDepth, rerouteBound, withSeg } from "./connectors";

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
const of = (kind: string): El[] => [...ed.scene.els.values()].filter((e) => e.kind === kind);
const add = (init: Partial<El> & { kind: El["kind"] }): El => { const e = ed.scene.add(init); ed.renderer.invalidate(true, true); return e; };

beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never; ed = mk(); });
afterEach(() => { ed.destroy(); stage.remove(); });


describe("elbow segments (pure)", () => {
  // a 3-segment elbow: right, down, right
  const path = () => [200, 130, 350, 130, 350, 330, 500, 330];
  it("applySegs slides an interior segment sideways and keeps the path orthogonal and the ends fixed", () => {
    const p = applySegs(path(), [3, 50]); // segment 1 (vertical): code = 1 * 2 + 1
    expect(p).toEqual([200, 130, 400, 130, 400, 330, 500, 330]);
  });
  it("ignores an entry whose index or orientation no longer exists", () => {
    expect(applySegs(path(), [2, 50])).toEqual(path()); // segment 1 is vertical, not horizontal
    expect(applySegs(path(), [9, 50])).toEqual(path()); // no such segment
    expect(applySegs([0, 0, 100, 0], [3, 50])).toEqual([0, 0, 100, 0]);
  });
  it("shifts two segments independently and never moves an end", () => {
    const p = applySegs([0, 0, 0, 50, 100, 50, 100, 120, 200, 120, 200, 0], [3, 10]);
    expect(p[0]).toBe(0); expect(p[1]).toBe(0); expect(p[10]).toBe(200); expect(p[11]).toBe(0);
  });
  it("eachInteriorSeg skips the two segments touching the ends", () => {
    const seen: number[] = [];
    eachInteriorSeg(path(), (k) => seen.push(k));
    expect(seen).toEqual([1]);
    seen.length = 0; eachInteriorSeg([0, 0, 100, 0, 100, 100], (k) => seen.push(k)); expect(seen).toEqual([]);
  });
  it("withSeg sets, replaces and removes offsets; cleanSegs rejects junk", () => {
    expect(withSeg(undefined, 3, 20)).toEqual([3, 20]);
    expect(withSeg([3, 20, 5, 7], 3, 40)).toEqual([5, 7, 3, 40]);
    expect(withSeg([3, 20], 3, 0.1)).toBeUndefined();
    expect(cleanSegs([3, 20, 3, 9, "x", 1, 1.5, 2, 4, NaN, 5, 1e9])).toEqual([3, 20]);
    expect(cleanSegs("no")).toBeUndefined();
  });
});

describe("elbow segment drag (real pointer events)", () => {
  const boxes = () => {
    const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 }), b = add({ kind: "rect", x: 500, y: 300, w: 100, h: 60 });
    ed.setTool("arrow"); drag(200, 130, 500, 330);
    return { a, b, ar: of("arrow")[0]! };
  };
  it("dragging the body of a bound elbow pushes the segment under the pointer; the ends stay on their ports", () => {
    const { a, b, ar } = boxes();
    expect(ar.pts).toEqual([200, 130, 350, 130, 350, 330, 500, 330]);
    drag(350, 230, 410, 230);
    expect(ar.pts).toEqual([200, 130, 410, 130, 410, 330, 500, 330]);
    expect([ar.src, ar.dst]).toEqual([a.id, b.id]);
    expect(ar.segs).toEqual([3, 60]);
    ed.undo();
    expect(ar.segs).toBeUndefined(); expect(ar.pts).toEqual([200, 130, 350, 130, 350, 330, 500, 330]);
    ed.redo();
    expect(ar.segs).toEqual([3, 60]);
  });
  it("dragging the midpoint handle of a selected elbow does the same, and the bend follows when a shape moves", () => {
    const { b, ar } = boxes();
    ed.select([ar.id]);
    drag(350, 230, 380, 230);
    expect(ar.segs).toEqual([3, 30]);
    ed.select([b.id]); ed.nudge(100, 0); // end moves to x = 600: the router's own mid is 400, the bend stays 30 beyond it
    expect(ar.pts.slice(0, 4)).toEqual([200, 130, 430, 130]);
    expect(ar.pts[ar.pts.length - 2]).toBe(600);
  });
  it("changing the route drops the manual shape", () => {
    const { ar } = boxes();
    drag(350, 230, 410, 230);
    ed.select([ar.id]); ed.setStyle({ route: 0 });
    expect(ar.segs).toBeUndefined();
  });
  it("a bound straight arrow dragged on its body does nothing and stays bound", () => {
    const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 }), b = add({ kind: "rect", x: 500, y: 300, w: 100, h: 60 });
    ed.setDefaults({ route: 0 }); ed.setTool("arrow"); drag(200, 130, 500, 330);
    const ar = of("arrow")[0]!, before = [...ar.pts];
    drag(350, 230, 380, 300);
    expect(ar.pts).toEqual(before); expect([ar.src, ar.dst]).toEqual([a.id, b.id]);
  });
  it("an arrow with one end bound keeps that end when its body is dragged", () => {
    const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 });
    ed.setTool("arrow"); drag(200, 130, 500, 330); // ends free at (500,330)
    const ar = of("arrow")[0]!;
    drag(350, 230, 400, 230);
    expect(ar.src).toBe(a.id); expect(ar.pts.slice(0, 2)).toEqual([200, 130]); expect(ar.pts.slice(-2)).toEqual([500, 330]);
  });
  it("an arrow with both ends free still translates as a whole", () => {
    const a = add({ kind: "arrow", x: 100, y: 300, w: 300, h: 100, pts: [100, 300, 250, 300, 250, 400, 400, 400] });
    drag(250, 350, 330, 320);
    expect(a.pts).toEqual([180, 270, 330, 270, 330, 370, 480, 370]);
  });
  it("a locked arrow is not reshaped", () => {
    const { ar } = boxes();
    ed.select([ar.id]); ed.toggleLock();
    const before = [...ar.pts];
    drag(350, 230, 410, 230);
    expect(ar.pts).toEqual(before);
  });
  it("survives save/load and the Excalidraw round trip", () => {
    const { ar } = boxes();
    drag(350, 230, 410, 230);
    const scene = ed.scene.toJSON();
    const p = parseArch(serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene }));
    expect(p.ok && p.value.scene.els.find((e) => e.id === ar.id)!.segs).toEqual([3, 60]);
    const back = fromExcalidraw(JSON.parse(JSON.stringify(toExcalidraw(scene))));
    expect(back.ok && back.scene.els.find((e) => e.kind === "arrow")!.segs).toEqual([3, 60]);
  });
});

describe("elbow end segments (stubs)", () => {
  const boxes = () => {
    const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 }), b = add({ kind: "rect", x: 500, y: 300, w: 100, h: 60 });
    ed.setTool("arrow"); drag(200, 130, 500, 330);
    return { a, b, ar: of("arrow")[0]! };
  };
  const orthogonal = (p: readonly number[]) => { for (let i = 0; i + 3 < p.length; i += 2) if (Math.abs(p[i]! - p[i + 2]!) > 0.01 && Math.abs(p[i + 1]! - p[i + 3]!) > 0.01) return false; return true; };
  const handles = (ar: El) => { const c: number[] = []; eachElbowSeg(ar, ed.scene, ar.pts, (code) => c.push(code)); return c; };
  it("a 3-segment elbow exposes 3 handles; stubs add none", () => {
    const { ar } = boxes();
    expect(handles(ar).length).toBe(3);
    drag(275, 130, 275, 170);
    expect(ar.pts.length / 2 - 1).toBe(5); // stub, jog, moved segment, then the 2 others
    expect(handles(ar).length).toBe(3);
  });
  it("dragging the first segment keeps the start on its port, leaves straight, and undoes exactly", () => {
    const { a, b, ar } = boxes();
    const before = [...ar.pts];
    drag(275, 130, 275, 170);
    expect(ar.pts).toEqual([200, 130, 220, 130, 220, 170, 350, 170, 350, 330, 500, 330]);
    expect(orthogonal(ar.pts)).toBe(true);
    expect([ar.src, ar.dst]).toEqual([a.id, b.id]);
    expect(ar.segs).toEqual([0, 40]);
    ed.undo(); expect(ar.pts).toEqual(before); expect(ar.segs).toBeUndefined();
    ed.redo(); expect(ar.pts).toEqual([200, 130, 220, 130, 220, 170, 350, 170, 350, 330, 500, 330]);
  });
  it("dragging the last segment keeps the end on its port and enters straight", () => {
    const { a, b, ar } = boxes();
    const before = [...ar.pts];
    drag(425, 330, 425, 380);
    expect(ar.pts).toEqual([200, 130, 350, 130, 350, 380, 480, 380, 480, 330, 500, 330]);
    expect(orthogonal(ar.pts)).toBe(true);
    expect([ar.src, ar.dst]).toEqual([a.id, b.id]);
    expect(ar.segs).toEqual([2 * 4095 + 0, 50]);
    ed.undo(); expect(ar.pts).toEqual(before);
    ed.redo(); expect(ar.pts.slice(-6)).toEqual([480, 380, 480, 330, 500, 330]);
  });
  it("a one-segment elbow dragged sideways gets stubs at both ends", () => {
    const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 }), b = add({ kind: "rect", x: 500, y: 100, w: 100, h: 60 });
    ed.setTool("arrow"); drag(200, 130, 500, 130);
    const ar = of("arrow")[0]!;
    expect(ar.pts).toEqual([200, 130, 500, 130]);
    drag(350, 130, 350, 190);
    expect(ar.pts).toEqual([200, 130, 220, 130, 220, 190, 480, 190, 480, 130, 500, 130]);
    expect(handles(ar).length).toBe(1);
    expect([ar.src, ar.dst]).toEqual([a.id, b.id]);
  });
  it("round-trips through save/load and keeps the jog when a shape moves", () => {
    const { b, ar } = boxes();
    drag(275, 130, 275, 170);
    const p = parseArch(serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: ed.scene.toJSON() }));
    expect(p.ok && p.value.scene.els.find((e) => e.id === ar.id)!.segs).toEqual([0, 40]);
    ed.select([b.id]); ed.nudge(0, 100);
    expect(ar.pts).toEqual([200, 130, 220, 130, 220, 170, 350, 170, 350, 430, 500, 430]);
    expect(orthogonal(ar.pts)).toBe(true);
  });
  it("old interior-only files render the same", () => {
    expect(applySegs([200, 130, 350, 130, 350, 330, 500, 330], [3, 50])).toEqual([200, 130, 400, 130, 400, 330, 500, 330]);
    expect(applySegs([200, 130, 350, 130, 350, 330, 500, 330], [5, 50])).toEqual([200, 130, 350, 130, 350, 330, 500, 330]); // index 2 is not "last" in the old format
  });
});

describe("branching from a line", () => {
  const host = () => {
    const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 }), b = add({ kind: "rect", x: 500, y: 100, w: 100, h: 60 });
    ed.setDefaults({ route: 0 }); ed.setTool("arrow"); drag(200, 130, 500, 130);
    return { a, b, h: of("arrow")[0]! };
  };
  const branch = (h: El) => {
    ed.setTool("arrow"); drag(350, 130, 350, 300);
    return of("arrow").find((e) => e.id !== h.id)!;
  };
  it("pressing on an existing arrow with the arrow tool starts an arrow bound to it at parameter t", () => {
    const { h } = host();
    const br = branch(h);
    expect(br.src).toBe(h.id); expect(br.st).toBeCloseTo(0.5, 2); expect(br.dst).toBe("");
    expect(br.pts.slice(0, 2)).toEqual([350, 130]);
  });
  it("the branch end follows when the host re-routes (a shape moves) and live while dragging", () => {
    const { b, h } = host();
    const br = branch(h);
    ed.select([b.id]); ed.nudge(0, 100); // host now ends at (500, 230)... straight line from (200,130)
    const hs = h.pts, mid = [(hs[0]! + hs[2]!) / 2, (hs[1]! + hs[3]!) / 2];
    expect(br.pts[0]).toBeCloseTo(mid[0]!, 1); expect(br.pts[1]).toBeCloseTo(mid[1]!, 1);
    ed.undo();
    expect(br.pts.slice(0, 2)).toEqual([350, 130]);
  });
  it("deleting the host deletes its branches too; undo restores them on the host", () => {
    const { h } = host();
    const br = branch(h), before = [...br.pts];
    ed.select([h.id]); ed.deleteSelection();
    expect(ed.scene.els.has(br.id)).toBe(false);
    ed.undo();
    const back = ed.scene.els.get(br.id)!;
    expect(back.src).toBe(h.id); expect(back.pts).toEqual(before);
  });
  it("deleting a shape takes its line and the branch off that line with it", () => {
    const { a, h } = host();
    const br = branch(h);
    ed.select([a.id]); ed.deleteSelection();
    expect(ed.scene.els.has(h.id)).toBe(false); expect(ed.scene.els.has(br.id)).toBe(false);
    ed.undo();
    expect(ed.scene.els.get(br.id)!.src).toBe(h.id); expect(ed.scene.els.get(h.id)!.src).toBe(a.id);
  });
  it("a branch end can sit on the host at the far end too, and dragging a branch end onto another line rebinds it", () => {
    const { h } = host();
    ed.setTool("arrow"); drag(350, 300, 400, 130); // starts free, ends on the host
    const br = of("arrow").find((e) => e.id !== h.id)!;
    expect(br.dst).toBe(h.id); expect(br.dt).toBeCloseTo(2 / 3, 2);
  });
  it("refuses cycles: A on B, then B on A", () => {
    const { h } = host();
    const br = branch(h);
    expect(canBindToArrow(ed.scene, h.id, br.id)).toBe(false); // br hangs on h
    expect(canBindToArrow(ed.scene, br.id, h.id)).toBe(true);
    expect(canBindToArrow(ed.scene, h.id, h.id)).toBe(false);
    ed.select([br.id]);
    // dragging the host's start handle onto the branch must not bind
    ed.select([h.id]); drag(200, 130, 350, 215);
    expect(h.src).not.toBe(br.id);
  });
  it("caps the chain depth", () => {
    const { h } = host();
    let prev = h;
    for (let i = 0; i < MAX_BRANCH_DEPTH + 2; i++) {
      const e = add({ kind: "arrow", x: 0, y: 200 + i * 50, w: 100, h: 0, pts: [0, 200 + i * 50, 100, 200 + i * 50], src: prev.id, st: 0.5 });
      if (canBindToArrow(ed.scene, "", prev.id)) { prev = e; } else { expect(i).toBeGreaterThanOrEqual(MAX_BRANCH_DEPTH - 1); break; }
    }
    expect(hostDepth(ed.scene, prev)).toBeLessThanOrEqual(MAX_BRANCH_DEPTH);
  });
  it("rerouteBound is hosts-first and terminates on a cyclic file", () => {
    const { a, h } = host();
    const x = add({ kind: "arrow", x: 0, y: 0, w: 10, h: 10, pts: [0, 0, 10, 10], src: h.id, dst: "" });
    const y = add({ kind: "arrow", x: 0, y: 0, w: 10, h: 10, pts: [0, 0, 10, 10], src: x.id, dst: "" });
    x.dst = y.id; // a cycle forced in behind the guards
    const out = rerouteBound(ed.scene, new Set([a.id]));
    expect(out.map((r) => r.id)[0]).toBe(h.id);
    expect(out.length).toBeLessThanOrEqual(3);
  });
  it("saves, loads, and frees a cyclic or too-deep binding on load", () => {
    const { h } = host();
    const br = branch(h);
    const scene = ed.scene.toJSON();
    const ok = parseArch(serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene }));
    expect(ok.ok && ok.value.scene.els.find((e) => e.id === br.id)).toMatchObject({ src: h.id });
    expect(ok.ok && ok.value.scene.els.find((e) => e.id === br.id)!.st).toBeCloseTo(0.5, 2);
    const cyc = { ...scene, els: scene.els.map((e) => (e.id === h.id ? { ...e, src: br.id } : e)) };
    const bad = parseArch(serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: cyc }));
    expect(bad.ok).toBe(true);
    if (bad.ok) { const e = bad.value.scene.els.filter((x) => x.kind === "arrow"); expect(e.some((x) => x.src === "" || x.dst === "" || x.src === h.id)).toBe(true); expect(bad.warnings.join(" ")).toMatch(/cleared/); }
  });
  it("exports a branch end to Excalidraw as a free end", () => {
    const { h } = host();
    const br = branch(h);
    const ex = toExcalidraw(ed.scene.toJSON());
    const e = (ex.elements as Record<string, unknown>[]).find((x) => x.id === br.id)!;
    expect(e.startBinding).toBeNull();
  });
});
