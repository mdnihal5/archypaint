/** Tiny vanilla-DOM toolkit: element factory, equality-guarded writes, a disposer, and the rAF-coalesced updater. */

export type Child = Node | string | null | false | undefined;

type Handlers = { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };

export interface Props {
  class?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: Handlers;
  text?: string;
  style?: Record<string, string>;
}

/**
 * Element factory. Listeners passed via `on` are attached to the element itself, so they die with it;
 * listeners on window/document/editor go through a Disposer instead.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) if (v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : String(v));
  if (props.style) for (const [k, v] of Object.entries(props.style)) el.style.setProperty(k, v);
  if (props.on) for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn as EventListener);
  if (props.text !== undefined) el.textContent = props.text;
  for (const c of kids) if (c) el.append(c);
  return el;
}

export function fromHTML(html: string): Element {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild!;
}

/* ---- equality-guarded writes: a write that changes nothing must cost nothing and trigger nothing ---- */
export function setText(el: Node, s: string): void { if (el.textContent !== s) el.textContent = s; }
export function setAttr(el: Element, k: string, v: string | null): void {
  if (v === null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v);
}
export function setClass(el: Element, c: string, on: boolean): void { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); }
export function setDisabled(el: HTMLButtonElement | HTMLInputElement, d: boolean): void { if (el.disabled !== d) el.disabled = d; }
export function setPressed(el: Element, on: boolean, attr: "aria-pressed" | "aria-checked" = "aria-pressed"): void { setAttr(el, attr, on ? "true" : "false"); }
export function setHidden(el: HTMLElement, hidden: boolean): void { if (el.hidden !== hidden) el.hidden = hidden; }
export function setStyleProp(el: HTMLElement, k: string, v: string): void { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); }

export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/** Collects teardown work. Everything attached to window/document/editor/timers goes through one of these. */
export class Disposer {
  private fns: Array<() => void> = [];
  add<T extends () => void>(fn: T): T { this.fns.push(fn); return fn; }
  on<K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions): void;
  on<K extends keyof DocumentEventMap>(t: Document, type: K, fn: (e: DocumentEventMap[K]) => void, o?: AddEventListenerOptions): void;
  on(t: EventTarget, type: string, fn: (e: never) => void, o?: AddEventListenerOptions): void;
  on(t: EventTarget, type: string, fn: (e: never) => void, o?: AddEventListenerOptions): void {
    t.addEventListener(type, fn as EventListener, o);
    this.fns.push(() => t.removeEventListener(type, fn as EventListener, o));
  }
  interval(fn: () => void, ms: number): void { const id = setInterval(fn, ms); this.fns.push(() => clearInterval(id)); }
  dispose(): void {
    for (let i = this.fns.length - 1; i >= 0; i--) { try { this.fns[i]!(); } catch { /* keep tearing down */ } }
    this.fns.length = 0;
  }
}

/* ------------------------------------------------------------------ updater */

export const updaterStats = new Map<string, { runs: number; drops: number }>();

const DEV = (() => {
  try { return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV || (typeof location !== "undefined" && new URLSearchParams(location.search).has("debug")); } catch { return false; }
})();

let lastInput = 0;
export function noteInput(): void { lastInput = typeof performance !== "undefined" ? performance.now() : 0; }
export function installInputTracker(d: Disposer): void {
  const f = () => noteInput();
  for (const t of ["pointerdown", "pointermove", "wheel", "keydown"] as const) d.on(window, t, f, { passive: true, capture: true });
}

export interface UpdaterOpts {
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
  now?: () => number;
  warn?: (msg: string) => void;
}

export interface Updater { schedule(): void; flush(): void; cancel(): void; readonly runs: number; readonly drops: number }

/**
 * rAF-coalesced updater. Many schedule() calls in a frame => one run. A schedule() that arrives while
 * the updater's own function is running is DROPPED (counted), so an update can never re-trigger itself:
 * the structural cut against render loops. In dev it also warns if it runs >60x in a second with no input.
 */
export function createUpdater(name: string, fn: () => void, o: UpdaterOpts = {}): Updater {
  const raf = o.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = o.caf ?? ((id) => cancelAnimationFrame(id));
  const now = o.now ?? (() => performance.now());
  const warn = o.warn ?? ((m) => console.warn(m));
  const stat = { runs: 0, drops: 0 };
  updaterStats.set(name, stat);
  let id = 0, pending = false, running = false, cancelled = false;
  const times: number[] = [];
  let lastWarn = -1e9;

  const run = () => {
    id = 0; pending = false;
    if (cancelled) return;
    running = true;
    try { fn(); } finally { running = false; }
    stat.runs++;
    if (DEV) {
      const t = now();
      times.push(t);
      while (times.length && t - times[0]! > 1000) times.shift();
      if (times.length > 60 && t - lastInput > 500 && t - lastWarn > 5000) {
        lastWarn = t;
        warn(`[archypaint/ui] updater "${name}" ran ${times.length}x in 1s with no input: probable update loop`);
      }
    }
  };
  return {
    schedule() {
      if (cancelled) return;
      if (running) { stat.drops++; return; }
      if (pending) return;
      pending = true; id = raf(run);
    },
    flush() { if (pending) { caf(id); } run(); },
    cancel() { cancelled = true; if (pending) caf(id); pending = false; },
    get runs() { return stat.runs; },
    get drops() { return stat.drops; },
  };
}
