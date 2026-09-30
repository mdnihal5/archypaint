// Real-browser flow for image / SVG elements: insert (PNG, big JPEG, SVG), drop, paste, hostile files, move / resize / undo,
// save -> clean profile -> open, PNG / SVG / Excalidraw export, reload, idle frames, heap over 100 insert/undo cycles.
// Usage: npm run build && PUPPETEER_DIR=<node_modules with puppeteer-core> node perf/images-flow.mjs   (KEEP=1 keeps the screenshots)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire((process.env.PUPPETEER_DIR ?? "/home/sys2026/Personal/blog-visuals/node_modules") + "/");
const puppeteer = require("puppeteer-core");
const DIR = mkdtempSync(join(tmpdir(), "archypaint-images-"));
const OUT = DIR + "/";
const PORT = 4197;
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {} await sleep(200); }
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
try {
  const cx = await b.createBrowserContext();
  const p = await cx.newPage(); await p.setViewport({ width: 1280, height: 800 });
  const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  p.on("dialog", (d) => d.accept());
  await p.goto(`http://localhost:${PORT}/?theme=light`); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForFunction(() => window.__ap && window.__ap.editor); await sleep(800);

  // ---- helpers inside the page
  await p.evaluate(() => {
    window.mkPng = (w, h, colours, type = "image/png") => new Promise((res) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
      g.fillStyle = colours[0]; g.fillRect(0, 0, w, h); g.fillStyle = colours[1]; g.fillRect(w / 2, h / 2, w / 2, h / 2); // top-left colour[0], bottom-right colour[1]
      c.toBlob((bl) => res(new File([bl], "t." + (type === "image/png" ? "png" : "jpg"), { type })), type, 0.92);
    });
    window.svgFile = (txt) => new File([txt], "a.svg", { type: "image/svg+xml" });
    window.imgs = () => [...window.__ap.scene.els.values()].filter((e) => e.kind === "image");
    window.px = (wx, wy) => { const { vp } = window.__ap.editor; const c = document.getElementById("static"); const d = c.getContext("2d").getImageData(Math.round((wx - vp.x) * vp.zoom), Math.round((wy - vp.y) * vp.zoom), 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
    window.toasts = () => [...document.querySelectorAll(".ap-toast")].map((t) => t.textContent);
  });
  const ed = (fn, ...a) => p.evaluate(fn, ...a);

  // 1. insert a PNG (red top-left, blue bottom-right quadrant), a large JPEG (downscaled) and an SVG
  await ed(async () => { const f = await window.mkPng(400, 300, ["#ff0000", "#0000ff"]); await window.__ap.editor.insertImage(f, { x: 300, y: 300 }); });
  await ed(async () => { const f = await window.mkPng(3200, 2000, ["#00aa00", "#ffaa00"], "image/jpeg"); await window.__ap.editor.insertImage(f, { x: 800, y: 300 }); });
  await ed(async () => { await window.__ap.editor.insertImage(window.svgFile('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#8800cc"/><circle cx="50" cy="50" r="30" fill="#ffffff"/></svg>'), { x: 300, y: 600 }); });
  await sleep(700);
  const n1 = await ed(() => window.imgs().length);
  check("three images inserted (PNG, JPEG, SVG)", n1 === 3, `count ${n1}`);
  const geo = await ed(() => window.imgs().map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h })));
  check("images are fitted to 360 world units", geo.every((g) => Math.max(g.w, g.h) <= 360.5), JSON.stringify(geo.map((g) => [Math.round(g.w), Math.round(g.h)])));
  const png = geo[0];
  const tl = await ed((x, y) => window.px(x, y), png.x + 10, png.y + 10), br = await ed((x, y) => window.px(x, y), png.x + png.w - 10, png.y + png.h - 10);
  check("PNG pixels drawn on the canvas (red top-left, blue bottom-right)", tl[0] > 200 && tl[2] < 60 && br[2] > 200 && br[0] < 60, `tl ${tl} br ${br}`);
  const sv = geo[2], svc = await ed((x, y) => window.px(x, y), sv.x + 6, sv.y + 6);
  check("SVG drawn (purple corner)", svc[0] > 100 && svc[0] < 170 && svc[2] > 170, `px ${svc}`);
  await p.screenshot({ path: OUT + "1-light.png" });

  // 2. drop + paste through real DOM events
  await ed(async () => {
    const f = await window.mkPng(200, 200, ["#ff00ff", "#00ffff"]);
    const dt = new DataTransfer(); dt.items.add(f);
    const ev = new DragEvent("drop", { bubbles: true, cancelable: true, clientX: 900, clientY: 620, dataTransfer: dt });
    document.getElementById("stage").dispatchEvent(ev); window.dropPrevented = ev.defaultPrevented;
  });
  await sleep(500);
  check("drop inserts a picture at the drop point and prevents the browser default", await ed(() => window.imgs().length === 4 && window.dropPrevented));
  await ed(async () => {
    const f = await window.mkPng(120, 80, ["#123456", "#abcdef"]);
    const dt = new DataTransfer(); dt.items.add(f);
    const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
    window.dispatchEvent(ev);
  });
  await sleep(500);
  check("paste inserts a picture", await ed(() => window.imgs().length === 5));

  // 3. hostile drop -> a visible toast, nothing added, nothing crashes
  await ed(async () => {
    const dt = new DataTransfer(); dt.items.add(window.svgFile('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>'));
    document.getElementById("stage").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: 100, clientY: 100, dataTransfer: dt }));
    const dt2 = new DataTransfer(); dt2.items.add(new File(["garbage bytes"], "x.png", { type: "image/png" }));
    document.getElementById("stage").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: 100, clientY: 100, dataTransfer: dt2 }));
  });
  await sleep(600);
  const toasts = await ed(() => window.toasts());
  check("hostile SVG and corrupt PNG are refused with toasts", (await ed(() => window.imgs().length)) === 5 && toasts.some((t) => /script/i.test(t)) && toasts.some((t) => /Unsupported|could not be read/i.test(t)), JSON.stringify(toasts));

  // 4. move / resize / undo / redo with the real mouse
  await ed(() => { const e = window.imgs()[0]; window.__ap.editor.select([]); window.__id = e.id; });
  const g0 = await ed(() => { const e = window.__ap.scene.els.get(window.__id); return { x: e.x, y: e.y, w: e.w, h: e.h }; });
  await p.mouse.move(g0.x + g0.w / 2, g0.y + g0.h / 2); await p.mouse.down(); await p.mouse.move(g0.x + g0.w / 2 + 60, g0.y + g0.h / 2 + 40, { steps: 5 }); await p.mouse.up(); await sleep(150);
  const g1 = await ed(() => { const e = window.__ap.scene.els.get(window.__id); return { x: e.x, y: e.y, w: e.w, h: e.h }; });
  check("drag moves an image", Math.abs(g1.x - g0.x - 60) < 12 && Math.abs(g1.y - g0.y - 40) < 12, `dx ${g1.x - g0.x} dy ${g1.y - g0.y}`);
  await p.mouse.move(g1.x + g1.w, g1.y + g1.h); await p.mouse.down(); await p.mouse.move(g1.x + g1.w + 60, g1.y + g1.h + 10, { steps: 5 }); await p.mouse.up(); await sleep(150);
  const g2 = await ed(() => { const e = window.__ap.scene.els.get(window.__id); return { x: e.x, y: e.y, w: e.w, h: e.h }; });
  check("corner drag resizes with the aspect ratio kept", g2.w > g1.w + 30 && Math.abs(g2.w / g2.h - g1.w / g1.h) < 0.03, `${g1.w.toFixed(0)}x${g1.h.toFixed(0)} -> ${g2.w.toFixed(0)}x${g2.h.toFixed(0)}`);
  await ed(() => { window.__ap.editor.undo(); window.__ap.editor.undo(); });
  const g3 = await ed(() => { const e = window.__ap.scene.els.get(window.__id); return { x: e.x, y: e.y, w: e.w }; });
  check("two undos restore the original geometry", Math.abs(g3.x - g0.x) < 0.5 && Math.abs(g3.w - g0.w) < 0.5);
  await ed(() => { window.__ap.editor.redo(); window.__ap.editor.redo(); }); await sleep(100);

  // 5. save -> wipe the image store (a different browser) -> open: pictures come back from inside the file
  await ed(() => {
    window.__saved = "";
    window.showSaveFilePicker = async () => ({ name: "t.archypaint", getFile: async () => new File([window.__saved], "t.archypaint"), createWritable: async () => ({ write: async (bl) => { window.__saved = await bl.text(); }, close: async () => {} }) });
  });
  await ed(() => window.__ap.io.save()); await sleep(1200);
  const saved = await ed(() => window.__saved);
  if (!saved) console.log("save debug: toasts", JSON.stringify(await ed(() => window.toasts())), "errs", JSON.stringify(errs.slice(0, 3)), "busy?");
  writeFileSync(OUT + "t.archypaint", saved);
  const parsed = JSON.parse(saved);
  check("saved file embeds every used picture under 'images'", parsed.images && Object.keys(parsed.images).length === 5, `keys ${parsed.images ? Object.keys(parsed.images).length : 0}, ${(saved.length / 1024).toFixed(0)} KB`);
  const keysInScene = await ed(() => window.imgs().map((e) => e.img));
  check("every element key exists in the embedded map", keysInScene.every((k) => parsed.images[k]));
  await ed(() => new Promise((res) => { const r = indexedDB.deleteDatabase("archypaint-images"); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
  await p.evaluate(() => { localStorage.clear(); });
  const p2 = await cx.newPage(); await p2.setViewport({ width: 1280, height: 800 });
  p2.on("pageerror", (e) => errs.push(String(e)));
  await p2.goto(`http://localhost:${PORT}/?theme=light`); await p2.waitForFunction(() => window.__ap && window.__ap.editor); await sleep(600);
  await p2.evaluate(() => { window.imgs = () => [...window.__ap.scene.els.values()].filter((e) => e.kind === "image"); });
  await p2.evaluate((txt) => { window.showOpenFilePicker = async () => [{ name: "t.archypaint", getFile: async () => new File([txt], "t.archypaint"), createWritable: async () => ({}) }]; }, saved);
  await p2.evaluate(() => window.__ap.io.open()); await sleep(1500);
  const opened = await p2.evaluate(() => window.imgs().length);
  check("opening the file in a clean profile restores all pictures", opened === 5, `count ${opened}`);
  const dbKeys = await p2.evaluate(() => new Promise((res) => { const r = indexedDB.open("archypaint-images"); r.onsuccess = () => { const q = r.result.transaction("blobs").objectStore("blobs").getAllKeys(); q.onsuccess = () => res(q.result.length); }; r.onerror = () => res(-1); }));
  check("their blobs are back in the local store", dbKeys === 5, `blobs ${dbKeys}`);
  const first = await p2.evaluate(() => { const e = window.imgs()[0]; const { vp } = window.__ap.editor; const c = document.getElementById("static"); const d = c.getContext("2d").getImageData(Math.round((e.x + 10 - vp.x) * vp.zoom), Math.round((e.y + 10 - vp.y) * vp.zoom), 1, 1).data; return [d[0], d[1], d[2]]; });
  check("the restored picture is drawn (not a placeholder)", first[0] > 200 && first[2] < 60, `px ${first}`);
  await p2.screenshot({ path: OUT + "2-reopened.png" });

  // 6. exports from the original page: PNG pixels and SVG content
  await p.bringToFront();
  await ed(() => { window.__blobs = []; const o = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return o.call(URL, b); }; });
  await ed(() => window.__ap.io.exportPng({ scale: 1, background: true })); await sleep(1200);
  const pngInfo = await ed(async () => { const bl = window.__blobs.find((b) => b.type === "image/png"); if (!bl) return null; const bmp = await createImageBitmap(bl); const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; const g = c.getContext("2d"); g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let red = 0, blue = 0, purple = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 230 && d[i + 1] < 40 && d[i + 2] < 40) red++; if (d[i + 2] > 230 && d[i] < 40 && d[i + 1] < 40) blue++; if (d[i] > 120 && d[i] < 160 && d[i + 1] < 20 && d[i + 2] > 190) purple++; } return { w: bmp.width, h: bmp.height, red, blue, purple }; });
  check("PNG export contains the pictures' pixels", !!pngInfo && pngInfo.red > 2000 && pngInfo.blue > 2000 && pngInfo.purple > 2000, JSON.stringify(pngInfo));
  await ed(() => window.__ap.io.exportSvg({ background: true })); await sleep(1200);
  const svgText = await ed(async () => { const bl = window.__blobs.find((b) => b.type === "image/svg+xml"); return bl ? await bl.text() : ""; });
  check("SVG export embeds the pictures as data URLs", (svgText.match(/<image href="data:image\//g) || []).length === 5, `images ${(svgText.match(/<image /g) || []).length}`);
  await ed(() => { window.__ex = null; window.showSaveFilePicker = async () => ({ name: "x.excalidraw", getFile: async () => new File([], "x"), createWritable: async () => ({ write: async (bl) => { window.__ex = await bl.text(); }, close: async () => {} }) }); });
  await ed(() => window.__ap.io.exportExcalidraw()); await sleep(800);
  const ex = JSON.parse(await ed(() => window.__ex));
  check("Excalidraw export writes image elements and their files", ex.elements.filter((e) => e.type === "image").length === 5 && Object.keys(ex.files).length === 5);

  // 7. dark theme look + reload persistence (autosave, same profile)
  await p.goto(`http://localhost:${PORT}/?theme=dark`); await sleep(2200);
  const after = await ed(() => ({ n: window.imgs ? 0 : 0, c: [...window.__ap.scene.els.values()].filter((e) => e.kind === "image").length }));
  check("autosaved sheet restores its pictures after a reload", after.c === 5, `count ${after.c}`);
  await p.screenshot({ path: OUT + "3-dark-restored.png" });

  // 8. idle: no frames; memory: 100 insert/undo cycles
  await ed(() => { window.imgs = () => [...window.__ap.scene.els.values()].filter((e) => e.kind === "image"); });
  const a = await ed(() => window.__ap.renderer.lastFrameAt); await sleep(1500);
  check("no frames scheduled while idle", (await ed(() => window.__ap.renderer.lastFrameAt)) === a);
  await ed(() => { window.mkPng = (w, h, c) => new Promise((res) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d"); g.fillStyle = c[0]; g.fillRect(0, 0, w, h); cv.toBlob((bl) => res(new File([bl], "t.png", { type: "image/png" })), "image/png"); }); });
  const heap = () => p.evaluate(async () => { window.gc?.(); await new Promise((r) => setTimeout(r, 60)); window.gc?.(); return performance.memory.usedJSHeapSize; });
  const f0 = await ed(async () => { const f = await window.mkPng(300, 200, ["#334455"]); await window.__ap.editor.insertImage(f); window.__ap.editor.undo(); }); // warm
  const h0 = await heap(); const n0 = await ed(() => window.__ap.scene.els.size);
  for (let r = 0; r < 4; r++) await ed(async () => { const f = await window.mkPng(300, 200, ["#334455"]); for (let i = 0; i < 25; i++) { await window.__ap.editor.insertImage(f); window.__ap.editor.undo(); } });
  await sleep(300);
  const h1 = await heap(); const n1b = await ed(() => window.__ap.scene.els.size);
  check("100 insert/undo cycles: scene unchanged and heap growth small", n1b === n0 && h1 - h0 < 1.5 * 1024 * 1024, `elements ${n0}->${n1b}, heap +${Math.round((h1 - h0) / 1024)} KB`);
  check("no page errors", errs.length === 0, JSON.stringify(errs.slice(0, 3)));
} catch (e) { failed++; console.log("FLOW ERROR", e); }
finally { await b.close(); srv.kill(); if (process.env.KEEP) console.log("kept", DIR); else rmSync(DIR, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
