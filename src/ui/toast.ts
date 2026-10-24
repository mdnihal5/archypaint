import { h } from "./dom";

const MAX = 3;

/**
 * Toast stack. Timers are tracked so dispose() leaves nothing pending.
 * An identical toast (same text and kind) that is already showing is not stacked again: its timer restarts and it stays
 * where it is. Autosave announces "Saved" after every quiet period, so an editing session used to pile up a column of them.
 */
export function createToasts(root: HTMLElement): { toast(msg: string, kind?: "ok" | "err"): void; dispose(): void } {
  const box = h("div", { class: "ap-toasts", attrs: { role: "status", "aria-live": "polite" } });
  root.append(box);
  const live = new Map<string, { el: HTMLElement; t: ReturnType<typeof setTimeout> }>();
  const drop = (key: string) => { const x = live.get(key); if (!x) return; clearTimeout(x.t); x.el.remove(); live.delete(key); };
  return {
    toast(msg, kind = "ok") {
      const key = `${kind}\u0000${msg}`, ms = kind === "err" ? 5000 : 2400;
      const same = live.get(key);
      if (same) { clearTimeout(same.t); same.t = setTimeout(() => drop(key), ms); return; }
      while (live.size >= MAX) drop(live.keys().next().value as string); // oldest first: Map order is DOM order
      const el = h("div", { class: kind === "err" ? "ap-toast err" : "ap-toast", text: msg });
      box.append(el);
      live.set(key, { el, t: setTimeout(() => drop(key), ms) });
    },
    dispose() { for (const v of live.values()) clearTimeout(v.t); live.clear(); box.remove(); },
  };
}
