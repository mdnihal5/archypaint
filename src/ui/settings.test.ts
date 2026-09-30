import { describe, expect, it } from "vitest";
import { DEFAULTS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("returns defaults for null / corrupt / wrong-shape input", () => {
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings("{not json")).toEqual(DEFAULTS);
    expect(parseSettings("[1,2]")).toEqual(DEFAULTS);
    expect(parseSettings('"x"')).toEqual(DEFAULTS);
  });
  it("keeps valid fields and rejects invalid ones individually", () => {
    const s = parseSettings(JSON.stringify({ bg: "plain", theme: "purple", frame: false, hud: "yes", scale: "1:50", rev: 7 }));
    expect(s.bg).toBe("plain");
    expect(s.theme).toBe(DEFAULTS.theme);
    expect(s.frame).toBe(false);
    expect(s.hud).toBe(DEFAULTS.hud);
    expect(s.scale).toBe("1:50");
    expect(s.rev).toBe(DEFAULTS.rev);
  });
  it("bounds free-text fields", () => {
    expect(parseSettings(JSON.stringify({ scale: "x".repeat(500) })).scale.length).toBe(24);
  });
});
