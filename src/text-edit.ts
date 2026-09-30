import type { El } from "./scene";
import type { Viewport } from "./viewport";

const FONT_PX = 13;
const LINE = 18;
let mctx: CanvasRenderingContext2D | null = null;

/** measure text for auto-sizing `text` elements (one shared offscreen context) */
export function measureText(text: string): { w: number; h: number } {
  if (!mctx) mctx = document.createElement("canvas").getContext("2d")!;
  mctx.font = `${FONT_PX}px 'JetBrains Mono','DejaVu Sans Mono',monospace`;
  let w = 0;
  const lines = text.split("\n");
  for (const l of lines) w = Math.max(w, mctx.measureText(l || " ").width);
  return { w: Math.ceil(w) + 16, h: lines.length * LINE + 10 };
}

/**
 * DOM textarea overlay for editing an element's text. At most one exists at a time; it is
 * removed (with its listeners) on commit/cancel/destroy so nothing lingers.
 */
export class TextEditor {
  private ta: HTMLTextAreaElement | null = null;
  private target: El | null = null;
  private done: ((e: El, text: string) => void) | null = null;
  private closed: ((committed: boolean) => void) | null = null;
  private off: (() => void) | null = null;

  constructor(private stage: HTMLElement, private vp: Viewport) {}

  get isOpen(): boolean { return this.ta !== null; }

  open(e: El, onDone: (e: El, text: string) => void, onClosed?: (committed: boolean) => void, initial?: string): void {
    this.close(true);
    const ta = document.createElement("textarea");
    ta.value = initial ?? e.text; ta.spellcheck = false;
    ta.setAttribute("aria-label", "edit text");
    Object.assign(ta.style, {
      position: "absolute", zIndex: "5", resize: "none", overflow: "hidden", boxSizing: "border-box", margin: "0",
      padding: "0", border: "1.5px solid var(--red, #c2412d)", outline: "none", textAlign: "center", whiteSpace: "pre",
      background: "var(--card, #fbf9f2)", color: "var(--ink, #26323b)", font: `${FONT_PX}px 'JetBrains Mono','DejaVu Sans Mono',monospace`,
      lineHeight: `${LINE}px`, transformOrigin: "0 0",
    } as Partial<CSSStyleDeclaration>);
    this.ta = ta; this.target = e; this.done = onDone; this.closed = onClosed ?? null;
    this.stage.appendChild(ta);
    this.place();
    const onInput = () => { this.place(); };
    const onKey = (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if (ev.key === "Escape") { ev.preventDefault(); this.close(false); }
      else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); this.close(true); }
    };
    const onBlur = () => this.close(true);
    ta.addEventListener("input", onInput); ta.addEventListener("keydown", onKey); ta.addEventListener("blur", onBlur);
    this.off = () => { ta.removeEventListener("input", onInput); ta.removeEventListener("keydown", onKey); ta.removeEventListener("blur", onBlur); };
    ta.focus(); ta.select();
  }

  /** keep the overlay glued to the element (call after viewport changes while open) */
  place(): void {
    const ta = this.ta, e = this.target;
    if (!ta || !e) return;
    const z = this.vp.zoom;
    const m = measureText(ta.value || " ");
    const w = Math.max(e.kind === "text" ? m.w : Math.min(e.w, Math.max(m.w, 60)), 60), h = Math.max(m.h, LINE + 10);
    const cx = (e.x + e.w / 2 - this.vp.x) * z, cy = (e.y + e.h / 2 - this.vp.y) * z;
    ta.style.width = `${w}px`; ta.style.height = `${h}px`;
    ta.style.transform = `translate(${cx - (w * z) / 2}px, ${cy - (h * z) / 2}px) scale(${z})`;
    ta.style.left = "0"; ta.style.top = "0";
  }

  close(commit: boolean): void {
    const ta = this.ta;
    if (!ta) return;
    const e = this.target!, done = this.done, closed = this.closed, value = ta.value;
    this.off?.(); this.off = null;
    this.ta = null; this.target = null; this.done = null; this.closed = null;
    ta.remove();
    if (commit && done) done(e, value);
    closed?.(commit);
  }

  destroy(): void { this.close(false); }
}
