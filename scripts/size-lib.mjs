// What a first visit really downloads and parses before the app runs: the entry, every chunk index.html loads or modulepreloads,
// and every chunk those import statically (a static `from "./x.js"` is fetched even when no <link> names it).
// Dynamic `import("./x.js")` is lazy and is not followed.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

/** js files named by <script src> and <link rel=modulepreload href> in the page, as paths relative to dist/ */
export function htmlJs(html) {
  const out = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="\/?([^"]+\.js)"/g)) out.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/?([^"]+\.js)"/g)) out.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\bhref="\/?([^"]+\.js)"[^>]*\brel="modulepreload"/g)) out.add(m[1]);
  return [...out];
}

/** chunks a module imports statically (`import x from "./a.js"`, `export {..} from "./a.js"`, `import "./a.js"`), not `import("./a.js")` */
export function staticImports(code) {
  const out = new Set();
  for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["'`]\.\/([^"'`]+\.js)["'`]/g)) out.add(m[1]);
  return [...out];
}

/** every js file loaded at startup, as {file, gz} (gzip bytes), entry first. `read(file)` returns a chunk's bytes from dist/assets */
export function startupFrom(html, read) {
  const seen = new Map();
  const queue = htmlJs(html);
  while (queue.length) {
    const file = queue.shift().replace(/^assets\//, "");
    if (seen.has(file)) continue;
    const code = read(file);
    seen.set(file, gzipSync(code).length);
    for (const dep of staticImports(Buffer.from(code).toString("utf8"))) queue.push(`assets/${dep}`);
  }
  return [...seen].map(([file, gz]) => ({ file, gz }));
}

export const startupSet = (dist) => startupFrom(readFileSync(join(dist, "index.html"), "utf8"), (f) => readFileSync(join(dist, "assets", f)));
