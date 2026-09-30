import { h, Disposer } from "./dom";

export interface ModalHost { back: HTMLElement; modal: HTMLElement; close(): void }

let openCount = 0;
export const modalOpen = (): boolean => openCount > 0;

/** Generic modal: backdrop, focus trap, Escape / backdrop-click close, focus restored. Fully torn down on close. */
export function openModal(root: HTMLElement, content: Node[], onClose?: () => void): ModalHost {
  const prev = document.activeElement as HTMLElement | null;
  const d = new Disposer();
  const modal = h("div", { class: "ap-modal", attrs: { role: "dialog", "aria-modal": "true" } }, ...content);
  const back = h("div", { class: "ap-back" }, modal);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; openCount--; d.dispose(); back.remove(); prev?.focus?.(); onClose?.();
  };
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  d.on(document, "keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...modal.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
    if (!f.length) return;
    const first = f[0]!, last = f[f.length - 1]!, a = document.activeElement;
    if (e.shiftKey && (a === first || !modal.contains(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || !modal.contains(a))) { e.preventDefault(); first.focus(); }
  }, { capture: true });
  root.append(back); openCount++;
  queueMicrotask(() => (modal.querySelector<HTMLElement>("[data-autofocus]") ?? modal.querySelector<HTMLElement>("button"))?.focus());
  return { back, modal, close };
}

export function confirmDialog(root: HTMLElement, msg: string, yes = "Discard"): { promise: Promise<boolean>; close(): void } {
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  let answered = false;
  const answer = (v: boolean) => { if (answered) return; answered = true; resolve(v); host.close(); };
  const host = openModal(root, [
    h("h2", { text: "Are you sure?" }),
    h("p", { text: msg, style: { margin: "0", "max-width": "44ch" } }),
    h("div", { class: "ap-actions" },
      h("button", { class: "ap-btn", text: "Cancel", attrs: { type: "button" }, on: { click: () => answer(false) } }),
      h("button", { class: "ap-btn", text: yes, attrs: { type: "button", "data-autofocus": "1" }, on: { click: () => answer(true) } })),
  ], () => answer(false));
  return { promise, close: () => answer(false) };
}

const KEYS: Array<[string, Array<[string, string]>]> = [
  ["Tools", [["Select", "V"], ["Hand (or hold Space)", "H"], ["Rectangle", "R"], ["Diamond", "D"], ["Ellipse", "O"], ["Arrow", "A"], ["Line", "L"], ["Text", "T"], ["Keep the tool after each shape: double-click it", "Q"]]],
  ["Icons", [["Place an icon", "/  or  I"], ["Close search", "Esc"]]],
  ["Edit", [["Undo", "⌘Z"], ["Redo", "⇧⌘Z"], ["Duplicate", "⌘D"], ["Select all", "⌘A"], ["Delete", "⌫"], ["Group", "⌘G"], ["Ungroup", "⇧⌘G"]]],
  ["Arrange", [["Bring to front", "⇧⌘]"], ["Bring forward", "⌘]"], ["Send backward", "⌘["], ["Send to back", "⇧⌘["]]],
  ["Align & distribute", [["Align left / right", "⌥⇧← / →"], ["Align top / bottom", "⌥⇧↑ / ↓"], ["Centre horizontally / vertically", "⌥⇧H / V"], ["Distribute horizontally / vertically", "⌥⇧X / Y"], ["Match size", "⌥⇧S"]]],
  ["Style & lock", [["Copy style", "⌥⌘C"], ["Paste style", "⌥⌘V"], ["Lock / unlock", "⇧⌘L"]]],
  ["View", [["Zoom in / out", "+  /  −"], ["Reset zoom", "⌘0"], ["Fit to content", "⇧1"], ["Find in sheet", "⌘F"], ["Minimap", "M"], ["Background grid / plain", "B"], ["This list", "?"]]],
  ["File", [["Open", "⌘O"], ["Save", "⌘S"], ["Save as", "⇧⌘S"], ["Export PNG", "⇧⌘E"]]],
];

export function shortcutsContent(): Node[] {
  const grid = h("div", { class: "ap-keys" });
  for (const [title, rows] of KEYS) {
    grid.append(h("h3", { text: title }));
    for (const [what, k] of rows) grid.append(h("div", {}, h("span", { text: what }), h("kbd", { text: k })));
  }
  return [h("h2", { text: "Keyboard shortcuts" }), grid, h("div", { class: "ap-actions" }, h("button", { class: "ap-btn", text: "Close", attrs: { type: "button", "data-autofocus": "1" } }))];
}
