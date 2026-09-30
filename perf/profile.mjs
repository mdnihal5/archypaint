// CPU profile of panning/zooming a scene; prints the hottest functions by self time.
// Usage: PUPPETEER_DIR=<node_modules> node perf/profile.mjs [N] [--mixed]
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire((process.env.PUPPETEER_DIR ?? "/home/sys2026/Personal/blog-visuals/node_modules") + "/");
const puppeteer = require("puppeteer-core");
const N = Number(process.argv[2] ?? 5000);
const MODE = process.argv.includes("--mixed") ? "mixed" : "stress";
const PORT = 4181;
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ } await sleep(200); }
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(`http://localhost:${PORT}/?${MODE}=${N}`);
  await p.waitForFunction(() => window.__ap && window.__ap.renderer.lastFrameAt > 0);
  await sleep(1500);
  const cdp = await p.createCDPSession();
  await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  await p.mouse.move(720, 450);
  for (let i = 0; i < 200; i++) { await p.mouse.wheel({ deltaX: 20, deltaY: 14 }); await sleep(8); }
  for (let i = 0; i < 60; i++) { await p.keyboard.down("Control"); await p.mouse.wheel({ deltaY: i < 30 ? -30 : 30 }); await p.keyboard.up("Control"); await sleep(8); }
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas; let total = 0;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id), f = n.callFrame;
    const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0)); total += dt[i] ?? 0;
  });
  // native canvas calls: attribute to the calling function
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const nat = new Map();
  profile.samples.forEach((id, i) => {
    const n = byId.get(id); if (n.callFrame.url) return;
    const pid = parent.get(id), pf = pid !== undefined ? byId.get(pid).callFrame : null;
    if (!pf || !pf.url) return;
    const k = `${n.callFrame.functionName} <- ${pf.functionName || "(anon)"}:${pf.lineNumber + 1}`;
    nat.set(k, (nat.get(k) ?? 0) + (dt[i] ?? 0));
  });
  console.log("-- native canvas calls by caller");
  for (const [k, v] of [...nat].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${(v / 1000).toFixed(1).padStart(8)} ms  ${k}`);
  console.log("-- self time");
  const top = [...self].filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 22);
  console.log(`total sampled ${(total / 1000).toFixed(0)} ms; idle ${(((self.get("(idle) :0") ?? 0)) / 1000).toFixed(0)} ms`);
  for (const [k, v] of top) console.log(`${(v / 1000).toFixed(1).padStart(8)} ms  ${k}`);
} finally { await b.close(); srv.kill(); }
