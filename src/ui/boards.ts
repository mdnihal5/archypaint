import "./menu.css";
import "./boards.css";
import type { BoardRow, BoardsApi } from "../io/boards";
import { UNDO_MS } from "../io/boards";
import type { Ctx } from "./ctx";
import { Disposer, h, setAttr } from "./dom";
import { glyph } from "./glyphs";
import { glyphMore } from "./glyphs-more";
import { filterBoards, relTime, SEARCH_AFTER } from "./boards-model";

export interface BoardsUi { toggle(): void; close(): void; isOpen(): boolean }

/**
 * The boards list: a popover under the name chip, styled as the main menu sheet. Rows switch on click; rename (inline), duplicate and
 * delete (undo toast) are per-row actions, shown on hover / focus and always on touch. Loaded on the first open.
 */
export function mountBoards(ctx: Ctx, root: HTMLElement): BoardsUi {
  let sheet: HTMLElement | null = null;
  let od: Disposer | null = null;
  let api: BoardsApi | null = null;
  let rows: BoardRow[] = [];
  let query = "";
  let renaming: string | null = null;
  let opening = false;
  const trigger = () => document.querySelector<HTMLElement>("[data-boardsbtn]");

  const close = (refocus = true) => {
    if (!sheet) return;
    od?.dispose(); od = null; sheet.remove(); sheet = null; renaming = null; query = "";
    document.documentElement.dataset.menu = "closed";
    const t = trigger();
    if (t) { t.setAttribute("aria-expanded", "false"); if (refocus) t.focus(); }
  };

  const reload = async (focusId?: string) => {
    if (!api) return;
    rows = await api.list();
    if (sheet) render(focusId);
    ctx.refresh();
  };

  const act = (fn: () => Promise<unknown>) => { void fn().catch((e: unknown) => ctx.toast(e instanceof Error ? e.message : String(e), "err")); };

  const switchTo = (id: string) => act(async () => { if (await api!.switchTo(id)) { close(false); ctx.refresh(); } });
  const create = () => act(async () => { if (await api!.create()) { close(false); ctx.refresh(); } });
  const duplicate = (id: string) => act(async () => { const n = await api!.duplicate(id); if (n) await reload(n); });
  const remove = (id: string) => act(async () => {
    const r = await api!.remove(id);
    if (!r) return;
    ctx.toast(`Deleted “${r.name}”`, "ok", { label: "Undo", ms: UNDO_MS, run: () => act(async () => { if (await r.undo()) await reload(id); else ctx.toast("That board could not be restored.", "err"); }) });
    await reload();
  });
  const commitRename = (id: string, value: string, before: string) => act(async () => {
    renaming = null;
    const v = value.trim();
    if (v && v !== before) await api!.rename(id, v);
    await reload(id);
  });

  const rowEl = (r: BoardRow): HTMLElement => {
    const act1 = (label: string, title: string, icon: "pencil" | "copy" | "trash", fn: () => void) =>
      h("button", { class: "ap-ib sm", attrs: { type: "button", "aria-label": `${label} ${r.name}`, title, tabindex: -1 }, on: { click: (e) => { e.stopPropagation(); fn(); } } }, glyphMore(icon, 16));
    const el = h("div", { class: r.current ? "ap-bd cur" : "ap-bd", attrs: { role: "option", "aria-selected": r.current ? "true" : "false", tabindex: -1, "data-id": r.id } });
    if (renaming === r.id) {
      let done = false;
      const inp = h("input", { class: "ap-input rn", attrs: { type: "text", value: r.name, "aria-label": "Board name", maxlength: 200, spellcheck: "false", autocomplete: "off" } });
      const finish = (save: boolean) => { if (done) return; done = true; if (save) commitRename(r.id, inp.value, r.name); else { renaming = null; render(r.id); } };
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); } });
      inp.addEventListener("blur", () => finish(true));
      inp.addEventListener("click", (e) => e.stopPropagation());
      el.append(h("span", { class: "tx" }, h("span", { class: "n" }, inp), h("span", { class: "t", text: relTime(r.savedAt, Date.now()) })), h("span", { class: "ap-kbd rk", text: "↵ save · esc" }));
      queueMicrotask(() => { inp.focus(); inp.select(); });
      return el;
    }
    el.append(
      h("span", { class: "tx" }, h("span", { class: "n", text: r.name }), h("span", { class: "t", text: relTime(r.savedAt, Date.now()) })),
      h("span", { class: "acts" },
        act1("Rename", "Rename (F2)", "pencil", () => startRename(r.id)),
        act1("Duplicate", "Duplicate (⌘D)", "copy", () => duplicate(r.id)),
        act1("Delete", "Delete (Del)", "trash", () => remove(r.id))));
    el.addEventListener("click", () => switchTo(r.id));
    return el;
  };

  const startRename = (id: string) => { renaming = id; render(id); };

  function render(focusId?: string): void {
    const m = sheet;
    if (!m) return;
    const shown = filterBoards(rows, query);
    const list = h("div", { class: "ap-bl", attrs: { role: "listbox", "aria-label": "Boards" } }, ...shown.map(rowEl));
    if (!shown.length) list.append(h("div", { class: "ap-bnone", text: "No board matches." }));
    const kids: Array<HTMLElement> = [h("div", { class: "ap-gh", text: "Boards" })];
    if (rows.length > SEARCH_AFTER) {
      const s = h("input", { class: "ap-input ap-bsearch", attrs: { type: "text", value: query, placeholder: "Find a board", "aria-label": "Find a board", spellcheck: "false", autocomplete: "off" } });
      s.addEventListener("input", () => { query = s.value; render(); const again = m.querySelector<HTMLInputElement>(".ap-bsearch"); again?.focus(); again?.setSelectionRange(query.length, query.length); });
      kids.push(s);
    }
    kids.push(list, h("div", { class: "ap-bl-sep" }),
      h("button", { class: "ap-mi ap-newb", attrs: { type: "button" }, on: { click: create } }, h("span", { class: "l" }, glyph("plus", 16), h("span", { text: "New board" })), h("span", { class: "ap-kbd", text: "N" })));
    const hadFocus = m.contains(document.activeElement) && !(document.activeElement as HTMLElement).classList.contains("ap-bsearch");
    m.replaceChildren(...kids);
    const target = focusId ? m.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"]`) : null;
    if (renaming) return;
    if (target) target.focus();
    else if (hadFocus || !focusId) m.querySelector<HTMLElement>(".ap-bd.cur")?.focus();
  }

  const stops = (m: HTMLElement) => [...m.querySelectorAll<HTMLElement>(".ap-bd, .ap-newb")];

  const open = async () => {
    if (sheet || opening) return;
    opening = true;
    try {
      ctx.closeMenu();
      api = await ctx.io.boards();
      rows = await api.list();
    } catch (e) { ctx.toast(e instanceof Error ? e.message : String(e), "err"); return; } finally { opening = false; }
    if (sheet) return;
    const m = (sheet = h("div", { class: "ap-menu ap-card ap-hit ap-boards", attrs: { role: "dialog", "aria-label": "Boards" } }));
    root.append(m);
    document.documentElement.dataset.menu = "open";
    trigger()?.setAttribute("aria-expanded", "true");
    const d = (od = new Disposer());
    // a click on the Undo toast is part of using the list: it must not close it
    d.on(document, "pointerdown", (e: PointerEvent) => { const t = e.target as Node; if (!m.contains(t) && !trigger()?.contains(t) && !(t as Element).closest?.(".ap-toasts")) close(false); }, { capture: true });
    d.on(document, "keydown", (e: KeyboardEvent) => { if (e.key === "Escape" && !m.contains(e.target as Node)) { e.preventDefault(); close(); } });
    // everything typed inside the list stays inside it: the canvas shortcuts must not fire from here
    m.addEventListener("keydown", (e) => {
      if (e.key === "Tab") return;
      e.stopPropagation();
      const t = e.target as HTMLElement;
      const inField = t.tagName === "INPUT";
      if (e.key === "Escape") { e.preventDefault(); if (!inField || t.classList.contains("ap-bsearch")) close(); return; }
      if (inField && !t.classList.contains("ap-bsearch")) return; // the rename field has its own keys
      const all = stops(m), i = all.indexOf(t.closest<HTMLElement>(".ap-bd, .ap-newb") ?? t);
      const row = t.closest<HTMLElement>(".ap-bd");
      const go = (n: number) => { e.preventDefault(); all[Math.max(0, Math.min(all.length - 1, n))]?.focus(); };
      if (e.key === "ArrowDown") go(inField ? 0 : i + 1);
      else if (e.key === "ArrowUp") go(i - 1);
      else if (e.key === "Home" && !inField) go(0);
      else if (e.key === "End" && !inField) go(all.length - 1);
      else if (e.key === "Enter" && row && t === row) { e.preventDefault(); switchTo(row.dataset.id!); }
      else if (e.key === "F2" && row) { e.preventDefault(); startRename(row.dataset.id!); }
      else if ((e.key === "Delete" || e.key === "Backspace") && row && !inField) { e.preventDefault(); const next = row.nextElementSibling ?? row.previousElementSibling; remove(row.dataset.id!); (next as HTMLElement | null)?.focus(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && row) { e.preventDefault(); duplicate(row.dataset.id!); }
      else if ((e.key === "n" || e.key === "N") && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); create(); }
    });
    render();
    setAttr(m, "data-count", String(rows.length));
  };

  const toggle = () => { if (sheet) close(); else void open(); };
  ctx.d.add(() => close(false));
  return { toggle, close: () => close(false), isOpen: () => sheet !== null };
}
