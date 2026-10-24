import type { Kind } from "./scene";

/** horizontal alignment of a label inside its box; absent on an element = centred */
export type TextAlign = "left" | "center" | "right";
/** width of one line of text at the font the caller already chose */
export type Measure = (text: string) => number;

/** JetBrains Mono and DejaVu Sans Mono both advance about 0.6 em: the pure (no DOM) measure used when nothing better is supplied */
export const MONO_ADVANCE = 0.6;
export const monoMeasure = (fs: number): Measure => (s) => s.length * fs * MONO_ADVANCE;

const MAX_LINES = 60;
/** line pitch of a label at text size `fs` (0 = the default 13px): the renderer, the SVG export and the auto-grow all use this one rule */
export const labelLineHeight = (fs?: number): number => (fs ? Math.round(fs * (18 / 13)) : 18);

/**
 * Where a shape's text may go: [share of the width, share of the height, padding x, padding y]. An ellipse or diamond is narrower than its
 * bounding box where the text sits, so the label wraps to the inscribed share, and then keeps the padding clear of the outline on every side
 * (the padding is the gap between the text block and the edge of that inscribed area, so it also keeps text off a curved edge).
 * Kinds not listed (free text, icons, frames, lanes, badges, legends, calc, images, braces) do not wrap: free text sizes itself to
 * its content and the others have their own label layout.
 */
const FIT: Partial<Record<Kind, readonly [number, number, number, number]>> = {
  rect: [1, 1, 12, 8], note: [1, 0.85, 12, 6], cylinder: [1, 0.72, 12, 4], parallelogram: [0.8, 1, 10, 8], hexagon: [0.74, 0.82, 8, 6],
  ellipse: [0.72, 0.72, 6, 6], cloud: [0.68, 0.6, 6, 6], diamond: [0.5, 0.5, 4, 4], triangle: [0.5, 0.5, 4, 4], star: [0.45, 0.45, 4, 4],
};

/** width a shape's label wraps to; 0 = this kind does not wrap */
export function wrapWidth(kind: Kind, w: number): number {
  const f = FIT[kind];
  return f ? Math.max(12, w * f[0] - 2 * f[2]) : 0;
}
/** height the wrapped label block may use inside a shape of height `h` (the label is never clipped: a shape that is too short grows, see minLabelHeight) */
export function wrapHeight(kind: Kind, h: number): number { const f = FIT[kind]; return f ? Math.max(0, h * f[1] - 2 * f[3]) : h; }

/**
 * Word-wrap `text` to `maxW`: paragraphs (\n) stay separate, words are packed greedily, a word wider than a whole line is broken
 * between characters. Never returns an empty array. Pure; the caller supplies the measure.
 */
export function wrapText(text: string, maxW: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (out.length >= MAX_LINES) break;
    if (para === "" || measure(para) <= maxW) { out.push(para); continue; }
    let cur = "";
    for (let word of para.split(" ")) {
      const cand = cur === "" ? word : `${cur} ${word}`;
      if (measure(cand) <= maxW) { cur = cand; continue; }
      if (cur !== "") { out.push(cur); cur = ""; }
      while (measure(word) > maxW) {
        const cs = Array.from(word);
        let k = 1;
        while (k < cs.length && measure(cs.slice(0, k + 1).join("")) <= maxW) k++;
        if (k >= cs.length) break;
        out.push(cs.slice(0, k).join(""));
        word = cs.slice(k).join("");
      }
      cur = word;
    }
    out.push(cur);
  }
  return out.length ? out : [""];
}

interface Entry { text: string; w: number; fs: number; lines: string[] }
const cache = new WeakMap<object, Entry>();

/**
 * the wrapped lines of an element's label, cached on the element: while text, width and font size are unchanged this is a lookup,
 * so a frame (or a pan) never measures text. `measure` is only built on a miss, and must use the font of `fs`.
 */
export function wrapCached(e: { kind: Kind; w: number; text: string; fs?: number | undefined }, maxW: number, measure: () => Measure): string[] {
  const fs = e.fs || 0, hit = cache.get(e);
  if (hit && hit.text === e.text && hit.w === maxW && hit.fs === fs) return hit.lines;
  const lines = wrapText(e.text, maxW, measure());
  if (hit) { hit.text = e.text; hit.w = maxW; hit.fs = fs; hit.lines = lines; } else cache.set(e, { text: e.text, w: maxW, fs, lines });
  return lines;
}

/**
 * The least height a shape needs for its label to fit with its padding: lines x line pitch, plus padding, divided by the share of the height text may use.
 * 0 when the kind does not wrap or has no text. Uses the same cached wrap as drawing, so asking every frame of a resize costs a lookup.
 */
export function minLabelHeight(e: { kind: Kind; w: number; text: string; fs?: number | undefined }, measure: () => Measure): number {
  const f = FIT[e.kind];
  if (!f || e.text === "") return 0;
  const lines = wrapCached(e, wrapWidth(e.kind, e.w), measure);
  return Math.ceil((lines.length * labelLineHeight(e.fs) + 2 * f[3]) / f[1]);
}

/** x at which a line starts / centres for an alignment inside a box centred on cx with half-width `half` */
export function alignX(align: TextAlign | undefined, cx: number, half: number): number {
  return align === "left" ? cx - half : align === "right" ? cx + half : cx;
}
