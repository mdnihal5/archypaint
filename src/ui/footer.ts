import type { Ctx } from "./ctx";
import { h, setText } from "./dom";

/** Unobtrusive status line: shapes, visible, last/p95 frame cost. Updated from the shared 500 ms tick, only when shown. */
export function mountFooter(ctx: Ctx, root: HTMLElement): void {
  const { editor } = ctx;
  const el = h("div", { class: "ap-hud", attrs: { "aria-hidden": "true" } });
  root.append(el);
  const paint = () => {
    if (!ctx.settings.get().hud) return;
    const r = ctx.hud;
    const idle = !r || performance.now() - r.lastFrameAt > 600;
    setText(el, `${editor.scene.els.size} shapes${r ? ` · ${r.visibleCount} visible · ${idle ? "idle" : r.lastFrameMs.toFixed(1) + " ms"} · p95 ${r.p95().toFixed(1)} ms${r.degraded ? " · simplified" : ""}` : ""}`);
  };
  ctx.onSlowTick(paint);
  ctx.d.add(ctx.settings.subscribe(paint));
  ctx.d.add(() => el.remove());
  paint();
}
