/** Pure mapping between world space and a small overview canvas. The overview always shows the union of the scene and the viewport. */
export interface Box { x: number; y: number; w: number; h: number }
export interface MiniMap { scale: number; ox: number; oy: number; wx: number; wy: number }

export function fitMini(scene: Box | null, view: Box, w: number, h: number, pad = 8): MiniMap {
  let x0 = view.x, y0 = view.y, x1 = view.x + view.w, y1 = view.y + view.h;
  if (scene) { x0 = Math.min(x0, scene.x); y0 = Math.min(y0, scene.y); x1 = Math.max(x1, scene.x + scene.w); y1 = Math.max(y1, scene.y + scene.h); }
  const ww = Math.max(1, x1 - x0), wh = Math.max(1, y1 - y0);
  const scale = Math.min((w - pad * 2) / ww, (h - pad * 2) / wh);
  return { scale, ox: (w - ww * scale) / 2, oy: (h - wh * scale) / 2, wx: x0, wy: y0 };
}
export const toMiniX = (m: MiniMap, x: number): number => m.ox + (x - m.wx) * m.scale;
export const toMiniY = (m: MiniMap, y: number): number => m.oy + (y - m.wy) * m.scale;
export const toWorldX = (m: MiniMap, px: number): number => m.wx + (px - m.ox) / m.scale;
export const toWorldY = (m: MiniMap, py: number): number => m.wy + (py - m.oy) / m.scale;
