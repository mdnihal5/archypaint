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
- No vendor logos in the *drawn* set. Real brand logos are a separate, generated set (below). Drawn vendor packs may name the service in `name`/`aliases` — nominative use, and the palette shows a "not affiliated" note next to them.

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

## Brand logos (bundled, default)

The palette lists **real brand logos first**, grouped by category (relational databases, document / key-value, wide-column and graph,
time-series and search, warehouses and OLAP, caches, queues and streaming, CDN / DNS / edge, load balancers / proxies / gateways,
containers / orchestration / serverless, cloud providers, object storage, observability, auth / identity / secrets, CI/CD and IaC,
clients / browsers / OS, frontend frameworks, languages / backend frameworks, AI / ML, payments / messaging / other services).
The drawn icons stay as the secondary "Generic" / "Drawn: ..." sources. Drawn vendor icons that a real logo now replaces are not
listed any more (saved diagrams that use them still render).

- **Catalog:** `icons/logos/catalog.mjs` (what, names, search aliases, grouping, which drawn icons each logo replaces).
- **Build:** `npm run logos` (`icons/scripts/build-logos.mjs`) reads the pinned npm packages and writes `src/packs/logos-<category>.json`
  (one lazy chunk each, all inside the 30 KB gzip budget), `src/packs/logos-index.json` and `icons/logos/manifest.json` (id, source
  package + version, licence, upstream colour). The output is committed; the app builds without running it.
- **Artwork rules:** flat colour (gradients become their mean colour, faint shadow overlays are dropped), `<path>` only, 24 grid.
  Logos draw in their **brand colours**. A mark that would vanish on a theme's paper (near-black on dark, near-white on light) carries
  a replacement colour for that theme (`data-d` dark / `data-l` light; decided at build time from contrast): greys switch to the theme ink,
  coloured marks are lightened / darkened until readable. On a solid-filled tile every mark is drawn in one contrast colour instead.
- **Offline:** bundled, so they work offline; nothing is fetched at runtime and there is no opt-in.
- **Old ids:** logo ids are `logo-<slug>`; the Simple Icons slugs of the previous opt-in logos are unchanged. `logo-linuxfoundation`
  (dropped) resolves to `logo-linux` (`ICON_ALIASES` in `src/logos.ts`). Drawn ids are untouched.

### Sources and licences

| source (pinned, devDependency) | licence | used for |
|---|---|---|
| [`simple-icons@16.33.0`](https://github.com/simple-icons/simple-icons) | CC0-1.0 | most single-colour brand marks; official brand colour |
| [`@iconify-json/logos@1.2.17`](https://github.com/gilbarbara/logos) (gilbarbara/logos) | CC0-1.0 | brands Simple Icons lacks (AWS and its services, Azure, Oracle, Memcached, DynamoDB, gRPC, Slack, Twilio, Heroku, ...) |
| [`@iconify-json/gcp@1.2.3`](https://cloud.google.com/icons) (Google Cloud icons) | Apache-2.0 | Google Cloud services |

The licence covers the *artwork files*. The marks themselves remain their owners' trademarks; logos are included to identify the
technology (nominative use) and imply no endorsement. AWS's published terms for its architecture icons only mention use in diagrams
and materials; they do not address redistribution inside software, so check with AWS before shipping a product built on the
`aws-*` service logos. Google Cloud's icon terms could not be read from the page, the Apache-2.0 statement comes from the Iconify
packaging. Each logo's exact source is in `icons/logos/manifest.json`.

**Not covered by a clean source** (kept as archypaint's own drawn icons): HAProxy, Redpanda, ActiveMQ, ZeroMQ, Varnish, Hazelcast, Zipkin, Loki,
Pinot, Ignite, Dragonfly, Db2, SQL Server, JanusGraph, QuestDB, and the Azure *service* icons (Microsoft's pack is licensed for diagrams only).
Azure itself has its logo.
