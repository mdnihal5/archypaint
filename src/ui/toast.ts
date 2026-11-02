import { h } from "./dom";

const MAX = 3;

/** a toast's one button (Undo): `run` fires once, then the toast goes; `ms` is how long it stays (default 7 s: long enough to notice and click) */
export interface ToastAction { label: string; run(): void; ms?: number }

/**
 * Toast stack. Timers are tracked so dispose() leaves nothing pending.
 * An identical toast (same text and kind) that is already showing is not stacked again: its timer restarts and it stays
 * where it is. Autosave announces "Saved" after every quiet period, so an editing session used to pile up a column of them.
 */
export function createToasts(root: HTMLElement): { toast(msg: string, kind?: "ok" | "err", action?: ToastAction): void; dispose(): void } {
  const box = h("div", { class: "ap-toasts", attrs: { role: "status", "aria-live": "polite" } });
  root.append(box);
  const live = new Map<string, { el: HTMLElement; t: ReturnType<typeof setTimeout>; run?: () => void }>();
  const drop = (key: string) => { const x = live.get(key); if (!x) return; clearTimeout(x.t); x.el.remove(); live.delete(key); };
  return {
    toast(msg, kind = "ok", action) {
      const key = `${kind}\u0000${msg}`, ms = action ? (action.ms ?? 7000) : kind === "err" ? 5000 : 2400;
      const same = live.get(key);
      if (same) { clearTimeout(same.t); same.t = setTimeout(() => drop(key), ms); if (action) same.run = action.run; return; }
      while (live.size >= MAX) drop(live.keys().next().value as string); // oldest first: Map order is DOM order
      const cls = kind === "err" ? "ap-toast err" : "ap-toast";
      const entry: { el: HTMLElement; t: ReturnType<typeof setTimeout>; run?: () => void } = { el: null as never, t: setTimeout(() => drop(key), ms) };
      if (action) {
        entry.run = action.run;
        const btn = h("button", { class: "ap-tact", attrs: { type: "button" }, text: action.label, on: { click: () => { const r = entry.run; drop(key); r?.(); } } });
        entry.el = h("div", { class: `${cls} ap-tu` }, h("span", { text: msg }), btn);
      } else entry.el = h("div", { class: cls, text: msg });
      box.append(entry.el);
      live.set(key, entry);
    },
    dispose() { for (const v of live.values()) clearTimeout(v.t); live.clear(); box.remove(); },
  };
}
