// Regenerates public/icon.svg and the PNG app icons. Usage: PUPPETEER_DIR=<node_modules dir> node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const INK = "#26323b", PAPER = "#f5f1e6", RED = "#c2412d";

// a drafting sheet: double border, three nodes joined by red-pencil arrows, a title block
const art = `
<rect x="56" y="56" width="400" height="400" fill="none" stroke="${INK}" stroke-width="10"/>
<rect x="78" y="78" width="356" height="356" fill="none" stroke="${INK}" stroke-opacity=".45" stroke-width="4"/>
<rect x="108" y="130" width="112" height="84" rx="12" fill="#2b6f9e" fill-opacity=".14" stroke="#2b6f9e" stroke-width="10"/>
<rect x="292" y="130" width="112" height="84" rx="12" fill="#6a4fa3" fill-opacity=".14" stroke="#6a4fa3" stroke-width="10"/>
<rect x="200" y="272" width="112" height="84" rx="12" fill="#2e7d4f" fill-opacity=".14" stroke="#2e7d4f" stroke-width="10"/>
<g fill="none" stroke="${RED}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
  <path d="M228 172H280M266 156l16 16-16 16"/>
  <path d="M348 222V246H256V262M240 248l16 16 16-16"/>
</g>
<rect x="336" y="352" width="98" height="82" fill="none" stroke="${INK}" stroke-width="5"/>
<path d="M336 378H434M336 406H434M385 378V434" stroke="${INK}" stroke-width="4"/>`;

const svg = (inner, full) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512"${full ? "" : ' rx="96"'} fill="${PAPER}"/>${inner}</svg>\n`;
writeFileSync(join(root, "icon.svg"), svg(art, false));
const maskable = svg(`<g transform="translate(76.8 76.8) scale(.7)">${art}</g>`, true);

const require = createRequire((process.env.PUPPETEER_DIR ?? "/home/sys2026/Personal/blog-visuals/node_modules") + "/");
const puppeteer = require("puppeteer-core");
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
try {
  const p = await b.newPage();
  for (const [name, markup, size] of [["icon-192.png", svg(art, false), 192], ["icon-512.png", svg(art, false), 512], ["icon-maskable-512.png", maskable, 512]]) {
    await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await p.setContent(`<body style="margin:0;background:transparent">${markup.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body>`);
    await p.screenshot({ path: join(root, name), omitBackground: true });
  }
} finally { await b.close(); }
console.log("wrote icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png");
