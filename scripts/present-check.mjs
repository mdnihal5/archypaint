// Present mode + share link, end to end in a real browser. Needs a production build (npm run build) and Chrome.
// Usage: PUPPETEER_DIR=<node_modules with puppeteer-core> node scripts/present-check.mjs   (screenshots: $TMPDIR/archypaint-present-check/)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
const require = createRequire((process.env.PUPPETEER_DIR ?? "/home/sys2026/Personal/blog-visuals/node_modules") + "/");
const puppeteer = require("puppeteer-core");
const OUT = tmpdir() + "/archypaint-present-check/"; mkdirSync(OUT, { recursive: true });
const PORT = 4197, BASE = `http://localhost:${PORT}/`;
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await sleep(200); }
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) fails++; };
const idb = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open("archypaint"); r.onsuccess = () => { const g = r.result.transaction("docs").objectStore("docs").get("current"); g.onsuccess = () => { res(g.result ? JSON.parse(g.result.text).scene.els.length : null); r.result.close(); }; g.onerror = () => res("err"); }; r.onerror = () => res("err"); }));
try {
  const ctx = await b.createBrowserContext();
  await ctx.overridePermissions(BASE.slice(0, -1), ["clipboard-read", "clipboard-write"]);
  const p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 760 });
  const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
  await p.goto(BASE + "?theme=light"); await p.evaluate(() => localStorage.clear()); await p.reload(); await sleep(900);

  // ---- a diagram: 2 groups of boxes, loose shapes, 2 bound arrows
  await p.evaluate(() => {
    const { editor, scene } = window.__ap;
    const mk = (x, y, text) => scene.add({ kind: "rect", x, y, w: 110, h: 60, text, cat: 3 });
    const a = mk(200, 160, "client"), lb = mk(420, 160, "lb"), s1 = mk(640, 100, "api-1"), s2 = mk(640, 240, "api-2"), db = mk(880, 160, "db"), q = mk(420, 360, "queue");
    editor.select([s1.id, s2.id]); editor.group("services");
    editor.clearSelection();
    window.__ids = { a: a.id, lb: lb.id, s1: s1.id, s2: s2.id, db: db.id, q: q.id };
    editor.renderer.invalidate(true, true);
  });
  for (const [f, t] of [["a", "lb"], ["lb", "s1"], ["s1", "db"]]) {
    const pts = await p.evaluate(([f, t]) => { const s = window.__ap.scene, i = window.__ids; const A = s.els.get(i[f]), B = s.els.get(i[t]); return [A.x + A.w, A.y + A.h / 2, B.x, B.y + B.h / 2]; }, [f, t]);
    await p.evaluate(() => window.__ap.editor.setTool("arrow"));
    await p.mouse.move(pts[0] - 2, pts[1]); await p.mouse.down(); await p.mouse.move(pts[2] - 40, pts[3], { steps: 4 }); await p.mouse.move(pts[2] + 2, pts[3], { steps: 3 }); await p.mouse.up(); await sleep(60);
  }
  const before = await p.evaluate(() => ({ els: window.__ap.scene.els.size, arrows: [...window.__ap.scene.els.values()].filter((e) => e.kind === "arrow" && e.src && e.dst).length, canUndo: window.__ap.editor.canUndo(), vp: [window.__ap.vp.x, window.__ap.vp.y, window.__ap.vp.zoom] }));
  check("setup: 6 boxes + 3 bound arrows", before.els === 9 && before.arrows === 3, JSON.stringify(before));
  await p.evaluate(() => window.__ap.editor.select([window.__ids.db]));
  await sleep(900);

  // ---- PRESENT via the real shortcut
  await p.keyboard.press("p"); await sleep(250);
  const s1 = await p.evaluate(() => ({ overlay: !!document.querySelector(".ap-present"), uiHidden: getComputedStyle(document.getElementById("ui")).display === "none", count: document.querySelector(".ap-pr-count").textContent, hidden: window.__ap.renderer.hidden?.size, ro: window.__ap.editor.readOnly, sel: window.__ap.editor.selection().size }));
  check("P starts present: overlay, chrome hidden, read-only, selection cleared", s1.overlay && s1.uiHidden && s1.ro && s1.sel === 0, JSON.stringify(s1));
  await p.screenshot({ path: OUT + "present-1.png" });
  const total = Number(s1.count.split("/")[1]);
  let revealed = [];
  for (let i = 1; i < total; i++) { await p.keyboard.press("ArrowRight"); await sleep(60); revealed.push(await p.evaluate(() => window.__ap.renderer.hidden.size)); if (i === Math.floor(total / 2)) await p.screenshot({ path: OUT + "present-mid.png" }); }
  check("→ reveals step by step until nothing is hidden", revealed.every((v, i) => i === 0 || v <= revealed[i - 1]) && revealed.at(-1) === 0, `steps ${total}, hidden after each: ${revealed.join(",")}`);
  await p.screenshot({ path: OUT + "present-last.png" });
  await p.keyboard.press("ArrowLeft"); await sleep(50);
  check("← hides the last step again", (await p.evaluate(() => window.__ap.renderer.hidden.size)) > 0);
  // no rAF loop while idle in present mode
  await sleep(1200);
  const idle = await p.evaluate(async () => { const r = window.__ap.renderer, a = r.lastFrameAt; await new Promise((x) => setTimeout(x, 1500)); return r.lastFrameAt === a; });
  check("no frames drawn while a step just sits there (no animation loop)", idle);
  await p.keyboard.press("Delete"); await p.keyboard.press("Escape"); await sleep(250);
  const after = await p.evaluate(() => ({ els: window.__ap.scene.els.size, hidden: window.__ap.renderer.hidden, ro: window.__ap.editor.readOnly, ui: getComputedStyle(document.getElementById("ui")).display, overlay: !!document.querySelector(".ap-present"), sel: [...window.__ap.editor.selection()], canUndo: window.__ap.editor.canUndo(), vp: [window.__ap.vp.x, window.__ap.vp.y, window.__ap.vp.zoom], db: window.__ids.db }));
  check("Esc restores chrome, hidden set, read-only flag, selection and the exact viewport", after.hidden === null && !after.ro && after.ui !== "none" && !after.overlay && after.sel.length === 1 && after.sel[0] === after.db && JSON.stringify(after.vp) === JSON.stringify(before.vp), JSON.stringify(after.vp) + " vs " + JSON.stringify(before.vp));
  check("Delete pressed during the presentation deleted nothing", after.els === before.els && after.canUndo === before.canUndo);

  // ---- SHARE via the menu
  await p.click('button[aria-label="Menu"]'); await sleep(200);
  await p.evaluate(() => [...document.querySelectorAll(".ap-mi")].find((b) => b.textContent.startsWith("Copy share link")).click()); await sleep(600);
  // headless Chrome usually refuses clipboard writes: then the link appears in the fallback box, which is also a path worth covering
  let link = "";
  for (let i = 0; i < 30 && !link; i++) { // the fallback box loads lazily: poll rather than guess a delay
    link = await p.evaluate(() => document.querySelector(".ap-linkbox input")?.value ?? "");
    if (!link) link = await p.evaluate(() => navigator.clipboard.readText().catch(() => ""));
    if (!link) await sleep(100);
  }
  check("Copy share link puts a #d= URL on the clipboard", link.startsWith(BASE + "#d=") || link.startsWith(BASE.slice(0, -1) + "/#d="), `${link.length} chars`);

  // ---- a fresh visit whose own sheet is already autosaved; open the link over it
  const ctx2 = await b.createBrowserContext();
  const q = await ctx2.newPage(); await q.setViewport({ width: 1280, height: 760 });
  q.on("pageerror", (e) => errs.push("q:" + String(e))); q.on("dialog", (d) => d.accept());
  await q.goto(BASE + "?theme=light"); await sleep(800);
  for (const x of [300, 600]) { await q.evaluate(() => window.__ap.editor.setTool("ellipse")); await q.mouse.move(x, 300); await q.mouse.down(); await q.mouse.move(x + 100, 360, { steps: 3 }); await q.mouse.up(); await sleep(80); }
  await sleep(1200);
  check("setup: the user's own sheet (2 shapes) is autosaved", (await idb(q)) === 2);
  await q.goto(link); await sleep(1500);
  const sh = await q.evaluate(() => ({ els: window.__ap.scene.els.size, ro: window.__ap.editor.readOnly, bar: !!document.querySelector(".ap-ro-bar"), view: document.documentElement.dataset.view, tools: getComputedStyle(document.querySelector(".ap-toolwrap")).display, brand: getComputedStyle(document.querySelector(".ap-brand")).display }));
  check("the link opens read-only with only the shared bar and the brand showing", sh.els === 9 && sh.ro && sh.bar && sh.view === "readonly" && sh.tools === "none" && sh.brand !== "none", JSON.stringify(sh));
  await q.screenshot({ path: OUT + "shared-light.png" });
  const pos0 = await q.evaluate(() => { const e = [...window.__ap.scene.els.values()].find((x) => x.text === "api-1"); return [e.x, e.y, window.__ap.vp.zoom, window.__ap.vp.x, window.__ap.vp.y]; });
  const sc = await q.evaluate(([x, y]) => { const v = window.__ap.vp; return [(x + 50 - v.x) * v.zoom, (y + 20 - v.y) * v.zoom]; }, pos0);
  await q.mouse.move(sc[0], sc[1]); await q.mouse.down(); await q.mouse.move(sc[0] + 120, sc[1] + 90, { steps: 4 }); await q.mouse.up();
  await q.keyboard.press("Delete"); await q.keyboard.down("Control"); await q.keyboard.press("a"); await q.keyboard.up("Control"); await q.keyboard.press("Delete");
  const pos1 = await q.evaluate(() => { const e = [...window.__ap.scene.els.values()].find((x) => x.text === "api-1"); return [e.x, e.y, window.__ap.scene.els.size]; });
  check("in the shared view a drag pans (shapes don't move) and Delete / Ctrl+A do nothing", pos1[0] === pos0[0] && pos1[1] === pos0[1] && pos1[2] === 9);
  await sleep(1200);
  check("the user's autosaved sheet was NOT overwritten by the shared one", (await idb(q)) === 2, `autosaved shapes: ${await idb(q)}`);
  await q.click(".ap-ro-bar button.primary"); await sleep(150);
  check("Make an editable copy asks first (inline), and nothing changed yet", (await q.evaluate(() => window.__ap.editor.readOnly)) && (await q.evaluate(() => document.querySelector(".ap-ro-msg").textContent)).includes("Replaces"));
  await q.screenshot({ path: OUT + "shared-confirm.png" });
  await q.evaluate(() => [...document.querySelectorAll(".ap-ro-bar button")].find((b) => b.textContent === "Make the copy").click()); await sleep(1300);
  const cp = await q.evaluate(() => ({ ro: window.__ap.editor.readOnly, hash: location.hash, view: document.documentElement.dataset.view, bar: !!document.querySelector(".ap-ro-bar"), tools: getComputedStyle(document.querySelector(".ap-toolwrap")).display }));
  check("the copy is editable, the hash is cleared and the normal chrome is back", !cp.ro && cp.hash === "" && !cp.view && !cp.bar && cp.tools !== "none", JSON.stringify(cp));
  check("now the copy (9 elements) is what is autosaved", (await idb(q)) === 9, `autosaved: ${await idb(q)}`);
  await q.reload(); await sleep(1200);
  check("reloading restores the copy, not the old sheet", (await q.evaluate(() => window.__ap.scene.els.size)) === 9);

  // ---- damaged / hostile links fall back to the normal startup
  const ctx3 = await b.createBrowserContext(); const d = await ctx3.newPage(); d.on("dialog", (x) => x.accept());
  await d.goto(BASE + "?theme=light"); await sleep(600);
  await d.evaluate(() => { window.__ap.scene.add({ kind: "rect", x: 10, y: 10, w: 80, h: 50 }); window.__ap.scene.nonce++; }); await sleep(1100);
  await d.goto(BASE + "#d=AAAAAAAAAAAAAAAA"); await sleep(1300);
  const bad = await d.evaluate(() => ({ ro: window.__ap.editor.readOnly, els: window.__ap.scene.els.size, toast: document.querySelector(".ap-toasts")?.textContent ?? "" }));
  check("a damaged link shows a friendly message and the user's own sheet is restored normally", !bad.ro && bad.els === 1 && /damaged|incomplete/.test(bad.toast), JSON.stringify(bad));

  // ---- dark theme look
  const dk = await b.createBrowserContext(); const r = await dk.newPage(); await r.setViewport({ width: 1280, height: 760 });
  await r.goto(link.replace("#d=", "?theme=dark#d=")); await sleep(1500);
  await r.screenshot({ path: OUT + "shared-dark.png" });
  await r.keyboard.press("p"); await sleep(300); await r.keyboard.press("ArrowRight"); await sleep(200); await r.keyboard.press("ArrowRight"); await sleep(300);
  await r.screenshot({ path: OUT + "present-dark.png" });
  check("no page errors", errs.length === 0, errs.join(" | "));
} finally { await b.close(); srv.kill(); }
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
