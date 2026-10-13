import type { StyleProps } from "../editor-api";
import type { Ctx } from "./ctx";
import type { AlignMode } from "../align";
import { glyph, type GlyphName } from "./glyphs";
import { h, setAttr, setDisabled, setHidden, setPressed, setText } from "./dom";
import { commonGroupId, commonValue, selectionEls } from "./props-model";
import { COLOUR_NAMES, normHex } from "../theme";

const FILL = ["outline", "tint", "solid"] as const;
const EDGE = ["sharp", "round", "soft"] as const;
const ROUTE = ["straight", "elbow", "curve"] as const;

export interface PropsPanel { el: HTMLElement; visible(): boolean; render(): void; focusGroupName(): void }

/** Property panel: style of the current selection + arrange + group. Reads only the first 400 selected elements. */
export function mountProps(ctx: Ctx, parent: HTMLElement): PropsPanel {
  const { editor } = ctx;
  const set = (p: Partial<StyleProps>) => { editor.setStyle(p); ctx.refresh(); };

  const seg = (label: string, names: readonly string[], key: keyof StyleProps) => {
    const btns = names.map((n, i) => h("button", { class: "ap-btn", text: n, attrs: { type: "button", role: "radio", "aria-checked": "false", title: `${label}: ${n}` }, on: { click: () => set({ [key]: i } as Partial<StyleProps>) } }));
    return { el: h("div", { class: "ap-seg", attrs: { role: "radiogroup", "aria-label": label } }, ...btns), btns };
  };

  const count = h("span", { class: "ap-note" });
  const deleteBtn = h("button", { class: "ap-btn icon ap-danger", attrs: { type: "button", title: "Delete (⌫)", "aria-label": "Delete selection" }, on: { click: () => { editor.deleteSelection(); ctx.refresh(); } } }, glyph("trash", 16));
  const sw = COLOUR_NAMES.map((n, i) => h("button", { class: "ap-sw", style: { "--c": `var(--cat${i})` }, attrs: { type: "button", title: n, "aria-label": `Colour ${n}`, "aria-pressed": "false" }, on: { click: () => set({ cat: i, hex: "" }) } }));
  const hexDot = h("span", { class: "ap-hexdot", attrs: { "aria-hidden": "true" } });
  const hexInput = h("input", { class: "ap-input ap-hex", attrs: { type: "text", placeholder: "custom hex, e.g. ff8800", "aria-label": "Custom colour (hex)", maxlength: 7, autocomplete: "off", spellcheck: "false" } });
  let hexNow = "";
  const hexSync = () => { hexInput.value = hexNow; setAttr(hexInput, "aria-invalid", "false"); hexDot.style.setProperty("--c", hexNow || "transparent"); };
  const applyHex = () => {
    const raw = hexInput.value.trim();
    if (raw === "") { if (hexNow !== "") set({ hex: "" }); return; }
    const n = normHex(raw);
    if (!n) { setAttr(hexInput, "aria-invalid", "true"); return; }
    hexInput.value = n; setAttr(hexInput, "aria-invalid", "false");
    if (n !== hexNow) set({ hex: n });
  };
  hexInput.addEventListener("input", () => { const raw = hexInput.value.trim(); setAttr(hexInput, "aria-invalid", raw !== "" && !normHex(raw) ? "true" : "false"); });
  hexInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { applyHex(); hexInput.blur(); } else if (e.key === "Escape") { hexSync(); hexInput.blur(); } });
  hexInput.addEventListener("blur", applyHex);
  const fill = seg("Fill", FILL, "fill");
  const edge = seg("Edge", EDGE, "edge");
  const route = seg("Route", ROUTE, "route");
  const dash = h("button", { class: "ap-btn", text: "dashed", attrs: { type: "button", "aria-pressed": "false" }, on: { click: () => set({ dash: dashNow === 1 ? 0 : 1 }) } });
  let dashNow: 0 | 1 | undefined;
  const routeRow = h("div", {}, h("div", { class: "ap-label", text: "Route" }), route.el);
  const braceDir = seg("Brace direction", ["left", "right", "up", "down"], "o");
  const laneDir = seg("Lane direction", ["rows", "columns"], "o");
  const braceRow = h("div", {}, h("div", { class: "ap-label", text: "Brace points" }), braceDir.el);
  const laneRow = h("div", {}, h("div", { class: "ap-label", text: "Lanes run as" }), laneDir.el);

  const ib = (g: GlyphName, label: string, fn: () => void) =>
    h("button", { class: "ap-btn icon", attrs: { type: "button", title: label, "aria-label": label }, on: { click: () => { fn(); ctx.refresh(); } } }, glyph(g, 18));
  const alignRow = h("div", { class: "ap-iconrow", attrs: { role: "group", "aria-label": "Align" } },
    ib("alignLeft", "Align left (⌥⇧←)", () => editor.align("left" as AlignMode)), ib("alignCenter", "Align centres horizontally (⌥⇧H)", () => editor.align("center")),
    ib("alignRight", "Align right (⌥⇧→)", () => editor.align("right")), ib("alignTop", "Align top (⌥⇧↑)", () => editor.align("top")),
    ib("alignMiddle", "Align middles vertically (⌥⇧V)", () => editor.align("middle")), ib("alignBottom", "Align bottom (⌥⇧↓)", () => editor.align("bottom")));
  const distH = ib("distH", "Distribute horizontally (⌥⇧X, needs 3+)", () => editor.distribute("h"));
  const distV = ib("distV", "Distribute vertically (⌥⇧Y, needs 3+)", () => editor.distribute("v"));
  const sizeRow = h("div", { class: "ap-iconrow", attrs: { role: "group", "aria-label": "Distribute and match size" } },
    distH, distV, ib("matchW", "Match width", () => editor.matchSize("w")), ib("matchH", "Match height", () => editor.matchSize("h")), ib("matchBoth", "Match size (⌥⇧S)", () => editor.matchSize("both")));
  const alignBlock = h("div", { class: "ap-alignblock ap-span" }, h("div", { class: "ap-label", text: "Align" }), alignRow, h("div", { class: "ap-label", text: "Distribute · match size" }), sizeRow);
  const lockBtn = h("button", { class: "ap-btn", attrs: { type: "button", "aria-pressed": "false", title: "Lock: cannot be moved, resized, edited or deleted (⇧⌘L)" }, on: { click: () => { editor.toggleLock(); ctx.refresh(); } } }, h("span", { text: "lock" }), h("span", { class: "ap-kbd", text: "⇧⌘L" }));
  const styleRow = h("div", { class: "ap-row2" },
    h("button", { class: "ap-btn", attrs: { type: "button", title: "Copy style (⌥⌘C)" }, on: { click: () => { editor.copyStyle(); ctx.refresh(); } } }, h("span", { text: "copy" }), h("span", { class: "ap-kbd", text: "⌥⌘C" })),
    h("button", { class: "ap-btn", attrs: { type: "button", title: "Paste style (⌥⌘V)" }, on: { click: () => { editor.pasteStyle(); ctx.refresh(); } } }, h("span", { text: "paste" }), h("span", { class: "ap-kbd", text: "⌥⌘V" })));

  const arr = (label: string, key: string, fn: () => void) =>
    h("button", { class: "ap-btn", attrs: { type: "button", title: `${label} (${key})` }, on: { click: () => { fn(); ctx.refresh(); } } }, h("span", { text: label }), h("span", { class: "ap-kbd", text: key }));
  let pendingFocus = false;
  const groupBtn = arr("group", "⌘G", () => { if (editor.group()) pendingFocus = true; });
  const ungroupBtn = arr("ungroup", "⇧⌘G", () => editor.ungroup());

  let gid: string | null = null;
  const name = h("input", { class: "ap-input", attrs: { type: "text", placeholder: "name this group", "aria-label": "Group name", maxlength: 40, autocomplete: "off", spellcheck: "false" } });
  const commit = () => { if (gid && name.value.trim() !== (editor.scene.groups.get(gid)?.name ?? "")) { editor.renameGroup(gid, name.value.trim()); ctx.refresh(); } };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(); name.blur(); } else if (e.key === "Escape") { name.value = editor.scene.groups.get(gid ?? "")?.name ?? ""; name.blur(); } });
  name.addEventListener("blur", commit);
  const nameRow = h("div", {}, h("div", { class: "ap-label", text: "Group name" }), name);

  const psec = (label: string, ...kids: HTMLElement[]) => h("div", {}, h("div", { class: "ap-label", text: label }), ...kids);
  const el = h("section", { class: "ap-card ap-props", attrs: { "aria-label": "Properties" } },
    h("div", { class: "ap-lh ap-span" }, h("div", { class: "ap-lh-group" }, h("span", { class: "ap-label", text: "Selection" }), count), deleteBtn),
    h("div", { class: "ap-span" }, h("div", { class: "ap-label", text: "Colour" }), h("div", { class: "ap-swatches" }, ...sw), h("div", { class: "ap-hexrow" }, hexDot, hexInput)),
    psec("Fill", fill.el), psec("Edge", edge.el),
    h("div", {}, dash), routeRow, braceRow, laneRow, alignBlock,
    psec("Arrange", h("div", { class: "ap-row2" }, arr("front", "⌘⇧]", () => editor.bringToFront()), arr("forward", "⌘]", () => editor.bringForward()),
      arr("backward", "⌘[", () => editor.sendBackward()), arr("back", "⌘⇧[", () => editor.sendToBack()))),
    psec("Group", h("div", { class: "ap-row2" }, groupBtn, ungroupBtn), nameRow),
    psec("Lock · style", h("div", {}, lockBtn)), h("div", { class: "ap-stylerow" }, styleRow),
    h("p", { class: "ap-note ap-span", text: "double-click a group to rename it · z-order acts on the whole group" }));
  parent.append(el);

  let vis = false;
  const radio = (s: { btns: HTMLButtonElement[] }, v: number | undefined) => s.btns.forEach((b, i) => setPressed(b, v === i, "aria-checked"));
  const render = () => {
    const sel = editor.selection();
    const wasVis = vis;
    vis = sel.size > 0;
    if (vis && !wasVis) ctx.closeMenu?.(); // the menu and the properties panel never show together
    setHidden(el, !vis);
    if (!vis) { gid = null; return; }
    const els = selectionEls(editor.scene.els, sel);
    setText(count, sel.size === 1 ? (els[0]?.kind ?? "1 selected") : `${sel.size} selected`);
    const cat = commonValue(els, (e) => e.cat);
    const hex = commonValue(els, (e) => e.hex ?? "");
    hexNow = hex ?? "";
    if (document.activeElement !== hexInput) hexSync();
    sw.forEach((b, i) => setPressed(b, !hex && cat === i));
    radio(fill, commonValue(els, (e) => e.fill));
    radio(edge, commonValue(els, (e) => e.edge));
    const arrows = els.some((e) => e.kind === "arrow");
    setHidden(routeRow, !arrows);
    radio(route, arrows ? commonValue(els.filter((e) => e.kind === "arrow"), (e) => e.route) : undefined);
    const braces = els.length > 0 && els.every((e) => e.kind === "brace"), lanes = els.length > 0 && els.every((e) => e.kind === "lane");
    setHidden(braceRow, !braces); setHidden(laneRow, !lanes);
    if (braces) radio(braceDir, commonValue(els, (e) => e.o));
    if (lanes) radio(laneDir, commonValue(els, (e) => e.o));
    const movable = els.filter((e) => e.kind !== "arrow" && !e.locked);
    setHidden(alignBlock, sel.size < 2 || movable.length < 2);
    if (sel.size >= 2 && movable.length >= 2) {
      const blocks = new Set<string>();
      for (const e of movable) blocks.add(e.groupIds.length ? e.groupIds[e.groupIds.length - 1]! : e.id);
      setDisabled(distH, blocks.size < 3); setDisabled(distV, blocks.size < 3);
    }
    setPressed(lockBtn, els.length > 0 && els.every((e) => e.locked));
    setDisabled(deleteBtn, els.length === 0 || els.every((e) => e.locked));
    dashNow = commonValue(els, (e) => e.dash);
    setPressed(dash, dashNow === 1);
    setDisabled(ungroupBtn as HTMLButtonElement, !els.some((e) => e.groupIds.length > 0));
    gid = commonGroupId(els);
    setHidden(nameRow, gid === null);
    if (gid !== null && document.activeElement !== name) {
      const n = editor.scene.groups.get(gid)?.name ?? "";
      if (name.value !== n) name.value = n;
    }
    setAttr(name, "data-gid", gid);
    if (pendingFocus && gid !== null) { pendingFocus = false; name.focus(); name.select(); }
  };
  ctx.d.add(() => el.remove());
  return { el, visible: () => vis, render, focusGroupName() { pendingFocus = true; } };
}
