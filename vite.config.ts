import { defineConfig } from "vite";

export default defineConfig({
  // one id per build: the page registers /sw.js?v=<id>, so each build gets its own worker + cache and old caches are dropped on activate
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  build: {
    target: "es2022",
    sourcemap: false,
    // lists every emitted chunk (including lazy ones) so the service worker can precache the whole app for offline use
    manifest: "asset-manifest.json",
  },
});
