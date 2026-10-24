import "./ribbon.css";
import type { StyleProps } from "../editor-api";
import type { Ctx } from "./ctx";
import type { AlignMode } from "../align";
import { glyphMore, type MoreGlyph } from "./glyphs-more";
import { Disposer, h, setAttr, setDisabled, setHidden, setPressed, setText } from "./dom";
import { commonGroupId, commonValue, selectionEls } from "./props-model";
import { COLOUR_NAMES, normHex } from "../theme";
import { iconMeta } from "../icon-pack";
import { isLogoId } from "../logos";
import { TEXT_SIZES } from "../text-edit";
import type { TextAlign } from "../wrap";
import { clampPos, loadPrefs, savePrefs, type PropsPlace } from "./props-pos";

/** "none" (no tile) is offered only while every selected element is a brand logo */
const FILL = ["outline", "tint", "solid", "none"] as const;
const EDGE = ["sharp", "round", "soft"] as const;
const ROUTE: ReadonlyArray<[MoreGlyph, string]> = [["routeStraight", "straight"], ["routeElbow", "elbow"], ["routeCurve", "curve"]];
/** kinds whose text is not a free label (a number, structured rows, a picture caption): no text-size control for them */
const NO_TEXT_SIZE: ReadonlySet<string> = new Set(["brace", "badge", "calc", "legend", "image", "lane"]);
/** kinds whose label cannot be aligned: it sits on a line or under a tile (connectors, icons) or is not free text */
const NO_ALIGN: ReadonlySet<string> = new Set([...NO_TEXT_SIZE, "icon", "arrow"]);
const ALIGNS: ReadonlyArray<[TextAlign, MoreGlyph]> = [["left", "textLeft"], ["center", "textCenter"], ["right", "textRight"]];
const KIND: Record<string, string> = { arrow: "Connector", rect: "Rectangle", ellipse: "Ellipse", diamond: "Diamond", text: "Text", line: "Line", cylinder: "Database", note: "Sticky note", frame: "Frame", lane: "Swimlane", badge: "Step badge", calc: "Capacity note", legend: "Legend", image: "Image" };
/** swatches shown inline; the other 16 and the hex field are behind the "…" popover */
const INLINE_SW = 8;

export interface Ribbon { el: HTMLElement; isOpen(): boolean; visible(): boolean; render(): void; focusGroupName(): void; placed(): boolean; toggle(): void }

/**
 * Properties ribbon: the style of the current selection, two rows above the dock (a third with 2+ shapes selected).
 * Opened only by the viewer (I / the toggle button), never by a selection. Drag the grip to float it; double-click the grip to dock it again.
 * Reads only the first 400 selected elements. Built (and its code loaded) on the first open.
 */
export function mountRibbon(ctx: Ctx, parent: HTMLElement): Ribbon {
  const { editor } = ctx;
  const set = (p: Partial<StyleProps>) => { editor.setStyle(p); ctx.refresh(); };

  const segEl = (label: string, kids: HTMLButtonElement[]) => h("div", { class: "ap-seg", attrs: { role: "radiogroup", "aria-label": label } }, ...kids);
  const radioBtn = (content: Node | string, title: string, onClick: () => void, ico = false) =>
    h("button", { class: ico ? "ico" : "", attrs: { type: "button", role: "radio", "aria-checked": "false", title, "aria-label": title }, on: { click: onClick } }, content);
  const seg = (label: string, names: readonly string[], key: keyof StyleProps) => {
    const btns = names.map((n, i) => radioBtn(n, `${label}: ${n}`, () => set({ [key]: i } as Partial<StyleProps>)));
    return { el: segEl(label, btns), btns };
  };
  const field = (label: string, ...kids: Node[]) => h("div", { class: "rf" }, h("span", { class: "ap-label", text: label }), ...kids);
  const ib = (g: MoreGlyph, label: string, fn: () => void) =>
    h("button", { class: "ap-ib sm", attrs: { type: "button", title: label, "aria-label": label }, on: { click: () => { fn(); ctx.refresh(); } } }, glyphMore(g, 18));

  /* ---------- row A: kind / group name, colour, fill, edge, dashed ---------- */
  const grip = h("button", { class: "ap-grip", attrs: { type: "button", title: "Drag to move · double-click to dock · I closes", "aria-label": "Move the properties panel" } }, glyphMore("grip", 16));
  const kind = h("span", { class: "ap-kind" });
  let gid: string | null = null;
  const name = h("input", { class: "ap-input ap-gname", attrs: { type: "text", placeholder: "name this group", "aria-label": "Group name", maxlength: 40, autocomplete: "off", spellcheck: "false" } });
  const commit = () => { if (gid && name.value.trim() !== (editor.scene.groups.get(gid)?.name ?? "")) { editor.renameGroup(gid, name.value.trim()); ctx.refresh(); } };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(); name.blur(); } else if (e.key === "Escape") { name.value = editor.scene.groups.get(gid ?? "")?.name ?? ""; name.blur(); } });
  name.addEventListener("blur", commit);

  const mkSw = (i: number) => h("button", { class: "ap-sw", style: { "--c": `var(--cat${i})` }, attrs: { type: "button", title: COLOUR_NAMES[i]!, "aria-label": `Colour ${COLOUR_NAMES[i]}`, "aria-pressed": "false" }, on: { click: () => { set({ cat: i, hex: "" }); closePop(); } } });
  const sw: HTMLButtonElement[] = Array.from({ length: INLINE_SW }, (_, i) => mkSw(i));
  const moreBtn = h("button", { class: "ap-sw more", attrs: { type: "button", title: "All colours and a custom hex", "aria-label": "More colours", "aria-haspopup": "true", "aria-expanded": "false" } }, glyphMore("more", 14));
  const colourField = field("Colour", h("div", { class: "ap-swatches" }, ...sw, moreBtn));

  const fill = seg("Fill", FILL, "fill");
  const edge = seg("Edge", EDGE, "edge");
  let dashNow: 0 | 1 | undefined;
  const dash = h("button", { class: "ap-btn", text: "dashed", attrs: { type: "button", "aria-pressed": "false" }, on: { click: () => set({ dash: dashNow === 1 ? 0 : 1 }) } });
  const rowA = h("div", { class: "rr" }, grip, kind, name, colourField, field("Fill", fill.el), field("Edge", edge.el), dash);

  /* ---------- row B: route, text, arrange, group, lock, style, delete ---------- */
  const route = segEl("Route", ROUTE.map(([g, n]) => radioBtn(glyphMore(g, 18), `Route: ${n}`, () => set({ route: ROUTE.findIndex((r) => r[1] === n) as 0 | 1 | 2 }), true)));
  const routeBtns = [...route.children] as HTMLButtonElement[];
  const routeField = field("Route", route);
  const sizeBtns = TEXT_SIZES.map((t) => radioBtn(t.label, `Text size ${t.label}${t.px ? ` (${t.px}px)` : " (default)"}`, () => set({ fs: t.px })));
  const sizeField = field("Text", segEl("Text size", sizeBtns));
  const alignBtns = ALIGNS.map(([a, g]) => radioBtn(glyphMore(g, 16), `Align text ${a === "center" ? "centre" : a}`, () => set({ align: a }), true));
  const alignField = h("div", { class: "rf" }, segEl("Text alignment", alignBtns));
  const braceDir = seg("Brace direction", ["left", "right", "up", "down"], "o");
  const laneDir = seg("Lane direction", ["rows", "columns"], "o");
  const braceField = field("Points", braceDir.el);
  const laneField = field("Lanes as", laneDir.el);

  const arrange = h("div", { class: "ap-iconrow", attrs: { role: "group", "aria-label": "Arrange" } },
    ib("front", "Bring to front (⇧⌘])", () => editor.bringToFront()), ib("forward", "Bring forward (⌘])", () => editor.bringForward()),
    ib("backward", "Send backward (⌘[)", () => editor.sendBackward()), ib("back", "Send to back (⇧⌘[)", () => editor.sendToBack()));
  let pendingFocus = false;
  const txtBtn = (text: string, kbd: string, title: string, fn: () => void, icon?: MoreGlyph) =>
    h("button", { class: "ap-btn", attrs: { type: "button", title }, on: { click: () => { fn(); ctx.refresh(); } } }, ...(icon ? [glyphMore(icon, 16)] : []), h("span", { text }), h("span", { class: "ap-kbd", text: kbd }));
  const groupBtn = txtBtn("group", "⌘G", "Group (⌘G)", () => { if (editor.group()) pendingFocus = true; }, "groupBox");
  const ungroupBtn = txtBtn("ungroup", "⇧⌘G", "Ungroup (⇧⌘G)", () => editor.ungroup());
  const lockBtn = h("button", { class: "ap-ib sm", attrs: { type: "button", "aria-pressed": "false", "aria-label": "Lock", title: "Lock: cannot be moved, resized, edited or deleted (⇧⌘L)" }, on: { click: () => { editor.toggleLock(); ctx.refresh(); } } }, glyphMore("lock", 18));
  const copyBtn = ib("copyStyle", "Copy style (⌥⌘C)", () => editor.copyStyle());
  const pasteBtn = ib("pasteStyle", "Paste style (⌥⌘V)", () => editor.pasteStyle());
  const deleteBtn = h("button", { class: "ap-ib sm ap-danger", attrs: { type: "button", title: "Delete (⌫)", "aria-label": "Delete selection" }, on: { click: () => { editor.deleteSelection(); ctx.refresh(); } } }, glyphMore("trash", 18));
  const rowB = h("div", { class: "rr" }, routeField, sizeField, alignField, braceField, laneField, h("span", { class: "ap-sep" }), arrange, h("span", { class: "ap-sep" }), groupBtn, ungroupBtn, lockBtn, copyBtn, pasteBtn, h("span", { class: "push" }), deleteBtn);

  /* ---------- row C: align / distribute (2+ movable shapes) ---------- */
  const distH = ib("distH", "Distribute horizontally (⌥⇧X, needs 3+)", () => editor.distribute("h"));
  const distV = ib("distV", "Distribute vertically (⌥⇧Y, needs 3+)", () => editor.distribute("v"));
  const rowC = h("div", { class: "rr" }, h("span", { class: "ap-label", text: "Align" }),
    h("div", { class: "ap-iconrow", attrs: { role: "group", "aria-label": "Align" } },
      ib("alignLeft", "Align left (⌥⇧←)", () => editor.align("left" as AlignMode)), ib("alignCenter", "Align centres horizontally (⌥⇧H)", () => editor.align("center")),
      ib("alignRight", "Align right (⌥⇧→)", () => editor.align("right")), ib("alignTop", "Align top (⌥⇧↑)", () => editor.align("top")),
      ib("alignMiddle", "Align middles vertically (⌥⇧V)", () => editor.align("middle")), ib("alignBottom", "Align bottom (⌥⇧↓)", () => editor.align("bottom"))),
    h("span", { class: "ap-sep" }), h("span", { class: "ap-label", text: "Distribute · match" }),
    h("div", { class: "ap-iconrow", attrs: { role: "group", "aria-label": "Distribute and match size" } },
      distH, distV, ib("matchW", "Match width", () => editor.matchSize("w")), ib("matchH", "Match height", () => editor.matchSize("h")), ib("matchBoth", "Match size (⌥⇧S)", () => editor.matchSize("both"))));

  const empty = h("div", { class: "rr ap-empty" }, h("span", { class: "ap-note", text: "Select something on the canvas to style it. I closes this panel." }));
  const el = h("section", { class: "ap-ribbon ap-card ap-hit", attrs: { "aria-label": "Properties", "data-empty": "true" } }, rowA, rowB, rowC, empty);
  parent.append(el);

  /* ---------- the "…" colour popover: all 24 colours and a custom hex (built on first use) ---------- */
  let pop: HTMLElement | null = null;
  let popD: Disposer | null = null;
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
  hexInput.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { applyHex(); hexInput.blur(); } else if (e.key === "Escape") { hexSync(); hexInput.blur(); } });
  hexInput.addEventListener("blur", applyHex);
  let popSw: HTMLButtonElement[] = [];
  let catNow: number | undefined;
  const paintPop = () => { popSw.forEach((b, i) => setPressed(b, !hexNow && catNow === i)); hexSync(); };
  function closePop(refocus = false): void {
    if (!pop) return;
    popD?.dispose(); popD = null; pop.remove(); pop = null; popSw = [];
    moreBtn.setAttribute("aria-expanded", "false");
    if (refocus) moreBtn.focus();
  }
  const openPop = () => {
    if (pop) { closePop(true); return; }
    popSw = COLOUR_NAMES.map((n, i) => h("button", { class: "ap-sw", style: { "--c": `var(--cat${i})` }, attrs: { type: "button", title: n, "aria-label": `Colour ${n}`, "aria-pressed": "false" }, on: { click: () => { set({ cat: i, hex: "" }); } } }));
    pop = h("div", { class: "ap-pop ap-card ap-hit", attrs: { role: "dialog", "aria-label": "All colours" } }, h("div", { class: "ap-swgrid" }, ...popSw), h("div", { class: "ap-hexrow" }, hexDot, hexInput));
    el.append(pop);
    const r = moreBtn.getBoundingClientRect(), pr = el.getBoundingClientRect();
    pop.style.left = `${Math.max(0, Math.min(r.left - pr.left - 20, pr.width - 250))}px`;
    moreBtn.setAttribute("aria-expanded", "true");
    const d = (popD = new Disposer());
    const p = pop;
    d.on(document, "pointerdown", (e: PointerEvent) => { if (!p.contains(e.target as Node) && !moreBtn.contains(e.target as Node)) closePop(); }, { capture: true });
    d.on(document, "keydown", (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(true); } }, { capture: true });
    paintPop();
  };
  moreBtn.addEventListener("click", openPop);

  /* ---------- placement: docked above the dock, or floated by the viewer (per browser) ---------- */
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
    if (r.width === 0) return;
    const c = clampPos(place, r.width, r.height, window.innerWidth, window.innerHeight);
    if (c.x !== place.x || c.y !== place.y) { place = c; paint(); }
  };
  let drag: { dx: number; dy: number; id: number } | null = null;
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || el.getBoundingClientRect().width === 0) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    if (!place) { place = { x: r.left, y: r.top }; paint(); } // switch to fixed positioning exactly where it is: no jump
    try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic pointer: moves still arrive on the grip */ }
    e.preventDefault();
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = el.getBoundingClientRect();
    place = clampPos({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, r.width, r.height, window.innerWidth, window.innerHeight);
    paint();
  });
  const endDrag = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { drag = null; persist(); } };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  grip.addEventListener("dblclick", () => { place = null; paint(); persist(); });
  ctx.d.on(window, "resize", reclamp);
  paint();
  const toggle = () => { open = !open; persist(); if (!open) closePop(); ctx.refresh(); };

  let vis = false;
  const radio = (btns: readonly HTMLElement[], v: number | undefined) => btns.forEach((b, i) => setPressed(b, v === i, "aria-checked"));
  const render = () => {
    const sel = editor.selection();
    const wasVis = vis;
    vis = open && !editor.editing; // never opens by selection; steps aside while a label is typed so it cannot cover or steal focus from the editor
    if (vis && !wasVis) ctx.closeMenu();
    setHidden(el, !vis);
    if (!vis) { gid = null; closePop(); return; }
    setAttr(el, "data-empty", sel.size === 0 ? "true" : "false");
    if (sel.size === 0) { gid = null; setText(kind, "Nothing selected"); closePop(); return; }
    const els = selectionEls(editor.scene.els, sel);
    if (!wasVis) reclamp();
    const first = els[0];
    setText(kind, sel.size > 1 ? `${sel.size} selected` : first?.kind === "icon" ? `${isLogoId(first.iconId) ? "Logo" : "Icon"} · ${iconMeta(first.iconId)?.name ?? first.iconId}` : KIND[first?.kind ?? ""] ?? first?.kind ?? "1 selected");
    catNow = commonValue(els, (e) => e.cat);
    const hex = commonValue(els, (e) => e.hex ?? "");
    hexNow = hex ?? "";
    sw.forEach((b, i) => setPressed(b, !hex && catNow === i));
    setAttr(moreBtn, "data-on", (hex || (catNow !== undefined && catNow >= INLINE_SW)) ? "true" : "false");
    moreBtn.style.setProperty("--c", hex ? hex : catNow !== undefined && catNow >= INLINE_SW ? `var(--cat${catNow})` : "transparent");
    if (pop) paintPop();
    radio(fill.btns, commonValue(els, (e) => e.fill));
    setHidden(fill.btns[3]!, !els.every((e) => e.kind === "icon" && isLogoId(e.iconId)));
    radio(edge.btns, commonValue(els, (e) => e.edge));
    const arrows = els.some((e) => e.kind === "arrow");
    setHidden(routeField, !arrows);
    radio(routeBtns, arrows ? commonValue(els.filter((e) => e.kind === "arrow"), (e) => e.route) : undefined);
    const texty = els.some((e) => !NO_TEXT_SIZE.has(e.kind));
    setHidden(sizeField, !texty);
    if (texty) { const fs = commonValue(els.filter((e) => !NO_TEXT_SIZE.has(e.kind)), (e) => e.fs ?? 0); sizeBtns.forEach((b, i) => setPressed(b, fs === TEXT_SIZES[i]!.px, "aria-checked")); }
    const aligned = els.filter((e) => !NO_ALIGN.has(e.kind));
    setHidden(alignField, aligned.length === 0);
    if (aligned.length) { const al = commonValue(aligned, (e) => e.align ?? "center"); alignBtns.forEach((b, i) => setPressed(b, al === ALIGNS[i]![0], "aria-checked")); }
    const braces = els.length > 0 && els.every((e) => e.kind === "brace"), lanes = els.length > 0 && els.every((e) => e.kind === "lane");
    setHidden(braceField, !braces); setHidden(laneField, !lanes);
    if (braces) radio(braceDir.btns, commonValue(els, (e) => e.o));
    if (lanes) radio(laneDir.btns, commonValue(els, (e) => e.o));
    const scene = editor.scene, grp = editor.selectedGroup(), grpLocked = grp !== null && scene.groups.get(grp)?.locked === true;
    const movable = els.filter((e) => e.kind !== "arrow" && !scene.isLocked(e));
    setHidden(rowC, sel.size < 2 || movable.length < 2);
    if (sel.size >= 2 && movable.length >= 2) {
      const blocks = new Set<string>();
      for (const e of movable) blocks.add(e.groupIds.length ? e.groupIds[e.groupIds.length - 1]! : e.id);
      setDisabled(distH, blocks.size < 3); setDisabled(distV, blocks.size < 3);
    }
    // a whole group selected: the lock button is the group's lock (members then cannot move, resize, be edited or deleted)
    setPressed(lockBtn, grp !== null ? grpLocked : els.length > 0 && els.every((e) => scene.isLocked(e)));
    setAttr(lockBtn, "aria-label", grp !== null ? "Lock group" : "Lock");
    setDisabled(deleteBtn, els.length === 0 || els.every((e) => scene.isLocked(e)));
    dashNow = commonValue(els, (e) => e.dash);
    setPressed(dash, dashNow === 1);
    setDisabled(ungroupBtn, !els.some((e) => e.groupIds.length > 0) || els.some((e) => scene.groupLocked(e)));
    gid = commonGroupId(els);
    setHidden(name, gid === null); setHidden(kind, gid !== null);
    name.disabled = gid !== null && editor.scene.groups.get(gid)?.locked === true; // a locked group cannot be renamed until unlocked
    if (gid !== null && document.activeElement !== name) {
      const n = editor.scene.groups.get(gid)?.name ?? "";
      if (name.value !== n) name.value = n;
    }
    setAttr(name, "data-gid", gid);
    if (pendingFocus && gid !== null) { pendingFocus = false; name.focus(); name.select(); }
  };
  ctx.d.add(() => { closePop(); el.remove(); });
  return { el, isOpen: () => open, visible: () => vis, render, focusGroupName() { pendingFocus = true; }, placed: () => place !== null, toggle };
}
