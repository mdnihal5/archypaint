// Builds the brand-logo packs from the pinned npm packages (devDependencies) and icons/logos/catalog.mjs.
//   node icons/scripts/build-logos.mjs            (or: npm run logos)
// Writes (all committed, so the app builds without running this):
//   src/packs/logos-<group>.json   one lazy chunk per category: rows [id, "", markup]  (glyph tier only, 24 grid)
//   src/packs/logos-index.json     search metadata + the drawn vendor icons each logo replaces
//   icons/logos/manifest.json      id, name, source package + version, licence, upstream colour (the attribution record)
//
// Artwork rules (what makes a logo "clean" here):
//   - flat colour only: gradients become their mean colour, shadow/highlight overlays are dropped
//   - shapes only (<path>), 24x24 grid, 2 decimals; paths of one colour are merged
//   - marks that would vanish on a theme's paper carry an alternative colour for that theme (data-d dark, data-l light; see src/logo-theme.ts)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(ROOT, "package.json"));
const { JSDOM } = require("jsdom");
const svgpath = require("svgpath");
const { GROUPS, ROWS } = await import(pathToFileURL(join(ROOT, "icons/logos/catalog.mjs")).href);

const GRID = 24;
let IGNORE_MASK = false; // set per logo: the one GCP mark that masks its spokes (drawn full length, a negligible difference)
const CATEGORIES = ["data", "cache", "network", "compute", "queue", "security", "client", "external"];
const PAPER = { light: "#ffffff", dark: "#18181b" }; // theme.ts LIGHT.paper / DARK.paper
const MAX_LOGO_BYTES = 16000;

const pkgJson = (name) => JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8"));
const SOURCES = {
  si: { pkg: "simple-icons", licence: "CC0-1.0", upstream: "https://github.com/simple-icons/simple-icons" },
  lg: { pkg: "@iconify-json/logos", licence: "CC0-1.0", upstream: "https://github.com/gilbarbara/logos" },
  dv: { pkg: "@iconify-json/devicon", licence: "MIT", upstream: "https://github.com/devicons/devicon" },
  gcp: { pkg: "@iconify-json/gcp", licence: "Apache-2.0", upstream: "https://cloud.google.com/icons (via Iconify)" },
};
for (const s of Object.values(SOURCES)) s.version = pkgJson(s.pkg).version;

const si = require("simple-icons");
const siBySlug = new Map(Object.values(si).filter((x) => x && x.slug).map((x) => [x.slug, x]));
const loadSet = (pkg) => { const j = JSON.parse(readFileSync(join(ROOT, "node_modules", pkg, "icons.json"), "utf8")); return j; };
const sets = { lg: loadSet("@iconify-json/logos"), dv: loadSet("@iconify-json/devicon"), gcp: loadSet("@iconify-json/gcp") };

/* ------------------------------------------------------------------ colour helpers */

const NAMED = { white: "#ffffff", black: "#000000", red: "#ff0000", none: "none" };
function parseColour(v) {
  if (!v) return null;
  v = v.trim().toLowerCase();
  if (v in NAMED) return NAMED[v];
  let m = /^#([0-9a-f]{3})$/.exec(v); if (m) return "#" + [...m[1]].map((c) => c + c).join("");
  m = /^#([0-9a-f]{6})$/.exec(v); if (m) return v;
  m = /^rgb\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)\s*\)$/.exec(v); if (m) return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  return null;
}
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => "#" + a.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0")).join("");
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/* ------------------------------------------------------------------ SVG body -> flat shapes */

const num = (v, d = 0) => (v === null || v === undefined || v === "" ? d : parseFloat(v));
const f2 = (n) => String(Math.round(n * 100) / 100);
function rectD(x, y, w, h, rx, ry) {
  rx = Math.min(rx || ry || 0, w / 2); ry = Math.min(ry || rx || 0, h / 2);
  if (rx <= 0 || ry <= 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}z`;
}
const ellipseD = (cx, cy, rx, ry) => `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}z`;
const pointsD = (p, close) => { const n = p.trim().split(/[\s,]+/).map(Number); let d = ""; for (let i = 0; i + 1 < n.length; i += 2) d += `${i ? "L" : "M"}${n[i]} ${n[i + 1]}`; return close ? d + "z" : d; };

/** returns { shapes: [{d, fill:"#rrggbb", op}], w, h, notes } or throws */
function flatten(body, w, h) {
  const dom = new JSDOM(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`, { contentType: "image/svg+xml" });
  const root = dom.window.document.documentElement;
  const grads = new Map();
  for (const g of root.querySelectorAll("linearGradient,radialGradient")) {
    const stops = [...g.querySelectorAll("stop")].map((s) => {
      const style = s.getAttribute("style") || "";
      const sc = s.getAttribute("stop-color") ?? /stop-color:\s*([^;]+)/.exec(style)?.[1] ?? "#000000";
      const so = s.getAttribute("stop-opacity") ?? /stop-opacity:\s*([^;]+)/.exec(style)?.[1] ?? "1";
      return { c: parseColour(sc) ?? "#000000", o: num(so, 1) };
    });
    if (stops.length) {
      const m = [0, 1, 2].map((i) => stops.reduce((a, s) => a + rgb(s.c)[i], 0) / stops.length);
      grads.set(g.getAttribute("id"), { c: hex(m), o: stops.reduce((a, s) => a + s.o, 0) / stops.length });
    }
  }
  const shapes = [];
  const bad = new Set();
  const walk = (el, inh, tf) => {
    const cur = { ...inh };
    const t = el.getAttribute("transform"); const tfs = t ? [...tf, t] : tf;
    if (el.hasAttribute("fill")) cur.fill = el.getAttribute("fill");
    if (el.hasAttribute("fill-opacity")) cur.fo = num(el.getAttribute("fill-opacity"), 1);
    if (el.hasAttribute("opacity")) cur.op = inh.op * num(el.getAttribute("opacity"), 1);
    if (el.hasAttribute("stroke")) cur.stroke = el.getAttribute("stroke");
    const tag = el.localName;
    if (["defs", "linearGradient", "radialGradient", "title", "desc", "metadata"].includes(tag)) return;
    if (["use", "mask", "clipPath", "filter", "image", "text", "style", "pattern", "foreignObject", "symbol"].includes(tag)) { bad.add(tag); return; }
    if (el.getAttribute("clip-path") || el.getAttribute("filter") || (el.getAttribute("mask") && !IGNORE_MASK)) bad.add("clip/mask/filter");
    if (tag === "svg" || tag === "g" || tag === "a") { for (const c of el.children) walk(c, cur, tfs); return; }
    let d;
    switch (tag) {
      case "path": d = el.getAttribute("d"); break;
      case "rect": d = rectD(num(el.getAttribute("x")), num(el.getAttribute("y")), num(el.getAttribute("width")), num(el.getAttribute("height")), num(el.getAttribute("rx")), num(el.getAttribute("ry"))); break;
      case "circle": d = ellipseD(num(el.getAttribute("cx")), num(el.getAttribute("cy")), num(el.getAttribute("r")), num(el.getAttribute("r"))); break;
      case "ellipse": d = ellipseD(num(el.getAttribute("cx")), num(el.getAttribute("cy")), num(el.getAttribute("rx")), num(el.getAttribute("ry"))); break;
      case "polygon": d = pointsD(el.getAttribute("points") ?? "", true); break;
      case "polyline": d = pointsD(el.getAttribute("points") ?? "", false); break;
      default: bad.add(tag); return;
    }
    if (!d) return;
    let fill = cur.fill, op = cur.op * (cur.fo ?? 1);
    if (fill === undefined) fill = "#000000";
    if (fill === "none") { if (cur.stroke && cur.stroke !== "none") bad.add("stroke-only"); return; }
    const u = /^url\(#([^)]+)\)$/.exec(fill.trim());
    if (u) { const g = grads.get(u[1]); if (!g) { bad.add("missing gradient"); return; } fill = g.c; op *= g.o; }
    else if (fill === "currentColor") fill = "#000000";
    else { fill = parseColour(fill); if (!fill) { bad.add(`colour ${cur.fill}`); return; } }
    if (op < 0.12) return; // faint shadow / highlight overlays: dropped, they only add bytes
    let p = svgpath(d);
    if (tfs.length) p = p.transform(tfs.join(" "));
    shapes.push({ d: p.abs().toString(), fill, op: Math.round(op * 100) / 100 });
  };
  walk(root, { op: 1 }, []);
  if (bad.size) throw new Error("unsupported: " + [...bad].join(", "));
  return shapes;
}

/** bounding box of absolute path data from its end points and control points (a slight over-estimate; only used to crop and to test containment) */
function bbox(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  svgpath(d).abs().unarc().iterate((seg, _i, x, y) => {
    const c = seg[0];
    if (c === "H") add(seg[1], y); else if (c === "V") add(x, seg[1]);
    else for (let k = 1; k + 1 < seg.length; k += 2) add(seg[k], seg[k + 1]);
  });
  return [x0, y0, x1, y1];
}

/* ------------------------------------------------------------------ one logo -> markup */

function toMarkup(shapes, vbW, vbH) {
  // crop to the content when the artwork leaves a big empty margin, then fit the longer side into the 24 grid, centred
  let [bx0, by0, bx1, by1] = [0, 0, vbW, vbH];
  const boxes = shapes.map((s) => bbox(s.d));
  const cx0 = Math.min(...boxes.map((b) => b[0])), cy0 = Math.min(...boxes.map((b) => b[1])), cx1 = Math.max(...boxes.map((b) => b[2])), cy1 = Math.max(...boxes.map((b) => b[3]));
  if ((cx1 - cx0) < vbW * 0.8 && (cy1 - cy0) < vbH * 0.8) { bx0 = cx0; by0 = cy0; bx1 = cx1; by1 = cy1; }
  const bw = bx1 - bx0, bh = by1 - by0, s = GRID / Math.max(bw, bh);
  const tx = (GRID - bw * s) / 2 - bx0 * s, ty = (GRID - bh * s) / 2 - by0 * s;
  const placed = shapes.map((sh) => ({ ...sh, d: svgpath(sh.d).matrix([s, 0, 0, s, tx, ty]).round(2).toString(), box: bbox(svgpath(sh.d).matrix([s, 0, 0, s, tx, ty]).toString()) }));
  return placed;
}

/**
 * Theme adjustments. A brand colour that would vanish on a theme's paper gets an alternative for that theme:
 * near-grey marks switch to the theme ink, coloured marks are mixed toward white (dark) or black (light) until readable.
 * Returns per shape { d: colour for the dark theme | null, l: colour for the light theme | null }.
 */
const MIN = { dark: 2.0, light: 1.4 }, TARGET = { dark: 3.0, light: 2.5 };
const INK = { dark: "#e4e4e7", light: "#141418" }; // theme.ts ink
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
function adjusted(c, theme) {
  if (contrast(c, PAPER[theme]) >= MIN[theme]) return null;
  const [r, g, b] = rgb(c);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return INK[theme]; // greys and near-black / near-white
  const toward = theme === "dark" ? "#ffffff" : "#000000";
  for (let t = 0.05; t < 1; t += 0.05) { const m = mix(c, toward, t); if (contrast(m, PAPER[theme]) >= TARGET[theme]) return m; }
  return INK[theme];
}
function altRules(shapes) {
  const colours = new Set(shapes.map((s) => s.fill));
  const fails = (c, th) => adjusted(c, th) !== null;
  // a logo with a mark that fails on the dark theme AND another that fails on the light theme is a plate + glyph or a deliberate two-tone: leave it alone
  const needsDark = [...colours].some((c) => fails(c, "dark") && !fails(c, "light")), needsLight = [...colours].some((c) => fails(c, "light") && !fails(c, "dark"));
  const twoTone = colours.size > 1 && needsDark && needsLight;
  return shapes.map((sh, i) => {
    const r = { d: null, l: null };
    for (const th of ["dark", "light"]) {
      if (!fails(sh.fill, th) || twoTone) continue;
      // sitting on a plate of a different, visible colour (e.g. a white glyph on an orange square): not a theme problem
      let onPlate = false;
      for (let j = 0; j < i && !onPlate; j++) {
        const q = shapes[j];
        if (q.fill === sh.fill || fails(q.fill, th)) continue;
        const a = q.box, b = sh.box;
        onPlate = a[0] <= b[0] + 0.3 && a[1] <= b[1] + 0.3 && a[2] >= b[2] - 0.3 && a[3] >= b[3] - 0.3 && (a[2] - a[0]) * (a[3] - a[1]) > (b[2] - b[0]) * (b[3] - b[1]);
      }
      if (!onPlate) r[th === "dark" ? "d" : "l"] = adjusted(sh.fill, th);
    }
    return r;
  });
}

function emit(shapes) {
  const rules = altRules(shapes);
  const out = [];
  shapes.forEach((sh, i) => {
    const prev = out[out.length - 1], r = rules[i];
    const same = prev && prev.fill === sh.fill && prev.op === sh.op && prev.r.d === r.d && prev.r.l === r.l;
    if (same) prev.d += sh.d; else out.push({ d: sh.d, fill: sh.fill, op: sh.op, r });
  });
  return out.map((p) => `<path d="${p.d}" fill="${p.fill}"${p.op < 1 ? ` fill-opacity="${p.op}"` : ""}${p.r.d ? ` data-d="${p.r.d}"` : ""}${p.r.l ? ` data-l="${p.r.l}"` : ""} stroke="none"/>`).join("");
}

/* ------------------------------------------------------------------ build */

const errors = [], notes = [];
const manifest = [], packs = {}, index = [], hides = new Set();
const seen = new Set();
for (const [group, rows] of Object.entries(ROWS)) {
  if (!GROUPS[group]) { errors.push(`unknown group ${group}`); continue; }
  const cat = GROUPS[group][1];
  if (!CATEGORIES.includes(cat)) errors.push(`${group}: bad category ${cat}`);
  const pack = `logos-${group}`;
  packs[pack] = [];
  for (const line of rows.split("\n")) {
    const [src, name, aliases = "", replaces = ""] = line.split("|");
    const [kind, keyRaw] = src.split(":");
    const [key, as] = keyRaw.split("=");
    const slug = as ?? (kind === "gcp" ? `gcp-${key}` : key);
    const id = `logo-${slug}`;
    if (!/^logo-[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) { errors.push(`${id}: bad id`); continue; }
    if (seen.has(id)) { errors.push(`${id}: duplicate`); continue; }
    let markup, upstreamHex = "", boxes = [];
    try {
      if (kind === "si") {
        const e = siBySlug.get(key);
        if (!e) throw new Error("not in simple-icons");
        upstreamHex = "#" + e.hex.toLowerCase();
        const shapes = [{ d: e.path, fill: upstreamHex, op: 1, box: bbox(e.path) }];
        boxes = shapes.map((q) => q.box);
        markup = emit(shapes);
      } else {
        const set = sets[kind], ent = set.icons[key] ?? (set.aliases?.[key] && set.icons[set.aliases[key].parent]);
        if (!ent) throw new Error(`not in ${SOURCES[kind].pkg}`);
        const w = ent.width ?? set.width ?? 256, h = ent.height ?? set.height ?? 256;
        IGNORE_MASK = key === "pubsub";
        const shapes = toMarkup(flatten(ent.body, w, h), w, h);
        if (!shapes.length) throw new Error("no visible shapes");
        upstreamHex = shapes[0].fill;
        boxes = shapes.map((q) => q.box);
        markup = emit(shapes);
      }
      if (markup.length > MAX_LOGO_BYTES) throw new Error(`markup ${markup.length} bytes (> ${MAX_LOGO_BYTES})`);
      if (/NaN|undefined|Infinity/.test(markup)) throw new Error("bad numbers in path");
    } catch (err) { errors.push(`${id} (${src}): ${err.message}`); continue; }
    seen.add(id);
    packs[pack].push([id, "", markup]);
    const al = aliases.split(",").map((a) => a.trim()).filter(Boolean);
    // a wordmark (much wider or taller than the 24 grid's square) carries its content box so a borderless logo can be scaled by aspect: [x, y, w, h], 1 dp
    const cx0 = Math.min(...boxes.map((b) => b[0])), cy0 = Math.min(...boxes.map((b) => b[1])), cx1 = Math.max(...boxes.map((b) => b[2])), cy1 = Math.max(...boxes.map((b) => b[3]));
    const ar = (cx1 - cx0) / (cy1 - cy0);
    const r1 = (n) => Math.round(n * 10) / 10;
    index.push(ar > 1.35 || ar < 0.74 ? [id, name, al, cat, pack, "logo", [r1(cx0), r1(cy0), r1(cx1 - cx0), r1(cy1 - cy0)]] : [id, name, al, cat, pack, "logo"]);
    for (const r of replaces.split(",").map((a) => a.trim()).filter(Boolean)) hides.add(r);
    const S = SOURCES[kind];
    manifest.push({ id, name, group, source: `${S.pkg}@${S.version}`, key, licence: S.licence, upstream: S.upstream, colour: upstreamHex, ...(replaces ? { replaces: replaces.split(",").map((a) => a.trim()) } : {}) });
  }
}

// the drawn ids a logo replaces must exist, or the catalog has a typo
const drawn = new Set(JSON.parse(readFileSync(join(ROOT, "src/packs/index.json"), "utf8")).icons.map((r) => r[0]));
for (const r of hides) if (!drawn.has(r)) errors.push(`replaces: "${r}" is not a drawn icon id`);

if (errors.length) { console.error(errors.map((e) => "  x " + e).join("\n")); console.error(`\n${errors.length} problem(s); nothing written.`); process.exit(1); }

const packsDir = join(ROOT, "src", "packs");
mkdirSync(packsDir, { recursive: true });
let total = 0;
const kb = (n) => (n / 1024).toFixed(1);
for (const [pack, icons] of Object.entries(packs)) {
  const body = JSON.stringify({ v: 2, pack, icons });
  writeFileSync(join(packsDir, `${pack}.json`), body);
  total += icons.length;
  console.log(`pack ${pack.padEnd(22)} ${String(icons.length).padStart(3)} logos  ${kb(Buffer.byteLength(body)).padStart(6)} KB raw  ${kb(gzipSync(body).length).padStart(5)} KB gz`);
}
writeFileSync(join(packsDir, "logos-index.json"), JSON.stringify({ v: 2, icons: index, hides: [...hides].sort(), groups: Object.entries(GROUPS).map(([k, [label]]) => [`logos-${k}`, label]) }));
writeFileSync(join(ROOT, "icons/logos/manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`ok: ${total} logos in ${Object.keys(packs).length} packs; hides ${hides.size} drawn vendor icons`);
void notes;
