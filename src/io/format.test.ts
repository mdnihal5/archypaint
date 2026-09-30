import { describe, expect, it } from "vitest";
import { FORMAT_VERSION, LIMITS, parseArch, serializeArch, validateFile, type ArchFile } from "./format";
import { el } from "./testkit";

const base = (els = [el({ id: "e1", z: 1 }), el({ id: "e2", z: 2, kind: "arrow", src: "e1", dst: "e1", pts: [0, 0, 50, 50], text: "x" })]): Pick<ArchFile, "meta" | "view" | "settings" | "scene"> => ({
  meta: { name: "demo", created: 1, updated: 2 }, view: { x: 10.5, y: -3, zoom: 1.25 }, settings: { bg: "grid" },
  scene: { els, groups: [{ id: "g1", name: "compute", cat: 3, collapsed: false, locked: false }] },
});

describe("format: round trip and determinism", () => {
  it("serialise -> parse returns the same document", () => {
    const f = base();
    const p = parseArch(serializeArch(f));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.scene.els).toEqual(f.scene.els);
    expect(p.value.scene.groups).toEqual(f.scene.groups);
    expect(p.value.meta).toEqual(f.meta);
    expect(p.value.view).toEqual(f.view);
    expect(p.value.settings).toEqual({ bg: "grid" });
    expect(p.value.version).toBe(FORMAT_VERSION);
  });

  it("is byte-for-byte deterministic and independent of input key/array order", () => {
    const a = serializeArch(base());
    const els = base().scene.els.map((e) => ({ ...Object.fromEntries(Object.entries(e).reverse()) }) as never);
    const b = serializeArch({ ...base(), settings: { bg: "grid" }, scene: { els: [els[1]!, els[0]!], groups: base().scene.groups } });
    expect(b).toBe(a);
    expect(serializeArch(base())).toBe(a);
  });

  it("writes one element per line, sorted by z, omitting arrow-only fields on non-arrows", () => {
    const text = serializeArch(base([el({ id: "b", z: 2 }), el({ id: "a", z: 1 })]));
    const lines = text.split("\n").filter((l) => l.startsWith("{\"id\""));
    expect(lines.map((l) => JSON.parse(l.replace(/,$/, "")).id)).toEqual(["a", "b"]);
    expect(lines[0]).not.toContain("\"src\"");
  });

  it("rounds geometry to 3 dp and never writes -0", () => {
    const text = serializeArch(base([el({ id: "a", x: 0.123456, y: -0.0000001 })]));
    expect(text).toContain("\"x\":0.123");
    expect(text).not.toContain("-0,");
  });
});

describe("format: validation of hostile input", () => {
  const withEl = (patch: Record<string, unknown>) => JSON.stringify({ app: "archypaint", version: 1, scene: { els: [{ id: "e1", kind: "rect", x: 0, y: 0, w: 1, h: 1, ...patch }], groups: [] } });

  it("rejects Infinity/NaN-like numbers (1e999 parses to Infinity)", () => {
    const r = parseArch(withEl({ x: 1e999 }).replace('"x":null', '"x":1e999').replace(/"x":Infinity/, '"x":1e999'));
    expect(r.ok).toBe(false);
    const raw = `{"app":"archypaint","version":1,"scene":{"els":[{"id":"e1","kind":"rect","x":1e999,"y":0,"w":1,"h":1}],"groups":[]}}`;
    const r2 = parseArch(raw);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.path).toBe("scene.els[0].x");
    expect(validateFile({ app: "archypaint", version: 1, scene: { els: [{ id: "e1", kind: "rect", x: NaN, y: 0, w: 1, h: 1 }], groups: [] } }).ok).toBe(false);
  });

  it("rejects wrong types, bad enums, bad ids, negative sizes", () => {
    for (const patch of [{ x: "1" }, { kind: "hologram" }, { fill: 7 }, { w: -1 }, { id: "a b" }, { text: 5 }, { groupIds: "g" }, { pts: [1, 2, 3] }, { cat: 1.5 }, { locked: "yes" }])
      expect(parseArch(withEl(patch)).ok, JSON.stringify(patch)).toBe(false);
  });

  it("returns a typed error (never throws) for non-JSON, non-objects and other apps", () => {
    for (const s of ["", "{", "null", "[]", "42", '{"app":"other","version":1}']) {
      const r = parseArch(s);
      expect(r.ok).toBe(false);
    }
    const r = parseArch("{");
    if (!r.ok) expect(r.error.code).toBe("bad_json");
  });

  it("survives absurdly deep JSON without throwing", () => {
    const r = parseArch("[".repeat(200_000));
    expect(r.ok).toBe(false);
  });

  it("rejects deep nesting inside settings/extra/element extras", () => {
    let deep: unknown = 1;
    for (let i = 0; i < LIMITS.maxDepth + 3; i++) deep = { a: deep };
    const s = JSON.stringify({ app: "archypaint", version: 1, settings: deep, scene: { els: [], groups: [] } });
    const r = parseArch(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too_deep");
    const s2 = JSON.stringify({ app: "archypaint", version: 1, futureThing: deep, scene: { els: [], groups: [] } });
    expect(parseArch(s2).ok).toBe(false);
  });

  it("enforces the element-count limit", () => {
    const els = Array.from({ length: LIMITS.maxElements + 1 }, (_, i) => ({ id: `e${i}`, kind: "rect", x: 0, y: 0, w: 1, h: 1 }));
    const r = validateFile({ app: "archypaint", version: 1, scene: { els, groups: [] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too_many_elements");
  });

  it("enforces string, points and group-id bounds", () => {
    expect(parseArch(withEl({ text: "x".repeat(LIMITS.maxText + 1) })).ok).toBe(false);
    expect(parseArch(withEl({ kind: "arrow", pts: new Array(LIMITS.maxPts + 2).fill(0) })).ok).toBe(false);
    expect(parseArch(withEl({ groupIds: new Array(LIMITS.maxGroupIds + 1).fill("g") })).ok).toBe(false);
  });

  it("enforces the file-size limit before parsing", () => {
    const r = parseArch("x".repeat(LIMITS.maxFileChars + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too_large");
  });
});

describe("format: repair, preservation and migration", () => {
  it("clears dangling arrow bindings and drops duplicate ids, with warnings", () => {
    const raw = { app: "archypaint", version: 1, scene: { els: [
      { id: "e1", kind: "rect", x: 0, y: 0, w: 1, h: 1 }, { id: "e1", kind: "rect", x: 5, y: 5, w: 1, h: 1 },
      { id: "e2", kind: "arrow", x: 0, y: 0, w: 1, h: 1, src: "e1", dst: "ghost", pts: [0, 0, 1, 1] },
    ], groups: [] } };
    const r = validateFile(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scene.els).toHaveLength(2);
    expect(r.value.scene.els[1]!.dst).toBe("");
    expect(r.value.scene.els[1]!.src).toBe("e1");
    expect(r.warnings.join(" ")).toMatch(/duplicate/);
    expect(r.warnings.join(" ")).toMatch(/dangling/);
  });

  it("fills defaults for missing optional fields (older files)", () => {
    const r = validateFile({ app: "archypaint", version: 1, scene: { els: [{ id: "e1", kind: "rect", x: 1, y: 2, w: 3, h: 4 }] } });
    expect(r.ok && r.value.scene.els[0]).toMatchObject({ fill: 1, edge: 1, cat: 0, groupIds: [], route: 1, head: 1 });
  });

  it("clamps an out-of-range zoom with a warning", () => {
    const r = validateFile({ app: "archypaint", version: 1, view: { x: 0, y: 0, zoom: 500 }, scene: { els: [], groups: [] } });
    expect(r.ok && r.value.view.zoom).toBe(LIMITS.maxZoom);
    expect(r.ok && r.warnings.join(" ")).toMatch(/clamped/);
  });

  it("preserves unknown top-level and element fields through a round trip", () => {
    const raw = { app: "archypaint", version: 1, futureFlag: { a: [1, 2] }, scene: { els: [{ id: "e1", kind: "rect", x: 0, y: 0, w: 1, h: 1, sparkle: 3 }], groups: [] } };
    const p = validateFile(raw);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.extra).toEqual({ futureFlag: { a: [1, 2] } });
    expect(p.value.elExtra).toEqual({ e1: { sparkle: 3 } });
    const again = parseArch(serializeArch(p.value));
    expect(again.ok && again.value.extra).toEqual({ futureFlag: { a: [1, 2] } });
    expect(again.ok && again.value.elExtra).toEqual({ e1: { sparkle: 3 } });
  });

  it("migrates a version-0 bare scene, and refuses newer versions with a helpful message", () => {
    const v0 = validateFile({ els: [{ id: "e1", kind: "rect", x: 0, y: 0, w: 1, h: 1 }], groups: [] });
    expect(v0.ok).toBe(true);
    expect(v0.ok && v0.value.version).toBe(FORMAT_VERSION);
    expect(v0.ok && v0.value.meta.name).toBe("untitled");
    const newer = validateFile({ app: "archypaint", version: FORMAT_VERSION + 1, scene: { els: [], groups: [] } });
    expect(newer.ok).toBe(false);
    if (!newer.ok) { expect(newer.error.code).toBe("unsupported_version"); expect(newer.error.message).toMatch(/update/i); }
  });
});
