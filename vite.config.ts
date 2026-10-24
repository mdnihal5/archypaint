import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

/** how many brand logos the catalog bundles: the dock's search field says it ("Search 269 logos") without loading the catalog */
const logoCount = (JSON.parse(readFileSync(new URL("./src/packs/logos-index.json", import.meta.url), "utf8")) as { icons: unknown[] }).icons.length;

export default defineConfig({
  // one id per build: the page registers /sw.js?v=<id>, so each build gets its own worker + cache and old caches are dropped on activate
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)), __LOGO_COUNT__: JSON.stringify(logoCount) },
  build: {
    target: "es2022",
    sourcemap: false,
    // lists every emitted chunk (including lazy ones) so the service worker can precache the whole app for offline use
    manifest: "asset-manifest.json",
  },
});
