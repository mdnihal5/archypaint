import type { FeatureCtx } from "../features/types";
import { ensureIcons, listIcons } from "../icon-pack";
import { parseDiagram, type Diag, type Graph, type IconResolver } from "../textdsl";
import { importGraph, makeResolver } from "../textimport";
import "./textimport.css";
import { h } from "./dom";
import { openModal } from "./modal";

const EXAMPLE_DSL = `# chains, fan-out lists, labels, dashed = async
client -> lb -> [api1, api2] -> postgres
api1 -> redis : cache
api2 ==> kafka : events
kafka -> worker
[backend] { api1, api2, worker }
lb: load-balancer
postgres: cylinder`;

const EXAMPLE_MERMAID = `flowchart LR
  U[Users] --> CDN
  CDN -->|miss| LB{Load balancer}
  subgraph app [App tier]
    LB --> A1(API 1) & A2(API 2)
  end
  A1 & A2 --> DB[(Postgres)]
  A1 -.-> C[Cache]`;

const PLACEHOLDER = "client -> lb -> [api1, api2] -> postgres\n\nor paste a Mermaid flowchart (flowchart LR …)";
const SHOW = 8;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** what the preview line says about a parse */
export function summarize(g: Graph): { text: string; ok: boolean } {
  if (g.errors.length) return { text: `${g.errors.length} ${g.errors.length === 1 ? "problem" : "problems"} — fix to import`, ok: false };
  if (!g.nodes.length) return { text: "nothing yet", ok: false };
  const icons = g.nodes.filter((n) => n.iconId).length;
  const bits = [plural(g.nodes.length, "node", "nodes"), plural(g.edges.length, "arrow", "arrows")];
  if (g.groups.length) bits.push(plural(g.groups.length, "group", "groups"));
  if (icons) bits.push(plural(icons, "icon", "icons"));
  bits.push(g.syntax === "mermaid" ? "Mermaid" : "text");
  return { text: bits.join(" · "), ok: true };
}

/**
 * The "Diagram from text…" overlay. A modal (focus trap, Escape, backdrop) holding a textarea with a debounced live preview.
 * Everything it owns — the DOM, the preview timer, the icon-ready hookup — is released by close(); the modal removes its own
 * document listener. Parsing is cheap and pure (see textdsl.ts); the import is one undo step.
 */
export function openTextImport(c: FeatureCtx): { close(): void } {
  const root = document.getElementById("ui") ?? document.body;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let resolver: IconResolver | undefined;
  let graph: Graph | null = null;

  const ta = h("textarea", { class: "ap-ti-text", attrs: { spellcheck: "false", "aria-label": "Diagram text", placeholder: PLACEHOLDER, tabindex: 0, "data-autofocus": "1", autocomplete: "off", autocapitalize: "off" } });
  const status = h("div", { class: "ap-ti-status", attrs: { role: "status", "aria-live": "polite" } });
  const diag = h("ul", { class: "ap-ti-diag", attrs: { "aria-label": "Notes on the text" } });
  const go = h("button", { class: "ap-btn ap-ti-go", text: "Import", attrs: { type: "button", disabled: true } });

  const render = () => {
    if (closed) return;
    const g = (graph = parseDiagram(ta.value, resolver ? { resolver } : {}));
    const sum = summarize(g);
    status.textContent = ta.value.trim() ? sum.text : "";
    status.dataset.bad = String(!!ta.value.trim() && !sum.ok);
    go.disabled = !sum.ok;
    diag.replaceChildren();
    const rows: Array<[Diag, "err" | "warn"]> = [...g.errors.map((d): [Diag, "err"] => [d, "err"]), ...g.warnings.map((d): [Diag, "warn"] => [d, "warn"])];
    for (const [d, k] of rows.slice(0, SHOW)) diag.append(h("li", { attrs: { "data-k": k } }, h("b", { text: `line ${d.line}` }), h("span", { text: d.msg })));
    if (rows.length > SHOW) diag.append(h("li", { attrs: { "data-k": "warn" } }, h("span", { text: `… and ${rows.length - SHOW} more` })));
  };
  const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = 0; render(); }, 150); };

  const doImport = () => {
    if (closed) return;
    render(); // always import what is on screen right now, never a stale preview
    const g = graph;
    if (!g || g.errors.length || !g.nodes.length) return;
    const built = importGraph(c.editor, g, true);
    if (!built) { c.toast("Nothing was imported.", "err"); return; }
    const warn = g.warnings.length ? ` (${g.warnings.length} ${g.warnings.length === 1 ? "note" : "notes"})` : "";
    host.close();
    c.toast(`Imported ${plural(built.nodes, "node", "nodes")} and ${plural(built.edges, "arrow", "arrows")}${warn}.`);
  };

  const example = (text: string) => { ta.value = text; render(); ta.focus(); };
  const host = openModal(root, [
    h("div", { class: "ap-ti" },
      h("h2", { text: "Diagram from text" }),
      h("p", { class: "ap-ti-hint" },
        h("code", { text: "a -> b -> [c, d]" }), " chains · ", h("code", { text: "a ==> b" }), " dashed · ", h("code", { text: "a -> b : label" }), " · ",
        h("code", { text: "lb: load-balancer" }), " icon or shape · ", h("code", { text: "[group] { a, b }" }), " · or a Mermaid flowchart"),
      ta,
      h("div", { class: "ap-ti-ex" }, "examples:",
        h("button", { class: "ap-btn", text: "text", attrs: { type: "button" }, on: { click: () => example(EXAMPLE_DSL) } }),
        h("button", { class: "ap-btn", text: "Mermaid", attrs: { type: "button" }, on: { click: () => example(EXAMPLE_MERMAID) } })),
      status, diag,
      h("div", { class: "ap-actions" },
        h("button", { class: "ap-btn", text: "Cancel", attrs: { type: "button" }, on: { click: () => host.close() } }),
        go)),
  ], () => {
    closed = true;
    if (timer) clearTimeout(timer);
    timer = 0; graph = null; resolver = undefined;
  });

  ta.addEventListener("input", soon);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doImport(); } });
  go.addEventListener("click", doImport);

  // icon names: load only the small index (no icon pack), then re-parse once so exact matches show up in the preview
  void ensureIcons([]).then(() => {
    if (closed) return;
    resolver = makeResolver(listIcons());
    if (ta.value.trim()) render();
  });

  return { close: () => host.close() };
}
