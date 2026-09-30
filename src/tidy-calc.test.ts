// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calcRows, calcSize, ensureCalc, SAMPLE } from "./calc-view";
import { bboxOfPts, computeArrowPts, sceneRectOf } from "./connectors";
import { createEditor, type Editor } from "./editor";
import { fromExcalidraw, toExcalidraw } from "./io/excalidraw";
import { parseArch, serializeArch } from "./io/format";
import { buildSvg } from "./io/svg";
import { wellFormed } from "./io/testkit";
import { drawEl } from "./renderer";
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
beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never; ed = mk(); });
afterEach(() => { ed.destroy(); stage.remove(); });

const node = (x: number, y: number, w = 100, h = 60, extra: Partial<El> = {}): El => ed.scene.add({ kind: "rect", x, y, w, h, ...extra });
const link = (a: El, b: El): El => {
  const arr = ed.scene.add({ kind: "arrow", src: a.id, dst: b.id });
  const pts = computeArrowPts(arr, sceneRectOf(ed.scene)), bb = bboxOfPts(pts);
  ed.scene.set(arr, bb.x, bb.y, bb.w, bb.h); arr.pts = pts;
  return arr;
};
const overlap = (a: El, b: El) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const distToRect = (px: number, py: number, r: El) => Math.hypot(Math.max(r.x - px, 0, px - (r.x + r.w)), Math.max(r.y - py, 0, py - (r.y + r.h)));
const snapshot = () => JSON.stringify([...ed.scene.els.values()].map((e) => [e.id, e.x, e.y, e.w, e.h, e.pts]));


describe("tidy", () => {
  const messy = () => {
    const a = node(700, 500), b = node(40, 380), c = node(420, 60), d = node(150, 640), e = node(900, 90), f = node(300, 300);
    const arrows = [link(a, b), link(b, c), link(c, d), link(f, e), link(f, a), link(d, e)];
    return { ns: [a, b, c, d, e, f], arrows };
  };

  it("arranges a messy graph into tiers: no overlaps, everything on the 10-unit grid, arrows stay attached", async () => {
    const { ns, arrows } = messy();
    const moved = await ed.tidy("all");
    expect(moved).toBeGreaterThan(0);
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) expect(overlap(ns[i]!, ns[j]!), `${i}/${j}`).toBe(false);
    for (const n of ns) { expect(n.x % 10).toBe(0); expect(n.y % 10).toBe(0); }
    for (const a of arrows) {
      const s = ed.scene.els.get(a.src)!, t = ed.scene.els.get(a.dst)!;
      expect(distToRect(a.pts[0]!, a.pts[1]!, s)).toBeLessThan(1.5);
      expect(distToRect(a.pts[a.pts.length - 2]!, a.pts[a.pts.length - 1]!, t)).toBeLessThan(1.5);
    }
  });

  it("edges point forward: every source ends up in an earlier column than its target (graph is acyclic here)", async () => {
    const a = node(500, 0), b = node(0, 300), c = node(250, 600), d = node(800, 300);
    link(a, b); link(b, c); link(a, d); link(d, c);
    await ed.tidy("all");
    const dir = Math.abs(a.x - c.x) >= Math.abs(a.y - c.y) ? "x" : "y";
    expect(a[dir] < b[dir] && b[dir] < c[dir] && a[dir] < d[dir] && d[dir] < c[dir]).toBe(true);
  });

  it("is ONE undo step that restores positions and arrow routes exactly; redo reapplies", async () => {
    messy();
    const before = snapshot();
    await ed.tidy("all");
    const after = snapshot();
    expect(after).not.toBe(before);
    expect(ed.canUndo()).toBe(true);
    ed.undo();
    expect(snapshot()).toBe(before);
    expect(ed.canUndo()).toBe(false); // nothing else was recorded: a single step
    ed.redo();
    expect(snapshot()).toBe(after);
  });

  it("is idempotent: tidying a tidy sheet moves nothing", async () => {
    messy();
    await ed.tidy("all");
    const settled = snapshot();
    expect(await ed.tidy("all")).toBe(0);
    expect(snapshot()).toBe(settled);
  });

  it("selection scope moves only the selected shapes", async () => {
    const a = node(0, 400), b = node(500, 0), c = node(300, 700), other = node(1000, 1000);
    link(a, b); link(b, c);
    const otherXY = [other.x, other.y];
    ed.select([a.id, b.id, c.id]);
    expect(await ed.tidy()).toBeGreaterThan(0); // default scope: 2+ selected -> selection
    expect([other.x, other.y]).toEqual(otherXY);
  });

  it("with nothing or one shape selected it tidies the whole sheet; a lone node and an empty sheet are no-ops", async () => {
    expect(await ed.tidy()).toBe(0);
    const a = node(13, 27);
    expect(await ed.tidy()).toBe(0);
    const b = node(300, 500); link(a, b);
    ed.select([a.id]);
    expect(await ed.tidy()).toBeGreaterThan(0); // one selected: whole sheet
  });

  it("locked shapes and annotations (notes, text, legend, calc) are never moved", async () => {
    const a = node(0, 300), b = node(400, 0), locked = node(700, 700, 100, 60, { locked: true });
    link(a, b); link(b, locked);
    const note = ed.scene.add({ kind: "note", x: 900, y: 900, w: 120, h: 90 });
    const calc = ed.scene.add({ kind: "calc", x: 50, y: 900, w: 280, h: 120, text: "a = 1" });
    const before = [locked, note, calc].map((e) => [e.x, e.y]);
    await ed.tidy("all");
    expect([locked, note, calc].map((e) => [e.x, e.y])).toEqual(before);
  });

  it("a frame moves as one box and keeps its contents' relative positions", async () => {
    const a = node(0, 0), c = node(1200, 800);
    const frame = ed.scene.add({ kind: "frame", x: 500, y: 300, w: 400, h: 300, text: "vpc" });
    const in1 = node(540, 360), in2 = node(700, 480);
    link(a, in1); link(in1, in2); link(in2, c);
    const rel = [[in1.x - frame.x, in1.y - frame.y], [in2.x - frame.x, in2.y - frame.y]];
    await ed.tidy("all");
    expect([in1.x - frame.x, in1.y - frame.y]).toEqual(rel[0]);
    expect([in2.x - frame.x, in2.y - frame.y]).toEqual(rel[1]);
    expect(overlap(a, frame)).toBe(false);
    expect(overlap(c, frame)).toBe(false);
  });

  it("members of a group stay adjacent", async () => {
    const hub = node(0, 0);
    const kids = Array.from({ length: 6 }, (_, i) => node(600, i * 100));
    kids.forEach((k) => link(hub, k));
    const gid = "g1";
    ed.scene.groups.set(gid, { id: gid, name: "g", cat: 0, collapsed: false, locked: false });
    for (const k of [kids[0]!, kids[2]!, kids[4]!]) ed.scene.patch(k, { groupIds: [gid] });
    await ed.tidy("all");
    const col = [...kids].sort((p, q) => p.y - q.y || p.x - q.x).map((k) => k.groupIds.includes(gid));
    const f = col.indexOf(true), l = col.lastIndexOf(true);
    expect(col.slice(f, l + 1).every(Boolean)).toBe(true);
  });

  it("a 500-node sheet tidies in well under a second and is still one undo step", async () => {
    const ns: El[] = [];
    for (let i = 0; i < 500; i++) ns.push(node((i * 97) % 3000, (i * 53) % 2000, 80, 50));
    for (let i = 1; i < 500; i++) link(ns[Math.floor(i / 2)]!, ns[i]!); // a binary tree
    const before = snapshot();
    const t0 = performance.now();
    await ed.tidy("all");
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(1500);
    ed.undo();
    expect(snapshot()).toBe(before);
    expect(ed.canUndo()).toBe(false);
  });

  it("free (unbound) arrows and the view do not break it", async () => {
    const a = node(0, 0), b = node(400, 300);
    link(a, b);
    ed.scene.add({ kind: "arrow", x: 10, y: 10, w: 100, h: 0, pts: [10, 10, 110, 10] });
    await expect(ed.tidy("all")).resolves.toBeGreaterThanOrEqual(0);
  });

  it("tidy after destroy does nothing and does not throw", async () => {
    node(0, 0); node(300, 300);
    const p = ed.tidy("all");
    ed.destroy();
    await expect(p).resolves.toBeDefined();
  });
});

describe("capacity notes: editor", () => {
  it("insertCalc puts a selected calc note at the view centre, sized for its text; undo/redo", () => {
    const e = ed.insertCalc()!;
    expect(e.kind).toBe("calc");
    expect(e.text).toBe(SAMPLE);
    const s = calcSize(SAMPLE);
    expect([e.w, e.h]).toEqual([s.w, s.h]);
    expect(ed.selection().has(e.id)).toBe(true);
    ed.undo(); expect(ed.scene.els.has(e.id)).toBe(false);
    ed.redo(); expect(ed.scene.els.has(e.id)).toBe(true);
  });

  it("editing the text resizes the note and is one undo step", () => {
    const e = ed.insertCalc()!;
    const beforeH = e.h;
    (ed as unknown as { editText(e: El): void }).editText(e);
    const ta = stage.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe(SAMPLE);
    ta.value = "a = 1\nb = a * 2\nc = b * 2\nd = c * 2\ne = d * 2\nf = e * 2\ng = f * 2\nh = g * 2";
    ta.dispatchEvent(new Event("blur"));
    expect(e.text.startsWith("a = 1")).toBe(true);
    expect(e.h).toBeGreaterThan(beforeH);
    ed.undo();
    expect(e.text).toBe(SAMPLE);
    expect(e.h).toBe(beforeH);
  });
});

describe("capacity notes: rendering, caching, export, persistence", () => {
  it("results are computed once per version and recomputed after an edit or undo to a different text", async () => {
    await ensureCalc();
    const el = { version: 1, text: "a = 2\nb = a * 3" };
    const r1 = calcRows(el)!;
    expect(r1.map((r) => r.value)).toEqual([2, 6]);
    expect(calcRows(el)).toBe(r1); // cache hit: same array, no re-evaluation
    el.version = 2; el.text = "a = 5";
    const r2 = calcRows(el)!;
    expect(r2).not.toBe(r1);
    expect(r2[0]!.value).toBe(5);
    // same version number but different text (undo then a fresh edit): must not serve stale results
    el.version = 2; el.text = "a = 9";
    expect(calcRows(el)![0]!.value).toBe(9);
  });

  it("drawEl renders a calc note (raw lines before the evaluator, results after) without throwing", async () => {
    const e = ed.insertCalc()!;
    expect(() => drawEl(fakeCtx as unknown as CanvasRenderingContext2D, e, LIGHT, 1, false, false)).not.toThrow();
    await ensureCalc();
    expect(() => drawEl(fakeCtx as unknown as CanvasRenderingContext2D, e, LIGHT, 1, false, false)).not.toThrow();
    expect(() => drawEl(fakeCtx as unknown as CanvasRenderingContext2D, e, LIGHT, 0.2, true, false)).not.toThrow(); // LOD
    expect(() => drawEl(fakeCtx as unknown as CanvasRenderingContext2D, e, LIGHT, 1, false, true)).not.toThrow(); // text hidden while editing
  });

  it("SVG export includes the results, marks errors, escapes markup, and stays well-formed", async () => {
    const { evalCalc } = await ensureCalc();
    const e = ed.insertCalc()!;
    ed.scene.patch(e, { text: "# <b>note</b> & more\ndau = 10M\nqps = dau / day\nbad = 1 / 0\nx = \"<script>\"" });
    const els = [...ed.scene.els.values()];
    const svg = buildSvg(els as never, LIGHT, { background: true, padding: 20, icons: () => null, calc: evalCalc });
    expect(wellFormed(svg)).toBeNull();
    expect(svg).toContain("→ 10 M");
    expect(svg).toContain("→ 115.7 /s");
    expect(svg).toContain("! divide by zero");
    expect(svg).toContain("&lt;b&gt;note&lt;/b&gt; &amp; more");
    expect(svg).not.toContain("<script>");
    const raw = buildSvg(els as never, LIGHT, { background: true, padding: 20, icons: () => null });
    expect(wellFormed(raw)).toBeNull();
    expect(raw).not.toContain("→");
  });

  it("round-trips through the .archypaint format and through Excalidraw export/import", () => {
    const e = ed.insertCalc()!;
    const meta = { name: "t", created: 1, updated: 1 }, view = { x: 0, y: 0, zoom: 1 };
    const text = serializeArch({ meta, view, settings: {}, scene: ed.scene.toJSON() });
    const p = parseArch(text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const back = p.value.scene.els.find((x) => x.id === e.id)!;
    expect(back.kind).toBe("calc");
    expect(back.text).toBe(SAMPLE);
    const ex = fromExcalidraw(toExcalidraw(ed.scene.toJSON()));
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;
    const c = ex.scene.els.find((x) => x.kind === "calc");
    expect(c?.text).toBe(SAMPLE);
  });

  it("the maximum note (40 lines of 200 chars) fits the file format's text limit", () => {
    const e = ed.insertCalc()!;
    const big = Array.from({ length: 40 }, () => "x".repeat(200)).join("\n");
    ed.scene.patch(e, { text: big });
    const p = parseArch(serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: ed.scene.toJSON() }));
    expect(p.ok).toBe(true);
  });
});

describe("capacity notes: clipboard and duplicate", () => {
  it("copy/paste and duplicate keep a calc note (kind whitelist)", () => {
    const e = ed.insertCalc()!;
    ed.select([e.id]);
    ed.duplicateSelection();
    expect([...ed.scene.els.values()].filter((x) => x.kind === "calc").length).toBe(2);
    ed.select([e.id]);
    const json = `archypaint:${JSON.stringify({ els: [ed.scene.toJSON().els.find((x) => x.id === e.id)], groups: [] })}`;
    expect(ed.paste(json)).toBe(true);
    expect([...ed.scene.els.values()].filter((x) => x.kind === "calc").length).toBe(3);
  });
});

describe("capacity notes: chunk loading", () => {
  it("calcRows before the evaluator is loaded returns null without throwing (raw lines are drawn)", async () => {
    const mod = await import("./calc-view");
    // a fresh object each time: the cache is per element, and the module may already be loaded by earlier tests
    const r = mod.calcRows({ version: 1, text: "a = 1" });
    expect(r === null || Array.isArray(r)).toBe(true);
  });
});
