// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "../editor";
import { buildSvg } from "../io/svg";
import { el, wellFormed } from "../io/testkit";
import { loadMd, mdLib } from "../md-hook";
import { drawEl } from "../renderer";
import { LIGHT } from "../theme";
import { styleCaps } from "../ui/props-model";
import { tokens } from "./highlight";
import { layout } from "./layout";
import { parse, parseInline } from "./parse";

const SAMPLE = "## Order service\nHandles checkout.\n\n- writes to **Postgres**\n- emits `order.created`\n3. third\n\n```go\n// idempotent\nfunc Place(o Order) error {\n  return db.Insert(\"orders\", 30)\n}\n```";
const mono = (font: string, s: string) => s.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)![1]!) * 0.6;

describe("markdown parser", () => {
  it("headings, bullets, numbered lines, blank and plain", () => {
    expect(parse("# a\n## b\n### c\n#### d\n- x\n* y\n12. z\n\nplain")).toEqual([
      { k: "h", level: 1, text: "a" }, { k: "h", level: 2, text: "b" }, { k: "h", level: 3, text: "c" }, { k: "p", text: "#### d" },
      { k: "li", text: "x" }, { k: "li", text: "y" }, { k: "ol", num: "12", text: "z" }, { k: "blank" }, { k: "p", text: "plain" },
    ]);
  });
  it("a marker without its space is plain text", () => { expect(parse("#a\n-b\n1.c").every((b) => b.k === "p")).toBe(true); });
  it("fenced code with a language tag; an unclosed fence runs to the end", () => {
    expect(parse("```Go\na\n b\n```\nafter")).toEqual([{ k: "code", lang: "go", lines: ["a", " b"] }, { k: "p", text: "after" }]);
    expect(parse("x\n```\nnever closed\n# not a heading")).toEqual([{ k: "p", text: "x" }, { k: "code", lang: "", lines: ["never closed", "# not a heading"] }]);
  });
  it("inline: bold, code, unmatched markers stay literal", () => {
    expect(parseInline("a **b** `c` d")).toEqual([{ t: "a ", k: "p" }, { t: "b", k: "b" }, { t: " ", k: "p" }, { t: "c", k: "c" }, { t: " d", k: "p" }]);
    expect(parseInline("**open and `open")).toEqual([{ t: "**open and `open", k: "p" }]);
  });
});

describe("highlighter", () => {
  const roles = (s: string, lang = "") => tokens(s, lang).filter(([t]) => t.trim()).map(([t, r]) => `${t}:${r}`);
  it("keywords, calls, strings, numbers, comments", () => {
    const r = roles('func Place(x) { return db.Insert("o", 30) } // done');
    for (const t of ["func:kw", "Place:fn", "return:kw", "Insert:fn", '"o":str', "30:num", "// done:mid"]) expect(r).toContain(t);
    expect(r).not.toContain("x:fn");
  });
  it("`i--` in a js block is code, `#` in a py block is a comment", () => {
    expect(roles("for (i = n; i > 0; i--) {", "js").some((t) => t.endsWith(":mid"))).toBe(false);
    expect(roles("this.#x = 1", "ts").some((t) => t.endsWith(":mid"))).toBe(false);
    expect(roles("x = 1  # note", "py")).toContain("# note:mid");
    expect(roles("a = b // c", "py").some((t) => t.endsWith(":mid"))).toBe(false); // // is not a python comment
    expect(roles("select 1 -- c", "sql")).toContain("-- c:mid");
    expect(roles("// c", "go")).toEqual(["// c:mid"]);
  });
  it("no tag or an unknown tag allows all three markers", () => {
    for (const lang of ["", "rust"]) { expect(roles("// a", lang)).toEqual(["// a:mid"]); expect(roles("# a", lang)).toEqual(["# a:mid"]); expect(roles("-- a", lang)).toEqual(["-- a:mid"]); }
  });
});

describe("layout", () => {
  it("is finite, ordered and has one code rect + a lang label", () => {
    const l = layout(SAMPLE, 0, mono);
    expect(l.w).toBeGreaterThan(100); expect(l.h).toBeGreaterThan(100);
    expect(l.items.filter((i) => i.k === "r" && i.a === "code").length).toBe(1);
    expect(l.items.some((i) => i.k === "t" && i.end && i.s === "go")).toBe(true);
    expect(l.items.filter((i) => i.k === "dot").length).toBe(2);
  });
  it("keeps the language tag clear of a long first code line", () => {
    const l = layout("```go\nfunc Place() { return \"x\" }\n```", 13, mono);
    const rect = l.items.find((i) => i.k === "r" && i.a === "code")!, tag = l.items.find((i) => i.k === "t" && i.end && i.s === "go")!;
    if (rect.k !== "r" || tag.k !== "t") throw new Error("missing items");
    const firstLineEnd = Math.max(...l.items.map((i) => (i.k === "t" && !i.end && i.y < rect.y + 20 ? i.x + mono(i.font, i.s) : 0)));
    expect(firstLineEnd).toBeLessThan(tag.x - mono(tag.font, tag.s) - 4); // the tag is right-aligned at tag.x
  });
  it("scales with the font size", () => {
    const a = layout(SAMPLE, 13, mono), b = layout(SAMPLE, 26, mono);
    expect(b.w / a.w).toBeCloseTo(2, 1); expect(b.h / a.h).toBeCloseTo(2, 1);
    expect(layout(SAMPLE, 0, mono).h).toBeCloseTo(a.h, 6);
  });
  it("headings are Lato 600 at 22/18/15", () => {
    const sz = (src: string) => { const t = layout(src, 13, mono).items[0]!; return t.k === "t" ? `${t.fam}${t.wt}/${t.sz}` : ""; };
    expect([sz("# a"), sz("## a"), sz("### a")]).toEqual(["l600/22", "l600/18", "l600/15"]);
  });
});

describe("md in the editor", () => {
  let stage: HTMLDivElement, ed: Editor;
  let measured = 0;
  const fake = new Proxy({}, { get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? (s: string) => { measured++; return { width: s.length * 7 }; } : k in t ? t[k] : () => undefined), set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; } });
  beforeEach(async () => {
    HTMLCanvasElement.prototype.getContext = (() => fake) as never;
    stage = document.createElement("div");
    const a = document.createElement("canvas"), b = document.createElement("canvas");
    stage.append(a, b); document.body.append(stage);
    ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT }); ed.renderer.resize(800, 600, 1);
    await loadMd();
  });
  afterEach(() => { ed.destroy(); stage.remove(); });

  it("the toggle exists for free text only", () => {
    for (const k of ["rect", "ellipse", "icon", "arrow", "legend", "calc", "image", "frame", "note", "badge"] as const) expect(styleCaps({ kind: k, iconId: "", fill: 1 }).md, k).toBe(false);
    expect(styleCaps({ kind: "text", iconId: "", fill: 0 }).md).toBe(true);
  });
  it("toggling resizes to the rendered layout (centre fixed), one undo step restores it", () => {
    const e = ed.scene.add({ kind: "text", x: 100, y: 100, w: 90, h: 28, text: SAMPLE });
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    ed.select([e.id]); ed.setStyle({ md: 1 });
    expect(e.md).toBe(1);
    const want = mdLib()!.size(SAMPLE, 13);
    expect([e.w, e.h]).toEqual([want.w, want.h]);
    expect(e.x + e.w / 2).toBeCloseTo(cx, 6); expect(e.y + e.h / 2).toBeCloseTo(cy, 6);
    ed.setStyle({ fs: 26 });
    expect(e.h).toBeGreaterThan(want.h * 1.8);
    ed.undo(); expect(e.fs).toBeUndefined(); expect(e.md).toBe(1);
    ed.undo(); expect(e.md).toBeUndefined(); expect([e.w, e.h]).toEqual([90, 28]);
    ed.redo(); expect(e.md).toBe(1); expect(e.h).toBe(want.h);
  });
  it("md on a non-text element does nothing and leaves no undo step", () => {
    const r = ed.scene.add({ kind: "rect", x: 0, y: 0, w: 100, h: 50, text: "# hi" });
    ed.select([r.id]); ed.setStyle({ md: 1 });
    expect(r.md).toBeUndefined();
    ed.undo(); expect(ed.scene.els.has(r.id)).toBe(true);
  });
  it("copy style / paste style carries md", () => {
    const a = ed.scene.add({ kind: "text", x: 0, y: 0, w: 80, h: 28, text: "# a", md: 1 }), b = ed.scene.add({ kind: "text", x: 0, y: 100, w: 80, h: 28, text: "# b" });
    ed.select([a.id]); ed.copyStyle(); ed.select([b.id]); ed.pasteStyle();
    expect(b.md).toBe(1);
  });
  it("draws formatted when on, plain when off, never re-measures per frame", () => {
    const ctx = fake as unknown as CanvasRenderingContext2D;
    const e = ed.scene.add({ kind: "text", x: 0, y: 0, w: 200, h: 100, text: "## Title\n- one", md: 1 });
    drawEl(ctx, e, LIGHT, 1, false, false);
    const first = measured;
    drawEl(ctx, e, LIGHT, 1, false, false); drawEl(ctx, e, LIGHT, 1, false, false);
    expect(measured).toBe(first); // cached layout: no measuring after the first draw
    e.text = "## Title\n- two"; drawEl(ctx, e, LIGHT, 1, false, false);
    expect(measured).toBeGreaterThan(first); // text changed: re-laid out
  });
  it("duplicate and clipboard copy/paste carry md; a junk md on paste is dropped", () => {
    const a = ed.scene.add({ kind: "text", x: 0, y: 0, w: 80, h: 28, text: "# a", md: 1 });
    ed.select([a.id]); ed.duplicateSelection();
    const copies = [...ed.scene.els.values()].filter((e) => e.id !== a.id);
    expect(copies.length).toBe(1); expect(copies[0]!.md).toBe(1);
    const core = ed as unknown as { copyText(): string | null; pasteText(s: string): boolean };
    ed.select([a.id]); const json = core.copyText()!;
    expect(core.pasteText(json)).toBe(true);
    expect([...ed.scene.els.values()].filter((e) => e.md === 1).length).toBe(3);
    const bad = JSON.parse(json.slice(json.indexOf("{"))); bad.els[0].md = "yes";
    expect(core.pasteText(JSON.stringify(bad))).toBe(true);
    expect([...ed.scene.els.values()].filter((e) => e.md === 1).length).toBe(3);
  });
  it("find / text stay raw", () => {
    const e = ed.scene.add({ kind: "text", x: 0, y: 0, w: 80, h: 28, text: "**x**", md: 1 });
    expect(e.text).toBe("**x**");
  });
});

describe("markdown SVG export", () => {
  const svgOf = async (text: string, extra = {}) => {
    const m = await loadMd();
    return buildSvg([el({ id: "t", kind: "text", x: 0, y: 0, w: 300, h: 120, text, md: 1, ...extra })], LIGHT, { background: false, padding: 8, icons: () => null, md: m.svg });
  };
  it("emits formatted runs, a code rect and a chip", async () => {
    const s = await svgOf(SAMPLE);
    expect(wellFormed(s)).toBeNull();
    expect(s).toContain('font-weight="600"'); expect(s).toContain('font-weight="700"'); expect(s).toContain("<circle"); expect(s).toContain("<rect");
    expect(s).toContain(">order.created<"); expect(s).toContain('text-anchor="end"');
  });
  it("escapes <script> and & in every run", async () => {
    const s = await svgOf("# <script>alert(1)</script> & co\n`a<b` **x&y**\n```js\nif (a < b && c) { x = \"<s>\" }\n```");
    expect(wellFormed(s)).toBeNull();
    expect(s).not.toContain("<script");
    expect(s).toContain("&lt;script&gt;"); expect(s).toContain("&amp;");
  });
  it("without the md hook (or md off) the text is the plain label as before", () => {
    const plain = buildSvg([el({ id: "t", kind: "text", w: 300, h: 40, text: "# a" })], LIGHT, { background: false, padding: 8, icons: () => null });
    expect(plain).toContain("<tspan");
  });
});
