import type { Action } from "./types";

/** Tidy layout: the layered-layout code is a lazy chunk, loaded by editor.tidy() on first use. */
export const actions: Action[] = [
  {
    id: "tidy",
    label: "Tidy layout",
    hint: "Y",
    section: "arrange",
    key: { key: "y" },
    async run(c) {
      const scoped = c.editor.selection().size >= 2;
      const moved = await c.editor.tidy();
      if (moved) c.toast(`Tidied ${moved} ${moved === 1 ? "shape" : "shapes"}${scoped ? " in the selection" : ""}. Undo brings it back.`);
      else c.toast("Nothing to tidy. Select two or more shapes, or clear the selection to tidy the whole sheet.", "err");
    },
  },
];
