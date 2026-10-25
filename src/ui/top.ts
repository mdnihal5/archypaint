import type { Ctx } from "./ctx";
import { MARK } from "./brand";
import { fromHTML, h, setAttr, setText } from "./dom";
import { glyph } from "./glyphs";
import type { SaveStatus } from "../io";

export interface Top { nameInput: HTMLInputElement; refresh(): void }

/**
 * Top-left chip (menu button, mark, sheet name, save dot) and the top-right cluster (find, layers, properties).
 * The menu itself is a lazy chunk (menu.ts); the properties ribbon's code loads on its first open.
 */
export function mountTop(ctx: Ctx, root: HTMLElement): Top {
  const { editor, io, settings } = ctx;

  /* ---------- chip ---------- */
  const menuBtn = h("button", { class: "ap-ib", attrs: { type: "button", title: "Menu", "aria-label": "Menu", "aria-haspopup": "true", "aria-expanded": "false", "data-menubtn": "" }, on: { click: () => ctx.toggleMenu() } }, glyph("menu", 20));
  const nameInput = h("input", { class: "ap-name", attrs: { type: "text", value: io.docName(), "aria-label": "Sheet name", maxlength: 60, spellcheck: "false", autocomplete: "off" } });
  nameInput.addEventListener("change", () => { io.setDocName(nameInput.value.trim() || "untitled"); ctx.refresh(); });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); else if (e.key === "Escape") { nameInput.value = io.docName(); nameInput.blur(); } });
  const state = h("span", { class: "ap-state", attrs: { role: "status", "data-s": "saved" } });
  const chip = h("div", { class: "ap-chip ap-hit" }, menuBtn, fromHTML(MARK), nameInput, state);
  root.append(chip);

  /* ---------- cluster ---------- */
  const find = h("button", { class: "ap-ib", attrs: { type: "button", title: "Find in sheet (⌘F)", "aria-label": "Find in sheet" }, on: { click: () => ctx.openFind?.() } }, glyph("search", 18));
  const layersBtn = h("button", { class: "ap-ib", attrs: { type: "button", title: "Layers", "aria-label": "Layers", "aria-pressed": "false" }, on: { click: () => settings.set({ layers: !settings.get().layers }) } }, glyph("layers", 18));
  const propsBtn = h("button", { class: "ap-ib", attrs: { type: "button", title: "Properties (I)", "aria-label": "Properties", "aria-pressed": "false" }, on: { click: () => ctx.toggleProps?.() } }, glyph("sliders", 18));
  // theme flips between light and dark from whatever is showing now (the menu still offers "system")
  const dark = () => { const t = settings.get().theme; return t === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : t === "dark"; };
  const themeBtn = h("button", { class: "ap-ib ap-wide", attrs: { type: "button", title: "Theme", "aria-label": "Switch theme" }, on: { click: () => settings.set({ theme: dark() ? "light" : "dark" }) } });
  const flowBtn = h("button", { class: "ap-ib ap-wide", attrs: { type: "button", title: "Flow animation", "aria-label": "Flow animation", "aria-pressed": "false" }, on: { click: () => settings.set({ flow: !settings.get().flow }) } }, glyph("flow", 18));
  const cluster = h("div", { class: "ap-cluster ap-hit", attrs: { role: "toolbar", "aria-label": "Panels" } }, find, layersBtn, propsBtn, flowBtn, themeBtn);
  root.append(cluster);
  const syncPanels = ctx.update("panel-btns", () => {
    setAttr(propsBtn, "aria-pressed", ctx.propsOpen?.() ? "true" : "false");
    setAttr(layersBtn, "aria-pressed", settings.get().layers ? "true" : "false");
    setAttr(flowBtn, "aria-pressed", settings.get().flow ? "true" : "false");
    const d = dark();
    setAttr(themeBtn, "title", d ? "Light theme" : "Dark theme");
    themeBtn.replaceChildren(glyph(d ? "sun" : "moon", 18));
  });
  ctx.d.add(settings.subscribe((_s, changed) => { if (changed.includes("layers") || changed.includes("flow") || changed.includes("theme")) syncPanels.schedule(); }));
  ctx.d.on(matchMedia("(prefers-color-scheme: dark)"), "change", () => syncPanels.schedule());
  syncPanels.schedule();

  /* ---------- save state ---------- */
  let status: SaveStatus = "saved";
  const render = () => {
    const n = io.docName();
    if (document.activeElement !== nameInput && nameInput.value !== n) nameInput.value = n;
    const s = status === "saving" ? "saving…" : status === "error" ? "save failed" : status === "dirty" || editor.dirty() ? "unsaved" : "saved";
    setText(state, s);
    setAttr(state, "data-s", s === "unsaved" ? "dirty" : s === "save failed" ? "error" : s === "saving…" ? "saving" : "saved");
    setAttr(state, "title", s === "saved" ? "All changes saved" : s === "unsaved" ? "Unsaved changes" : s);
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
  ctx.d.add(() => { chip.remove(); cluster.remove(); });
  render();
  return { nameInput, refresh: () => u.schedule() };
}
