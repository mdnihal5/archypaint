import { iconHasDetail, iconInner, iconOps, logoBox, TIER_GRID, type Op, type Tier } from "./icon-pack";
import type { El } from "./scene";
import { isDarkPaper, isLogoId } from "./logos";
import { colourOf, onSolid, type Theme } from "./theme";

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
/** height of the name strip under an icon's tile: 18 at the default 12px label, growing with the label's font size */
export const iconStrip = (fs?: number): number => Math.max(LABEL, Math.round((fs || 12) * 1.5));
const DETAIL_FROM = 44; // screen px
const TILE_ONLY_BELOW = 14; // screen px
const NO_DASH: number[] = [];

const detailInset = 0.13, glyphInset = 0.2, logoInset = 0.15;
/** a borderless brand logo (fill 3 on a logo): just the mark, filling its box to this margin */
const BARE_INSET = 0.04;
const FULL_GRID: readonly number[] = [0, 0, 24, 24];

/** does this icon element draw as a bare brand mark with no tile? (fill 3 is "none"; on a drawn generic icon it falls back to the outline tile) */
export const isBareLogo = (e: Pick<El, "iconId" | "fill">): boolean => e.fill === 3 && isLogoId(e.iconId);

/**
 * Where a bare logo's mark sits: scale and offset taking the 24-grid content box `vb` (the whole grid when the logo is square) into the
 * box (bw x bh at bx,by), centred, to BARE_INSET margin. A wordmark is therefore as wide as its box allows instead of a thin line in a square.
 */
export function bareMarkTransform(vb: readonly number[], bx: number, by: number, bw: number, bh: number): { s: number; tx: number; ty: number } {
  const aw = bw * (1 - 2 * BARE_INSET), ah = bh * (1 - 2 * BARE_INSET);
  const s = Math.min(aw / vb[2]!, ah / vb[3]!);
  return { s, tx: bx + bw / 2 - (vb[0]! + vb[2]! / 2) * s, ty: by + bh / 2 - (vb[1]! + vb[3]! / 2) * s };
}

/**
 * `brand`: logo marks keep their own colour (the dark / light theme's replacement where the brand colour would vanish on the paper);
 * with it false every mark is drawn in `colour` (a solid-filled tile, where the mark must read on the tile, not on the paper).
 */
function drawOps(ctx: CanvasRenderingContext2D, ops: Op[], colour: string, brand: boolean, dark: boolean): void {
  let dashed = false;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i]!;
    if (!o.p) continue;
    if (o.fill) { ctx.globalAlpha = o.fo; ctx.fillStyle = brand && o.c ? (dark ? o.cd : o.cl) || o.c : colour; ctx.fill(o.p); }
    if (o.stroke) {
      ctx.globalAlpha = o.so; ctx.strokeStyle = colour; ctx.lineWidth = o.sw;
      if (o.dash) { ctx.setLineDash(o.dash); dashed = true; } else if (dashed) { ctx.setLineDash(NO_DASH); dashed = false; }
      ctx.stroke(o.p);
    }
  }
}

/** the icon element draws its own label (in the strip reserved inside its box); `hideText` while that label is being edited */
export function drawIconEl(ctx: CanvasRenderingContext2D, e: El, th: Theme, zoom: number, hideText = false): void {
  const col = colourOf(th, e);
  const reserve = e.text ? iconStrip(e.fs) : 0;
  const tile = Math.max(4, Math.min(e.w, e.h - reserve));
  const tx = e.x + (e.w - tile) / 2, ty = e.y;
  const r = e.edge === 0 ? 0 : e.edge === 1 ? tile * 0.25 : Math.min(tile * 0.45, tile / 2);
  const screen = tile * zoom;

  if (isBareLogo(e)) {
    // no tile: the mark alone, as big as its box allows (the name strip below is unchanged)
    const bh = Math.max(4, e.h - reserve), ops = screen >= TILE_ONLY_BELOW ? iconOps(e.iconId, "glyph") : null;
    if (ops) {
      const t = bareMarkTransform(logoBox(e.iconId) ?? FULL_GRID, e.x, e.y, e.w, bh);
      ctx.save(); ctx.translate(t.tx, t.ty); ctx.scale(t.s, t.s);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      drawOps(ctx, ops, col, true, isDarkPaper(th.paper));
      ctx.restore(); ctx.globalAlpha = 1;
    } else { // too small to read, or its pack has not landed: a faint block of the logo's colour keeps the place
      ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.fillRect(e.x + e.w * 0.2, e.y + bh * 0.2, e.w * 0.6, bh * 0.6); ctx.globalAlpha = 1;
    }
    drawIconLabel(ctx, e, th, zoom, hideText, reserve);
    return;
  }

  ctx.beginPath();
  if (r > 0) ctx.roundRect(tx, ty, tile, tile, r); else ctx.rect(tx, ty, tile, tile);
  if (e.fill === 1) { ctx.globalAlpha = th.tint; ctx.fillStyle = col; ctx.fill(); }
  else if (e.fill === 2) { ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fill(); }
  ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 1 / zoom); ctx.stroke();

  if (screen >= TILE_ONLY_BELOW && e.iconId) {
    const tier: Tier = screen >= DETAIL_FROM && iconHasDetail(e.iconId) ? "detail" : "glyph"; // logos have only the glyph tier
    const ops = iconOps(e.iconId, tier); // requests the icon's pack in the background; null until it lands (the plain tile shows meanwhile)
    if (ops) {
      const inset = tier === "detail" ? detailInset : ops[0]!.c ? logoInset : glyphInset; // brand logos fill more of the tile: they carry their own margins
      const size = tile * (1 - 2 * inset), s = size / TIER_GRID[tier];
      ctx.save();
      ctx.translate(tx + tile * inset, ty + tile * inset); ctx.scale(s, s);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      drawOps(ctx, ops, e.fill === 2 ? onSolid(th, col) : col, e.fill !== 2, isDarkPaper(th.paper));
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  drawIconLabel(ctx, e, th, zoom, hideText, reserve);
}

function drawIconLabel(ctx: CanvasRenderingContext2D, e: El, th: Theme, zoom: number, hideText: boolean, reserve: number): void {
  if (e.text && zoom >= 0.5 && !hideText) {
    ctx.save();
    ctx.globalAlpha = 1; ctx.fillStyle = th.ink;
    ctx.font = `${e.fs || 12}px 'JetBrains Mono','DejaVu Sans Mono',monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(e.text, e.x + e.w / 2, e.y + e.h - reserve / 2, Math.max(e.w + 16, 140));
    ctx.restore();
  }
}

/** inner SVG markup for export (wrap with ROOT_ATTRS and viewBox 0 0 N N per tier); null until the pack is loaded */
export function iconSvg(iconId: string, tier: Tier): string | null {
  return iconInner(iconId, tier);
}
