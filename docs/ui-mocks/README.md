# archypaint UI directions (mockups only)

Nothing under `src/` was touched. `A.html`, `B.html`, `C.html` are self-contained (inline CSS, JS, logos, diagram image; no network). Open with `?s=<state>&t=light|dark`.
States: `idle search menu conn logo` (A, B, C), plus `view layers` (B) and `menu-import menu-view` (C). Mobile: open at 390 px wide.
Contract: `inventory.md` (every control, with IDs P*, M*, R*, T*, K*, B*, F*, L*, N*, D*, Q*, X*).

What the mocks are: the diagram is a real screenshot of the running app's canvas (client, CDN, NGINX LB, two Node APIs, Redis, Kafka, Go worker, Postgres, a "backend" group, labelled connectors; real logos), chrome hidden, so the diagram is pixel-true; everything else is HTML. Static: no interaction, nothing was tested with real input. Logos in the search mocks are the real bundled artwork.

## Files

- Before (real app, 1440x900): `before-{light,dark}-{idle,palette,menu,props}.png`, `before-light-frame-on-empty.png` (sheet frame + title block on).
- A "Dock": `A-{light,dark}-{idle,search,menu,conn,logo}.png`, `A-mobile-{search,conn}-light.png`
- B "Rails": `B-{light,dark}-{idle,search,menu,conn,logo}.png`, `B-light-view.png`, `B-light-layers.png`, `B-mobile-{search,conn}-light.png`
- C "Cursor": `C-{light,dark}-{idle,search,menu,conn,logo}.png`, `C-light-menu-import.png`, `C-light-menu-view.png`, `C-mobile-{search,conn}-light.png`

## Design changes common to all three (and why)

Kept: the palette tokens (paper, ink, mid, accent indigo in light / coral in dark, the 24 category colours), JetBrains Mono for diagram text, ids, numbers and key hints, the mark.

Changed:
1. **Borders became tone + shadow.** Dark `--line` is 50 % alpha today (every card is a bright outline); here lines are 11 % / 6.5 % and surfaces separate by tone (`--chrome` #222226 over paper #18181b) with a two-part shadow. Light is the same idea. Reason: chrome should recede (craft-notes A.2: border + tone + shadow together is noise).
2. **Two faces with different skeletons.** `--sans: Lato` is already declared in `ui.css` and used by nothing; everything is mono at 9 to 34 px. Here Lato carries labels and menu text, JetBrains Mono carries shortcuts, zoom %, aliases and hex. Type sizes: 11 / 12 / 13 / 15 only. Uppercase tracked section labels are gone (sentence case). Caveat: `frontend-design/references/used-looks.md` lists Lato + JetBrains Mono among the "same four system faces" I keep reaching for. Here they are inherited from the project's own tokens and are the only faces I could verify render on this machine, not a fresh pick; since point 6 below means a face has to be bundled anyway, choosing a distinctive sans at that moment is the better decision and changes nothing structural in these mocks.
3. **One radius scale** (8 controls, 13-16 panels) instead of 6 / 10 / 14 / 16 / 18 plus square drafting flyouts. Segmented controls are a recessed track with a raised thumb; toggles that are on/off are switches or chips, not two-button radio groups.
4. **The sheet-frame / title-block drawing metaphor is not used in any direction.** The setting stays (M16, F2, F3) but it is a non-default skin, not chrome.
5. **Not changed, flagged:** the light accent (indigo `#5b57d1`) is on the generic-AI list and differs from the dark accent (coral). I left it because the canvas selection colours derive from it; unifying on the coral/vermilion would be the single biggest identity win and is a separate decision.
6. **Pre-existing problem found:** neither JetBrains Mono nor Lato is bundled (no `@font-face`, `public/` has none). Anyone without them gets DejaVu. Bundling two subset woff2 files is needed for any of this typography to exist for users.

Canvas-area numbers below are bounding boxes at 1440x900 (measured in the real app's DOM and in each mock's DOM). The "diagram" bbox is the demo diagram (1260x330, 415,800 px²).

## Idle chrome area (px² the chrome occupies with nothing open)

| | idle chrome | share of 1440x900 | what it consists of |
|---|---|---|---|
| **Today**, defaults (frame off) | 75,961 | 5.86 % | name 285x29, props btn, brand 116x32, theme btn, tool strip + icons btn 54x448, zoom+undo 246x36, menu btn, minimap 202x138 |
| **Today**, frame + footer on | 109,540 + zone ring about 62,000 = about 171,600 | about 13 % | adds title block 314x94, status line, double border with zone letters |
| **A Dock** | 43,484 | 3.36 % | doc 115x34, panel pill 98x34, dock 683x46, zoom 134x36 |
| **B Rails** | 35,100 | 2.71 % | doc 144x36, tool rail 42x390, panel rail 42x150, history+zoom 201x36 |
| **C Cursor** | 47,688 | 3.68 % | doc 132x34, panel pill 135x36, tool rail 44x384, history+zoom 201x36, minimap 148x96 |

Where the minimap went: A shows it as a small chip only when the diagram is larger than the viewport or while panning; B moves it into the Layers tab ("Navigator"); C keeps it on at 148x96 (smaller). Setting M18 and key `M` exist in all three.

## Diagram covered while a panel is open (share of the diagram bbox hidden)

| open | Today | A | B | C |
|---|---|---|---|---|
| icon search | 57 % (720x655 centred modal) | 32 % (680x412, grows up from the dock) | 0 %, canvas re-fits to 69 % scale (328x796 docked drawer) | 11 % (344x372 beside the landing spot) |
| main menu | 46 % (660x653) | 39 % (800x419) | 0 %, 15 % of the bbox if the dropdown is left as an overlay (276x740; it is transient) | 15 % (252x495 + submenu 230x162) |
| properties, connector | 25 % (420x532) | 0 % (861x83 ribbon above the dock) | 0 %, canvas re-fits to 75 % (296x598 docked) | 8 % (300x373, draggable) |

B's "0 %" is a trade, not a free win: docking shrinks the diagram on screen (69 % / 75 % of its size) instead of covering it. The mock scales the real screenshot to show that; the real app would pan or fit-on-open.

---

## A. "Dock": one command bar

**Thesis.** A system-design diagram is mostly *inserting known things* (269 logos) and then connecting them, so insertion is a typed command and everything else is a quiet modifier. One bar at the bottom holds tools, the search field and the menu; panels grow upward out of it and never sit in the middle of the drawing. Rule I can be held to: at idle there is exactly one bar and nothing in the middle third of the screen.
**Closest competitor layout:** tldraw / FigJam bottom dock, plus Raycast's command field. The search field inside the dock is what neither has.

**Signature interaction.** One field, two modes. Focus it with `/` and it searches logos (results grow up from the dock, two columns, grouped by category); type `›` or click the ≡ and the same field becomes a command filter over the whole main menu (type "png", "tidy"). The menu is no longer a corner icon with a 29-item sheet; it is the same place you already look.

What moved where (inventory IDs):
- **P1-P2** dock field (the example line is the rotating placeholder). **P3** chip row. **P4-P5** segmented `Logos 269 | Generic 321` at equal weight (today a small button), generic set select appears beside it when Generic is active; a "Generic icons" strip with samples sits under the list. **P6-P8** two-column list grouped by category, shapes as the last group. **P7** Recent is the first group. **P9** note, **P13** Load pack, **P10-P11** user packs and status message sit in the footer. **P12** key legend in the header row. **P14** unchanged.
- **M1-M13** three columns: File / Share / Help; Export / Import; Insert / Arrange and present. **M14-M20** the "View" and "Show" rows of the settings strip (theme as 3 icons, background, 5 chips). **M27-M28** the "New shapes" row. **M21-M26, M29** in their groups. **M6** "Selection as PNG" is shown dimmed when nothing is selected (today it is hidden).
- **R1-R17** a two-row ribbon above the dock, opened with `I` or the top-right sliders button, never on selection; grip to drag it free (as today), double-click resets. Row 1: kind chip (R1), 8 swatches + "…" (opens all 24 + hex, R2), Fill / Edge / dashed (R3-R5). Row 2: Route (R8, connectors only), Text size (R6), Arrange (R13), Group / Ungroup (R14), Lock (R16), Copy / Paste style (R17), Delete (R1). R7, R9, R10 add a segment to row 2 for the kinds that have them; R11-R12 add an "Align" cluster with 2+ selected; R15 the group-name field replaces the kind chip when one group is selected. **R18** with nothing selected the ribbon is a one-line "Nothing selected" chip. **R19** the tip text moves into the `?` shortcuts modal as a "Tips" group.
- **T1-T2** doc chip top-left (name, dot when unsaved; "saved / saving… / save failed" as tooltip, red text on failure). **T3** the sliders button in the top-right pill (with Find D1 and Layers L1). **T4** mark only (the wordmark is dropped). **T5** the sun/moon button is removed (duplicate of M14). **T6** the dock field is the welcome call to action; the General notes list and ghost diagram stay as the empty-sheet state.
- **K1-K9, K11** the dock; K9 is the `▾` shapes popover. **K10** the icons button is now the search field. **K12** letters live in tooltips only.
- **B1-B4** zoom pill bottom-right; **B5-B6, B7** in the dock. **F1** status line sits left of the zoom pill when on. **F2** title block removed; TITLE is the doc chip; SCALE / REV / STYLE appear as a "Sheet" row under the "Show" chips when "Sheet frame" is on. **F3** frame unchanged (setting).
- **L, N, D, Q, X** layers and find open from the top-right pill (find as today's top bar); minimap as above; dialogs unchanged; toasts stack bottom-centre above the dock.

Weak spots: the ribbon is 861-924 px wide, wider than anything today; the dock is 683 px wide (the single largest piece of chrome, 31k px²); while searching or in the menu the panel still covers 32-39 % of this diagram.

## B. "Rails": docked rails and an inspector

**Thesis.** Controls fall into two families: things you do to the sheet (tools, library) on the left, things you read or tune on the right, and each family lives on a thin rail at its own edge. Panels *dock* and the canvas re-fits to what is left, so a panel never lies on top of the drawing. Rule: no panel overlaps the diagram; opening one changes the canvas size instead.
**Closest competitor layout:** Figma / Eraser (left tools, right inspector). The library as a docked drawer with click-to-stamp is the difference.

**Signature interaction.** Armed stamping. Pick a logo in the docked library (grid of tiles, accordion-by-category, "Show all 16"), it follows the cursor as a ghost, click the canvas to place it and click again to place the next; `Esc` disarms. Drawer and inspector re-fit the canvas, the diagram is never hidden behind them.

What moved where:
- **P1-P2** top of the drawer. **P3** chip row (scrolls). **P4-P5** full-width `Logos | Generic` segment. **P6-P8** per-category sections of 4-wide tiles, "Show all N" per section, shapes as the last section. **P7** Recent first. **P9-P13** drawer footer (key legend, note, Load pack, count). **P14** same. New: the "armed" status strip.
- **M1-M13, M21-M26, M29** the dropdown from the top-left ≡ (File, Export, Import, Share, Insert, Arrange and present, Help; 276x740). **M14-M20, M27-M28** the **View** tab (eye button on the right rail): theme, background, 5 switches, New shapes. Rule: *actions in the menu, persistent state in View.* **T5** theme button removed.
- **R1-R17** accordion inspector (right rail ⇢ sliders, `I`): header with kind + Delete; Appearance (colour grid of 24 + hex, fill, edge, dashed), Text (size; align when applicable), Route (connectors), Arrange (4 buttons with keys), Group and lock (group, ungroup, name field when a group is selected, lock, copy/paste style). Sections collapse and remember their state. R9-R10 are their own sections for braces / lanes; R11-R12 an "Align" section with 2+ selected. **R18** header + one-line note. **R19** into the `?` modal. Draggable-to-float: via a header grip (not drawn); docked by default.
- **T1-T2, T4** doc chip (menu button, mark, name, dot). **T3** the sliders icon on the right rail. **K1-K9, K11** left rail; **K10** the accent "icons" button with `/` at its foot opens the drawer. **K12** tooltips only.
- **B1-B7, F1** history + zoom pill bottom-left; the menu button is the ≡ in the doc chip. **F2** removed (title = doc chip; SCALE / REV / STYLE appear in the View tab with "Sheet frame" on). **L1-L3** the Layers button on the right rail opens Layers + **N** Navigator (minimap) in one panel. **D1-D4** Find is the third right-rail button and opens the find field at the top of the same panel column.

Weak spots: the drawer is 328x796 and the inspector 296x598, big panels when open; the canvas shrinking when they open must be implemented as pan/fit and is the riskiest part to build (viewport insets in `viewport.ts` / `renderer.ts`); right rail and doc chip at the corners are small, always-on targets.

## C. "Cursor": familiar corners, the palette opens where the icon lands

**Thesis.** People already know where file menus, tools and panels live; the actual defect today is that the palette is a centred modal that hides the drawing and says nothing about where the icon will go. Keep the corner layout, clean it, and make the search open *at the landing spot*: a ghost of the selected logo and a tether line show where it will be placed; the popover goes to the free side. Rule: the search never covers the nodes you are connecting to.
**Closest competitor layout:** Excalidraw (menu top-left, tools, props). This is the conservative option; the cursor-anchored popover is the only structural novelty.

**Signature interaction.** Search at the cursor: `/` opens a 344 px popover at the pointer, the highlighted row's logo ghosts at the landing spot, `Enter` drops it there. Wide mode (the full panel) is one key away, because a compact popover trades visible results (about 5) for not covering the drawing.

What moved where:
- **P1-P2** popover input (rotating placeholder). **P3** chip row, **P4** the "Generic icons" chip kept at the row end (as today), **P5** the set select replaces the chips when Generic is active. **P6-P8** single-column grouped list. **P7** Recent first. **P9-P13** popover footer. **P14** same.
- **M1-M13, M21-M26, M29** the menu from the top-left doc chip: File rows, Export ▸, Import ▸, Copy share link, tools (Capacity note, Legend, Renumber, Find, Tidy, Present), View and settings ▸, Keyboard shortcuts. `C-light-menu*.png` and `C-*-menu.png` show the three submenus (Export: M5-M8, M10; Import: M9, M25, M26; View and settings: M14-M20, M27-M28). **T5** theme button stays in the top-right (the one deliberate duplicate; quick toggle).
- **R1-R17** floating draggable card (300 wide), one column of icon segments with 58 px row labels: Colour (8 + "…"), Fill + dashed, Edge, Route, Text, Arrange, Group (group, ungroup, lock, copy / paste style). Header has grip, kind, Delete, Close. Icon-only segments have tooltips and aria-labels. **R9-R12** extra rows by kind / count. **R18** header + note. **R19** one tip line stays at the card foot.
- **T1-T4** doc chip (it is also the menu button) and the top-right pill (Find, Layers, Properties, theme). **K1-K9, K11** left rail, **K10** is the search glyph on top of it. **B1-B6** history + zoom pill bottom-left, **B7** is the doc-chip menu. **F1, F2** as in B. **L, D, N** layers and find from the top-right pill; **N** minimap 148x96 bottom-right.

Weak spots: it is the closest to what exists, so the least change in how it feels; popover shows only about 5 results; the left rail plus corner pills are 4 separate clusters again (but each is small and aligned to an edge 14 px in).

---

## Verification

Verified: `probe.mjs` ran on every desktop state of A, B and C in light and dark (30 runs): overflow clean, every font stack renders its declared first family (Lato, JetBrains Mono), contrast clean, no horizontal scroll at 400 px. Mobile frames (390x844) were rendered and read by eye, not probed. Advisories left: touch targets under 44 px (desktop controls are 28-34 px; at 390 px they become 40 px, still under the 44 px guidance), a few controls below 24 px at the probe's 390 px width.
Reasoned, not verified: the chrome areas for the real app come from its DOM at default settings with the demo diagram loaded; the "covered" percentages use the demo diagram's bbox and would differ for other diagrams.
Not verified: that the fonts are installed on anyone else's machine; implementation cost of any direction; keyboard focus order.

## Post-flight

- A choice I would have made by default and did not: a left tool strip plus a right properties card (what the app has and what Excalidraw/tldraw-style apps converge on). Only C keeps that family, and says so.
- The one bold move per direction: A, the single bottom dock whose field is both icon search and command filter; B, panels that dock and re-fit the canvas instead of covering it; C, the palette opening at the landing spot with a ghost. Everything else in each is the same quiet chrome (white or graphite surfaces, hairline-free, one accent).
- Sibling diff, honestly: ground (white / graphite), accent and the mono face are the project's own tokens, not a new pick. The sans (Lato) is on the used-looks tell list. Direction A repeats an idiom already picked for interview-platform (command field as the centre of the product); B and C do not. If sameness with the last picks is the worry, B is the structurally freshest and A the most repeated.
