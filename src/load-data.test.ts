// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { cleanLoad, parseArch, serializeArch } from "./io/format";
import { el } from "./io/testkit";
import { ACTIONS } from "./features";
import { documentText } from "./share";
import { LIGHT } from "./theme";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
let stage: HTMLDivElement;
let ed: Editor;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div");
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  ed.renderer.resize(1200, 800, 1);
});
afterEach(() => { ed.destroy(); stage.remove(); });

describe("cleanLoad: hostile input", () => {
  const N = false, A = true;
  it("rejects non-objects and empties", () => {
    for (const v of [null, undefined, 1, "x", [], [1], true, {}, { junk: 1 }]) expect(cleanLoad(v, N)).toBeUndefined();
  });
  it("drops wrong types, NaN, Infinity and unknown keys; keeps the good keys", () => {
    expect(cleanLoad({ cap: "5", rate: NaN, ms: Infinity, hit: -Infinity, depth: null, rep: {}, evil: 1, __proto__: { x: 1 }, role: "service" }, N)).toEqual({ role: "service" });
  });
  it("clamps ranges", () => {
    expect(cleanLoad({ cap: 1e12, rate: -5, limit: 2e9, burst: -1, depth: 1e10, ms: 1e9, hit: 500, rep: 0, retries: 99 }, N))
      .toEqual({ cap: 1e9, rate: 0, limit: 1e9, burst: 0, depth: 1e9, ms: 6e4, hit: 100, rep: 1, retries: 5 });
    expect(cleanLoad({ rep: 99999 }, N)).toEqual({ rep: 1000 });
    expect(cleanLoad({ rep: 2.6, retries: 1.4 }, N)).toEqual({ rep: 3, retries: 1 });
    expect(cleanLoad({ w: -1, x: 1000 }, A)).toEqual({ w: 0, x: 100 });
  });
  it("enums come from their sets", () => {
    expect(cleanLoad({ role: "admin" }, N)).toBeUndefined();
    expect(cleanLoad({ algo: "bucket" }, N)).toBeUndefined();
    expect(cleanLoad({ algo: "sliding", role: "limiter", backoff: 1 }, N)).toEqual({ algo: "sliding", role: "limiter", backoff: 1 });
    expect(cleanLoad({ backoff: 2 }, N)).toBeUndefined();
    expect(cleanLoad({ backoff: true }, N)).toBeUndefined();
  });
  it("arrow-only keys only on arrows, node-only keys only on nodes", () => {
    expect(cleanLoad({ w: 2, x: 3, cap: 10, role: "db" }, N)).toEqual({ cap: 10, role: "db" });
    expect(cleanLoad({ w: 2, x: 3, cap: 10, role: "db", spike: [2, 1, 1] }, A)).toEqual({ w: 2, x: 3 });
    expect(cleanLoad({ cap: 10 }, A)).toBeUndefined();
  });
  it("spike must be three finite numbers, then is clamped", () => {
    for (const s of [[1, 2], [1, 2, 3, 4], "abc", [1, "2", 3], [1, NaN, 3], [1, 2, Infinity], {}, null]) expect(cleanLoad({ spike: s }, N)).toBeUndefined();
    expect(cleanLoad({ spike: [500, -4, 0] }, N)).toEqual({ spike: [100, 0, 1] });
    expect(cleanLoad({ spike: [5, 10, 30] }, N)).toEqual({ spike: [5, 10, 30] });
  });
  it("does not alias the input spike", () => {
    const s = [5, 10, 30]; const r = cleanLoad({ spike: s }, N)!; s[0] = 9; expect(r.spike).toEqual([5, 10, 30]);
  });
});

describe("file format", () => {
  const meta = { meta: { name: "d", created: 1, updated: 2 }, view: { x: 0, y: 0, zoom: 1 }, settings: {} };
  const file = (els: ReturnType<typeof el>[]) => ({ ...meta, scene: { els, groups: [] } });
  it("save -> load round-trips load on nodes and arrows", () => {
    const els = [el({ id: "a", z: 1, load: { role: "entry", rate: 100, spike: [3, 10, 20], retries: 2, backoff: 1 } }), el({ id: "b", z: 2, kind: "arrow", src: "a", dst: "a", pts: [0, 0, 5, 5], load: { w: 2, x: 3 } })];
    const text = serializeArch(file(els));
    const p = parseArch(text);
    expect(p.ok).toBe(true); if (!p.ok) return;
    expect(p.value.scene.els).toEqual(els);
    expect(serializeArch({ ...p.value })).toBe(text);
  });
  it("an old file without load loads unchanged, and serialises without the key", () => {
    const text = serializeArch(file([el({ id: "a", z: 1 })]));
    expect(text).not.toContain("load");
    const p = parseArch(text); expect(p.ok).toBe(true); if (!p.ok) return;
    expect(p.value.scene.els[0]!.load).toBeUndefined();
  });
  it("a hostile load in a file is cleaned, not rejected, and never lands in elExtra", () => {
    const raw = JSON.parse(serializeArch(file([el({ id: "a", z: 1 })])));
    raw.scene.els[0].load = { cap: 1e99, role: "x", sneaky: 1 };
    const p = parseArch(JSON.stringify(raw)); expect(p.ok).toBe(true); if (!p.ok) return;
    expect(p.value.scene.els[0]!.load).toEqual({ cap: 1e9 });
    expect(p.value.elExtra.a).toBeUndefined();
    raw.scene.els[0].load = "junk";
    const q = parseArch(JSON.stringify(raw)); expect(q.ok).toBe(true); if (!q.ok) return;
    expect(q.value.scene.els[0]!.load).toBeUndefined();
  });
  it("share links carry load (same JSON)", () => {
    ed.scene.add({ kind: "rect", load: { role: "db", cap: 50 } });
    expect(documentText(ed, "x")).toContain('"load":{"role":"db","cap":50}');
  });
});

describe("editor.setLoad", () => {
  const mk = (init: object = {}) => ed.scene.add({ kind: "rect", ...init } as never);
  it("merges, removes keys set to undefined, clears on null, cleans, in one undo step", () => {
    const a = mk(), b = mk();
    ed.setLoad([a.id, b.id], { role: "service", cap: 100 });
    expect(a.load).toEqual({ role: "service", cap: 100 }); expect(b.load).toEqual({ role: "service", cap: 100 });
    ed.setLoad([a.id], { cap: undefined, rep: 3 });
    expect(a.load).toEqual({ role: "service", rep: 3 });
    ed.setLoad([a.id], { cap: 1e20, w: 5 } as never);
    expect(a.load).toEqual({ role: "service", rep: 3, cap: 1e9 });
    ed.setLoad([a.id], null);
    expect(a.load).toBeUndefined();
    ed.setLoad([a.id], { cap: undefined, role: undefined, rep: undefined });
    expect(a.load).toBeUndefined();
  });
  it("one undo step for the whole call; undo/redo restore exactly, including the spike tuple", () => {
    const a = mk({ load: { cap: 5, spike: [2, 3, 4] } }), b = mk();
    const before = JSON.stringify(a.load);
    ed.setLoad([a.id, b.id], { cap: 9, spike: [7, 8, 9] });
    expect(a.load).toEqual({ cap: 9, spike: [7, 8, 9] }); expect(b.load).toEqual({ cap: 9, spike: [7, 8, 9] });
    ed.undo();
    expect(JSON.stringify(a.load)).toBe(before); expect(b.load).toBeUndefined();
    ed.redo();
    expect(a.load).toEqual({ cap: 9, spike: [7, 8, 9] }); expect(b.load).toEqual({ cap: 9, spike: [7, 8, 9] });
    ed.undo();
    expect(a.load!.spike).toEqual([2, 3, 4]);
  });
  it("a no-change call records no undo step", () => {
    const a = mk({ load: { cap: 5 } });
    ed.setLoad([a.id], { cap: 5 });
    ed.setLoad([a.id], null); ed.undo();
    expect(a.load).toEqual({ cap: 5 });
  });
  it("skips locked elements, unknown ids, and applies arrow-only keys only to arrows", () => {
    const a = mk({ locked: true }), b = mk();
    ed.setLoad([a.id, "nope", b.id], { cap: 3, w: 2 } as never);
    expect(a.load).toBeUndefined(); expect(b.load).toEqual({ cap: 3 });
  });
  it("is a no-op in read-only mode and emits change otherwise", () => {
    const a = mk();
    let n = 0; ed.on("change", () => n++);
    ed.setLoad([a.id], { cap: 3 }); expect(n).toBeGreaterThan(0);
    ed.setReadOnly(true);
    ed.setLoad([a.id], { cap: 4 }); ed.setLoad([a.id], null);
    expect(a.load).toEqual({ cap: 3 });
  });
  it("snapshots are deep: mutating a snapshot does not touch the element", () => {
    const a = mk({ load: { spike: [2, 3, 4] } });
    ed.scene.snapshot(a).load!.spike![0] = 99;
    expect(a.load!.spike![0]).toBe(2);
  });
  it("duplicate carries load (deep copy); copy/paste carries it too and cleans hostile pasted load", () => {
    const a = mk({ load: { role: "cache", hit: 90, spike: [2, 3, 4] } });
    ed.select([a.id]); ed.duplicateSelection();
    const d = [...ed.scene.els.values()].find((e) => e.id !== a.id)!;
    expect(d.load).toEqual(a.load); expect(d.load).not.toBe(a.load); expect(d.load!.spike).not.toBe(a.load!.spike);
    ed.select([a.id]);
    const txt = JSON.stringify({ els: [{ ...ed.scene.snapshot(a), load: { cap: 7, role: "wizard", hit: 1e9 } }], groups: [] });
    const before = ed.scene.els.size;
    expect(ed.paste(txt)).toBe(true);
    expect(ed.scene.els.size).toBe(before + 1);
    const pasted = [...ed.scene.els.values()].pop()!;
    expect(pasted.load).toEqual({ cap: 7, hit: 100 });
  });
});

describe("calc action: shortcut without a menu entry", () => {
  it("is hidden from the menu but keeps its C shortcut", () => {
    const calc = ACTIONS.find((a) => a.id === "calc")!;
    expect(calc.menu).toBe(false);
    expect(calc.key).toEqual({ key: "c" });
    expect(ACTIONS.filter((a) => a.menu !== false).some((a) => a.id === "calc")).toBe(false);
    expect(ACTIONS.filter((a) => a.id !== "calc").every((a) => a.menu !== false)).toBe(true);
  });
});
