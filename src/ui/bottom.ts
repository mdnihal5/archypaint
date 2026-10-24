import type { Ctx } from "./ctx";
import { glyph, type GlyphName } from "./glyphs";
import { h, setText } from "./dom";

/** Bottom-right: zoom out / percent (click = reset) / zoom in / fit. Undo and redo live in the dock. */
export function mountBottom(ctx: Ctx, root: HTMLElement): void {
  const { editor } = ctx;
  const ib = (g: GlyphName, label: string, fn: () => void) =>
    h("button", { class: "ap-ib", attrs: { type: "button", title: label, "aria-label": label }, on: { click: () => { fn(); ctx.refresh(); } } }, glyph(g, 18));
  const zoom = h("button", { class: "ap-zoom", attrs: { type: "button", title: "Reset zoom (⌘0)", "aria-label": "Reset zoom" }, on: { click: () => { editor.resetView(); ctx.refresh(); } } });
  const wrap = h("div", { class: "ap-zoombar ap-hit", attrs: { role: "group", "aria-label": "Zoom" } },
    ib("minus", "Zoom out (−)", () => editor.zoomBy(1 / 1.2)), zoom, ib("plus", "Zoom in (+)", () => editor.zoomBy(1.2)), ib("fit", "Fit to content (⇧1)", () => editor.zoomToFit()));
  root.append(wrap);

  let lastPct = -1;
  const render = () => {
    lastPct = Math.round(editor.vp.zoom * 100);
    setText(zoom, `${lastPct}%`);
  };
  const u = ctx.update("bottom", render);
  ctx.wire(u, "change", "viewport");
  // wheel/pinch zoom may not emit 'viewport': poll cheaply and only schedule a real update when the number changed
  ctx.onSlowTick(() => { if (Math.round(editor.vp.zoom * 100) !== lastPct) u.schedule(); });
  ctx.d.add(() => wrap.remove());
  render();
}
