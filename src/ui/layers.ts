import type { Ctx } from "./ctx";
import { createUpdater, h, setAttr, setClass, setHidden, setStyleProp, setText } from "./dom";
import { buildRows, rowIndexOf, type Row } from "./layers-model";
import { revealScrollTop, windowRows } from "./vlist";

export const ROW_H = 26;

export interface LayersPanel { el: HTMLElement; visible(): boolean; render(): void }

/**
 * Layers tree. The model (buildRows) is rebuilt only when scene.nonce or the collapsed set changed; the DOM is a
 * recycled pool of ~visible+overscan rows, so 5,000 shapes cost O(visible rows) per scroll frame. One delegated
 * listener per event type, no per-row listeners, and everything is removed with the panel.
 */
export function mountLayers(ctx: Ctx, parent: HTMLElement): LayersPanel {
  const { editor } = ctx;
  let rows: Row[] = [];
  let builtNonce = -1;
  let dirty = true;
  const collapsed = new Set<string>();
  let renaming: string | null = null;
  let vis = false;

  const count = h("span", { class: "ap-note" });
  const rowsEl = h("div", { class: "ap-vrows", attrs: { role: "listbox", "aria-multiselectable": "true", "aria-label": "Layers" } });
  const spacer = h("div", { class: "ap-vspacer" }, rowsEl);
  const scroller = h("div", { class: "ap-vscroll", attrs: { tabindex: "0", "aria-label": "Layers list" } }, spacer);
  const rename = h("input", { class: "ap-lrow-input", attrs: { type: "text", "aria-label": "Group name", maxlength: 40, autocomplete: "off" } });
  rename.hidden = true;
  Object.assign(rename.style, { position: "absolute", height: "22px", zIndex: "2", font: "12px var(--mono)", background: "var(--paper)", color: "var(--ink)", border: "1px solid var(--red-ink)", borderRadius: "4px", padding: "0 4px", boxSizing: "border-box" });
  spacer.append(rename);
  const el = h("section", { class: "ap-card ap-layers", attrs: { "aria-label": "Layers" } },
    h("div", { class: "ap-lh" }, h("span", { class: "ap-label", text: "Layers" }), count), scroller);
  parent.append(el);

  const pool: HTMLElement[] = [];
  const mkRow = () => {
    const r = h("div", { class: "ap-lrow", attrs: { role: "option", "aria-selected": "false" } },
      h("span", { class: "car" }), h("span", { class: "dot" }), h("span", { class: "nm" }));
    rowsEl.append(r);
    return r;
  };

  const isSelected = (r: Row, sel: ReadonlySet<string>): boolean => {
    if (r.kind === "shape") return sel.has(r.id);
    const m = r.members;
    // O(1) approximation: a group reads as selected when the selection is at least its size and holds both ends
    return m.length > 0 && sel.size >= m.length && sel.has(m[0]!) && sel.has(m[m.length - 1]!);
  };

  const paint = () => {
    const w = windowRows(scroller.scrollTop, scroller.clientHeight, ROW_H, rows.length);
    while (pool.length < w.end - w.start) pool.push(mkRow());
    while (pool.length > w.end - w.start) pool.pop()!.remove();
    setStyleProp(rowsEl, "transform", `translateY(${w.offset}px)`);
    setStyleProp(spacer, "height", `${w.total}px`);
    const sel = editor.selection();
    let renameIdx = -1;
    for (let i = 0; i < pool.length; i++) {
      const idx = w.start + i, r = rows[idx]!, node = pool[i]!;
      const [car, dot, nm] = [node.children[0] as HTMLElement, node.children[1] as HTMLElement, node.children[2] as HTMLElement];
      node.dataset.i = String(idx);
      setClass(node, "g", r.kind === "group");
      setStyleProp(node, "padding-left", `${12 + r.depth * 14}px`);
      setText(car, r.kind === "group" ? (r.expanded ? "▾" : "▸") : "");
      setHidden(dot, r.kind === "group");
      setStyleProp(dot, "--c", `var(--cat${r.cat % 8})`);
      setText(nm, r.label);
      setAttr(node, "aria-selected", isSelected(r, sel) ? "true" : "false");
      if (renaming === r.id) renameIdx = i;
    }
    if (renaming !== null && renameIdx < 0) endRename(false);
    if (renaming !== null && renameIdx >= 0) {
      const r = rows[w.start + renameIdx]!;
      setStyleProp(rename, "top", `${w.offset + renameIdx * ROW_H + 2}px`);
      setStyleProp(rename, "left", `${12 + r.depth * 14 + 22}px`);
      setStyleProp(rename, "right", "12px");
      rename.style.width = "auto";
    }
  };
  const win = createUpdater("layers-window", paint);
  ctx.d.add(() => win.cancel());

  let lastSelKey = "";
  const reveal = () => {
    const sel = editor.selection();
    const key = sel.size === 1 ? (sel.values().next().value as string) : `#${sel.size}`;
    if (key === lastSelKey) return; // only follow a selection that actually changed, never fight a manual scroll
    lastSelKey = key;
    if (sel.size !== 1) return;
    const idx = rowIndexOf(rows, sel.values().next().value as string);
    if (idx < 0) return;
    const st = revealScrollTop(idx, scroller.scrollTop, scroller.clientHeight, ROW_H);
    if (st !== null) scroller.scrollTop = st;
  };

  const render = () => {
    vis = ctx.settings.get().layers && editor.scene.els.size > 0;
    setHidden(el, !vis);
    if (!vis) return;
    if (dirty || builtNonce !== editor.scene.nonce) {
      rows = buildRows(editor.scene, collapsed);
      builtNonce = editor.scene.nonce; dirty = false;
      setText(count, `${rows.length} rows · ${editor.scene.els.size} shapes`);
    }
    reveal();
    paint();
  };

  const endRename = (commit: boolean) => {
    const id = renaming;
    if (id === null) return;
    renaming = null;
    const v = rename.value.trim();
    rename.hidden = true;
    if (commit && v !== (editor.scene.groups.get(id)?.name ?? "")) { editor.renameGroup(id, v); ctx.refresh(); }
  };

  const rowAt = (t: EventTarget | null): { r: Row; i: number } | null => {
    const n = (t as HTMLElement | null)?.closest?.<HTMLElement>(".ap-lrow");
    if (!n || n.dataset.i === undefined) return null;
    const i = Number(n.dataset.i), r = rows[i];
    return r ? { r, i } : null;
  };

  rowsEl.addEventListener("click", (e) => {
    const hit = rowAt(e.target);
    if (!hit) return;
    const { r } = hit;
    if (r.kind === "group" && (e.target as HTMLElement).classList.contains("car")) {
      if (collapsed.has(r.id)) collapsed.delete(r.id); else collapsed.add(r.id);
      dirty = true; main.schedule(); return;
    }
    const ids = r.kind === "group" ? [...r.members] : [r.id];
    const cur = editor.selection();
    if (e.shiftKey) editor.select([...new Set([...cur, ...ids])]);
    else if (e.metaKey || e.ctrlKey) editor.select(ids.every((x) => cur.has(x)) ? [...cur].filter((x) => !ids.includes(x)) : [...cur, ...ids]);
    else editor.select(ids);
    win.schedule();
  });
  rowsEl.addEventListener("dblclick", (e) => {
    const hit = rowAt(e.target);
    if (!hit || hit.r.kind !== "group") return;
    renaming = hit.r.id;
    rename.value = editor.scene.groups.get(hit.r.id)?.name ?? "";
    rename.hidden = false;
    paint();
    rename.focus(); rename.select();
  });
  rename.addEventListener("keydown", (e) => { if (e.key === "Enter") endRename(true); else if (e.key === "Escape") endRename(false); e.stopPropagation(); });
  rename.addEventListener("blur", () => endRename(true));
  scroller.addEventListener("scroll", () => win.schedule(), { passive: true });
  scroller.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const sel = editor.selection();
    const cur = sel.size ? rowIndexOf(rows, sel.values().next().value as string) : -1;
    const next = Math.min(rows.length - 1, Math.max(0, cur + (e.key === "ArrowDown" ? 1 : -1)));
    const r = rows[next];
    if (r) editor.select(r.kind === "group" ? [...r.members] : [r.id]);
  });
  const ro = new ResizeObserver(() => win.schedule());
  ro.observe(scroller);
  ctx.d.add(() => ro.disconnect());

  // the main render is owned by right.ts (it decides visibility of both cards); expose a scheduler hook for collapse clicks
  const main = { schedule: () => ctx.refresh() };
  ctx.d.add(() => el.remove());
  return { el, visible: () => vis, render };
}
