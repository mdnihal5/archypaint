import type { EditorAPI } from "../editor-api";
import type { IO } from "../io";
import type { Palette } from "../palette";
import { makeUpdaterApi, type Ctx, type HudSource } from "./ctx";
import { confirmDialog, modalOpen, openModal, shortcutsContent } from "./modal";
import { Disposer, h, installInputTracker, updaterStats } from "./dom";
import { mountBottom } from "./bottom";
import { mountBrand } from "./brand";
import { mountFooter } from "./footer";
import { mountFind } from "./find";
import { mountKeys } from "./keys";
import { mountMinimap } from "./minimap";
import { mountRight } from "./right";
import { mountSheet } from "./home";
import { mountTools } from "./tools";
import { mountTop } from "./top";
import { createToasts } from "./toast";
import type { SettingsStore } from "./settings";

export interface UiDeps { editor: EditorAPI; io: IO; palette: Palette; settings: SettingsStore; hud?: HudSource }
export interface UiHandle {
  root: HTMLElement;
  refresh(): void;
  /** show a short, non-blocking notice */
  toast(msg: string, kind?: "ok" | "err"): void;
  /** per-updater run/drop counters — used by the no-render-loop check */
  stats(): Record<string, { runs: number; drops: number }>;
  dispose(): void;
}

/** Mount the whole chrome. Everything it attaches (DOM, window listeners, editor subscriptions, timers, observers) is released by dispose(). */
export function mountUI(deps: UiDeps): UiHandle {
  const { editor, io, palette, settings } = deps;
  const d = new Disposer();
  const root = h("div", { attrs: { id: "ui" } });
  document.body.append(root);
  d.add(() => root.remove());
  installInputTracker(d);

  const toasts = createToasts(root);
  d.add(() => toasts.dispose());
  const api = makeUpdaterApi(d, editor);
  const slow: Array<() => void> = [];
  let closeShortcuts: (() => void) | null = null;
  let pendingConfirm: { close(): void } | null = null;

  const ctx: Ctx = {
    editor, io, palette, settings, hud: deps.hud, d,
    update: api.update, wire: api.wire, refresh: api.refresh,
    onSlowTick: (fn) => { slow.push(fn); },
    toast: toasts.toast,
    confirm: (msg, yes) => { const c = confirmDialog(root, msg, yes); pendingConfirm = c; return c.promise; },
    showShortcuts() {
      if (closeShortcuts) { closeShortcuts(); return; }
      const m = openModal(root, shortcutsContent(), () => { closeShortcuts = null; });
      m.modal.querySelector<HTMLElement>("button")?.addEventListener("click", () => m.close());
      closeShortcuts = m.close;
    },
    run(fn) { Promise.resolve().then(fn).catch((e: unknown) => toasts.toast(e instanceof Error ? e.message : String(e), "err")); },
    modalOpen,
  };
  d.add(() => { closeShortcuts?.(); pendingConfirm?.close(); });

  const sheet = mountSheet(ctx, root);
  mountTools(ctx, root);
  const right = mountRight(ctx, root);
  mountBottom(ctx, root);
  const top = mountTop(ctx, root, right);
  mountBrand(ctx, root);
  mountFooter(ctx, root);
  mountKeys(ctx);
  mountFind(ctx, root);
  mountMinimap(ctx, root);

  // keep both name fields (top bar and title block) in step without ever clobbering one being typed in
  const sync = ctx.update("docname", () => {
    const n = io.docName();
    for (const i of [top.nameInput, sheet.titleInput]) if (document.activeElement !== i && i.value !== n) i.value = n;
  });
  ctx.wire(sync, "change");
  ctx.onSlowTick(() => { const n = io.docName(); if (top.nameInput.value !== n && document.activeElement !== top.nameInput) sync.schedule(); });

  // direct scene mutations (benchmarks, load paths) may not emit an editor event: notice a changed scene cheaply
  let seenNonce = editor.scene.nonce;
  ctx.onSlowTick(() => { if (editor.scene.nonce !== seenNonce) { seenNonce = editor.scene.nonce; api.refresh(); } });

  d.interval(() => { for (const f of slow) f(); }, 500);
  d.on(window, "beforeunload", (e: BeforeUnloadEvent) => { if (editor.dirty()) { e.preventDefault(); e.returnValue = ""; } });

  return {
    root,
    refresh: api.refresh,
    toast: toasts.toast,
    stats: () => Object.fromEntries(updaterStats),
    dispose: () => d.dispose(),
  };
}
