import type { EditorAPI } from "../editor-api";
import type { FeatureCtx } from "../features/types";
import { cameraFor, computeSteps, planHint } from "../present";
import "./present.css";

type PresentCtx = Pick<FeatureCtx, "editor" | "toast">;
interface RendererLike { hidden: ReadonlySet<string> | null; invalidate(stat: boolean, live: boolean): void }
const rendererOf = (e: EditorAPI): RendererLike => (e as unknown as { renderer: RendererLike }).renderer;

let active: { exit(): void } | null = null;
export const isPresenting = (): boolean => active !== null;

/** fade timings: the counter and hint are quiet by design, and each is ONE timer, never a frame loop */
const COUNT_MS = 1800, HINT_MS = 4500, HIGHLIGHT_MS = 600;

/**
 * Full-window step-through. Hides the chrome (CSS on <html data-present>), makes the editor read-only, and reveals the
 * plan's steps through Renderer.hidden. A full-window overlay swallows pointer input, so nothing underneath can be hit
 * or edited. Everything is restored on exit: read-only state, selection, hidden set and the exact viewport.
 */
export function startPresentation(c: PresentCtx): boolean {
  if (active) return false;
  const { editor } = c;
  const list = [...editor.scene.els.values()];
  const plan = computeSteps(list);
  if (!plan.steps.length) { c.toast("Nothing to present yet. Add some shapes first.", "err"); return false; }
  const steps = plan.steps, last = steps.length - 1;
  const r = rendererOf(editor), vp = editor.vp;
  const saved = { x: vp.x, y: vp.y, zoom: vp.zoom, sel: [...editor.selection()], ro: editor.readOnly, hidden: r.hidden };

  editor.setReadOnly(true); // also clears the selection
  const hidden = new Set(list.map((e) => e.id));
  r.hidden = hidden;

  const root = document.createElement("div");
  root.className = "ap-present"; root.setAttribute("role", "application"); root.setAttribute("aria-label", "Presentation");
  const count = document.createElement("div"); count.className = "ap-pr-count"; count.setAttribute("aria-live", "polite");
  const hint = document.createElement("div"); hint.className = "ap-pr-hint"; hint.textContent = planHint(plan.mode);
  root.append(count, hint);
  document.body.append(root);
  document.documentElement.dataset.present = "on";

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let countT: ReturnType<typeof setTimeout> | null = null, hintT: ReturnType<typeof setTimeout> | null = null, hiT: ReturnType<typeof setTimeout> | null = null;
  const after = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const cancel = (t: ReturnType<typeof setTimeout> | null) => { if (t !== null) { clearTimeout(t); timers.delete(t); } };

  let cur = -1, done = false;
  const go = (to: number): void => {
    const i = Math.max(0, Math.min(last, to));
    if (i === cur) { flash(); return; }
    if (i > cur) for (let k = cur + 1; k <= i; k++) for (const id of steps[k]!) hidden.delete(id);
    else for (let k = i + 1; k <= cur; k++) for (const id of steps[k]!) hidden.add(id);
    cur = i;
    const ids = steps[i]!;
    const b = editor.scene.bounds(ids);
    const cam = b ? cameraFor({ x: vp.x, y: vp.y, zoom: vp.zoom }, vp.w, vp.h, b) : null;
    if (cam) { vp.x = cam.x; vp.y = cam.y; vp.zoom = cam.zoom; vp.version++; }
    r.invalidate(true, true);
    // outline what is new; an arrow's bounding box is just noise, so arrows are outlined only when the step has nothing else
    const shapes = ids.filter((id) => editor.scene.els.get(id)?.kind !== "arrow");
    const pick = shapes.length ? shapes : ids;
    editor.highlight(pick.length > 400 ? pick.slice(0, 400) : pick);
    cancel(hiT); hiT = after(() => editor.highlight([]), HIGHLIGHT_MS); // the highlight clears itself with one timed repaint
    flash();
  };
  const flash = (): void => {
    count.textContent = `${cur + 1} / ${steps.length}`;
    root.dataset.count = "true";
    cancel(countT); countT = after(() => { root.dataset.count = "false"; }, COUNT_MS);
  };

  const exit = (): void => {
    if (done) return;
    done = true; active = null;
    window.removeEventListener("keydown", onKey, true);
    root.removeEventListener("click", onClick); root.removeEventListener("contextmenu", onMenu); root.removeEventListener("wheel", onWheel);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    r.hidden = saved.hidden;
    editor.highlight([]);
    editor.setReadOnly(saved.ro);
    editor.select(saved.sel);
    vp.x = saved.x; vp.y = saved.y; vp.zoom = saved.zoom; vp.version++;
    r.invalidate(true, true);
    root.remove();
    delete document.documentElement.dataset.present;
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts (reload, devtools) still work
    const k = e.key;
    if (k === "ArrowRight" || k === " " || k === "PageDown" || k === "Enter") go(cur + 1);
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") go(cur - 1);
    else if (k === "Home") go(0);
    else if (k === "End") go(last);
    else if (k === "Escape" || k === "p" || k === "P") exit();
    else { e.stopImmediatePropagation(); return; } // keep every other key away from the editor and chrome
    e.preventDefault(); e.stopImmediatePropagation();
  };
  const onClick = (e: MouseEvent): void => { go(e.shiftKey ? cur - 1 : cur + 1); };
  const onMenu = (e: Event): void => { e.preventDefault(); go(cur - 1); };
  const onWheel = (e: Event): void => { e.preventDefault(); };
  window.addEventListener("keydown", onKey, true);
  root.addEventListener("click", onClick); root.addEventListener("contextmenu", onMenu); root.addEventListener("wheel", onWheel, { passive: false });

  active = { exit };
  root.dataset.hint = "true";
  hintT = after(() => { root.dataset.hint = "false"; }, HINT_MS);
  void hintT;
  go(0);
  return true;
}

/** leave the presentation if one is running (tests, HMR) */
export function stopPresentation(): void { active?.exit(); }

/* ------------------------------------------------------------------ shared (read-only) bar */

/**
 * The only chrome on a shared link: read-only notice, Present, and "Make an editable copy" (an inline two-step, no
 * modal: the copy replaces the sheet autosaved in this browser, so it asks once). Returns a disposer.
 */
export function mountSharedBar(c: PresentCtx, onEdit: () => void): () => void {
  document.documentElement.dataset.view = "readonly";
  const bar = document.createElement("div");
  bar.className = "ap-ro-bar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Shared diagram");
  const msg = document.createElement("span"); msg.className = "ap-ro-msg";
  const btn = (label: string, fn: () => void, primary = false) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (primary) b.className = "primary";
    b.addEventListener("click", fn); return b;
  };
  const home = (): void => {
    bar.replaceChildren(msg, btn("Present", () => { startPresentation(c); }), btn("Make an editable copy", confirm, true));
    msg.textContent = "Shared view · read-only";
  };
  const dispose = (): void => { bar.remove(); delete document.documentElement.dataset.view; };
  const confirm = (): void => {
    msg.textContent = "Replaces the sheet saved in this browser.";
    const yes = btn("Make the copy", () => { onEdit(); dispose(); c.toast("This is now your own editable copy."); }, true);
    bar.replaceChildren(msg, yes, btn("Cancel", home));
    yes.focus();
  };
  home();
  document.body.append(bar);
  return dispose;
}

/* ------------------------------------------------------------------ link box (clipboard blocked) */

export function showLinkBox(url: string): () => void {
  const back = document.createElement("div");
  back.className = "ap-linkbox";
  const card = document.createElement("div"); card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Share link");
  const p = document.createElement("div"); p.textContent = "The browser blocked copying. Select the link and copy it:";
  const input = document.createElement("input"); input.readOnly = true; input.value = url; input.setAttribute("aria-label", "Share link");
  const row = document.createElement("div"); row.className = "row";
  const close = document.createElement("button"); close.type = "button"; close.textContent = "Close";
  row.append(close); card.append(p, input, row); back.append(card); document.body.append(back);
  const off = (): void => { window.removeEventListener("keydown", onKey, true); back.remove(); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopImmediatePropagation(); off(); } };
  window.addEventListener("keydown", onKey, true);
  close.addEventListener("click", off);
  back.addEventListener("pointerdown", (e) => { if (e.target === back) off(); });
  input.focus(); input.select();
  return off;
}
