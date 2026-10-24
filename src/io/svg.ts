import type { ElLike } from "./format";
import { arrowLabels, isCurve, pointAtT } from "../connectors";
import { iconStrip, isBareLogo, ROOT_ATTRS } from "../icons";
import { logoBox } from "../icon-pack";
import { isDarkPaper, themedLogoMarkup } from "../logos";
import { colourOf, onSolid, type Theme } from "../theme";
import type { CalcRow } from "../calc";
import { TAG_RISE, tagReach, type GroupOutline } from "../groups";
import { alignX, monoMeasure, wrapText, wrapWidth, type TextAlign } from "../wrap";
import { CALC_LINE, CALC_PAD } from "../calc-view";
import { CONTAINER_KINDS, FRAME_HEADER, LEGEND_PAD, LEGEND_ROW_H, LEGEND_TITLE_H, PATH_KINDS, labelPoint, laneCells, legendRows, shapeParts } from "../shape-geom";

/** Pure (no DOM) geometry + SVG generation, shared by SVG export and (via arrowPathD) the PNG path. */

export interface Bounds { x: number; y: number; w: number; h: number }

const FONT = "'JetBrains Mono','DejaVu Sans Mono',monospace";
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function esc(s: string): string {
  return s.replace(BAD_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const n = (v: number): string => String(Math.round(v * 100) / 100 + 0);

export function elBounds(e: ElLike): Bounds {
  let x0 = e.x, y0 = e.y, x1 = e.x + e.w, y1 = e.y + e.h;
  if (e.kind === "arrow") for (let i = 0; i + 1 < e.pts.length; i += 2) { const px = e.pts[i]!, py = e.pts[i + 1]!; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** `b` grown to hold the groups' outlines and their name tags (they sit outside the members' bounds) */
export function boundsWithGroups(b: Bounds | null, groups: readonly GroupOutline[] | undefined): Bounds | null {
  if (!groups?.length) return b;
  let x0 = b ? b.x : Infinity, y0 = b ? b.y : Infinity, x1 = b ? b.x + b.w : -Infinity, y1 = b ? b.y + b.h : -Infinity;
  for (const g of groups) {
    x0 = Math.min(x0, g.box.x); y0 = Math.min(y0, g.name ? g.box.y - TAG_RISE : g.box.y);
    x1 = Math.max(x1, g.box.x + g.box.w, g.name ? tagReach(g.box, g.name.length) : -Infinity); y1 = Math.max(y1, g.box.y + g.box.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionBounds(els: readonly ElLike[]): Bounds | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) { const b = elBounds(e); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ------------------------------------------------------------------ export sizing */

export const EXPORT_LIMITS = { maxSide: 16384, maxPixels: 100e6, minScale: 0.05 } as const;

export type Plan = { ok: true; width: number; height: number; scale: number; scaledDown: boolean; wx: number; wy: number; ww: number; wh: number } | { ok: false; message: string };

/** decide the bitmap size; scale down (never silently past the limits) or refuse with a clear message */
export function planExport(b: Bounds, scale: number, pad: number, lim: { maxSide: number; maxPixels: number; minScale: number } = EXPORT_LIMITS): Plan {
  const ww = Math.max(1, b.w + pad * 2), wh = Math.max(1, b.h + pad * 2);
  let s = scale, scaledDown = false;
  if (ww * s > lim.maxSide || wh * s > lim.maxSide || ww * wh * s * s > lim.maxPixels) {
    s = Math.min(lim.maxSide / Math.max(ww, wh), Math.sqrt(lim.maxPixels / (ww * wh)), scale);
    scaledDown = true;
  }
  if (!Number.isFinite(s) || s < lim.minScale) return { ok: false, message: `The drawing is ${Math.round(ww)} × ${Math.round(wh)} units — too large to export as an image. Export as SVG instead, or select part of it.` };
  return { ok: true, width: Math.max(1, Math.floor(ww * s)), height: Math.max(1, Math.floor(wh * s)), scale: s, scaledDown, wx: b.x - pad, wy: b.y - pad, ww, wh };
}

/* ------------------------------------------------------------------ arrows */

type P = [number, number];

export function arrowPoints(e: ElLike): P[] {
  const p: P[] = [];
  for (let i = 0; i + 1 < e.pts.length; i += 2) p.push([e.pts[i]!, e.pts[i + 1]!]);
  return p.length >= 2 ? p : [[e.x, e.y], [e.x + e.w, e.y + e.h]];
}

/** SVG path data for an arrow's body. Used by SVG export and by the PNG path via Path2D, so both look identical. */
export function arrowPathD(e: ElLike): string {
  const p = arrowPoints(e);
  const last = p[p.length - 1]!;
  if (e.route !== 0 && isCurve(e)) return `M${n(p[0]![0])} ${n(p[0]![1])}C${p.slice(1).map(([x, y]) => `${n(x)} ${n(y)}`).join(" ")}`; // the routed cubic: start, two controls, end
  if (e.route === 0) return "M" + p.map(([x, y]) => `${n(x)} ${n(y)}`).join("L");
  if (e.route === 2 || e.edge === 2) {
    if (p.length === 2) { const [x0, y0] = p[0]!, [x1, y1] = last, mx = (x0 + x1) / 2; return `M${n(x0)} ${n(y0)}C${n(mx)} ${n(y0)} ${n(mx)} ${n(y1)} ${n(x1)} ${n(y1)}`; }
    let d = `M${n(p[0]![0])} ${n(p[0]![1])}`;
    for (let i = 1; i < p.length - 1; i++) { const [cx, cy] = p[i]!, [nx, ny] = p[i + 1]!; d += `Q${n(cx)} ${n(cy)} ${n((cx + nx) / 2)} ${n((cy + ny) / 2)}`; }
    return d + `L${n(last[0])} ${n(last[1])}`;
  }
  const r = e.edge === 0 ? 0 : 14;
  if (r === 0 || p.length < 3) return "M" + p.map(([x, y]) => `${n(x)} ${n(y)}`).join("L");
  let d = `M${n(p[0]![0])} ${n(p[0]![1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [px, py] = p[i - 1]!, [cx, cy] = p[i]!, [nx, ny] = p[i + 1]!;
    const l1 = Math.hypot(cx - px, cy - py), l2 = Math.hypot(nx - cx, ny - cy);
    if (l1 === 0 || l2 === 0) continue;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    d += `L${n(cx - ((cx - px) / l1) * rr)} ${n(cy - ((cy - py) / l1) * rr)}Q${n(cx)} ${n(cy)} ${n(cx + ((nx - cx) / l2) * rr)} ${n(cy + ((ny - cy) / l2) * rr)}`;
  }
  return d + `L${n(last[0])} ${n(last[1])}`;
}

export interface Head { chevron?: string; dot?: { x: number; y: number; r: number } }
export function arrowHead(e: ElLike): Head {
  if (e.head === 0) return {};
  const p = arrowPoints(e);
  const [tx, ty] = p[p.length - 1]!;
  if (e.head === 2) return { dot: { x: tx, y: ty, r: 4.5 } };
  let k = p.length - 2;
  while (k > 0 && p[k]![0] === tx && p[k]![1] === ty) k--;
  const [fx, fy] = p[k]!;
  const a = Math.atan2(ty - fy, tx - fx), L = 10, t = 0.5;
  const a1 = a + Math.PI - t, a2 = a + Math.PI + t;
  return { chevron: `M${n(tx + L * Math.cos(a1))} ${n(ty + L * Math.sin(a1))}L${n(tx)} ${n(ty)}L${n(tx + L * Math.cos(a2))} ${n(ty + L * Math.sin(a2))}` };
}

/* ------------------------------------------------------------------ SVG document */

export interface SvgOpts {
  /** evaluator for capacity notes (kind "calc"); absent -> the raw lines are exported without results */
  calc?: (text: string) => CalcRow[];
  background: boolean; padding: number; icons: (id: string, tier: "detail" | "glyph") => string | null;
  /** image key -> data URL, for `image` elements (absent keys are drawn as a dashed placeholder) */
  images?: Record<string, string>;
  /** group outlines (dashed box + name tag) drawn beneath the elements; see exportGroups */
  groups?: readonly GroupOutline[];
  /** width of a line of text at a font size, so labels wrap exactly as on the canvas; absent -> the monospace approximation */
  measure?: (text: string, fs: number) => number;
}

const symId = (id: string, tier: string) => `ap-ic-${id.replace(/[^\w-]/g, "_")}-${tier}`;
const SAFE_INNER = /<\s*(script|foreignObject|image|iframe|use|style)\b|\son\w+\s*=|(?:xlink:)?href\s*=/i;

interface LabelOpt { lines?: string[]; align?: TextAlign | undefined; half?: number; clip?: string }

function labelText(text: string, cx: number, cy: number, fill: string, size = 13, halo?: string, o?: LabelOpt): string {
  const lines = o?.lines ?? text.split("\n").slice(0, 50);
  const lh = Math.round(size * (18 / 13)); // the canvas line height
  const y0 = cy - ((lines.length - 1) * lh) / 2 + size * 0.36;
  const x = alignX(o?.align, cx, o?.half ?? 0);
  const tsp = lines.map((l, i) => `<tspan x="${n(x)}" y="${n(y0 + i * lh)}">${esc(l)}</tspan>`).join("");
  const anchor = o?.align === "left" ? "start" : o?.align === "right" ? "end" : "middle";
  return `<text text-anchor="${anchor}" font-size="${size}" fill="${fill}"${halo ? ` stroke="${halo}" stroke-width="4" paint-order="stroke" stroke-linejoin="round"` : ""}${o?.clip ? ` clip-path="url(#${o.clip})"` : ""}>${tsp}</text>`;
}

export function buildSvg(els: readonly ElLike[], th: Theme, o: SvgOpts): string {
  const list = [...els].sort((a, b) => a.z - b.z);
  const b = boundsWithGroups(unionBounds(list), o.groups) ?? { x: 0, y: 0, w: 64, h: 64 };
  const x = b.x - o.padding, y = b.y - o.padding, w = Math.max(1, b.w + o.padding * 2), h = Math.max(1, b.h + o.padding * 2);
  const col = (e: ElLike) => colourOf(th, e);
  const used = new Map<string, string>(); // symbol id -> <symbol> markup
  const body: string[] = [];
  const measure = o.measure ?? ((t: string, fs: number) => monoMeasure(fs)(t));

  // group outlines first: they sit beneath everything, like on the canvas
  for (const g of o.groups ?? []) {
    const gc = th.cats[g.cat % th.cats.length]!;
    body.push(`<rect x="${n(g.box.x)}" y="${n(g.box.y)}" width="${n(g.box.w)}" height="${n(g.box.h)}" rx="14" fill="${gc}" fill-opacity="0.05" stroke="${gc}" stroke-width="1.6" stroke-dasharray="8 4"/>`);
    if (g.name) body.push(`<text x="${n(g.box.x + 12)}" y="${n(g.box.y - 8)}" font-size="13" fill="${gc}">${esc(g.name)}</text>`);
  }

  /**
   * a shape's label: wrapped to the shape's inner width, aligned and vertically centred, never clipped. Same rules and numbers as drawLabel on the canvas.
   */
  const shapeLabel = (e: ElLike, lx: number, ly: number, fill: string, _outline?: string): string => {
    const fs = e.fs || 13, ww = wrapWidth(e.kind, e.w);
    const lines = ww ? wrapText(e.text, ww, (t) => measure(t, fs)) : e.text.split("\n").slice(0, 50);
    const opt: LabelOpt = { lines, align: e.align, half: ww ? ww / 2 : Math.max(0, e.w / 2 - 8) };
    return labelText(e.text, lx, ly, fill, fs, undefined, opt);
  };

  const shapeFill = (e: ElLike, c: string) => e.fill === 0 ? `fill="none"` : e.fill === 1 ? `fill="${c}" fill-opacity="${th.tint}"` : `fill="${c}"`;
  const stroke = (e: ElLike, c: string, sw = 2) => `stroke="${c}" stroke-width="${sw}"${e.dash ? ` stroke-dasharray="8 4"` : ""} stroke-linejoin="round" stroke-linecap="round"`;

  for (const e of list) {
    const c = col(e);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const labelFill = e.fill === 2 && e.kind !== "text" ? onSolid(th, colourOf(th, e)) : th.ink;
    if (e.kind === "rect") {
      const geom = `x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(e.h)}" rx="${e.edge === 0 ? 0 : n(Math.min(e.radius, Math.min(e.w, e.h) / 2))}"`;
      body.push(`<rect ${geom} ${shapeFill(e, c)} ${stroke(e, c)}/>`);
      if (e.text) body.push(shapeLabel(e, cx, cy, labelFill, `<rect ${geom}/>`));
    } else if (e.kind === "ellipse") {
      const geom = `cx="${n(cx)}" cy="${n(cy)}" rx="${n(e.w / 2)}" ry="${n(e.h / 2)}"`;
      body.push(`<ellipse ${geom} ${shapeFill(e, c)} ${stroke(e, c)}/>`);
      if (e.text) body.push(shapeLabel(e, cx, cy, labelFill, `<ellipse ${geom}/>`));
    } else if (e.kind === "diamond") {
      const geom = `points="${n(cx)},${n(e.y)} ${n(e.x + e.w)},${n(cy)} ${n(cx)},${n(e.y + e.h)} ${n(e.x)},${n(cy)}"`;
      body.push(`<polygon ${geom} ${shapeFill(e, c)} ${stroke(e, c)}/>`);
      if (e.text) body.push(shapeLabel(e, cx, cy, labelFill, `<polygon ${geom}/>`));
    } else if (e.kind === "text") {
      if (e.text) body.push(shapeLabel(e, cx, cy, th.ink, ""));
    } else if (e.kind === "arrow") {
      body.push(`<path d="${arrowPathD(e)}" fill="none" ${stroke(e, c)}/>`);
      const hd = arrowHead(e);
      if (hd.chevron) body.push(`<path d="${hd.chevron}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
      if (hd.dot) body.push(`<circle cx="${n(hd.dot.x)}" cy="${n(hd.dot.y)}" r="${hd.dot.r}" fill="${c}"/>`);
      const ls = arrowLabels(e), curve = isCurve(e), at: [number, number] = [0, 0];
      for (const l of ls) { pointAtT(e.pts, curve, l.t, at); body.push(labelText(l.text, at[0], at[1], th.ink, e.fs || 12, th.paper)); }
    } else if (PATH_KINDS.has(e.kind)) {
      const p = shapeParts(e);
      if (!p) continue;
      const container = CONTAINER_KINDS.has(e.kind);
      const dashed = e.kind === "frame" ? e.dash !== 0 : e.dash === 1;
      const st = `stroke="${c}" stroke-width="2"${dashed ? ` stroke-dasharray="9 5"` : ""} stroke-linejoin="${e.edge === 0 ? "miter" : "round"}" stroke-linecap="round"`;
      if (p.open) body.push(`<path d="${p.body}" fill="none" ${st}/>`);
      else {
        const fillAttr = e.fill === 0 ? `fill="none"` : e.fill === 1 ? `fill="${c}" fill-opacity="${container ? th.tint * 0.55 : th.tint}"` : container ? `fill="${c}" fill-opacity="0.16"` : `fill="${c}"`;
        body.push(`<path d="${p.body}" ${fillAttr} ${st}/>`);
        if (e.kind === "lane") body.push(e.o === 1 ? `<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="28" fill="${c}" fill-opacity="${th.tint * 1.4}"/>` : `<rect x="${n(e.x)}" y="${n(e.y)}" width="32" height="${n(e.h)}" fill="${c}" fill-opacity="${th.tint * 1.4}"/>`);
        if (p.detail) body.push(`<path d="${p.detail}" fill="none" stroke="${c}" stroke-width="${e.kind === "lane" ? 1.4 : 1.5}" stroke-opacity="${e.kind === "lane" ? 0.8 : 0.7}" stroke-linecap="round" stroke-linejoin="round"/>`);
        if (e.kind === "frame") { if (e.text) body.push(`<text x="${n(e.x + 12)}" y="${n(e.y + FRAME_HEADER / 2 + 4.5)}" font-size="${e.fs || 13}" fill="${c}">${esc(e.text)}</text>`); }
        else if (e.kind === "lane") {
          for (const cell of laneCells(e)) body.push(`<text transform="translate(${n(cell.cx)} ${n(cell.cy + 4.5)})${cell.rot ? " rotate(-90)" : ""}" text-anchor="middle" font-size="13" fill="${th.ink}">${esc(cell.text)}</text>`);
        } else if (e.kind === "badge") body.push(labelText(String(e.n), cx, cy + 1, e.fill === 2 ? onSolid(th, colourOf(th, e)) : th.ink, Math.max(10, Math.round(Math.min(e.w, e.h) * 0.46))));
        else if (e.text) { const [lx, ly] = labelPoint(e); body.push(shapeLabel(e, lx, ly, e.fill === 2 ? onSolid(th, colourOf(th, e)) : th.ink, `<path d="${p.body}"/>`)); }
      }
    } else if (e.kind === "calc") {
      const f = Math.max(8, Math.min(18, e.w * 0.06, e.h * 0.25));
      const fillAttr = e.fill === 0 ? `fill="none"` : e.fill === 1 ? `fill="${c}" fill-opacity="${th.tint}"` : `fill="${c}" fill-opacity="0.9"`;
      body.push(`<path d="M${n(e.x)} ${n(e.y)}H${n(e.x + e.w)}V${n(e.y + e.h - f)}L${n(e.x + e.w - f)} ${n(e.y + e.h)}H${n(e.x)}Z" ${fillAttr} stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`);
      body.push(`<path d="M${n(e.x + e.w - f)} ${n(e.y + e.h)}V${n(e.y + e.h - f)}H${n(e.x + e.w)}" fill="none" stroke="${c}" stroke-width="1.5" stroke-opacity="0.7" stroke-linejoin="round"/>`);
      const rows: CalcRow[] = o.calc ? o.calc(e.text) : e.text.split("\n", 40).map((t) => ({ kind: "line", name: "", expr: t, text: "", value: null, err: "" }));
      const ink = e.fill === 2 ? onSolid(th, colourOf(th, e)) : th.ink;
      rows.forEach((r, i) => {
        if (r.kind === "blank") return;
        const ry = e.y + CALC_PAD + i * CALC_LINE + CALC_LINE / 2 + 4.5, lx = e.x + CALC_PAD, rx = e.x + e.w - CALC_PAD;
        body.push(`<text x="${n(lx)}" y="${n(ry)}" font-size="13" fill="${r.kind === "comment" ? th.mid : ink}">${esc(r.kind === "comment" ? `# ${r.expr}` : r.expr)}</text>`);
        if (r.err) body.push(`<text x="${n(rx)}" y="${n(ry)}" font-size="13" text-anchor="end" fill="${th.red}">${esc(`! ${r.err}`)}</text>`);
        else if (r.text) body.push(`<text x="${n(rx)}" y="${n(ry)}" font-size="13" font-weight="700" text-anchor="end" fill="${ink}">${esc(`→ ${r.text}`)}</text>`);
      });
    } else if (e.kind === "legend") {
      body.push(`<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(e.h)}" rx="${e.edge === 0 ? 0 : 8}" fill="${th.card}" stroke="${th.ink}" stroke-opacity="0.55" stroke-width="1.4"/>`);
      body.push(`<text x="${n(e.x + LEGEND_PAD)}" y="${n(e.y + LEGEND_PAD + LEGEND_TITLE_H / 2 + 2)}" font-size="11" font-weight="700" fill="${th.mid}">LEGEND</text>`);
      legendRows(e.text).forEach((r, i) => {
        const ry = e.y + LEGEND_PAD + LEGEND_TITLE_H + i * LEGEND_ROW_H + LEGEND_ROW_H / 2, rx = e.x + LEGEND_PAD;
        if (r.swatch === "solid" || r.swatch === "dashed") body.push(`<path d="M${n(rx)} ${n(ry)}H${n(rx + 24)}" stroke="${th.mid}" stroke-width="2" stroke-linecap="round"${r.swatch === "dashed" ? ` stroke-dasharray="5 4"` : ""}/>`);
        else { const ci = Number(r.swatch.slice(1)), sc = th.cats[(Number.isFinite(ci) ? ci : 0) % th.cats.length]!; body.push(`<rect x="${n(rx + 4)}" y="${n(ry - 7)}" width="16" height="14" rx="3" fill="${sc}" fill-opacity="${th.tint * 1.6}" stroke="${sc}" stroke-width="1.8"/>`); }
        body.push(`<text x="${n(rx + 34)}" y="${n(ry + 4.5)}" font-size="13" fill="${th.ink}">${esc(r.label)}</text>`);
      });
    } else if (e.kind === "image") {
      const reserve = e.text ? 18 : 0, href = o.images?.[e.img];
      if (href && /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(href)) body.push(`<image href="${href}" x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(Math.max(4, e.h - reserve))}" preserveAspectRatio="xMidYMid meet"/>`);
      else body.push(`<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(Math.max(4, e.h - reserve))}" fill="${c}" fill-opacity="${th.tint * 1.4}" stroke="${c}" stroke-dasharray="6 4" stroke-width="1.5"/>`);
      if (e.text) body.push(labelText(e.text, cx, e.y + e.h - 9, th.ink, 12));
    } else if (e.kind === "icon") {
      // same geometry as drawIconEl: the tile is the box minus the name strip, centred, with the name in the strip below it
      const strip = e.text ? iconStrip(e.fs) : 0, tile = Math.max(4, Math.min(e.w, e.h - strip)), tx = e.x + (e.w - tile) / 2;
      const r = e.edge === 0 ? 0 : e.edge === 1 ? tile * 0.25 : Math.min(tile * 0.45, tile / 2);
      if (isBareLogo(e)) { // borderless brand logo: the mark alone, fitted (by its content box) into the box above the name strip
        const inner = o.icons(e.iconId, "glyph"), bh = Math.max(4, e.h - strip), m = 0.04;
        if (inner && !SAFE_INNER.test(inner)) {
          const vb = logoBox(e.iconId) ?? [0, 0, 24, 24], id = symId(e.iconId, "bare");
          if (!used.has(id)) used.set(id, `<symbol id="${id}" viewBox="${vb.join(" ")}" ${ROOT_ATTRS} stroke-width="1.75">${themedLogoMarkup(inner, isDarkPaper(th.paper))}</symbol>`);
          body.push(`<use href="#${id}" x="${n(e.x + e.w * m)}" y="${n(e.y + bh * m)}" width="${n(e.w * (1 - 2 * m))}" height="${n(bh * (1 - 2 * m))}" color="${c}"/>`);
        } else body.push(labelText(e.iconId || "icon", cx, e.y + bh / 2, c, 11));
      } else {
        body.push(`<rect x="${n(tx)}" y="${n(e.y)}" width="${n(tile)}" height="${n(tile)}" rx="${n(r)}" ${shapeFill(e, c)} ${stroke(e, c, 1.8)}/>`);
        const tier = tile >= 40 ? "detail" : "glyph";
        let inner = o.icons(e.iconId, tier);
        const glyphColor = e.fill === 2 ? onSolid(th, c) : c;
        if (inner?.includes('fill="#')) inner = themedLogoMarkup(inner, isDarkPaper(th.paper), e.fill === 2); // brand logos: this theme's colours (or one colour on a solid tile)
        if (inner && !SAFE_INNER.test(inner)) {
          const id = symId(e.iconId, tier);
          if (!used.has(id)) used.set(id, `<symbol id="${id}" viewBox="0 0 ${tier === "detail" ? 64 : 24} ${tier === "detail" ? 64 : 24}" ${ROOT_ATTRS} stroke-width="${tier === "detail" ? 2 : 1.75}">${inner}</symbol>`); // the pack's markup relies on these root attributes: without them unfilled shapes render solid black
          const ins = tile * 0.16;
          body.push(`<use href="#${id}" x="${n(tx + ins)}" y="${n(e.y + ins)}" width="${n(tile - ins * 2)}" height="${n(tile - ins * 2)}" color="${glyphColor}"/>`);
        } else body.push(labelText(e.iconId || "icon", tx + tile / 2, e.y + tile / 2, glyphColor, 11));
      }
      if (e.text) body.push(labelText(e.text, cx, e.y + e.h - strip / 2, th.ink, e.fs || 12));
    }
  }

  const defs = used.size ? `<defs>${[...used.values()].join("")}</defs>` : "";
  const bg = o.background ? `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${th.paper}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}" font-family="${esc(FONT)}">${defs}${bg}${body.join("")}</svg>\n`;
}
