// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { pickCalcTemplate } from "./calc-picker";
import { CALC_TEMPLATES } from "./calc-templates";
import { SAMPLE } from "./calc-view";

const key = (k: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("capacity-note starter picker", () => {
  it("lists the sample and every template; a number key chooses one", async () => {
    const p = pickCalcTemplate();
    expect(document.querySelectorAll(".ap-cpick button").length).toBe(CALC_TEMPLATES.length + 1);
    expect(document.querySelector(".ap-cpick")!.textContent).toMatch(/URL shortener/);
    key("3");
    expect(await p).toBe(CALC_TEMPLATES[1]!.text);
    expect(document.querySelector(".ap-cpick")).toBeNull();
  });
  it("arrows + Enter choose, Enter on the first is the quick sample, Esc dismisses with null", async () => {
    let p = pickCalcTemplate(); key("Enter"); expect(await p).toBe(SAMPLE);
    p = pickCalcTemplate(); key("ArrowDown"); key("ArrowDown"); key("Enter"); expect(await p).toBe(CALC_TEMPLATES[1]!.text);
    p = pickCalcTemplate(); key("ArrowUp"); key("Enter"); expect(await p).toBe(CALC_TEMPLATES[CALC_TEMPLATES.length - 1]!.text);
    p = pickCalcTemplate(); key("Escape"); expect(await p).toBeNull();
  });
  it("owns the keyboard while open: the canvas shortcuts never see the key", async () => {
    const seen = vi.fn(); window.addEventListener("keydown", seen);
    const p = pickCalcTemplate(); key("r"); key("Escape"); await p;
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });
  it("20 open / close cycles leave no listeners, styles or nodes behind", async () => {
    const add = vi.spyOn(window, "addEventListener"), rm = vi.spyOn(window, "removeEventListener");
    const n0 = document.querySelectorAll("*").length;
    for (let i = 0; i < 20; i++) { const p = pickCalcTemplate(); key(i % 2 ? "Escape" : "2"); await p; }
    expect(add.mock.calls.length).toBe(rm.mock.calls.length);
    expect(document.querySelectorAll("*").length).toBe(n0);
    add.mockRestore(); rm.mockRestore();
  });
});
