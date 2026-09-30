import { fromHTML, h, setAttr, setText } from "./dom";
import type { Ctx } from "./ctx";

const EDGE = ["sharp", "round", "soft"] as const;
const FILL = ["outline", "tint", "solid"] as const;

const ZONE_T = ["1", "2", "3", "4", "5", "6", "7", "8"];
const ZONE_L = ["A", "B", "C", "D"];

/** ghost diagram: three empty slots, a dashed group boundary and dashed connectors, numbered like the General Notes */
const GHOST = `<svg viewBox="0 0 660 280" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false">
<defs><marker id="apg" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M1.5 1.5L8.5 5L1.5 8.5" fill="none" stroke="var(--mid)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
<rect class="g-group" x="290" y="0" width="176" height="270"/>
${[[60, 140, "client"], [220, 140, "?"], [378, 68, "?"], [378, 208, "?"], [580, 140, "store"]]
  .map(([cx, cy, l]) => `<rect class="g-slot" x="${(cx as number) - 56}" y="${(cy as number) - 38}" width="112" height="76"/><path class="g-plus" d="M${(cx as number) - 8} ${(cy as number) - 6}h16M${cx} ${(cy as number) - 14}v16"/><text class="g-label" x="${cx}" y="${(cy as number) + 27}">${l}</text>`).join("")}
${["116 140 164 140", "276 140 300 140 300 68 322 68", "276 140 300 140 300 208 322 208", "434 68 510 68 510 140 524 140", "434 208 510 208 510 140 524 140"]
  .map((p) => { const n = p.split(" ").map(Number); let d = `M${n[0]} ${n[1]}`; for (let i = 2; i < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`; return `<path class="g-edge" d="${d}" marker-end="url(#apg)"/><circle class="g-port" cx="${n[0]}" cy="${n[1]}" r="5"/>`; }).join("")}
${[[16, 96, "1"], [140, 124, "2"], [290, 12, "3"]].map(([x, y, n]) => `<circle class="g-mark" cx="${x}" cy="${y}" r="11"/><text class="g-marktxt" x="${x}" y="${(y as number) + 4}">${n}</text>`).join("")}
</svg>`;

export interface Sheet { titleInput: HTMLInputElement; refresh(): void }

/**
 * The drafting sheet: zoned double border and title block always (until "sheet frame" is turned off); the welcome
 * (command line, General Notes, ghost diagram) only while the scene is empty. All static markup; the only writes
 * after mount are equality-guarded attribute/text updates inside one rAF-coalesced updater.
 */
export function mountSheet(ctx: Ctx, root: HTMLElement): Sheet {
  const { editor, palette, io, settings } = ctx;

  const zone = (cls: string, labels: string[]) => h("div", { class: `ap-zone ${cls}`, attrs: { "aria-hidden": "true" } }, ...labels.map((l) => h("span", { text: l })));
  const frame = h("div", { class: "ap-frame", attrs: { "aria-hidden": "true" } }, zone("t", ZONE_T), zone("b", ZONE_T), zone("l", ZONE_L), zone("r", ZONE_L));

  const cmd = h("button", {
    class: "ap-cmd ap-hit", attrs: { type: "button", "aria-label": "Place an icon (press /)" },
    on: { click: () => palette.open() },
  }, h("span", { class: "slash", text: "/" }), h("span", { text: "place an icon" }), h("i", { class: "ap-caret", attrs: { "aria-hidden": "true" } }));
  const notes = h("aside", { class: "ap-notes" },
    h("h2", { text: "General notes" }),
    h("ol", {}, ...["Press / to place any icon.", "Drag from a dot to connect.", "⌘G to group. Double-click to name.", "Nothing leaves this browser.", "All dimensions are yours."].map((t) => h("li", { text: t }))));
  const ghost = h("div", { class: "ap-ghost", attrs: { "aria-hidden": "true" } }, fromHTML(GHOST));
  const welcome = h("div", { class: "ap-welcome" }, cmd,
    h("div", { class: "ap-hintline", text: "kafka · load balancer · cron job · read replica · service worker" }), notes, ghost);

  const input = (label: string, aria: string, get: () => string, set: (v: string) => void) => {
    const inp = h("input", { attrs: { type: "text", value: get(), "aria-label": aria, maxlength: 24, spellcheck: "false", autocomplete: "off" } });
    inp.addEventListener("change", () => set(inp.value.trim()));
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); if (e.key === "Escape") { inp.value = get(); inp.blur(); } });
    return { cell: h("div", { class: "ap-tb-cell" }, h("label", { text: label }), inp), inp };
  };
  const title = input("TITLE", "Sheet title", () => io.docName(), (v) => { io.setDocName(v || "untitled"); ctx.refresh(); });
  const scale = input("SCALE", "Sheet scale", () => settings.get().scale, (v) => settings.set({ scale: v || "1:1" }));
  const styleV = h("span", { class: "v" });
  const rev = input("REV", "Sheet revision", () => settings.get().rev, (v) => settings.set({ rev: v || "0" }));
  const tb = h("div", { class: "ap-titleblock", attrs: { role: "group", "aria-label": "Title block" } },
    h("div", { class: "ap-tb-head" }, h("span", { text: "ARCHYPAINT" }), h("em", { text: "SHEET 01 / 01" })),
    title.cell, scale.cell,
    h("div", { class: "ap-tb-cell" }, h("label", { text: "STYLE" }), styleV), rev.cell);

  const sheet = h("div", { attrs: { id: "sheet", "data-empty": "true" } }, frame, welcome, tb);
  root.append(sheet);

  const render = () => {
    setAttr(sheet, "data-empty", editor.scene.els.size === 0 ? "true" : "false");
    setText(styleV, `${EDGE[editor.defaults.edge]} · ${FILL[editor.defaults.fill]}`);
    for (const [c, v] of [[scale.inp, settings.get().scale], [rev.inp, settings.get().rev]] as const) if (document.activeElement !== c && c.value !== v) c.value = v;
  };
  const u = ctx.update("sheet", render);
  ctx.wire(u, "change");
  ctx.d.add(settings.subscribe(() => u.schedule()));
  ctx.d.add(() => sheet.remove());
  render();
  return { titleInput: title.inp, refresh: () => u.schedule() };
}
