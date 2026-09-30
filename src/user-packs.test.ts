import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureIcons, iconInner, iconOps, listIcons, packLoaded, resetPacks, setPackLoader } from "./icon-pack";
import {
  addUserPackFromText, listUserPacks, loadStoredUserPacks, markupProblem, MAX_ICONS, memStore, parsePackText, removeUserPack,
  resetUserPacks, setPackStore, validateUserPack,
} from "./user-packs";

const SHAPE = '<rect x="4" y="4" width="16" height="12" rx="2" fill="currentColor" fill-opacity=".2"/><path d="M4 20h16" stroke-dasharray="2 2"/>';
const icon = (over: Record<string, unknown> = {}) => ({ id: "vm", name: "Virtual machine", aliases: ["compute"], category: "compute", detail: SHAPE, glyph: SHAPE, ...over });
const pack = (icons: unknown[] = [icon()], over: Record<string, unknown> = {}) => ({ v: 1, name: "My Cloud", icons, ...over });

let store: ReturnType<typeof memStore>;
beforeEach(() => { resetPacks(); resetUserPacks(); store = memStore(); setPackStore(store); });
afterEach(() => { setPackStore(null); setPackLoader(null); });

describe("validateUserPack", () => {
  it("accepts a well-formed pack", () => {
    const r = validateUserPack(pack());
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.name).toBe("My Cloud"); expect(r.value.icons[0]!.id).toBe("vm"); }
  });
  const bad: [string, unknown][] = [
    ["a non-object", 42], ["an array", []], ["null", null], ["wrong version", pack([icon()], { v: 2 })], ["missing name", pack([icon()], { name: undefined })],
    ["blank name", pack([icon()], { name: "  !! " })], ["no icons array", { v: 1, name: "x" }], ["empty icons", pack([])],
    [`more than ${MAX_ICONS} icons`, pack(Array.from({ length: MAX_ICONS + 1 }, (_, i) => icon({ id: `i${i}` })))],
    ["uppercase id", pack([icon({ id: "VM" })])], ["id with slash", pack([icon({ id: "a/b" })])], ["duplicate ids", pack([icon(), icon()])],
    ["unknown category", pack([icon({ category: "hax" })])], ["missing name on icon", pack([icon({ name: "" })])],
    ["too many aliases", pack([icon({ aliases: Array(13).fill("x") })])], ["alias not a string", pack([icon({ aliases: [1] })])],
    ["onload attribute", pack([icon({ detail: '<path d="M0 0L1 1" onload="alert(1)"/>' })])],
    ["script element", pack([icon({ glyph: '<script>alert(1)</script>' })])],
    ["group element", pack([icon({ detail: '<g><path d="M0 0"/></g>' })])],
    ["href attribute", pack([icon({ detail: '<path d="M0 0" href="javascript:alert(1)"/>' })])],
    ["url() paint", pack([icon({ detail: '<path d="M0 0L1 1" fill="url(#x)"/>' })])],
    ["hard-coded colour", pack([icon({ detail: '<path d="M0 0L1 1" stroke="#ff0000"/>' })])],
    ["huge path", pack([icon({ detail: `<path d="M0 0${"L1 1".repeat(2000)}"/>` })])],
    ["huge markup", pack([icon({ detail: SHAPE.repeat(200) })])],
    ["NaN coordinate", pack([icon({ detail: '<rect x="NaN" y="1" width="2" height="2"/>' })])],
    ["path with letters", pack([icon({ detail: '<path d="M0 0 alert(1)"/>' })])],
    ["huge number", pack([icon({ detail: '<rect x="99999999" y="1" width="2" height="2"/>' })])],
    ["unclosed element", pack([icon({ detail: '<path d="M0 0L1 1">' })])],
    ["text between elements", pack([icon({ detail: '<path d="M0 0L1 1"/>hello<path d="M1 1L2 2"/>' })])],
    ["empty markup", pack([icon({ glyph: "" })])], ["markup not a string", pack([icon({ glyph: 5 })])],
  ];
  for (const [what, input] of bad) it(`rejects ${what} with a message, without throwing`, () => {
    const r = validateUserPack(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(3);
  });
  it("strips markup-significant characters from names", () => {
    const r = validateUserPack(pack([icon({ name: '<b>Evil</b> "vm"' })]));
    expect(r.ok && r.value.icons[0]!.name).toBe("bEvil/b vm");
  });
  it("markupProblem allows exactly the allow-listed grammar", () => {
    expect(markupProblem(SHAPE)).toBeNull();
    expect(markupProblem('<circle cx="12" cy="12" r="8" stroke-linecap="round"/>')).toBeNull();
    expect(markupProblem('<path d="M1 1" style="x"/>')).toMatch(/not allowed/);
  });
});

describe("parsePackText", () => {
  it("rejects invalid JSON and oversize text", () => {
    expect(parsePackText("{nope").ok).toBe(false);
    expect(parsePackText("x".repeat(5 * 1024 * 1024 + 1))).toEqual({ ok: false, error: "file too large (max 5 MB)" });
  });
  it("survives deeply nested hostile JSON", () => {
    expect(parsePackText('{"v":1,"name":"x","icons":' + "[".repeat(5000) + "]".repeat(5000) + "}").ok).toBe(false);
  });
});

describe("installing user packs", () => {
  it("namespaces ids, lists them under the pack, and makes them drawable", async () => {
    const r = await addUserPackFromText(JSON.stringify(pack()));
    expect(r.ok && r.value.key).toBe("user-my-cloud");
    expect(listUserPacks()).toEqual([{ key: "user-my-cloud", name: "My Cloud", count: 1 }]);
    const m = listIcons().find((i) => i.id === "user-my-cloud-vm")!;
    expect(m).toMatchObject({ pack: "user-my-cloud", vendor: "user", category: "compute", name: "Virtual machine" });
    expect(packLoaded("user-my-cloud")).toBe(true);
    expect(iconInner("user-my-cloud-vm", "glyph")).toBe(SHAPE);
    expect(iconOps("user-my-cloud-vm", "detail")!.length).toBe(2);
  });
  it("re-adding a pack of the same name replaces it", async () => {
    await addUserPackFromText(JSON.stringify(pack([icon(), icon({ id: "db" })])));
    await addUserPackFromText(JSON.stringify(pack([icon({ id: "only" })])));
    expect(listIcons().map((i) => i.id)).toEqual(["user-my-cloud-only"]);
    expect(listUserPacks()[0]!.count).toBe(1);
  });
  it("persists, and a new session reloads it lazily through ensureIcons", async () => {
    await addUserPackFromText(JSON.stringify(pack()));
    expect(store.data.size).toBe(1);
    resetPacks(); resetUserPacks(); // "new session": same store
    setPackLoader(async (n) => JSON.stringify(n === "index" ? { v: 2, icons: [] } : { v: 2, pack: n, icons: [] }));
    expect(listIcons()).toHaveLength(0);
    await ensureIcons();
    expect(listIcons().map((i) => i.id)).toEqual(["user-my-cloud-vm"]);
    expect(iconInner("user-my-cloud-vm", "glyph")).toBe(SHAPE);
  });
  it("a stored pack that no longer validates is dropped, not thrown", async () => {
    await store.put({ key: "user-bad", pack: { v: 1, name: "bad", icons: [icon({ detail: '<script/>' })] } as never });
    await loadStoredUserPacks();
    expect(listIcons()).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.data.has("user-bad")).toBe(false);
  });
  it("removing a pack clears icons, ops cache and storage", async () => {
    await addUserPackFromText(JSON.stringify(pack()));
    expect(iconOps("user-my-cloud-vm", "glyph")).not.toBeNull();
    await removeUserPack("user-my-cloud");
    expect(listIcons()).toHaveLength(0);
    expect(listUserPacks()).toHaveLength(0);
    expect(iconOps("user-my-cloud-vm", "glyph")).toBeNull();
    expect(store.data.size).toBe(0);
  });
  it("still works for the session when storage fails", async () => {
    setPackStore({ put: async () => { throw new Error("quota"); }, delete: async () => {}, all: async () => [], close() {} });
    const r = await addUserPackFromText(JSON.stringify(pack()));
    expect(r.ok && r.value.persisted).toBe(false);
    expect(listIcons()).toHaveLength(1);
  });
});
