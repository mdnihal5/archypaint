// @vitest-environment jsdom
// Every ribbon style control x every element kind it can be shown for: when styleCaps says the control applies, changing it must change
// what is drawn (canvas drawEl, and the SVG export for the cells that export draws); when it says it does not apply, the ribbon hides it
// and changing it must really draw nothing new (so hiding it loses nothing).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawCalc } from "./calc-draw";
import { createEditor, type Editor } from "./editor";
import { installIndex, installPack, resetPacks } from "./icon-pack";
import { drawEl } from "./renderer";
import { buildSvg } from "./io/svg";
import type { El, ElJSON } from "./scene";
import { LIGHT } from "./theme";
import { styleCaps, type StyleCap } from "./ui/props-model";

vi.hoisted(() => { (globalThis as { Path2D?: unknown }).Path2D = class { constructor(public d?: string) {} }; });

function rec() {
  const log: string[] = [];
  const st: Record<string, unknown> = { font: "13px x", textAlign: "center" };
  const ctx = new Proxy(st, {
    get: (t, k: string) => (k === "measureText" ? (s: string) => ({ width: s.length * 6 }) : k in t ? t[k] : (...args: unknown[]) => { log.push(`${k}(${args.map((a) => (typeof a === "number" ? Math.round(a * 10) / 10 : typeof a === "object" ? JSON.stringify(a) : String(a))).join(",")})`); }),
    set: (t, k: string, v) => { t[k] = v; log.push(`${k}=${typeof v === "number" ? Math.round(v * 100) / 100 : String(v)}`); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, out: () => log.join("|") };
}
const fakeCtx = new Proxy({}, { get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined), set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; } });

let stage: HTMLDivElement, ed: Editor;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div");
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT }); ed.renderer.resize(800, 600, 1);
  resetPacks();
  const MARK = '<path d="M0 0h24v24H0z" fill="#4169e1" stroke="none"/>', GLYPH = '<path d="M2 2h20v20H2z"/>';
  installIndex({ v: 2, icons: [["logo-sq", "Square", [], "data", "logos-x", "logo"], ["server", "Server", [], "compute", "core", ""]], groups: [["logos-x", "X"]] });
  installPack({ v: 2, pack: "logos-x", icons: [["logo-sq", "", MARK]] }); installPack({ v: 2, pack: "core", icons: [["server", GLYPH, GLYPH]] });
});
afterEach(() => { ed.destroy(); stage.remove(); });

type Init = Partial<El> & { kind: El["kind"] };
const SHAPES = ["cylinder", "cloud", "hexagon", "parallelogram", "triangle", "star", "note", "brace", "frame", "lane"] as const;
const KINDS: Array<[string, Init]> = [
  ["text", { kind: "text", w: 80, h: 20, text: "hello" }],
  ["rect", { kind: "rect", w: 120, h: 60, text: "hello" }], ["ellipse", { kind: "ellipse", w: 120, h: 60, text: "hello" }], ["diamond", { kind: "diamond", w: 120, h: 80, text: "hello" }],
  ...SHAPES.map((k): [string, Init] => [k, { kind: k, w: 140, h: 90, text: "hello" }]),
  ["badge", { kind: "badge", w: 30, h: 30, n: 3 }],
  ["icon", { kind: "icon", iconId: "server", w: 96, h: 96, text: "api" }],
  ["logo (bare)", { kind: "icon", iconId: "logo-sq", w: 96, h: 96, text: "api", fill: 3 }],
  ["logo (tile)", { kind: "icon", iconId: "logo-sq", w: 96, h: 96, text: "api", fill: 0 }],
  ["arrow", { kind: "arrow", w: 120, h: 40, pts: [0, 0, 40, 0, 40, 40, 120, 40], text: "go" }],
  ["legend", { kind: "legend", w: 200, h: 80, text: "a\nb" }],
  ["calc", { kind: "calc", w: 200, h: 80, text: "x" }],
  ["image", { kind: "image", w: 100, h: 80, img: "0123456789abcdef" }],
];
// each control: the cap it belongs to and the patch that changes it from the base style (fill 0, edge 0, dash 0, route 0, cat 0, default size/align)
const CONTROLS: Array<[string, StyleCap, Record<string, unknown>]> = [
  ["colour swatch", "colour", { cat: 4 }], ["custom hex", "colour", { hex: "#12ab34" }],
  ["fill tint", "fill", { fill: 1 }], ["fill solid", "fill", { fill: 2 }],
  ["edge", "edge", { edge: 2 }], ["dashed", "dash", { dash: 1 }],
  ["text size", "size", { fs: 20 }], ["align", "align", { align: "left" }], ["route", "route", { route: 2 }],
];

function drawOf(e: El): string {
  const r = rec();
  if (e.kind === "calc") drawCalc(r.ctx, e, LIGHT, 1, false, false); else drawEl(r.ctx, e, LIGHT, 1, false, false);
  return r.out();
}

describe("style controls x element kinds (canvas)", () => {
  for (const [name, init] of KINDS) {
    describe(name, () => {
      for (const [cn, cap, patch] of CONTROLS) {
        it(cn, () => {
          const e = ed.scene.add({ fill: 0, edge: 0, radius: 0, route: 0, dash: 0, ...init, x: 0, y: 0 });
          const before = drawOf(e);
          const applies = styleCaps(e)[cap];
          ed.select([e.id]); ed.setStyle(patch as never);
          const after = drawOf(e);
          if (applies) expect(after, `${cn} must change what ${name} draws`).not.toBe(before);
          else expect(after, `${cn} is hidden for ${name}, so it must draw nothing new`).toBe(before);
        });
      }
    });
  }
});

describe("text boxes: colour, tint and solid in the canvas and the SVG export", () => {
  const text = (extra: Partial<El> = {}) => ed.scene.add({ kind: "text", x: 10, y: 10, w: 80, h: 20, text: "hello", cat: 6, fill: 0, ...extra });
  const fills = (e: El) => { const r = rec(); drawEl(r.ctx, e, LIGHT, 1, false, false); return r.out(); };
  const svg = (e: El) => buildSvg([ed.scene.snapshot(e) as ElJSON & { z: number }] as never, LIGHT, { padding: 8, background: false, icons: () => null });

  it("outline fill: no box, ink text exactly as before (default colour)", () => {
    const e = text();
    const out = fills(e);
    expect(out).not.toContain("fill()");
    expect(out).toContain(`fillStyle=${LIGHT.ink}`);
    expect(svg(e)).toContain(`fill="${LIGHT.ink}"`);
    expect(svg(e)).not.toContain("<rect");
  });
  it("colour is the text ink colour", () => {
    const e = text({ hex: "#12ab34" });
    expect(fills(e)).toContain("fillStyle=#12ab34");
    expect(svg(e)).toContain('fill="#12ab34"');
    const c = text({ cat: 3 });
    expect(fills(c)).toContain(`fillStyle=${LIGHT.cats[3]}`);
  });
  it("tint: a soft rounded box with padding behind ink/coloured text", () => {
    const e = text({ fill: 1, hex: "#12ab34" });
    const out = fills(e);
    expect(out).toContain("roundRect(4,7,92,26,6)"); // 6 px of padding left/right, 3 px above/below
    expect(out).toContain(`globalAlpha=${LIGHT.tint}`);
    expect(out).toContain("fill()");
    expect(svg(e)).toContain(`<rect x="4" y="7" width="92" height="26" rx="6" fill="#12ab34" fill-opacity="${LIGHT.tint}"/>`);
  });
  it("solid: a solid box with contrast text (onSolid)", () => {
    const e = text({ fill: 2, hex: "#101010" });
    const out = fills(e);
    expect(out.indexOf("roundRect(4,7,92,26,6)")).toBeGreaterThan(-1);
    expect(out).toContain(`fillStyle=${LIGHT.paper}`); // dark box -> paper-coloured text
    expect(svg(e)).toContain('fill="#101010"/>');
    expect(svg(e)).toContain(`fill="${LIGHT.paper}"`);
    const light = text({ fill: 2, hex: "#f0f0a0" });
    expect(svg(light)).toContain(`fill="${LIGHT.ink}"`);
  });
});
