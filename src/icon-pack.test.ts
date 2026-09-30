import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compiledCount, ensureIcons, ensurePack, iconInner, iconMeta, iconOps, installIndex, installPack, listIcons, MAX_COMPILED,
  onIconsReady, packLoaded, packsVersion, parseIconMarkup, resetPacks, ROOT_STROKE, setPackLoader, type IndexJson, type PackJson,
} from "./icon-pack";

const P = '<path d="M0 0L1 1"/>';
const idx = (rows: [string, string][]): IndexJson => ({ v: 2, icons: rows.map(([id, pack]) => [id, id.toUpperCase(), [], "data", pack, ""]) });
const pk = (pack: string, ids: string[]): PackJson => ({ v: 2, pack, icons: ids.map((id) => [id, P, P]) });

/** fake chunk loader: records every request; per-name failures can be toggled */
function fakeLoader(files: Record<string, unknown>) {
  const calls: string[] = [];
  const failing = new Set<string>();
  setPackLoader(async (name) => { calls.push(name); if (failing.has(name)) throw new Error("offline"); return JSON.stringify(files[name]); });
  return { calls, failing };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetPacks());
afterEach(() => setPackLoader(null));

describe("parseIconMarkup", () => {
  it("converts every supported element to a path op", () => {
    const ops = parseIconMarkup(
      '<rect x="1" y="2" width="10" height="6" rx="2" fill="currentColor" fill-opacity="0.3"/>' +
      '<circle cx="5" cy="5" r="2" stroke="none" fill="currentColor"/><ellipse cx="4" cy="4" rx="3" ry="2"/>' +
      '<path d="M1 1L2 2" stroke-dasharray="2 2.2"/><line x1="0" y1="0" x2="3" y2="3"/>' +
      '<polyline points="0,0 3,3 6,0"/><polygon points="0 0 4 0 2 3"/>', 2);
    expect(ops).toHaveLength(7);
    expect(ops[0]).toMatchObject({ fill: true, fo: 0.3, stroke: true, sw: 2 });
    expect(ops[1]).toMatchObject({ fill: true, stroke: false });
    expect(ops[3]!.dash).toEqual([2, 2.2]);
    expect(ops[6]!.d.endsWith("Z")).toBe(true);
    expect(ops[0]!.d).toMatch(/^M3 2H9A2 2 0 0 1 11 4/);
  });
  it("rejects unsupported elements", () => {
    expect(() => parseIconMarkup('<text x="1">a</text>', 2)).toThrow(/unsupported element/);
    expect(() => parseIconMarkup('<g><path d="M0 0"/></g>', 2)).toThrow(/unsupported element/);
  });
});

describe("per-pack lazy loading", () => {
  it("loads the index first and only the packs that were asked for", async () => {
    const f = fakeLoader({ index: idx([["a", "core"], ["b", "core"], ["c", "aws"], ["d", "gcp"]]), core: pk("core", ["a", "b"]), aws: pk("aws", ["c"]), gcp: pk("gcp", ["d"]) });
    expect(packLoaded()).toBe(false);
    await ensureIcons(["c"]);
    expect(f.calls.sort()).toEqual(["aws", "index"]);
    expect(packLoaded()).toBe(true);
    expect(packLoaded("aws")).toBe(true);
    expect(packLoaded("core")).toBe(false);
    expect(listIcons().map((m) => m.id)).toEqual(["a", "b", "c", "d"]); // metadata for every icon, svg only for loaded packs
    expect(iconInner("c", "glyph")).toBe(P);
  });
  it("ensureIcons() with no ids loads every pack, once", async () => {
    const f = fakeLoader({ index: idx([["a", "core"], ["c", "aws"]]), core: pk("core", ["a"]), aws: pk("aws", ["c"]) });
    await ensureIcons(); await ensureIcons();
    expect(f.calls.filter((c) => c === "core")).toHaveLength(1);
    expect(f.calls.filter((c) => c === "aws")).toHaveLength(1);
    expect(f.calls.filter((c) => c === "index")).toHaveLength(1);
  });
  it("drawing an icon whose pack is missing requests that pack exactly once, however many frames ask", async () => {
    const f = fakeLoader({ index: idx([["a", "core"], ["c", "aws"]]), core: pk("core", ["a"]), aws: pk("aws", ["c"]) });
    await ensureIcons(["a"]);
    for (let i = 0; i < 200; i++) expect(iconOps("c", "glyph")).toBeNull(); // 200 "frames" before the chunk arrives
    await tick(); await tick();
    expect(f.calls.filter((c) => c === "aws")).toHaveLength(1);
    expect(iconOps("c", "glyph")).not.toBeNull();
  });
  it("an icon drawn before the index exists kicks the index load (once) and then its pack", async () => {
    const f = fakeLoader({ index: idx([["c", "aws"]]), aws: pk("aws", ["c"]) });
    for (let i = 0; i < 50; i++) iconOps("c", "glyph");
    await tick(); await tick(); await tick();
    expect(f.calls.filter((c) => c === "index")).toHaveLength(1);
    expect(iconOps("c", "glyph")).not.toBeNull();
  });
  it("a failing chunk is not retried every frame, but an explicit ensure retries", async () => {
    const f = fakeLoader({ index: idx([["c", "aws"]]), aws: pk("aws", ["c"]) });
    await ensureIcons(["c"]); // index ok, pack ok…
    resetPacks(); f.calls.length = 0; f.failing.add("aws");
    installIndex(idx([["c", "aws"]]));
    for (let i = 0; i < 100; i++) { iconOps("c", "glyph"); await tick(); }
    expect(f.calls.filter((c) => c === "aws").length).toBe(1);
    f.failing.delete("aws");
    await ensurePack("aws");
    expect(iconOps("c", "glyph")).not.toBeNull();
  });
  it("onIconsReady fires when data lands and unsubscribes cleanly", async () => {
    fakeLoader({ index: idx([["a", "core"]]), core: pk("core", ["a"]) });
    let n = 0; const off = onIconsReady(() => n++);
    await ensureIcons();
    expect(n).toBe(2); // index + one pack
    off();
    installPack(pk("core", ["a"]));
    expect(n).toBe(2);
  });
  it("unknown ids never crash", async () => {
    fakeLoader({ index: idx([["a", "core"]]), core: pk("core", ["a"]) });
    await ensureIcons();
    expect(iconOps("nope", "glyph")).toBeNull();
    expect(iconMeta("nope")).toBeNull();
    expect(iconInner("nope", "detail")).toBeNull();
  });
});

describe("the shipped packs", () => {
  it("every icon in every pack loads and converts: known tags only, non-empty ops, finite numbers", async () => {
    setPackLoader(null);
    await ensureIcons();
    const icons = listIcons();
    expect(icons.length).toBeGreaterThanOrEqual(60);
    const ids = new Set<string>();
    for (const m of icons) {
      expect(ids.has(m.id), `duplicate ${m.id}`).toBe(false); ids.add(m.id);
      expect(packLoaded(m.pack), `${m.id}: pack ${m.pack}`).toBe(true);
      for (const tier of ["detail", "glyph"] as const) {
        const markup = iconInner(m.id, tier);
        expect(markup, `${m.id} ${tier}`).toBeTruthy();
        const ops = parseIconMarkup(markup!, ROOT_STROKE[tier]);
        expect(ops.length, `${m.id} ${tier}`).toBeGreaterThan(0);
        for (const o of ops) { expect(o.d.length).toBeGreaterThan(2); expect(o.d).not.toMatch(/NaN|undefined/); expect(o.fill || o.stroke).toBe(true); }
      }
    }
  });
});

describe("compiled-op cache", () => {
  it("is bounded", () => {
    const rows: [string, string][] = [];
    for (let i = 0; i < MAX_COMPILED + 100; i++) rows.push([`i${i}`, "core"]);
    installIndex(idx(rows));
    installPack(pk("core", rows.map((r) => r[0])));
    for (const t of ["detail", "glyph"] as const) for (const [id] of rows) iconOps(id, t);
    expect(compiledCount()).toBeLessThanOrEqual(MAX_COMPILED);
  });
  it("evicts in compile order at the cap instead of dropping the whole cache (no re-parse cliff)", () => {
    const rows: [string, string][] = [];
    for (let i = 0; i < MAX_COMPILED + 10; i++) rows.push([`i${i}`, "core"]);
    installIndex(idx(rows));
    installPack(pk("core", rows.map((r) => r[0])));
    const first = iconOps("i0", "glyph");
    for (const [id] of rows) iconOps(id, "glyph");
    const last = `i${MAX_COMPILED + 9}`, nearlyLast = `i${MAX_COMPILED - 1}`;
    const keepLast = iconOps(last, "glyph"), keepNear = iconOps(nearlyLast, "glyph");
    expect(compiledCount()).toBe(MAX_COMPILED); // stays full: a clear-all would have left ~10
    expect(iconOps(last, "glyph")).toBe(keepLast); // newest entries are still cached (no re-parse)
    expect(iconOps(nearlyLast, "glyph")).toBe(keepNear);
    expect(iconOps("i0", "glyph")).not.toBe(first); // the oldest was evicted and recompiles on demand
  });
  it("a pack arriving repaints but does not change the search version; the index does", () => {
    installIndex(idx([["a", "core"]]));
    const v = packsVersion();
    installPack({ v: 2, pack: "core", icons: [["a", P, '<path d="M0 0L2 2"/>']] });
    expect(packsVersion()).toBe(v);
    installIndex(idx([["a", "core"], ["b", "core"]]));
    expect(packsVersion()).toBe(v + 1);
  });
  it("returns the same ops object for repeated lookups (no re-parse)", () => {
    installIndex(idx([["a", "core"]])); installPack({ v: 2, pack: "core", icons: [["a", P, '<path d="M0 0L2 2"/>']] });
    expect(iconOps("a", "glyph")).toBe(iconOps("a", "glyph"));
  });
});
