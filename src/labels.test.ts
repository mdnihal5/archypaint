import { describe, expect, it } from "vitest";
import { MAX_LABELS, arrowLabels, cleanLabels, isCurve, migrateArrowText, nearestT, pointAtT, rerouteBound, sceneRectOf } from "./connectors";
import { GroupIndex } from "./groups";
import { History } from "./history";
import { parseArch, serializeArch, validateFile, FORMAT_VERSION } from "./io/format";
import { buildSvg } from "./io/svg";
import { el } from "./io/testkit";
import { Scene } from "./scene";
import { LIGHT } from "./theme";

const at = (pts: number[], t: number, curve = false): [number, number] => { const o: [number, number] = [0, 0]; pointAtT(pts, curve, t, o); return o; };

describe("positions along a connector path", () => {
  const L = [0, 0, 100, 0, 100, 100]; // two legs of 100: total length 200
  it("pointAtT walks the path by length", () => {
    expect(at(L, 0)).toEqual([0, 0]);
    expect(at(L, 0.25)).toEqual([50, 0]);
    expect(at(L, 0.5)).toEqual([100, 0]);
    expect(at(L, 0.75)).toEqual([100, 50]);
    expect(at(L, 1)).toEqual([100, 100]);
  });
  it("clamps t, and a zero-length path yields its start", () => {
    expect(at(L, -3)).toEqual([0, 0]); expect(at(L, 9)).toEqual([100, 100]);
    expect(at([5, 5, 5, 5], 0.5)).toEqual([5, 5]);
  });
  it("nearestT inverts pointAtT, also for points off the line", () => {
    for (const t of [0, 0.1, 0.5, 0.9, 1]) { const [x, y] = at(L, t); expect(nearestT(L, false, x, y)).toBeCloseTo(t, 6); }
    expect(nearestT(L, false, 50, 30)).toBeCloseTo(0.25, 6);
    expect(nearestT(L, false, 130, 80)).toBeCloseTo(0.9, 6);
    expect(nearestT([5, 5, 5, 5], false, 9, 9)).toBe(0.5);
  });
  it("a bezier is walked along the real curve (its midpoint, not the control polygon's)", () => {
    const C = [0, 0, 0, 100, 100, 100, 100, 0]; // symmetric arch
    const [x, y] = at(C, 0.5, true);
    expect(x).toBeCloseTo(50, 0); expect(y).toBeCloseTo(75, 0);
    expect(nearestT(C, true, x, y)).toBeCloseTo(0.5, 1);
    expect(isCurve({ route: 2, edge: 1, pts: C })).toBe(true);
    expect(isCurve({ route: 1, edge: 1, pts: C })).toBe(false);
  });
});

describe("label data", () => {
  it("arrowLabels reads a legacy centred text as one label at 0.5, and prefers real labels", () => {
    expect(arrowLabels({ text: "", labels: undefined })).toEqual([]);
    expect(arrowLabels({ text: "x", labels: undefined })).toEqual([{ t: 0.5, text: "x" }]);
    expect(arrowLabels({ text: "x", labels: [{ t: 0.1, text: "a" }] })).toEqual([{ t: 0.1, text: "a" }]);
  });
  it("cleanLabels drops junk, clamps t, bounds text and count", () => {
    expect(cleanLabels(undefined)).toEqual([]);
    expect(cleanLabels([null, 3, { t: 2, text: "a" }, { t: "x", text: "b" }, { t: 0.3 }, { t: -1, text: "" }, { t: NaN, text: "c" }])).toEqual([{ t: 1, text: "a" }, { t: 0.5, text: "b" }, { t: 0.5, text: "c" }]);
    expect(cleanLabels(Array.from({ length: 50 }, () => ({ t: 0.5, text: "z" })))).toHaveLength(MAX_LABELS);
    expect(cleanLabels([{ t: 0, text: "y".repeat(5000) }])[0]!.text.length).toBe(200);
  });
  it("migrateArrowText moves text into one label, leaves other kinds and existing labels alone", () => {
    const a = migrateArrowText({ kind: "arrow", text: "api", labels: undefined as { t: number; text: string }[] | undefined });
    expect(a).toEqual({ kind: "arrow", text: "", labels: [{ t: 0.5, text: "api" }] });
    const r = migrateArrowText({ kind: "rect", text: "keep", labels: undefined as { t: number; text: string }[] | undefined });
    expect(r.text).toBe("keep"); expect(r.labels).toBeUndefined();
    const b = migrateArrowText({ kind: "arrow", text: "stale", labels: [{ t: 0.2, text: "real" }] });
    expect(b.labels).toEqual([{ t: 0.2, text: "real" }]); expect(b.text).toBe("");
  });
  it("history sees an added, removed or edited label (and nothing when untouched)", () => {
    const s = new Scene();
    const a = s.add({ kind: "arrow", x: 0, y: 0, w: 100, h: 0, pts: [0, 0, 100, 0] });
    const h = new History(s);
    h.begin(); h.touch(a); expect(h.commit("noop")).toBe(false);
    h.begin(); h.touch(a); s.patch(a, { labels: [{ t: 0.3, text: "x" }] }); expect(h.commit("add")).toBe(true);
    h.begin(); h.touch(a); a.labels![0]!.t = 0.6; expect(h.commit("slide")).toBe(true);
    h.undo(); expect(a.labels![0]!.t).toBe(0.3);
    h.undo(); expect(a.labels).toBeUndefined();
  });
});

describe("groups as connection targets", () => {
  const mk = () => {
    const s = new Scene();
    const a = s.add({ kind: "rect", x: 100, y: 100, w: 100, h: 60, groupIds: ["g"] }), b = s.add({ kind: "rect", x: 300, y: 100, w: 100, h: 60, groupIds: ["g"] });
    s.groups.set("g", { id: "g", name: "backend", cat: 0, collapsed: false, locked: false });
    const gi = new GroupIndex(s);
    s.groupRect = (id) => gi.bounds(id);
    const free = s.add({ kind: "rect", x: 100, y: 400, w: 100, h: 60 });
    const arrow = s.add({ kind: "arrow", src: free.id, dst: "g", sp: 0, dp: 2, route: 0, pts: [150, 400, 250, 172], x: 150, y: 172, w: 100, h: 228 });
    return { s, gi, a, b, free, arrow };
  };
  it("sceneRectOf resolves a group id to its padded bounds; arrows and unknown ids to nothing", () => {
    const { s, gi, arrow } = mk();
    expect(sceneRectOf(s)("g")).toEqual(gi.bounds("g"));
    expect(sceneRectOf(s)(arrow.id)).toBeNull(); expect(sceneRectOf(s)("nope")).toBeNull();
  });
  it("rerouteBound follows a group when one of its members moves, and not otherwise", () => {
    const { s, a, free, arrow } = mk();
    expect(rerouteBound(s, new Set([free.id])).map((r) => r.id)).toEqual([arrow.id]);
    s.set(a, 100, 300); // the group grows downwards
    const [r] = rerouteBound(s, new Set([a.id]));
    expect(r!.id).toBe(arrow.id);
    const bottom = s.groupRect!("g")!;
    expect(r!.pts.slice(-2)).toEqual([bottom.x + bottom.w / 2, bottom.y + bottom.h]);
    const loose = s.add({ kind: "rect", x: 900, y: 900, w: 10, h: 10 });
    expect(rerouteBound(s, new Set([loose.id]))).toEqual([]);
  });
  it("hitBoundary: inside the padded box or on the name tag; smallest box wins; entered groups and outside points miss", () => {
    const { gi } = mk();
    const none = new Set<string>();
    expect(gi.hitBoundary(250, 130, none)).toBe("g"); // empty space between the members
    expect(gi.hitBoundary(110, 120, none)).toBe("g");
    expect(gi.hitBoundary(600, 600, none)).toBeUndefined();
    expect(gi.hitBoundary(250, 130, new Set(["g"]))).toBeUndefined();
    const tag = gi.tagBox("g")!;
    expect(gi.hitBoundary(tag.x + 4, tag.y + 6, none)).toBe("g"); // above the box, on the tag
    expect(gi.tagAt(tag.x + 4, tag.y + 6)).toBe("g");
    expect(gi.tagAt(250, 130)).toBeUndefined();
  });
  it("nested boxes: the inner group's space selects the outer (topmost) group", () => {
    const s = new Scene();
    s.add({ kind: "rect", x: 0, y: 0, w: 40, h: 40, groupIds: ["in", "out"] }); s.add({ kind: "rect", x: 100, y: 0, w: 40, h: 40, groupIds: ["in", "out"] });
    s.add({ kind: "rect", x: 400, y: 0, w: 40, h: 40, groupIds: ["out"] });
    for (const g of ["in", "out"]) s.groups.set(g, { id: g, name: "", cat: 0, collapsed: false, locked: false });
    const gi = new GroupIndex(s);
    expect(gi.hitBoundary(70, 20, new Set())).toBe("out");
    expect(gi.hitBoundary(70, 20, new Set(["out"]))).toBe("in");
  });
});

describe("file format 2", () => {
  const v1 = (els: unknown[]) => JSON.stringify({ app: "archypaint", version: 1, scene: { els, groups: [] } });
  const arrow = { id: "a1", kind: "arrow", x: 0, y: 0, w: 100, h: 0, pts: [0, 0, 100, 0], text: "old label" };
  it("a version-1 file loads: an arrow's single text becomes one label at 0.5", () => {
    const r = parseArch(v1([arrow, { id: "r1", kind: "rect", x: 0, y: 0, w: 5, h: 5, text: "box" }]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(FORMAT_VERSION); expect(FORMAT_VERSION).toBe(2);
    const [a, b] = r.value.scene.els;
    expect(a).toMatchObject({ text: "", labels: [{ t: 0.5, text: "old label" }] });
    expect(b).toMatchObject({ text: "box" }); expect(b!.labels).toBeUndefined();
  });
  it("labels and fs round-trip and serialise deterministically; absent when unused", () => {
    const withLabels = el({ id: "a1", kind: "arrow", pts: [0, 0, 100, 0], labels: [{ t: 0.123456, text: "a" }, { t: 0.9, text: "b" }], fs: 18 });
    const plain = el({ id: "r1", z: 2 });
    const text = serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: { els: [withLabels, plain], groups: [] } });
    expect(text).toContain('"labels":[{"t":0.123,"text":"a"},{"t":0.9,"text":"b"}]');
    expect(text.split('"fs"').length - 1).toBe(1);
    const back = parseArch(text);
    expect(back.ok && back.value.scene.els[0]).toMatchObject({ labels: [{ t: 0.123, text: "a" }, { t: 0.9, text: "b" }], fs: 18 });
    expect(back.ok && back.value.scene.els[1]!.fs).toBeUndefined();
  });
  it("hostile label / fs data is repaired or rejected, never crashes", () => {
    const r = parseArch(v1([{ ...arrow, text: "", labels: [{ t: 7, text: "ok" }, "junk", { text: 3 }], fs: 12 }]));
    expect(r.ok && r.value.scene.els[0]!.labels).toEqual([{ t: 1, text: "ok" }]);
    expect(parseArch(v1([{ ...arrow, fs: "big" }])).ok).toBe(false);
  });
  it("a connector may bind to a group id; a binding to nothing is still cleared", () => {
    const f = JSON.stringify({ app: "archypaint", version: 2, scene: { groups: [{ id: "g1", name: "x" }], els: [
      { id: "r1", kind: "rect", x: 0, y: 0, w: 5, h: 5, groupIds: ["g1"] },
      { ...arrow, src: "g1", dst: "nowhere" }] } });
    const r = validateFile(JSON.parse(f));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scene.els[1]).toMatchObject({ src: "g1", dst: "" });
    expect(r.warnings.join()).toContain("dangling");
  });
  it("a future version is still refused", () => {
    expect(validateFile({ app: "archypaint", version: FORMAT_VERSION + 1, scene: { els: [], groups: [] } }).ok).toBe(false);
  });
});

describe("SVG export geometry", () => {
  const svg = (els: Parameters<typeof buildSvg>[0]) => buildSvg(els, LIGHT, { background: false, padding: 0, icons: () => null });
  it("an icon's tile excludes the name strip and the name sits inside the box under it (same as the canvas)", () => {
    const out = svg([el({ id: "i1", kind: "icon", iconId: "cache", x: 10, y: 20, w: 48, h: 66, text: "Redis" })]);
    expect(out).toContain('<rect x="10" y="20" width="48" height="48"'); // tile = min(w, h - 18)
    expect(out).toContain('y="'); expect(out).toContain(">Redis<");
    const bare = svg([el({ id: "i2", kind: "icon", iconId: "cache", x: 10, y: 20, w: 48, h: 48 })]);
    expect(bare).toContain('width="48" height="48"');
  });
  it("a curve connector exports its real cubic, and labels sit on it", () => {
    const out = svg([el({ id: "c1", kind: "arrow", route: 2, pts: [0, 0, 0, 100, 100, 100, 100, 0], labels: [{ t: 0.5, text: "mid" }] })]);
    expect(out).toContain("M0 0C0 100 100 100 100 0");
    expect(out).toMatch(/<tspan x="50" y="[\d.]+">mid<\/tspan>/);
  });
  it("font size reaches shape, text, frame and connector labels", () => {
    const out = svg([el({ id: "r", text: "a", fs: 20 }), el({ id: "t", kind: "text", text: "b", fs: 20, z: 2 })]);
    expect(out.match(/font-size="20"/g)).toHaveLength(2);
  });
});
