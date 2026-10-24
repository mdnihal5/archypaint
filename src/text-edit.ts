import type { El } from "./scene";
import type { Viewport } from "./viewport";
import { wrapText, wrapWidth } from "./wrap";

const FONT_PX = 13;
const LINE = 18;
let mctx: CanvasRenderingContext2D | null = null;
const FACE = "'JetBrains Mono','DejaVu Sans Mono',monospace";

/** text size presets offered in the properties panel: label -> px (0 = the default, which is 13) */
export const TEXT_SIZES: readonly { label: string; px: number }[] = [{ label: "S", px: 11 }, { label: "M", px: 0 }, { label: "L", px: 18 }, { label: "XL", px: 26 }];
export const DEFAULT_FS = FONT_PX;
/** line height for a font size: 18 at the default 13, scaling with it */
export const lineHeightOf = (fs: number): number => Math.round((fs || FONT_PX) * (LINE / FONT_PX));

/** width of one line of text at a font size, in world units */
export function textWidth(text: string, fs = 0): number {
  if (!mctx) mctx = document.createElement("canvas").getContext("2d")!;
  mctx.font = `${fs || FONT_PX}px ${FACE}`;
  return mctx.measureText(text || " ").width;
}

/** measure text for auto-sizing `text` elements (one shared offscreen context) */
export function measureText(text: string, fs = 0): { w: number; h: number } {
  let w = 0;
  const lines = text.split("\n");
  for (const l of lines) w = Math.max(w, textWidth(l, fs));
  const lh = lineHeightOf(fs);
  return { w: Math.ceil(w) + 16, h: lines.length * lh + 10 };
}

/** what the overlay edits: any element, or a stand-in for something that is not one (a group's name tag, a connector label) */
export type EditTarget = Pick<El, "x" | "y" | "w" | "h" | "kind" | "text" | "fs" | "align">;

/** where the editor overlay sits (world units, centre) and how it looks; a function so it follows the thing while panning/zooming */
export interface EditAnchor { cx: number; cy: number; /** minimum / fixed overlay width */ w: number; fs: number; /** grow to fit the text (free text, labels) instead of filling `w` */ fit: boolean; /** one line: Enter commits instead of adding a line (names, connector labels) */ single?: boolean }

/**
 * DOM textarea overlay for editing an element's text. At most one exists at a time; it is
 * removed (with its listeners) on commit/cancel/destroy so nothing lingers.
 */
export class TextEditor {
  private ta: HTMLTextAreaElement | null = null;
  private target: EditTarget | null = null;
  private anchor: (() => EditAnchor) | null = null;
  private done: ((e: EditTarget, text: string) => void) | null = null;
  private closed: ((committed: boolean) => void) | null = null;
  private off: (() => void) | null = null;

  constructor(private stage: HTMLElement, private vp: Viewport) {}

  get isOpen(): boolean { return this.ta !== null; }

  /**
   * `anchor` places the overlay for things that are not a plain centred element label: an icon's name under its tile, a group's
   * name above its outline, a label on a connector. Without it the overlay is centred on `e`.
   */
  open(e: EditTarget, onDone: (e: EditTarget, text: string) => void, onClosed?: (committed: boolean) => void, initial?: string, anchor?: () => EditAnchor, caretEnd = false): void {
    this.close(true);
    const ta = document.createElement("textarea");
    ta.value = initial ?? e.text; ta.spellcheck = false;
    ta.setAttribute("aria-label", "edit text");
    Object.assign(ta.style, {
      position: "absolute", zIndex: "5", resize: "none", overflow: "hidden", boxSizing: "border-box", margin: "0",
      padding: "0", border: "1.5px solid var(--red, #c2412d)", outline: "none", textAlign: "center", whiteSpace: "pre",
      background: "var(--card, #ffffff)", color: "var(--ink, #1b1b1f)", font: `${FONT_PX}px ${FACE}`,
      lineHeight: `${LINE}px`, transformOrigin: "0 0",
    } as Partial<CSSStyleDeclaration>);
    this.ta = ta; this.target = e; this.anchor = anchor ?? null; this.done = onDone; this.closed = onClosed ?? null;
    this.stage.appendChild(ta);
    this.place();
    const onInput = () => { this.place(); };
    const onKey = (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if (ev.key === "Escape") { ev.preventDefault(); this.close(false); }
      else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey || (!ev.shiftKey && this.anchor?.().single))) { ev.preventDefault(); this.close(true); }
    };
    const onBlur = () => this.close(true);
    ta.addEventListener("input", onInput); ta.addEventListener("keydown", onKey); ta.addEventListener("blur", onBlur);
    this.off = () => { ta.removeEventListener("input", onInput); ta.removeEventListener("keydown", onKey); ta.removeEventListener("blur", onBlur); };
    ta.focus();
    if (caretEnd) ta.setSelectionRange(ta.value.length, ta.value.length); else ta.select();
  }

  /** keep the overlay glued to the element (call after viewport changes while open) */
  place(): void {
    const ta = this.ta, e = this.target;
    if (!ta || !e) return;
    const z = this.vp.zoom;
    const a = this.anchor ? this.anchor() : { cx: e.x + e.w / 2, cy: e.y + e.h / 2, w: wrapWidth(e.kind, e.w) || e.w, fs: e.fs ?? 0, fit: e.kind === "text" };
    const m = measureText(ta.value || " ", a.fs);
    const wraps = !a.fit && wrapWidth(e.kind, e.w) > 0; // a shape's label wraps inside the shape, like it is drawn
    const w = Math.max(a.fit ? m.w : Math.min(a.w, Math.max(m.w, 60)), 60);
    let h = Math.max(m.h, lineHeightOf(a.fs) + 10);
    ta.style.textAlign = e.align ?? "center";
    if (wraps) {
      ta.style.whiteSpace = "pre-wrap"; ta.style.overflowWrap = "anywhere";
      h = Math.max(h, wrapText(ta.value, w, (t) => textWidth(t, a.fs)).length * lineHeightOf(a.fs) + 10);
    }
    const cx = (a.cx - this.vp.x) * z, cy = (a.cy - this.vp.y) * z;
    ta.style.font = `${a.fs || FONT_PX}px ${FACE}`; ta.style.lineHeight = `${lineHeightOf(a.fs)}px`;
    ta.style.width = `${w}px`; ta.style.height = `${h}px`;
    if (wraps && ta.scrollHeight > h) { h = ta.scrollHeight; ta.style.height = `${h}px`; } // the browser wrapped a line we did not: never hide text
    ta.style.transform = `translate(${cx - (w * z) / 2}px, ${cy - (h * z) / 2}px) scale(${z})`;
    ta.style.left = "0"; ta.style.top = "0";
  }

  close(commit: boolean): void {
    const ta = this.ta;
    if (!ta) return;
    const e = this.target!, done = this.done, closed = this.closed, value = ta.value;
    this.off?.(); this.off = null;
    this.ta = null; this.target = null; this.anchor = null; this.done = null; this.closed = null;
    ta.remove();
    if (commit && done) done(e, value);
    closed?.(commit);
  }

  destroy(): void { this.close(false); }
}
