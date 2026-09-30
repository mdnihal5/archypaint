import type { ElLike } from "./format";
import type { Theme } from "../theme";
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

export function arrowLabelPos(e: ElLike): P {
  const p = arrowPoints(e);
  let total = 0; const seg: number[] = [];
  for (let i = 1; i < p.length; i++) { const l = Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]); seg.push(l); total += l; }
  let half = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i]! || i === seg.length - 1) { const t = seg[i]! ? half / seg[i]! : 0; return [p[i]![0] + (p[i + 1]![0] - p[i]![0]) * t, p[i]![1] + (p[i + 1]![1] - p[i]![1]) * t]; }
    half -= seg[i]!;
  }
  return p[0]!;
}

/* ------------------------------------------------------------------ SVG document */

export interface SvgOpts { background: boolean; padding: number; icons: (id: string, tier: "detail" | "glyph") => string | null }

const symId = (id: string, tier: string) => `ap-ic-${id.replace(/[^\w-]/g, "_")}-${tier}`;
const SAFE_INNER = /<\s*(script|foreignObject|image|iframe|use|style)\b|\son\w+\s*=|(?:xlink:)?href\s*=/i;

function labelText(text: string, cx: number, cy: number, fill: string, size = 13, halo?: string): string {
  const lines = text.split("\n").slice(0, 50);
  const lh = size * 1.25;
  const y0 = cy - ((lines.length - 1) * lh) / 2 + size * 0.36;
  const tsp = lines.map((l, i) => `<tspan x="${n(cx)}" y="${n(y0 + i * lh)}">${esc(l)}</tspan>`).join("");
  return `<text text-anchor="middle" font-size="${size}" fill="${fill}"${halo ? ` stroke="${halo}" stroke-width="4" paint-order="stroke" stroke-linejoin="round"` : ""}>${tsp}</text>`;
}

export function buildSvg(els: readonly ElLike[], th: Theme, o: SvgOpts): string {
  const list = [...els].sort((a, b) => a.z - b.z);
  const b = unionBounds(list) ?? { x: 0, y: 0, w: 64, h: 64 };
  const x = b.x - o.padding, y = b.y - o.padding, w = Math.max(1, b.w + o.padding * 2), h = Math.max(1, b.h + o.padding * 2);
  const col = (e: ElLike) => th.cats[e.cat % th.cats.length]!;
  const used = new Map<string, string>(); // symbol id -> <symbol> markup
  const body: string[] = [];

  const shapeFill = (e: ElLike, c: string) => e.fill === 0 ? `fill="none"` : e.fill === 1 ? `fill="${c}" fill-opacity="${th.tint}"` : `fill="${c}"`;
  const stroke = (e: ElLike, c: string, sw = 2) => `stroke="${c}" stroke-width="${sw}"${e.dash ? ` stroke-dasharray="7 6"` : ""} stroke-linejoin="round" stroke-linecap="round"`;

  for (const e of list) {
    const c = col(e);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const labelFill = e.fill === 2 && e.kind !== "text" ? th.paper : th.ink;
    if (e.kind === "rect") {
      body.push(`<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(e.h)}" rx="${e.edge === 0 ? 0 : n(Math.min(e.radius, Math.min(e.w, e.h) / 2))}" ${shapeFill(e, c)} ${stroke(e, c)}/>`);
      if (e.text) body.push(labelText(e.text, cx, cy, labelFill));
    } else if (e.kind === "ellipse") {
      body.push(`<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(e.w / 2)}" ry="${n(e.h / 2)}" ${shapeFill(e, c)} ${stroke(e, c)}/>`);
      if (e.text) body.push(labelText(e.text, cx, cy, labelFill));
    } else if (e.kind === "diamond") {
      body.push(`<polygon points="${n(cx)},${n(e.y)} ${n(e.x + e.w)},${n(cy)} ${n(cx)},${n(e.y + e.h)} ${n(e.x)},${n(cy)}" ${shapeFill(e, c)} ${stroke(e, c)}/>`);
      if (e.text) body.push(labelText(e.text, cx, cy, labelFill));
    } else if (e.kind === "text") {
      if (e.text) body.push(labelText(e.text, cx, cy, th.ink));
    } else if (e.kind === "arrow") {
      body.push(`<path d="${arrowPathD(e)}" fill="none" ${stroke(e, c)}/>`);
      const hd = arrowHead(e);
      if (hd.chevron) body.push(`<path d="${hd.chevron}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
      if (hd.dot) body.push(`<circle cx="${n(hd.dot.x)}" cy="${n(hd.dot.y)}" r="${hd.dot.r}" fill="${c}"/>`);
      if (e.text) { const [lx, ly] = arrowLabelPos(e); body.push(labelText(e.text, lx, ly, th.ink, 12, th.paper)); }
    } else if (PATH_KINDS.has(e.kind)) {
      const p = shapeParts(e);
      if (!p) continue;
      const container = CONTAINER_KINDS.has(e.kind);
      const dashed = e.kind === "frame" ? e.dash !== 0 : e.dash === 1;
      const st = `stroke="${c}" stroke-width="2"${dashed ? ` stroke-dasharray="9 7"` : ""} stroke-linejoin="${e.edge === 0 ? "miter" : "round"}" stroke-linecap="round"`;
      if (p.open) body.push(`<path d="${p.body}" fill="none" ${st}/>`);
      else {
        const fillAttr = e.fill === 0 ? `fill="none"` : e.fill === 1 ? `fill="${c}" fill-opacity="${container ? th.tint * 0.55 : th.tint}"` : container ? `fill="${c}" fill-opacity="0.16"` : `fill="${c}"`;
        body.push(`<path d="${p.body}" ${fillAttr} ${st}/>`);
        if (e.kind === "lane") body.push(e.o === 1 ? `<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="28" fill="${c}" fill-opacity="${th.tint * 1.4}"/>` : `<rect x="${n(e.x)}" y="${n(e.y)}" width="32" height="${n(e.h)}" fill="${c}" fill-opacity="${th.tint * 1.4}"/>`);
        if (p.detail) body.push(`<path d="${p.detail}" fill="none" stroke="${c}" stroke-width="${e.kind === "lane" ? 1.4 : 1.5}" stroke-opacity="${e.kind === "lane" ? 0.8 : 0.7}" stroke-linecap="round" stroke-linejoin="round"/>`);
        if (e.kind === "frame") { if (e.text) body.push(`<text x="${n(e.x + 12)}" y="${n(e.y + FRAME_HEADER / 2 + 4.5)}" font-size="13" fill="${c}">${esc(e.text)}</text>`); }
        else if (e.kind === "lane") {
          for (const cell of laneCells(e)) body.push(`<text transform="translate(${n(cell.cx)} ${n(cell.cy + 4.5)})${cell.rot ? " rotate(-90)" : ""}" text-anchor="middle" font-size="13" fill="${th.ink}">${esc(cell.text)}</text>`);
        } else if (e.kind === "badge") body.push(labelText(String(e.n), cx, cy + 1, e.fill === 2 ? th.paper : th.ink, Math.max(10, Math.round(Math.min(e.w, e.h) * 0.46))));
        else if (e.text) { const [lx, ly] = labelPoint(e); body.push(labelText(e.text, lx, ly, e.fill === 2 ? th.paper : th.ink)); }
      }
    } else if (e.kind === "legend") {
      body.push(`<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(e.h)}" rx="${e.edge === 0 ? 0 : 8}" fill="${th.card}" stroke="${th.ink}" stroke-opacity="0.55" stroke-width="1.4"/>`);
      body.push(`<text x="${n(e.x + LEGEND_PAD)}" y="${n(e.y + LEGEND_PAD + LEGEND_TITLE_H / 2 + 2)}" font-size="11" font-weight="700" fill="${th.mid}">LEGEND</text>`);
      legendRows(e.text).forEach((r, i) => {
        const ry = e.y + LEGEND_PAD + LEGEND_TITLE_H + i * LEGEND_ROW_H + LEGEND_ROW_H / 2, rx = e.x + LEGEND_PAD;
        if (r.swatch === "solid" || r.swatch === "dashed") body.push(`<path d="M${n(rx)} ${n(ry)}H${n(rx + 24)}" stroke="${th.mid}" stroke-width="2" stroke-linecap="round"${r.swatch === "dashed" ? ` stroke-dasharray="5 4"` : ""}/>`);
        else { const ci = Number(r.swatch.slice(1)), sc = th.cats[(Number.isFinite(ci) ? ci : 0) % th.cats.length]!; body.push(`<rect x="${n(rx + 4)}" y="${n(ry - 7)}" width="16" height="14" rx="3" fill="${sc}" fill-opacity="${th.tint * 1.6}" stroke="${sc}" stroke-width="1.8"/>`); }
        body.push(`<text x="${n(rx + 34)}" y="${n(ry + 4.5)}" font-size="13" fill="${th.ink}">${esc(r.label)}</text>`);
      });
    } else if (e.kind === "icon") {
      const r = e.edge === 0 ? 0 : Math.min(e.radius + 4, Math.min(e.w, e.h) / 2);
      body.push(`<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(e.h)}" rx="${n(r)}" ${shapeFill(e, c)} ${stroke(e, c, 1.8)}/>`);
      const tier = Math.max(e.w, e.h) >= 40 ? "detail" : "glyph";
      const inner = o.icons(e.iconId, tier);
      const glyphColor = e.fill === 2 ? th.paper : c;
      if (inner && !SAFE_INNER.test(inner)) {
        const id = symId(e.iconId, tier);
        if (!used.has(id)) used.set(id, `<symbol id="${id}" viewBox="0 0 ${tier === "detail" ? 64 : 24} ${tier === "detail" ? 64 : 24}">${inner}</symbol>`);
        const ins = Math.min(e.w, e.h) * 0.16;
        body.push(`<use href="#${id}" x="${n(e.x + ins)}" y="${n(e.y + ins)}" width="${n(e.w - ins * 2)}" height="${n(e.h - ins * 2)}" color="${glyphColor}"/>`);
      } else body.push(labelText(e.iconId || "icon", cx, cy, glyphColor, 11));
      if (e.text) body.push(labelText(e.text, cx, e.y + e.h + 14, th.ink, 12));
    }
  }

  const defs = used.size ? `<defs>${[...used.values()].join("")}</defs>` : "";
  const bg = o.background ? `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${th.paper}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}" font-family="${esc(FONT)}">${defs}${bg}${body.join("")}</svg>\n`;
}
