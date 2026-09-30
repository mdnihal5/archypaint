import type { Tool } from "../input";
import type { Ctx } from "./ctx";
import { glyph, type GlyphName } from "./glyphs";
import { Disposer, h, setPressed } from "./dom";

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

/** shapes beyond the basics live in a flyout so the strip stays short */
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

/** Square hairline tool strip + the shapes flyout + the red "icons" button that opens the palette. */
export function mountTools(ctx: Ctx, root: HTMLElement): void {
  const { editor } = ctx;
  const buttons = new Map<string, HTMLButtonElement>();
  const strip = h("div", { class: "ap-tools", attrs: { role: "toolbar", "aria-label": "Tools", "aria-orientation": "vertical" } });
  for (const t of TOOLS) {
    if (t === "sep") { strip.append(h("div", { class: "ap-tool-sep" })); continue; }
    const b = h("button", {
      class: "ap-tool",
      attrs: { type: "button", title: `${t.label} (${t.key})`, "aria-label": t.label, "aria-pressed": "false" },
      on: { click: () => { editor.setTool(t.id as Tool); ctx.refresh(); } },
    }, glyph(t.g, 22), h("span", { class: "k", text: t.key, attrs: { "aria-hidden": "true" } }));
    buttons.set(t.id, b);
    strip.append(b);
  }

  /* ---------- shapes flyout ---------- */
  let fly: HTMLElement | null = null;
  let flyD: Disposer | null = null;
  const more = h("button", { class: "ap-tool", attrs: { type: "button", title: "More shapes", "aria-label": "More shapes", "aria-haspopup": "true", "aria-expanded": "false", "aria-pressed": "false" } },
    glyph("shapes", 22), h("span", { class: "k", text: "…", attrs: { "aria-hidden": "true" } }));
  const closeFly = (refocus = false) => {
    if (!fly) return;
    flyD?.dispose(); flyD = null; fly.remove(); fly = null;
    more.setAttribute("aria-expanded", "false");
    if (refocus) more.focus();
  };
  const pick = (id: string) => { closeFly(); editor.setTool(id as Tool); ctx.refresh(); };
  const openFly = () => {
    if (fly) { closeFly(true); return; }
    const item = (t: ToolDef) => h("button", { class: "ap-fi", attrs: { type: "button", title: t.label, "aria-label": t.label }, on: { click: () => pick(t.id) } }, glyph(t.g, 22), h("span", { text: t.label }));
    const cmd = (g: GlyphName, label: string, id: string) => h("button", { class: "ap-fi", attrs: { type: "button", title: label, "aria-label": label }, on: { click: () => pick(id) } }, glyph(g, 22), h("span", { text: label }));
    fly = h("div", { class: "ap-flyout ap-hit", attrs: { role: "menu", "aria-label": "Shapes" } },
      h("div", { class: "ap-label", text: "Shapes" }),
      h("div", { class: "ap-fgrid" }, ...SHAPE_TOOLS.map(item)),
      h("div", { class: "ap-label", text: "Insert" }),
      h("div", { class: "ap-fgrid" }, cmd("legend", "Legend", "legend"), cmd("renumber", "Renumber badges", "renumber")));
    const b = more.getBoundingClientRect();
    fly.style.left = `${Math.round(b.right + 10)}px`;
    fly.style.top = `${Math.max(8, Math.round(b.top - 8))}px`;
    root.append(fly);
    more.setAttribute("aria-expanded", "true");
    const d = (flyD = new Disposer());
    const f = fly;
    d.on(document, "pointerdown", (e: PointerEvent) => { if (!f.contains(e.target as Node) && !more.contains(e.target as Node)) closeFly(); }, { capture: true });
    d.on(document, "keydown", (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFly(true); } }, { capture: true });
    f.querySelector<HTMLElement>(".ap-fi")?.focus();
  };
  more.addEventListener("click", openFly);
  strip.append(h("div", { class: "ap-tool-sep" }), more);

  const icons = h("button", {
    class: "ap-tool-icons", attrs: { type: "button", title: "Icon library (/)", "aria-label": "Open the icon library" },
    on: { click: () => ctx.palette.open() },
  }, glyph("icons", 24), h("span", { text: "icons" }));
  const wrap = h("div", { class: "ap-toolwrap" }, strip, icons);
  root.append(wrap);

  const render = () => {
    const cur = editor.tool as string;
    for (const [id, b] of buttons) setPressed(b, id === cur);
    setPressed(more, SHAPE_IDS.has(cur));
  };
  const u = ctx.update("tools", render);
  ctx.wire(u, "tool");
  ctx.d.add(() => { closeFly(); wrap.remove(); });
  render();
}
