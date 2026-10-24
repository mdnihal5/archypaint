# archypaint

A fast, free, offline system-design whiteboard. Canvas2D, no framework, no login.
Design and reasoning: `../todo-projects/archypaint/README.md` (the plan and every decision behind it).

```
npm install
npm run dev          # http://localhost:5173
npm run check        # typecheck + unit tests + build + bundle-size budget
npx vitest run       # unit tests only
npm run size         # entry <= 68 KB gzip, every lazy chunk <= 30 KB gzip (after a build)
npm run perf -- 5000 --mixed   # 5,000 realistic elements: idle frames, JS ms/frame, heap growth (add --noflow to isolate the animation)
node perf/interact.mjs  |  node scripts/ui-check.mjs  |  node scripts/present-check.mjs  |  npm run perf:images  |  npm run perf:tidy
```
The Puppeteer scripts read `PUPPETEER_DIR` (a node_modules containing `puppeteer-core`) and use `/usr/bin/google-chrome`.

## What it does
Drawing and editing (shapes, connectors that stay attached (a bound connector never comes unglued by dragging its body; on an elbow that drag pushes the segment under the pointer, and a midpoint handle does the same), connectors that branch from another connector, and can carry several labels each, groups you can grab anywhere and bind connectors to, named icons, text sizes and alignment, wrapped labels, type-to-edit labels, layers, align, find, minimap, undo) · 269 real brand logos (databases, caches, queues, CDNs, clouds and their services, observability, auth, CI/CD, clients, languages...) in 20 lazy category packs, in their brand colours, offline · 321 original generic icons as a secondary pack · insert image / SVG · **Y** auto-tidy layout · **C** capacity notes (back-of-envelope maths, with starter templates: URL shortener, chat, feed, video, file storage, CRUD) · diagram from text or Mermaid · **P** present mode · read-only share link (no backend) · autosave, PNG / SVG / Excalidraw export, offline · flow animation on pointed arrows · double-click a tool to keep it active.

Keys worth knowing: `/` icon search, `I` show / hide the properties panel (drag its header to move it, double-click the header to put it back), `C` capacity note, `?` the full list.

## Layout
| path | what |
|---|---|
| `src/scene.ts` `viewport.ts` | flat element map, grid spatial index, pan/zoom |
| `src/renderer.ts` | two stacked canvases (static / live), frame scheduler, culling, LOD |
| `src/editor.ts` `input.ts` `history.ts` `connectors.ts` `groups.ts` `text-edit.ts` | editing: commands (undo-able), routing, groups, z-order |
| `src/editor-api.ts` | the one seam between the engine and UI / palette / I/O |
| `src/icons.ts` `icon-pack.ts` `palette.ts` | vector icon rendering (lazy pack) and the `/` search |
| `src/ui/*` | chrome: home sheet, tool strip, panels, layers (virtualised) |
| `src/io/*` | `.archypaint` format, IndexedDB autosave, files, PNG/SVG, Excalidraw, offline |
| `src/features/*` | menu/keyboard actions contributed by features; each feature's code is a lazy chunk (tidy, calc, text import, present, share, images) |
| `src/layout.ts` `calc.ts` `textdsl.ts` `images.ts` `logos.ts` `share.ts` `present.ts` | the lazily loaded feature implementations |
| `icons/` | the standalone drawn icon library (two tiers each) and the brand-logo catalog + build (`npm run logos`) — see `icons/README.md` |
| `src/logos.ts` | logo helpers: theme variants of a logo's colours, old-id aliases (the artwork lives in `src/packs/logos-*.json`) |

## Rules the code is held to
- Nothing schedules a frame while idle; only `invalidate()` / `wake()` do. Input is coalesced and applied once per frame.
- Every listener, timer and subscription has a matching teardown (`destroy()` / `dispose()`), covered by tests.
- Hot paths allocate nothing per frame; history stores patches, is capped by step count AND total snapshots, and never clones the scene.
- Features load on first use; the entry chunk has a hard budget (`npm run size`). Every parser (text, Mermaid, calc, SVG, share links, images) has size, depth and time limits and reports errors instead of throwing.
- Brand logos are bundled artwork (no runtime fetch, no opt-in), one lazy chunk per category, each inside the 30 KB gzip budget; sources and licences are recorded per logo in `icons/logos/manifest.json` and summarised in `icons/README.md`. Trademarks belong to their owners; the palette says so. The 321 generic icons are original drawings.

MIT.
