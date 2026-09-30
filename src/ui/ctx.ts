import type { EditorAPI, EditorEvent } from "../editor-api";
import type { IO } from "../io";
import type { Palette } from "../palette";
import { createUpdater, type Disposer, type Updater } from "./dom";
import type { SettingsStore } from "./settings";

/** what the footer reads from the renderer (optional: the UI works without it) */
export interface HudSource { visibleCount: number; lastFrameMs: number; lastFrameAt: number; degraded: boolean; p95(): number }

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
  toast(msg: string, kind?: "ok" | "err"): void;
  confirm(msg: string, yes?: string): Promise<boolean>;
  showShortcuts(): void;
  /** run an async action; failures become an error toast instead of an unhandled rejection */
  run(fn: () => Promise<void> | void): void;
  /** true while a modal/menu owns the keyboard */
  modalOpen(): boolean;
  /** set by the find bar: opens it (menu item) */
  openFind?: () => void;
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
