import { describe, expect, it, vi } from "vitest";
import { createUpdater } from "./dom";

function fakeRaf() {
  const q: Array<() => void> = [];
  return { raf: (cb: () => void) => q.push(cb), caf: () => {}, flush() { const c = q.splice(0); c.forEach((f) => f()); }, size: () => q.length };
}

describe("createUpdater", () => {
  it("coalesces many schedule() calls in one frame into one run", () => {
    const f = fakeRaf(); const fn = vi.fn();
    const u = createUpdater("t-coalesce", fn, f);
    for (let i = 0; i < 100; i++) u.schedule();
    expect(f.size()).toBe(1);
    f.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("drops a schedule() made from inside its own run: an update cannot re-trigger itself", () => {
    const f = fakeRaf();
    let n = 0; let u!: ReturnType<typeof createUpdater>;
    u = createUpdater("t-reentrant", () => { n++; u.schedule(); }, f);
    u.schedule(); f.flush();
    expect(n).toBe(1);
    expect(f.size()).toBe(0); // nothing re-queued
    expect(u.drops).toBe(1);
  });
  it("cancel() stops pending and future runs", () => {
    const f = fakeRaf(); const fn = vi.fn();
    const u = createUpdater("t-cancel", fn, f);
    u.schedule(); u.cancel(); f.flush(); u.schedule(); f.flush();
    expect(fn).not.toHaveBeenCalled();
  });
  it("warns (dev) when it runs >60x in a second with no input", () => {
    const f = fakeRaf(); const warn = vi.fn(); let t = 1_000_000;
    const u = createUpdater("t-loop", () => {}, { ...f, now: () => t, warn });
    for (let i = 0; i < 70; i++) { u.schedule(); f.flush(); t += 5; }
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it("does not warn at a normal rate", () => {
    const f = fakeRaf(); const warn = vi.fn(); let t = 2_000_000;
    const u = createUpdater("t-ok", () => {}, { ...f, now: () => t, warn });
    for (let i = 0; i < 40; i++) { u.schedule(); f.flush(); t += 30; }
    expect(warn).not.toHaveBeenCalled();
  });
});
