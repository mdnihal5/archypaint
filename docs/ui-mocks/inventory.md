# archypaint UI inventory (the contract)

Source of truth: `src/ui/*.ts`, `src/palette.ts`, `src/features/*`, `src/ui/ui.css` at branch `development`, read 2026-10-24.
Every ID below must exist in each direction in README.md (it may move or be grouped, never dropped).
Measured by running the real app (before-*.png) and by reading source; "Verified" = seen in a screenshot or measured in the DOM.

Legend for "shows": always / only when X.

---

## P. Icon search palette (`/`, `src/palette.ts`)

Opens as a centred modal dialog (720 px wide, ~650 px tall at 900 px viewport), full-screen click-away layer, covers the middle of the diagram (before-*-palette.png).

| ID | Control / content | Notes |
|---|---|---|
| P1 | Search input, "/" glyph, placeholder "place an icon", 28 px type | opens with `/` (or click on the welcome line / the red "icons" button) |
| P2 | Example hint line "load balancer · cron job · read replica · service worker · message queue" | only while the query is empty |
| P3 | Category chips: All, SQL, NoSQL, Wide-column, Time-series, Analytics, Cache, Queues, CDN & edge, Gateways, Compute, Cloud, Storage, Observability, Auth, CI/CD, Clients, Frontend, Languages, AI/ML, Services (20 logo categories) | one row, horizontally scrolled, fades at the edge; `Tab` cycles the chip |
| P4 | "Generic icons" button (the 321 drawn icons, secondary) | |
| P5 | Generic icon-set `<select>` (core / generic2 / oss / vendor packs / user packs) | only when the generic source is active; `Alt+←/→` steps through the sets |
| P6 | Result list, grouped by category with section headings (e.g. RELATIONAL DATABASES), virtualised, up to 400 rows | each row: 32 px badge, name, alias text, right-hand tag (category, "shape", or "recent") |
| P7 | Recents (last 8 placed), shown when the query is empty | tag reads "recent" |
| P8 | Basic shapes are searchable as entries (rectangle, cylinder, ...), kind "shape" | |
| P9 | Trademark note ("Trademarks belong to their owners; no endorsement implied. Drawn vendor icons are original art.") | whenever logos or drawn vendor icons are listed |
| P10 | User icon packs: list of loaded packs each with a "remove" button | only when a user pack exists |
| P11 | Status/error message line (pack load result) | only after a load |
| P12 | Footer key legend: ↑↓ move, ⏎ place, tab category, alt ←→ icon set, esc close | always |
| P13 | "Load icon pack…" button (file picker, .json) | always |
| P14 | Keyboard: `↑ ↓` move, `Enter` place, `Esc` close, `Tab` next category, `Alt ←/→` icon set | |

## M. Main menu (bottom-right ≡, `src/ui/top.ts` + `features/*`)

Button sits bottom-right (32 px square) under the minimap. The menu opens as a 660 px, two-column panel above it, hides the properties panel while open (`data-menu`), closes on Esc / outside click, arrow-key navigation.

Left column
| ID | Item | Shortcut | Notes |
|---|---|---|---|
| M1 | New | | asks to discard if unsaved |
| M2 | Open… | ⌘O | asks to discard if unsaved |
| M3 | Save | ⌘S | |
| M4 | Save as… | ⇧⌘S | |
| M5 | Export PNG | ⇧⌘E | 2x, with background |
| M6 | Export selection as PNG | | only when something is selected |
| M7 | Export SVG | | |
| M8 | Copy as PNG | | |
| M9 | Import Excalidraw… | | asks to discard if unsaved |
| M10 | Export Excalidraw | | |
| M11 | Tidy layout (section "Arrange") | Y | selection of 2+, else whole sheet; undoable |
| M12 | Present (step through) (section "Present") | P | lazy chunk; opens presentation overlay |
| M13 | Copy share link (section "Share & import") | | read-only link in the URL fragment, nothing uploaded |

Right column
| ID | Item | Notes |
|---|---|---|
| M14 | Theme: light / dark / system | (also the sun/moon button top-right, which only flips light/dark) |
| M15 | Background: grid / plain | key `B` |
| M16 | Sheet frame on/off | border, zone letters, title block; default off |
| M17 | Layers panel on/off | default off |
| M18 | Minimap on/off | key `M`; default on |
| M19 | Flow animation on/off | dots travelling along pointed arrows |
| M20 | Status footer on/off | shapes / visible / frame ms; default off |
| M21 | Find… | ⌘F |
| M22 | Legend of categories and lines | inserts a legend element |
| M23 | Renumber step badges | |
| M24 | Capacity note (QPS, storage…) | C; opens a template picker (URL shortener, chat, feed, video, file storage, CRUD) |
| M25 | Insert image or SVG… | multi file picker; also drop / paste |
| M26 | Diagram from text… | opens the text / Mermaid import modal (see Q) |
| M27 | New shapes: Edge sharp / round / soft | defaults for new shapes |
| M28 | New shapes: Fill outline / tint / solid | defaults for new shapes |
| M29 | Keyboard shortcuts | `?`; opens the shortcut modal |

Duplicate entry points found: theme (M14 + sun/moon), minimap (M18 + key M), background (M15 + key B), legend and renumber (M22/M23 + the shapes flyout "Insert"), find (M21 + ⌘F only), properties (top-right button + `I` + narrow-screen button).

## R. Properties panel (`I` or the sliders button top-right; draggable; never opens on selection)

420 px wide, two-column grid, floating card at top-right (position remembered once dragged, double-click header resets). Hidden while a label is being typed. Verified in before-*-props.png.

| ID | Row | Shows when |
|---|---|---|
| R1 | Header: "Selection" + kind or count ("arrow", "3 selected", "nothing selected"), drag handle, Delete button (trash, ⌫) | always while open; delete disabled when empty or locked |
| R2 | Colour: 24 swatches (the category colours) + custom hex field with preview dot | selection non-empty |
| R3 | Fill: outline / tint / solid / none | "none" (no tile) only when every selected element is a brand logo |
| R4 | Edge: sharp / round / soft | selection non-empty |
| R5 | Dashed toggle | selection non-empty |
| R6 | Text size: S / M / L / XL | any selected element with free text (not brace, badge, calc, legend, image, lane) |
| R7 | Text align: left / centre / right | selected elements that have alignable text (not connectors, icons, brace, badge, calc, legend, image, lane) |
| R8 | Route: straight / elbow / curve | a connector is selected |
| R9 | Brace points: left / right / up / down | only braces selected |
| R10 | Lanes run as: rows / columns | only swimlanes selected |
| R11 | Align: left, centre H, right, top, middle V, bottom (⌥⇧ + arrow / H / V) | 2+ movable elements |
| R12 | Distribute H / V (needs 3+), match width, match height, match size (⌥⇧X / Y / S) | 2+ movable elements |
| R13 | Arrange: front (⇧⌘]), forward (⌘]), backward (⌘[), back (⇧⌘[) | selection non-empty |
| R14 | Group (⌘G), Ungroup (⇧⌘G, disabled if nothing grouped / locked) | selection non-empty |
| R15 | Group name field | when the selection is exactly one group |
| R16 | Lock / "lock group" toggle (⇧⌘L) | selection non-empty |
| R17 | Copy style (⌥⌘C), Paste style (⌥⌘V) | selection non-empty |
| R18 | Empty-state note "Select something on the canvas to style it. I closes this panel." | nothing selected |
| R19 | Tip line "double-click a group's name to rename it · Enter or just typing edits the selected shape's text · z-order acts on the whole group" | always (while open) |

Not in the panel but on selection: Delete, Duplicate (⌘D), Select all (⌘A), nudge (arrows), type-to-edit (just type), Enter to edit.

## T. Top bar

| ID | Control | Notes |
|---|---|---|
| T1 | Sheet name input (dotted underline, 244 px) | bound to the document name; Enter / Esc |
| T2 | Save state text: "saved / unsaved / saving… / save failed" | accent colour when unsaved or failed |
| T3 | Properties toggle (sliders icon) | top-right, left of the brand; hidden under 900 px (replaced by T7) |
| T4 | Brand: mark + "archypaint" wordmark | decorative, no pointer events; word hidden under 900 px |
| T5 | Theme toggle (sun / moon) | light/dark flip |
| T6 | Welcome (only while the scene is empty): "/ place an icon" command line with blinking caret, example hint line, "General notes" list (5 numbered lines), ghost diagram of dashed slots | the only place where `/` is advertised on the canvas |
| T7 | Narrow-screen (<900 px) buttons: Properties, Layers | replace the right column on phones |

## K. Tool strip (left, vertical)

| ID | Tool | Key |
|---|---|---|
| K1 | Select | V |
| K2 | Hand (or hold Space) | H |
| K3 | Rectangle | R |
| K4 | Diamond | D |
| K5 | Ellipse | O |
| K6 | Arrow | A |
| K7 | Line | L |
| K8 | Text | T |
| K9 | More shapes flyout: Database(cylinder), Cloud, Hexagon, Parallelogram, Triangle, Star, Sticky note, Brace, Step badge, Frame / region, Swimlane; plus "Insert": Legend, Renumber badges | no letter keys |
| K10 | Red "icons" button (opens P) | `/` |
| K11 | Tool lock: double-click a creation tool keeps it active (dot marker), `Q` releases | rect, diamond, ellipse, arrow, line, text only |
| K12 | Key letters printed in each button's corner (9 px) | |

## B. Bottom bar and footer

| ID | Control | Notes |
|---|---|---|
| B1 | Zoom out (−) | |
| B2 | Zoom percent button (click = reset, ⌘0) | |
| B3 | Zoom in (+) | |
| B4 | Fit to content (⇧1) | |
| B5 | Undo (⌘Z) | disabled when empty |
| B6 | Redo (⇧⌘Z) | disabled when empty |
| B7 | Menu button (≡) | far bottom-right, see M |
| F1 | Status footer: "N shapes · N visible · idle \| x ms · p95 x ms · simplified" | setting M20, default off, hidden under 1100 px |
| F2 | Title block (310 x 94 px, bottom-right): ARCHYPAINT / SHEET 01 / 01, TITLE (editable), SCALE (editable), STYLE (readout of new-shape defaults), REV (editable) | only with "Sheet frame" on; hidden under 900 px |
| F3 | Sheet frame: double border, zone letters 1-8 / A-D | only with "Sheet frame" on |

## L. Layers panel (right column, under properties)

| ID | Control |
|---|---|
| L1 | Header "Layers" + count |
| L2 | Virtualised row list: caret to expand / collapse groups, colour dot, name, bold for groups |
| L3 | Click selects, shift/ctrl multi-select, double-click renames a group, selection syncs with canvas |
Shows only when setting M17 is on and the scene is non-empty.

## N. Minimap

| ID | Control |
|---|---|
| N1 | 202 x 138 minimap card, bottom-right, left of the menu button, shows elements by category colour + the viewport rectangle |
| N2 | Click or drag to move the view |
| N3 | Toggle with `M` / M18; hidden under 900 px |

## D. Find bar (⌘F)

| ID | Control |
|---|---|
| D1 | Search input "find a label, icon or group" (searches labels, icon names, arrow labels, group names) |
| D2 | Match count ("2 / 5") |
| D3 | Previous (⇧Enter) / Next (Enter) |
| D4 | Close (Esc) |
Pans and zooms to the current match and highlights it.

## Q. Dialogs and overlays reachable from the above

| ID | Overlay | Contents |
|---|---|---|
| Q1 | Keyboard shortcuts modal (`?`) | 9 groups: Tools, Icons, Edit, Arrange, Align & distribute, Style & lock, Features, View, File |
| Q2 | Discard-changes confirm | Cancel / Discard |
| Q3 | Diagram from text modal | textarea, syntax help line, "text" and "Mermaid" example buttons, live status + diagnostics, Cancel / Import |
| Q4 | Capacity-note template picker | starters: URL shortener, chat, feed, video, file storage, CRUD |
| Q5 | Present mode | step-through overlay; share-link read-only bar ("Make the copy" to edit) |
| Q6 | Share-link card | link field + note |

## X. Toasts, hints and keyboard-only

| ID | Item |
|---|---|
| X1 | Toast stack (max 3, bottom centre): "Saved", "Save failed", tidy result, import counts, share link copied, calc note hint, SW update ("A new version of archypaint is ready...") |
| X2 | Hints: palette example line (P2), welcome notes (T6), properties tip (R19), toast after capacity note |
| X3 | Keys with no on-screen control: `Y` tidy, `C` capacity note, `P` present, `B` background, `M` minimap, `I` properties, `Q` release tool, `⌘A`, `⌘D`, nudge arrows, Space = hand, `+`/`-` zoom, Esc deselect |

---

## Clutter and structure problems found (evidence in before-*.png)

1. **Chrome is scattered over all four corners plus the left edge**: name/save top-left, props + brand + theme top-right, tools left, zoom+history bottom-left, minimap + menu bottom-right. Six separate clusters, none aligned to another (Verified).
2. **Menu is the least findable control**: it is a 32 px glyph in the bottom-right corner, stacked under the minimap, and the same position as the title block when the frame is on. Every other app puts it top-left.
3. **Menu mixes three different things in one 660 px sheet**: documents (file / export / import / share), actions (tidy, present, insert, find), and persistent view settings (7 toggles with on/off segmented controls). It has 29 items, two columns of unequal weight, and 5 headings, of which "Arrange", "Present", "Share & import" hold one item each.
4. **Settings rows are heavier than commands**: every setting costs a full row with a two-button segmented control; "on / off" toggles are drawn like radio groups.
5. **Properties panel is 420 x ~530 px at the top-right** and in the before shot covers the right third of the diagram (the "backend" group and Redis row). Two-column layout is wide, not short, so it covers more of the canvas horizontally. 19 rows visible at once for a single connector, including rows that do nothing for it (fill outline/tint/solid for a connector, text align hidden but text size shown).
6. **Palette is a centred modal that hides the diagram** and gives the placement location no feedback; it is a single long list (1 icon per 44 px row), 9-10 results visible at once, with a 28 px input and a hint line above 20 category chips that scroll off the edge ("C" is cut in the screenshot). The generic icons are one small button on the far right of the chip row.
7. **Footer title block** (310 x 94 px): decorative, repeats the sheet name already in the top-left input, STYLE cell is truncated ("outli…"), only with frame on. It also collides with the menu button position in the corner.
8. **Hints are stacked in four places** (welcome notes, hint line, palette hint, properties tip) and there are three overlapping layers of shortcut display: letters in tool corners (9 px), tooltips, and the "?" modal.
9. **Duplicate entry points**: theme x2, properties x3, minimap x2, find only by keyboard or menu, legend/renumber x2, icons x3 (button, `/`, welcome line).
10. **Typography**: `--mono` (JetBrains Mono, falls back to DejaVu Sans Mono on any machine without it; the font is not bundled) is used for every role, 9 to 34 px; `--sans: Lato` is declared in ui.css and used by nothing. Uppercase tracked labels appear in menu, panel, palette, notes.
11. **Contrast of hairlines in dark**: `--line` is 50 % alpha and `--line-soft` 24 %, so every card and divider in dark mode is a bright outline; borders, radius and shadow are all used at once on every panel (14 px radius cards next to square drafting-style flyouts and a 16 px / 18 px menu / palette).
12. **Selection feedback is weak**: a selected connector shows two ring handles but no change of weight or colour along the line (visible in the before-dark-props capture and the bg captures).
13. **Minimap is the biggest single piece of chrome at idle** (202 x 138 = 27.9 k px², 3.4 % of a 1440 x 900 window, bigger than the tool strip), on by default, and it shows a diagram that is already fully visible.
