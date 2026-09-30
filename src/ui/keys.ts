import type { Ctx } from "./ctx";
import { ACTIONS } from "../features";
import { isTyping } from "./dom";

/**
 * Global shortcuts owned by the chrome: icon palette, shortcut list, background, view (fit / zoom keys), and file
 * commands. Tool letters, undo/redo, group, arrange and delete belong to the editor core, which owns those commands.
 */
export function mountKeys(ctx: Ctx): void {
  const { editor, io, palette, settings } = ctx;
  ctx.d.on(window, "keydown", (e: KeyboardEvent) => {
    if (e.defaultPrevented || isTyping(e.target) || ctx.modalOpen() || palette.isOpen()) return;
    const meta = e.metaKey || e.ctrlKey;
    // feature shortcuts (exact modifier match), before the built-ins
    const k0 = e.key.toLowerCase();
    for (const a of ACTIONS) {
      const k = a.key;
      if (!k || k.key !== k0 || !!k.mod !== meta || !!k.shift !== e.shiftKey || !!k.alt !== e.altKey) continue;
      const fc = { editor, io, toast: ctx.toast, confirm: ctx.confirm, stage: document.getElementById("stage") ?? document.body };
      if (a.enabled && !a.enabled(fc)) continue;
      e.preventDefault(); ctx.run(() => a.run(fc)); return;
    }
    if (meta) {
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); ctx.run(() => (e.shiftKey ? io.saveAs() : io.save())); }
      else if (k === "o") { e.preventDefault(); const go = () => ctx.run(() => io.open()); if (editor.dirty()) void ctx.confirm("This sheet has unsaved changes. Discard them?").then((ok) => ok && go()); else go(); }
      else if (k === "e" && e.shiftKey) { e.preventDefault(); ctx.run(() => io.exportPng({ scale: 2, background: true })); }
      return;
    }
    if (e.altKey) return;
    switch (e.key) {
      case "/": case "i": case "I": e.preventDefault(); palette.open(); break;
      case "?": e.preventDefault(); ctx.showShortcuts(); break;
      case "b": case "B": settings.set({ bg: settings.get().bg === "grid" ? "plain" : "grid" }); ctx.refresh(); break;
      case "!": editor.zoomToFit(); ctx.refresh(); break; // shift+1 on a US layout
      case "+": case "=": editor.zoomBy(1.2); ctx.refresh(); break;
      case "-": case "_": editor.zoomBy(1 / 1.2); ctx.refresh(); break;
    }
  });
}
