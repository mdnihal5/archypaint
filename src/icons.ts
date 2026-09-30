import { iconHasDetail, iconInner, iconOps, TIER_GRID, type Op, type Tier } from "./icon-pack";
import type { El } from "./scene";
import type { Theme } from "./theme";

export { ensureIcons, ensurePack, onIconsReady, listIcons, iconMeta, ROOT_ATTRS, TIER_GRID, packLoaded } from "./icon-pack";
export type { Tier, IconMeta } from "./icon-pack";

/*
 * Icon element = a tile (edge + fill style) with the icon drawn inside as vector.
 *   - tier by on-screen size: detailed (64 px grid) from ~44 px, else the 24 px glyph, else a bare tile
 *   - label (e.text) sits in a reserved strip under the tile
 * Icon packs load lazily (per pack, on first draw of one of its icons); until then the plain tile is drawn. The editor owner should call
 * renderer.invalidate(true,false) from onIconsReady() (mountPalette also does this by duck-typing
 * editor.renderer, so icons appear even if nobody else wires it).
 */

const LABEL = 18;
const DETAIL_FROM = 44; // screen px
const TILE_ONLY_BELOW = 14; // screen px
const NO_DASH: number[] = [];

const detailInset = 0.13, glyphInset = 0.2;

function drawOps(ctx: CanvasRenderingContext2D, ops: Op[], colour: string): void {
  let dashed = false;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i]!;
    if (!o.p) continue;
    if (o.fill) { ctx.globalAlpha = o.fo; ctx.fillStyle = colour; ctx.fill(o.p); }
    if (o.stroke) {
      ctx.globalAlpha = o.so; ctx.strokeStyle = colour; ctx.lineWidth = o.sw;
      if (o.dash) { ctx.setLineDash(o.dash); dashed = true; } else if (dashed) { ctx.setLineDash(NO_DASH); dashed = false; }
      ctx.stroke(o.p);
    }
  }
}

/** the icon element draws its own label (in the strip reserved inside its box); `hideText` while that label is being edited */
export function drawIconEl(ctx: CanvasRenderingContext2D, e: El, th: Theme, zoom: number, hideText = false): void {
  const col = th.cats[e.cat % th.cats.length]!;
  const reserve = e.text ? LABEL : 0;
  const tile = Math.max(4, Math.min(e.w, e.h - reserve));
  const tx = e.x + (e.w - tile) / 2, ty = e.y;
  const r = e.edge === 0 ? 0 : e.edge === 1 ? tile * 0.25 : Math.min(tile * 0.45, tile / 2);
  const screen = tile * zoom;

  ctx.beginPath();
  if (r > 0) ctx.roundRect(tx, ty, tile, tile, r); else ctx.rect(tx, ty, tile, tile);
  if (e.fill === 1) { ctx.globalAlpha = th.tint; ctx.fillStyle = col; ctx.fill(); }
  else if (e.fill === 2) { ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fill(); }
  ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 1 / zoom); ctx.stroke();

  if (screen >= TILE_ONLY_BELOW && e.iconId) {
    const tier: Tier = screen >= DETAIL_FROM && iconHasDetail(e.iconId) ? "detail" : "glyph"; // logos have only the glyph tier
    const ops = iconOps(e.iconId, tier); // requests the icon's pack in the background; null until it lands (the plain tile shows meanwhile)
    if (ops) {
      const inset = tier === "detail" ? detailInset : glyphInset;
      const size = tile * (1 - 2 * inset), s = size / TIER_GRID[tier];
      ctx.save();
      ctx.translate(tx + tile * inset, ty + tile * inset); ctx.scale(s, s);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      drawOps(ctx, ops, e.fill === 2 ? th.paper : col);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  if (e.text && zoom >= 0.5 && !hideText) {
    ctx.save();
    ctx.globalAlpha = 1; ctx.fillStyle = th.ink;
    ctx.font = "12px 'JetBrains Mono','DejaVu Sans Mono',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(e.text, e.x + e.w / 2, e.y + e.h - LABEL / 2, Math.max(20, e.w + 16));
    ctx.restore();
  }
}

/** inner SVG markup for export (wrap with ROOT_ATTRS and viewBox 0 0 N N per tier); null until the pack is loaded */
export function iconSvg(iconId: string, tier: Tier): string | null {
  return iconInner(iconId, tier);
}
