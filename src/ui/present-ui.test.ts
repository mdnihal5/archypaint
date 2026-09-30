// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorAPI } from "../editor-api";
import { Scene } from "../scene";
import { Viewport } from "../viewport";
import { mountSharedBar, showLinkBox, startPresentation, stopPresentation } from "./present-ui";

function fake() {
  const scene = new Scene();
  const vp = new Viewport(); vp.resize(1000, 700);
  const renderer = { hidden: null as ReadonlySet<string> | null, invalidate: vi.fn() };
  let ro = false, sel: string[] = ["keep"];
  const highlights: (readonly string[])[] = [];
  const editor = {
    scene, vp, renderer,
    get readOnly() { return ro; }, setReadOnly: vi.fn((v: boolean) => { ro = v; if (v) sel = []; }),
    selection: () => new Set(sel), select: vi.fn((ids: readonly string[]) => { sel = [...ids]; }),
    highlight: vi.fn((ids: readonly string[]) => { highlights.push(ids); }),
  };
  const toast = vi.fn();
  return { ed: editor as unknown as EditorAPI, editor, renderer, scene, vp, toast, highlights, ctx: { editor: editor as unknown as EditorAPI, toast } };
}
const key = (k: string, extra: KeyboardEventInit = {}) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }); window.dispatchEvent(e); return e; };
const visible = (f: ReturnType<typeof fake>) => [...f.scene.els.keys()].filter((id) => !f.renderer.hidden!.has(id));
const counter = () => document.querySelector(".ap-pr-count")?.textContent;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { stopPresentation(); vi.useRealTimers(); document.body.replaceChildren(); delete document.documentElement.dataset.view; delete document.documentElement.dataset.present; });

function three(f: ReturnType<typeof fake>) {
  const a = f.scene.add({ kind: "rect", x: 0, y: 0, w: 100, h: 60 });
  const b = f.scene.add({ kind: "rect", x: 300, y: 0, w: 100, h: 60 });
  const c = f.scene.add({ kind: "rect", x: 600, y: 0, w: 100, h: 60 });
  return [a.id, b.id, c.id] as const;
}

describe("present mode", () => {
  it("refuses an empty diagram with a message and leaves nothing behind", () => {
    const f = fake();
    expect(startPresentation(f.ctx)).toBe(false);
    expect(f.toast).toHaveBeenCalledWith(expect.stringMatching(/Nothing to present/), "err");
    expect(document.querySelector(".ap-present")).toBeNull();
    expect(f.renderer.hidden).toBeNull();
  });

  it("starts on step 1 with everything else hidden, chrome hidden and the editor read-only", () => {
    const f = fake(); const [a] = three(f);
    expect(startPresentation(f.ctx)).toBe(true);
    expect(document.documentElement.dataset.present).toBe("on");
    expect(f.editor.setReadOnly).toHaveBeenCalledWith(true);
    expect(visible(f)).toEqual([a]);
    expect(counter()).toBe("1 / 3");
    expect(document.querySelector(".ap-pr-hint")!.textContent).toMatch(/top-left to bottom-right/);
  });

  it("→ Space PageDown reveal, ← PageUp hide, Home / End jump, and the ends clamp", () => {
    const f = fake(); const [a, b, c] = three(f);
    startPresentation(f.ctx);
    key("ArrowRight"); expect(visible(f)).toEqual([a, b]); expect(counter()).toBe("2 / 3");
    key(" "); expect(visible(f)).toEqual([a, b, c]);
    key("PageDown"); expect(visible(f)).toEqual([a, b, c]); expect(counter()).toBe("3 / 3");
    key("ArrowLeft"); expect(visible(f)).toEqual([a, b]);
    key("PageUp"); expect(visible(f)).toEqual([a]);
    key("ArrowLeft"); expect(counter()).toBe("1 / 3");
    key("End"); expect(visible(f)).toEqual([a, b, c]);
    key("Home"); expect(visible(f)).toEqual([a]);
  });

  it("click advances, shift-click and right-click go back", () => {
    const f = fake(); const [a, b] = three(f);
    startPresentation(f.ctx);
    const o = document.querySelector<HTMLElement>(".ap-present")!;
    o.dispatchEvent(new MouseEvent("click", { bubbles: true })); expect(visible(f)).toEqual([a, b]);
    o.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); expect(visible(f)).toEqual([a]);
    o.dispatchEvent(new MouseEvent("click", { bubbles: true })); o.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(visible(f)).toEqual([a]);
  });

  it("other keys never reach the editor or the chrome; browser shortcuts (ctrl/meta) still do", () => {
    const f = fake(); three(f);
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    startPresentation(f.ctx);
    key("Delete"); key("r"); key("ArrowRight");
    expect(seen).not.toHaveBeenCalled();
    key("r", { ctrlKey: true });
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", seen);
  });

  it("the camera follows the newest step when it is off screen and stays put when it is visible", () => {
    const f = fake();
    f.scene.add({ kind: "rect", x: 200, y: 200, w: 100, h: 60 });
    const far = f.scene.add({ kind: "rect", x: 5000, y: 3000, w: 100, h: 60 });
    startPresentation(f.ctx); // step 1 is well inside the default view: the camera does not move
    expect([f.vp.x, f.vp.y, f.vp.zoom]).toEqual([0, 0, 1]);
    key("ArrowRight"); // step 2 is thousands of units away: pan there, same zoom
    expect(f.vp.zoom).toBe(1);
    const sx = (far.x - f.vp.x) * f.vp.zoom, sy = (far.y - f.vp.y) * f.vp.zoom;
    expect(sx >= 0 && sx + far.w <= 1000 && sy >= 0 && sy + far.h <= 700).toBe(true);
    key("ArrowLeft"); // and back to step 1
    expect(f.vp.x).toBeLessThan(1000);
  });

  it("each new step is highlighted once and the highlight clears itself with one timer", () => {
    const f = fake(); const [a, b] = three(f);
    startPresentation(f.ctx);
    expect(f.editor.highlight).toHaveBeenLastCalledWith([a]);
    key("ArrowRight");
    expect(f.editor.highlight).toHaveBeenLastCalledWith([b]);
    vi.advanceTimersByTime(700);
    expect(f.editor.highlight).toHaveBeenLastCalledWith([]);
    const calls = (f.editor.highlight as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect((f.editor.highlight as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls); // nothing keeps firing while idle
  });

  it("the highlight outlines new shapes but not their arrows (unless the step is only arrows)", () => {
    const f = fake();
    const a = f.scene.add({ kind: "rect", x: 0, y: 0, w: 100, h: 60 }), b = f.scene.add({ kind: "rect", x: 300, y: 0, w: 100, h: 60 });
    const ar = f.scene.add({ kind: "arrow", src: a.id, dst: b.id, x: 100, y: 30, w: 200, h: 0 });
    startPresentation(f.ctx); key("ArrowRight"); // step 2 = b + the arrow that joins a and b
    expect(f.editor.highlight).toHaveBeenLastCalledWith([b.id]);
    expect(ar.id).toBeTruthy();
  });

  it("the counter and hint fade by themselves", () => {
    const f = fake(); three(f);
    startPresentation(f.ctx);
    const o = document.querySelector<HTMLElement>(".ap-present")!;
    expect(o.dataset.count).toBe("true"); expect(o.dataset.hint).toBe("true");
    vi.advanceTimersByTime(2000); expect(o.dataset.count).toBe("false");
    vi.advanceTimersByTime(3000); expect(o.dataset.hint).toBe("false");
  });

  it("Esc restores everything exactly: hidden set, read-only state, selection, viewport, chrome", () => {
    const f = fake(); three(f);
    f.vp.x = 123.5; f.vp.y = -40; f.vp.zoom = 1.75;
    startPresentation(f.ctx);
    key("End"); key("ArrowLeft");
    const ver = f.vp.version;
    key("Escape");
    expect(f.renderer.hidden).toBeNull();
    expect(f.editor.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(f.editor.select).toHaveBeenLastCalledWith(["keep"]);
    expect([f.vp.x, f.vp.y, f.vp.zoom]).toEqual([123.5, -40, 1.75]);
    expect(f.vp.version).toBeGreaterThan(ver);
    expect(document.querySelector(".ap-present")).toBeNull();
    expect(document.documentElement.dataset.present).toBeUndefined();
    expect(f.editor.highlight).toHaveBeenLastCalledWith([]);
  });

  it("starting from an already read-only viewer leaves it read-only on exit", () => {
    const f = fake(); three(f);
    f.editor.setReadOnly(true);
    startPresentation(f.ctx); key("Escape");
    expect(f.editor.readOnly).toBe(true);
  });

  it("P toggles it off; a second start while running is ignored", () => {
    const f = fake(); three(f);
    expect(startPresentation(f.ctx)).toBe(true);
    expect(startPresentation(f.ctx)).toBe(false);
    key("p");
    expect(document.querySelector(".ap-present")).toBeNull();
  });

  it("leaves no listeners or timers behind after 50 start/exit cycles", () => {
    const f = fake(); three(f);
    const add = vi.spyOn(window, "addEventListener"), rem = vi.spyOn(window, "removeEventListener");
    for (let i = 0; i < 50; i++) { startPresentation(f.ctx); key("ArrowRight"); key("Escape"); }
    const count = (spy: typeof add) => spy.mock.calls.filter((c) => c[0] === "keydown").length;
    expect(count(add)).toBe(count(rem));
    expect(vi.getTimerCount()).toBe(0);
    expect(document.body.children.length).toBe(0);
  });

  it("exiting mid-highlight cancels the pending timers", () => {
    const f = fake(); three(f);
    startPresentation(f.ctx); key("ArrowRight");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    key("Escape");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("shared-view bar", () => {
  const setup = () => { const f = fake(); three(f); const onEdit = vi.fn(); const dispose = mountSharedBar(f.ctx, onEdit); return { f, onEdit, dispose }; };
  const btn = (t: string) => [...document.querySelectorAll<HTMLButtonElement>(".ap-ro-bar button")].find((b) => b.textContent === t)!;

  it("marks the page read-only and offers Present and Make an editable copy", () => {
    setup();
    expect(document.documentElement.dataset.view).toBe("readonly");
    expect(document.querySelector(".ap-ro-msg")!.textContent).toMatch(/read-only/);
    expect(btn("Present")).toBeTruthy(); expect(btn("Make an editable copy")).toBeTruthy();
  });
  it("Present starts the presentation", () => {
    setup(); btn("Present").click();
    expect(document.querySelector(".ap-present")).not.toBeNull();
  });
  it("the copy needs a confirmation (it replaces the saved sheet); Cancel backs out without calling onEdit", () => {
    const { onEdit } = setup();
    btn("Make an editable copy").click();
    expect(document.querySelector(".ap-ro-msg")!.textContent).toMatch(/Replaces the sheet saved/);
    btn("Cancel").click();
    expect(onEdit).not.toHaveBeenCalled();
    expect(btn("Make an editable copy")).toBeTruthy();
  });
  it("confirming runs onEdit once, removes the bar and the read-only marker, and says so", () => {
    const { f, onEdit } = setup();
    btn("Make an editable copy").click(); btn("Make the copy").click();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(document.querySelector(".ap-ro-bar")).toBeNull();
    expect(document.documentElement.dataset.view).toBeUndefined();
    expect(f.toast).toHaveBeenCalledWith(expect.stringMatching(/your own editable copy/));
  });
  it("dispose removes everything", () => {
    const { dispose } = setup(); dispose();
    expect(document.querySelector(".ap-ro-bar")).toBeNull(); expect(document.documentElement.dataset.view).toBeUndefined();
  });
});

describe("link box", () => {
  it("shows the link selected, closes on Escape and on Close, and removes its listener", () => {
    const rem = vi.spyOn(window, "removeEventListener");
    const off = showLinkBox("https://x.test/#d=abc");
    const input = document.querySelector<HTMLInputElement>(".ap-linkbox input")!;
    expect(input.value).toBe("https://x.test/#d=abc"); expect(input.readOnly).toBe(true);
    key("Escape");
    expect(document.querySelector(".ap-linkbox")).toBeNull();
    expect(rem.mock.calls.some((c) => c[0] === "keydown")).toBe(true);
    const off2 = showLinkBox("u"); document.querySelector<HTMLButtonElement>(".ap-linkbox button")!.click();
    expect(document.querySelector(".ap-linkbox")).toBeNull();
    off(); off2();
  });
});
