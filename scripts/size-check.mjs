// Bundle budget guard. Usage: npm run build && node scripts/size-check.mjs
// The entry chunk is what every visitor downloads and parses before the first frame; everything else is lazy.
// Budgets are gzip KB. A feature must ship as its own lazy chunk (dynamic import from an action), never in the entry.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const DIST = new URL("../dist/assets/", import.meta.url).pathname;
const ENTRY_MAX = 68, LAZY_MAX = 30;
const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
const entry = /assets\/(index-[^"]+\.js)/.exec(html)?.[1];
let bad = 0;
const rows = [];
for (const f of readdirSync(DIST).filter((f) => f.endsWith(".js") || f.endsWith(".css")).sort()) {
  const kb = gzipSync(readFileSync(join(DIST, f))).length / 1024;
  const isEntry = f === entry, max = f.endsWith(".css") ? 8 : isEntry ? ENTRY_MAX : LAZY_MAX;
  const ok = kb <= max; if (!ok) bad++;
  rows.push(`${ok ? "ok  " : "OVER"}  ${(isEntry ? "ENTRY " : "lazy  ") + f.padEnd(34)} ${kb.toFixed(1).padStart(6)} KB gz  (max ${max})`);
}
console.log(rows.join("\n"));
process.exit(bad ? 1 : 0);
