import { h } from "./dom";

const MAX = 3;

/** Toast stack. Timers are tracked so dispose() leaves nothing pending. */
export function createToasts(root: HTMLElement): { toast(msg: string, kind?: "ok" | "err"): void; dispose(): void } {
  const box = h("div", { class: "ap-toasts", attrs: { role: "status", "aria-live": "polite" } });
  root.append(box);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    toast(msg, kind = "ok") {
      while (box.children.length >= MAX) box.firstElementChild?.remove();
      const el = h("div", { class: kind === "err" ? "ap-toast err" : "ap-toast", text: msg });
      box.append(el);
      const t = setTimeout(() => { el.remove(); timers.delete(t); }, kind === "err" ? 5000 : 2400);
      timers.add(t);
    },
    dispose() { timers.forEach(clearTimeout); timers.clear(); box.remove(); },
  };
}
