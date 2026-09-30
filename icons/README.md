# archypaint-icons

System-design icons in two tiers, drawn in-house (MIT), shipped as separate packs (`core`, `generic2`, `oss`, `aws`, `gcp`, `azure`).

| tier | file | grid | use |
|---|---|---|---|
| detailed | `svg/<id>.svg` | 64×64, stroke 2 | large / zoomed-in; the "realistic" drawing |
| glyph | `svg/<id>.glyph.svg` | 24×24, stroke 1.75 | normal zoom, toolbars, lists |

`manifest.json` is the `core` pack; every other pack is a fragment `manifests/<pack>.json` with the same row shape (`id`, `name`, `aliases` (search words), `category`, `files`, `batch`, optional `vendor`: `aws|gcp|azure|oss`). Vendor-pack icons are **original drawings** of what a service does, never copies of a vendor's logo or official icon; the service name is used only to say what the icon stands for.
Categories map to the app's colour tokens: `data cache network compute queue security client external`.

## Rules (enforced by `scripts/build.mjs`)

- **One colour.** Only `currentColor` or `none`. Recolour with CSS `color`; category, theme, fill style are applied at render time.
- Strokes round-capped/round-joined. Washes are `fill="currentColor"` with `fill-opacity` (.06–.3); small solid details (LEDs, dots) up to .95.
- **No** gradients, filters, shadows, `<style>`, `<text>`, images, `<use>`, `<defs>`, clip paths, `url()`.
- Detail only where it aids recognition (LEDs, drive slots, pins, ports, tick marks). Never texture.
- Keep ~4px margin inside the 64 grid. Every icon needs both tiers and a manifest row.
- No vendor logos in this package, ever (see the project README §4.7). Vendor packs may name the service in `name`/`aliases` — that is nominative use, and the palette shows a "not affiliated" note next to them.

## Add an icon

1. Draw `svg/<id>.svg` (64) and `svg/<id>.glyph.svg` (24) following the rules above; ids are kebab-case.
2. Add a manifest row (`batch` = the rollout batch).
3. `npm run build` — fails non-zero on any violation, emits `dist/sprite.svg` (`<symbol id="<id>">` and `<symbol id="<id>-glyph">`), `dist/manifest.json`, and the app chunks `../src/packs/index.json` (search metadata for every icon) + `../src/packs/<pack>.json` (SVG markup). `node scripts/build.mjs --only=<pack>` validates a single pack and writes nothing.
4. `PUPPETEER_DIR=<node_modules with puppeteer-core> npm run sheet` (and `sheet:dark`), then look at `dist/contact-sheet*.png`.

## Use

```html
<svg width="64" height="64" style="color:#2b6f9e"><use href="sprite.svg#sql-database"/></svg>
```

## How the app loads packs

`src/packs/index.json` is one small chunk (metadata only). Each `src/packs/<pack>.json` is its own chunk. Drawing an icon requests only that icon's pack; opening the palette (or exporting) requests all of them. A chunk that fails to load leaves the icon as a plain tile and is retried at most every few seconds.

## User icon packs (bring your own icons)

Official vendor icon sets can't be redistributed, so the palette can load them from **your** files: palette → `Load icon pack…`, choose a `.archipack.json`. Packs are stored in your browser (IndexedDB) and never uploaded.

```json
{
  "v": 1,
  "name": "Acme Cloud",
  "icons": [
    {
      "id": "widget",
      "name": "Acme widget",
      "aliases": ["acme", "widget"],
      "category": "compute",
      "detail": "<rect x=\"8\" y=\"8\" width=\"48\" height=\"48\" rx=\"8\" fill=\"currentColor\" fill-opacity=\".15\"/><circle cx=\"32\" cy=\"32\" r=\"12\"/>",
      "glyph": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"3\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/>"
    }
  ]
}
```

- `detail` is the inner markup for a 64×64 grid (stroke 2), `glyph` for 24×24 (stroke 1.75). No `<svg>` wrapper.
- Only self-closing `rect circle ellipse line polyline polygon path`; attributes limited to geometry, `fill`/`stroke` (`currentColor` or `none` only), opacities, `stroke-width`, `stroke-dasharray`, `stroke-linecap`, `stroke-linejoin`. Anything else — scripts, `<g>`, `href`, `url()`, colours, event attributes — rejects the whole pack with a message.
- Limits: 2000 icons, 5 MB, 8000 characters of markup per tier, `id` kebab-case (max 60), `category` one of `data cache network compute queue security client external`.
- Icons appear as `user-<pack>-<id>`, grouped under the pack's name; `remove` in the palette deletes the pack.
