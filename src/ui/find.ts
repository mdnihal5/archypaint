import { FindIndex, type Match } from "../find-model";
import type { Ctx } from "./ctx";
import { glyph } from "./glyphs";
import { h, isTyping, setDisabled, setText } from "./dom";

const MAX_HIGHLIGHT = 400;

/** Ctrl/Cmd+F find bar: searches labels, icon names, arrow labels and group names; Enter / Shift+Enter cycle, Escape closes. */
export function mountFind(ctx: Ctx, root: HTMLElement): void {
  const { editor } = ctx;
  const idx = new FindIndex(editor.scene);
  let matches: Match[] = [];
  let cur = -1;
  let prevFocus: HTMLElement | null = null;

  const input = h("input", { class: "ap-input", attrs: { type: "text", placeholder: "find a label, icon or group", "aria-label": "Find", autocomplete: "off", spellcheck: "false", maxlength: 80 } });
  const count = h("span", { class: "ap-note ap-find-count", attrs: { "aria-live": "polite" } });
  const step = (d: number) => h("button", { class: "ap-btn icon", attrs: { type: "button", title: d > 0 ? "Next match (Enter)" : "Previous match (⇧Enter)", "aria-label": d > 0 ? "Next match" : "Previous match" }, on: { click: () => go(cur + d) } }, glyph("chevron", 16));
  const prev = step(-1), next = step(1);
  next.firstElementChild?.setAttribute("style", "transform:rotate(90deg)");
  prev.firstElementChild?.setAttribute("style", "transform:rotate(-90deg)");
  const closeBtn = h("button", { class: "ap-btn icon", attrs: { type: "button", title: "Close (Esc)", "aria-label": "Close find" }, on: { click: () => close() } }, glyph("close", 16));
  const bar = h("div", { class: "ap-find ap-card ap-hit", attrs: { role: "search", "aria-label": "Find in sheet" }, }, glyph("search", 18), input, count, prev, next, closeBtn);
  bar.hidden = true;
  root.append(bar);

  const flat = (): string[] => {
    const out: string[] = [];
    for (const m of matches) { for (const id of m.ids) { out.push(id); if (out.length >= MAX_HIGHLIGHT) return out; } }
    return out;
  };
  const paint = () => {
    const any = matches.length > 0;
    setText(count, !input.value.trim() ? "" : any ? `${cur + 1}/${matches.length}` : "no matches");
    setDisabled(prev, !any); setDisabled(next, !any);
  };
  function go(i: number): void {
    if (!matches.length) return;
    cur = ((i % matches.length) + matches.length) % matches.length;
    const m = matches[cur]!;
    editor.focusOn(m.ids);
    editor.highlight(flat(), m.ids[0]);
    paint();
  }
  const search = () => {
    matches = idx.search(input.value);
    cur = matches.length ? 0 : -1;
    if (matches.length) go(0); else { editor.highlight([]); paint(); }
  };
  function open(): void {
    if (!bar.hidden) { input.focus(); input.select(); return; }
    prevFocus = document.activeElement as HTMLElement | null;
    bar.hidden = false; input.focus(); input.select();
    if (input.value.trim()) search();
  }
  function close(): void {
    if (bar.hidden) return;
    bar.hidden = true; matches = []; cur = -1;
    editor.highlight([]); paint();
    const f = prevFocus; prevFocus = null;
    if (f && f.isConnected && f !== document.body) f.focus(); else input.blur();
  }
  ctx.openFind = open;

  input.addEventListener("input", search);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Enter") { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); }
  });
  ctx.d.on(window, "keydown", (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
      if (ctx.modalOpen() || (isTyping(e.target) && e.target !== input && !bar.contains(e.target as Node))) { /* let text fields keep their own behaviour except for our shortcut */ }
      if (ctx.modalOpen()) return;
      e.preventDefault(); open();
    }
  });
  // the sheet changed while the bar is open: refresh the matches (coalesced to one frame)
  const refresh = ctx.update("find", () => { if (!bar.hidden && input.value.trim()) { const id = matches[cur]?.ids[0]; matches = idx.search(input.value); cur = Math.max(0, matches.findIndex((m) => m.ids[0] === id)); if (!matches.length) cur = -1; editor.highlight(flat(), matches[cur]?.ids[0]); paint(); } });
  ctx.d.add(editor.on("history", () => refresh.schedule()));
  ctx.d.add(() => { editor.highlight([]); bar.remove(); ctx.openFind = undefined; });
}
