import { describe, expect, it } from "vitest";
import { htmlJs, staticImports, startupFrom } from "../scripts/size-lib.mjs";

const HTML = `<script type="module" crossorigin src="/assets/index-A.js"></script>
<link rel="modulepreload" crossorigin href="/assets/connectors-B.js">
<link rel="modulepreload" crossorigin href="/assets/theme-C.js">
<link rel="stylesheet" crossorigin href="/assets/index-D.css">`;

describe("startup size gate", () => {
  it("lists the entry and every modulepreload, not stylesheets", () => {
    expect(htmlJs(HTML)).toEqual(["assets/index-A.js", "assets/connectors-B.js", "assets/theme-C.js"]);
  });
  it("follows static imports but not dynamic ones", () => {
    expect(staticImports(`import{a as b}from"./x-1.js";export{c}from"./y-2.js";import"./z-3.js";const m=()=>import("./lazy-4.js");`).sort()).toEqual(["x-1.js", "y-2.js", "z-3.js"]);
  });
  it("sums the real startup set, including a chunk only imported statically", () => {
    const enc = new TextEncoder();
    const files: Record<string, string> = {
      "index-A.js": `import{x}from"./hidden-E.js";import("./lazy-F.js");`.padEnd(2000, "a"),
      "hidden-E.js": "export const x=1;".padEnd(2000, "b"),
      "lazy-F.js": "export const y=1;".padEnd(2000, "c"),
    };
    const set = startupFrom(`<script type="module" src="/assets/index-A.js"></script>`, (f) => enc.encode(files[f]!));
    expect(set.map((s) => s.file)).toEqual(["index-A.js", "hidden-E.js"]);
  });
});
