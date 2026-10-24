// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { toExcalidraw } from "./io/excalidraw";
import { parseArch, serializeArch } from "./io/format";
import { LIGHT } from "./theme";
import { bareMarkTransform, isBareLogo } from "./icons";
import { installIndex, installPack, resetPacks } from "./icon-pack";
import { buildSvg } from "./io/svg";
import { wellFormed } from "./io/testkit";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});
let stage: HTMLDivElement;
let ed: Editor;
const mk = (): Editor => {
  stage = document.createElement("div");
  stage.setPointerCapture = () => {}; stage.releasePointerCapture = () => {};
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  const e = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  e.renderer.resize(1400, 900, 1);
  return e;
};

beforeEach(() => { resetPacks(); HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never; ed = mk(); });
afterEach(() => { ed.destroy(); stage.remove(); });


const MARK = '<path d="M0 0h24v24H0z" fill="#4169e1" stroke="none"/>';
const install = () => {
  installIndex({ v: 2, icons: [
    ["logo-square", "Square", [], "data", "logos-x", "logo"], ["logo-word", "Wordmark", [], "data", "logos-x", "logo", [0, 8.4, 24, 7.1]],
    ["server", "Server", [], "compute", "core", ""],
  ], groups: [["logos-x", "X"]] });
  installPack({ v: 2, pack: "logos-x", icons: [["logo-square", "", MARK], ["logo-word", "", MARK]] });
  installPack({ v: 2, pack: "core", icons: [["server", '<path d="M0 0"/>', '<path d="M0 0"/>']] });
};

describe("borderless brand logos", () => {
  it("placeIcon: a logo is bare (fill 3), a generic icon keeps its tile fill, a wordmark gets a wide box", () => {
    install();
    const sq = ed.placeIcon("logo-square"), wd = ed.placeIcon("logo-word"), gen = ed.placeIcon("server");
    expect(sq.fill).toBe(3); expect(wd.fill).toBe(3); expect(gen.fill).not.toBe(3);
    expect([sq.w, sq.h]).toEqual([48, 48]);
    expect(wd.w).toBeGreaterThan(100); expect(wd.h).toBe(48); // 24 / 7.1 wide: a square box would make it a hairline
    expect(isBareLogo(sq)).toBe(true); expect(isBareLogo(gen)).toBe(false);
    expect(isBareLogo({ iconId: "logo-square", fill: 1 })).toBe(false); // picking a fill brings the tile back
  });
  it("bareMarkTransform fits the content box into the element box, centred, to a small margin", () => {
    const sq = bareMarkTransform([0, 0, 24, 24], 100, 100, 48, 48);
    expect(sq.s).toBeCloseTo((48 * 0.92) / 24, 6); expect(sq.tx).toBeCloseTo(100 + 24 - 12 * sq.s, 6); expect(sq.ty).toBeCloseTo(sq.tx, 6);
    const w = bareMarkTransform([0, 8.4, 24, 7.1], 0, 0, 115, 48); // width-limited
    expect(w.s).toBeCloseTo((115 * 0.92) / 24, 6);
    expect(w.ty + (8.4 + 3.55) * w.s).toBeCloseTo(24, 6); // the mark's centre lands at the box centre
    const tall = bareMarkTransform([4.7, 0, 14.7, 24], 0, 0, 48, 48); // height-limited
    expect(tall.s).toBeCloseTo((48 * 0.92) / 24, 6);
  });
  it("a bare logo's box, selection, hit-testing and ports are the element box (label strip included)", () => {
    install();
    const e = ed.placeIcon("logo-square", { x: 300, y: 300 });
    ed.select([e.id]); ed.setStyle({ fs: 12 }); // no text yet: nothing changes
    expect(ed.scene.hit(300, 300, 2)?.id).toBe(e.id);
    expect(ed.scene.hit(e.x + e.w + 20, e.y + e.h + 20, 2)).toBeNull();
  });
  it("choosing a fill gives the tile back; undo restores the bare logo", () => {
    install();
    const e = ed.placeIcon("logo-square");
    ed.select([e.id]); ed.setStyle({ fill: 1 });
    expect(e.fill).toBe(1);
    ed.undo(); expect(e.fill).toBe(3);
  });
  it("SVG export: a bare logo is the mark alone (no tile rect), a tiled one keeps its tile, and both are well-formed", () => {
    install();
    const bare = ed.placeIcon("logo-word", { x: 200, y: 200 }), tiled = ed.placeIcon("logo-square", { x: 500, y: 200 });
    ed.select([tiled.id]); ed.setStyle({ fill: 0 });
    const svg = buildSvg(ed.scene.toJSON().els, LIGHT, { background: true, padding: 10, icons: () => MARK });
    expect(wellFormed(svg)).toBeNull();
    expect(svg).toContain('viewBox="0 8.4 24 7.1"'); // the wordmark symbol is cropped to its content box
    expect(svg.match(/<rect [^>]*rx=/g)?.length ?? 0).toBe(1); // only the tiled logo draws a tile
    void bare;
  });
  it("saves and loads fill 3, and Excalidraw export draws no fill or outline for it", () => {
    install();
    const e = ed.placeIcon("logo-square");
    const scene = ed.scene.toJSON();
    const p = parseArch(serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene }));
    expect(p.ok && p.value.scene.els.find((x) => x.id === e.id)!.fill).toBe(3);
    const ex = (toExcalidraw(scene).elements as Record<string, unknown>[]).find((x) => x.id === e.id)!;
    expect(ex.backgroundColor).toBe("transparent"); expect(ex.strokeColor).toBe("transparent");
  });
});
