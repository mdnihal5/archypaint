import type { EditorAPI } from "./editor-api";
import type { Tool } from "./input";
import { ensureIcons, iconInner, listIcons, onIconsReady, packLoaded, packsVersion, ROOT_ATTRS } from "./icon-pack";
import { buildIndex, groupBySection, PACK_ORDER, search, sectionLabel, VENDOR_PACKS, type Entry, type Hit } from "./icon-search";
import { CATEGORIES, DARK, LIGHT } from "./theme";
import { addUserPackFromText, closeUserPackStore, listUserPacks, MAX_PACK_BYTES, removeUserPack } from "./user-packs";

export interface Palette { open(): void; close(): void; isOpen(): boolean; dispose(): void }

const ROWS = 48;
const RECENT_KEY = "archypaint.recent.icons";
const CHIPS = ["all", ...CATEGORIES, "shape"] as const;
const HINT = "load balancer · cron job · read replica · service worker · message queue";

const DISCLAIMER = "Original drawings, not affiliated with or endorsed by the vendor; names are their owners' trademarks.";

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

const CSS = `
.ap-pal{position:fixed;inset:0;z-index:50;font-family:'JetBrains Mono','DejaVu Sans Mono',monospace;color:var(--ink,#26323b)}
.ap-pal[hidden]{display:none}
.ap-pal-panel{position:absolute;left:96px;top:72px;width:min(680px,calc(100vw - 128px));background:var(--card,#fffaf2);
  border:1.5px solid var(--ink,#26323b);box-shadow:6px 6px 0 color-mix(in srgb,var(--ink,#26323b) 14%,transparent)}
.ap-pal-line{display:flex;align-items:center;gap:12px;padding:14px 18px 6px}
.ap-pal-slash{font-size:32px;font-weight:700;color:var(--red,#c2412d);line-height:1}
.ap-pal-input{flex:1;min-width:0;font:inherit;font-size:28px;background:transparent;border:0;outline:0;color:inherit;
  caret-color:var(--red,#c2412d);padding:0}
.ap-pal-input::placeholder{color:var(--mid,#5f6a73);opacity:.65}
.ap-pal-hint{padding:0 18px 10px 48px;font-size:12px;color:var(--mid,#5f6a73);opacity:.85}
.ap-pal-chips{display:flex;flex-wrap:wrap;gap:4px 14px;padding:8px 18px;border-top:1px solid color-mix(in srgb,var(--ink,#26323b) 25%,transparent);
  font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mid,#5f6a73)}
.ap-pal-chips button{all:unset;cursor:pointer;padding:1px 0;border-bottom:2px solid transparent}
.ap-pal-chips button[aria-pressed=true]{color:var(--red,#c2412d);border-bottom-color:var(--red,#c2412d)}
.ap-pal-list{max-height:min(56vh,528px);overflow-y:auto;border-top:1px solid color-mix(in srgb,var(--ink,#26323b) 25%,transparent)}
.ap-pal-row{display:block}
.ap-pal-row[hidden]{display:none}
.ap-pal-head{padding:8px 18px 3px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--mid,#5f6a73)}
.ap-pal-head[hidden]{display:none}
.ap-pal-item{display:flex;align-items:center;gap:12px;height:44px;padding:0 18px;cursor:pointer;border-left:3px solid transparent}
.ap-pal-item[aria-selected=true]{background:color-mix(in srgb,var(--red,#c2412d) 13%,transparent);border-left-color:var(--red,#c2412d)}
.ap-pal-badge{flex:none;width:32px;height:32px;border-radius:8px;box-sizing:border-box;display:grid;place-items:center;
  border:1.5px solid currentColor;background:color-mix(in srgb,currentColor 13%,transparent)}
.ap-pal-badge svg{width:22px;height:22px;display:block}
.ap-pal-name{font-size:14px;white-space:nowrap}
.ap-pal-meta{font-size:11px;color:var(--mid,#5f6a73);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ap-pal-tag{margin-left:auto;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--mid,#5f6a73);flex:none}
.ap-pal-empty{padding:18px;font-size:13px;color:var(--mid,#5f6a73)}
.ap-pal-src{border-top:0;padding-top:0}
.ap-pal-src button{text-transform:none;letter-spacing:.02em}
.ap-pal-note{padding:6px 18px;font-size:11px;color:var(--mid,#5f6a73);border-top:1px solid color-mix(in srgb,var(--ink,#26323b) 25%,transparent)}
.ap-pal-note[hidden],.ap-pal-packs[hidden],.ap-pal-msg[hidden]{display:none}
.ap-pal-packs{display:flex;flex-wrap:wrap;gap:6px 12px;padding:6px 18px;font-size:11px;color:var(--mid,#5f6a73);border-top:1px solid color-mix(in srgb,var(--ink,#26323b) 25%,transparent)}
.ap-pal-packs span{display:inline-flex;gap:6px;align-items:center}
.ap-pal-packs button,.ap-pal-load{all:unset;cursor:pointer;font-size:11px;color:var(--red,#c2412d);border-bottom:1px solid currentColor}
.ap-pal-msg{padding:6px 18px;font-size:11px;color:var(--ink,#26323b);border-top:1px solid color-mix(in srgb,var(--ink,#26323b) 25%,transparent)}
.ap-pal-msg[data-err=true]{color:var(--red,#c2412d)}
.ap-pal-foot .ap-pal-load{margin-left:auto}
.ap-pal-foot{display:flex;gap:16px;padding:8px 18px;font-size:11px;color:var(--mid,#5f6a73);border-top:1px solid color-mix(in srgb,var(--ink,#26323b) 25%,transparent)}
`;

interface RowEls {
  root: HTMLElement; head: HTMLElement; item: HTMLElement; badge: HTMLElement; name: HTMLElement; meta: HTMLElement; tag: HTMLElement;
  /** what the badge currently shows (id + colour + whether its SVG was loaded), so a keystroke that keeps the row re-parses nothing */
  badgeKey: string;
}

function loadRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : []; }
  catch { return []; }
}
function saveRecent(ids: string[]): void { try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 8))); } catch { /* storage unavailable */ } }

export function mountPalette(editor: EditorAPI, host: HTMLElement): Palette {
  let styleEl: HTMLStyleElement | null = null;
  let root: HTMLDivElement | null = null;
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;
  let chipsEl!: HTMLDivElement;
  let hintEl!: HTMLDivElement;
  let emptyEl!: HTMLDivElement;
  let rows: RowEls[] = [];
  let index: Entry[] = buildIndex([]);
  let indexedVersion = -1;
  let category = "all";
  let source = "all";
  let srcEl!: HTMLDivElement;
  let noteEl!: HTMLDivElement;
  let packsEl!: HTMLDivElement;
  let msgEl!: HTMLDivElement;
  let fileEl!: HTMLInputElement;
  let srcVersion = -1;
  let hits: Hit[] = [];
  const scratch: Hit[] = [];
  let shown: Hit[] = [];
  let sel = 0;
  let open = false;
  let prevFocus: Element | null = null;
  let recent = loadRecent();
  let px = -1, py = -1, pointerSeen = false;
  let disposed = false;

  const cleanups: Array<() => void> = [];
  const on = <K extends keyof WindowEventMap>(t: Window, ev: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    t.addEventListener(ev, fn, opts); cleanups.push(() => t.removeEventListener(ev, fn, opts));
  };

  const theme = () => (document.documentElement.dataset.theme === "dark" ? DARK : LIGHT);
  const catColour = (c: string): string => { const i = CATEGORIES.indexOf(c as (typeof CATEGORIES)[number]); return i >= 0 ? theme().cats[i]! : theme().mid; };

  function ensureDom(): void {
    if (root) return;
    if (!document.getElementById("ap-palette-css")) { styleEl = document.createElement("style"); styleEl.id = "ap-palette-css"; styleEl.textContent = CSS; document.head.appendChild(styleEl); }
    root = document.createElement("div"); root.className = "ap-pal"; root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Place an icon");
    root.innerHTML = `<div class="ap-pal-panel"><div class="ap-pal-line"><span class="ap-pal-slash">/</span><input class="ap-pal-input" type="text" placeholder="place an icon" spellcheck="false" autocomplete="off" aria-label="Search icons and shapes"></div><div class="ap-pal-hint"></div><div class="ap-pal-chips" role="group" aria-label="Category"></div><div class="ap-pal-chips ap-pal-src" role="group" aria-label="Source"></div><div class="ap-pal-list" role="listbox"></div><div class="ap-pal-note" hidden></div><div class="ap-pal-packs" hidden></div><div class="ap-pal-msg" role="status" hidden></div><div class="ap-pal-foot"><span>↑↓ move</span><span>⏎ place</span><span>tab category</span><span>alt ←→ source</span><span>esc close</span><button type="button" class="ap-pal-load">Load icon pack…</button><input type="file" accept=".json,application/json" hidden></div></div>`;
    host.appendChild(root);
    input = root.querySelector("input")!; list = root.querySelector(".ap-pal-list")!; chipsEl = root.querySelector(".ap-pal-chips")!; hintEl = root.querySelector(".ap-pal-hint")!;
    srcEl = root.querySelector(".ap-pal-src")!; noteEl = root.querySelector(".ap-pal-note")!; packsEl = root.querySelector(".ap-pal-packs")!; msgEl = root.querySelector(".ap-pal-msg")!; fileEl = root.querySelector("input[type=file]")!;
    hintEl.textContent = HINT;
    emptyEl = document.createElement("div"); emptyEl.className = "ap-pal-empty"; emptyEl.hidden = true; list.appendChild(emptyEl);
    for (const c of CHIPS) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = c; b.dataset.cat = c; b.setAttribute("aria-pressed", String(c === "all")); chipsEl.appendChild(b);
    }
    for (let i = 0; i < ROWS; i++) {
      const rootEl = document.createElement("div"); rootEl.className = "ap-pal-row";
      rootEl.innerHTML = `<div class="ap-pal-head"></div><div class="ap-pal-item" role="option"><span class="ap-pal-badge"></span><span class="ap-pal-name"></span><span class="ap-pal-meta"></span><span class="ap-pal-tag"></span></div>`;
      list.insertBefore(rootEl, emptyEl);
      rows.push({ root: rootEl, head: rootEl.firstElementChild as HTMLElement, item: rootEl.lastElementChild as HTMLElement,
        badge: rootEl.querySelector(".ap-pal-badge")!, name: rootEl.querySelector(".ap-pal-name")!, meta: rootEl.querySelector(".ap-pal-meta")!, tag: rootEl.querySelector(".ap-pal-tag")!, badgeKey: "" });
    }
    // one delegated listener per surface instead of one per row
    list.addEventListener("pointermove", (e) => { const r = (e.target as HTMLElement).closest(".ap-pal-row"); const i = rows.findIndex((x) => x.root === r); if (i >= 0 && i !== sel && i < shown.length) { sel = i; paintSelection(false); } });
    list.addEventListener("click", (e) => { const r = (e.target as HTMLElement).closest(".ap-pal-row"); const i = rows.findIndex((x) => x.root === r); if (i >= 0 && i < shown.length) place(shown[i]!.e); });
    chipsEl.addEventListener("click", (e) => { const c = (e.target as HTMLElement).dataset.cat; if (c) { setCategory(c); input.focus(); } });
    srcEl.addEventListener("click", (e) => { const c = (e.target as HTMLElement).dataset.src; if (c) { setSource(c); input.focus(); } });
    root.querySelector(".ap-pal-load")!.addEventListener("click", () => fileEl.click());
    fileEl.addEventListener("change", () => { const f = fileEl.files?.[0]; fileEl.value = ""; if (f) void loadPackFile(f); });
    packsEl.addEventListener("click", (e) => { const k = (e.target as HTMLElement).dataset.rm; if (k) void dropPack(k); });
    root.addEventListener("pointerdown", (e) => { if (e.target === root) close(); });
    input.addEventListener("input", () => render());
    input.addEventListener("keydown", onInputKey);
    paintSources(); paintUserPacks(); // the index may have loaded before the DOM existed
  }

  function rebuildIndex(): void {
    const v = packsVersion();
    if (indexedVersion === v && index.length) return;
    index = buildIndex(listIcons()); indexedVersion = v;
    for (const p of listUserPacks()) for (const e of index) if (e.pack === p.key) { e.section = p.name; e.lsec = p.name.toLowerCase(); } // show the pack's own name, not its slug
    if (source !== "all" && source !== "shapes" && !index.some((e) => e.pack === source)) source = "all";
    paintSources();
    paintUserPacks();
  }

  /** source chips: every pack that has icons, in canonical order (user packs after the bundled ones) */
  function paintSources(): void {
    if (!srcEl || srcVersion === packsVersion()) return;
    srcVersion = packsVersion();
    const present = new Set(index.map((e) => e.pack));
    const userNames = new Map(listUserPacks().map((p) => [p.key, p.name]));
    const keys = ["all", ...PACK_ORDER.filter((p) => present.has(p)), ...[...present].filter((p) => p.startsWith("user-")).sort()];
    srcEl.textContent = "";
    for (const k of keys) {
      const b = document.createElement("button"); b.type = "button"; b.dataset.src = k; b.textContent = k === "all" ? "all sources" : (userNames.get(k) ?? sectionLabel(k));
      b.setAttribute("aria-pressed", String(k === source)); srcEl.appendChild(b);
    }
  }
  function paintSourcePressed(): void { for (const b of srcEl.children) (b as HTMLElement).setAttribute("aria-pressed", String((b as HTMLElement).dataset.src === source)); }
  function sourceKeys(): string[] { return [...srcEl.children].map((b) => (b as HTMLElement).dataset.src!); }
  function setSource(k: string): void { source = k; paintSourcePressed(); render(); }

  /* ---- user packs */
  function say(text: string, err = false): void { msgEl.hidden = !text; msgEl.textContent = text; msgEl.dataset.err = String(err); }
  function paintUserPacks(): void {
    if (!packsEl) return;
    const list = listUserPacks();
    packsEl.hidden = list.length === 0;
    packsEl.textContent = "";
    for (const p of list) {
      const s = document.createElement("span"); s.textContent = `${p.name} (${p.count}) `;
      const b = document.createElement("button"); b.type = "button"; b.dataset.rm = p.key; b.textContent = "remove"; b.setAttribute("aria-label", `Remove icon pack ${p.name}`);
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

  function setCategory(c: string): void {
    category = c;
    for (const b of chipsEl.children) (b as HTMLElement).setAttribute("aria-pressed", String((b as HTMLElement).dataset.cat === c));
    render();
  }

  function paintSelection(scroll: boolean): void {
    for (let i = 0; i < rows.length; i++) rows[i]!.item.setAttribute("aria-selected", String(i === sel && i < shown.length));
    if (scroll && rows[sel]) rows[sel]!.root.scrollIntoView({ block: "nearest" });
  }

  function badgeSvg(e: Entry): string {
    if (e.kind === "shape") return `<svg viewBox="0 0 24 24" ${ROOT_ATTRS} stroke-width="1.75">${SHAPE_SVG[e.id] ?? GENERIC_SHAPE}</svg>`;
    const g = iconInner(e.id, "glyph");
    return g ? `<svg viewBox="0 0 24 24" ${ROOT_ATTRS} stroke-width="1.75">${g}</svg>` : "";
  }

  /** keep = a data refresh (a pack landed): keep the selected row and scroll instead of jumping back to the top */
  function render(keep = false): void {
    if (!open) return;
    const prevId = keep ? shown[sel]?.e.id : undefined;
    rebuildIndex();
    const q = input.value;
    const set = q ? undefined : new Set(recent);
    search(index, q, category, scratch, ROWS, set, source);
    hits = groupBySection(scratch);
    shown = hits;
    let prevCat = "";
    for (let i = 0; i < ROWS; i++) {
      const r = rows[i]!, h = shown[i];
      if (!h) { r.root.hidden = true; continue; }
      r.root.hidden = false;
      const e = h.e, col = catColour(e.category);
      const newGroup = e.pack !== prevCat; prevCat = e.pack;
      r.head.hidden = !newGroup; if (newGroup) r.head.textContent = e.section;
      const key = `${e.kind}:${e.id}:${col}:${e.kind === "shape" || iconInner(e.id, "glyph") !== null ? 1 : 0}`;
      if (r.badgeKey !== key) { r.badgeKey = key; r.badge.style.color = col; r.badge.innerHTML = badgeSvg(e); } // innerHTML parses SVG: only when the row's icon changed
      r.name.textContent = e.name;
      const alias = q ? e.aliases.find((a) => a.toLowerCase().includes(q.trim().toLowerCase())) : undefined;
      r.meta.textContent = alias && alias.toLowerCase() !== e.name.toLowerCase() ? alias : e.id;
      r.tag.textContent = e.kind === "shape" ? "shape" : (recent.includes(e.id) && !q ? "recent" : e.category);
    }
    if (prevId !== undefined) {
      const i = shown.findIndex((h) => h.e.id === prevId);
      sel = i >= 0 ? i : Math.min(sel, Math.max(0, shown.length - 1));
      paintSelection(false);
    } else { sel = 0; paintSelection(true); list.scrollTop = 0; }
    emptyEl.hidden = shown.length > 0;
    let vendor = false;
    for (const h of shown) if (VENDOR_PACKS.has(h.e.pack)) { vendor = true; break; }
    noteEl.hidden = !vendor; if (vendor) noteEl.textContent = DISCLAIMER;
    if (!shown.length) emptyEl.textContent = packLoaded() ? "no match — try “queue”, “cache” or “database”" : "loading icons…";
    hintEl.hidden = q.length > 0;
  }

  function pointerWorld(): { x: number; y: number } | undefined {
    if (!pointerSeen) return undefined;
    const stage = document.getElementById("stage") ?? host;
    const b = stage.getBoundingClientRect();
    const sx = px - b.left, sy = py - b.top;
    if (sx < 0 || sy < 0 || sx > b.width || sy > b.height) return undefined;
    return { x: editor.vp.toWorldX(sx), y: editor.vp.toWorldY(sy) };
  }

  function place(e: Entry): void {
    if (e.kind === "shape") { close(); editor.setTool(e.tool as Tool); return; }
    const ci = CATEGORIES.indexOf(e.category as (typeof CATEGORIES)[number]);
    const at = pointerWorld();
    close();
    const prev = editor.defaults.cat;
    if (ci >= 0) editor.setDefaults({ cat: ci });
    const el = editor.placeIcon(e.id, at);
    if (ci >= 0) editor.setDefaults({ cat: prev });
    editor.select([el.id]);
    recent = [e.id, ...recent.filter((x) => x !== e.id)].slice(0, 8); saveRecent(recent);
  }

  function onInputKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (shown.length) { sel = (sel + 1) % shown.length; paintSelection(true); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (shown.length) { sel = (sel - 1 + shown.length) % shown.length; paintSelection(true); } }
    else if (e.key === "Enter") { e.preventDefault(); const h = shown[sel]; if (h) place(h.e); }
    else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); const ks = sourceKeys(), i = Math.max(0, ks.indexOf(source)); setSource(ks[(i + (e.key === "ArrowRight" ? 1 : -1) + ks.length) % ks.length]!); }
    else if (e.key === "Tab") { e.preventDefault(); const i = CHIPS.indexOf(category as (typeof CHIPS)[number]); setCategory(CHIPS[(i + (e.shiftKey ? -1 : 1) + CHIPS.length) % CHIPS.length]!); }
  }

  function openPalette(): void {
    if (open || disposed) return;
    ensureDom();
    open = true; root!.hidden = false;
    prevFocus = document.activeElement;
    input.value = ""; category = "all"; source = "all"; msgEl.hidden = true;
    for (const b of chipsEl.children) (b as HTMLElement).setAttribute("aria-pressed", String((b as HTMLElement).dataset.cat === "all"));
    render(); input.focus();
    void ensureIcons().then(() => { if (open) render(true); }); // index + every pack: previews and search need them (idempotent)
  }

  function close(): void {
    if (!open) return;
    open = false; if (root) root.hidden = true;
    input.blur();
    if (prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus();
    prevFocus = null;
  }

  on(window, "keydown", (e) => {
    if (e.key === "Escape" && open) { close(); return; }
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || open) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    e.preventDefault(); openPalette();
  });
  on(window, "pointermove", (e) => { px = e.clientX; py = e.clientY; pointerSeen = true; }, { passive: true });

  // Packs land in a burst (index + up to 6 packs on first open): coalesce into one repaint per frame. The search
  // index is rebuilt lazily by render() when the palette is open, never while it is closed.
  let readyRaf = 0;
  cleanups.push(onIconsReady(() => {
    if (readyRaf) return;
    readyRaf = requestAnimationFrame(() => {
      readyRaf = 0;
      if (open) render(true);
      (editor as unknown as { renderer?: { invalidate(s: boolean, l: boolean): void } }).renderer?.invalidate(true, false);
    });
  }));
  cleanups.push(() => { if (readyRaf) cancelAnimationFrame(readyRaf); readyRaf = 0; });

  return {
    open: openPalette, close, isOpen: () => open,
    dispose() {
      if (disposed) return;
      disposed = true; open = false;
      for (const c of cleanups) c();
      cleanups.length = 0;
      closeUserPackStore();
      root?.remove(); styleEl?.remove(); root = null; styleEl = null; rows = []; hits = []; shown = [];
    },
  };
}

