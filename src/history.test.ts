import { describe, expect, it } from "vitest";
import { History } from "./history";
import { Scene } from "./scene";

function setup() { const scene = new Scene(); const h = new History(scene); return { scene, h }; }
const ids = (s: Scene) => [...s.els.keys()].sort();

describe("history", () => {
  it("create -> undo -> redo restores exactly (incl. arrays, groups)", () => {
    const { scene, h } = setup();
    h.begin();
    const a = scene.add({ kind: "rect", x: 10, y: 20, groupIds: ["g1"] }); h.created(a);
    const b = scene.add({ kind: "arrow", src: a.id, pts: [1, 2, 3, 4] }); h.created(b);
    h.touchGroup("g1"); scene.groups.set("g1", { id: "g1", name: "edge", cat: 1, collapsed: false, locked: false });
    expect(h.commit("create")).toBe(true);
    const before = JSON.stringify(scene.toJSON());
    h.undo();
    expect(scene.els.size).toBe(0); expect(scene.groups.size).toBe(0);
    h.redo();
    expect(JSON.stringify(scene.toJSON())).toBe(before);
  });
  it("modify and delete are patches of only the touched elements", () => {
    const { scene, h } = setup();
    const a = scene.add({ kind: "rect", x: 0, y: 0 }), b = scene.add({ kind: "rect", x: 5, y: 5 });
    for (let i = 0; i < 100; i++) scene.add({ kind: "rect" });
    h.begin(); h.touch(a); scene.set(a, 50, 60); h.touch(b); scene.remove(b);
    h.commit("edit");
    expect(scene.els.has(b.id)).toBe(false);
    h.undo();
    expect(scene.els.get(a.id)!.x).toBe(0); expect(scene.els.get(b.id)!.x).toBe(5);
    h.redo();
    expect(scene.els.get(a.id)!.x).toBe(50); expect(scene.els.has(b.id)).toBe(false);
  });
  it("no-op transactions record nothing; a new commit clears redo", () => {
    const { scene, h } = setup();
    const a = scene.add({ kind: "rect" });
    h.begin(); h.touch(a); expect(h.commit("noop")).toBe(false);
    expect(h.canUndo()).toBe(false);
    h.begin(); h.touch(a); scene.set(a, 1, 1); h.commit("m1");
    h.undo(); expect(h.canRedo()).toBe(true);
    h.begin(); h.touch(a); scene.set(a, 2, 2); h.commit("m2");
    expect(h.canRedo()).toBe(false);
  });
  it("coalesces keyed steps into one entry keeping the first 'before'", () => {
    const { scene, h } = setup();
    const a = scene.add({ kind: "rect", x: 0 });
    for (let i = 1; i <= 5; i++) { h.begin(); h.touch(a); scene.set(a, i, 0); h.commit("nudge", "nudge"); }
    h.undo();
    expect(scene.els.get(a.id)!.x).toBe(0);
    expect(h.canUndo()).toBe(false);
  });
  it("memory is capped by stored snapshots, not only by step count (big multi-element steps)", () => {
    const { scene, h } = setup(); h.maxSnapshots = 2_000;
    const els = Array.from({ length: 300 }, (_, i) => scene.add({ kind: "rect", x: i }));
    for (let step = 1; step <= 30; step++) { h.begin(); for (const e of els) { h.touch(e); scene.set(e, e.x + 1, 0); } h.commit("move-all"); }
    expect(h.snapshots()).toBeLessThanOrEqual(2_000); // 30 steps x 600 snapshots would be 18,000
    let n = 0; while (h.undo()) n++;
    expect(n).toBe(3); // only the newest steps that fit survive
    expect(h.snapshots()).toBeLessThanOrEqual(2_000); // undo moves entries to redo; the total is unchanged
    h.begin(); h.touch(els[0]); scene.set(els[0]!, 999, 0); h.commit("x"); // a new commit drops redo, and its weight
    expect(h.snapshots()).toBe(2);
  });
  it("the newest step is kept even when it alone exceeds the snapshot cap", () => {
    const { scene, h } = setup(); h.maxSnapshots = 10;
    const els = Array.from({ length: 50 }, () => scene.add({ kind: "rect" }));
    h.begin(); for (const e of els) { h.touch(e); scene.set(e, 5, 5); } h.commit("big");
    expect(h.canUndo()).toBe(true);
  });
  it("depth is capped", () => {
    const { scene, h } = setup(); h.cap = 10;
    const a = scene.add({ kind: "rect" });
    for (let i = 1; i <= 50; i++) { h.begin(); h.touch(a); scene.set(a, i, 0); h.commit("m"); }
    let n = 0; while (h.undo()) n++;
    expect(n).toBe(10);
  });
  it("abort rolls back an open transaction incl. created elements", () => {
    const { scene, h } = setup();
    const a = scene.add({ kind: "rect", x: 3 });
    h.begin(); h.touch(a); scene.set(a, 99, 99); const c = scene.add({ kind: "rect" }); h.created(c);
    h.abort();
    expect(scene.els.get(a.id)!.x).toBe(3); expect(ids(scene)).toEqual([a.id]);
    expect(h.canUndo()).toBe(false);
  });
  it("200 undo/redo cycles leave the scene identical and the grid consistent", () => {
    const { scene, h } = setup();
    const a = scene.add({ kind: "rect", x: 0, y: 0, w: 50, h: 50 });
    for (let i = 1; i <= 30; i++) { h.begin(); h.touch(a); scene.set(a, i * 40, i * 25); const n = scene.add({ kind: "rect", x: i * 9 }); h.created(n); h.commit("s"); }
    const norm = () => JSON.stringify(scene.toJSON(), (k, v) => (k === "version" ? undefined : v));
    const final = norm();
    for (let c = 0; c < 200; c++) { for (let i = 0; i < 30; i++) h.undo(); for (let i = 0; i < 30; i++) h.redo(); }
    expect(norm()).toBe(final);
    const out: unknown[] = [];
    scene.query(-1e6, -1e6, 1e6, 1e6, out as never[]);
    expect(out.length).toBe(scene.els.size);
  }, 30_000); // the final query spans ~6e7 grid cells on purpose; under CPU contention it can exceed the 5 s default
});
