import type { Action } from "./types";

/** Capacity note: a sticky note whose lines are back-of-envelope arithmetic. The evaluator is a lazy chunk. */
export const actions: Action[] = [
  {
    id: "calc",
    label: "Capacity note (QPS, storage…)",
    hint: "C",
    section: "insert",
    key: { key: "c" },
    run(c) {
      c.editor.insertCalc();
      c.toast("Double-click the note to edit: names, + - * / ^, 10M, 2KB, day");
    },
  },
];
