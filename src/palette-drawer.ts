import "./ui/drawer.css";
import type { EditorAPI } from "./editor-api";
import type { Tool } from "./input";
import type { Drawer } from "./palette";
import { ensureIcons, iconInner, listIcons, logoPacks, packLoaded, packsVersion, ROOT_ATTRS } from "./icon-pack";
import { buildIndex, GENERIC_SOURCE, groupBySection, isLogoPack, LOGOS_SOURCE, PACK_ORDER, search, sectionLabel, VENDOR_PACKS, type Entry, type Hit } from "./icon-search";
import { themedLogoMarkup } from "./logos";
import { CATEGORIES, DARK, LIGHT } from "./theme";
import { addUserPackFromText, closeUserPackStore, listUserPacks, MAX_PACK_BYTES, removeUserPack } from "./user-packs";

/** most results the list holds at once: more than the whole logo catalog, so browsing is never cut off */
const MAX_ROWS = 400;
/** tiles a section shows before "Show all N" (browsing only; a search shows every match) */
const SECTION_TILES = 8;
const RECENT_KEY = "archypaint.recent.icons";
const RECENT_TILES = 4;

/** one line, shown whenever brand logos or drawn vendor icons are listed */
const NOTE = "Trademarks belong to their owners; no endorsement implied. Drawn vendor icons are original art.";

/** short chip names for the 20 logo categories (the long names stay as the section headings and tooltips) */
const SHORT: Record<string, string> = {
  "logos-relational": "SQL", "logos-document": "NoSQL", "logos-widecolumn": "Wide-column", "logos-timeseries": "Time-series", "logos-warehouse": "Analytics", "logos-cache": "Cache",
  "logos-messaging": "Queues", "logos-edge": "CDN & edge", "logos-proxy": "Gateways", "logos-compute": "Compute", "logos-clouds": "Cloud", "logos-storage": "Storage",
  "logos-observability": "Observability", "logos-security": "Auth", "logos-cicd": "CI/CD", "logos-clients": "Clients", "logos-frontend": "Frontend", "logos-languages": "Languages",
  "logos-ai": "AI/ML", "logos-thirdparty": "Services",
};

/** glyphs for the shapes in src/shapes.ts, keyed by ShapeDef.id; anything unlisted gets the generic dashed box */
const SHAPE_SVG: Record<string, string> = {
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  diamond: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>',
  text: '<path d="M5 19l7-14 7 14M8 14.2h8"/>',
  arrow: '<path d="M4 12h14M13 7l5 5-5 5"/>',
  cylinder: '<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11"/>',
  cloud: '<path d="M7 18.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9a4.75 4.75 0 0 1 .5 9.5z"/>',
  hexagon: '<path d="M7.5 4.5h9L21 12l-4.5 7.5h-9L3 12z"/>',
  parallelogram: '<path d="M8 6h13l-5 12H3z"/>',
  triangle: '<path d="M12 4l9 15H3z"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>',
  brace: '<path d="M9 4c-2 0-3 1-3 3v2c0 1.5-.7 3-2 3 1.3 0 2 1.5 2 3v2c0 2 1 3 3 3M15 4c2 0 3 1 3 3v2c0 1.5.7 3 2 3-1.3 0-2 1.5-2 3v2c0 2-1 3-3 3"/>',
  badge: '<circle cx="12" cy="12" r="8"/><path d="M10 9.5l2-1.5v8"/>',
  frame: '<rect x="3.5" y="5" width="17" height="14" rx="1.5" stroke-dasharray="3 2.5"/><path d="M3.5 9h17"/>',
  lane: '<rect x="3.5" y="5" width="17" height="14" rx="1"/><path d="M8 5v14M3.5 10h17"/>',
};
const GENERIC_SHAPE = '<rect x="4" y="6" width="16" height="12" rx="1.5" stroke-dasharray="3 2.5"/>';
const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/></svg>';

function loadRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : []; }
  catch { return []; }
}
function saveRecent(ids: string[]): void { try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 8))); } catch { /* storage unavailable */ } }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

interface Section { key: string; title: string; hits: Hit[]; total: number }

/**
 * The icon library drawer: search, a Logos / Generic switch, category chips, a Recent row and tile sections. Choosing a tile ARMS it: a
 * ghost follows the pointer, a click on the canvas places it, another click stamps another, Esc disarms. Enter places the highlighted
 * tile at the view centre and closes. Loaded on first open; everything it attaches is removed by dispose().
 */
export function createDrawer(editor: EditorAPI, host: HTMLElement): Drawer {
  let root: HTMLDivElement | null = null;
  let input!: HTMLInputElement, list!: HTMLDivElement, catsEl!: HTMLDivElement, logosBtn!: HTMLButtonElement, genBtn!: HTMLButtonElement;
  let noteEl!: HTMLDivElement, packsEl!: HTMLDivElement, msgEl!: HTMLDivElement, fileEl!: HTMLInputElement, armedEl!: HTMLDivElement, genInfo!: HTMLSpanElement, emptyEl!: HTMLDivElement;
  let index = buildIndex([]);
  let indexedVersion = -1, srcVersion = -1, srcMode = "";
  let source = "all";
  let tiles: HTMLElement[] = [];
  let entries: Entry[] = [];
  let sel = 0;
  let open = false, disposed = false;
  let prevFocus: Element | null = null;
  let recent = loadRecent();
  const expanded = new Set<string>();
  const scratch: Hit[] = [];

  /* ---- armed state: the picked entry, the ghost that follows the pointer, and the window listeners that exist only while armed ---- */
  let armed: Entry | null = null;
  let ghost: HTMLDivElement | null = null;
  let armOff: Array<() => void> = [];
  let gx = 0, gy = 0, gOver = false, gRaf = 0;

  const theme = () => (document.documentElement.dataset.theme === "dark" ? DARK : LIGHT);
  const catColour = (c: string): string => { const i = CATEGORIES.indexOf(c as (typeof CATEGORIES)[number]); return i >= 0 ? theme().cats[i]! : theme().mid; };
  const isGeneric = (k: string): boolean => k !== "all" && !isLogoPack(k);

  function ensureDom(): void {
    if (root) return;
    root = el("div", "ap-pal"); root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Icon library");
    const searchRow = el("div", "ap-pal-search");
    searchRow.innerHTML = SEARCH_SVG;
    input = el("input", "ap-pal-input"); input.type = "text"; input.placeholder = "Search logos and icons"; input.spellcheck = false; input.autocomplete = "off"; input.setAttribute("aria-label", "Search icons and shapes");
    const esc = el("button", "ap-pal-esc", "esc"); esc.type = "button"; esc.title = "Close (Esc)"; esc.setAttribute("aria-label", "Close the icon library");
    searchRow.append(input, esc);
    const seg = el("div", "ap-seg ap-pal-seg"); seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", "Icon source");
    logosBtn = el("button", "ap-pal-lbtn"); logosBtn.type = "button"; logosBtn.setAttribute("role", "radio"); logosBtn.title = "Brand logos";
    genBtn = el("button", "ap-pal-gbtn"); genBtn.type = "button"; genBtn.setAttribute("role", "radio"); genBtn.dataset.src = "generic"; genBtn.title = "Original generic and drawn icons";
    seg.append(logosBtn, genBtn);
    catsEl = el("div", "ap-pal-cats"); catsEl.setAttribute("role", "group"); catsEl.setAttribute("aria-label", "Category");
    list = el("div", "ap-pal-list"); list.setAttribute("role", "listbox");
    emptyEl = el("div", "ap-pal-empty"); emptyEl.hidden = true;
    armedEl = el("div", "ap-pal-armed"); armedEl.hidden = true; armedEl.setAttribute("role", "status");
    noteEl = el("div", "ap-pal-note"); noteEl.hidden = true;
    packsEl = el("div", "ap-pal-packs"); packsEl.hidden = true;
    msgEl = el("div", "ap-pal-msg"); msgEl.hidden = true; msgEl.setAttribute("role", "status");
    const foot = el("div", "ap-pal-foot");
    const keys = el("div", "ap-pal-keys");
    for (const [k, t] of [["↑↓", "move"], ["⏎", "place"], ["tab", "category"], ["alt ←→", "icon set"], ["esc", "close"]] as const) { const s = el("span"); s.append(el("kbd", "", k), ` ${t}`); keys.append(s); }
    const footRow = el("div", "ap-pal-footrow");
    const load = el("button", "ap-pal-load", "Load icon pack…"); load.type = "button";
    genInfo = el("span", "ap-pal-geninfo");
    fileEl = el("input"); fileEl.type = "file"; fileEl.accept = ".json,application/json"; fileEl.hidden = true;
    footRow.append(load, genInfo, fileEl);
    foot.append(keys, noteEl, packsEl, msgEl, footRow);
    list.append(emptyEl);
    root.append(searchRow, seg, catsEl, list, armedEl, foot);
    host.appendChild(root);

    // one delegated listener per surface instead of one per tile
    list.addEventListener("pointermove", (e) => { const i = tileIndex(e.target); if (i >= 0 && i !== sel) { sel = i; paintSelection(false); } });
    list.addEventListener("click", (e) => {
      const more = (e.target as HTMLElement).closest<HTMLElement>(".ap-pal-all");
      if (more) { const k = more.dataset.sec!; if (expanded.has(k)) expanded.delete(k); else expanded.add(k); render(true); return; }
      const i = tileIndex(e.target);
      if (i >= 0) { sel = i; paintSelection(false); choose(entries[i]!); }
    });
    // the active chip pressed again clears the filter
    catsEl.addEventListener("click", (e) => { const c = (e.target as HTMLElement).dataset.src; if (c) { setSource(c !== "all" && c !== GENERIC_SOURCE && c === source ? (isGeneric(c) ? GENERIC_SOURCE : "all") : c); input.focus(); } });
    logosBtn.addEventListener("click", () => { setSource("all"); input.focus(); });
    genBtn.addEventListener("click", () => { setSource(GENERIC_SOURCE); input.focus(); });
    esc.addEventListener("click", () => close());
    load.addEventListener("click", () => fileEl.click());
    fileEl.addEventListener("change", () => { const f = fileEl.files?.[0]; fileEl.value = ""; if (f) void loadPackFile(f); });
    packsEl.addEventListener("click", (e) => { const k = (e.target as HTMLElement).dataset.rm; if (k) void dropPack(k); });
    input.addEventListener("input", () => render());
    input.addEventListener("keydown", onInputKey);
    paintFilter(); paintUserPacks(); // the index may have loaded before the DOM existed
  }

  const tileIndex = (t: EventTarget | null): number => {
    const n = (t as HTMLElement | null)?.closest?.<HTMLElement>(".ap-pal-item");
    return n ? tiles.indexOf(n) : -1;
  };

  function rebuildIndex(): void {
    const v = packsVersion();
    if (indexedVersion === v && index.length) return;
    index = buildIndex(listIcons());
    indexedVersion = v;
    for (const p of listUserPacks()) for (const e of index) if (e.pack === p.key) { e.section = p.name; e.lsec = p.name.toLowerCase(); } // show the pack's own name, not its slug
    if (source !== "all" && source !== "shapes" && source !== GENERIC_SOURCE && !index.some((e) => e.pack === source)) source = "all";
    srcVersion = -1; // the chips are built from `index`, which was just rebuilt
    paintFilter();
    paintUserPacks();
  }

  const genericKeys = (present: ReadonlySet<string> = new Set(index.map((e) => e.pack))): string[] =>
    [...PACK_ORDER.filter((p) => present.has(p)), ...[...present].filter((p) => p.startsWith("user-")).sort(), ...(present.has("shapes") ? ["shapes"] : [])];

  /** the filter row: in Logos mode All + one short chip per logo category; in Generic mode "All generic" + one chip per drawn pack */
  function paintFilter(): void {
    if (!catsEl) return;
    const mode = isGeneric(source) ? "generic" : "logos";
    if (srcVersion !== packsVersion() || srcMode !== mode) {
      srcVersion = packsVersion(); srcMode = mode;
      const present = new Set(index.map((e) => e.pack));
      const mkChip = (k: string, text: string, title?: string) => { const b = el("button", "", text); b.type = "button"; b.dataset.src = k; if (title) b.title = title; catsEl.appendChild(b); };
      catsEl.textContent = "";
      if (mode === "logos") {
        mkChip("all", "All");
        for (const [pack, label] of logoPacks()) if (present.has(pack)) mkChip(pack, SHORT[pack] ?? label, label);
      } else {
        const userNames = new Map(listUserPacks().map((p) => [p.key, p.name]));
        mkChip(GENERIC_SOURCE, "All generic");
        for (const k of genericKeys(present)) mkChip(k, userNames.get(k) ?? sectionLabel(k));
      }
      const logos = index.filter((e) => e.vendor === "logo").length || (typeof __LOGO_COUNT__ === "number" ? __LOGO_COUNT__ : 0);
      const gens = index.filter((e) => e.kind === "icon" && e.vendor !== "logo").length;
      logosBtn.textContent = logos ? `Logos ${logos}` : "Logos"; genBtn.textContent = gens ? `Generic ${gens}` : "Generic";
      genInfo.textContent = gens ? `Generic icons: ${gens} drawn, secondary` : "";
    }
    logosBtn.setAttribute("aria-checked", String(mode === "logos")); genBtn.setAttribute("aria-checked", String(mode === "generic"));
    for (const b of catsEl.children) {
      const k = (b as HTMLElement).dataset.src!;
      const on = k === source;
      b.setAttribute("aria-pressed", String(on));
      if (on) (b as HTMLElement).scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }
  function setSource(k: string): void { source = k; paintFilter(); render(); }

  /* ---- user packs */
  function say(text: string, err = false): void { msgEl.hidden = !text; msgEl.textContent = text; msgEl.dataset.err = String(err); }
  function paintUserPacks(): void {
    if (!packsEl) return;
    const lst = listUserPacks();
    packsEl.hidden = lst.length === 0;
    packsEl.textContent = "";
    for (const p of lst) {
      const s = el("span", "", `${p.name} (${p.count}) `);
      const b = el("button", "", "remove"); b.type = "button"; b.dataset.rm = p.key; b.setAttribute("aria-label", `Remove icon pack ${p.name}`);
      s.appendChild(b); packsEl.appendChild(s);
    }
  }
  async function loadPackFile(f: File): Promise<void> {
    if (f.size > MAX_PACK_BYTES) { say("That file is over 5 MB — icon packs must be smaller.", true); return; }
    let text: string;
    try { text = await f.text(); } catch { say("Couldn't read that file.", true); return; }
    const r = await addUserPackFromText(text);
    if (disposed) return;
    if (!r.ok) { say(`Not loaded: ${r.error}`, true); return; }
    say(`Loaded ${r.value.count} icons from “${r.value.name}”${r.value.persisted ? "" : " (this session only — storage unavailable)"}.`);
    rebuildIndex(); setSource(r.value.key);
  }
  async function dropPack(key: string): Promise<void> {
    await removeUserPack(key);
    if (disposed) return;
    say("Icon pack removed.");
    if (source === key) source = "all";
    rebuildIndex(); render();
  }

  function paintSelection(scroll: boolean): void {
    for (let i = 0; i < tiles.length; i++) tiles[i]!.setAttribute("aria-selected", String(i === sel));
    if (scroll && tiles[sel]) tiles[sel]!.scrollIntoView?.({ block: "nearest" });
  }

  function badgeSvg(e: Entry): string {
    if (e.kind === "shape") return `<svg viewBox="0 0 24 24" ${ROOT_ATTRS} stroke-width="1.75">${SHAPE_SVG[e.id] ?? GENERIC_SHAPE}</svg>`;
    const g = iconInner(e.id, "glyph");
    if (!g) return "";
    if (e.vendor === "logo") return `<svg viewBox="0 0 24 24">${themedLogoMarkup(g, theme() === DARK)}</svg>`; // brand colours, this theme's variants
    return `<svg viewBox="0 0 24 24" ${ROOT_ATTRS} stroke-width="1.75">${g}</svg>`;
  }

  function mkTile(e: Entry): HTMLElement {
    const t = el("button", "ap-pal-item"); t.type = "button"; t.setAttribute("role", "option"); t.title = e.aliases[0] && e.vendor === "logo" ? `${e.name} · ${e.aliases[0]}` : e.name;
    const isLogo = e.vendor === "logo";
    const b = el("span", "ap-pal-badge"); b.dataset.logo = String(isLogo);
    if (!isLogo) b.style.color = catColour(e.category);
    b.innerHTML = badgeSvg(e);
    t.append(b, el("span", "ap-pal-name", e.name));
    t.classList.toggle("armed", armed?.id === e.id);
    return t;
  }

  /** the sections for the current query / filter: Recent first (browse only), then one per pack, logos before drawn icons */
  function sections(q: string): Section[] {
    const out: Section[] = [];
    const set = q ? undefined : new Set(recent);
    // browsing follows the Logos / Generic switch; a search looks everywhere (so "rectangle" or "cache" finds shapes and drawn icons from either side), narrowed only by a chosen chip
    const eff = source !== "all" ? source : q ? "all" : LOGOS_SOURCE;
    search(index, q, "all", scratch, MAX_ROWS, set, eff);
    const hits = groupBySection(scratch);
    if (!q) {
      const byId = new Map(index.map((e) => [e.id, e]));
      const rec = recent.map((id) => byId.get(id)).filter((e): e is Entry => !!e).slice(0, RECENT_TILES);
      if (rec.length) out.push({ key: "recent", title: "Recent", hits: rec.map((e) => ({ e, score: 0 })), total: rec.length });
    }
    let cur: Section | null = null;
    for (const h of hits) {
      if (!cur || cur.key !== h.e.pack) { cur = { key: h.e.pack, title: h.e.section, hits: [], total: 0 }; out.push(cur); }
      cur.hits.push({ e: h.e, score: h.score }); cur.total++;
    }
    return out;
  }

  /** keep = a data refresh (a pack landed, a section expanded): keep the highlighted tile and scroll instead of jumping to the top */
  function render(keep = false): void {
    if (!open) return;
    const prevId = keep ? entries[sel]?.id : undefined;
    const prevTop = keep ? list.scrollTop : 0;
    rebuildIndex();
    const q = input.value;
    const secs = sections(q);
    list.textContent = "";
    tiles = []; entries = [];
    let vendor = false, logo = false;
    for (const s of secs) {
      const showAll = !!q || expanded.has(s.key) || s.key === "recent";
      const shown = showAll ? s.hits : s.hits.slice(0, SECTION_TILES);
      const sec = el("div", "ap-pal-sec");
      const head = el("div", "ap-pal-head"); head.append(el("b", "", s.title)); if (s.key !== "recent") head.append(el("span", "", String(s.total)));
      const grid = el("div", "ap-pal-grid");
      for (const h of shown) {
        const t = mkTile(h.e);
        grid.append(t); tiles.push(t); entries.push(h.e);
        if (h.e.vendor === "logo") logo = true; else if (VENDOR_PACKS.has(h.e.pack)) vendor = true;
      }
      sec.append(head, grid);
      if (!q && s.key !== "recent" && s.total > SECTION_TILES) {
        const more = el("button", "ap-pal-all", expanded.has(s.key) ? "Show fewer" : `Show all ${s.total}`); more.type = "button"; more.dataset.sec = s.key;
        sec.append(more);
      }
      list.append(sec);
    }
    list.append(emptyEl);
    emptyEl.hidden = tiles.length > 0;
    if (!tiles.length) emptyEl.textContent = packLoaded() ? "no match — try “queue”, “cache” or “database”" : "loading icons…";
    if (prevId !== undefined) {
      const i = entries.findIndex((e) => e.id === prevId);
      sel = i >= 0 ? i : Math.min(sel, Math.max(0, tiles.length - 1));
      paintSelection(false); list.scrollTop = prevTop;
    } else { sel = 0; paintSelection(false); list.scrollTop = 0; }
    noteEl.hidden = !(vendor || logo); if (vendor || logo) noteEl.textContent = NOTE;
  }

  /* ---------- choosing, arming and placing ---------- */
  /** place `e` (an icon) in its category colour, at `at` or the view centre; the default colour is restored afterwards */
  function placeEntry(e: Entry, at?: { x: number; y: number }): void {
    const ci = CATEGORIES.indexOf(e.category as (typeof CATEGORIES)[number]);
    const prev = editor.defaults.cat;
    if (ci >= 0) editor.setDefaults({ cat: ci });
    const el2 = editor.placeIcon(e.id, at);
    if (ci >= 0) editor.setDefaults({ cat: prev });
    editor.select([el2.id]);
    recent = [e.id, ...recent.filter((x) => x !== e.id)].slice(0, 8); saveRecent(recent);
  }

  /** a tile was picked (click): a shape activates its tool and the drawer closes; an icon is armed for stamping */
  function choose(e: Entry): void {
    if (e.kind === "shape") { close(); editor.setTool(e.tool as Tool); return; }
    arm(e);
  }

  function arm(e: Entry): void {
    disarm();
    armed = e;
    for (let i = 0; i < tiles.length; i++) tiles[i]!.classList.toggle("armed", entries[i]!.id === e.id);
    armedEl.hidden = false; armedEl.textContent = `${e.name} armed. Click the canvas to place, again to stamp more. Esc to stop.`;
    ghost = el("div", "ap-stamp"); ghost.hidden = true;
    const box = el("span", "ap-stamp-box"); box.dataset.logo = String(e.vendor === "logo"); if (e.vendor !== "logo") box.style.color = catColour(e.category); box.innerHTML = badgeSvg(e);
    ghost.append(box, el("span", "ap-stamp-tip", "click to place"));
    document.body.append(ghost);
    const stage = document.getElementById("stage");
    const onMove = (ev: PointerEvent) => {
      gx = ev.clientX; gy = ev.clientY; gOver = !!(ev.target as HTMLElement | null)?.closest?.("#stage");
      if (!gRaf) gRaf = requestAnimationFrame(() => { gRaf = 0; if (ghost) { ghost.hidden = !gOver; ghost.style.transform = `translate(${gx - 32}px, ${gy - 33}px)`; } });
    };
    // capture on the window: the canvas never sees the click that places (no selection change, no drag, no text edit on the second click of a double)
    const onDown = (ev: PointerEvent) => {
      if (!armed || ev.button !== 0 || !(ev.target as HTMLElement | null)?.closest?.("#stage")) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      const b = (stage ?? host).getBoundingClientRect();
      placeEntry(armed, { x: editor.vp.toWorldX(ev.clientX - b.left), y: editor.vp.toWorldY(ev.clientY - b.top) });
      render(true);
    };
    const swallow = (ev: Event) => { if (armed && (ev.target as HTMLElement | null)?.closest?.("#stage")) ev.stopImmediatePropagation(); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { disarm(); } };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("dblclick", swallow, true); window.addEventListener("click", swallow, true);
    window.addEventListener("keydown", onKey);
    armOff = [
      () => window.removeEventListener("pointermove", onMove), () => window.removeEventListener("pointerdown", onDown, true),
      () => window.removeEventListener("dblclick", swallow, true), () => window.removeEventListener("click", swallow, true), () => window.removeEventListener("keydown", onKey),
    ];
    const offTool = (editor as { on?: (ev: "tool", cb: () => void) => () => void }).on?.("tool", () => disarm());
    if (offTool) armOff.push(offTool);
    if (stage) stage.style.cursor = "copy";
  }

  function disarm(): void {
    if (!armed && !ghost) return;
    armed = null;
    for (const f of armOff) f();
    armOff = [];
    if (gRaf) { cancelAnimationFrame(gRaf); gRaf = 0; }
    ghost?.remove(); ghost = null;
    if (armedEl) armedEl.hidden = true;
    for (const t of tiles) t.classList.remove("armed");
    const stage = document.getElementById("stage");
    if (stage && stage.style.cursor === "copy") stage.style.cursor = "";
  }

  /** ↑↓: the tile in the adjacent row nearest in x (the grid is 4 wide, sections break the rows, so the geometry decides) */
  function moveVertical(dir: 1 | -1): void {
    const cur = tiles[sel];
    if (!cur) return;
    const c = cur.getBoundingClientRect();
    if (c.height === 0) { sel = Math.max(0, Math.min(tiles.length - 1, sel + dir)); paintSelection(true); return; } // no layout (a headless DOM): one tile at a time
    let best = -1, bestRow = Infinity, bestDx = Infinity;
    for (let i = 0; i < tiles.length; i++) {
      const r = tiles[i]!.getBoundingClientRect();
      const dy = dir > 0 ? r.top - c.top : c.top - r.top;
      if (dy < 4) continue;
      const dx = Math.abs(r.left - c.left);
      if (dy < bestRow - 2 || (Math.abs(dy - bestRow) <= 2 && dx < bestDx)) { best = i; bestRow = dy; bestDx = dx; }
    }
    if (best >= 0) { sel = best; paintSelection(true); }
    else if (dir < 0) { sel = 0; paintSelection(true); list.scrollTop = 0; }
  }

  function onInputKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); if (armed) disarm(); else close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveVertical(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveVertical(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const en = entries[sel];
      if (!en) return;
      if (en.kind === "shape") { close(); editor.setTool(en.tool as Tool); return; }
      close(); placeEntry(en); // the view centre, as before; the drawer closes
    }
    else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { // alt: the generic icon sets (all generic, then each drawn pack)
      e.preventDefault();
      const ks = [GENERIC_SOURCE, ...genericKeys()], i = ks.indexOf(source), d = e.key === "ArrowRight" ? 1 : -1;
      setSource(ks[i < 0 ? (d > 0 ? 0 : ks.length - 1) : (i + d + ks.length) % ks.length]!);
    }
    else if (e.key === "Tab") { // tab: the next category chip (All, the logo categories, then the generic set)
      e.preventDefault();
      const ks = ["all", ...logoPacks().map(([k]) => k).filter((k) => index.some((x) => x.pack === k)), GENERIC_SOURCE];
      const i = ks.indexOf(isGeneric(source) ? GENERIC_SOURCE : source);
      setSource(ks[(Math.max(0, i) + (e.shiftKey ? -1 : 1) + ks.length) % ks.length]!);
    }
  }

  const onWinKey = (e: KeyboardEvent) => {
    if (!open || e.key !== "Escape" || e.defaultPrevented) return;
    if (armed) return; // the armed listener disarms first; the next Esc closes
    close();
  };
  const onSlash = (e: KeyboardEvent) => { // "/" again while open: back to the search field
    if (!open || e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.target === input) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    e.preventDefault(); input.focus(); input.select();
  };
  window.addEventListener("keydown", onWinKey); window.addEventListener("keydown", onSlash);

  function openDrawer(): void {
    if (open || disposed) { if (open) { input.focus(); input.select(); } return; }
    ensureDom();
    open = true; root!.hidden = false;
    prevFocus = document.activeElement;
    input.value = ""; source = "all"; msgEl.hidden = true;
    paintFilter();
    render(); input.focus();
    void ensureIcons().then(() => { if (open) render(true); }); // index + every pack: previews and search need them (idempotent)
  }

  function close(): void {
    if (!open) return;
    disarm();
    open = false; if (root) root.hidden = true;
    input.blur();
    if (prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus();
    prevFocus = null;
  }

  return {
    open: openDrawer, close, isOpen: () => open, isArmed: () => armed !== null,
    repaint() { if (open) render(true); },
    dispose() {
      if (disposed) return;
      disposed = true; open = false;
      disarm();
      window.removeEventListener("keydown", onWinKey); window.removeEventListener("keydown", onSlash);
      closeUserPackStore();
      root?.remove(); root = null; tiles = []; entries = [];
    },
  };
}
