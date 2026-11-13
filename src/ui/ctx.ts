import type { EditorAPI, EditorEvent } from "../editor-api";
import type { IO } from "../io";
import type { Palette } from "../palette";
import { createUpdater, type Disposer, type Updater } from "./dom";
import type { SettingsStore } from "./settings";
import type { Steady, Timeline } from "../load/model";
import type { Src } from "./load-src";
import type { ToastAction } from "./toast";

/** what the footer reads from the renderer (optional: the UI works without it) */
export interface HudSource { visibleCount: number; lastFrameMs: number; lastFrameAt: number; degraded: boolean; p95(): number }

/** one arrow's carried rate in the current Load view result, and whether its destination is saturated */
export interface LoadEdge { rate: number; bad: boolean }

/**
 * The live Load view (set while it is on, undefined otherwise). Read-only seam for the flow dots and for later features
 * (service card, spike scenario bar): the current result, a subscription to changes, a way to request a recompute.
 */
export interface LoadViewApi {
  readonly on: true;
  /** the current steady-state result for the whole drawing; null while the graph is too large or not computed yet */
  steady(): Steady | null;
  readonly tooLarge: boolean;
  /** true when the model carries any traffic at all (an entry with a rate): the flow dots follow the rates only then */
  active(): boolean;
  /** fills `out` for an arrow that is part of the model; false for any other arrow */
  edge(id: string, out: LoadEdge): boolean;
  /** the "over capacity" red for the current theme */
  colour(): string;
  /** called after every recompute (coalesced to one animation frame); returns the unsubscribe */
  subscribe(cb: () => void): () => void;
  /** request a recompute and repaint on the next animation frame (use after changing something the scene does not report) */
  recompute(): void;
  /** the scenario timeline (computed on first call, cached until the model changes); null when no entry has a spike */
  timeline(): Timeline | null;
  /** the timeline frame shown instead of the steady state, or null */
  frame(): number | null;
  /** show timeline frame i (overlay numbers, flow dots, card); null returns to the steady state */
  setFrame(i: number | null): void;
  /** the numbers being shown now: the frame while one is selected, else the steady state */
  source(): Src | null;
  /** turn the view off and free everything (the settings toggle does this for you) */
  stop(): void;
}

/** Shared context handed to every chrome component. */
export interface Ctx {
  editor: EditorAPI;
  io: IO;
  palette: Palette;
  settings: SettingsStore;
  hud?: HudSource;
  d: Disposer;
  /** rAF-coalesced updater, cancelled automatically on dispose */
  update(name: string, fn: () => void): Updater;
  /** run `u.schedule` whenever any of `evs` fires (subscription is torn down on dispose) */
  wire(u: Updater, ...evs: EditorEvent[]): void;
  /** schedule every registered updater (called after a UI action whose effect may not emit an editor event) */
  refresh(): void;
  /** called every ~500 ms for cheap polled state (zoom %, save state, footer) */
  onSlowTick(fn: () => void): void;
  /** `action` adds one button (Undo) and a longer life; see ToastAction */
  toast(msg: string, kind?: "ok" | "err", action?: ToastAction): void;
  confirm(msg: string, yes?: string): Promise<boolean>;
  showShortcuts(): void;
  /** run an async action; failures become an error toast instead of an unhandled rejection */
  run(fn: () => Promise<void> | void): void;
  /** true while a modal/menu owns the keyboard */
  modalOpen(): boolean;
  /** set by the find bar: opens it (menu item) */
  openFind?: () => void;
  /** opens / closes the main menu sheet (its code is a lazy chunk, loaded on the first open) */
  toggleMenu(): void;
  /** closes the main menu if it is open */
  closeMenu(): void;
  /** opens / closes the boards list under the name chip (its code is a lazy chunk, loaded on the first open) */
  toggleBoards(): void;
  closeBoards(): void;
  /** set by the Load view (lazy chunk) while it is on */
  loadView?: LoadViewApi | undefined;
  /** set by the flow animation: wakes its frame loop (the Load view calls it when its numbers change) */
  flowKick?: (() => void) | undefined;
  /** set by the panels module: shows / hides the properties ribbon (the `I` key); the ribbon's code loads on the first open */
  toggleProps?: () => void;
  /** set by the panels module: is it open (the toggle button shows this) */
  propsOpen?: () => boolean;
}

export function makeUpdaterApi(d: Disposer, editor: EditorAPI) {
  const updaters: Updater[] = [];
  return {
    update(name: string, fn: () => void): Updater {
      const u = createUpdater(name, fn);
      updaters.push(u);
      d.add(() => u.cancel());
      return u;
    },
    wire(u: Updater, ...evs: EditorEvent[]): void {
      for (const ev of evs) d.add(editor.on(ev, () => u.schedule()));
    },
    refresh(): void { for (const u of updaters) u.schedule(); },
  };
}
