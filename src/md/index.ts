import type { MdLib } from "../md-hook";
import type { El } from "../scene";
import type { Theme } from "../theme";
import { layout, type Layout, type Slot } from "./layout";

/** the lazy markdown chunk: parse, layout, canvas draw, SVG. Loaded the first time a markdown text is drawn or toggled (see md-hook.ts). */
const PAD_X = 8, PAD_Y = 5; // half of the +16 / +10 padding measureText gives free text

let mctx: CanvasRenderingContext2D | null = null;
const measure = (font: string, s: string): number => {
  if (!mctx) mctx = document.createElement("canvas").getContext("2d")!;
  if (mctx.font !== font) mctx.font = font;
  return mctx.measureText(s).width;
};

/** the faces must be loaded before anything is measured: a layout cached against a fallback font would stay wrong */
export async function fontsReady(): Promise<void> {
  const fs = (document as { fonts?: { load(f: string): Promise<unknown> } }).fonts;
  if (!fs) return;
  await Promise.all(["600 18px Lato", "13px 'JetBrains Mono'"].map((f) => fs.load(f).catch(() => undefined)));
}

const cache = new WeakMap<object, { text: string; fs: number; lay: Layout }>();
/** the layout of an element's text, cached on the element: a frame never parses or measures */
function layoutOf(e: Pick<El, "text" | "fs">): Layout {
  const fs = e.fs || 0, hit = cache.get(e);
  if (hit && hit.text === e.text && hit.fs === fs) return hit.lay;
  const lay = layout(e.text, fs, measure);
  if (hit) { hit.text = e.text; hit.fs = fs; hit.lay = lay; } else cache.set(e, { text: e.text, fs, lay });
  return lay;
}

type Palette = Record<Slot, string>;
const hex = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** `a` moved `t` of the way to `b` (both #rrggbb) */
function mixHex(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("");
}
const palettes = new WeakMap<Theme, Palette>();
/** syntax colours come from the theme's category colours; on a light paper they are pulled towards the ink so they stay readable */
function paletteOf(th: Theme): Palette {
  let p = palettes.get(th);
  if (!p) {
    const dark = hex(th.paper)[0]! < 128, c = (i: number) => (dark ? th.cats[i]! : mixHex(th.cats[i]!, th.ink, 0.38));
    palettes.set(th, p = { ink: th.ink, mid: th.mid, kw: c(3), str: c(2), num: c(1), fn: c(0), chip: c(3) });
  }
  return p;
}

const lib: MdLib = {
  size(text, fs) {
    const l = layout(text, fs, measure);
    return { w: Math.ceil(l.w) + 2 * PAD_X, h: Math.ceil(l.h) + 2 * PAD_Y };
  },
  draw(ctx, e, th, ink, solid) {
    const l = layoutOf(e), p = paletteOf(th), ox = e.x + PAD_X, oy = e.y + PAD_Y;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    let font = "", end = false;
    for (const it of l.items) {
      if (it.k === "t") {
        if (it.font !== font) { ctx.font = font = it.font; }
        if ((it.end === true) !== end) { end = !end; ctx.textAlign = end ? "right" : "left"; }
        ctx.fillStyle = solid ? ink : it.slot === "ink" ? ink : p[it.slot];
        ctx.fillText(it.s, ox + it.x, oy + it.y);
      } else if (it.k === "r") {
        ctx.globalAlpha = th.tint * (it.a === "chip" ? 0.55 : 0.4); ctx.fillStyle = ink;
        ctx.beginPath(); ctx.roundRect(ox + it.x, oy + it.y, it.w, it.h, it.r); ctx.fill(); ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = solid ? ink : p.mid; ctx.beginPath(); ctx.arc(ox + it.x, oy + it.y, it.r, 0, 7); ctx.fill();
      }
    }
  },
  svg(e, th, ink, solid) {
    const l = layoutOf(e), p = paletteOf(th), ox = e.x + PAD_X, oy = e.y + PAD_Y, out: string[] = [];
    for (const it of l.items) {
      if (it.k === "t") {
        const fill = solid || it.slot === "ink" ? ink : p[it.slot];
        out.push(`<text x="${n(ox + it.x)}" y="${n(oy + it.y)}" font-family="${it.fam === "m" ? "'JetBrains Mono','DejaVu Sans Mono',monospace" : "Lato,sans-serif"}" font-size="${n(it.sz)}"${it.wt === 400 ? "" : ` font-weight="${it.wt}"`}${it.end ? ` text-anchor="end"` : ""} fill="${fill}" xml:space="preserve">${esc(it.s)}</text>`);
      } else if (it.k === "r") out.push(`<rect x="${n(ox + it.x)}" y="${n(oy + it.y)}" width="${n(it.w)}" height="${n(it.h)}" rx="${n(it.r)}" fill="${ink}" fill-opacity="${n(th.tint * (it.a === "chip" ? 0.55 : 0.4))}"/>`);
      else out.push(`<circle cx="${n(ox + it.x)}" cy="${n(oy + it.y)}" r="${n(it.r)}" fill="${solid ? ink : p.mid}"/>`);
    }
    return out.join("");
  },
};
const n = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));

export { lib, layout };
