import { describe, expect, it } from "vitest";
import { alignX, monoMeasure, wrapCached, wrapHeight, wrapText, wrapWidth } from "./wrap";

const m = (fs = 10) => monoMeasure(fs); // 6 units per character at 10px

describe("wrapText", () => {
  it("packs words greedily and never exceeds the width", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", 60, m()); // 10 chars per line
    expect(lines).toEqual(["the quick", "brown fox", "jumps over", "the lazy", "dog"].map((l) => l)); // 'jumps over' = 10 chars = 60
    for (const l of lines) expect(m()(l)).toBeLessThanOrEqual(60);
  });
  it("keeps explicit newlines as paragraph breaks, including blank lines", () => {
    expect(wrapText("a\n\nb c", 600, m())).toEqual(["a", "", "b c"]);
  });
  it("breaks a single word that is wider than a line, without losing characters", () => {
    const lines = wrapText("abcdefghijklmnopqrstuvwxyz", 60, m());
    expect(lines.join("")).toBe("abcdefghijklmnopqrstuvwxyz");
    for (const l of lines) expect(m()(l)).toBeLessThanOrEqual(60);
    expect(lines.length).toBe(3);
  });
  it("breaks a long word that follows short ones onto its own lines", () => {
    expect(wrapText("hi aaaaaaaaaaaaaaaaaaaa yo", 60, m())).toEqual(["hi", "aaaaaaaaaa", "aaaaaaaaaa", "yo"]);
  });
  it("is safe on empty text and on a width narrower than one character (one char per line, no infinite loop)", () => {
    expect(wrapText("", 60, m())).toEqual([""]);
    expect(wrapText("abc", 1, m())).toEqual(["a", "b", "c"]);
  });
  it("does not split surrogate pairs", () => {
    const lines = wrapText("😀😀😀😀", 12, m()); // 2 UTF-16 units per emoji = 12 units
    expect(lines.join("")).toBe("😀😀😀😀");
    for (const l of lines) expect(l.length % 2).toBe(0);
  });
  it("caps the number of lines", () => {
    expect(wrapText("x\n".repeat(500), 60, m()).length).toBeLessThanOrEqual(60);
  });
});

describe("wrapWidth", () => {
  it("is the inner width: a rect keeps the box minus padding, an ellipse / diamond are narrower, free text and others do not wrap", () => {
    expect(wrapWidth("rect", 100)).toBe(76); // 12px of padding either side
    expect(wrapWidth("ellipse", 100)).toBeLessThan(wrapWidth("rect", 100));
    expect(wrapWidth("diamond", 100)).toBeLessThan(wrapWidth("ellipse", 100));
    for (const k of ["text", "icon", "frame", "lane", "badge", "legend", "calc", "image", "brace", "arrow"] as const) expect(wrapWidth(k, 100)).toBe(0);
    expect(wrapWidth("rect", 4)).toBe(12); // never collapses to nothing
    expect(wrapHeight("diamond", 100)).toBe(42); // half the height, less 4px of padding top and bottom
    expect(wrapHeight("rect", 56)).toBe(40); // 8px top and bottom
  });
});

describe("wrapCached", () => {
  it("measures once per (text, width, size): a repeat is a lookup", () => {
    const e = { kind: "rect" as const, w: 100, text: "hello wrapping world", fs: undefined as number | undefined };
    let built = 0, calls = 0;
    const mk = () => { built++; return (s: string) => { calls++; return s.length * 6; }; };
    const a = wrapCached(e, 60, mk), callsAfterFirst = calls;
    const b = wrapCached(e, 60, mk);
    expect(b).toBe(a); expect(built).toBe(1); expect(calls).toBe(callsAfterFirst);
    e.text = "changed text here"; expect(wrapCached(e, 60, mk)).not.toBe(a); expect(built).toBe(2);
    wrapCached(e, 90, mk); expect(built).toBe(3);
    e.fs = 18; wrapCached(e, 90, mk); expect(built).toBe(4);
  });
});

describe("alignX", () => {
  it("left / right sit on the inner edges, centre on the middle", () => {
    expect(alignX("left", 100, 40)).toBe(60); expect(alignX("right", 100, 40)).toBe(140);
    expect(alignX(undefined, 100, 40)).toBe(100); expect(alignX("center", 100, 40)).toBe(100);
  });
});
