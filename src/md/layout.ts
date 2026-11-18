import { tokens, type Role } from "./highlight";
import { parse, parseInline } from "./parse";

/** colour slots: the drawer maps them to the live theme, so a layout is theme-independent and cached on text + size only */
export type Slot = Role | "chip";
export const MONO = "'JetBrains Mono','DejaVu Sans Mono',monospace";
export const LATO = "Lato,sans-serif";

export type Item =
  | { k: "t"; x: number; y: number; s: string; font: string; sz: number; fam: "m" | "l"; wt: 400 | 600 | 700; slot: Slot; end?: true }
  | { k: "r"; x: number; y: number; w: number; h: number; r: number; a: "chip" | "code" }
  | { k: "dot"; x: number; y: number; r: number };
export interface Layout { w: number; h: number; items: Item[] }
/** width of `s` set in CSS font `font` */
export type Measure = (font: string, s: string) => number;

const HEAD = [0, 22, 18, 15] as const;

/** Lay the markdown `src` out at text size `fs` (the default 13 scales everything by fs / 13). Pure apart from `m`. */
export function layout(src: string, fs: number, m: Measure): Layout {
  const f = (fs || 13) / 13, S = (fs || 13), items: Item[] = [];
  let Y = 0, W = 0, gap = 0;
  const fontOf = (fam: "m" | "l", wt: 400 | 600 | 700, sz: number) => `${wt === 700 ? "bold " : wt === 600 ? "600 " : ""}${sz}px ${fam === "m" ? MONO : LATO}`;
  const text = (x: number, y: number, s: string, fam: "m" | "l", wt: 400 | 600 | 700, sz: number, slot: Slot, end?: true): number => {
    const font = fontOf(fam, wt, sz), w = m(font, s);
    items.push(end ? { k: "t", x, y, s, font, sz, fam, wt, slot, end } : { k: "t", x, y, s, font, sz, fam, wt, slot });
    W = Math.max(W, end ? x : x + w);
    return w;
  };
  const base = (top: number, h: number, sz: number) => top + h / 2 + sz * 0.36; // alphabetic baseline of a line centred in its box
  const inline = (s: string, x: number, top: number, h: number): void => {
    const y = base(top, h, S);
    for (const sp of parseInline(s)) {
      if (sp.k === "b") x += text(x, y, sp.t, "m", 700, S, "ink");
      else if (sp.k === "c") {
        const sz = 12 * f, w = m(fontOf("m", 400, sz), sp.t);
        items.push({ k: "r", x, y: y - S + 2 * f, w: w + 8 * f, h: S + 5 * f, r: 4 * f, a: "chip" });
        text(x + 4 * f, y, sp.t, "m", 400, sz, "chip"); x += w + 8 * f;
      } else x += text(x, y, sp.t, "m", 400, S, "ink");
    }
  };
  const start = (): number => { const t = Y + gap; gap = 0; return t; };

  for (const b of parse(src)) {
    if (b.k === "blank") { Y += gap + 8 * f; gap = 0; continue; }
    const top = start();
    if (b.k === "h") {
      const sz = HEAD[b.level]! * f, h = sz * 1.5;
      text(0, base(top, h, sz), b.text, "l", 600, sz, "ink"); Y = top + h;
    } else if (b.k === "li") {
      const h = 20 * f;
      items.push({ k: "dot", x: 5 * f, y: base(top, h, S) - 4 * f, r: 2.3 * f });
      inline(b.text, 16 * f, top, h); Y = top + h;
    } else if (b.k === "ol") {
      const h = 20 * f;
      text(0, base(top, h, S), `${b.num}.`, "m", 400, S, "mid");
      inline(b.text, 22 * f, top, h); Y = top + h;
    } else if (b.k === "p") {
      const h = 18 * f; inline(b.text, 0, top, h); Y = top + h;
    } else {
      const sz = 12 * f, lh = 18 * f, lines = b.lines.length ? b.lines : [""], toks = lines.map((l) => tokens(l, b.lang));
      const font = fontOf("m", 400, sz);
      let cw = 0;
      for (const l of lines) cw = Math.max(cw, m(font, l));
      // the language tag sits at the top right, on the first code line's band: the block is wide enough that the two never overlap
      const tagW = b.lang ? m(fontOf("m", 400, 10 * f), b.lang) : 0;
      const w = Math.max(cw + 24 * f, b.lang ? 12 * f + m(font, lines[0]!) + 12 * f + tagW + 8 * f : 0), h = lines.length * lh + 12 * f;
      items.push({ k: "r", x: 0, y: top, w, h, r: 6 * f, a: "code" });
      if (b.lang) text(w - 8 * f, top + 13 * f, b.lang, "m", 400, 10 * f, "mid", true);
      toks.forEach((tk, i) => {
        let x = 12 * f; const y = base(top + 6 * f + i * lh, lh, sz);
        for (const [s, slot] of tk) x += text(x, y, s, "m", 400, sz, slot);
      });
      W = Math.max(W, w); Y = top + h; gap = 8 * f;
    }
  }
  return { w: W, h: Y, items };
}
