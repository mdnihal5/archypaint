import { describe, expect, it } from "vitest";
import { COLOUR_NAMES, DARK, LIGHT } from "./theme";
import { contrast } from "./ui/contrast";

describe("colours", () => {
  it("every colour has a name and a light and dark value", () => {
    expect(LIGHT.cats.length).toBe(COLOUR_NAMES.length);
    expect(DARK.cats.length).toBe(COLOUR_NAMES.length);
    expect(new Set(COLOUR_NAMES).size).toBe(COLOUR_NAMES.length);
  });
  it("the original eight categories keep their order and values (file format)", () => {
    expect(COLOUR_NAMES.slice(0, 8)).toEqual(["data", "cache", "network", "compute", "queue", "security", "client", "external"]);
    expect(LIGHT.cats.slice(0, 8)).toEqual(["#2b6f9e", "#a25a17", "#2d7b4d", "#6a4fa3", "#0e777e", "#9b3d6b", "#4d5a64", "#7a6a3a"]);
    expect(DARK.cats.slice(0, 8)).toEqual(["#5aa9e6", "#f0913a", "#4cc38a", "#a48af0", "#34c6cf", "#e879b0", "#a9b3be", "#d4bb6a"]);
  });
  it("light theme is white, not warm", () => {
    expect(LIGHT.paper).toBe("#ffffff");
    expect(LIGHT.card).toBe("#ffffff");
  });
  it("every colour is readable on its own paper (>= 3:1)", () => {
    LIGHT.cats.forEach((c, i) => expect(contrast(c, LIGHT.paper), `light ${COLOUR_NAMES[i]}`).toBeGreaterThanOrEqual(3));
    DARK.cats.forEach((c, i) => expect(contrast(c, DARK.paper), `dark ${COLOUR_NAMES[i]}`).toBeGreaterThanOrEqual(3));
  });
});
