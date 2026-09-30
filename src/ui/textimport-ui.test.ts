// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "../editor";
import type { FeatureCtx } from "../features/types";
import { installIndex, resetPacks } from "../icon-pack";
import { LIGHT } from "../theme";
import { openTextImport, summarize } from "./textimport-ui";
import { parseDiagram } from "../textdsl";

const fakeCtx2d = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});

let stage: HTMLDivElement, ui: HTMLDivElement;
let ed: Editor;
let toasts: string[];
let ctx: FeatureCtx;

beforeEach(() => {
  vi.useFakeTimers();
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx2d) as never;
  stage = document.createElement("div");
  stage.setPointerCapture = () => {}; stage.releasePointerCapture = () => {};
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ui = document.createElement("div"); ui.id = "ui"; document.body.append(ui);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  ed.renderer.resize(1200, 800, 1);
  resetPacks();
  installIndex({ v: 2, icons: [["redis", "Redis", ["cache"], "cache", "core", ""], ["postgresql", "PostgreSQL", ["postgres"], "data", "core", ""]] });
  toasts = [];
  ctx = { editor: ed, io: {} as never, toast: (m) => { toasts.push(m); }, confirm: async () => true, stage };
});
afterEach(() => { vi.useRealTimers(); ed.destroy(); stage.remove(); ui.remove(); resetPacks(); });

const ta = () => document.querySelector<HTMLTextAreaElement>(".ap-ti-text")!;
const go = () => document.querySelector<HTMLButtonElement>(".ap-ti-go")!;
const status = () => document.querySelector<HTMLElement>(".ap-ti-status")!.textContent;
const type = async (v: string) => { ta().value = v; ta().dispatchEvent(new Event("input", { bubbles: true })); await vi.advanceTimersByTimeAsync(200); };
const modal = () => document.querySelector(".ap-back");

describe("Diagram from text overlay", () => {
  it("opens as a modal with the textarea focused and Import disabled", async () => {
    openTextImport(ctx);
    await vi.advanceTimersByTimeAsync(10);
    expect(modal()).toBeTruthy();
    expect(document.activeElement).toBe(ta());
    expect(go().disabled).toBe(true);
    expect(status()).toBe("");
  });
  it("live preview: counts for good text, line-numbered problems for bad text, Import follows", async () => {
    openTextImport(ctx);
    await type("a -> b -> [c, d]");
    expect(status()).toBe("4 nodes · 3 arrows · text");
    expect(go().disabled).toBe(false);
    await type("a -> b\nb ->");
    expect(go().disabled).toBe(true);
    expect(status()).toMatch(/1 problem/);
    expect(document.querySelector(".ap-ti-diag li[data-k=err]")!.textContent).toContain("line 2");
    await type("flowchart LR\nA-->B\nstyle A fill:#f00");
    expect(go().disabled).toBe(false);
    expect(status()).toContain("Mermaid");
    expect(document.querySelector(".ap-ti-diag li[data-k=warn]")!.textContent).toContain("line 3");
  });
  it("icons known to the index show up in the preview (exact matches only)", async () => {
    openTextImport(ctx);
    await vi.advanceTimersByTimeAsync(20); // the index finishes loading and the preview re-parses
    await type("postgres -> Redis -> widgets");
    expect(status()).toBe("3 nodes · 2 arrows · 2 icons · text");
  });
  it("Import adds one undoable step, closes the overlay and confirms with a toast", async () => {
    openTextImport(ctx);
    await type("a -> b");
    go().click();
    expect(modal()).toBeNull();
    expect(ed.scene.els.size).toBe(3);
    expect(toasts.join()).toContain("Imported 2 nodes and 1 arrow.");
    ed.undo();
    expect(ed.scene.els.size).toBe(0);
  });
  it("importing right after typing uses the current text, not a stale preview", async () => {
    openTextImport(ctx);
    await type("a -> b");
    ta().value = "x -> y -> z"; ta().dispatchEvent(new Event("input", { bubbles: true })); // debounce still pending
    go().disabled = false;
    go().click();
    expect([...ed.scene.els.values()].filter((e) => e.kind !== "arrow").map((e) => e.text).sort()).toEqual(["x", "y", "z"]);
  });
  it("Ctrl/Cmd+Enter imports; it does nothing while there are errors", async () => {
    openTextImport(ctx);
    await type("a ->");
    ta().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(ed.scene.els.size).toBe(0);
    expect(modal()).toBeTruthy();
    await type("a -> b");
    ta().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    expect(ed.scene.els.size).toBe(3);
  });
  it("the two example buttons fill the box with text that previews cleanly", async () => {
    openTextImport(ctx);
    const [dsl, mer] = [...document.querySelectorAll<HTMLButtonElement>(".ap-ti-ex button")];
    dsl!.click();
    expect(go().disabled).toBe(false);
    expect(parseDiagram(ta().value).errors).toEqual([]);
    expect(status()).toContain("text");
    mer!.click();
    expect(go().disabled).toBe(false);
    expect(status()).toContain("Mermaid");
  });
  it("Escape and Cancel close it without importing", async () => {
    openTextImport(ctx);
    await type("a -> b");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(modal()).toBeNull();
    openTextImport(ctx);
    document.querySelectorAll<HTMLButtonElement>(".ap-actions button")[0]!.click();
    expect(modal()).toBeNull();
    expect(ed.scene.els.size).toBe(0);
  });
  it("a huge paste is rejected with the limit message, not truncated or frozen", async () => {
    openTextImport(ctx);
    await type("a -> b\n".repeat(40_000));
    expect(go().disabled).toBe(true);
    expect(document.querySelector(".ap-ti-diag")!.textContent).toMatch(/limit/);
  });
  it("only the first notes are listed, with a count of the rest", async () => {
    openTextImport(ctx);
    await type("flowchart LR\n" + Array.from({ length: 20 }, (_, i) => `style n${i} fill:#fff`).join("\n") + "\nA-->B");
    expect(document.querySelectorAll(".ap-ti-diag li").length).toBeLessThanOrEqual(9);
  });
});

describe("teardown: nothing is left behind", () => {
  it("40 open/close cycles leave no DOM, no timers and balanced document/window listeners", async () => {
    const counts = { add: 0, remove: 0 };
    const wrap = (t: EventTarget) => {
      const a = t.addEventListener.bind(t), r = t.removeEventListener.bind(t);
      t.addEventListener = ((...x: Parameters<typeof a>) => { counts.add++; return a(...x); }) as never;
      t.removeEventListener = ((...x: Parameters<typeof r>) => { counts.remove++; return r(...x); }) as never;
      return () => { t.addEventListener = a as never; t.removeEventListener = r as never; };
    };
    const undo = [wrap(document), wrap(window)];
    const nodes0 = document.getElementsByTagName("*").length;
    for (let i = 0; i < 40; i++) {
      const h = openTextImport(ctx);
      await type(i % 2 ? "a -> b" : "flowchart TB\nA-->B");
      if (i % 3 === 0) { ta().value = "typed but not yet parsed"; ta().dispatchEvent(new Event("input", { bubbles: true })); } // a debounce timer is pending at close
      h.close();
      h.close(); // idempotent
    }
    undo.forEach((f) => f());
    expect(modal()).toBeNull();
    expect(document.getElementsByTagName("*").length).toBe(nodes0);
    expect(counts.add).toBe(counts.remove);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("closing while the icon index is still loading does not touch a dead overlay", async () => {
    resetPacks();
    const h = openTextImport(ctx);
    h.close();
    await vi.advanceTimersByTimeAsync(50);
    expect(modal()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("summarize", () => {
  it("pluralises and lists what was found", () => {
    expect(summarize(parseDiagram("a -> b"))).toEqual({ text: "2 nodes · 1 arrow · text", ok: true });
    expect(summarize(parseDiagram("[g] { a }\na -> b")).text).toContain("1 group");
    expect(summarize(parseDiagram("a ->"))).toMatchObject({ ok: false });
    expect(summarize(parseDiagram(""))).toMatchObject({ ok: false });
  });
});
