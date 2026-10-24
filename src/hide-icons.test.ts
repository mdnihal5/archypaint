// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installIndex, installPack, resetPacks } from "./icon-pack";
import { drawIconEl } from "./icons";
import { drawEl } from "./renderer";
import { Scene, type El } from "./scene";
import { LIGHT } from "./theme";
import { buildSvg } from "./io/svg";
import { DEFAULTS, parseSettings } from "./ui/settings";
import { createEditor, type Editor } from "./editor";

/** a recording 2D context: every call logged, 6 units per character */
function rec() {
  const calls: { op: string; args: unknown[] }[] = [];
  const st: Record<string, unknown> = { font: "13px x", textAlign: "center" };
  const ctx = new Proxy(st, {
    get: (t, k: string) => (k === "measureText" ? (s: string) => ({ width: s.length * 6 }) : k in t ? t[k] : (...args: unknown[]) => { calls.push({ op: k, args }); }),
    set: (t, k: string, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  const n = (op: string) => calls.filter((c) => c.op === op).length;
  return { ctx, calls, n, labels: () => calls.filter((c) => c.op === "fillText").map((c) => c.args[0]) };
}

const MARK = '<path d="M0 0h24v24H0z" fill="#4169e1" stroke="none"/>';
const GLYPH = '<path d="M2 2h20v20H2z"/>';
const install = () => {
  installIndex({ v: 2, icons: [["logo-sq", "Square", [], "data", "logos-x", "logo"], ["server", "Server", [], "compute", "core", ""]], groups: [["logos-x", "X"]] });
  installPack({ v: 2, pack: "logos-x", icons: [["logo-sq", "", MARK]] });
  installPack({ v: 2, pack: "core", icons: [["server", GLYPH, GLYPH]] });
};
const mkIcon = (p: Partial<El>): El => new Scene().add({ kind: "icon", x: 0, y: 0, w: 96, h: 96, text: "api", ...p });

beforeEach(() => { vi.stubGlobal("Path2D", class { constructor(public d?: string) {} }); resetPacks(); install(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Hide icons: the render-time path", () => {
  it("a tiled icon: with the flag on the picture is not drawn, the tile outline and the label still are", () => {
    const e = mkIcon({ iconId: "server", fill: 0 });
    const on = rec(); drawIconEl(on.ctx, e, LIGHT, 1, false, false);
    const off = rec(); drawIconEl(off.ctx, e, LIGHT, 1, false, true);
    expect(on.n("stroke")).toBeGreaterThan(off.n("stroke")); // the glyph's own stroke is the difference
    expect(off.n("stroke")).toBe(1); // only the tile outline
    expect(off.n("roundRect") + off.n("rect")).toBe(1); // the tile is still there
    expect(off.labels()).toEqual(["api"]); expect(on.labels()).toEqual(["api"]);
    expect(off.n("scale")).toBe(0); expect(on.n("scale")).toBeGreaterThan(0); // the glyph transform is the picture
  });
  it("a bare brand logo: nothing but the label is drawn (no mark, no placeholder block)", () => {
    const e = mkIcon({ iconId: "logo-sq", fill: 3 });
    const on = rec(); drawIconEl(on.ctx, e, LIGHT, 1, false, false);
    const off = rec(); drawIconEl(off.ctx, e, LIGHT, 1, false, true);
    expect(on.n("fill")).toBeGreaterThan(0);
    expect(off.n("fill")).toBe(0); expect(off.n("fillRect")).toBe(0); expect(off.n("stroke")).toBe(0);
    expect(off.labels()).toEqual(["api"]);
  });
  it("drawEl forwards the flag to icons only: rectangles and text are unaffected", () => {
    const logo = mkIcon({ iconId: "logo-sq", fill: 3 });
    const a = rec(); drawEl(a.ctx, logo, LIGHT, 1, false, false, false);
    const b = rec(); drawEl(b.ctx, logo, LIGHT, 1, false, false, true);
    expect(a.n("fill")).toBeGreaterThan(b.n("fill"));
    const box = new Scene().add({ kind: "rect", x: 0, y: 0, w: 100, h: 60, text: "db", fill: 1 });
    const r1 = rec(); drawEl(r1.ctx, box, LIGHT, 1, false, false, false);
    const r2 = rec(); drawEl(r2.ctx, box, LIGHT, 1, false, false, true);
    expect(r2.calls.map((c) => c.op)).toEqual(r1.calls.map((c) => c.op));
  });
  it("the flag is a view flag: it is not in the scene JSON and not in undo history", () => {
    const stage = document.createElement("div"); (stage as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    const a = document.createElement("canvas"), b = document.createElement("canvas");
    stage.append(a, b); document.body.append(stage);
    HTMLCanvasElement.prototype.getContext = (() => rec().ctx) as never;
    const ed: Editor = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
    const e = ed.placeIcon("server");
    const json = JSON.stringify(ed.scene.toJSON()), depth = ed.hist.size();
    ed.setHideIcons(true);
    expect(ed.hideIcons).toBe(true); expect(ed.renderer.hideIcons).toBe(true);
    expect(JSON.stringify(ed.scene.toJSON())).toBe(json); expect(ed.hist.size()).toBe(depth); expect(ed.canUndo()).toBe(true);
    expect(ed.scene.els.get(e.id)!.iconId).toBe("server");
    ed.undo(); expect(ed.hideIcons).toBe(true); // undo never touches it
    ed.setHideIcons(false); expect(ed.hideIcons).toBe(false);
    ed.destroy(); stage.remove();
  });
  it("SVG export: with the flag the tile and the label stay and the picture (<use>) is gone", () => {
    const els = [mkIcon({ iconId: "server", fill: 0, id: "a" }), mkIcon({ iconId: "logo-sq", fill: 3, id: "b", x: 200 })];
    const normal = buildSvg(els, LIGHT, { background: false, padding: 8, icons: () => GLYPH });
    const hidden = buildSvg(els, LIGHT, { background: false, padding: 8, icons: () => GLYPH, hideIcons: true });
    expect(normal).toContain("<use "); expect(hidden).not.toContain("<use "); expect(hidden).not.toContain("<symbol");
    expect(hidden).toContain("<rect"); expect(hidden).toContain(">api<"); // the tile and the name remain
  });
  it("the setting is persisted: default off, parsed strictly", () => {
    expect(DEFAULTS.hideIcons).toBe(false);
    expect(parseSettings(JSON.stringify({ hideIcons: true })).hideIcons).toBe(true);
    expect(parseSettings(JSON.stringify({ hideIcons: "yes" })).hideIcons).toBe(false);
  });
});
