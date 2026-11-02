// Bundle budget guard. Usage: npm run build && node scripts/size-check.mjs
// STARTUP is what every first visit downloads and parses before the app runs: the entry plus every chunk index.html loads,
// modulepreloads or the entry imports statically (scripts/size-lib.mjs). Everything else is lazy and capped per chunk.
// Budgets are gzip KB. A feature must ship as its own lazy chunk (dynamic import from an action), never in the startup set.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { startupSet } from "./size-lib.mjs";

// 68.9 KB gz was the startup set at the last commit before boards (entry 67.0 + theme 1.1 + preload helper 0.8)
const STARTUP_MAX = 69, LAZY_MAX = 30, CSS_MAX = 8;
const DIST = new URL("../dist/", import.meta.url).pathname;
const start = startupSet(DIST);
const inStart = new Set(start.map((s) => s.file));
let bad = 0;
const rows = [];
const total = start.reduce((a, s) => a + s.gz, 0) / 1024;
for (const s of start) rows.push(`start  ${s.file.padEnd(34)} ${(s.gz / 1024).toFixed(1).padStart(6)} KB gz`);
const okStart = total <= STARTUP_MAX; if (!okStart) bad++;
rows.push(`${okStart ? "ok  " : "OVER"}  STARTUP JS (${start.length} files)${" ".repeat(14)} ${total.toFixed(1).padStart(6)} KB gz  (max ${STARTUP_MAX})`);
for (const f of readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".js") || f.endsWith(".css")).sort()) {
  if (inStart.has(f)) continue;
  const kb = gzipSync(readFileSync(join(DIST, "assets", f))).length / 1024;
  const max = f.endsWith(".css") ? CSS_MAX : LAZY_MAX;
  const ok = kb <= max; if (!ok) bad++;
  rows.push(`${ok ? "ok  " : "OVER"}  lazy   ${f.padEnd(34)} ${kb.toFixed(1).padStart(6)} KB gz  (max ${max})`);
}
console.log(rows.join("\n"));
process.exit(bad ? 1 : 0);
