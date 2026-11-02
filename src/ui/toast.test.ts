// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToasts } from "./toast";

let root: HTMLElement;
beforeEach(() => { vi.useFakeTimers(); root = document.createElement("div"); document.body.append(root); });
afterEach(() => { vi.useRealTimers(); root.remove(); });
const shown = () => [...root.querySelectorAll(".ap-toast")].map((e) => e.textContent);

describe("toasts", () => {
  it("identical toasts coalesce instead of stacking (autosave 'Saved' once per quiet period)", () => {
    const t = createToasts(root);
    t.toast("Saved"); t.toast("Saved"); t.toast("Saved");
    expect(shown()).toEqual(["Saved"]);
    t.dispose();
  });
  it("a repeat restarts the timer: the toast lives 2.4 s from the LAST occurrence", () => {
    const t = createToasts(root);
    t.toast("Saved");
    vi.advanceTimersByTime(2000); t.toast("Saved");
    vi.advanceTimersByTime(2000); expect(shown()).toEqual(["Saved"]);
    vi.advanceTimersByTime(500); expect(shown()).toEqual([]);
    t.dispose();
  });
  it("different text or kind still stacks, capped at 3 with the oldest dropped", () => {
    const t = createToasts(root);
    t.toast("a"); t.toast("a", "err"); t.toast("b"); t.toast("c");
    expect(shown()).toEqual(["a", "b", "c"]);
    t.toast("b"); expect(shown()).toEqual(["a", "b", "c"]);
    t.dispose();
  });
  it("an expired toast can be shown again, and dispose leaves no timers or nodes", () => {
    const t = createToasts(root);
    t.toast("Saved"); vi.advanceTimersByTime(3000); expect(shown()).toEqual([]);
    t.toast("Saved"); expect(shown()).toEqual(["Saved"]);
    t.dispose();
    expect(vi.getTimerCount()).toBe(0); expect(root.querySelector(".ap-toasts")).toBeNull();
  });
});

describe("toast with an action (Undo)", () => {
  it("shows a button, runs it once, removes the toast, and lives 7 s", () => {
    const t = createToasts(root);
    const run = vi.fn();
    t.toast("Deleted “x”", "ok", { label: "Undo", run });
    vi.advanceTimersByTime(6900); expect(shown()).toEqual(["Deleted “x”Undo"]);
    root.querySelector<HTMLButtonElement>(".ap-tact")!.click();
    expect(run).toHaveBeenCalledTimes(1); expect(shown()).toEqual([]);
    t.toast("Deleted “y”", "ok", { label: "Undo", run }); vi.advanceTimersByTime(7100); expect(shown()).toEqual([]);
    t.dispose();
  });
  it("keeps coalescing: the same action toast restarts its timer and uses the newest handler; dispose leaves no timers", () => {
    const t = createToasts(root);
    const a = vi.fn(), b = vi.fn();
    t.toast("same", "ok", { label: "Undo", run: a }); t.toast("same", "ok", { label: "Undo", run: b });
    expect(root.querySelectorAll(".ap-toast")).toHaveLength(1);
    root.querySelector<HTMLButtonElement>(".ap-tact")!.click();
    expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledTimes(1);
    t.toast("again", "ok", { label: "Undo", run: a });
    t.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
});
