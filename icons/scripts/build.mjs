// Validates icons/svg against manifest.json and emits dist/sprite.svg + dist/manifest.json.
// Zero dependencies. Exits non-zero on any violation.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATEGORIES = new Set(["data", "cache", "network", "compute", "queue", "security", "client", "external"]);
const FORBIDDEN_TAGS = /<\s*(linearGradient|radialGradient|filter|style|text|tspan|script|image|foreignObject|clipPath|mask|pattern|use|defs|title|desc)\b/i;
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7); // validate just this pack, write nothing (safe to run while other packs are in progress)
const errors = [];
const err = (m) => errors.push(m);

// Fragments: manifest.json is the "core" pack (batch 1); icons/manifests/<pack>.json add packs (generic2, oss, aws, gcp, azure, ...).
// Each row may carry "vendor" ("aws"|"gcp"|"azure"|"oss") — used for grouping/labels only. Vendor icons are ORIGINAL depictions, never official logos.
const fragments = [["core", "manifest.json"]];
if (existsSync(join(ROOT, "manifests"))) for (const f of readdirSync(join(ROOT, "manifests")).sort()) if (f.endsWith(".json")) fragments.push([f.replace(/\.json$/, ""), `manifests/${f}`]);
const VENDORS = new Set(["aws", "gcp", "azure", "oss"]);
const manifest = [];
for (const [pack, rel] of ONLY ? fragments.filter(([p]) => p === ONLY) : fragments) {
  for (const row of JSON.parse(readFileSync(join(ROOT, rel), "utf8"))) {
    if (row.vendor !== undefined && !VENDORS.has(row.vendor)) err(`${row.id}: bad vendor "${row.vendor}"`);
    manifest.push({ ...row, pack });
  }
}
const ids = new Set();
const TIERS = { detailed: { viewBox: "0 0 64 64", suffix: ".svg" }, glyph: { viewBox: "0 0 24 24", suffix: ".glyph.svg" } };
const bytes = { detailed: 0, glyph: 0 };
const inner = { detailed: {}, glyph: {} };

for (const row of manifest) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.id)) err(`${row.id}: id must be kebab-case`);
  if (ids.has(row.id)) err(`${row.id}: duplicate id`);
  ids.add(row.id);
  if (!CATEGORIES.has(row.category)) err(`${row.id}: bad category "${row.category}"`);
  if (!Array.isArray(row.aliases) || !row.aliases.length) err(`${row.id}: needs aliases`);
  if (!row.name) err(`${row.id}: needs name`);
  for (const [tier, spec] of Object.entries(TIERS)) {
    const rel = row.files?.[tier];
    if (rel !== `svg/${row.id}${spec.suffix}`) { err(`${row.id}: files.${tier} should be svg/${row.id}${spec.suffix}`); continue; }
    const path = join(ROOT, rel);
    if (!existsSync(path)) { err(`${row.id}: missing ${rel}`); continue; }
    const src = readFileSync(path, "utf8");
    bytes[tier] += Buffer.byteLength(src);
    const m = src.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/);
    if (!m) { err(`${rel}: not a single <svg> element`); continue; }
    if (!m[1].includes(`viewBox="${spec.viewBox}"`)) err(`${rel}: viewBox must be "${spec.viewBox}"`);
    if (FORBIDDEN_TAGS.test(m[2])) err(`${rel}: forbidden element (${m[2].match(FORBIDDEN_TAGS)[1]})`);
    if (/\son\w+=/.test(m[2]) || /url\(/.test(m[2]) || /href=/.test(m[2])) err(`${rel}: forbidden attribute (on*, url(), href)`);
    for (const c of m[2].matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) if (c[1] !== "currentColor" && c[1] !== "none") err(`${rel}: colour "${c[1]}" (only currentColor / none allowed)`);
    if (!/<(path|rect|circle|ellipse|line|polyline|polygon)\b/.test(m[2])) err(`${rel}: empty icon`);
    inner[tier][row.id] = m[2];
  }
}
// orphan files
if (!ONLY && existsSync(join(ROOT, "svg"))) {
  for (const f of readdirSync(join(ROOT, "svg"))) {
    const id = f.replace(/\.glyph\.svg$/, "").replace(/\.svg$/, "");
    if (!ids.has(id)) err(`svg/${f}: not in manifest.json`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => "  ✗ " + e).join("\n"));
  console.error(`\n${errors.length} violation(s).`);
  process.exit(1);
}

if (ONLY) { console.log(`ok (--only=${ONLY}): ${manifest.length} icons validated; nothing written`); process.exit(0); }
mkdirSync(join(ROOT, "dist"), { recursive: true });
const sym = (id, vb, body) => `<symbol id="${id}" viewBox="${vb}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${vb.endsWith("64") ? 2 : 1.75}">${body}</symbol>`;
const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n` +
  manifest.map((r) => sym(r.id, TIERS.detailed.viewBox, inner.detailed[r.id]) + "\n" + sym(`${r.id}-glyph`, TIERS.glyph.viewBox, inner.glyph[r.id])).join("\n") + `\n</svg>\n`;
writeFileSync(join(ROOT, "dist/sprite.svg"), sprite);
writeFileSync(join(ROOT, "dist/manifest.json"), JSON.stringify(manifest) + "\n");
const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`ok: ${manifest.length} icons`);
console.log(`  detailed tier: ${kb(bytes.detailed)} (avg ${Math.round(bytes.detailed / manifest.length)} B)`);
console.log(`  glyph tier:    ${kb(bytes.glyph)} (avg ${Math.round(bytes.glyph / manifest.length)} B)`);
console.log(`  sprite.svg:    ${kb(Buffer.byteLength(sprite))}`);

// App packs (committed, so the app builds without running this script): one small index with search metadata for every icon,
// plus one chunk per pack holding the SVG markup. The app loads the index first and each pack only when an icon of it is needed.
const packsDir = join(ROOT, "..", "src", "packs");
mkdirSync(packsDir, { recursive: true });
const index = { v: 2, icons: manifest.map((r) => [r.id, r.name, r.aliases, r.category, r.pack, r.vendor ?? ""]) };
writeFileSync(join(packsDir, "index.json"), JSON.stringify(index));
console.log(`  index:         ${kb(Buffer.byteLength(JSON.stringify(index)))} -> src/packs/index.json`);
for (const [pack] of fragments) {
  const rows = manifest.filter((r) => r.pack === pack);
  const body = JSON.stringify({ v: 2, pack, icons: rows.map((r) => [r.id, inner.detailed[r.id], inner.glyph[r.id]]) });
  writeFileSync(join(packsDir, `${pack}.json`), body);
  console.log(`  pack ${pack.padEnd(9)} ${String(rows.length).padStart(3)} icons  ${kb(Buffer.byteLength(body))} -> src/packs/${pack}.json`);
}
