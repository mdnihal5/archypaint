// Real-browser check for auto-tidy and capacity notes.
// Usage: npm run build && PUPPETEER_DIR=<node_modules dir> node perf/tidy-calc.mjs [--shots <dir>]
// Drives the built app (vite preview): shuffles a realistic diagram, tidies it with the keyboard shortcut, checks layout
// quality, arrow attachment, exact undo, idle frames and heap over repeated cycles; then inserts and edits a capacity note.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire((process.env.PUPPETEER_DIR ?? "/home/sys2026/Personal/blog-visuals/node_modules") + "/");
const puppeteer = require("puppeteer-core");
const SHOTS = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const PORT = 4197;
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ } await sleep(200); }
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

async function open(url, w = 1400, h = 860) {
  const cx = await b.createBrowserContext(); // fresh storage per page: the autosave of one run must not leak into the next
  const p = await cx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  p.on("dialog", (d) => d.accept());
  await p.setViewport({ width: w, height: h });
  await p.goto(url); await p.waitForFunction(() => window.__ap && window.__ap.ui);
  await p.evaluate(() => { localStorage.setItem("archypaint.settings.v1", JSON.stringify({ bg: "grid", theme: "system", frame: false, hud: false, layers: false, minimap: false })); });
  return { p, errs };
}

const SNAP = () => JSON.stringify([...window.__ap.scene.els.values()].map((e) => [e.id, e.x, e.y, e.w, e.h, e.pts]));
try {
  /* ---------------- tidy on a shuffled realistic diagram ---------------- */
  {
    const { p, errs } = await open(`http://localhost:${PORT}/?mixed=60&theme=light`);
    await sleep(1500);
    const info = await p.evaluate(() => {
      const { scene, editor } = window.__ap;
      let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
      const nodes = [...scene.els.values()].filter((e) => e.kind !== "arrow");
      const pos = new Map();
      for (const n of nodes) pos.set(n.id, { x: Math.round(rnd() * 1500), y: Math.round(rnd() * 900) });
      scene.groups.clear(); for (const n of nodes) if (n.groupIds.length) scene.patch(n, { groupIds: [] }); // random scatter: groups would only confuse the picture
      editor.applyPositions(pos, "shuffle");
      editor.zoomToFit();
      return { nodes: nodes.length, arrows: scene.els.size - nodes.length };
    });
    check("scene is a realistic mix (icons, shapes, arrows)", info.nodes >= 30 && info.arrows >= 20, `${info.nodes} nodes, ${info.arrows} arrows`);
    await sleep(400);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/tidy-before.png` });
    const before = await p.evaluate(SNAP);
    const f0 = await p.evaluate(() => window.__ap.renderer.lastFrameAt);

    await p.keyboard.press("y"); // the shortcut
    await p.waitForFunction((t) => window.__ap.renderer.lastFrameAt !== t, {}, f0);
    await sleep(500);
    const after = await p.evaluate(SNAP);
    check("the Y shortcut tidies (positions changed)", after !== before);

    const q = await p.evaluate(() => {
      const { scene, editor } = window.__ap;
      const PINNED = new Set(["arrow", "legend", "text", "brace", "badge", "note", "calc"]); // annotations are deliberately not laid out
      const nodes = [...scene.els.values()].filter((e) => !PINNED.has(e.kind));
      let overlaps = 0, off = 0;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (a.x % 10 || a.y % 10) off++;
        for (let j = i + 1; j < nodes.length; j++) { const c = nodes[j]; if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) overlaps++; }
      }
      const dist = (px, py, r) => Math.hypot(Math.max(r.x - px, 0, px - (r.x + r.w)), Math.max(r.y - py, 0, py - (r.y + r.h)));
      let detached = 0, bound = 0;
      for (const a of scene.els.values()) {
        if (a.kind !== "arrow" || !a.src || !a.dst) continue;
        bound++;
        const s = scene.els.get(a.src), t = scene.els.get(a.dst), n = a.pts.length;
        if (!s || !t || dist(a.pts[0], a.pts[1], s) > 2 || dist(a.pts[n - 2], a.pts[n - 1], t) > 2) detached++;
      }
      return { overlaps, off, detached, bound, canUndo: editor.canUndo() };
    });
    check("no two shapes overlap", q.overlaps === 0, `${q.overlaps} overlaps`);
    check("every position is on the 10-unit grid", q.off === 0, `${q.off} off-grid`);
    check("every bound arrow still touches both ends", q.detached === 0 && q.bound > 10, `${q.detached}/${q.bound} detached`);
    await sleep(200);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/tidy-after.png` });

    const idle = await p.evaluate(async () => { const r = window.__ap.renderer, t = r.lastFrameAt; await new Promise((ok) => setTimeout(ok, 1500)); return r.lastFrameAt === t; });
    check("no frames are drawn while idle after a tidy", idle);

    await p.evaluate(() => window.__ap.editor.undo());
    await sleep(200);
    check("one undo restores every position and arrow route exactly", (await p.evaluate(SNAP)) === before);
    const undoLeft = await p.evaluate(() => { const e = window.__ap.editor; let n = 0; while (e.canUndo() && n < 50) { e.undo(); n++; } return n; });
    check("tidy was a single undo step (only the shuffle remains below it)", undoLeft === 1, `${undoLeft} more steps`);

    // dark theme look
    await p.evaluate(() => { const e = window.__ap.editor; while (e.canRedo()) e.redo(); });
    await p.evaluate(() => window.__ap.settings.set({ theme: "dark" }));
    await p.keyboard.press("y"); await sleep(600);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/tidy-after-dark.png` });
    await p.evaluate(() => window.__ap.settings.set({ theme: "light" }));

    // repeated tidy / undo / redo cycles: the heap must stay flat
    const heap = async () => p.evaluate(async () => { window.gc?.(); await new Promise((r) => setTimeout(r, 50)); window.gc?.(); return performance.memory.usedJSHeapSize; });
    const warm = async () => { for (let i = 0; i < 6; i++) await p.evaluate(async () => { const e = window.__ap.editor; await e.tidy("all"); e.undo(); e.redo(); e.undo(); }); };
    await p.evaluate(() => { const e = window.__ap.editor; while (e.canUndo()) e.undo(); while (e.canRedo()) e.redo(); });
    await warm();
    const h0 = await heap();
    for (let i = 0; i < 6; i++) await warm();
    const h1 = await heap();
    check("heap is flat over 36 tidy/undo/redo cycles", h1 - h0 < 600 * 1024, `${Math.round((h1 - h0) / 1024)} KB growth`);
    check("no page errors (tidy)", errs.length === 0, errs.slice(0, 2).join(" | "));
    await p.browserContext().close();
  }

  /* ---------------- tidy timing at scale ---------------- */
  for (const [n, label] of [[800, "≈500 nodes"], [5000, "5,000 elements (over the layout cap: grid fallback)"]]) {
    const { p, errs } = await open(`http://localhost:${PORT}/?mixed=${n}`);
    await sleep(2000);
    const r = await p.evaluate(async () => {
      const t0 = performance.now(); const moved = await window.__ap.editor.tidy("all"); const dt = performance.now() - t0;
      const nodes = [...window.__ap.scene.els.values()].filter((e) => e.kind !== "arrow").length;
      return { moved, dt, nodes, long: window.__ap.renderer.lastFrameMs };
    });
    check(`tidy ${label}: ${r.nodes} nodes, ${r.moved} moved in ${r.dt.toFixed(0)} ms`, r.moved > 0 && r.dt < (n > 1000 ? 2500 : 1200));
    await sleep(800);
    const idle = await p.evaluate(async () => { const rr = window.__ap.renderer, t = rr.lastFrameAt; await new Promise((ok) => setTimeout(ok, 1200)); return rr.lastFrameAt === t; });
    check(`no idle frames after tidy (${label})`, idle);
    check(`no page errors (${label})`, errs.length === 0, errs.slice(0, 2).join(" | "));
    await p.browserContext().close();
  }

  /* ---------------- capacity note ---------------- */
  for (const theme of ["light", "dark"]) {
    const { p, errs } = await open(`http://localhost:${PORT}/?theme=${theme}`);
    await sleep(600);
    await p.keyboard.press("c");
    await sleep(900); // evaluator chunk loads, repaint
    const made = await p.evaluate(() => { const e = [...window.__ap.scene.els.values()].find((x) => x.kind === "calc"); return e ? { w: e.w, h: e.h, text: e.text, sel: window.__ap.editor.selection().has(e.id) } : null; });
    check(`[${theme}] C inserts a selected capacity note`, !!made && made.sel && made.text.includes("dau = 10M"));
    if (SHOTS && theme === "light") await p.screenshot({ path: `${SHOTS}/calc-inserted-${theme}.png` });

    // double-click to edit: replace the text, commit on blur
    const box = await p.evaluate(() => { const e = [...window.__ap.scene.els.values()].find((x) => x.kind === "calc"); const vp = window.__ap.vp; return { x: (e.x + e.w / 2 - vp.x) * vp.zoom, y: (e.y + 30 - vp.y) * vp.zoom }; });
    await p.mouse.click(box.x, box.y, { clickCount: 2, delay: 30 });
    await sleep(250);
    const ta = await p.$("textarea");
    check(`[${theme}] double-click opens the text editor with the source`, !!ta && (await ta.evaluate((t) => t.value.includes("qps = dau"))));
    if (ta) {
      await ta.evaluate((t) => { t.value = "# twitter-ish\nusers = 300M\ndau = users * 40%\ntweets_per_user = 5\nwrite_qps = dau * tweets_per_user / day\nread_qps = write_qps * 100\nmedia = dau * 2 * 500KB\nper_year = media * 365\nbroken = 1 / 0\noops = nope + 1"; t.dispatchEvent(new Event("input", { bubbles: true })); });
      await p.mouse.click(500, 760); // empty canvas (the properties panel sits at the right): blur commits
      await sleep(600);
    }
    const edited = await p.evaluate(() => { const e = [...window.__ap.scene.els.values()].find((x) => x.kind === "calc"); return e ? { text: e.text, h: e.h } : null; });
    check(`[${theme}] editing commits the text and grows the note`, !!edited && edited.text.includes("users = 300M") && edited.h > made.h, edited ? `h ${made.h} -> ${edited.h}` : "");
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/calc-edited-${theme}.png` });
    const idle = await p.evaluate(async () => { const rr = window.__ap.renderer, t = rr.lastFrameAt; await new Promise((ok) => setTimeout(ok, 1200)); return rr.lastFrameAt === t; });
    check(`[${theme}] no idle frames with a capacity note on the sheet`, idle);
    await p.evaluate(() => window.__ap.editor.undo()); await sleep(200);
    const undone = await p.evaluate(() => [...window.__ap.scene.els.values()].find((x) => x.kind === "calc")?.text ?? "");
    check(`[${theme}] undo restores the previous text`, undone.includes("dau = 10M"));
    check(`[${theme}] no page errors (calc)`, errs.length === 0, errs.slice(0, 2).join(" | "));
    await p.browserContext().close();
  }
} finally { await b.close(); srv.kill(); }
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
