import { describe, expect, it } from "vitest";
import { COLOUR_NAMES, DARK, LIGHT, colourOf, normHex, onSolid } from "./theme";
import { contrast, luminance } from "./ui/contrast";

describe("colours", () => {
  it("every colour has a name and a light and dark value", () => {
    expect(LIGHT.cats.length).toBe(COLOUR_NAMES.length);
    expect(DARK.cats.length).toBe(COLOUR_NAMES.length);
    expect(new Set(COLOUR_NAMES).size).toBe(COLOUR_NAMES.length);
  });
  it("the original eight categories keep their order (file format); the light theme now uses the softer tones", () => {
    expect(COLOUR_NAMES.slice(0, 8)).toEqual(["data", "cache", "network", "compute", "queue", "security", "client", "external"]);
    expect(LIGHT.cats.slice(0, 8)).toEqual(["#5aa9e6", "#f0913a", "#4cc38a", "#a48af0", "#34c6cf", "#e879b0", "#a9b3be", "#d4bb6a"]);
    expect(DARK.cats.slice(0, 8)).toEqual(["#5aa9e6", "#f0913a", "#4cc38a", "#a48af0", "#34c6cf", "#e879b0", "#a9b3be", "#d4bb6a"]);
  });
  it("light theme is white, not warm", () => {
    expect(LIGHT.paper).toBe("#ffffff");
    expect(LIGHT.card).toBe("#ffffff");
  });
  it("colours stay visible on their paper: light colours >= 1.8:1 (soft by design), dark colours >= 3:1", () => {
    LIGHT.cats.forEach((c, i) => expect(contrast(c, LIGHT.paper), `light ${COLOUR_NAMES[i]}`).toBeGreaterThanOrEqual(1.8));
    DARK.cats.forEach((c, i) => expect(contrast(c, DARK.paper), `dark ${COLOUR_NAMES[i]}`).toBeGreaterThanOrEqual(3));
  });
  it("no light-theme colour is a dark one", () => {
    LIGHT.cats.forEach((c, i) => expect(luminance(c), `light ${COLOUR_NAMES[i]}`).toBeGreaterThan(0.25));
  });
  it("text on a solid fill picks ink for light colours and paper for dark ones", () => {
    expect(onSolid(LIGHT, "#ffab6e")).toBe(LIGHT.ink);
    expect(onSolid(LIGHT, "#1d4ed8")).toBe(LIGHT.paper);
    expect(onSolid(DARK, "#6cc4ff")).toBe(DARK.ink);
  });
  it("normHex accepts 3 and 6 digit hex with or without #, rejects everything else", () => {
    expect(normHex("fff")).toBe("#ffffff");
    expect(normHex("#FFa500")).toBe("#ffa500");
    expect(normHex("  #abc ")).toBe("#aabbcc");
    for (const bad of ["", "#", "ff", "ffff", "#12345", "#1234567", "#ggg", "red", "#fff\"><script>", "url(x)", null, undefined, 12, {}]) expect(normHex(bad as never), String(bad)).toBe("");
  });
  it("colourOf prefers a custom hex over the colour slot", () => {
    expect(colourOf(LIGHT, { cat: 2 })).toBe(LIGHT.cats[2]);
    expect(colourOf(LIGHT, { cat: 2, hex: "#123456" })).toBe("#123456");
    expect(colourOf(LIGHT, { cat: 26 })).toBe(LIGHT.cats[2]); // wraps like old readers do
  });
});
