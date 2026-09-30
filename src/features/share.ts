import type { Action } from "./types";

/** Shareable link: the document, compressed, in the URL fragment. The codec loads on first use. */
export const actions: Action[] = [
  {
    id: "share-link", label: "Copy share link", section: "file",
    run: async (c) => { await (await import("../share")).copyShareLink(c); },
  },
];
