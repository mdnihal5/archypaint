import { describe, expect, it } from "vitest";
import { ICON_ALIASES, isDarkPaper, isLogoId, themedLogoMarkup } from "./logos";
import { DARK, LIGHT } from "./theme";

const M = '<path d="M1 1h4v4z" fill="#4169e1" data-d="#8fa8f5" data-l="#2a4fc4" stroke="none"/><path d="M0 0h2v2z" fill="#ff4438" fill-opacity="0.5" stroke="none"/><path d="M3 3h1v1z" fill="#231f20" data-d="#e4e4e7" stroke="none"/>';

describe("themedLogoMarkup", () => {
  it("picks the dark / light replacement colour where the build marked one, and the brand colour elsewhere", () => {
    const dark = themedLogoMarkup(M, true), light = themedLogoMarkup(M, false);
    expect(dark).toContain('fill="#8fa8f5"'); expect(dark).toContain('fill="#e4e4e7"'); expect(dark).toContain('fill="#ff4438" fill-opacity="0.5"');
    expect(light).toContain('fill="#2a4fc4"'); expect(light).toContain('fill="#231f20"'); // no light variant for the third mark: brand colour
  });
  it("leaves plain SVG: no data-* attributes remain, and it is idempotent", () => {
    for (const dark of [true, false]) {
      const out = themedLogoMarkup(M, dark);
      expect(out).not.toContain("data-");
      expect(themedLogoMarkup(out, dark)).toBe(out);
    }
  });
  it("mono draws every mark in currentColor (a solid-filled tile) and keeps opacity", () => {
    const out = themedLogoMarkup(M, true, true);
    expect(out).not.toMatch(/#[0-9a-f]{6}/);
    expect(out.match(/fill="currentColor"/g)).toHaveLength(3);
    expect(out).toContain('fill="currentColor" fill-opacity="0.5"');
  });
  it("does not touch markup without brand colours (drawn icons)", () => {
    const drawn = '<rect x="1" y="1" width="4" height="4" fill="currentColor" fill-opacity="0.3"/><path d="M0 0L3 3"/>';
    expect(themedLogoMarkup(drawn, true)).toBe(drawn);
    expect(themedLogoMarkup(drawn, false, true)).toBe(drawn);
  });
});

describe("theme detection and ids", () => {
  it("isDarkPaper tells the two themes' paper colours apart", () => {
    expect(isDarkPaper(DARK.paper)).toBe(true);
    expect(isDarkPaper(LIGHT.paper)).toBe(false);
    expect(isDarkPaper("")).toBe(false);
  });
  it("logo ids carry the logo- prefix", () => {
    expect(isLogoId("logo-redis")).toBe(true);
    expect(isLogoId("redis")).toBe(false);
    expect(isLogoId("aws-s3")).toBe(false);
  });
  it("aliases point at ids that exist in the shipped catalog (checked in logos-catalog.test.ts) and never chain", () => {
    for (const [from, to] of Object.entries(ICON_ALIASES)) { expect(from).not.toBe(to); expect(ICON_ALIASES[to]).toBeUndefined(); }
  });
});
