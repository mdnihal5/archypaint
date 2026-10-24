import type { StyleProps } from "../editor-api";
import type { Ctx } from "./ctx";
import type { AlignMode } from "../align";
import { glyph, type GlyphName } from "./glyphs";
import { h, setAttr, setDisabled, setHidden, setPressed, setText } from "./dom";
import { commonGroupId, commonValue, selectionEls } from "./props-model";
import { COLOUR_NAMES, normHex } from "../theme";
import { isLogoId } from "../logos";
import { TEXT_SIZES } from "../text-edit";
import type { TextAlign } from "../wrap";
import { clampPos, loadPrefs, savePrefs, type PropsPlace } from "./props-pos";

/** "none" (no tile) is offered only while every selected element is a brand logo */
const FILL = ["outline", "tint", "solid", "none"] as const;
const EDGE = ["sharp", "round", "soft"] as const;
const ROUTE = ["straight", "elbow", "curve"] as const;
/** kinds whose text is not a free label (a number, structured rows, a picture caption): no text-size control for them */
const NO_TEXT_SIZE: ReadonlySet<string> = new Set(["brace", "badge", "calc", "legend", "image", "lane"]);

/** kinds whose label cannot be aligned: it sits on a line or under a tile (connectors, icons) or is not free text */
const NO_ALIGN: ReadonlySet<string> = new Set([...NO_TEXT_SIZE, "icon", "arrow"]);
const ALIGNS: readonly TextAlign[] = ["left", "center", "right"];

export interface PropsPanel { el: HTMLElement; visible(): boolean; render(): void; focusGroupName(): void; /** true once the viewer dragged the panel somewhere: nothing may move it again but them */ placed(): boolean; toggle(): void }

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
  // text size: a preset row for the labels of shapes, text, icons and connectors (stored per element as px; M is the default and stores nothing)
  const size = h("div", { class: "ap-seg", attrs: { role: "radiogroup", "aria-label": "Text size" } });
  const sizeBtns = TEXT_SIZES.map((t) => h("button", { class: "ap-btn", text: t.label, attrs: { type: "button", role: "radio", "aria-checked": "false", title: `Text size ${t.label}${t.px ? ` (${t.px}px)` : " (default)"}` }, on: { click: () => set({ fs: t.px }) } }));
  size.append(...sizeBtns);
  const textSizeRow = h("div", {}, h("div", { class: "ap-label", text: "Text size" }), size);
  // text alignment: left / centre / right inside the shape (centre stores nothing)
  const alignSeg = h("div", { class: "ap-seg", attrs: { role: "radiogroup", "aria-label": "Text alignment" } });
  const alignBtns = ALIGNS.map((a) => h("button", { class: "ap-btn", text: a === "center" ? "centre" : a, attrs: { type: "button", role: "radio", "aria-checked": "false", title: `Align text ${a === "center" ? "centre" : a}` }, on: { click: () => set({ align: a }) } }));
  alignSeg.append(...alignBtns);
  const textAlignRow = h("div", {}, h("div", { class: "ap-label", text: "Text align" }), alignSeg);
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
  const lockLabel = h("span", { text: "lock" });
  const lockBtn = h("button", { class: "ap-btn", attrs: { type: "button", "aria-pressed": "false", title: "Lock: cannot be moved, resized, edited or deleted (⇧⌘L)" }, on: { click: () => { editor.toggleLock(); ctx.refresh(); } } }, lockLabel, h("span", { class: "ap-kbd", text: "⇧⌘L" }));
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

  const head = h("div", { class: "ap-lh ap-span ap-drag", attrs: { title: "Drag to move · double-click to reset · I closes" } }, h("div", { class: "ap-lh-group" }, h("span", { class: "ap-label", text: "Selection" }), count), deleteBtn);
  const psec = (label: string, ...kids: HTMLElement[]) => h("div", {}, h("div", { class: "ap-label", text: label }), ...kids);
  const el = h("section", { class: "ap-card ap-props", attrs: { "aria-label": "Properties" } },
    head,
    h("div", { class: "ap-span" }, h("div", { class: "ap-label", text: "Colour" }), h("div", { class: "ap-swatches" }, ...sw), h("div", { class: "ap-hexrow" }, hexDot, hexInput)),
    psec("Fill", fill.el), psec("Edge", edge.el),
    h("div", {}, dash), textSizeRow, textAlignRow, routeRow, braceRow, laneRow, alignBlock,
    psec("Arrange", h("div", { class: "ap-row2" }, arr("front", "⌘⇧]", () => editor.bringToFront()), arr("forward", "⌘]", () => editor.bringForward()),
      arr("backward", "⌘[", () => editor.sendBackward()), arr("back", "⌘⇧[", () => editor.sendToBack()))),
    psec("Group", h("div", { class: "ap-row2" }, groupBtn, ungroupBtn), nameRow),
    psec("Lock · style", h("div", {}, lockBtn)), h("div", { class: "ap-stylerow" }, styleRow),
    h("p", { class: "ap-note ap-span ap-empty", text: "Select something on the canvas to style it. I closes this panel." }),
    h("p", { class: "ap-note ap-span ap-tip", text: "double-click a group\u2019s name to rename it · Enter or just typing edits the selected shape\u2019s text · z-order acts on the whole group" }));
  parent.append(el);

  // viewer-placed position and hidden flag (per browser). Dragging pins the panel: the auto "step aside" in right.ts then leaves it alone.
  const prefs = loadPrefs();
  let place: PropsPlace | null = prefs.pos, open = prefs.open;
  const persist = () => savePrefs({ pos: place, open });
  const paint = () => {
    if (place) { el.dataset.placed = "1"; el.style.left = `${place.x}px`; el.style.top = `${place.y}px`; }
    else { delete el.dataset.placed; el.style.left = ""; el.style.top = ""; }
  };
  const reclamp = () => {
    if (!place || el.hidden) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return; // not laid out (narrow layout): leave the stored position alone
    const c = clampPos(place, r.width, r.height, window.innerWidth, window.innerHeight);
    if (c.x !== place.x || c.y !== place.y) { place = c; paint(); }
  };
  let drag: { dx: number; dy: number; id: number } | null = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button") || el.getBoundingClientRect().width === 0) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    if (!place) { place = { x: r.left, y: r.top }; paint(); } // switch to fixed positioning exactly where it is: no jump
    try { head.setPointerCapture(e.pointerId); } catch { /* synthetic pointer: moves still arrive on the header */ }
    e.preventDefault();
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = el.getBoundingClientRect();
    place = clampPos({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, r.width, r.height, window.innerWidth, window.innerHeight);
    paint();
  });
  const endDrag = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { drag = null; persist(); } };
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
  head.addEventListener("dblclick", (e) => { if ((e.target as HTMLElement).closest("button")) return; place = null; paint(); persist(); });
  ctx.d.on(window, "resize", reclamp);
  paint();
  const toggle = () => {
    open = !open; persist();
    ctx.refresh();
  };
  ctx.toggleProps = toggle;
  ctx.propsOpen = () => open;
  ctx.d.add(() => { if (ctx.toggleProps === toggle) { ctx.toggleProps = undefined; ctx.propsOpen = undefined; } });

  let vis = false;
  const radio = (s: { btns: HTMLButtonElement[] }, v: number | undefined) => s.btns.forEach((b, i) => setPressed(b, v === i, "aria-checked"));
  const render = () => {
    const sel = editor.selection();
    const wasVis = vis;
    vis = open && !editor.editing; // opened only by the viewer (I or the toggle button), never by a selection; the panel steps aside while a label is being typed: it must never cover or steal focus from the editor
    if (vis && !wasVis) ctx.closeMenu?.(); // the menu and the properties panel never show together
    setHidden(el, !vis);
    if (!vis) { gid = null; return; }
    setAttr(el, "data-empty", sel.size === 0 ? "true" : "false"); // open with nothing selected: just the header and a hint
    if (sel.size === 0) { gid = null; setText(count, "nothing selected"); setDisabled(deleteBtn, true); return; }
    const els = selectionEls(editor.scene.els, sel);
    if (!wasVis) reclamp();
    setText(count, sel.size === 1 ? (els[0]?.kind ?? "1 selected") : `${sel.size} selected`);
    const cat = commonValue(els, (e) => e.cat);
    const hex = commonValue(els, (e) => e.hex ?? "");
    hexNow = hex ?? "";
    if (document.activeElement !== hexInput) hexSync();
    sw.forEach((b, i) => setPressed(b, !hex && cat === i));
    radio(fill, commonValue(els, (e) => e.fill));
    setHidden(fill.btns[3]!, !els.every((e) => e.kind === "icon" && isLogoId(e.iconId)));
    radio(edge, commonValue(els, (e) => e.edge));
    const arrows = els.some((e) => e.kind === "arrow");
    setHidden(routeRow, !arrows);
    radio(route, arrows ? commonValue(els.filter((e) => e.kind === "arrow"), (e) => e.route) : undefined);
    const texty = els.some((e) => !NO_TEXT_SIZE.has(e.kind));
    setHidden(textSizeRow, !texty);
    if (texty) { const fs = commonValue(els.filter((e) => !NO_TEXT_SIZE.has(e.kind)), (e) => e.fs ?? 0); sizeBtns.forEach((b, i) => setPressed(b, fs === TEXT_SIZES[i]!.px, "aria-checked")); }
    const aligned = els.filter((e) => !NO_ALIGN.has(e.kind));
    setHidden(textAlignRow, aligned.length === 0);
    if (aligned.length) { const al = commonValue(aligned, (e) => e.align ?? "center"); alignBtns.forEach((b, i) => setPressed(b, al === ALIGNS[i], "aria-checked")); }
    const braces = els.length > 0 && els.every((e) => e.kind === "brace"), lanes = els.length > 0 && els.every((e) => e.kind === "lane");
    setHidden(braceRow, !braces); setHidden(laneRow, !lanes);
    if (braces) radio(braceDir, commonValue(els, (e) => e.o));
    if (lanes) radio(laneDir, commonValue(els, (e) => e.o));
    const scene = editor.scene, grp = editor.selectedGroup(), grpLocked = grp !== null && scene.groups.get(grp)?.locked === true;
    const movable = els.filter((e) => e.kind !== "arrow" && !scene.isLocked(e));
    setHidden(alignBlock, sel.size < 2 || movable.length < 2);
    if (sel.size >= 2 && movable.length >= 2) {
      const blocks = new Set<string>();
      for (const e of movable) blocks.add(e.groupIds.length ? e.groupIds[e.groupIds.length - 1]! : e.id);
      setDisabled(distH, blocks.size < 3); setDisabled(distV, blocks.size < 3);
    }
    // a whole group selected: the lock button is the group's lock (members then cannot move, resize, be edited or deleted)
    setPressed(lockBtn, grp !== null ? grpLocked : els.length > 0 && els.every((e) => scene.isLocked(e)));
    setText(lockLabel, grp !== null ? "lock group" : "lock");
    setDisabled(deleteBtn, els.length === 0 || els.every((e) => scene.isLocked(e)));
    dashNow = commonValue(els, (e) => e.dash);
    setPressed(dash, dashNow === 1);
    setDisabled(ungroupBtn as HTMLButtonElement, !els.some((e) => e.groupIds.length > 0) || els.some((e) => scene.groupLocked(e)));
    gid = commonGroupId(els);
    setHidden(nameRow, gid === null);
    name.disabled = gid !== null && editor.scene.groups.get(gid)?.locked === true; // a locked group cannot be renamed until unlocked
    if (gid !== null && document.activeElement !== name) {
      const n = editor.scene.groups.get(gid)?.name ?? "";
      if (name.value !== n) name.value = n;
    }
    setAttr(name, "data-gid", gid);
    if (pendingFocus && gid !== null) { pendingFocus = false; name.focus(); name.select(); }
  };
  ctx.d.add(() => el.remove());
  return { el, visible: () => vis, render, focusGroupName() { pendingFocus = true; }, placed: () => place !== null, toggle };
}
