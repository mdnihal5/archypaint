import { describe, expect, it } from "vitest";
import { exportGroups } from "../groups";
import { LIGHT } from "../theme";
import { boundsWithGroups, buildSvg } from "./svg";
import { el, wellFormed } from "./testkit";

const opts = { background: false, padding: 24, icons: () => null };
const tspans = (svg: string) => [...svg.matchAll(/<tspan x="([\d.-]+)" y="([\d.-]+)">([^<]*)<\/tspan>/g)].map((m) => ({ x: +m[1]!, y: +m[2]!, t: m[3]! }));

describe("SVG text wrapping", () => {
  it("wraps a long rect label to the box and keeps every word", () => {
    const svg = buildSvg([el({ id: "a", w: 100, h: 200, text: "alpha beta gamma delta epsilon zeta eta theta" })], LIGHT, opts);
    const ls = tspans(svg);
    expect(ls.length).toBeGreaterThan(2);
    expect(ls.map((l) => l.t).join(" ")).toBe("alpha beta gamma delta epsilon zeta eta theta");
    for (const l of ls) expect(l.t.length * 13 * 0.6).toBeLessThanOrEqual(84 + 1e-6);
    expect(wellFormed(svg)).toBeNull();
    expect(svg).not.toContain("clip-path"); // fits the box: nothing to clip
  });
  it("uses the supplied measure so export wraps exactly like the canvas", () => {
    const text = "alpha beta gamma";
    const narrow = tspans(buildSvg([el({ id: "a", w: 100, h: 200, text })], LIGHT, { ...opts, measure: (t) => t.length * 20 }));
    const wide = tspans(buildSvg([el({ id: "a", w: 100, h: 200, text })], LIGHT, { ...opts, measure: () => 1 }));
    expect(wide.length).toBe(1);
    expect(narrow.length).toBeGreaterThan(3);
    for (const l of narrow) expect(l.t.length * 20).toBeLessThanOrEqual(84); // 4 chars per line at 20 units each
  });
  it("an ellipse wraps narrower than a rect of the same size", () => {
    const t = "alpha beta gamma delta";
    const r = tspans(buildSvg([el({ id: "a", kind: "rect", w: 120, h: 300, text: t })], LIGHT, opts)).length;
    const e = tspans(buildSvg([el({ id: "a", kind: "ellipse", w: 120, h: 300, text: t })], LIGHT, opts)).length;
    expect(e).toBeGreaterThan(r);
  });
  it("text taller than the shape is never clipped: it stays vertically centred and whole (growing the shape is the editor's job)", () => {
    const e = el({ id: "a", kind: "rect", x: 0, y: 0, w: 60, h: 40, text: "one two three four five six seven eight nine ten eleven twelve" });
    const svg = buildSvg([e], LIGHT, opts);
    expect(svg).not.toContain("clip-path"); expect(svg).not.toContain("<clipPath");
    const ys = tspans(svg).map((l) => l.y);
    expect((ys[0]! + ys[ys.length - 1]!) / 2 - 0.36 * 13).toBeCloseTo(20, 5); // centred on cy = 20
    expect(tspans(svg).map((l) => l.t).join("").replace(/ /g, "")).toBe("onetwothreefourfivesixseveneightnineteneleventwelve"); // every glyph is there (words wider than the box break between letters)
    expect(wellFormed(svg)).toBeNull();
  });
  it("free text does not wrap (it sizes itself)", () => {
    const ls = tspans(buildSvg([el({ id: "a", kind: "text", w: 400, h: 20, text: "a long line of free text that stays on one line" })], LIGHT, opts));
    expect(ls.length).toBe(1);
  });
});

describe("SVG text alignment", () => {
  const anchor = (svg: string) => /<text text-anchor="(\w+)"/.exec(svg)![1];
  it("absent / centre = middle at the box centre; left = start at the inner left edge; right = end at the inner right edge", () => {
    const base = { id: "a", kind: "rect" as const, x: 0, y: 0, w: 200, h: 60, text: "hi" };
    const c = buildSvg([el(base)], LIGHT, opts), l = buildSvg([el({ ...base, align: "left" })], LIGHT, opts), r = buildSvg([el({ ...base, align: "right" })], LIGHT, opts);
    expect([anchor(c), anchor(l), anchor(r)]).toEqual(["middle", "start", "end"]);
    expect(tspans(c)[0]!.x).toBe(100); expect(tspans(l)[0]!.x).toBe(12); expect(tspans(r)[0]!.x).toBe(188); // 12px of padding either side
  });
  it("aligns free text inside its box too", () => {
    const svg = buildSvg([el({ id: "a", kind: "text", x: 0, y: 0, w: 100, h: 20, text: "x", align: "left" })], LIGHT, opts);
    expect(anchor(svg)).toBe("start"); expect(tspans(svg)[0]!.x).toBe(8);
  });
});

describe("group outlines in SVG", () => {
  const a = el({ id: "a", x: 0, y: 0, w: 100, h: 60, groupIds: ["g1"], z: 1 }), b = el({ id: "b", x: 200, y: 0, w: 100, h: 60, groupIds: ["g1"], z: 2 }), c = el({ id: "c", x: 500, y: 0, w: 50, h: 50, z: 3 });
  const groups = [{ id: "g1", name: "backend", cat: 2 }];
  it("exportGroups pads the member bounds by 12 and skips a group when only some members are exported", () => {
    const all = exportGroups([a, b, c], groups, () => 2);
    expect(all).toHaveLength(1); expect(all[0]!.box).toEqual({ x: -12, y: -12, w: 324, h: 84 });
    expect(exportGroups([a, c], groups, () => 2)).toHaveLength(0);
  });
  it("nested groups get a wider boundary", () => {
    const n1 = el({ id: "n1", x: 0, y: 0, w: 10, h: 10, groupIds: ["in", "out"] }), n2 = el({ id: "n2", x: 50, y: 0, w: 10, h: 10, groupIds: ["out"] });
    const g = exportGroups([n1, n2], [{ id: "in", name: "", cat: 0 }, { id: "out", name: "", cat: 0 }], (id) => (id === "in" ? 1 : 2));
    expect(g.find((x) => x.id === "out")!.box.x).toBeLessThan(g.find((x) => x.id === "in")!.box.x);
  });
  it("draws a dashed outline and the name tag beneath the elements, and grows the viewBox to hold them", () => {
    const gs = exportGroups([a, b], groups, () => 2);
    const svg = buildSvg([a, b], LIGHT, { ...opts, groups: gs });
    expect(wellFormed(svg)).toBeNull();
    const outline = svg.indexOf('stroke-dasharray="8 4"'), firstEl = svg.indexOf('<rect x="0" y="0" width="100"');
    expect(outline).toBeGreaterThan(-1); expect(outline).toBeLessThan(firstEl);
    expect(svg).toContain(`>backend</text>`);
    const plain = buildSvg([a, b], LIGHT, opts);
    const vb = (s: string) => /viewBox="([\d. -]+)"/.exec(s)![1]!.split(" ").map(Number);
    expect(vb(svg)[1]!).toBeLessThan(vb(plain)[1]! - 12); // room above for the tag
    expect(vb(svg)[0]!).toBeLessThan(vb(plain)[0]!);
  });
  it("boundsWithGroups: unchanged without groups, and reaches the tag above and the tag's right edge", () => {
    const b0 = { x: 0, y: 0, w: 10, h: 10 };
    expect(boundsWithGroups(b0, [])).toBe(b0);
    const g = boundsWithGroups(b0, [{ id: "g", name: "a-very-long-group-name-here", cat: 0, box: { x: -12, y: -12, w: 34, h: 34 } }])!;
    expect(g.y).toBe(-12 - 24); expect(g.x + g.w).toBeGreaterThan(22);
  });
  it("escapes a hostile group name", () => {
    const gs = exportGroups([a, b], [{ id: "g1", name: `<script>"&`, cat: 0 }], () => 2);
    const svg = buildSvg([a, b], LIGHT, { ...opts, groups: gs });
    expect(svg).not.toContain("<script>"); expect(wellFormed(svg)).toBeNull();
  });
});
