import type { AlignMode } from "./align";
import type { El, Scene, EdgeStyle, FillStyle } from "./scene";
import type { Tool } from "./input";
import type { Viewport } from "./viewport";

export interface StyleProps { cat: number; fill: FillStyle; edge: EdgeStyle; radius: number; dash: 0 | 1; route: 0 | 1 | 2; /** orientation of braces (0-3) and swimlanes (0 rows, 1 columns) */ o?: 0 | 1 | 2 | 3 }

export type EditorEvent = "change" | "selection" | "tool" | "history" | "viewport";

/**
 * The single seam between the engine and everything around it (UI chrome, palette, file I/O).
 * Every mutating command is one undo step. Every subscription returns an unsubscribe function,
 * and components must call it on teardown — that is how listener leaks are prevented.
 */
export interface EditorAPI {
  readonly scene: Scene;
  readonly vp: Viewport;
  readonly tool: Tool;
  setTool(t: Tool): void;
  /** creation tools only: when locked the tool stays active after each shape (double-click a tool, or Q). Choosing another tool unlocks. */
  readonly toolLocked: boolean;
  setToolLock(on: boolean): void;
  /** view-only mode (shared links, presentations): pan and zoom still work, every command that would change the document is a no-op */
  readonly readOnly: boolean;
  setReadOnly(on: boolean): void;

  selection(): ReadonlySet<string>;
  select(ids: readonly string[]): void;
  clearSelection(): void;
  selectAll(): void;

  deleteSelection(): void;
  duplicateSelection(): void;
  group(name?: string): string | null;
  ungroup(): void;
  renameGroup(id: string, name: string): void;
  bringToFront(): void; bringForward(): void; sendBackward(): void; sendToBack(): void;
  setStyle(patch: Partial<StyleProps>): void;
  /** style defaults used for newly created shapes */
  readonly defaults: StyleProps;
  setDefaults(patch: Partial<StyleProps>): void;

  /** place an icon element; `at` is the world-space centre (default: viewport centre) */
  placeIcon(iconId: string, at?: { x: number; y: number }): El;
  /** import an image or SVG (validated, downscaled, stored) and place it; rejects with a message fit for a toast */
  insertImage(blob: Blob, at?: { x: number; y: number }): Promise<El>;
  /** a short message for the user (toast); the chrome subscribes with onNotice */
  notice(level: "info" | "warn" | "error", text: string): void;
  onNotice(cb: (m: { level: "info" | "warn" | "error"; text: string }) => void): () => void;

  /** align the selection (blocks: a whole group counts as one) to its own bounds */
  align(mode: AlignMode): void;
  /** equalise gaps between >= 3 blocks along an axis */
  distribute(axis: "h" | "v"): void;
  /** make the selected (ungrouped) shapes as wide / tall as the largest */
  matchSize(dim: "w" | "h" | "both"): void;
  /** lock or unlock the selection (locked shapes cannot be moved, resized, edited or deleted) */
  setLocked(locked: boolean): void;
  toggleLock(): void;
  /** remember the first selected element's style / apply it to the selection */
  copyStyle(): boolean;
  pasteStyle(): void;
  /** insert a legend of the categories and line styles in use — or refresh the selected legend */
  insertLegend(): El | null;
  /**
   * Add many elements at once as ONE undo step (text import, generators). Elements get fresh ids; `src`/`dst` bindings and
   * `groupIds` refer to ids inside `data` and are remapped; bound arrows are routed. No offset is applied. Returns the new ids
   * (selected afterwards). `fit` zooms to the result.
   */
  importElements(data: { els: import("./scene").ElJSON[]; groups: import("./scene").GroupInfo[] }, fit?: boolean): string[];
  /** renumber all step badges 1..N keeping their order */
  renumberBadges(): void;
  /** insert a capacity note (back-of-envelope calculator) at the view centre and select it */
  insertCalc(): El | null;
  /** move elements to exact top-left positions as ONE undo step; arrows bound to them are re-routed once. Locked elements and arrows are skipped. */
  applyPositions(pos: ReadonlyMap<string, { x: number; y: number }>, label?: string): void;
  /**
   * rearrange into clean tiers (layered layout). Default scope: the selection when 2+ shapes are selected, else the whole sheet.
   * Resolves to the number of elements that moved (0 = nothing to do). One undo step; the layout code loads on first use.
   */
  tidy(scope?: "selection" | "all"): Promise<number>;

  /** centre the view on a world point / fit and select elements / outline elements (find-bar matches) on the live layer */
  panTo(x: number, y: number): void;
  focusOn(ids: readonly string[]): void;
  highlight(ids: readonly string[], current?: string): void;

  undo(): void; redo(): void;
  canUndo(): boolean; canRedo(): boolean;

  zoomToFit(): void;
  zoomBy(factor: number): void;
  resetView(): void;

  /** replace the entire document (load / open). Clears history. */
  load(data: import("./scene").SceneJSON): void;
  /** true when the document differs from the last load/save */
  dirty(): boolean;
  markSaved(): void;

  on(ev: EditorEvent, cb: () => void): () => void;
  /** tear down every listener and cancel pending frames — the leak-safety hook */
  destroy(): void;
}
