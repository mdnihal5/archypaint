import type { Action } from "./types";

/** Present (step-through) mode. The code lives in ui/present-ui.ts + present.ts and loads on first use. */
export const actions: Action[] = [
  {
    id: "present", label: "Present (step through)", section: "view", hint: "P", key: { key: "p" },
    run: async (c) => { (await import("../ui/present-ui")).startPresentation(c); },
  },
];
