import type { Tool } from "../input";
import type { Ctx } from "./ctx";
import { glyph, type GlyphName } from "./glyphs";
import { Disposer, h, setDisabled, setPressed } from "./dom";

interface ToolDef { id: string; g: GlyphName; key: string; label: string }

const TOOLS: Array<ToolDef | "sep"> = [
  { id: "select", g: "select", key: "V", label: "Select" },
  { id: "hand", g: "hand", key: "H", label: "Hand" },
  "sep",
  { id: "rect", g: "rect", key: "R", label: "Rectangle" },
  { id: "diamond", g: "diamond", key: "D", label: "Diamond" },
  { id: "ellipse", g: "ellipse", key: "O", label: "Ellipse" },
  { id: "arrow", g: "arrow", key: "A", label: "Arrow" },
  { id: "line", g: "line", key: "L", label: "Line" },
  { id: "text", g: "text", key: "T", label: "Text" },
];

/** shapes beyond the basics live in a flyout so the dock stays short */
const SHAPE_TOOLS: ToolDef[] = [
  { id: "cylinder", g: "cylinder", key: "", label: "Database" },
  { id: "cloud", g: "cloud", key: "", label: "Cloud" },
  { id: "hexagon", g: "hexagon", key: "", label: "Hexagon" },
  { id: "parallelogram", g: "parallelogram", key: "", label: "Parallelogram" },
  { id: "triangle", g: "triangle", key: "", label: "Triangle" },
  { id: "star", g: "star", key: "", label: "Star" },
  { id: "note", g: "note", key: "", label: "Sticky note" },
  { id: "brace", g: "brace", key: "", label: "Brace" },
  { id: "badge", g: "badge", key: "", label: "Step badge" },
  { id: "frame", g: "frame", key: "", label: "Frame / region" },
  { id: "lane", g: "lane", key: "", label: "Swimlane" },
];
const SHAPE_IDS = new Set(SHAPE_TOOLS.map((t) => t.id));
/** creation tools; select and hand are always "kept" */
const LOCKABLE = new Set(["rect", "diamond", "ellipse", "arrow", "line", "text"]);

/**
 * The bottom-centre dock: tools, the shapes flyout, the icon-search field, undo / redo and the menu button.
 * Keys live in the tooltips only. The search field is a button that opens the icon drawer: it is also the "/" hint.
 */
export function mountDock(ctx: Ctx, root: HTMLElement): void {
  const { editor } = ctx;
  const buttons = new Map<string, HTMLButtonElement>();
  const dock = h("div", { class: "ap-dock ap-hit", attrs: { role: "toolbar", "aria-label": "Tools" } });
  const ib = (g: GlyphName, label: string, fn: () => void) =>
    h("button", { class: "ap-ib", attrs: { type: "button", title: label, "aria-label": label }, on: { click: () => { fn(); ctx.refresh(); } } }, glyph(g, 20));

  for (const t of TOOLS) {
    if (t === "sep") { dock.append(h("div", { class: "ap-sep" })); continue; }
    const b = h("button", {
      class: "ap-ib",
      attrs: { type: "button", title: `${t.label} (${t.key})`, "aria-label": t.label, "aria-pressed": "false" },
      on: {
        click: () => { editor.setTool(t.id as Tool); ctx.refresh(); },
        // double-click keeps a creation tool active after every shape; double-click again (or pick another tool) turns it off
        dblclick: () => {
          if (!LOCKABLE.has(t.id)) return;
          editor.setTool(t.id as Tool);
          editor.setToolLock(!editor.toolLocked);
          ctx.refresh();
        },
      },
    }, glyph(t.g, 20));
    buttons.set(t.id, b);
    dock.append(b);
  }

  /* ---------- shapes flyout ---------- */
  let fly: HTMLElement | null = null;
  let flyD: Disposer | null = null;
  const more = h("button", { class: "ap-ib", attrs: { type: "button", title: "More shapes", "aria-label": "More shapes", "aria-haspopup": "true", "aria-expanded": "false", "aria-pressed": "false" } }, glyph("shapes", 20));
  const closeFly = (refocus = false) => {
    if (!fly) return;
    flyD?.dispose(); flyD = null; fly.remove(); fly = null;
    more.setAttribute("aria-expanded", "false");
    if (refocus) more.focus();
  };
  const pick = (id: string) => { closeFly(); editor.setTool(id as Tool); ctx.refresh(); };
  const openFly = () => {
    if (fly) { closeFly(true); return; }
    const item = (t: ToolDef) => h("button", { class: "ap-fi", attrs: { type: "button", title: t.label, "aria-label": t.label }, on: { click: () => pick(t.id) } }, glyph(t.g, 20), h("span", { text: t.label }));
    const cmd = (g: GlyphName, label: string, id: string) => h("button", { class: "ap-fi", attrs: { type: "button", title: label, "aria-label": label }, on: { click: () => pick(id) } }, glyph(g, 20), h("span", { text: label }));
    fly = h("div", { class: "ap-flyout ap-hit", attrs: { role: "menu", "aria-label": "Shapes" } },
      h("button", { class: "ap-fi wide", attrs: { type: "button", title: "Icon library (/)", "aria-label": "Icon library" }, on: { click: () => { closeFly(); ctx.palette.open(); } } }, glyph("icons", 20), h("span", { text: "Logos and icons" }), h("span", { class: "ap-kbd", text: "/" })),
      h("div", { class: "ap-label", text: "Shapes" }),
      h("div", { class: "ap-fgrid" }, ...SHAPE_TOOLS.map(item)),
      h("div", { class: "ap-label", text: "Insert" }),
      h("div", { class: "ap-fgrid" }, cmd("legend", "Legend", "legend"), cmd("renumber", "Renumber badges", "renumber")));
    const b = more.getBoundingClientRect();
    fly.style.left = `${Math.max(8, Math.min(Math.round(b.left - 8), window.innerWidth - 280))}px`;
    fly.style.bottom = `${Math.round(window.innerHeight - b.top + 10)}px`;
    root.append(fly);
    more.setAttribute("aria-expanded", "true");
    const d = (flyD = new Disposer());
    const f = fly;
    d.on(document, "pointerdown", (e: PointerEvent) => { if (!f.contains(e.target as Node) && !more.contains(e.target as Node)) closeFly(); }, { capture: true });
    d.on(document, "keydown", (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFly(true); } }, { capture: true });
    f.querySelector<HTMLElement>(".ap-fi")?.focus();
  };
  more.addEventListener("click", openFly);
  dock.append(more, h("div", { class: "ap-sep" }));

  /* ---------- the icon-search field: a button that opens the drawer ---------- */
  const search = h("button", { class: "ap-dsearch", attrs: { type: "button", title: "Icon library (/)", "aria-label": "Search icons", "aria-haspopup": "dialog" }, on: { click: () => ctx.palette.open() } },
    glyph("search", 16), h("span", { text: typeof __LOGO_COUNT__ === "number" ? `Search ${__LOGO_COUNT__} logos` : "Search logos and icons" }), h("span", { class: "ap-kbd", text: "/" }));
  dock.append(search, h("div", { class: "ap-sep" }));

  const undo = ib("undo", "Undo (⌘Z)", () => editor.undo());
  const redo = ib("redo", "Redo (⇧⌘Z)", () => editor.redo());
  const menu = h("button", { class: "ap-ib", attrs: { type: "button", title: "Menu", "aria-label": "Menu", "aria-haspopup": "true", "aria-expanded": "false", "data-menubtn": "" }, on: { click: () => ctx.toggleMenu() } }, glyph("menu", 20));
  dock.append(undo, redo, h("div", { class: "ap-sep" }), menu);
  root.append(dock);

  const render = () => {
    const cur = editor.tool as string;
    const locked = editor.toolLocked;
    for (const [id, b] of buttons) {
      setPressed(b, id === cur);
      const on = locked && id === cur;
      if (b.dataset.locked !== String(on)) {
        b.dataset.locked = String(on);
        const t = TOOLS.find((x): x is ToolDef => x !== "sep" && x.id === id)!;
        b.title = on ? `${t.label} (${t.key}) — kept active; double-click or Q to release` : `${t.label} (${t.key}) — double-click to keep active`;
      }
    }
    more.dataset.locked = String(locked && SHAPE_IDS.has(cur));
    setPressed(more, SHAPE_IDS.has(cur));
    setDisabled(undo, !editor.canUndo());
    setDisabled(redo, !editor.canRedo());
  };
  const u = ctx.update("dock", render);
  ctx.wire(u, "tool", "history", "change");
  ctx.d.add(() => { closeFly(); dock.remove(); });
  render();
}
