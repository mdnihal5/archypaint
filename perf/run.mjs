// Headless perf + leak check. Usage: PUPPETEER_DIR=<node_modules dir> node perf/run.mjs [shapes]
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire((process.env.PUPPETEER_DIR ?? "/home/sys2026/Personal/blog-visuals/node_modules") + "/");
const puppeteer = require("puppeteer-core");
const N = Number(process.argv[2] ?? 5000);
// --mixed: a realistic diagram (icons from every pack, routed + labelled arrows, groups, path shapes) instead of plain rectangles
const MODE = process.argv.includes("--mixed") ? "mixed" : "stress";
const PORT = 4179;

const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ } await sleep(200); }

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const out = { shapes: N };
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`http://localhost:${PORT}/?${MODE}=${N}`);
  out.mode = MODE;
  await p.waitForFunction(() => window.__ap && window.__ap.renderer.lastFrameAt > 0);
  if (MODE === "mixed") { // icon packs load lazily on first draw: wait for them so the measurement includes real icon drawing
    await p.waitForFunction(() => document.readyState === "complete");
    await sleep(1500);
    out.iconsDrawn = await p.evaluate(() => [...window.__ap.scene.els.values()].filter((e) => e.kind === "icon").length);
  }
  await sleep(500);

  // 1. idle: no frames scheduled when nothing changes (no render loop)
  const idle = await p.evaluate(async () => {
    const r = window.__ap.renderer; const a = r.lastFrameAt;
    await new Promise((res) => setTimeout(res, 2000));
    return r.lastFrameAt === a;
  });
  out.idleNoFrames = idle;

  // 2. pan + zoom under real wheel events
  await p.mouse.move(720, 450);
  // whole main thread (every task: canvas, minimap, UI updaters, GC), not just the renderer's frame function
  const cdp = await p.createCDPSession(); await cdp.send("Performance.enable");
  const task = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value])).TaskDuration;
  const task0 = await task();
  await p.evaluate(() => window.__ap.renderer.perfStart());
  for (let i = 0; i < 240; i++) { await p.mouse.wheel({ deltaX: 20, deltaY: 14 }); await sleep(8); }
  for (let i = 0; i < 90; i++) { await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: i < 45 ? -30 : 30 }); await p.keyboard.up("Control"); await sleep(8); }
  out.panZoom = await p.evaluate(() => window.__ap.renderer.perfStop());
  out.panZoom.mainThreadMsPerFrame = +(((await task()) - task0) * 1000 / out.panZoom.frames).toFixed(2);

  // 3. leak check: heap after many pan/zoom frames + add/remove churn, forced GC before each reading
  const heap = async () => p.evaluate(async () => { window.gc?.(); await new Promise((r) => setTimeout(r, 50)); window.gc?.(); return performance.memory.usedJSHeapSize; });
  await p.evaluate(() => window.__ap.vp.reset()); await sleep(200);
  const h0 = await heap();
  for (let round = 0; round < 6; round++) {
    await p.evaluate(() => {
      const { scene, renderer } = window.__ap; const made = [];
      for (let i = 0; i < 2000; i++) made.push(scene.add({ kind: "rect", x: i * 7, y: (i % 50) * 9, w: 60, h: 40 }));
      renderer.invalidate(true, true);
      for (const e of made) scene.remove(e);
      renderer.invalidate(true, true);
    });
    for (let i = 0; i < 100; i++) { await p.mouse.wheel({ deltaX: 15, deltaY: 9 }); await sleep(4); }
  }
  const h1 = await heap();
  out.heapMB = { before: +(h0 / 1048576).toFixed(2), after: +(h1 / 1048576).toFixed(2), growthKB: Math.round((h1 - h0) / 1024) };
  out.shapesAfterChurn = await p.evaluate(() => window.__ap.scene.els.size);
  out.pageErrors = errors;
} finally { await b.close(); srv.kill(); }
console.log(JSON.stringify(out, null, 2));
