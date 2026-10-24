// Drives the real app with real mouse/keyboard events and asserts behaviour + leak-freedom.
// Usage: PUPPETEER_DIR=<node_modules dir> node perf/interact.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire((process.env.PUPPETEER_DIR ?? "/home/sys2026/Personal/blog-visuals/node_modules") + "/");
const puppeteer = require("puppeteer-core");
const PORT = 4181;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ } await sleep(200); }
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
let failed = false;
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`http://localhost:${PORT}/?theme=light`);
  await p.waitForFunction(() => window.__ap && window.__ap.ui);
  await sleep(800);
  const ed = (fn, ...a) => p.evaluate(`(${fn.toString()})(window.__ap.editor, ...${JSON.stringify(a)})`);
  const stageBox = await p.evaluate(() => { const r = document.getElementById("stage").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = stageBox.x + stageBox.w / 2, cy = stageBox.y + stageBox.h / 2;
  const drag = async (x0, y0, x1, y1, opts = {}) => {
    await p.mouse.move(x0, y0); await p.mouse.down(opts);
    await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 3 }); await p.mouse.move(x1, y1, { steps: 4 }); await p.mouse.up(opts); await sleep(30);
  };
  const cnt = (kind) => ed((e, k) => [...e.scene.els.values()].filter((x) => x.kind === k).length, kind);

  // draw two shapes with the keyboard tool shortcuts and real drags
  // a freshly drawn shape stays selected, and typing then starts editing its label: clear the selection so the next tool letter is a tool letter
  await p.keyboard.press("r"); await drag(cx - 300, cy - 100, cx - 180, cy - 20); await sleep(60); await ed((e) => e.clearSelection());
  await p.keyboard.press("o"); await drag(cx + 150, cy + 60, cx + 290, cy + 140); await sleep(60); await ed((e) => e.clearSelection());
  check("draw rect + ellipse", (await cnt("rect")) === 1 && (await cnt("ellipse")) === 1, JSON.stringify(await ed((e) => [...e.scene.els.values()].map((x) => [x.kind, x.x, x.y]))));

  // connect with an arrow
  await p.keyboard.press("a"); await drag(cx - 240, cy - 60, cx + 220, cy + 100);
  const arrow = await ed((e) => { const a = [...e.scene.els.values()].find((x) => x.kind === "arrow"); return a ? { src: a.src, dst: a.dst, y: a.pts[1], x: a.pts[0] } : null; });
  const ids = await ed((e) => ({ rect: [...e.scene.els.values()].find((x) => x.kind === "rect").id, ell: [...e.scene.els.values()].find((x) => x.kind === "ellipse").id }));
  check("arrow bound to both shapes", arrow && arrow.src === ids.rect && arrow.dst === ids.ell);

  // move the rectangle; the arrow follows
  await p.keyboard.press("v"); await drag(cx - 260, cy - 80, cx - 260, cy - 260);
  const arrow2 = await ed((e) => { const a = [...e.scene.els.values()].find((x) => x.kind === "arrow"); return { y: a.pts[1], src: a.src }; });
  check("arrow follows moved shape", arrow2.src === ids.rect && arrow2.y < arrow.y - 100, `start y ${arrow.y} -> ${arrow2.y}`);

  // group / ungroup with shortcuts, undo / redo
  await p.keyboard.down("Control"); await p.keyboard.press("a"); await p.keyboard.press("g"); await p.keyboard.up("Control");
  check("group via Ctrl+G", (await ed((e) => e.scene.groups.size)) === 1);
  await p.keyboard.down("Control"); await p.keyboard.down("Shift"); await p.keyboard.press("g"); await p.keyboard.up("Shift"); await p.keyboard.up("Control");
  check("ungroup via Ctrl+Shift+G", (await ed((e) => e.scene.groups.size)) === 0);
  await p.keyboard.down("Control"); await p.keyboard.press("z"); await p.keyboard.up("Control");
  check("undo restores the group", (await ed((e) => e.scene.groups.size)) === 1);
  await p.keyboard.down("Control"); await p.keyboard.down("Shift"); await p.keyboard.press("z"); await p.keyboard.up("Shift"); await p.keyboard.up("Control");
  check("redo", (await ed((e) => e.scene.groups.size)) === 0);

  // 200 undo/redo cycles: state identical afterwards and heap flat
  const cyc = await p.evaluate(async () => {
    const e = window.__ap.editor;
    const norm = () => JSON.stringify(e.scene.toJSON(), (k, v) => (k === "version" ? undefined : v));
    e.selectAll();
    for (let i = 0; i < 30; i++) e.setStyle({ cat: i % 8, fill: i % 3 });
    const final = norm();
    const heap = async () => { window.gc?.(); await new Promise((r) => setTimeout(r, 40)); window.gc?.(); return performance.memory.usedJSHeapSize; };
    for (let i = 0; i < 30; i++) e.undo();
    for (let i = 0; i < 30; i++) e.redo();
    const h0 = await heap();
    for (let c = 0; c < 200; c++) { for (let i = 0; i < 30; i++) e.undo(); for (let i = 0; i < 30; i++) e.redo(); }
    const h1 = await heap();
    return { same: norm() === final, growthKB: Math.round((h1 - h0) / 1024) };
  });
  check("200 undo/redo cycles keep the document identical", cyc.same);
  check("heap flat after 200 undo/redo cycles (< 300 KB growth)", cyc.growthKB < 300, `${cyc.growthKB} KB`);

  // ---- editing features: flyout, badges, frames, align, find, minimap (real mouse + keyboard) ----
  await ed((e) => { e.load({ els: [], groups: [] }); e.resetView(); });
  await sleep(100);
  const click = async (x, y) => { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up(); await sleep(30); };
  const q = (sel) => p.$(sel);

  await (await q("button[aria-label='More shapes']")).click();
  await sleep(100);
  check("shapes flyout opens", !!(await q(".ap-flyout")));
  await (await q(".ap-fi[aria-label='Database']")).click();
  check("flyout closes after picking; tool is the shape", !(await q(".ap-flyout")) && (await ed((e) => e.tool)) === "cylinder");
  await click(cx - 350, cy - 150);
  check("clicking the canvas places the database drum", (await cnt("cylinder")) === 1 && (await ed((e) => e.tool)) === "select");

  // step badges auto-number; renumber through the flyout command
  for (let i = 0; i < 3; i++) { await ed((e) => e.setTool("badge")); await click(cx - 300 + i * 90, cy + 250); }
  const nums = await ed((e) => [...e.scene.els.values()].filter((x) => x.kind === "badge").map((x) => x.n));
  check("badges auto-increment 1, 2, 3", JSON.stringify(nums) === "[1,2,3]", JSON.stringify(nums));
  await click(cx - 210, cy + 250); await p.keyboard.press("Delete"); await sleep(50);
  await (await q("button[aria-label='More shapes']")).click();
  await (await q(".ap-fi[aria-label='Renumber badges']")).click(); await sleep(60);
  const nums2 = await ed((e) => [...e.scene.els.values()].filter((x) => x.kind === "badge").map((x) => x.n).sort());
  check("renumber closes the gap", JSON.stringify(nums2) === "[1,2]", JSON.stringify(nums2));

  // a frame carries what is inside it and leaves the rest alone
  const settle = async () => { await sleep(60); await ed((e) => e.clearSelection()); }; // typing on a selected shape edits its label, so clear it before a tool letter
  await ed((e) => e.setTool("frame")); await drag(cx - 250, cy - 200, cx + 150, cy + 100); await settle();
  await p.keyboard.press("r"); await drag(cx - 200, cy - 120, cx - 100, cy - 60); await settle();
  await p.keyboard.press("r"); await drag(cx + 250, cy - 100, cx + 330, cy - 40); await settle();
  const pos = () => ed((e) => { const r = [...e.scene.els.values()].filter((x) => x.kind === "rect"); return { inn: [r[0].x, r[0].y], out: [r[1].x, r[1].y], f: (([f]) => [f.x, f.y])([...e.scene.els.values()].filter((x) => x.kind === "frame")) }; });
  const before = await pos();
  const zOk = await ed((e) => { const f = [...e.scene.els.values()].find((x) => x.kind === "frame"); return [...e.scene.els.values()].filter((x) => x.kind === "rect").every((r) => r.z > f.z); });
  check("frame sits behind its contents", zOk);
  await ed((e) => e.clearSelection());
  await drag(cx, cy - 188, cx + 50, cy - 158);
  const after = await pos();
  check("dragging the frame header moves the shape inside by the same amount", after.inn[0] - before.inn[0] === 50 && after.inn[1] - before.inn[1] === 30 && after.f[0] - before.f[0] === 50, `${JSON.stringify(before.inn)} -> ${JSON.stringify(after.inn)}`);
  check("the shape outside the frame stayed", after.out[0] === before.out[0] && after.out[1] === before.out[1]);

  // align through the properties ribbon (opened with I: it never opens by itself; its code loads on that first open)
  await ed((e) => { const r = [...e.scene.els.values()].filter((x) => x.kind === "rect"); e.select(r.map((x) => x.id)); });
  await sleep(150);
  check("the ribbon is not in the DOM before it is asked for", !(await q(".ap-ribbon")));
  await p.keyboard.press("i"); await p.waitForSelector(".ap-ribbon", { visible: true, timeout: 3000 }); await sleep(150);
  await (await q("button[aria-label^='Align left']")).click(); await sleep(60);
  const xs = await ed((e) => [...e.scene.els.values()].filter((x) => x.kind === "rect").map((x) => x.x));
  check("panel: align left lines the shapes up", xs.length === 2 && xs[0] === xs[1], JSON.stringify(xs));
  await p.keyboard.down("Control"); await p.keyboard.press("z"); await p.keyboard.up("Control");
  const xs2 = await ed((e) => [...e.scene.els.values()].filter((x) => x.kind === "rect").map((x) => x.x));
  check("align is one undo step", xs2[0] !== xs2[1]);

  // find bar
  await ed((e) => { const r = [...e.scene.els.values()].filter((x) => x.kind === "rect"); e.scene.patch(r[0], { text: "billing api" }); e.scene.patch(r[1], { text: "billing db" }); e.clearSelection(); });
  await p.keyboard.down("Control"); await p.keyboard.press("f"); await p.keyboard.up("Control"); await sleep(100);
  check("Ctrl+F opens the find bar and focuses it", await p.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Find"));
  await p.keyboard.type("billing"); await sleep(120);
  const c1 = await p.evaluate(() => document.querySelector(".ap-find-count")?.textContent);
  check("find counts matches live", c1 === "1/2", c1);
  await p.keyboard.press("Enter"); await sleep(60);
  check("Enter cycles to the next match", (await p.evaluate(() => document.querySelector(".ap-find-count")?.textContent)) === "2/2");
  await p.keyboard.down("Shift"); await p.keyboard.press("Enter"); await p.keyboard.up("Shift"); await sleep(60);
  check("Shift+Enter goes back", (await p.evaluate(() => document.querySelector(".ap-find-count")?.textContent)) === "1/2");
  check("matches are highlighted and the match is selected", (await ed((e) => e.renderer.hi.length)) === 2 && (await ed((e) => e.selection().size)) === 1);
  await p.keyboard.press("Escape"); await sleep(60);
  check("Escape closes the bar and clears highlights", (await ed((e) => e.renderer.hi.length)) === 0 && !(await p.evaluate(() => !!document.querySelector(".ap-find:not([hidden])"))));

  await p.keyboard.press("i"); await sleep(100); // close the ribbon again
  // minimap: out of the way while the whole diagram is in view, then visible, navigates, toggles with M
  await ed((e) => { e.clearSelection(); e.zoomToFit(); }); await p.evaluate(() => window.__ap.ui.refresh()); await sleep(250);
  check("minimap stays hidden while the whole diagram fits the window", await p.evaluate(() => document.querySelector(".ap-mini").hidden));
  await ed((e) => { e.scene.add({ kind: "rect", x: 3600, y: 2600, w: 100, h: 60 }); e.vp.reset(); e.zoomBy(1); }); await p.evaluate(() => window.__ap.ui.refresh()); await sleep(300);
  const mini = await q(".ap-mini canvas");
  check("minimap shows once the diagram is larger than the window", !!mini && await p.evaluate(() => !document.querySelector(".ap-mini").hidden));
  const box = await mini.boundingBox();
  const c0 = await ed((e) => [e.vp.x, e.vp.y]);
  await click(box.x + box.width * 0.85, box.y + box.height * 0.8); await sleep(100);
  const c2 = await ed((e) => [e.vp.x, e.vp.y]);
  check("clicking the minimap moves the view", c2[0] !== c0[0] || c2[1] !== c0[1], `${c0} -> ${c2}`);
  await p.keyboard.press("m"); await sleep(120);
  check("M hides the minimap (the setting stays toggleable)", await p.evaluate(() => document.querySelector(".ap-mini").hidden));
  await p.keyboard.press("m"); await sleep(150);
  check("M shows it again", await p.evaluate(() => !document.querySelector(".ap-mini").hidden));

  // lock through the panel: cannot move
  await ed((e) => { e.resetView(); const r = [...e.scene.els.values()].find((x) => x.kind === "rect"); e.select([r.id]); });
  await sleep(100);
  await p.keyboard.down("Control"); await p.keyboard.down("Shift"); await p.keyboard.press("l"); await p.keyboard.up("Shift"); await p.keyboard.up("Control");
  const lk = await ed((e) => [...e.scene.els.values()].find((x) => x.kind === "rect").locked);
  check("Ctrl+Shift+L locks the selection", lk === true);
  await ed((e) => e.toggleLock());

  // 100 create/undo cycles of the new shapes keep the heap flat
  const cyc2 = await p.evaluate(async () => {
    const e = window.__ap.editor, heap = async () => { window.gc?.(); await new Promise((r) => setTimeout(r, 40)); window.gc?.(); return performance.memory.usedJSHeapSize; };
    const one = () => { for (const k of ["cylinder", "cloud", "note", "frame", "lane", "badge", "star"]) { e.setTool(k); const t = document.getElementById("stage"); const r = t.getBoundingClientRect(); const x = r.x + 300, y = r.y + 300; for (const [ty, cx, cy] of [["pointerdown", x, y], ["pointerup", x, y]]) t.dispatchEvent(new MouseEvent(ty, { clientX: cx, clientY: cy, bubbles: true, button: 0 })); } for (let i = 0; i < 7; i++) e.undo(); };
    for (let i = 0; i < 60; i++) one(); // warm-up: JIT, Path2D and font caches settle after ~50 cycles
    const h0 = await heap();
    for (let i = 0; i < 100; i++) one();
    const h1 = await heap();
    return { growthKB: Math.round((h1 - h0) / 1024), hist: e.hist.size() };
  });
  check("100 create/undo cycles of the new shapes keep the heap flat (< 400 KB)", cyc2.growthKB < 400, `${cyc2.growthKB} KB, history ${cyc2.hist}`);

  // opening and closing the library, the menu and the ribbon 50 times: heap flat, and nothing schedules frames afterwards
  await ed((e) => { e.load({ els: [], groups: [] }); e.resetView(); });
  await sleep(150);
  // waitForSelector hands back an ElementHandle that keeps its element (and subtree) alive until disposed: dispose it, or the harness itself looks like a leak
  const waitFor = async (sel, o = {}) => { const h = await p.waitForSelector(sel, { timeout: 3000, ...o }); await h.dispose(); };
  const cycle = async () => {
    await p.keyboard.press("/"); await waitFor(".ap-pal:not([hidden])"); await p.keyboard.press("Escape");
    await p.click('button[aria-label="Menu"]'); await waitFor(".ap-menu"); await p.keyboard.press("Escape");
    await p.evaluate(() => document.activeElement?.blur?.());
    await p.keyboard.press("i"); await waitFor(".ap-ribbon", { visible: true }); await p.keyboard.press("i");
  };
  for (let i = 0; i < 8; i++) await cycle(); // warm-up: the lazy chunks load and the JIT settles
  const gcHeap = () => p.evaluate(async () => { window.gc?.(); await new Promise((r) => setTimeout(r, 50)); window.gc?.(); return performance.memory.usedJSHeapSize; });
  const nodes0 = await p.evaluate(() => document.querySelectorAll("*").length);
  const hh0 = await gcHeap();
  for (let i = 0; i < 50; i++) await cycle();
  const hh1 = await gcHeap();
  for (let i = 0; i < 50; i++) await cycle();
  const hh2 = await gcHeap();
  const nodes1 = await p.evaluate(() => document.querySelectorAll("*").length);
  check("50 open/close cycles of the library, the menu and the ribbon keep the heap flat (< 400 KB), and a second 50 add nothing more (< 150 KB)", hh1 - hh0 < 400 * 1024 && hh2 - hh1 < 150 * 1024, `${Math.round((hh1 - hh0) / 1024)} KB, then ${Math.round((hh2 - hh1) / 1024)} KB`);
  check("...and leave the DOM where it was (no node left behind)", nodes1 <= nodes0, `${nodes0} -> ${nodes1}`);
  await sleep(500);
  const quiet = await p.evaluate(async () => {
    let raf = 0; const orig = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => { raf++; return orig(f); };
    const r = window.__ap.renderer, t = r.lastFrameAt, runs = JSON.stringify(window.__ap.ui.stats());
    await new Promise((x) => setTimeout(x, 2000));
    window.requestAnimationFrame = orig;
    return { raf, frames: r.lastFrameAt === t, runs: JSON.stringify(window.__ap.ui.stats()) === runs, open: [window.__ap.palette.isOpen(), !!document.querySelector(".ap-menu"), !!document.querySelector(".ap-ribbon:not([hidden])")] };
  });
  check("after those cycles nothing schedules a frame (no rAF, no canvas frame, no UI updater run in 2 s)", quiet.raf === 0 && quiet.frames && quiet.runs, JSON.stringify(quiet));
  check("...and everything is closed", quiet.open.every((x) => !x), JSON.stringify(quiet.open));

  // idle: nothing schedules frames
  await sleep(300);
  const idle = await p.evaluate(async () => { const r = window.__ap.renderer; const t = r.lastFrameAt; await new Promise((x) => setTimeout(x, 1500)); return r.lastFrameAt === t; });
  check("idle after interaction schedules no frames", idle);

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) { failed = true; console.error(e); } finally { await b.close(); srv.kill(); }
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(failed || bad ? 1 : 0);
