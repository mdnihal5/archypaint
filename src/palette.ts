import type { EditorAPI } from "./editor-api";
import { onIconsReady } from "./icon-pack";

export interface Palette {
  /** open the icon drawer (its code loads on the first call) */
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** a logo / icon is armed: a ghost follows the pointer and a click on the canvas places it */
  isArmed(): boolean;
  dispose(): void;
}

/** what the lazily loaded drawer (palette-drawer.ts) offers the shell */
export interface Drawer { open(): void; close(): void; isOpen(): boolean; isArmed(): boolean; repaint(): void; dispose(): void }

/**
 * The icon library's always-on part: the `/` key, and the repaint when an icon pack lands. The drawer itself (tiles, search, arming,
 * user packs) is a lazy chunk, loaded the first time the library is opened, so a viewer who never opens it never pays for it.
 */
export function mountPalette(editor: EditorAPI, host: HTMLElement): Palette {
  let drawer: Drawer | null = null;
  let loading: Promise<Drawer | null> | null = null;
  let wantOpen = false, disposed = false;
  const cleanups: Array<() => void> = [];

  const load = (): Promise<Drawer | null> => (loading ??= import("./palette-drawer").then((m) => {
    if (disposed) return null;
    return (drawer = m.createDrawer(editor, host));
  }, () => { loading = null; return null; }));

  const open = () => {
    if (disposed) return;
    if (drawer) { drawer.open(); return; }
    wantOpen = true;
    void load().then((d) => { if (d && wantOpen && !disposed) d.open(); wantOpen = false; });
  };
  const close = () => { wantOpen = false; drawer?.close(); };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    e.preventDefault(); open();
  };
  window.addEventListener("keydown", onKey);
  cleanups.push(() => window.removeEventListener("keydown", onKey));

  // Packs land in a burst (index + up to 6 packs on first open): coalesce into one repaint per frame. The canvas needs it too, even with the drawer closed.
  let readyRaf = 0;
  cleanups.push(onIconsReady(() => {
    if (readyRaf) return;
    readyRaf = requestAnimationFrame(() => {
      readyRaf = 0;
      drawer?.repaint();
      (editor as unknown as { renderer?: { invalidate(s: boolean, l: boolean): void } }).renderer?.invalidate(true, false);
    });
  }));
  cleanups.push(() => { if (readyRaf) cancelAnimationFrame(readyRaf); readyRaf = 0; });

  return {
    open, close, isOpen: () => drawer?.isOpen() ?? false, isArmed: () => drawer?.isArmed() ?? false,
    dispose() {
      if (disposed) return;
      disposed = true; wantOpen = false;
      for (const c of cleanups) c();
      cleanups.length = 0;
      drawer?.dispose(); drawer = null;
    },
  };
}
