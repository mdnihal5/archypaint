import type { El } from "./scene";
import type { Theme } from "./theme";

/** markdown text: the real code lives in the lazy ./md chunk; this is only the seam startup code talks to (see md/index.ts) */
export interface MdLib {
  /** box of a rendered text: layout size plus the padding free text always has */
  size(text: string, fs: number): { w: number; h: number };
  /** draw the formatted text inside the element's box; `ink` is the body colour, `solid` = text on a solid fill (no syntax colours) */
  draw(ctx: CanvasRenderingContext2D, e: El, th: Theme, ink: string, solid: boolean): void;
  /** the same picture as SVG elements */
  svg(e: Pick<El, "x" | "y" | "text" | "fs">, th: Theme, ink: string, solid: boolean): string;
}
let lib: MdLib | null = null, loading: Promise<MdLib> | null = null, tried = -1e9, repaint: (() => void) | null = null;
export const mdLib = (): MdLib | null => lib;
export const onMdLoaded = (f: () => void): void => { repaint = f; };
export function loadMd(): Promise<MdLib> {
  return lib ? Promise.resolve(lib) : (loading ??= import("./md/index").then(async (m) => { await m.fontsReady(); lib = m.lib; repaint?.(); return m.lib; }, (err) => { loading = null; throw err; }));
}
/** called from drawing: starts the load once (a failing chunk is retried at most every 4 s); the caller draws plain text meanwhile */
export function ensureMd(): void {
  if (lib || loading || performance.now() - tried < 4000) return;
  tried = performance.now(); loadMd().catch(() => {});
}
