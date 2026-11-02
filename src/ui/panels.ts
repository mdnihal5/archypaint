import type { Ctx } from "./ctx";
import type { LayersPanel } from "./layers";
import type { Ribbon } from "./ribbon";
import { loadPrefs } from "./props-pos";

/**
 * The panels the viewer opens: the layers card (setting + non-empty scene) and the properties ribbon above the dock.
 * The ribbon opens only when the viewer asks (`I` or the toggle button), never on selection, and its code and DOM are built on
 * the first open: a closed ribbon costs nothing at load. The layers card is off by default, so its code is a lazy chunk too, fetched
 * the first time it would show. One updater renders both.
 */
export function mountPanels(ctx: Ctx, root: HTMLElement): void {
  let layers: LayersPanel | null = null, layersLoading = false;
  const wantLayers = () => ctx.settings.get().layers && ctx.editor.scene.els.size > 0;
  let ribbon: Ribbon | null = null, loading = false, gone = false;
  let wantOpen = loadPrefs().open; // the stored "open" flag: mounted on the first idle moment, not at load

  const u = ctx.update("panels", () => {
    ribbon?.render();
    if (layers) layers.render();
    else if (wantLayers() && !layersLoading) {
      layersLoading = true;
      void import("./layers").then((m) => { if (!gone) { layers = m.mountLayers(ctx, root); u.schedule(); } }, () => { layersLoading = false; });
    }
  });
  const load = (then?: () => void) => {
    if (ribbon) { then?.(); return; }
    if (loading) return;
    loading = true;
    void import("./ribbon").then((m) => {
      if (gone) return;
      ribbon = m.mountRibbon(ctx, root);
      then?.();
      u.schedule();
    }, (e: unknown) => { loading = false; ctx.toast(e instanceof Error ? e.message : "Couldn't load the properties panel.", "err"); });
  };
  const toggle = () => {
    if (ribbon) { ribbon.toggle(); return; }
    wantOpen = false;
    load(() => { if (!ribbon!.isOpen()) ribbon!.toggle(); });
    ctx.refresh();
  };
  ctx.toggleProps = toggle;
  ctx.propsOpen = () => (ribbon ? ribbon.isOpen() : wantOpen || loading);
  ctx.d.add(() => { gone = true; if (ctx.toggleProps === toggle) { ctx.toggleProps = undefined; ctx.propsOpen = undefined; } });
  if (wantOpen) load();

  // the ribbon follows selection and edits, never opens by itself
  ctx.wire(u, "change", "selection", "edit");
  ctx.d.add(ctx.settings.subscribe(() => u.schedule()));
  u.schedule();
}
