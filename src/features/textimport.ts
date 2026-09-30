import type { Action } from "./types";

/** "Diagram from text…": the parser, layout glue and overlay live in a lazy chunk (src/ui/textimport-ui.ts); nothing loads until the command runs. */
export const actions: Action[] = [
  {
    id: "text-import",
    label: "Diagram from text…",
    section: "insert",
    hint: "DSL / Mermaid",
    async run(c) {
      const m = await import("../ui/textimport-ui");
      m.openTextImport(c);
    },
  },
];
