import "./menu.css";
import type { Ctx } from "./ctx";
import { Disposer, h, setHidden, setPressed } from "./dom";
import { glyphMore, type MoreGlyph } from "./glyphs-more";
import { ACTIONS, type Action, type FeatureCtx } from "../features";

export interface Menu { toggle(): void; close(): void; isOpen(): boolean }

/** actions that belong under "Import" rather than the group their section names */
const IMPORT_IDS: ReadonlySet<string> = new Set(["insert-image", "text-import"]);
const ACTION_ICON: Record<string, MoreGlyph> = { calc: "calc", "insert-image": "image", "text-import": "file", tidy: "tidy", present: "present", "share-link": "link" };

/**
 * The main menu: one vertical sheet from the top-left chip (and the dock's menu button). Actions are grouped (File, Export, Import, Share,
 * Insert, Arrange and present, Help); every persistent setting lives in the last group, "View and settings". The content is rebuilt on each
 * open, so disabled states (selection, unsaved changes) are always current. Loaded on first open.
 */
export function mountMenu(ctx: Ctx, root: HTMLElement): Menu {
  const { editor, io, settings } = ctx;
  let sheet: HTMLElement | null = null;
  let od: Disposer | null = null;
  const buttons = () => [...document.querySelectorAll<HTMLElement>("[data-menubtn]")];

  const close = (refocus = true) => {
    if (!sheet) return;
    od?.dispose(); od = null; sheet.remove(); sheet = null;
    document.documentElement.dataset.menu = "closed";
    for (const b of buttons()) b.setAttribute("aria-expanded", "false");
    if (refocus) buttons()[0]?.focus();
  };
  const guarded = (fn: () => Promise<void> | void) => () => {
    close(false);
    if (editor.dirty()) void ctx.confirm("This sheet has unsaved changes. Discard them?").then((ok) => { if (ok) ctx.run(fn); });
    else ctx.run(fn);
  };
  const act = (fn: () => Promise<void> | void) => () => { close(false); ctx.run(fn); };

  const item = (icon: MoreGlyph, label: string, kbd: string, fn: () => void, disabled = false) =>
    h("button", { class: "ap-mi", attrs: { type: "button", role: "menuitem", disabled }, on: { click: fn } },
      h("span", { class: "l" }, glyphMore(icon, 16), h("span", { text: label })), h("span", { class: "ap-kbd", text: kbd }));
  const group = (title: string, ...kids: Array<HTMLElement | false>) => [h("div", { class: "ap-gh", text: title }), ...kids.filter((k): k is HTMLElement => !!k)];

  const open = () => {
    const fctx: FeatureCtx = { editor, io, toast: ctx.toast, confirm: ctx.confirm, stage: document.getElementById("stage") ?? document.body };
    const actions = (pred: (a: Action) => boolean) => ACTIONS.filter((a) => pred(a) && (a.enabled?.(fctx) ?? true))
      .map((a) => item(ACTION_ICON[a.id] ?? "file", a.label, a.hint && a.hint.length <= 3 ? a.hint : "", act(() => a.run(fctx))));
    const hasSel = editor.selection().size > 0;
    const unsync: Array<() => void> = [];

    // ---- settings controls: each registers a sync so a change from anywhere (a key, another control) shows here
    const seg = <T extends string | number>(label: string, opts: ReadonlyArray<readonly [T, string, MoreGlyph?]>, get: () => T, setV: (v: T) => void) => {
      const btns = opts.map(([v, l, g]) => h("button", { class: g ? "ico" : "", attrs: { type: "button", role: "radio", "aria-checked": "false", "aria-label": l, title: l }, on: { click: () => { setV(v); syncAll(); ctx.refresh(); } } }, g ? glyphMore(g, 16) : l));
      unsync.push(() => btns.forEach((b, i) => setPressed(b, opts[i]![0] === get(), "aria-checked")));
      return h("div", { class: "ap-mrow" }, h("span", { text: label }), h("div", { class: "ap-seg", attrs: { role: "radiogroup", "aria-label": label } }, ...btns));
    };
    const chip = (label: string, hint: string, get: () => boolean, setV: (v: boolean) => void) => {
      const b = h("button", { class: "ap-tg", attrs: { type: "button", "aria-pressed": "false", title: hint ? `${label} (${hint})` : label }, on: { click: () => { setV(!get()); syncAll(); ctx.refresh(); } } }, h("i"), h("span", { text: label }));
      unsync.push(() => setPressed(b, get()));
      return b;
    };
    const field = (label: string, aria: string, get: () => string, setV: (v: string) => void) => {
      const inp = h("input", { class: "ap-input", attrs: { type: "text", value: get(), "aria-label": aria, maxlength: 24, spellcheck: "false", autocomplete: "off" } });
      inp.addEventListener("change", () => setV(inp.value.trim()));
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") inp.blur(); if (e.key === "Escape") { inp.value = get(); inp.blur(); } });
      unsync.push(() => { if (document.activeElement !== inp && inp.value !== get()) inp.value = get(); });
      return h("label", { class: "ap-sf" }, h("span", { text: label }), inp);
    };
    const EDGE = ["sharp", "round", "soft"], FILL = ["outline", "tint", "solid"];
    const styleRead = h("span", { class: "ap-kbd" });
    const sheetRow = h("div", { class: "ap-mrow ap-sheetrow" }, field("Scale", "Sheet scale", () => settings.get().scale, (v) => settings.set({ scale: v || "1:1" })), field("Rev", "Sheet revision", () => settings.get().rev, (v) => settings.set({ rev: v || "0" })), h("span", { class: "ap-sf" }, h("span", { text: "Style" }), styleRead));
    unsync.push(() => { setHidden(sheetRow, !settings.get().frame); styleRead.textContent = `${EDGE[editor.defaults.edge]} · ${FILL[editor.defaults.fill]}`; });

    const view = [
      h("div", { class: "ap-gh", text: "View and settings" }),
      seg("Theme", [["light", "light", "sun"], ["dark", "dark", "moon"], ["system", "system", "themeSystem"]], () => settings.get().theme, (v) => settings.set({ theme: v })),
      seg("Background", [["grid", "grid"], ["plain", "plain"]], () => settings.get().bg, (v) => settings.set({ bg: v })),
      h("div", { class: "ap-chips", attrs: { role: "group", "aria-label": "Show" } },
        chip("Sheet frame", "", () => settings.get().frame, (v) => settings.set({ frame: v })),
        chip("Layers", "", () => settings.get().layers, (v) => settings.set({ layers: v })),
        chip("Minimap", "M · shown when the diagram is larger than the window", () => settings.get().minimap, (v) => settings.set({ minimap: v })),
        chip("Flow animation", "", () => settings.get().flow, (v) => settings.set({ flow: v })),
        chip("Status footer", "", () => settings.get().hud, (v) => settings.set({ hud: v })),
        chip("Hide icons", "⌥H · view only, exports follow it", () => settings.get().hideIcons, (v) => settings.set({ hideIcons: v }))),
      sheetRow,
      h("div", { class: "ap-gh sub", text: "New shapes" }),
      seg("Edge", [[0, "sharp"], [1, "round"], [2, "soft"]], () => editor.defaults.edge, (v) => editor.setDefaults({ edge: v as 0 | 1 | 2 })),
      seg("Fill", [[0, "outline"], [1, "tint"], [2, "solid"]], () => editor.defaults.fill, (v) => editor.setDefaults({ fill: v as 0 | 1 | 2 })),
    ];
    const syncAll = () => { for (const f of unsync) f(); };

    sheet = h("div", { class: "ap-menu ap-card ap-hit", attrs: { role: "menu", "aria-label": "Main menu" } },
      ...group("File",
        item("file", "New", "", guarded(() => io.newDoc())), item("folder", "Open…", "⌘O", guarded(() => io.open())),
        item("save", "Save", "⌘S", act(() => io.save())), item("save", "Save as…", "⇧⌘S", act(() => io.saveAs()))),
      ...group("Export",
        item("download", "PNG", "⇧⌘E", act(() => io.exportPng({ scale: 2, background: true }))),
        item("download", "Selection as PNG", "", act(() => io.exportPng({ scale: 2, background: true, selectionOnly: true })), !hasSel),
        item("download", "SVG", "", act(() => io.exportSvg({ background: true }))),
        item("image", "Copy as PNG", "", act(() => io.copyPng({ scale: 2, background: true }))),
        item("download", "Excalidraw", "", act(() => io.exportExcalidraw()))),
      ...group("Import", item("upload", "Excalidraw…", "", guarded(() => io.importExcalidraw())), ...actions((a) => IMPORT_IDS.has(a.id))),
      ...group("Share", ...actions((a) => a.section === "file")),
      ...group("Insert", ...actions((a) => a.section === "insert" && !IMPORT_IDS.has(a.id)),
        item("legend", "Legend", "", act(() => { editor.insertLegend(); })), item("renumber", "Renumber step badges", "", act(() => editor.renumberBadges())),
        item("search", "Find…", "⌘F", () => { close(false); ctx.openFind?.(); })),
      ...group("Arrange and present", ...actions((a) => a.section === "arrange" || a.section === "view")),
      ...group("Help", item("help", "Keyboard shortcuts", "?", () => { close(false); ctx.showShortcuts(); })),
      ...view);
    root.append(sheet);
    syncAll();
    document.documentElement.dataset.menu = "open";
    for (const b of buttons()) b.setAttribute("aria-expanded", "true");
    const unsub = settings.subscribe(syncAll);
    const d = (od = new Disposer());
    d.add(unsub);
    const m = sheet;
    d.on(document, "pointerdown", (e: PointerEvent) => { const t = e.target as Node; if (!m.contains(t) && !buttons().some((b) => b.contains(t))) close(false); }, { capture: true });
    d.on(document, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const f = [...m.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const i = f.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      f[(i + (e.key === "ArrowDown" ? 1 : -1) + f.length) % f.length]?.focus();
    });
    m.querySelector<HTMLElement>(".ap-mi:not(:disabled)")?.focus();
  };

  const toggle = () => { if (sheet) close(); else open(); };
  ctx.d.add(() => close(false));
  return { toggle, close: () => close(false), isOpen: () => sheet !== null };
}
