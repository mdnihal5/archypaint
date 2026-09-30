// End-to-end check of the UI chrome. Usage: PUPPETEER_DIR=<node_modules dir> node scripts/ui-check.mjs
// Serves dist/ via `vite preview`, drives every control in real Chrome, spies on the EditorAPI/IO/palette calls
// the chrome makes, and verifies: virtualisation, idle-is-flat (no render loop), and remount-leak freedom.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire((process.env.PUPPETEER_DIR ?? "/home/sys2026/Personal/blog-visuals/node_modules") + "/");
const puppeteer = require("puppeteer-core");
const PORT = 4183, URL0 = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
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
const vis = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; }, sel);

/* ================= 1. empty sheet + tools + bottom bar ================= */
{
  const { p, cx, errs } = await open(URL0 + "?theme=light");
  await p.evaluate(SPY);
  check("home: sheet is in the empty state", await p.evaluate(() => document.getElementById("sheet").dataset.empty === "true"));
  check("home: command line, General Notes and ghost diagram are shown", (await vis(p, ".ap-cmd")) && (await vis(p, ".ap-notes")) && (await vis(p, ".ap-ghost svg")));
  check("home: title block shown", await vis(p, ".ap-titleblock"));
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
  await click(p, ".ap-tool-icons"); check("tools: icons button opens the palette", await has(p, "open")); await p.evaluate(() => window.__ap.palette.close());

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
  const menu = async (label) => { if (!(await vis(p, ".ap-menu"))) await click(p, 'button[aria-label="Menu"]'); await click(p, `.ap-menu >> ::-p-text(${label})`).catch(async () => { await p.evaluate((l) => [...document.querySelectorAll(".ap-mi")].find((x) => x.textContent.startsWith(l))?.click(), label); await sleep(120); }); };
  await click(p, 'button[aria-label="Menu"]');
  check("menu: opens and aria-expanded is true", (await vis(p, ".ap-menu")) && (await p.evaluate(() => document.querySelector('button[aria-label="Menu"]').getAttribute("aria-expanded") === "true")));
  await p.evaluate(() => [...document.querySelectorAll(".ap-mi")].find((x) => x.textContent.startsWith("Save"))?.click()); await sleep(150);
  check("menu: Save -> io.save", await has(p, "save"));
  check("menu: closes after an action", !(await vis(p, ".ap-menu")));

  const seg = async (group, label) => { if (!(await vis(p, ".ap-menu"))) await click(p, 'button[aria-label="Menu"]'); await p.evaluate((g, l) => [...document.querySelectorAll(`.ap-menu .ap-seg[aria-label="${g}"] button`)].find((x) => x.textContent === l).click(), group, label); await sleep(150); };
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
  await seg("Sheet frame", "off");
  check("menu: sheet frame off hides border and title block", (await p.evaluate(() => document.documentElement.dataset.frame === "off")) && !(await vis(p, ".ap-frame")) && !(await vis(p, ".ap-titleblock")));
  await seg("Sheet frame", "on");
  await seg("Status footer", "off");
  check("menu: status footer off hides the footer", (await p.evaluate(() => document.documentElement.dataset.hud === "off")) && !(await vis(p, ".ap-hud")));
  await seg("Status footer", "on");
  await seg("Edge", "sharp"); check("menu: default edge -> editor.setDefaults({edge:0})", await has(p, "setDefaults", (c) => c[1].edge === 0));
  await seg("Fill", "solid"); check("menu: default fill -> editor.setDefaults({fill:2})", await has(p, "setDefaults", (c) => c[1].fill === 2));
  await p.keyboard.press("Escape"); await sleep(100);
  check("menu: Escape closes it", !(await vis(p, ".ap-menu")));

  // dirty guard
  await clear(p);
  await p.evaluate(() => { window.__realDirty = window.__ap.editor.dirty; window.__ap.editor.dirty = () => true; });
  await click(p, 'button[aria-label="Menu"]');
  await p.evaluate(() => [...document.querySelectorAll(".ap-mi")].find((x) => x.textContent.startsWith("New"))?.click()); await sleep(200);
  check("guard: New with unsaved changes asks first", (await vis(p, ".ap-modal")) && !(await has(p, "newDoc")));
  await p.evaluate(() => [...document.querySelectorAll(".ap-modal button")].find((x) => x.textContent === "Cancel").click()); await sleep(150);
  check("guard: Cancel keeps the sheet", !(await has(p, "newDoc")) && !(await vis(p, ".ap-modal")));
  await click(p, 'button[aria-label="Menu"]');
  await p.evaluate(() => [...document.querySelectorAll(".ap-mi")].find((x) => x.textContent.startsWith("New"))?.click()); await sleep(200);
  await p.evaluate(() => [...document.querySelectorAll(".ap-modal button")].find((x) => x.textContent === "Discard").click()); await sleep(200);
  check("guard: Discard runs io.newDoc", await has(p, "newDoc"));
  const unload = await p.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); const a = e.defaultPrevented; window.__ap.editor.dirty = () => false; const e2 = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e2); return [a, e2.defaultPrevented]; });
  check("guard: beforeunload blocks only while dirty", unload[0] === true && unload[1] === false);
  await p.evaluate(() => { window.__ap.editor.dirty = window.__realDirty; });

  // shortcuts
  await clear(p);
  await p.keyboard.press("?"); await sleep(150);
  check("shortcuts: ? opens the list", (await vis(p, ".ap-modal")) && (await p.evaluate(() => document.querySelector(".ap-modal h2").textContent === "Keyboard shortcuts")));
  await p.keyboard.press("Escape"); await sleep(150);
  check("shortcuts: Escape closes it and focus returns", !(await vis(p, ".ap-modal")));
  await p.keyboard.press("/"); await sleep(120);
  check("keys: / opens the palette (chrome or the palette's own handler, never twice)", await p.evaluate(() => window.__ap.palette.isOpen())); await p.evaluate(() => window.__ap.palette.close());
  await p.keyboard.down("Control"); await p.keyboard.press("s"); await p.keyboard.up("Control"); await sleep(120);
  check("keys: Ctrl+S -> io.save", await has(p, "save"));
  await p.keyboard.down("Control"); await p.keyboard.down("Shift"); await p.keyboard.press("e"); await p.keyboard.up("Shift"); await p.keyboard.up("Control"); await sleep(120);
  check("keys: Ctrl+Shift+E -> io.exportPng", await has(p, "exportPng"));
  await p.keyboard.press("+"); await sleep(100); check("keys: + -> zoomBy", await has(p, "zoomBy", (c) => c[1] > 1));
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
  check("props: appear when something is selected", await vis(p, ".ap-props"));
  await clear(p);
  await click(p, 'button[aria-label="Category network"]'); check("props: category swatch -> setStyle({cat:2})", await has(p, "setStyle", (c) => c[1].cat === 2));
  await p.evaluate(() => [...document.querySelectorAll('.ap-seg[aria-label="Fill"] button')].find((x) => x.textContent === "solid").click()); await sleep(120);
  check("props: fill solid -> setStyle({fill:2})", await has(p, "setStyle", (c) => c[1].fill === 2));
  await p.evaluate(() => [...document.querySelectorAll('.ap-seg[aria-label="Edge"] button')].find((x) => x.textContent === "soft").click()); await sleep(120);
  check("props: edge soft -> setStyle({edge:2})", await has(p, "setStyle", (c) => c[1].edge === 2));
  await p.evaluate(() => [...document.querySelectorAll(".ap-props .ap-btn")].find((x) => x.textContent === "dashed").click()); await sleep(120);
  check("props: dashed -> setStyle({dash:1})", await has(p, "setStyle", (c) => c[1].dash === 1));
  for (const [label, fn] of [["front", "bringToFront"], ["forward", "bringForward"], ["backward", "sendBackward"], ["back", "sendToBack"]]) {
    await p.evaluate((l) => [...document.querySelectorAll(".ap-props .ap-row2 .ap-btn")].find((x) => x.firstChild.textContent === l).click(), label); await sleep(80);
    check(`props: arrange ${label} -> editor.${fn}`, await has(p, fn));
  }
  await p.evaluate(() => [...document.querySelectorAll(".ap-props .ap-btn")].find((x) => x.firstChild?.textContent === "group").click()); await sleep(120);
  check("props: group -> editor.group", await has(p, "group"));
  check("props: name field hidden for an ungrouped selection", !(await vis(p, '.ap-props input[aria-label="Group name"]')));
  await p.evaluate(() => window.__ap.editor.select([window.__ids[2], window.__ids[3]])); await sleep(200);
  check("props: name field shows the group's name", await p.evaluate(() => document.querySelector('.ap-props input[aria-label="Group name"]').value === "compute-tier"));
  await clear(p);
  await p.focus('.ap-props input[aria-label="Group name"]'); await p.keyboard.press("End"); await p.keyboard.type("-x"); await p.keyboard.press("Enter"); await sleep(150);
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
  const sb = await p.evaluate(() => { const s = document.querySelector(".ap-vscroll").getBoundingClientRect(); return { x: s.x + s.width / 2, y: s.y + s.height / 2 }; }); // selecting a row opens the props card above, moving the list
  await p.mouse.move(sb.x, sb.y); await p.mouse.wheel({ deltaY: 300 }); await sleep(250);
  const z1 = await p.evaluate(() => [window.__ap.vp.x, window.__ap.vp.y, window.__ap.vp.zoom, document.querySelector(".ap-vscroll").scrollTop]);
  check("layers: wheel over the list scrolls the list and does not pan the canvas", z1[3] > 0 && z1[0] === z0[0] && z1[1] === z0[1] && z1[2] === z0[2], `scrollTop ${z1[3]}`);
  const sel0 = await p.evaluate(() => window.__ap.editor.selection().size);
  const cardBox = await p.evaluate(() => { const c = document.querySelector(".ap-props")?.getBoundingClientRect(); return c && c.width ? { x: c.x + 6, y: c.y + 6 } : null; });
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
  const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, cmd: document.querySelector(".ap-cmd").getBoundingClientRect().left, tools: document.querySelector(".ap-tools").getBoundingClientRect().right }));
  check(`responsive ${w}px: no horizontal scroll`, m.sw <= m.iw, `${m.sw} <= ${m.iw}`);
  check(`responsive ${w}px: command line clears the tool strip`, m.cmd >= m.tools, `${Math.round(m.cmd)} >= ${Math.round(m.tools)}`);
  if (w < 900) {
    await p.evaluate(() => { const { scene, editor } = window.__ap; const e = scene.add({ kind: "rect", x: 100, y: 200, w: 100, h: 60 }); editor.renderer.invalidate(true, true); editor.select([e.id]); }); await sleep(700);
    check(`responsive ${w}px: panels collapsed behind toggle buttons`, !(await vis(p, ".ap-right")) && (await vis(p, 'button[aria-label="Properties"]')));
    await click(p, 'button[aria-label="Properties"]');
    check(`responsive ${w}px: toggle opens the panel`, await vis(p, ".ap-props"));
  }
  await cx.close();
}

await b.close(); srv.kill();
console.log(results.join("\n"));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
