import type { Ctx } from "./ctx";
import { Disposer, h, setAttr, setText } from "./dom";
import { glyph } from "./glyphs";
import type { SaveStatus } from "../io";

type SegOpt<T extends string | number> = readonly [T, string];

export interface Top { nameInput: HTMLInputElement; refresh(): void }

/** Top-left: menu button + popover, sheet name (bound to IO), save state, and the narrow-screen panel toggles. */
export function mountTop(ctx: Ctx, root: HTMLElement, right: { toggleNarrow(): void }): Top {
  const { editor, io, settings } = ctx;

  /* ---------- menu ---------- */
  let menu: HTMLElement | null = null;
  let menuD: Disposer | null = null;
  const btn = h("button", { class: "ap-btn icon", attrs: { type: "button", title: "Menu", "aria-label": "Menu", "aria-haspopup": "true", "aria-expanded": "false" } }, glyph("menu", 20));

  const closeMenu = (refocus = true) => {
    if (!menu) return;
    menuD?.dispose(); menuD = null; menu.remove(); menu = null;
    btn.setAttribute("aria-expanded", "false");
    if (refocus) btn.focus();
  };
  const guarded = (fn: () => Promise<void> | void) => () => {
    closeMenu(false);
    if (editor.dirty()) void ctx.confirm("This sheet has unsaved changes. Discard them?").then((ok) => { if (ok) ctx.run(fn); });
    else ctx.run(fn);
  };
  const act = (fn: () => Promise<void> | void) => () => { closeMenu(false); ctx.run(fn); };

  const item = (label: string, kbd: string, fn: () => void, disabled = false) =>
    h("button", { class: "ap-mi", attrs: { type: "button", role: "menuitem", disabled }, on: { click: fn } }, h("span", { text: label }), h("span", { class: "ap-kbd", text: kbd }));
  const sec = (t: string) => h("div", { class: "ap-msec ap-label", text: t });
  const sep = () => h("div", { class: "ap-msep" });
  const segRow = <T extends string | number>(label: string, opts: ReadonlyArray<SegOpt<T>>, get: () => T, set: (v: T) => void) => {
    const btns = opts.map(([v, l]) => h("button", { class: "ap-btn", text: l, attrs: { type: "button", role: "radio", "aria-checked": "false" }, on: { click: () => { set(v); sync(); ctx.refresh(); } } }));
    const sync = () => btns.forEach((b, i) => setAttr(b, "aria-checked", opts[i]![0] === get() ? "true" : "false"));
    sync();
    return h("div", { class: "ap-mrow" }, h("span", { text: label }), h("div", { class: "ap-seg", attrs: { role: "radiogroup", "aria-label": label } }, ...btns));
  };
  const onoff = (label: string, get: () => boolean, set: (v: boolean) => void) =>
    segRow<"on" | "off">(label, [["on", "on"], ["off", "off"]], () => (get() ? "on" : "off"), (v) => set(v === "on"));

  const openMenu = () => {
    if (menu) { closeMenu(); return; }
    const sel = editor.selection().size > 0;
    menu = h("div", { class: "ap-menu ap-hit", attrs: { role: "menu", "aria-label": "Main menu" } },
      sec("File"),
      item("New", "", guarded(() => io.newDoc())),
      item("Open…", "⌘O", guarded(() => io.open())),
      item("Save", "⌘S", act(() => io.save())),
      item("Save as…", "⇧⌘S", act(() => io.saveAs())),
      sep(), sec("Export"),
      item("Export PNG", "⇧⌘E", act(() => io.exportPng({ scale: 2, background: true }))),
      ...(sel ? [item("Export selection as PNG", "", act(() => io.exportPng({ scale: 2, background: true, selectionOnly: true })))] : []),
      item("Export SVG", "", act(() => io.exportSvg({ background: true }))),
      item("Copy as PNG", "", act(() => io.copyPng({ scale: 2, background: true }))),
      item("Import Excalidraw…", "", guarded(() => io.importExcalidraw())),
      item("Export Excalidraw", "", act(() => io.exportExcalidraw())),
      sep(), sec("View"),
      segRow("Theme", [["light", "light"], ["dark", "dark"], ["system", "system"]], () => settings.get().theme, (v) => settings.set({ theme: v })),
      segRow("Background", [["grid", "grid"], ["plain", "plain"]], () => settings.get().bg, (v) => settings.set({ bg: v })),
      onoff("Sheet frame", () => settings.get().frame, (v) => settings.set({ frame: v })),
      onoff("Layers panel", () => settings.get().layers, (v) => settings.set({ layers: v })),
      onoff("Minimap (M)", () => settings.get().minimap, (v) => settings.set({ minimap: v })),
      onoff("Status footer", () => settings.get().hud, (v) => settings.set({ hud: v })),
      sep(), sec("Insert"),
      item("Find…", "⌘F", () => { closeMenu(false); ctx.openFind?.(); }),
      item("Legend of categories and lines", "", act(() => { editor.insertLegend(); })),
      item("Renumber step badges", "", act(() => editor.renumberBadges())),
      sep(), sec("New shapes"),
      segRow("Edge", [[0, "sharp"], [1, "round"], [2, "soft"]], () => editor.defaults.edge, (v) => editor.setDefaults({ edge: v as 0 | 1 | 2 })),
      segRow("Fill", [[0, "outline"], [1, "tint"], [2, "solid"]], () => editor.defaults.fill, (v) => editor.setDefaults({ fill: v as 0 | 1 | 2 })),
      sep(),
      item("Keyboard shortcuts", "?", () => { closeMenu(false); ctx.showShortcuts(); }));
    root.append(menu);
    btn.setAttribute("aria-expanded", "true");
    const d = (menuD = new Disposer());
    const m = menu;
    d.on(document, "pointerdown", (e: PointerEvent) => { if (!m.contains(e.target as Node) && !btn.contains(e.target as Node)) closeMenu(false); }, { capture: true });
    d.on(document, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const f = [...m.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const i = f.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      f[(i + (e.key === "ArrowDown" ? 1 : -1) + f.length) % f.length]?.focus();
    });
    m.querySelector<HTMLElement>(".ap-mi:not(:disabled)")?.focus();
  };
  btn.addEventListener("click", openMenu);

  /* ---------- sheet name + save state ---------- */
  const nameInput = h("input", { class: "ap-name", attrs: { type: "text", value: io.docName(), "aria-label": "Sheet name", maxlength: 60, spellcheck: "false", autocomplete: "off" } });
  nameInput.addEventListener("change", () => { io.setDocName(nameInput.value.trim() || "untitled"); ctx.refresh(); });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); else if (e.key === "Escape") { nameInput.value = io.docName(); nameInput.blur(); } });
  const state = h("span", { class: "ap-state", attrs: { role: "status", "data-s": "saved" } });

  const narrow = (g: "sliders" | "layers", label: string) =>
    h("button", { class: "ap-btn icon ap-narrow-btn", attrs: { type: "button", title: label, "aria-label": label }, on: { click: () => right.toggleNarrow() } }, glyph(g, 18));

  const bar = h("div", { class: "ap-top" }, btn, nameInput, state, narrow("sliders", "Properties"), narrow("layers", "Layers"));
  root.append(bar);

  let status: SaveStatus = "saved";
  const render = () => {
    const n = io.docName();
    if (document.activeElement !== nameInput && nameInput.value !== n) nameInput.value = n;
    const s = status === "saving" ? "saving…" : status === "error" ? "save failed" : status === "dirty" || editor.dirty() ? "unsaved" : "saved";
    setText(state, s);
    setAttr(state, "data-s", s === "unsaved" ? "dirty" : s === "save failed" ? "error" : "saved");
  };
  const u = ctx.update("top", render);
  ctx.wire(u, "change");
  ctx.d.add(io.onStatus((s) => {
    const prev = status; status = s;
    if (prev === "saving" && s === "saved") ctx.toast("Saved");
    if (s === "error") ctx.toast("Save failed", "err");
    u.schedule();
  }));
  ctx.onSlowTick(() => { if (state.textContent === "saved" && editor.dirty()) u.schedule(); });
  ctx.d.add(() => { closeMenu(false); bar.remove(); });
  render();
  return { nameInput, refresh: () => u.schedule() };
}
