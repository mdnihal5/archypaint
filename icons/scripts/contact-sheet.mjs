// Renders every icon (both tiers) in category colours to dist/contact-sheet.html + .png.
// Needs puppeteer-core: PUPPETEER_DIR=/path/to/node_modules node scripts/contact-sheet.mjs [--dark]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dark = process.argv.includes("--dark");
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const pack = (process.argv.find((a) => a.startsWith("--pack=")) || "").slice(7); // --pack=aws renders manifests/aws.json only, to dist/contact-sheet-aws*.png
const manifest = JSON.parse(readFileSync(join(ROOT, pack ? `manifests/${pack}.json` : "manifest.json"), "utf8"));
const COL = dark
  ? { bg: "#16171b", card: "#1d1f26", ink: "#e7e9ee", mid: "#9aa1ac", data: "#5aa9e6", cache: "#f0913a", network: "#4cc38a", compute: "#a48af0", queue: "#34c6cf", security: "#e879b0", client: "#a9b3be", external: "#d4bb6a" }
  : { bg: "#f5f1e6", card: "#fbf9f2", ink: "#26323b", mid: "#5f6a73", data: "#2b6f9e", cache: "#a25a17", network: "#2d7b4d", compute: "#6a4fa3", queue: "#0e777e", security: "#9b3d6b", client: "#4d5a64", external: "#7a6a3a" };

const rows = manifest.filter((r) => !only.length || only.includes(r.id));
const cell = (r) => {
  const d = readFileSync(join(ROOT, r.files.detailed), "utf8").replace("<svg ", '<svg class="big" ');
  const g = readFileSync(join(ROOT, r.files.glyph), "utf8").replace("<svg ", '<svg class="sm" ');
  return `<div class="c" style="color:${COL[r.category]}">${d}<div class="side">${g}${g.replace('class="sm"', 'class="xs"')}</div><div class="id">${r.id}</div></div>`;
};
const html = `<!doctype html><meta charset=utf-8><style>
body{margin:0;padding:20px;background:${COL.bg};font-family:'JetBrains Mono',monospace}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:12px;width:1400px}
.c{background:${COL.card};border:1px solid ${COL.ink}33;border-radius:8px;padding:10px;position:relative;height:150px}
.big{width:112px;height:112px;display:block}
.side{position:absolute;right:10px;top:12px;display:flex;flex-direction:column;gap:8px;align-items:center}
.sm{width:32px;height:32px}.xs{width:24px;height:24px}
.id{position:absolute;left:10px;bottom:8px;font-size:11px;color:${COL.ink}}
</style><div class="grid">${rows.map(cell).join("")}</div>`;
mkdirSync(join(ROOT, "dist"), { recursive: true });
const out = join(ROOT, "dist", (pack ? `contact-sheet-${pack}` : "contact-sheet") + (dark ? "-dark" : ""));
writeFileSync(out + ".html", html);

const pd = process.env.PUPPETEER_DIR;
const puppeteer = (await import(pd ? pd + "/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js" : "puppeteer-core")).default;
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
await p.setContent(html, { waitUntil: "load" });
await p.screenshot({ path: out + ".png", fullPage: true });
await b.close();
console.log("wrote", out + ".png");
