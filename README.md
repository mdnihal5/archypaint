# archypaint

A fast, free, offline system-design whiteboard. Canvas2D, no framework, no login.
Design and reasoning: `../todo-projects/archypaint/README.md` (the plan and every decision behind it).

```
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build (adds the offline service worker)
npx vitest run     # unit tests
npm run perf       # 5,000-shape benchmark: idle frames, JS ms/frame, heap growth
node perf/interact.mjs   # real mouse/keyboard flows + 200 undo/redo cycles + heap check
node scripts/ui-check.mjs # UI end-to-end (needs a built app and Chrome)
```
The two Puppeteer scripts read `PUPPETEER_DIR` (a node_modules containing `puppeteer-core`) and use `/usr/bin/google-chrome`.

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
| `icons/` | the standalone icon library (66 icons, two tiers each) — see `icons/README.md` |

## Rules the code is held to
- Nothing schedules a frame while idle; only `invalidate()` / `wake()` do. Input is coalesced and applied once per frame.
- Every listener, timer and subscription has a matching teardown (`destroy()` / `dispose()`), covered by tests.
- Hot paths allocate nothing per frame; history stores patches, is capped, and never clones the scene.

MIT.
