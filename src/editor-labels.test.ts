// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import type { GroupIndex } from "./groups";
import { fromExcalidraw, toExcalidraw } from "./io/excalidraw";
import { parseArch, serializeArch } from "./io/format";
import { buildSvg } from "./io/svg";
import { wellFormed } from "./io/testkit";
import { LIGHT } from "./theme";
import type { El, ElJSON } from "./scene";

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
const ptr = (type: string, x: number, y: number, extra: MouseEventInit = {}) => stage.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra }));
const drag = (x0: number, y0: number, x1: number, y1: number) => { ptr("pointerdown", x0, y0); ptr("pointermove", (x0 + x1) / 2, (y0 + y1) / 2); ptr("pointermove", x1, y1); ptr("pointerup", x1, y1); };
const click = (x: number, y: number) => { ptr("pointerdown", x, y); ptr("pointerup", x, y); };
const dbl = (x: number, y: number) => { click(x, y); click(x, y); ptr("dblclick", x, y, { detail: 2 }); };
const key = (k: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
const ta = () => document.querySelector("textarea") as HTMLTextAreaElement | null;
/** type into the open inline editor and commit it with Enter (single-line editors) or Ctrl+Enter */
const commit = (value: string, ctrl = false) => {
  const t = ta()!;
  t.value = value; t.dispatchEvent(new Event("input"));
  t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: ctrl, bubbles: true, cancelable: true }));
};
const of = (kind: string): El[] => [...ed.scene.els.values()].filter((e) => e.kind === kind);
const add = (init: Partial<El> & { kind: El["kind"] }): El => { const e = ed.scene.add(init); ed.renderer.invalidate(true, true); return e; };
const toJSON = () => ed.scene.toJSON();
/** the engine's group index (reachable at runtime on the editor object; not part of the public EditorAPI) */
const gix = () => (ed as unknown as { groupIdx: GroupIndex }).groupIdx;

beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never; ed = mk(); });
afterEach(() => { ed.destroy(); stage.remove(); });

/** two boxes in a group, a loose box lying inside the group's boundary, one far away */
function groupScene() {
  const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 }), b = add({ kind: "rect", x: 300, y: 100, w: 100, h: 60 });
  ed.select([a.id, b.id]);
  const gid = ed.group("backend")!;
  const loose = add({ kind: "rect", x: 235, y: 110, w: 30, h: 30 }); // inside the padded group box, between the members
  ed.clearSelection();
  return { a, b, gid, loose };
}

describe("1. pressing inside a group's boundary grabs the whole group", () => {
  it("dragging from empty space between members moves every member; one undo restores", () => {
    const { a, b } = groupScene();
    drag(220, 125, 270, 205); // (220,125) is empty: between member a (ends 200) and the loose box (starts 235)... inside the padded box
    expect([a.x, a.y, b.x, b.y]).toEqual([150, 180, 350, 180]);
    expect(ed.selection().has(a.id) && ed.selection().has(b.id)).toBe(true);
    ed.undo();
    expect([a.x, a.y, b.x, b.y]).toEqual([100, 100, 300, 100]);
  });
  it("pressing on the name tag also grabs the group", () => {
    const { a, gid } = groupScene();
    const tag = gix().tagBox(gid)!;
    drag(tag.x + 10, tag.y + 8, tag.x + 10, tag.y + 58);
    expect(a.y).toBe(150);
  });
  it("an element lying on top wins the hit; a click outside the boundary still starts a marquee", () => {
    const { a, loose } = groupScene();
    drag(250, 125, 250, 225); // on the loose box, which is not a member
    expect(loose.y).toBe(210); expect(a.y).toBe(100);
    ed.clearSelection();
    drag(700, 700, 800, 800);
    expect(ed.selection().size).toBe(0);
  });
  it("an entered group (double-clicked into) gives its empty space back", () => {
    const { a } = groupScene();
    click(150, 130); // selects the group
    dbl(150, 130); // enters it
    ptr("pointerdown", 220, 125); ptr("pointermove", 260, 140); ptr("pointerup", 260, 140); // empty space of an entered group: a marquee, nothing moves
    expect(a.x).toBe(100);
    expect(ed.selection().size).toBe(0);
  });
  it("a nested group selects as part of its top group", () => {
    const a = add({ kind: "rect", x: 100, y: 100, w: 40, h: 40 }), b = add({ kind: "rect", x: 200, y: 100, w: 40, h: 40 }), c = add({ kind: "rect", x: 400, y: 100, w: 40, h: 40 });
    ed.select([a.id, b.id]); ed.group("inner");
    ed.select([a.id, b.id, c.id]); ed.group("outer");
    ed.clearSelection();
    click(170, 120); // empty space inside the inner group's box
    expect(ed.selection().size).toBe(3);
  });
});

describe("2. the group name is edited in place", () => {
  it("double-click on the name tag opens an editor holding the name; Enter commits the rename; undo reverts", () => {
    const { gid } = groupScene();
    const tag = gix().tagBox(gid)!;
    dbl(tag.x + 12, tag.y + 10);
    expect(ta()).toBeTruthy(); expect(ta()!.value).toBe("backend"); expect(ed.editing).toBe(true);
    commit("payments tier");
    expect(ed.scene.groups.get(gid)!.name).toBe("payments tier");
    expect(ed.editing).toBe(false);
    ed.undo();
    expect(ed.scene.groups.get(gid)!.name).toBe("backend");
  });
  it("Enter with a whole group selected renames it; a partial selection does not", () => {
    const { a, b, gid } = groupScene();
    ed.select([a.id, b.id]); key("Enter");
    expect(ta()!.value).toBe("backend"); commit("tier");
    expect(ed.scene.groups.get(gid)!.name).toBe("tier");
    ed.select([a.id, b.id, add({ kind: "rect", x: 900, y: 900, w: 10, h: 10 }).id]);
    expect(ed.editSelection()).toBe(false);
  });
  it("Escape cancels", () => {
    const { gid } = groupScene();
    const tag = gix().tagBox(gid)!;
    dbl(tag.x + 12, tag.y + 10);
    ta()!.value = "nope";
    ta()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ed.scene.groups.get(gid)!.name).toBe("backend");
  });
});

describe("3. icons carry an attached name", () => {
  it("double-click opens the editor under the tile; the box grows by the name strip and the tile keeps its size", () => {
    const ic = ed.placeIcon("cache", { x: 300, y: 300 });
    expect([ic.w, ic.h]).toEqual([48, 48]);
    ed.clearSelection();
    dbl(300, 300);
    expect(ta()).toBeTruthy();
    commit("Redis");
    expect(ic.text).toBe("Redis"); expect([ic.w, ic.h]).toEqual([48, 66]);
    ed.undo();
    expect(ic.text).toBe(""); expect(ic.h).toBe(48);
  });
  it("Enter edits the selected icon; an empty name removes the strip", () => {
    const ic = ed.placeIcon("cache", { x: 300, y: 300 });
    key("Enter"); commit("Redis");
    expect(ic.h).toBe(66);
    key("Enter"); commit("");
    expect([ic.text, ic.h]).toEqual(["", 48]);
  });
  it("the name moves with the icon and a bound connector follows the new box", () => {
    const ic = ed.placeIcon("cache", { x: 300, y: 300 }), box = add({ kind: "rect", x: 600, y: 270, w: 80, h: 60 });
    ed.setTool("arrow"); drag(300, 300, 640, 300);
    const ar = of("arrow")[0]!;
    expect(ar.src).toBe(ic.id); expect(ar.dst).toBe(box.id);
    ed.select([ic.id]); key("Enter"); commit("Redis");
    expect(ic.h).toBe(66);
    expect(ed.scene.els.get(ar.id)!.pts.length).toBeGreaterThanOrEqual(4);
    ed.nudge(0, 50);
    expect(ic.text).toBe("Redis"); expect(ic.y).toBe(276 + 50); // 300 centre - 24, then nudged
  });
  it("text-import icons already use the same geometry (tile 48 + strip 18)", async () => {
    const { iconStrip } = await import("./icons");
    expect(48 + iconStrip(undefined)).toBe(66);
  });
});

describe("4. several labels per connector, each at its own position", () => {
  const twoBoxes = () => {
    const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 }), b = add({ kind: "rect", x: 500, y: 100, w: 100, h: 60 });
    ed.setTool("arrow"); drag(150, 130, 550, 130);
    return { a, b, ar: of("arrow")[0]! };
  };
  it("double-click on the line adds a label there (t measured along the path); a second adds another", () => {
    const { ar } = twoBoxes();
    expect(ar.pts).toEqual([200, 130, 500, 130]);
    dbl(260, 130); expect(ta()).toBeTruthy(); commit("HTTP");
    dbl(440, 130); commit("TLS");
    const ls = ed.scene.els.get(ar.id)!.labels!;
    expect(ls.map((l) => l.text)).toEqual(["HTTP", "TLS"]);
    expect(ls[0]!.t).toBeCloseTo(0.2, 3); expect(ls[1]!.t).toBeCloseTo(0.8, 3);
    ed.undo(); expect(ed.scene.els.get(ar.id)!.labels!.map((l) => l.text)).toEqual(["HTTP"]);
    ed.undo(); expect(ed.scene.els.get(ar.id)!.labels).toBeUndefined();
  });
  it("double-click on an existing label edits it; clearing it removes it", () => {
    const { ar } = twoBoxes();
    dbl(260, 130); commit("HTTP");
    dbl(260, 130); expect(ta()!.value).toBe("HTTP"); commit("HTTPS");
    expect(ed.scene.els.get(ar.id)!.labels).toEqual([{ t: expect.closeTo(0.2, 3), text: "HTTPS" }]);
    dbl(260, 130); commit("");
    expect(ed.scene.els.get(ar.id)!.labels).toBeUndefined();
  });
  it("a label can be dragged along the line; the shape of the line does not change", () => {
    const { ar } = twoBoxes();
    dbl(260, 130); commit("HTTP");
    const before = [...ar.pts];
    drag(260, 130, 380, 134); // the pointer is a little off the line: t follows the nearest point on it
    expect(ed.scene.els.get(ar.id)!.labels![0]!.t).toBeCloseTo(0.6, 2);
    expect(ar.pts).toEqual(before);
    ed.undo();
    expect(ed.scene.els.get(ar.id)!.labels![0]!.t).toBeCloseTo(0.2, 3);
  });
  it("labels keep their t when the line is re-routed", () => {
    const { b, ar } = twoBoxes();
    dbl(260, 130); commit("HTTP"); dbl(440, 130); commit("TLS");
    const t = ed.scene.els.get(ar.id)!.labels!.map((l) => l.t);
    ed.select([b.id]); ed.nudge(0, 200); // the elbow route changes completely
    expect(ed.scene.els.get(ar.id)!.pts.length).toBeGreaterThan(4);
    expect(ed.scene.els.get(ar.id)!.labels!.map((l) => l.t)).toEqual(t);
  });
  it("Enter on a selected connector edits its first label, or adds one in the middle", () => {
    const { ar } = twoBoxes();
    ed.select([ar.id]); key("Enter"); commit("gRPC");
    expect(ed.scene.els.get(ar.id)!.labels).toEqual([{ t: 0.5, text: "gRPC" }]);
    key("Enter"); expect(ta()!.value).toBe("gRPC");
  });
  it("a legacy single centred text reads as one label at t = 0.5 (paste / import migrates it)", () => {
    const j = { ...toJSON(), els: [] as ElJSON[] };
    const legacy: ElJSON = { id: "x1", kind: "arrow", x: 0, y: 0, w: 100, h: 0, z: 1, version: 1, cat: 0, fill: 0, radius: 0, text: "old", edge: 1, groupIds: [], iconId: "", img: "", locked: false, n: 0, o: 0, src: "", dst: "", sp: -1, dp: -1, route: 1, dash: 0, head: 1, pts: [0, 0, 100, 0] };
    j.els.push(legacy);
    const [id] = ed.importElements(j, false);
    const a = ed.scene.els.get(id!)!;
    expect(a.text).toBe(""); expect(a.labels).toEqual([{ t: 0.5, text: "old" }]);
  });
  it("labels survive save/load, SVG, PNG-path data and Excalidraw export", () => {
    const { ar } = twoBoxes();
    dbl(260, 130); commit("HTTP"); dbl(440, 130); commit("TLS");
    ed.select([ar.id]); ed.setStyle({ fs: 18 });
    const scene = toJSON();
    const p = parseArch(serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene }));
    expect(p.ok && p.value.scene.els.find((e) => e.kind === "arrow")!.labels!.map((l) => l.text)).toEqual(["HTTP", "TLS"]);
    expect(p.ok && p.value.scene.els.find((e) => e.kind === "arrow")!.fs).toBe(18);
    const svg = buildSvg(scene.els, LIGHT, { background: true, padding: 10, icons: () => null });
    expect(wellFormed(svg)).toBeNull();
    expect(svg).toContain(">HTTP<"); expect(svg).toContain(">TLS<"); expect(svg).toContain('font-size="18"');
    const ex = toExcalidraw(scene);
    const texts = (ex.elements as Record<string, unknown>[]).filter((e) => e.type === "text");
    expect(texts.map((t) => t.text).sort()).toEqual(["HTTP", "TLS"]);
    const back = fromExcalidraw(JSON.parse(JSON.stringify(ex)));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const ba = back.scene.els.find((e) => e.kind === "arrow")!;
    expect(ba.labels!.map((l) => l.text)).toEqual(["HTTP", "TLS"]);
    expect(back.scene.els.filter((e) => e.kind === "text")).toHaveLength(0); // the free-text copies of extra labels are not imported as separate texts
  });
});

describe("5. dragging a whole line", () => {
  it("a free arrow translates with every point and keeps its shape", () => {
    const a = add({ kind: "arrow", x: 100, y: 300, w: 300, h: 100, pts: [100, 300, 250, 300, 250, 400, 400, 400] });
    drag(250, 350, 330, 320); // the middle vertical segment
    expect(a.pts).toEqual([180, 270, 330, 270, 330, 370, 480, 370]);
    ed.undo();
    expect(a.pts).toEqual([100, 300, 250, 300, 250, 400, 400, 400]);
  });
  it("a bound arrow dragged on its own stays glued: nothing detaches and the ends stay on their ports (a one-segment elbow jogs through end stubs)", () => {
    const l = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 }), r = add({ kind: "rect", x: 500, y: 100, w: 100, h: 60 });
    ed.setTool("arrow"); drag(150, 130, 550, 130);
    const ar = of("arrow")[0]!;
    expect(ar.src && ar.dst).toBeTruthy();
    const before = [...ar.pts];
    drag(350, 130, 350, 230); // a straight (two-point) elbow: its only segment is both end segments, so both ends get a stub
    expect([ar.src, ar.dst]).toEqual([l.id, r.id]);
    expect(ar.pts.slice(0, 2)).toEqual(before.slice(0, 2)); expect(ar.pts.slice(-2)).toEqual(before.slice(-2));
    expect(ar.pts.length).toBe(12);
    ed.undo(); // undoes the jog
    expect(ar.pts).toEqual(before);
    ed.undo();
    expect(of("arrow")).toHaveLength(0);
  });
  it("an arrow caught in a multi-selection stays glued and follows its shapes instead of floating off", () => {
    const a = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60 }), b = add({ kind: "rect", x: 500, y: 100, w: 100, h: 60 });
    ed.setTool("arrow"); drag(150, 130, 550, 130);
    const ar = of("arrow")[0]!;
    ed.select([a.id, ar.id]); // b is not selected: the arrow must not leave it
    drag(150, 130, 150, 230);
    expect(ar.dst).toBe(b.id);
  });
});

describe("6. groups have connection ports", () => {
  it("an arrow drawn to a group's boundary binds to the group and follows when it moves or resizes", () => {
    const { a, b, gid } = groupScene();
    const box = add({ kind: "rect", x: 100, y: 400, w: 100, h: 60 });
    const gb = gix().bounds(gid)!;
    ed.setTool("arrow"); drag(150, 430, gb.x + gb.w / 2, gb.y + gb.h - 2); // the bottom edge of the group
    const ar = of("arrow")[0]!;
    expect([ar.src, ar.dst]).toEqual([box.id, gid]);
    expect(ar.dp).toBe(2);
    const end = () => [ar.pts[ar.pts.length - 2]!, ar.pts[ar.pts.length - 1]!];
    expect(end()).toEqual([gb.x + gb.w / 2, gb.y + gb.h]);
    ed.select([a.id, b.id]); ed.nudge(0, 60);
    const gb2 = gix().bounds(gid)!;
    expect(gb2.y).toBe(gb.y + 60);
    expect(end()).toEqual([gb2.x + gb2.w / 2, gb2.y + gb2.h]);
    ed.undo();
    expect(end()).toEqual([gb.x + gb.w / 2, gb.y + gb.h]);
  });
  it("moving the group by dragging its empty space carries the connector's end live and on drop", () => {
    const { a, gid } = groupScene();
    add({ kind: "rect", x: 100, y: 400, w: 100, h: 60 });
    const gb = gix().bounds(gid)!;
    ed.setTool("arrow"); drag(150, 430, gb.x + gb.w / 2, gb.y + gb.h - 2);
    const ar = of("arrow")[0]!;
    drag(220, 125, 220, 185);
    expect(a.y).toBe(160);
    expect(ar.dst).toBe(gid);
    expect(ar.pts[ar.pts.length - 1]).toBe(gix().bounds(gid)!.y + gix().bounds(gid)!.h);
  });
  it("ungrouping or deleting the group's members detaches the end but keeps its geometry; undo re-binds", () => {
    const { a, b, gid } = groupScene();
    add({ kind: "rect", x: 100, y: 400, w: 100, h: 60 });
    const gb = gix().bounds(gid)!;
    ed.setTool("arrow"); drag(150, 430, gb.x + gb.w / 2, gb.y + gb.h - 2);
    const ar = of("arrow")[0]!, pts = [...ar.pts];
    ed.select([a.id, b.id]); ed.ungroup();
    expect(ar.dst).toBe(""); expect(ar.pts).toEqual(pts);
    ed.undo();
    expect(ar.dst).toBe(gid);
  });
  it("duplicating the group and its connector rebinds the copy to the copied group; a copy without the group detaches", () => {
    const { a, b, gid } = groupScene();
    const box = add({ kind: "rect", x: 100, y: 400, w: 100, h: 60 });
    const gb = gix().bounds(gid)!;
    ed.setTool("arrow"); drag(150, 430, gb.x + gb.w / 2, gb.y + gb.h - 2);
    const ar = of("arrow")[0]!;
    ed.select([a.id, b.id, box.id, ar.id]); ed.duplicateSelection();
    const copies = of("arrow").filter((e) => e.id !== ar.id);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.dst).not.toBe(gid); expect(ed.scene.groups.has(copies[0]!.dst)).toBe(true);
    ed.clearSelection(); ed.select([ar.id]); ed.duplicateSelection();
    const lone = of("arrow").filter((e) => e.id !== ar.id && !copies.includes(e))[0]!;
    expect(lone.dst).toBe("");
  });
  it("a saved file keeps the group binding", () => {
    const { gid } = groupScene();
    add({ kind: "rect", x: 100, y: 400, w: 100, h: 60 });
    const gb = gix().bounds(gid)!;
    ed.setTool("arrow"); drag(150, 430, gb.x + gb.w / 2, gb.y + gb.h - 2);
    const p = parseArch(serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: toJSON() }));
    expect(p.ok && p.value.scene.els.find((e) => e.kind === "arrow")!.dst).toBe(gid);
    expect(p.ok && p.warnings).toEqual([]);
  });
});

describe("7. text size", () => {
  it("setStyle({fs}) sets the size on shapes, icons, text and connectors, persists it, and undoes", () => {
    const r = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60, text: "api" });
    ed.select([r.id]); ed.setStyle({ fs: 26 });
    expect(r.fs).toBe(26);
    ed.setStyle({ fs: 0 });
    expect(r.fs).toBeUndefined();
    ed.undo(); expect(r.fs).toBe(26);
    ed.undo(); expect(r.fs).toBeUndefined();
  });
  it("a free text re-measures when its size changes; an icon's name strip grows with the font", () => {
    const t = add({ kind: "text", x: 100, y: 100, w: 56, h: 28, text: "hello" });
    ed.select([t.id]); ed.setStyle({ fs: 26 });
    expect(t.h).toBeGreaterThan(28);
    const ic = ed.placeIcon("cache", { x: 400, y: 300 });
    ed.select([ic.id]); key("Enter"); commit("db");
    expect(ic.h).toBe(66);
    ed.setStyle({ fs: 26 });
    expect(ic.h).toBe(48 + Math.round(26 * 1.5));
    ed.setStyle({ fs: 0 });
    expect(ic.h).toBe(66);
  });
  it("the size survives a save, an SVG export and a clipboard round trip", () => {
    const r = add({ kind: "rect", x: 100, y: 100, w: 100, h: 60, text: "api", fs: 18 });
    const p = parseArch(serializeArch({ meta: { name: "t", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {}, scene: toJSON() }));
    expect(p.ok && p.value.scene.els[0]!.fs).toBe(18);
    expect(buildSvg(toJSON().els, LIGHT, { background: false, padding: 0, icons: () => null })).toContain('font-size="18"');
    ed.select([r.id]);
    const text = (ed as unknown as { copyText(): string }).copyText();
    expect((ed as unknown as { pasteText(s: string): boolean }).pasteText(text)).toBe(true);
    expect([...ed.scene.els.values()].filter((e) => e.fs === 18)).toHaveLength(2);
  });
  it("invalid sizes in pasted data are dropped", () => {
    const j = toJSON();
    const bad: ElJSON = { id: "q", kind: "rect", x: 0, y: 0, w: 10, h: 10, z: 1, version: 1, cat: 0, fill: 1, radius: 8, text: "", edge: 1, groupIds: [], iconId: "", img: "", locked: false, n: 0, o: 0, src: "", dst: "", sp: -1, dp: -1, route: 1, dash: 0, head: 1, pts: [], fs: 5000 };
    j.els.push(bad);
    const [id] = ed.importElements(j, false);
    expect(ed.scene.els.get(id!)!.fs).toBeUndefined();
  });
});

describe("8. typing into a shape", () => {
  it("double-click on any shape opens the editor on its centred label", () => {
    for (const kind of ["rect", "ellipse", "diamond", "cylinder", "hexagon", "cloud", "note"] as const) {
      const s = add({ kind, x: 300, y: 300, w: 120, h: 80 });
      dbl(360, 340);
      expect(ta(), kind).toBeTruthy();
      commit("hello", true);
      expect(s.text, kind).toBe("hello");
      ed.scene.remove(s); ed.clearSelection();
    }
  });
  it("Enter opens the editor for the single selected shape, pre-filled; Escape cancels", () => {
    const s = add({ kind: "rect", x: 300, y: 300, w: 120, h: 80, text: "api" });
    ed.select([s.id]);
    key("Enter");
    expect(ed.editing).toBe(true); expect(ta()!.value).toBe("api");
    ta()!.value = "changed";
    ta()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(s.text).toBe("api"); expect(ed.editing).toBe(false);
  });
  it("typing a character with one shape selected starts editing and lands in the text", () => {
    ed.setTool("rect"); drag(300, 300, 420, 380);
    const s = [...ed.scene.els.values()][0]!;
    expect(ed.selection().has(s.id)).toBe(true);
    const ev = new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // the keystroke is consumed: no tool switch (d = diamond) and no stray character
    expect(ed.tool).toBe("select");
    expect(ta()!.value).toBe("d");
    commit("database", true);
    expect(s.text).toBe("database");
  });
  it("a tool letter with nothing, or several things, selected is still a tool", () => {
    key("d"); expect(ed.tool).toBe("diamond");
    ed.setTool("select");
    const a = add({ kind: "rect", x: 0, y: 0, w: 50, h: 50 }), b = add({ kind: "rect", x: 100, y: 0, w: 50, h: 50 });
    ed.select([a.id, b.id]); key("o");
    expect(ed.tool).toBe("ellipse"); expect(ed.editing).toBe(false);
  });
  it("kinds with structured text do not hijack typing (badge, calc, lane), and locked shapes cannot be edited", () => {
    const badge = add({ kind: "badge", x: 0, y: 0, w: 30, h: 30, n: 3 });
    ed.select([badge.id]); expect(ed.editSelection("x")).toBe(false);
    const locked = add({ kind: "rect", x: 200, y: 200, w: 50, h: 50, locked: true });
    ed.select([locked.id]); expect(ed.editSelection()).toBe(false);
  });
  it("the editor reports open/close so the properties panel can step aside", () => {
    let n = 0;
    const off = ed.on("edit", () => n++);
    const s = add({ kind: "rect", x: 300, y: 300, w: 120, h: 80 });
    ed.select([s.id]); key("Enter");
    expect(n).toBe(1);
    commit("x", true);
    expect(n).toBe(2);
    off();
  });
});
