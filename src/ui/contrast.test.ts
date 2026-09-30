import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";

// dynamic specifier: the project has no @types/node, and vitest may blank CSS imports, so read the file directly
const { readFileSync } = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(p: URL, enc: string): string };
const css = readFileSync(new URL("./ui.css", import.meta.url), "utf8");

/** read the design tokens straight from ui.css so the test can never drift from what ships */
function tokens(block: RegExp): Record<string, string> {
  const m = css.match(block);
  if (!m) throw new Error(`token block not found: ${block}`);
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1]!.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) out[k!] = v!;
  return out;
}
const light = tokens(/:root\s*\{([^}]*)\}/);
const dark = tokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

describe.each([["light", light], ["dark", dark]] as const)("%s theme tokens", (_n, t) => {
  it("has every token the chrome relies on", () => {
    for (const k of ["paper", "card", "panel", "ink", "mid", "red-ink", "cat0", "cat7"]) expect(t[k], k).toBeTruthy();
  });
  it("text pairs meet WCAG AA (4.5:1)", () => {
    for (const [fg, bg] of [["ink", "paper"], ["ink", "card"], ["ink", "panel"], ["mid", "paper"], ["mid", "card"], ["mid", "panel"], ["red-ink", "paper"], ["red-ink", "card"], ["red-ink", "panel"]] as const)
      expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it("category colours are distinguishable from the panel (>= 3:1, non-text UI)", () => {
    for (let i = 0; i < 8; i++) expect(contrast(t[`cat${i}`]!, t.panel!), `cat${i}`).toBeGreaterThanOrEqual(3);
  });
});
