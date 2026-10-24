# Implemented UI: where every inventory ID lives now

Design: A's bottom dock + properties ribbon + top-right cluster + zoom pill; B's top-left chip with grouped menu sheet and tile drawer. Panels overlay the canvas (no re-fit).

- **P1-P14** icon drawer (`src/palette-drawer.ts`, `src/ui/drawer.css`, lazy). Opens from `/`, the dock search field, the shapes flyout ("Logos and icons"). P3 chips; P4/P5 Logos | Generic switch, generic packs as chips (the select is gone); P6-P8 tile sections, Recent first, "Show all N", shapes under Generic (a search looks everywhere); P9-P13 drawer footer; P14 keys unchanged (arrows now move by tile row). New: click a tile arms it (ghost, click places, click stamps, Esc disarms); Enter places at the view centre and closes.
- **M1-M13, M21-M26, M29** menu sheet (`src/ui/menu.ts`, lazy), opened by the top-left chip and the dock menu button. M6 is dimmed without a selection.
- **M14-M20, M27, M28** "View and settings" group of the same sheet (theme icons, background, chips for frame/layers/minimap/flow/footer/Hide icons, New shapes edge/fill). NEW Hide icons (Alt+H).
- **R1-R17** ribbon (`src/ui/ribbon.ts`, lazy): grip, kind chip (R1), colour 8 + "…" popover with all 24 and hex (R2), fill (R3), edge (R4), dashed (R5), text size (R6), text align (R7), route (R8), brace/lane (R9/R10), align row (R11/R12, 2+ shapes), arrange (R13), group/ungroup (R14), group-name field replacing the chip (R15), lock (R16), copy/paste style (R17), delete (R1). R18 "Nothing selected" one-line state. R19 tips moved to the `?` modal ("Tips"). Opens only with `I` or the sliders button.
- **T1/T2** chip name + save dot (words in tooltip, red text on failure). **T3** sliders button in the top-right cluster (also on phones; T7 folded in). **T4** mark in the chip (wordmark only in the read-only share view). **T5** theme button removed (menu has it). **T6** welcome kept (command line, notes, ghost).
- **K1-K9, K11** dock; K9 shapes flyout above the dock. **K10** the dock search field. **K12** letters in tooltips only.
- **B1-B4** zoom pill bottom-right. **B5/B6** undo/redo in the dock. **B7** dock menu button. **F1** status line left of the zoom pill. **F2** title block removed: title = chip; scale / rev / style are the "Sheet" row in the menu when the frame is on. **F3** frame unchanged.
- **L1-L3** layers card top-right, toggled by the cluster button and the menu chip. **D1-D4** find bar via the cluster search button, the menu and Ctrl+F.
- **N1-N3** minimap 148x96, bottom-right; shown only when the diagram is larger than the window; still toggled by `M` and the menu chip.
- **Q1-Q6, X1-X3** unchanged (shortcuts modal gains Hide icons, drawer keys, Tips).

Not reachable / changed: nothing dropped. Behaviour changes: minimap hides while everything is in view; Generic count shows the icons actually listed (207, not 321, since logos replace drawn duplicates).

Hide icons: render-time flag (`renderer.hideIcons`, `editor.setHideIcons`), viewer setting `hideIcons`, never in the scene or history. Icon box, tile outline/fill, label, ports, selection and connectors stay. Exports follow the toggle (like they follow the theme): on = PNG/SVG exports omit the pictures.
