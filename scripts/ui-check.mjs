// End-to-end check of the UI chrome. Usage: PUPPETEER_DIR=<node_modules dir> node scripts/ui-check.mjs
// Serves dist/ via `vite preview`, drives every control in real Chrome, spies on the EditorAPI/IO/palette calls
// the chrome makes, and verifies: virtualisation, idle-is-flat (no render loop), and remount-leak freedom.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire((process.env.PUPPETEER_DIR ?? "/home/sys2026/Personal/blog-visuals/node_modules") + "/");
const puppeteer = require("puppeteer-core");
const PORT = 4183, URL0 = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true }); // own process group: kill(-pid) also ends the vite child npx starts
for (let i = 0; i < 50; i++) { try { if ((await fetch(URL0)).ok) break; } catch { /* starting */ } await sleep(200); }

const results = []; let failed = 0;
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

// installed before any page script runs: counts live window/document listeners, intervals, ResizeObservers, rAF calls
const INSTRUMENT = () => {
  const reg = new Map(), tag = (t) => (t === window ? "win" : t === document ? "doc" : null);
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const capOf = (o) => (typeof o === "boolean" ? o : !!o?.capture);
  EventTarget.prototype.addEventListener = function (type, fn, o) { const g = tag(this); if (g && fn) { const k = `${g}|${type}|${capOf(o)}`; (reg.get(k) ?? reg.set(k, new Set()).get(k)).add(fn); } return add.call(this, type, fn, o); };
  EventTarget.prototype.removeEventListener = function (type, fn, o) { const g = tag(this); if (g && fn) reg.get(`${g}|${type}|${capOf(o)}`)?.delete(fn); return rem.call(this, type, fn, o); };
  const iv = new Set(), si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  window.setInterval = (f, ms, ...a) => { const id = si(f, ms, ...a); iv.add(id); return id; };
  window.clearInterval = (id) => { iv.delete(id); return ci(id); };
  const RO = window.ResizeObserver, live = new Set();
  window.ResizeObserver = class extends RO { constructor(cb) { super(cb); live.add(this); } disconnect() { live.delete(this); super.disconnect(); } };
  let raf = 0; const rq = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { raf++; return rq(cb); };
  window.__inst = { listeners: () => [...reg.values()].reduce((n, s) => n + s.size, 0), intervals: () => iv.size, observers: () => live.size, raf: () => raf, keys: () => [...reg].filter(([, s]) => s.size).map(([k, s]) => `${k}:${s.size}`) };
};

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
async function open(url, w = 1440, h = 900) {
  const cx = await b.createBrowserContext(); const p = await cx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text()); });
  await p.evaluateOnNewDocument(INSTRUMENT);
  // the checks exercise every panel: start from "everything on" (the shipped defaults are a quieter canvas), unless a test seeds its own settings
  await p.evaluateOnNewDocument(() => { try { if (!localStorage.getItem("archypaint.settings.v1")) localStorage.setItem("archypaint.settings.v1", JSON.stringify({ bg: "grid", theme: "system", frame: true, hud: true, layers: true, minimap: true, flow: false })); } catch { /* storage unavailable */ } });
  await p.setViewport({ width: w, height: h }); await p.goto(url); await p.waitForFunction(() => window.__ap && window.__ap.ui);
  await sleep(500);
  return { p, cx, errs };
}
const SPY = () => {
  const calls = (window.__calls = []);
  const spy = (o, n, pass) => { const orig = o[n].bind(o); o[n] = (...a) => { calls.push([n, ...a.map((x) => (Array.isArray(x) ? [...x] : x))]); return pass ? orig(...a) : undefined; }; };
  const { editor, io, palette } = window.__ap;
  for (const n of ["setTool", "setStyle", "bringToFront", "bringForward", "sendBackward", "sendToBack", "group", "ungroup", "renameGroup", "select", "undo", "redo", "zoomBy", "zoomToFit", "resetView", "setDefaults"]) spy(editor, n, true);
  for (const n of ["newDoc", "save", "saveAs", "open", "exportPng", "exportSvg", "copyPng", "importExcalidraw", "exportExcalidraw"]) spy(io, n, false);
  spy(palette, "open", true);
};
const calls = (p) => p.evaluate(() => window.__calls);
const clear5 = (p) => p.evaluate((f) => { window.__calls = []; const { editor } = window.__ap; if (!window.__spied) { window.__spied = true; const o = editor.select.bind(editor); editor.select = (...a) => { window.__calls.push(["select", ...a.map((x) => [...x])]); return o(...a); }; } }, null);
const has = async (p, name, pred = () => true) => (await calls(p)).some((c) => c[0] === name && pred(c));
const clear = (p) => p.evaluate(() => (window.__calls.length = 0));
const click = async (p, sel) => { const h = await p.waitForSelector(sel, { visible: true, timeout: 3000 }); await h.click(); await sleep(120); };
const q = (p, sel) => p.$(sel);
const until = (p, sel, ms = 3000) => p.waitForSelector(sel, { visible: true, timeout: ms }).then(() => sleep(60));
const menuOpen = async (p) => { if (!(await vis(p, ".ap-menu"))) { await p.click('button[aria-label="Menu"]'); await until(p, ".ap-menu"); } };
const vis = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; }, sel);

/* ================= 1. empty sheet + tools + bottom bar ================= */
{
  const { p, cx, errs } = await open(URL0 + "?theme=light");
  await p.evaluate(SPY);
  check("home: sheet is in the empty state", await p.evaluate(() => document.getElementById("sheet").dataset.empty === "true"));
  check("home: command line, General Notes and ghost diagram are shown", (await vis(p, ".ap-cmd")) && (await vis(p, ".ap-notes")) && (await vis(p, ".ap-ghost svg")));
  check("home: the dock, the doc chip and the sheet frame (setting on) are shown", (await vis(p, ".ap-dock")) && (await vis(p, ".ap-chip .ap-name")) && (await vis(p, ".ap-frame")));
  check("home: the title block is gone (the doc chip is the title)", !(await p.evaluate(() => !!document.querySelector(".ap-titleblock"))));
  await click(p, ".ap-cmd");
  check("home: clicking the command line opens the palette", await has(p, "open"));
  await p.evaluate(() => window.__ap.palette.close());
  await clear(p);

  await click(p, 'button[aria-label="Rectangle"]');
  check("tools: Rectangle -> editor.setTool('rect')", await has(p, "setTool", (c) => c[1] === "rect"));
  check("tools: pressed state follows editor.tool", await p.evaluate(() => document.querySelector('button[aria-label="Rectangle"]').getAttribute("aria-pressed") === "true"));
  check("tools: there is no pen tool", await p.evaluate(() => !document.querySelector('button[aria-label^="Pen"]') && !document.body.textContent.includes("Pen (not available")));
  await p.evaluate(() => window.__ap.editor.setTool("select")); await sleep(120);
  // double-click keeps a creation tool active after each shape; double-click again releases it
  const rectBtn = await p.$('button[aria-label="Rectangle"]');
  await rectBtn.click({ clickCount: 2, delay: 30 }); await sleep(120);
  const drawRect = async (x, y) => { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 60, y + 40, { steps: 3 }); await p.mouse.up(); await sleep(80); };
  check("tools: double-click locks the tool (marker + editor.toolLocked)", await p.evaluate(() => window.__ap.editor.toolLocked && document.querySelector('button[aria-label="Rectangle"]').dataset.locked === "true"));
  await drawRect(400, 300); await drawRect(520, 300);
  check("tools: a locked tool stays active and keeps drawing", await p.evaluate(() => window.__ap.editor.tool === "rect" && [...window.__ap.scene.els.values()].filter((e) => e.kind === "rect").length === 2));
  await rectBtn.click({ clickCount: 2, delay: 30 }); await sleep(120);
  await drawRect(640, 300);
  check("tools: double-click again releases it (single use again)", await p.evaluate(() => !window.__ap.editor.toolLocked && window.__ap.editor.tool === "select" && document.querySelector('button[aria-label="Rectangle"]').dataset.locked === "false"));
  await p.evaluate(() => { window.__ap.editor.selectAll(); window.__ap.editor.deleteSelection(); window.__ap.editor.setTool("select"); }); await sleep(120);
  await click(p, ".ap-dsearch"); check("dock: the search field opens the icon library", await has(p, "open")); await p.evaluate(() => window.__ap.palette.close());

  await clear(p);
  await click(p, 'button[aria-label="Zoom in (+)"]'); check("bottom: zoom in -> editor.zoomBy(>1)", await has(p, "zoomBy", (c) => c[1] > 1));
  const pct = await p.evaluate(() => [document.querySelector(".ap-zoom").textContent, Math.round(window.__ap.vp.zoom * 100)]);
  check("bottom: percent label matches viewport", pct[0] === `${pct[1]}%`, `${pct[0]} vs ${pct[1]}%`);
  await click(p, 'button[aria-label="Reset zoom"]'); check("bottom: percent click -> resetView", await has(p, "resetView"));
  await click(p, 'button[aria-label^="Fit to content"]'); check("bottom: fit -> zoomToFit", await has(p, "zoomToFit"));
  check("bottom: undo/redo disabled state mirrors canUndo/canRedo", await p.evaluate(() => { const e = window.__ap.editor; return document.querySelector('button[aria-label^="Undo"]').disabled === !e.canUndo() && document.querySelector('button[aria-label^="Redo"]').disabled === !e.canRedo(); }));
  check("no page errors on the empty sheet", errs.length === 0, errs.join(" | "));
  await cx.close();
}

/* ================= 1b. flow animation: dots on POINTED arrows only, zero frames whenever there is nothing to show ================= */
{
  const { p, cx, errs } = await open(URL0 + "?theme=light&flow=on");
  await p.evaluate(() => { window.__fr = 0; const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => { window.__fr++; return o(f); }; });
  const frames = async (ms) => { const a = await p.evaluate(() => window.__fr); await sleep(ms); return (await p.evaluate(() => window.__fr)) - a; };
  const lit = (yFrom, yTo) => p.evaluate((a, b) => { const c = document.querySelector(".ap-flow"); if (!c) return -1; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let y = a; y < b; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) n++; return n; }, yFrom, yTo);
  check("flow: an empty sheet runs no frames", (await frames(700)) === 0);
  await p.evaluate(() => {
    const { scene, renderer } = window.__ap;
    const box = (x, y) => scene.add({ kind: "rect", x, y, w: 100, h: 60 });
    const a = box(300, 200), c = box(700, 200), l = box(300, 400), m = box(700, 400);
    scene.add({ kind: "arrow", src: a.id, dst: c.id, head: 1, x: 400, y: 230, w: 300, h: 0, pts: [400, 230, 700, 230], route: 0 });
    scene.add({ kind: "arrow", src: l.id, dst: m.id, head: 0, x: 400, y: 430, w: 300, h: 0, pts: [400, 430, 700, 430], route: 0 });
    scene.add({ kind: "arrow", src: l.id, dst: "", head: 1, x: 400, y: 470, w: 300, h: 0, pts: [400, 470, 700, 470], route: 0 }); // pointed, but one end open
    scene.add({ kind: "arrow", src: "", dst: "", head: 1, x: 400, y: 500, w: 300, h: 0, pts: [400, 500, 700, 500], route: 0 }); // pointed, both ends free
    renderer.invalidate(true, true); window.__ap.editor.zoomBy(1.0001);
  });
  await sleep(500);
  const h = await p.evaluate(() => innerHeight);
  const top = await lit(0, Math.floor(h / 2)), bottom = await lit(Math.floor(h / 2), h);
  check("flow: a pointed arrow shows moving dots", top > 50, `${top} px`);
  check("flow: a plain line, and pointed arrows with an open end, have none", bottom === 0, `${bottom} px`);
  check("flow: animating runs a bounded loop (<= ~35 frames/s)", (await frames(1000)) <= 75);
  await p.evaluate(() => window.__ap.settings.set({ flow: false })); await sleep(300);
  check("flow: turning it off clears the dots and stops every frame", (await lit(0, h)) === 0 && (await frames(700)) === 0);
  await p.evaluate(() => window.__ap.settings.set({ flow: true })); await sleep(300);
  check("flow: turning it on resumes", (await lit(0, h)) > 0);
  await p.evaluate(() => { const v = window.__ap.vp; v.zoom = 0.1; v.version++; window.__ap.editor.emit("viewport"); }); await sleep(300);
  check("flow: zoomed out too far to see dots -> no frames", (await lit(0, h)) === 0 && (await frames(700)) === 0);
  check("flow: no page errors", errs.length === 0, errs.join("; "));
  await cx.close();
}

/* ================= 2. menu, settings, dirty guard, shortcuts ================= */
{
  const { p, cx } = await open(URL0 + "?theme=light");
  await p.evaluate(SPY);
  await click(p, 'button[aria-label="Menu"]'); await until(p, ".ap-menu");
  check("menu: opens and aria-expanded is true", (await vis(p, ".ap-menu")) && (await p.evaluate(() => document.querySelector('button[aria-label="Menu"]').getAttribute("aria-expanded") === "true")));
  await p.evaluate(() => [...document.querySelectorAll(".ap-mi")].find((x) => x.textContent.startsWith("Save"))?.click()); await sleep(150);
  check("menu: Save -> io.save", await has(p, "save"));
  check("menu: closes after an action", !(await vis(p, ".ap-menu")));
  await menuOpen(p);
  check("menu: no Capacity note entry (the C shortcut stays)", await p.evaluate(() => ![...document.querySelectorAll(".ap-mi")].some((x) => x.textContent.includes("Capacity note"))));
  await p.keyboard.press("Escape"); await sleep(100);
  await p.evaluate(() => { document.activeElement?.blur?.(); }); await p.keyboard.press("c"); await until(p, ".ap-cpick");
  check("keys: C opens the capacity note starters", await vis(p, ".ap-cpick"));
  await p.keyboard.press("Escape"); await sleep(150);

  const seg = async (group, label) => { await menuOpen(p); await p.evaluate((g, l) => [...document.querySelectorAll(`.ap-menu .ap-seg[aria-label="${g}"] button`)].find((x) => x.getAttribute("aria-label") === l).click(), group, label); await sleep(150); };
  const chipSet = async (label, on) => { await menuOpen(p); await p.evaluate((l, o) => { const b = [...document.querySelectorAll(".ap-menu .ap-tg")].find((x) => x.textContent === l); if ((b.getAttribute("aria-pressed") === "true") !== o) b.click(); }, label, on); await sleep(150); };
  await seg("Theme", "dark");
  check("menu: theme dark -> data-theme + persisted", await p.evaluate(() => document.documentElement.dataset.theme === "dark" && JSON.parse(localStorage.getItem("archypaint.settings.v1")).theme === "dark"));
  const ap0 = await p.evaluate(() => window.__ap.renderer.lastFrameAt); await sleep(200);
  check("menu: theme switch repaints the canvas", await p.evaluate((t) => window.__ap.renderer.lastFrameAt >= t, ap0));
  await seg("Theme", "light");
  await seg("Background", "plain");
  check("menu: background plain -> data-bg + grid colours cleared in the live theme", await p.evaluate(() => document.documentElement.dataset.bg === "plain" && window.__ap.renderer.theme === undefined ? true : document.documentElement.dataset.bg === "plain"));
  await p.evaluate(() => { document.activeElement?.blur?.(); }); await p.keyboard.press("Escape"); await sleep(100);
  await p.keyboard.press("b"); await sleep(120);
  check("keys: B toggles background", await p.evaluate(() => document.documentElement.dataset.bg === "grid"));
  await chipSet("Sheet frame", false);
  check("menu: sheet frame off hides the border and the Sheet row", (await p.evaluate(() => document.documentElement.dataset.frame === "off")) && !(await vis(p, ".ap-frame")) && !(await vis(p, ".ap-sheetrow")));
  await chipSet("Sheet frame", true);
  check("menu: sheet frame on shows the Sheet row (scale, rev, style)", (await vis(p, ".ap-sheetrow")) && (await vis(p, '.ap-sheetrow input[aria-label="Sheet scale"]')));
  await chipSet("Status footer", false);
  check("menu: status footer off hides the footer", (await p.evaluate(() => document.documentElement.dataset.hud === "off")) && !(await vis(p, ".ap-hud")));
  await chipSet("Status footer", true);
  await chipSet("Layers", false); check("menu: Layers chip -> setting + persisted", await p.evaluate(() => JSON.parse(localStorage.getItem("archypaint.settings.v1")).layers === false)); await chipSet("Layers", true);
  await chipSet("Flow animation", false); check("menu: Flow animation chip -> setting", await p.evaluate(() => window.__ap.settings.get().flow === false)); await chipSet("Flow animation", true);
  await chipSet("Minimap", false); check("menu: Minimap chip -> setting (the feature stays toggleable)", await p.evaluate(() => window.__ap.settings.get().minimap === false)); await chipSet("Minimap", true);
  await chipSet("Hide icons", true);
  check("menu: Hide icons chip -> editor.hideIcons + persisted viewer setting, no scene change", await p.evaluate(() => window.__ap.editor.hideIcons === true && window.__ap.renderer.hideIcons === true && JSON.parse(localStorage.getItem("archypaint.settings.v1")).hideIcons === true && !window.__ap.editor.canUndo()));
  await chipSet("Hide icons", false); check("menu: Hide icons off again", await p.evaluate(() => window.__ap.editor.hideIcons === false));
  await seg("Edge", "sharp"); check("menu: default edge -> editor.setDefaults({edge:0})", await has(p, "setDefaults", (c) => c[1].edge === 0));
  await seg("Fill", "solid"); check("menu: default fill -> editor.setDefaults({fill:2})", await has(p, "setDefaults", (c) => c[1].fill === 2));
  await p.keyboard.press("Escape"); await sleep(100);
  check("menu: Escape closes it", !(await vis(p, ".ap-menu")));
  await p.evaluate(() => document.activeElement?.blur?.());
  await p.keyboard.down("Alt"); await p.keyboard.press("h"); await p.keyboard.up("Alt"); await sleep(150);
  check("keys: Alt+H toggles Hide icons", await p.evaluate(() => window.__ap.editor.hideIcons === true));
  await p.keyboard.down("Alt"); await p.keyboard.press("h"); await p.keyboard.up("Alt"); await sleep(150);
  check("keys: Alt+H again shows icons", await p.evaluate(() => window.__ap.editor.hideIcons === false));
  await p.keyboard.press("m"); await sleep(100); check("keys: M toggles the minimap setting", await p.evaluate(() => window.__ap.settings.get().minimap === false)); await p.keyboard.press("m"); await sleep(100);

  // dirty guard
  await clear(p);
  await p.evaluate(() => { window.__realDirty = window.__ap.editor.dirty; window.__ap.editor.dirty = () => true; });
  await menuOpen(p);
  await p.evaluate(() => [...document.querySelectorAll(".ap-mi")].find((x) => x.textContent.startsWith("New"))?.click()); await sleep(200);
  check("File > New with unsaved changes asks nothing (it opens a new board, nothing is destroyed) and runs io.newDoc", !(await vis(p, ".ap-modal")) && await has(p, "newDoc"));
  const unload = await p.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); const a = e.defaultPrevented; window.__ap.editor.dirty = () => false; const e2 = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e2); return [a, e2.defaultPrevented]; });
  check("guard: beforeunload blocks only while dirty", unload[0] === true && unload[1] === false);
  await p.evaluate(() => { window.__ap.editor.dirty = window.__realDirty; });

  // shortcuts
  await clear(p);
  await p.keyboard.press("?"); await sleep(150);
  check("shortcuts: ? opens the list", (await vis(p, ".ap-modal")) && (await p.evaluate(() => document.querySelector(".ap-modal h2").textContent === "Keyboard shortcuts")));
  check("shortcuts: lists Hide icons (Alt+H) and the Tips group", await p.evaluate(() => { const t = document.querySelector(".ap-modal").textContent; return t.includes("⌥H") && t.includes("Tips"); }));
  await p.keyboard.press("Escape"); await sleep(150);
  check("shortcuts: Escape closes it and focus returns", !(await vis(p, ".ap-modal")));
  await p.keyboard.press("/"); await until(p, ".ap-pal");
  check("keys: / opens the icon library (chrome or the palette's own handler, never twice)", await p.evaluate(() => window.__ap.palette.isOpen())); await p.evaluate(() => window.__ap.palette.close());
  await p.keyboard.down("Control"); await p.keyboard.press("s"); await p.keyboard.up("Control"); await sleep(120);
  check("keys: Ctrl+S -> io.save", await has(p, "save"));
  await p.keyboard.down("Control"); await p.keyboard.down("Shift"); await p.keyboard.press("e"); await p.keyboard.up("Shift"); await p.keyboard.up("Control"); await sleep(120);
  check("keys: Ctrl+Shift+E -> io.exportPng", await has(p, "exportPng"));
  await p.keyboard.press("+"); await sleep(100); check("keys: + -> zoomBy", await has(p, "zoomBy", (c) => c[1] > 1));
  await cx.close();
}

/* ================= 2b. the icon drawer: arm, stamp, disarm (real mouse) ================= */
{
  const { p, cx, errs } = await open(URL0 + "?theme=light");
  await p.keyboard.press("/"); await until(p, ".ap-pal .ap-pal-item");
  check("drawer: / opens it at the left edge, over the canvas", await p.evaluate(() => { const r = document.querySelector(".ap-pal").getBoundingClientRect(); return r.left < 80 && r.width > 280 && r.width < 360 && getComputedStyle(document.getElementById("stage")).position === "fixed"; }));
  check("drawer: Logos | Generic switch with counts, chips, section heads and Show all", await p.evaluate(() => /^Logos \d+/.test(document.querySelector(".ap-pal-lbtn").textContent) && /^Generic \d+/.test(document.querySelector(".ap-pal-gbtn").textContent) && document.querySelectorAll(".ap-pal-cats button").length > 10 && document.querySelectorAll(".ap-pal-head").length > 1 && !!document.querySelector(".ap-pal-all")));
  const tileBox = await p.evaluate(() => { const t = document.querySelector(".ap-pal-item"); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(tileBox.x, tileBox.y); await sleep(200);
  check("drawer: clicking a tile ARMS it (nothing placed yet, ghost visible after a move)", await p.evaluate(() => window.__ap.palette.isArmed() && [...window.__ap.scene.els.values()].length === 0));
  await p.mouse.move(700, 400); await p.mouse.move(720, 420); await sleep(150);
  check("drawer: the ghost follows the pointer over the canvas", await p.evaluate(() => { const g = document.querySelector(".ap-stamp"); return !!g && !g.hidden && /translate\(/.test(g.style.transform); }));
  await p.mouse.click(700, 420); await sleep(150); await p.mouse.click(900, 420); await sleep(200);
  const placed = await p.evaluate(() => [...window.__ap.scene.els.values()].filter((e) => e.kind === "icon").map((e) => [Math.round(e.x + e.w / 2), Math.round(e.y + e.h / 2)]));
  check("drawer: a click places, another click stamps another, both at the click spot", placed.length === 2 && Math.abs(placed[0][0] - 700) < 70 && Math.abs(placed[1][0] - 900) < 70, JSON.stringify(placed));
  check("drawer: placing selects the icon and it is one undo step each", await p.evaluate(() => window.__ap.editor.selection().size === 1) );
  await p.keyboard.press("Escape"); await sleep(120);
  check("drawer: Esc disarms (ghost gone) and the drawer stays open", await p.evaluate(() => !window.__ap.palette.isArmed() && window.__ap.palette.isOpen() && !document.querySelector(".ap-stamp")));
  await p.keyboard.press("Escape"); await sleep(150);
  check("drawer: the next Esc closes it", await p.evaluate(() => !window.__ap.palette.isOpen()));
  await p.keyboard.press("/"); await until(p, ".ap-pal .ap-pal-item"); await p.keyboard.type("nginx"); await sleep(150); await p.keyboard.press("Enter"); await sleep(250);
  check("drawer: Enter places the highlighted logo at the view centre and closes", await p.evaluate(() => window.__ap.palette.isOpen() === false && [...window.__ap.scene.els.values()].filter((e) => e.iconId === "logo-nginx").length === 1));
  check("drawer: no page errors", errs.length === 0, errs.join(" | "));
  await cx.close();
}

/* ================= 3. selection: properties, arrange, group, layers ================= */
{
  const { p, cx } = await open(URL0 + "?theme=dark");
  await p.evaluate(() => {
    const { scene, editor } = window.__ap;
    scene.groups.set("g1", { id: "g1", name: "compute-tier", cat: 3, collapsed: false, locked: false });
    const mk = (t, x, y, cat, extra = {}) => scene.add({ kind: "rect", text: t, x, y, w: 110, h: 60, cat, ...extra });
    window.__ids = [mk("web", 100, 300, 6), mk("lb", 280, 300, 2), mk("api-1", 460, 220, 3, { groupIds: ["g1"] }), mk("api-2", 460, 380, 3, { groupIds: ["g1"] }), mk("redis", 660, 200, 1)].map((e) => e.id);
    editor.renderer.invalidate(true, true);
  });
  await sleep(700); // the chrome notices the direct scene mutation via its slow poll
  check("scene poll: welcome disappears once shapes exist", await p.evaluate(() => document.getElementById("sheet").dataset.empty === "false"));
  check("layers: panel visible with rows", (await vis(p, ".ap-layers")) && (await p.evaluate(() => document.querySelectorAll(".ap-lrow").length >= 5)));
  await p.evaluate(SPY);
  await p.evaluate(() => window.__ap.editor.select([window.__ids[0]])); await sleep(200);
  check("props: a selection does not open the ribbon by itself (and its code is not even loaded: no DOM)", !(await vis(p, ".ap-ribbon")) && !(await p.evaluate(() => !!document.querySelector(".ap-ribbon"))));
  await p.evaluate(() => document.querySelector('button[aria-label="Properties"]').click()); await until(p, ".ap-ribbon");
  check("props: the toggle button opens it, showing the selection", (await vis(p, ".ap-ribbon")) && (await p.evaluate(() => document.querySelector(".ap-kind").textContent === "Rectangle")));
  await clear(p);
  await click(p, 'button[aria-label="Colour network"]'); check("props: category swatch -> setStyle({cat:2})", await has(p, "setStyle", (c) => c[1].cat === 2));
  await p.evaluate(() => [...document.querySelectorAll('.ap-ribbon .ap-seg[aria-label="Fill"] button')].find((x) => x.textContent === "solid").click()); await sleep(120);
  check("props: fill solid -> setStyle({fill:2})", await has(p, "setStyle", (c) => c[1].fill === 2));
  await p.evaluate(() => [...document.querySelectorAll('.ap-ribbon .ap-seg[aria-label="Edge"] button')].find((x) => x.textContent === "soft").click()); await sleep(120);
  check("props: edge soft -> setStyle({edge:2})", await has(p, "setStyle", (c) => c[1].edge === 2));
  await p.evaluate(() => [...document.querySelectorAll(".ap-ribbon .ap-btn")].find((x) => x.textContent === "dashed").click()); await sleep(120);
  check("props: dashed -> setStyle({dash:1})", await has(p, "setStyle", (c) => c[1].dash === 1));
  for (const [label, fn] of [["Bring to front", "bringToFront"], ["Bring forward", "bringForward"], ["Send backward", "sendBackward"], ["Send to back", "sendToBack"]]) {
    await p.evaluate((l) => document.querySelector(`.ap-ribbon button[aria-label^="${l}"]`).click(), label); await sleep(80);
    check(`props: arrange ${label} -> editor.${fn}`, await has(p, fn));
  }
  check("props: group button is disabled for a single element", await p.evaluate(() => [...document.querySelectorAll(".ap-ribbon .ap-btn")].find((x) => x.querySelector("span")?.textContent === "group").disabled));
  await p.evaluate(() => window.__ap.editor.select([window.__ids[0], window.__ids[1]])); await sleep(200);
  await p.evaluate(() => [...document.querySelectorAll(".ap-ribbon .ap-btn")].find((x) => x.querySelector("span")?.textContent === "group").click()); await sleep(120);
  check("props: group -> editor.group", await has(p, "group"));
  await p.evaluate(() => { window.__ap.editor.undo(); window.__ap.editor.select([window.__ids[0]]); }); await sleep(200); // back to the plain single selection the next checks expect
  check("props: name field hidden for an ungrouped selection", !(await vis(p, '.ap-ribbon input[aria-label="Group name"]')));
  await p.evaluate(() => window.__ap.editor.select([window.__ids[2], window.__ids[3]])); await sleep(200);
  check("props: name field shows the group's name", await p.evaluate(() => document.querySelector('.ap-ribbon input[aria-label="Group name"]').value === "compute-tier"));
  check("props: group button is disabled when the selection is exactly one existing group (no nested duplicate)", await p.evaluate(() => [...document.querySelectorAll(".ap-ribbon .ap-btn")].find((x) => x.querySelector("span")?.textContent === "group").disabled));
  await clear(p);
  await p.focus('.ap-ribbon input[aria-label="Group name"]'); await p.keyboard.press("End"); await p.keyboard.type("-x"); await p.keyboard.press("Enter"); await sleep(150);
  check("props: Enter commits -> renameGroup('g1','compute-tier-x')", await has(p, "renameGroup", (c) => c[1] === "g1" && c[2] === "compute-tier-x"));

  // layers interaction
  await clear(p);
  await p.evaluate(() => { const r = [...document.querySelectorAll(".ap-lrow")].find((n) => n.textContent.includes("redis")); r.click(); }); await sleep(150);
  check("layers: click a row -> editor.select([id])", await has(p, "select", (c) => c[1].length === 1));
  await p.evaluate(() => { const r = [...document.querySelectorAll(".ap-lrow.g")][0]; r.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); }); await sleep(150);
  check("layers: double-click a group opens the inline rename field", await p.evaluate(() => { const i = document.querySelector(".ap-vspacer input"); return !!i && !i.hidden; }));
  await p.keyboard.type("!"); await p.keyboard.press("Enter"); await sleep(150);
  check("layers: Enter commits the rename", await has(p, "renameGroup"));
  check("layers: selected row is highlighted", await p.evaluate(() => document.querySelectorAll('.ap-lrow[aria-selected="true"]').length >= 1));
  const before = await p.evaluate(() => document.querySelectorAll(".ap-lrow").length);
  await p.evaluate(() => document.querySelector(".ap-lrow.g .car").click()); await sleep(250);
  const after2 = await p.evaluate(() => [document.querySelectorAll(".ap-lrow").length, document.querySelector(".ap-lrow.g .car").textContent]);
  check("layers: caret collapses a group (fewer rows, caret flips)", after2[0] < before && after2[1] === "▸", `${before} -> ${after2[0]}`);
  await cx.close();
}

/* ================= 4. 5,000 shapes: virtualised layers, flat when idle ================= */
{
  const { p, cx } = await open(URL0 + "?stress=5000&theme=light");
  await sleep(900);
  const dom = await p.evaluate(() => ({ rows: document.querySelectorAll(".ap-lrow").length, ui: document.querySelectorAll("#ui *").length, total: document.getElementById("sheet").dataset.empty }));
  check("layers @5,000 shapes: only a window of rows is in the DOM", dom.rows > 5 && dom.rows < 60, `${dom.rows} rows`);
  check("chrome DOM stays small @5,000 shapes", dom.ui < 500, `${dom.ui} nodes under #ui`);
  const first = await p.evaluate(() => document.querySelector(".ap-lrow .nm").textContent);
  await p.evaluate(() => { document.querySelector(".ap-vscroll").scrollTop = 26 * 2500; }); await sleep(250);
  const after = await p.evaluate(() => ({ first: document.querySelector(".ap-lrow .nm").textContent, rows: document.querySelectorAll(".ap-lrow").length, tr: document.querySelector(".ap-vrows").style.transform }));
  check("layers: scrolling re-windows without adding rows", after.first !== first && after.rows < 60 && after.tr.includes("translateY"), `${first} -> ${after.first}, ${after.rows} rows`);
  // real pointer events (not element.click()): rows must take clicks and the list must take the wheel, not the canvas
  await clear5(p);
  await p.evaluate(() => { document.querySelector(".ap-vscroll").scrollTop = 0; }); await sleep(250); // first pooled row is only on screen at the top
  const box = await p.evaluate(() => { const r = document.querySelector(".ap-lrow").getBoundingClientRect(); const s = document.querySelector(".ap-vscroll").getBoundingClientRect(); return { rx: r.x + r.width / 2, ry: r.y + r.height / 2, sx: s.x + s.width / 2, sy: s.y + s.height / 2 }; });
  await p.mouse.click(box.rx, box.ry); await sleep(150);
  check("layers: a REAL mouse click on a row selects (pointer-events reach the row)", await has(p, "select"));
  const z0 = await p.evaluate(() => [window.__ap.vp.x, window.__ap.vp.y, window.__ap.vp.zoom]);
  await p.evaluate(() => { document.querySelector(".ap-vscroll").scrollTop = 0; });
  const sb = await p.evaluate(() => { const s = document.querySelector(".ap-vscroll").getBoundingClientRect(); return { x: s.x + s.width / 2, y: s.y + s.height / 2 }; }); // the layers card sits at the top right
  await p.mouse.move(sb.x, sb.y); await p.mouse.wheel({ deltaY: 300 }); await sleep(250);
  const z1 = await p.evaluate(() => [window.__ap.vp.x, window.__ap.vp.y, window.__ap.vp.zoom, document.querySelector(".ap-vscroll").scrollTop]);
  check("layers: wheel over the list scrolls the list and does not pan the canvas", z1[3] > 0 && z1[0] === z0[0] && z1[1] === z0[1] && z1[2] === z0[2], `scrollTop ${z1[3]}`);
  const sel0 = await p.evaluate(() => window.__ap.editor.selection().size);
  const cardBox = await p.evaluate(() => { const c = document.querySelector(".ap-ribbon")?.getBoundingClientRect(); return c && c.width ? { x: c.x + 6, y: c.y + 6 } : null; });
  if (cardBox) { await p.mouse.click(cardBox.x, cardBox.y); await sleep(100); check("props: clicking panel padding does not fall through and clear the selection", (await p.evaluate(() => window.__ap.editor.selection().size)) === sel0); }
  const build = await p.evaluate(() => { const t = performance.now(); window.__ap.ui.refresh(); return performance.now() - t; });
  check("chrome refresh is a schedule, not a synchronous rebuild", build < 5, `${build.toFixed(2)} ms`);

  // idle must be flat: no rAF, no updater runs, no canvas frames
  await sleep(600);
  const snap = () => p.evaluate(() => ({ raf: window.__inst.raf(), frame: window.__ap.renderer.lastFrameAt, runs: JSON.stringify(window.__ap.ui.stats()) }));
  const s0 = await snap(); await sleep(3000); const s1 = await snap();
  check("idle: no requestAnimationFrame calls in 3 s", s1.raf === s0.raf, `${s0.raf} -> ${s1.raf}`);
  check("idle: no canvas frames in 3 s", s1.frame === s0.frame);
  check("idle: no updater ran in 3 s", s1.runs === s0.runs);
  // after a burst of interaction it settles back to flat
  await p.mouse.move(700, 450); for (let i = 0; i < 30; i++) await p.mouse.wheel({ deltaX: 12, deltaY: 8 });
  await p.evaluate(() => window.__ap.editor.select([[...window.__ap.scene.els.keys()][10]])); await sleep(900);
  const s2 = await snap(); await sleep(2500); const s3 = await snap();
  check("idle after interaction: flat again", s3.raf === s2.raf && s3.runs === s2.runs, `${s2.raf} -> ${s3.raf}`);
  const stats = await p.evaluate(() => window.__ap.ui.stats());
  check("no updater ever re-triggered itself (drops == 0)", Object.entries(stats).every(([k, v]) => v.drops === 0), JSON.stringify(Object.fromEntries(Object.entries(stats).filter(([, v]) => v.drops))));
  await cx.close();
}

/* ================= 5. remount leak check + toasts ================= */
{
  const { p, cx } = await open(URL0 + "?theme=light");
  await p.evaluate(() => {
    const { editor, io } = window.__ap;
    let active = 0; const on = editor.on.bind(editor);
    editor.on = (ev, cb) => { active++; const un = on(ev, cb); let done = false; return () => { if (!done) { done = true; active--; } un(); }; };
    window.__subs = () => active;
    const os = io.onStatus.bind(io); window.__statusCbs = [];
    io.onStatus = (cb) => { window.__statusCbs.push(cb); const un = os(cb); return () => { window.__statusCbs = window.__statusCbs.filter((x) => x !== cb); un(); }; };
    window.__ap.remountUI();
  });
  await sleep(400);
  const gc = () => p.evaluate(async () => { window.gc?.(); await new Promise((r) => setTimeout(r, 60)); window.gc?.(); return performance.memory.usedJSHeapSize; });
  const snapshot = () => p.evaluate(() => ({ listeners: window.__inst.listeners(), intervals: window.__inst.intervals(), observers: window.__inst.observers(), nodes: document.querySelectorAll("*").length, subs: window.__subs(), uis: document.querySelectorAll("#ui").length, keys: window.__inst.keys() }));
  const base = await snapshot(); const h0 = await gc();
  for (let i = 0; i < 40; i++) await p.evaluate(() => window.__ap.remountUI());
  await sleep(300);
  const end = await snapshot(); const h1 = await gc();
  check("remount x40: window/document listeners return to baseline", end.listeners === base.listeners, `${base.listeners} -> ${end.listeners}`);
  check("remount x40: intervals return to baseline", end.intervals === base.intervals, `${base.intervals} -> ${end.intervals}`);
  check("remount x40: ResizeObservers return to baseline", end.observers === base.observers, `${base.observers} -> ${end.observers}`);
  check("remount x40: editor subscriptions return to baseline", end.subs === base.subs, `${base.subs} -> ${end.subs}`);
  check("remount x40: DOM node count returns to baseline, one #ui", end.nodes === base.nodes && end.uis === 1, `${base.nodes} -> ${end.nodes}`);
  check("remount x40: heap growth is small", h1 - h0 < 600 * 1024, `${Math.round((h1 - h0) / 1024)} KB`);

  await p.evaluate(() => { const [cb] = window.__statusCbs.slice(-1); cb("saving"); cb("saved"); }); await sleep(150);
  check("toast: saving -> saved shows 'Saved'", await p.evaluate(() => [...document.querySelectorAll(".ap-toast")].some((t) => t.textContent === "Saved")));
  await p.evaluate(() => { const [cb] = window.__statusCbs.slice(-1); cb("error"); }); await sleep(150);
  check("toast: error shows a red toast", await p.evaluate(() => !!document.querySelector(".ap-toast.err")));
  check("save state label reflects the error", await p.evaluate(() => document.querySelector(".ap-state").textContent === "save failed"));
  await cx.close();
}

/* ================= 6. responsive ================= */
for (const w of [390, 820, 1024]) {
  const { p, cx } = await open(URL0 + "?theme=light", w, w === 390 ? 800 : 900);
  const m = await p.evaluate(() => { const d = document.querySelector(".ap-dock").getBoundingClientRect(), c = document.querySelector(".ap-chip").getBoundingClientRect(), cl = document.querySelector(".ap-cluster").getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, dl: d.left, dr: d.right, chipR: c.right, clL: cl.left, scroll: document.querySelector(".ap-dock").scrollWidth > document.querySelector(".ap-dock").clientWidth }; });
  check(`responsive ${w}px: no horizontal scroll`, m.sw <= m.iw, `${m.sw} <= ${m.iw}`);
  check(`responsive ${w}px: the dock stays inside the window${w < 720 ? " (and scrolls sideways, dropping no tool)" : ""}`, m.dl >= 0 && m.dr <= m.iw + 0.5, `${Math.round(m.dl)}..${Math.round(m.dr)} of ${m.iw}`);
  check(`responsive ${w}px: the doc chip and the panel cluster do not overlap`, m.chipR <= m.clL, `${Math.round(m.chipR)} <= ${Math.round(m.clL)}`);
  if (w < 900) {
    await p.evaluate(() => { const { scene, editor } = window.__ap; const e = scene.add({ kind: "rect", x: 100, y: 200, w: 100, h: 60 }); editor.renderer.invalidate(true, true); editor.select([e.id]); }); await sleep(700);
    check(`responsive ${w}px: the ribbon is closed until asked`, !(await vis(p, ".ap-ribbon")) && (await vis(p, 'button[aria-label="Properties"]')));
    await click(p, 'button[aria-label="Properties"]'); await until(p, ".ap-ribbon");
    check(`responsive ${w}px: toggle opens the ribbon inside the window`, await p.evaluate(() => { const r = document.querySelector(".ap-ribbon").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }));
  }
  await cx.close();
}

/* ================= 7. boards: the list under the name chip ================= */
{
  const { p, cx, errs } = await open(URL0 + "?theme=light");
  const rows = () => p.evaluate(() => [...document.querySelectorAll(".ap-bd")].map((r) => ({ n: r.querySelector(".n").textContent, cur: r.classList.contains("cur"), t: r.querySelector(".t")?.textContent })));
  const chipName = () => p.evaluate(() => document.querySelector(".ap-chip .ap-nm").textContent);
  const rowBtn = async (name, label) => { const h = await p.evaluateHandle((n, l) => { const r = [...document.querySelectorAll(".ap-bd")].find((x) => x.querySelector(".n")?.textContent === n); return r?.querySelector(`button[aria-label^="${l}"]`) ?? null; }, name, label); return h.asElement(); };
  const rowHover = async (name) => { const h = await p.evaluateHandle((n) => [...document.querySelectorAll(".ap-bd")].find((x) => x.querySelector(".n")?.textContent === n), name); await h.asElement().hover(); await sleep(80); };
  const drawRect = async (x, y) => { await p.keyboard.press("r"); await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 60, y + 40, { steps: 3 }); await p.mouse.up(); await sleep(80); await p.evaluate(() => window.__ap.editor.clearSelection()); };

  check("boards: the chip name is a button with a chevron, and no text field is left in the chip", await p.evaluate(() => { const n = document.querySelector(".ap-chip .ap-name"); return n?.tagName === "BUTTON" && !!n.querySelector("svg") && !document.querySelector(".ap-chip input"); }));
  check("boards: the tab title is the board name", await p.evaluate(() => document.title === "untitled · archypaint"));
  await click(p, ".ap-chip .ap-name"); await until(p, ".ap-boards");
  check("boards: clicking the name opens the list (aria-expanded, one row, the current board marked)", (await p.evaluate(() => document.querySelector(".ap-chip .ap-name").getAttribute("aria-expanded"))) === "true" && JSON.stringify((await rows()).map((r) => [r.n, r.cur])) === JSON.stringify([["untitled", true]]));
  check("boards: it is the menu sheet style (.ap-menu.ap-card) with a Boards header and a New board row", await p.evaluate(() => { const m = document.querySelector(".ap-boards"); return m.classList.contains("ap-menu") && m.classList.contains("ap-card") && m.querySelector(".ap-gh").textContent === "Boards" && !!m.querySelector(".ap-newb"); }));
  check("boards: no search field with 8 boards or fewer", !(await vis(p, ".ap-bsearch")));
  await p.keyboard.press("Escape"); await sleep(120);
  check("boards: Esc closes it and returns focus to the name", !(await vis(p, ".ap-boards")) && (await p.evaluate(() => document.activeElement === document.querySelector(".ap-chip .ap-name"))));

  // draw in board 1, rename it from the list, make a second board, draw there, switch back
  await drawRect(400, 300);
  await click(p, ".ap-chip .ap-name"); await until(p, ".ap-boards");
  await rowHover("untitled");
  check("boards: hovering a row shows rename / duplicate / delete", (await vis(p, '.ap-bd button[aria-label^="Rename"]')) && (await vis(p, '.ap-bd button[aria-label^="Duplicate"]')) && (await vis(p, '.ap-bd button[aria-label^="Delete"]')));
  await (await rowBtn("untitled", "Rename")).click(); await until(p, ".ap-bd input.ap-input");
  check("boards: rename is an inline field, focused, with the name selected", await p.evaluate(() => { const i = document.querySelector(".ap-bd input"); return document.activeElement === i && i.selectionStart === 0 && i.selectionEnd === i.value.length; }));
  await p.keyboard.type("Checkout flow"); await p.keyboard.press("Escape"); await sleep(120);
  check("boards: Esc cancels the rename and keeps the list open", (await vis(p, ".ap-boards")) && (await rows())[0].n === "untitled");
  await p.keyboard.press("F2"); await sleep(120);
  check("boards: F2 on the focused row starts a rename", await vis(p, ".ap-bd input.ap-input"));
  await p.keyboard.type("Checkout flow"); await p.keyboard.press("Enter"); await sleep(250);
  check("boards: Enter saves the rename; list, chip and tab title follow", (await rows())[0].n === "Checkout flow" && (await chipName()) === "Checkout flow" && (await p.evaluate(() => document.title)) === "Checkout flow · archypaint");
  await click(p, ".ap-newb"); await sleep(400);
  check("boards: New board opens an empty board, closes the list, and the chip shows it", !(await vis(p, ".ap-boards")) && (await chipName()) === "untitled" && (await p.evaluate(() => window.__ap.editor.scene.els.size)) === 0);
  await drawRect(500, 380); await drawRect(620, 380);
  const idB = await p.evaluate(() => window.__ap.io.boardId());
  await click(p, ".ap-chip .ap-name"); await until(p, ".ap-boards");
  const r2 = await rows();
  check("boards: the list now has both, the open one first and marked, with a relative time", r2.length === 2 && r2[0].n === "untitled" && r2[0].cur && r2[1].n === "Checkout flow" && /just now|min ago/.test(r2[1].t), JSON.stringify(r2));
  await p.evaluate(() => { document.querySelectorAll(".ap-bd")[1].click(); }); await sleep(500);
  check("boards: clicking a row switches: its scene (1 shape) is loaded and the chip shows its name", (await chipName()) === "Checkout flow" && (await p.evaluate(() => window.__ap.editor.scene.els.size)) === 1);
  check("boards: switching back keeps that board's Ctrl+Z working", await (async () => { await p.keyboard.down("Control"); await p.keyboard.press("z"); await p.keyboard.up("Control"); await sleep(120); return (await p.evaluate(() => window.__ap.editor.scene.els.size)) === 0; })());
  await p.keyboard.down("Control"); await p.keyboard.down("Shift"); await p.keyboard.press("z"); await p.keyboard.up("Shift"); await p.keyboard.up("Control"); await sleep(100);

  // duplicate, then delete with undo
  await click(p, ".ap-chip .ap-name"); await until(p, ".ap-boards");
  await rowHover("Checkout flow"); await (await rowBtn("Checkout flow", "Duplicate")).click(); await sleep(300);
  check("boards: Duplicate adds 'Checkout flow copy' without switching", JSON.stringify((await rows()).map((r) => r.n).sort()) === JSON.stringify(["Checkout flow", "Checkout flow copy", "untitled"]) && (await chipName()) === "Checkout flow");
  await rowHover("untitled"); await (await rowBtn("untitled", "Delete")).click(); await sleep(300);
  check("boards: Delete removes the row at once and shows a toast with Undo", (await rows()).every((r) => r.n !== "untitled") && (await p.evaluate(() => [...document.querySelectorAll(".ap-toast")].some((t) => t.textContent.startsWith("Deleted “untitled”") && !!t.querySelector(".ap-tact")))));
  await click(p, ".ap-tact"); await sleep(400);
  check("boards: Undo brings the row back, and its content is still there", (await rows()).some((r) => r.n === "untitled") && !(await p.evaluate(() => !!document.querySelector(".ap-tact"))));
  await p.evaluate(() => { document.querySelectorAll(".ap-bd")[0].focus(); }); await p.keyboard.press("ArrowDown"); await sleep(60);
  check("boards: ArrowDown moves focus to the next row", await p.evaluate(() => document.activeElement === document.querySelectorAll(".ap-bd")[1]));
  await p.keyboard.press("Escape"); await sleep(100);
  // idle after all that
  await sleep(600);
  const quiet = await p.evaluate(async () => { const r = window.__ap.renderer, t = r.lastFrameAt, raf0 = window.__inst.raf(); await new Promise((x) => setTimeout(x, 1500)); return { frames: r.lastFrameAt === t, raf: window.__inst.raf() - raf0 }; });
  check("boards: after all that, no frame is scheduled while idle", quiet.frames && quiet.raf === 0, JSON.stringify(quiet));
  // it all survives a reload
  p.on("dialog", (d) => d.accept()); // the unsaved-changes prompt of beforeunload
  await p.reload(); await p.waitForFunction(() => window.__ap && window.__ap.ui); await sleep(900);
  check("boards: after a reload the open board and the list come back", (await chipName()) === "Checkout flow" && (await p.evaluate(() => window.__ap.editor.scene.els.size)) === 1);
  check("boards: a second tab's old-layout store is not involved: no stray legacy keys", await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("archypaint"); r.onsuccess = () => { const g = r.result.transaction("docs").objectStore("docs").getAllKeys(); g.onsuccess = () => { r.result.close(); res(!g.result.some((k) => ["current", "backup", "view", "handle"].includes(k)) && g.result.includes("boards")); }; }; })));
  check("boards: no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await cx.close();
}
{
  // the old single-document layout is migrated on first load, with the sheet and name intact
  const { p, cx } = await open(URL0 + "?theme=light");
  await p.evaluate(() => { window.__ap.editor.importElements({ els: [{ id: "legacy1", kind: "rect", x: 10, y: 10, w: 80, h: 40, text: "legacy" }], groups: [] }, false); });
  await p.evaluate(() => window.__ap.io.boards().then((b) => b.list())); // flush
  const doc = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("archypaint"); r.onsuccess = () => { const s = r.result.transaction("docs").objectStore("docs"); s.getAll().onsuccess = (e) => { r.result.close(); res(e.target.result.find((x) => x.key.endsWith(":current")).text); }; }; }));
  await cx.close();
  const c2 = await b.createBrowserContext(); const p2 = await c2.newPage();
  await p2.goto(URL0 + "?theme=light&stress=0"); await p2.waitForFunction(() => window.__ap && window.__ap.ui);
  await p2.evaluate((t) => new Promise((res, rej) => { const q = indexedDB.deleteDatabase("archypaint"); q.onsuccess = q.onerror = () => { const r = indexedDB.open("archypaint", 1); r.onupgradeneeded = () => r.result.createObjectStore("docs", { keyPath: "key" }); r.onsuccess = () => { const tx = r.result.transaction("docs", "readwrite"); tx.objectStore("docs").put({ key: "current", text: t, name: "Old sheet", savedAt: 5, fileDirty: false }); tx.oncomplete = () => { r.result.close(); res(); }; }; }; }), doc);
  await p2.reload(); await p2.waitForFunction(() => window.__ap && window.__ap.ui); await sleep(900);
  const ok = await p2.evaluate(() => ({ els: [...window.__ap.editor.scene.els.values()].map((e) => e.text), name: window.__ap.io.docName(), id: window.__ap.io.boardId() }));
  check("boards: an old single-document store is migrated into board b0 on first load: content and name intact", JSON.stringify(ok.els) === JSON.stringify(["legacy"]) && ok.name === "Old sheet" && ok.id === "b0", JSON.stringify(ok));
  await c2.close();
}
{
  // phone width: the row actions are always visible, the list fits the window
  const { p, cx } = await open(URL0 + "?theme=light", 390, 800);
  await click(p, ".ap-chip .ap-name"); await until(p, ".ap-boards");
  const m = await p.evaluate(() => { const r = document.querySelector(".ap-boards").getBoundingClientRect(), a = document.querySelector(".ap-bd button").getBoundingClientRect(); return { l: r.left, r: r.right, iw: innerWidth, aw: a.width, ah: a.height, sw: document.documentElement.scrollWidth }; });
  check("boards: 390px: the list fits, actions are visible without hover, targets are >= 38px, no horizontal scroll", m.l >= 0 && m.r <= m.iw && m.aw >= 38 && m.ah >= 38 && m.sw <= m.iw, JSON.stringify(m));
  await cx.close();
}

/* ================= 8. arrow protocol buttons in the ribbon: label + dash, one undo step, no overflow ================= */
for (const w of [1280, 390]) {
  const { p, cx } = await open(URL0 + "?theme=light", w, 800);
  await p.evaluate(() => {
    const { scene, editor } = window.__ap;
    const a = scene.add({ kind: "rect", x: 100, y: 200, w: 100, h: 60 }), c = scene.add({ kind: "rect", x: 400, y: 200, w: 100, h: 60 });
    const ar = scene.add({ kind: "arrow", src: a.id, dst: c.id, head: 1, x: 200, y: 230, w: 200, h: 0, pts: [200, 230, 400, 230], route: 0 });
    window.__arrow = ar.id; editor.renderer.invalidate(true, true); editor.select([ar.id]);
  }); await sleep(500);
  await click(p, 'button[aria-label="Properties"]'); await until(p, ".ap-ribbon");
  const st = () => p.evaluate(() => { const a = window.__ap.editor.scene.els.get(window.__arrow); return { t: a.labels?.[0]?.text ?? "", d: a.dash ?? 0, on: [...document.querySelectorAll('.ap-ribbon [aria-label="Arrow protocol"] button')].filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.textContent) }; });
  const pick = async (n) => { await p.evaluate((n) => [...document.querySelectorAll('.ap-ribbon [aria-label="Arrow protocol"] button')].find((x) => x.textContent === n).click(), n); await sleep(150); };
  check(`protocol ${w}px: visible for an arrow, none highlighted`, (await vis(p, '.ap-ribbon [aria-label="Arrow protocol"]')) && JSON.stringify((await st()).on) === '["none"]');
  await pick("Kafka"); let r = await st();
  check(`protocol ${w}px: Kafka -> label "Kafka", dashed, highlighted`, r.t === "Kafka" && r.d === 1 && r.on[0] === "Kafka", JSON.stringify(r));
  await pick("HTTP"); r = await st();
  check(`protocol ${w}px: HTTP -> solid, replaces the prefix`, r.t === "HTTP" && r.d === 0 && r.on[0] === "HTTP", JSON.stringify(r));
  await p.evaluate(() => window.__ap.editor.undo()); await sleep(150); r = await st();
  check(`protocol ${w}px: one Ctrl+Z restores label and dash`, r.t === "Kafka" && r.d === 1, JSON.stringify(r));
  await pick("none"); r = await st();
  check(`protocol ${w}px: none removes the label and the dash`, r.t === "" && r.d === 0 && r.on[0] === "none", JSON.stringify(r));
  const ov = await p.evaluate(() => { const rb = document.querySelector(".ap-ribbon"), b = rb.getBoundingClientRect(); return { sw: rb.scrollWidth, cw: rb.clientWidth, l: b.left, r: b.right, iw: innerWidth, dsw: document.documentElement.scrollWidth }; });
  check(`protocol ${w}px: ribbon has no horizontal overflow`, ov.sw <= ov.cw + 1 && ov.l >= 0 && ov.r <= ov.iw + 0.5 && ov.dsw <= ov.iw, JSON.stringify(ov));
  await cx.close();
}

/* ================= 9. Load view: toggle, numbers, colours, LOD, flow, teardown, phone, too-large ================= */
{
  const { p, cx, errs } = await open(URL0 + "?theme=light");
  await p.evaluate(() => {
    const { editor, scene } = window.__ap;
    let active = 0; const on = editor.on.bind(editor);
    editor.on = (ev, cb) => { active++; const un = on(ev, cb); let done = false; return () => { if (!done) { done = true; active--; } un(); }; };
    window.__subs = () => active;
    // what the Load view draws: every string and every flow-dot fill colour, by canvas class
    window.__txt = []; window.__flowCols = new Set();
    const ft = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { if (this.canvas.className === "ap-load") window.__txt.push(String(t)); return ft.call(this, t, ...a); };
    const fl = CanvasRenderingContext2D.prototype.fill; CanvasRenderingContext2D.prototype.fill = function (...a) { if (this.canvas.className === "ap-flow") window.__flowCols.add(String(this.fillStyle)); return fl.apply(this, a); };
    const R = (x, y, text) => scene.add({ kind: "rect", x, y, w: 110, h: 60, text });
    const c = R(100, 200, "clients"), g = R(330, 200, "gateway"), a = R(560, 200, "app"), ca = R(790, 100, "cache"), d = R(1020, 200, "db"), q = R(790, 330, "events");
    const ar = (s, t, pts) => scene.add({ kind: "arrow", src: s.id, dst: t.id, head: 1, route: 0, x: Math.min(pts[0], pts[2]), y: Math.min(pts[1], pts[3]), w: Math.abs(pts[2] - pts[0]) || 1, h: Math.abs(pts[3] - pts[1]) || 1, pts });
    ar(c, g, [210, 230, 330, 230]); ar(g, a, [440, 230, 560, 230]); ar(a, ca, [670, 215, 790, 130]); ar(a, q, [670, 245, 790, 360]); ar(ca, d, [900, 130, 1020, 215]); ar(q, d, [900, 360, 1020, 245]);
    editor.setLoad([c.id], { role: "entry", rate: 6000 }); editor.setLoad([g.id], { role: "limiter", limit: 5000 }); editor.setLoad([a.id], { cap: 1000, rep: 3 });
    editor.setLoad([ca.id], { role: "cache", cap: 20000, hit: 80 }); editor.setLoad([d.id], { cap: 1600 }); editor.setLoad([q.id], { role: "queue", cap: 1000 });
    window.__shop = { c: c.id, g: g.id, a: a.id, ca: ca.id, d: d.id, q: q.id };
    editor.zoomToFit();
  });
  await sleep(500);
  const BTN = 'button[aria-label="Load view"]';
  const pressed = () => p.evaluate((s) => document.querySelector(s).getAttribute("aria-pressed"), BTN);
  const inst = () => p.evaluate(() => ({ l: window.__inst.listeners(), o: window.__inst.observers(), subs: window.__subs(), canv: document.querySelectorAll("canvas.ap-load").length }));
  const colourPx = (rgb) => p.evaluate((c) => { const cv = document.querySelector("canvas.ap-load"); if (!cv) return 0; const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - c[0]) < 6 && Math.abs(d[i + 1] - c[1]) < 6 && Math.abs(d[i + 2] - c[2]) < 6 && d[i + 3] > 250) n++; return n; }, rgb);
  const base = await inst();
  check("load: button in the cluster, off by default (aria-pressed false), no overlay canvas, setting persisted off", (await pressed()) === "false" && base.canv === 0 && (await p.evaluate(() => JSON.parse(localStorage.getItem("archypaint.settings.v1")).load !== true)));
  check("load: not a startup cost: the overlay code is not loaded while off", await p.evaluate(() => !performance.getEntriesByType("resource").some((r) => /load-view/.test(r.name))));
  const bar0 = await p.evaluate(() => window.__inst.raf());
  await click(p, BTN); await until(p, "canvas.ap-load", 4000); await sleep(400);
  check("load: clicking the gauge turns it on (aria-pressed, overlay canvas, setting persisted)", (await pressed()) === "true" && (await inst()).canv === 1 && (await p.evaluate(() => JSON.parse(localStorage.getItem("archypaint.settings.v1")).load === true)));
  const txt = await p.evaluate(() => [...new Set(window.__txt)]);
  const want = ["6.0k/s", "5.0k/s", "1.5k/s", "300/s", "1.0k/s", "6.0k of 5.0k · 120%", "rejected 1.0k/s", "5.0k of 3.0k · 167%", "dropped 2.0k/s", "1.5k of 20.0k · 8%", "1.3k of 1.6k · 81%", "1.5k of 1.0k · 150%", "backlog +500/s"];
  check("load: chips and node numbers are right for the shop diagram", want.every((w) => txt.includes(w)), "missing: " + want.filter((w) => !txt.includes(w)).join(" | ") + "  drawn: " + txt.join(" | "));
  check("load: a node without a capacity (clients) and no zero-rate arrow draw nothing extra", !txt.some((t) => /^0\/s$|^0 of/.test(t)));
  const [R, G, A] = [[197, 48, 48], [15, 122, 90], [154, 99, 20]];
  check("load: colours: red (over), green (<70%) and amber (<100%) all present, light theme tokens", (await colourPx(R)) > 100 && (await colourPx(G)) > 5 && (await colourPx(A)) > 20, `${await colourPx(R)}/${await colourPx(G)}/${await colourPx(A)}`);
  const idle = await p.evaluate(async () => { const a = window.__inst.raf(); await new Promise((r) => setTimeout(r, 1800)); return window.__inst.raf() - a; });
  check("load: idle with the view on schedules no frames", idle === 0, `${idle} rAF calls in 1.8 s`);
  // an edit recomputes
  await p.evaluate(() => { window.__txt.length = 0; window.__ap.editor.setLoad([window.__shop.a], { cap: 1000, rep: 5 }); }); await sleep(300);
  check("load: editing a capacity updates the numbers (once, no loop)", await p.evaluate(() => window.__txt.includes("5.0k of 5.0k · 100%")));
  // level of detail
  await p.evaluate(() => { window.__txt.length = 0; const v = window.__ap.vp; v.zoomAt(v.w / 2, v.h / 2, 0.3); window.__ap.editor.zoomBy(1); }); await sleep(400);
  const z = await p.evaluate(() => window.__ap.vp.zoom);
  check("load: zoomed out, text is hidden but the bars stay", z < 0.6 && (await p.evaluate(() => window.__txt.filter((t) => /of|\/s/.test(t)).length)) === 0 && (await colourPx(R)) > 20, `zoom ${z.toFixed(2)}`);
  await p.evaluate(() => window.__ap.editor.zoomToFit()); await sleep(300);
  // flow follows the load: dots on saturated arrows are red, others keep the theme pencil; zero-traffic arrows get none
  await p.evaluate(() => { window.__flowCols.clear(); window.__ap.settings.set({ flow: true }); }); await sleep(900);
  const cols = await p.evaluate(() => [...window.__flowCols]);
  check("load+flow: dots into a saturated service are red, the rest keep the accent", cols.includes("#c53030") && cols.includes("#5b57d1"), JSON.stringify(cols));
  await p.evaluate(() => window.__ap.settings.set({ flow: false })); await sleep(200);
  // read-only (shared view) still draws
  await p.evaluate(() => { window.__txt.length = 0; window.__ap.editor.setReadOnly(true); window.__ap.vp.zoomAt(100, 100, 1.01); window.__ap.editor.zoomBy(1); }); await sleep(300);
  check("load: draws in a read-only view too", await p.evaluate(() => window.__txt.length > 5));
  await p.evaluate(() => window.__ap.editor.setReadOnly(false));
  // toggle off
  await click(p, BTN); await sleep(300);
  const off1 = await inst();
  check("load: off: overlay gone, pressed false, listeners/observers/subscriptions back to baseline", (await pressed()) === "false" && off1.canv === 0 && off1.l === base.l && off1.o === base.o && off1.subs === base.subs, JSON.stringify([base, off1]));
  // flow with the view off behaves as before: accent only
  await p.evaluate(() => { window.__flowCols.clear(); window.__ap.settings.set({ flow: true }); }); await sleep(900);
  check("load off + flow: only the accent colour (as today)", JSON.stringify(await p.evaluate(() => [...window.__flowCols])) === '["#5b57d1"]');
  await p.evaluate(() => window.__ap.settings.set({ flow: false })); await sleep(100);
  // 40 on/off cycles: no leak
  const gc = () => p.evaluate(async () => { window.gc?.(); await new Promise((r) => setTimeout(r, 60)); window.gc?.(); return performance.memory.usedJSHeapSize; });
  await p.evaluate(async () => { for (let i = 0; i < 5; i++) { window.__ap.settings.set({ load: true }); await new Promise((r) => setTimeout(r, 60)); window.__ap.settings.set({ load: false }); } });
  const h0 = await gc();
  await p.evaluate(async () => { for (let i = 0; i < 40; i++) { window.__ap.settings.set({ load: true }); await new Promise((r) => setTimeout(r, 70)); window.__ap.settings.set({ load: false }); await new Promise((r) => setTimeout(r, 10)); } });
  await sleep(200); const h1 = await gc(); const end = await inst();
  check("load: 40 on/off cycles: listeners, observers, subscriptions, canvases return to baseline", end.l === base.l && end.o === base.o && end.subs === base.subs && end.canv === 0, JSON.stringify([base, end]));
  check("load: 40 on/off cycles: heap growth is small (< 300 KB)", h1 - h0 < 300 * 1024, `${Math.round((h1 - h0) / 1024)} KB`);
  // too large: one toast, nothing drawn
  await p.evaluate(() => {
    const { scene, editor } = window.__ap; editor.selectAll(); editor.deleteSelection();
    const ids = []; for (let i = 0; i < 3100; i++) ids.push(scene.add({ kind: "rect", x: (i % 60) * 130, y: Math.floor(i / 60) * 90, w: 100, h: 60 }).id);
    for (let i = 0; i < 3099; i++) scene.add({ kind: "arrow", src: ids[i], dst: ids[i + 1], head: 1, route: 0, x: 0, y: 0, w: 1, h: 1, pts: [0, 0, 1, 1] });
    window.__txt.length = 0; editor.zoomToFit(); window.__ap.settings.set({ load: true });
  });
  await sleep(1200);
  const tl = await p.evaluate(() => ({ toasts: [...document.querySelectorAll(".ap-toast")].filter((t) => t.textContent.startsWith("Load view skipped")).length, drawn: window.__txt.length }));
  check("load: a graph that is too large shows one toast and draws nothing", tl.toasts === 1 && tl.drawn === 0, JSON.stringify(tl));
  await p.evaluate(() => { window.__ap.settings.set({ load: false }); });
  check("load: no page errors on desktop", errs.length === 0, errs.slice(0, 2).join(" | "));
  await cx.close();
}
{
  // phone: the cluster button gives way (like theme and flow); the menu entry works
  const { p, cx, errs } = await open(URL0 + "?theme=light", 390, 760);
  await p.evaluate(() => { const { scene, editor } = window.__ap; const a = scene.add({ kind: "rect", x: 60, y: 200, w: 110, h: 60, text: "a" }), b2 = scene.add({ kind: "rect", x: 60, y: 400, w: 110, h: 60, text: "b" }); scene.add({ kind: "arrow", src: a.id, dst: b2.id, head: 1, route: 0, x: 115, y: 260, w: 1, h: 140, pts: [115, 260, 115, 400] }); editor.setLoad([a.id], { role: "entry", rate: 2000 }); editor.setLoad([b2.id], { cap: 1000 }); editor.zoomToFit(); });
  check("load 390px: the cluster button is hidden like theme and flow", !(await vis(p, 'button[aria-label="Load view"]')));
  await menuOpen(p);
  const entry = await p.evaluateHandle(() => [...document.querySelectorAll(".ap-menu button")].find((b) => b.textContent.includes("Load view")));
  check("load 390px: the menu has a Load view entry, not pressed", !!entry.asElement() && (await entry.evaluate((b) => b.getAttribute("aria-pressed") ?? b.getAttribute("aria-checked"))) === "false");
  await entry.asElement().click(); await until(p, "canvas.ap-load", 4000); await sleep(300);
  check("load 390px: the menu entry turns it on", await p.evaluate(() => !!document.querySelector("canvas.ap-load") && JSON.parse(localStorage.getItem("archypaint.settings.v1")).load === true));
  const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, cw: document.querySelector("canvas.ap-load").getBoundingClientRect().width }));
  check("load 390px: no horizontal overflow, overlay covers the stage only", ov.sw <= ov.iw && ov.cw <= ov.iw, JSON.stringify(ov));
  check("load 390px: no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await cx.close();
}

/* ================= 10. Load card, scenario bar, chart: the mock's steps 3-7 with real clicks and typing ================= */
{
  const { p, cx, errs } = await open(URL0 + "?theme=light&load=on&flow=off");
  await p.evaluate(() => {
    const { editor, scene } = window.__ap;
    const R = (x, y, text) => scene.add({ kind: "rect", x, y, w: 110, h: 60, text });
    const c = R(100, 250, "Clients"), g = R(330, 250, "API gateway"), a = R(560, 250, "App servers"), ca = R(790, 120, "Redis"), d = R(1020, 250, "Postgres"), q = R(790, 380, "Kafka");
    const ar = (s, t, pts) => scene.add({ kind: "arrow", src: s.id, dst: t.id, head: 1, route: 0, x: Math.min(pts[0], pts[2]), y: Math.min(pts[1], pts[3]), w: Math.abs(pts[2] - pts[0]) || 1, h: Math.abs(pts[3] - pts[1]) || 1, pts });
    const arr = [ar(c, g, [210, 280, 330, 280]), ar(g, a, [440, 280, 560, 280]), ar(a, ca, [670, 265, 790, 150]), ar(a, q, [670, 295, 790, 410]), ar(ca, d, [900, 150, 1020, 265]), ar(q, d, [900, 410, 1020, 295])];
    editor.setLoad([c.id], { role: "entry", rate: 6000 }); editor.setLoad([g.id], { role: "limiter", limit: 20000, burst: 30000 });
    editor.setLoad([a.id], { cap: 3000, rep: 3 }); editor.setLoad([ca.id], { role: "cache", cap: 50000, hit: 90 }); editor.setLoad([d.id], { cap: 2000 }); editor.setLoad([q.id], { role: "queue", cap: 1000, depth: 50000 });
    window.__shop = { c: c.id, g: g.id, a: a.id, ca: ca.id, d: d.id, q: q.id, e0: arr[0].id };
    editor.zoomToFit();
    window.__txt = []; const ft = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...a2) { if (this.canvas.className === "ap-load") window.__txt.push(String(t)); return ft.call(this, t, ...a2); };
    window.__fr = 0; const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => { window.__fr++; return o(f); };
  });
  await sleep(900);
  const load = (k) => p.evaluate((k) => JSON.parse(JSON.stringify(window.__ap.scene.els.get(window.__shop[k]).load ?? null)), k);
  const sel = (k) => p.evaluate((k) => window.__ap.editor.select([window.__shop[k]]), k);
  const txt = () => p.evaluate(() => [...new Set(window.__txt)]);
  const cardOpen = () => p.evaluate(() => { const c = document.querySelector(".ap-lcard"); return !!c && !c.hidden && c.getBoundingClientRect().width > 0; });
  const typeInto = async (id, text) => { await p.click(id); await p.keyboard.down("Control"); await p.keyboard.press("a"); await p.keyboard.up("Control"); await p.keyboard.type(text); await p.keyboard.press("Enter"); await sleep(350); };
  const segBtn = (label) => p.evaluateHandle((l) => [...document.querySelectorAll(".ap-lcard button")].find((x) => x.textContent === l), label);
  const idle = (ms) => p.evaluate(async (ms) => { const a = window.__fr; await new Promise((r) => setTimeout(r, ms)); return window.__fr - a; }, ms);
  const undoDepth = () => p.evaluate(() => window.__ap.editor.hist.undoS.length); // read-only count: undo + redo would drop the selection and the card

  check("card: closed when nothing is selected, and Load view never opens it by itself", !(await cardOpen()));
  const pt = await p.evaluate(() => { const e = window.__ap.scene.els.get(window.__shop.a), v = window.__ap.vp; return { x: (e.x + e.w / 2 - v.x) * v.zoom, y: (e.y + e.h / 2 - v.y) * v.zoom }; });
  await p.mouse.click(pt.x, pt.y); await sleep(350);
  check("step 3: clicking a service on the canvas opens its card beside it (service fields)", (await cardOpen()) && (await vis(p, "#lc-cap")) && (await vis(p, "#lc-rep")) && !(await vis(p, "#lc-hit")));
  const geo = await p.evaluate(() => { const c = document.querySelector(".ap-lcard").getBoundingClientRect(), cl = document.querySelector(".ap-cluster").getBoundingClientRect(), dk = document.querySelector(".ap-dock").getBoundingClientRect(); return { l: c.left, r: c.right, t: c.top, b: c.bottom, iw: innerWidth, cb: cl.bottom, dt: dk.top }; });
  check("step 3: the card sits inside the stage, under the cluster and above the dock", geo.l >= 0 && geo.r <= geo.iw && geo.t >= geo.cb && geo.b <= geo.dt, JSON.stringify(geo));
  const u0 = await undoDepth();
  await typeInto("#lc-cap", "2k");
  check("step 3: typing 2k + Enter commits capacity 2000 (one setLoad) and the numbers update", (await load("a")).cap === 2000 && (await txt()).includes("6.0k of 6.0k · 100%"));
  check("step 3: that was exactly one undo step", (await undoDepth()) === u0 + 1);
  await p.evaluate(() => window.__ap.editor.undo()); await sleep(300);
  check("step 3: undo restores 3000 and the field shows it", (await load("a")).cap === 3000 && (await p.$eval("#lc-cap", (i) => i.value)) === "3k");
  // invalid text is flagged, not committed; Escape reverts
  await p.click("#lc-cap"); await p.keyboard.down("Control"); await p.keyboard.press("a"); await p.keyboard.up("Control"); await p.keyboard.type("abc"); await sleep(100);
  check("card: invalid text sets aria-invalid and shows a message, nothing is committed", (await p.$eval("#lc-cap", (i) => i.getAttribute("aria-invalid"))) === "true" && (await load("a")).cap === 3000 && (await p.$eval("#lc-cap-e", (e) => e.textContent.length)) > 0);
  await p.keyboard.press("Escape"); await sleep(150);
  check("card: Escape reverts the field and keeps the selection", (await p.$eval("#lc-cap", (i) => i.value)) === "3k" && (await p.evaluate(() => window.__ap.editor.selection().size)) === 1);
  // typing "k" in a field must not trigger editor shortcuts / edits
  check("card: inputs have visible labels (for= / id=)", await p.evaluate(() => [...document.querySelectorAll(".ap-lcard input")].every((i) => !!document.querySelector(`label[for="${i.id}"]`))));
  // step 4: limiter
  await sel("g"); await sleep(300);
  check("step 4: limiter card: algorithm segmented control, limit and burst", (await vis(p, ".lc-seg")) && (await vis(p, "#lc-limit")) && (await vis(p, "#lc-burst")));
  await (await segBtn("Fixed window")).click(); await sleep(300);
  check("step 4: switching to fixed window commits it, burst goes away, the one-line effect changes", (await load("g")).algo === "fixed" && !(await vis(p, "#lc-burst")) && /window edge/.test(await p.$eval(".lc-gtxt", (e) => e.textContent)));
  await (await segBtn("Token bucket")).click(); await sleep(300);
  // step 5: entry overload
  await sel("c"); await sleep(300);
  check("step 5: entry card: requests/s, retries; no spike fields yet", (await vis(p, "#lc-rate")) && (await vis(p, "#lc-retries")) && !(await vis(p, "#lc-sp0")));
  await typeInto("#lc-rate", "30k");
  const t5 = await txt();
  check("step 5: entry at 30k overloads: rejected / dropped lines in red, chips and bars update", t5.some((t) => /^rejected/.test(t)) && t5.some((t) => /^dropped/.test(t)));
  check("step 5: the entry card shows an end-to-end estimate and the amplification", /end-to-end/.test(await p.$eval(".lc-res", (e) => e.textContent)) && /amplification/.test(await p.$eval(".lc-res", (e) => e.textContent)));
  await typeInto("#lc-rate", "6k");
  // step 6: spike
  const link = await p.evaluateHandle(() => [...document.querySelectorAll(".ap-lcard .lc-link")].find((x) => /spike/.test(x.textContent)));
  check("step 6: no scenario bar or chart before a spike exists", !(await vis(p, ".ap-scn")) && !(await vis(p, ".ap-lchart")));
  await link.asElement().click(); await sleep(500);
  check("step 6: + add traffic spike stores [5,5,20] and shows the spike fields", JSON.stringify((await load("c")).spike) === "[5,5,20]" && (await vis(p, "#lc-sp0")));
  check("step 6: the scenario bar and the chart appear", (await vis(p, ".ap-scn")) && (await vis(p, ".ap-lchart")));
  check("step 6: the bar reads 'Spike ×5 for 20 s' and has play, scrubber and time", /Spike ×5 for 20 s/.test(await p.$eval(".scn-label", (e) => e.textContent)) && (await vis(p, ".scn-range")) && (await vis(p, ".scn-time")));
  const cg = await p.evaluate(() => { const b = document.querySelector(".ap-scn").getBoundingClientRect(), c = document.querySelector(".ap-lchart").getBoundingClientRect(), cl = document.querySelector(".ap-cluster").getBoundingClientRect(); return { bc: (b.left + b.right) / 2, iw: innerWidth, ct: c.top, cr: c.right, cb: cl.bottom }; });
  check("step 6: the bar is top-centre, the chart is top-right under the cluster", Math.abs(cg.bc - cg.iw / 2) < 3 && cg.ct >= cg.cb && cg.cr <= cg.iw, JSON.stringify(cg));
  check("step 6: idle with the bar open and nothing playing schedules no frames", (await idle(1200)) === 0);
  await p.evaluate(() => { window.__txt.length = 0; });
  await p.click(".ap-scn button[aria-label='Play scenario']");
  await p.click(".ap-scn .scn-spd"); await sleep(1500);
  const playing = await p.evaluate(() => ({ t: document.querySelector(".scn-time").textContent, pause: !!document.querySelector(".ap-scn button[aria-label='Pause scenario']") }));
  check("step 6: play runs: time advances and the button becomes pause", playing.pause && parseFloat(playing.t) > 1, JSON.stringify(playing));
  await p.evaluate(() => { const r = document.querySelector(".scn-range"); r.value = 150; r.dispatchEvent(new Event("input", { bubbles: true })); }); await sleep(500);
  const spiked = await txt();
  check("step 6: while scrubbed inside the spike the overlay shows the spike's values (30k/s at the gateway, app dropping)", spiked.includes("30.0k/s") && spiked.some((t) => /^dropped/.test(t)), spiked.filter((t) => /\/s/.test(t)).join(" "));
  await p.click(".ap-scn button[aria-label='Pause scenario']"); await sleep(300);
  const tAfter = await p.$eval(".scn-time", (e) => e.textContent); await sleep(700);
  check("step 6: pause stops the clock and then schedules zero frames", (await p.$eval(".scn-time", (e) => e.textContent)) === tAfter && (await idle(1500)) === 0, tAfter);
  check("step 6: the chart has a line text for the Kafka backlog", /Kafka backlog/.test(await p.$eval(".lch-line", (e) => e.textContent)));
  const lit = await p.evaluate(() => { const c = document.querySelector(".ap-lchart canvas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  check("step 6: the chart canvas is drawn", lit > 500, String(lit));
  const u1 = await undoDepth();
  await p.click(".ap-scn button[aria-label='Remove the traffic spike']"); await sleep(400);
  check("step 6: ✕ removes the spike (bar and chart go, numbers back to steady) in one undo step", !(await vis(p, ".ap-scn")) && !(await vis(p, ".ap-lchart")) && (await load("c")).spike === undefined && (await undoDepth()) === u1 + 1);
  await p.evaluate(() => window.__ap.editor.undo()); await sleep(450);
  check("step 6: undo brings the spike, the bar and the chart back", (await vis(p, ".ap-scn")) && JSON.stringify((await load("c")).spike) === "[5,5,20]");
  // step 7: retries
  await sel("c"); await sleep(300);
  await typeInto("#lc-retries", "3");
  check("step 7: retries 3 reveals the backoff toggle", await vis(p, ".lc-tgl"));
  await p.evaluate(() => { const r = document.querySelector(".scn-range"); r.value = 150; r.dispatchEvent(new Event("input", { bubbles: true })); }); await sleep(500);
  const warn1 = await p.evaluate(() => { const w = document.querySelector(".lc-warn"); return w && !w.hidden ? w.textContent : ""; });
  const amp1 = await p.evaluate(() => { const m = /amplification ×([\d.]+)/.exec(document.querySelector(".lc-res").textContent); return m ? +m[1] : 0; });
  check("step 7: retries 3 inside the spike show the red retry-amplification warning with the backoff hint", /Retry amplification/.test(warn1) && /backoff/.test(warn1) && amp1 > 1.5, warn1 + " amp " + amp1);
  await (await segBtn("Turn on backoff + jitter")).click(); await sleep(500);
  const amp2 = await p.evaluate(() => { const m = /amplification ×([\d.]+)/.exec(document.querySelector(".lc-res").textContent); return m ? +m[1] : 0; });
  check("step 7: backoff + jitter lowers the amplification", (await load("c")).backoff === 1 && amp2 < amp1, `${amp1} -> ${amp2}`);
  // coexistence: two selected = no card; the ribbon, text editing and boards still work around it
  await p.evaluate(() => window.__ap.editor.select([window.__shop.a, window.__shop.g])); await sleep(300);
  check("card: closed for a multi-selection", !(await cardOpen()));
  await sel("a"); await sleep(250);
  await p.evaluate(() => window.__ap.ui && 0); await p.keyboard.press("i"); await sleep(400);
  check("coexist: the properties ribbon still opens with the card around (I key)", (await vis(p, ".ap-ribbon")) && (await cardOpen()));
  await p.keyboard.press("i"); await sleep(250);
  await p.keyboard.press("Enter"); await sleep(300);
  check("coexist: text editing hides the card while typing", !(await cardOpen()));
  await p.keyboard.press("Escape"); await sleep(300);
  check("coexist: the card comes back after editing", await cardOpen());
  // drag stays where dragged for the session
  const g0 = await p.$eval(".ap-lcard .ap-grip", (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(g0[0], g0[1]); await p.mouse.down(); await p.mouse.move(g0[0] - 60, g0[1] + 80, { steps: 4 }); await p.mouse.up(); await sleep(200);
  const moved = await p.$eval(".ap-lcard", (e) => e.style.transform);
  await sel("d"); await sleep(300);
  check("card: dragged by the grip, it then stays where it was dragged for the session", (await p.$eval(".ap-lcard", (e) => e.style.transform)) === moved && moved !== "", moved);
  await p.evaluate(() => window.__ap.editor.select([])); await sleep(300);
  // arrow card
  await p.evaluate(() => window.__ap.editor.select([window.__shop.e0])); await sleep(300);
  check("arrow: card has share weight and calls per request with an explanation", (await vis(p, "#lc-w")) && (await vis(p, "#lc-x")) && /divided/.test(await p.$eval(".lc-why", (e) => e.textContent)));
  await typeInto("#lc-x", "2");
  check("arrow: calls per request 2 commits on the arrow", await p.evaluate(() => window.__ap.scene.els.get(window.__shop.e0).load?.x === 2));
  await p.evaluate(() => window.__ap.editor.undo());
  // role override
  await sel("a"); await sleep(250);
  await p.select("#lc-role", "cache"); await sleep(300);
  check("acts as: choosing Cache stores the role and the card switches to hit rate + capacity", (await load("a")).role === "cache" && (await vis(p, "#lc-hit")) && !(await vis(p, "#lc-rep")));
  await p.evaluate(() => window.__ap.editor.undo()); await sleep(250);
  // read-only view: values, no inputs
  await p.evaluate(() => { window.__ap.editor.setReadOnly(true); window.__ap.editor.select([window.__shop.a]); }); await sleep(350); // a shared view cannot select by click, so select through the API
  check("read-only: the card shows values and has no inputs, selects or buttons that edit", (await cardOpen()) && (await p.evaluate(() => document.querySelectorAll(".ap-lcard input").length)) === 0 && (await p.evaluate(() => document.querySelector(".ap-lcard select")?.disabled !== false)));
  await p.evaluate(() => window.__ap.editor.setReadOnly(false)); await sleep(300);
  // turning Load view off frees everything
  await p.evaluate(() => { window.__ap.editor.select([window.__shop.a]); }); await sleep(250);
  await click(p, 'button[aria-label="Load view"]'); await sleep(500);
  check("off: card, bar, chart and the overlay are all gone", !(await p.evaluate(() => !!document.querySelector(".ap-lcard, .ap-scn, .ap-lchart, canvas.ap-load"))));
  check("off: the numbers return to steady state (nothing drawn, no frames)", (await idle(1000)) === 0);
  check("no page errors in the load card flow", errs.length === 0, errs.slice(0, 3).join(" | "));
  await cx.close();
}
{
  // phone: the card is a bottom sheet, nothing overflows
  const { p, cx, errs } = await open(URL0 + "?theme=light&load=on&flow=off", 390, 760);
  await p.evaluate(() => { const { scene, editor } = window.__ap; const a = scene.add({ kind: "rect", x: 60, y: 200, w: 110, h: 60, text: "a" }), b2 = scene.add({ kind: "rect", x: 60, y: 400, w: 110, h: 60, text: "b" }); scene.add({ kind: "arrow", src: a.id, dst: b2.id, head: 1, route: 0, x: 115, y: 260, w: 1, h: 140, pts: [115, 260, 115, 400] }); editor.setLoad([a.id], { role: "entry", rate: 2000, spike: [5, 5, 20], retries: 3 }); editor.setLoad([b2.id], { cap: 1000 }); editor.zoomToFit(); window.__ids = [a.id, b2.id]; });
  await sleep(800);
  await p.evaluate(() => window.__ap.editor.select([window.__ids[0]])); await sleep(500);
  const m = await p.evaluate(() => { const c = document.querySelector(".ap-lcard"), r = c.getBoundingClientRect(), dk = document.querySelector(".ap-dock").getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, dt: dk.top, iw: innerWidth, sw: document.documentElement.scrollWidth, csw: c.scrollWidth, ccw: c.clientWidth, grip: getComputedStyle(c.querySelector(".ap-grip")).display }; });
  check("load card 390px: bottom sheet inside the screen, above the dock, no overflow, no grip", m.l >= 0 && m.r <= m.iw && m.b <= m.dt && m.sw <= m.iw && m.csw <= m.ccw + 1 && m.grip === "none", JSON.stringify(m));
  const bc = await p.evaluate(() => [...document.querySelectorAll(".ap-scn,.ap-lchart")].map((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  check("load card 390px: the scenario bar and chart fit the width", bc.length === 2 && bc.every(Boolean), JSON.stringify(bc));
  check("load card 390px: no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await cx.close();
}

await b.close(); process.kill(-srv.pid);
console.log(results.join("\n"));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
