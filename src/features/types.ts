import type { EditorAPI } from "../editor-api";
import type { IO } from "../io";

/** what an action may use. Heavy work belongs in a lazily imported module reached from run() — never at import time. */
export interface FeatureCtx {
  editor: EditorAPI;
  io: IO;
  toast(msg: string, kind?: "ok" | "err"): void;
  confirm(msg: string, yes?: string): Promise<boolean>;
  /** the canvas stage element (drop / paste targets, overlays) */
  stage: HTMLElement;
}

export type ActionSection = "insert" | "arrange" | "view" | "file";

/**
 * A menu / keyboard command contributed by a feature. Descriptors are tiny and eager (they are what the menu lists);
 * `run` must `await import("./heavy")` so the feature's code and any data cost nothing until it is used.
 */
export interface Action {
  id: string;
  label: string;
  section: ActionSection;
  /** shown in the menu */
  hint?: string;
  /** global shortcut; matched on e.key.toLowerCase() with exactly these modifiers */
  key?: { key: string; mod?: boolean; shift?: boolean; alt?: boolean };
  /** false hides/disables the entry (e.g. needs a selection) */
  enabled?(c: FeatureCtx): boolean;
  run(c: FeatureCtx): void | Promise<void>;
}
