// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorAPI } from "./editor-api";
import { installIndex, installPack, resetPacks, setPackLoader } from "./icon-pack";
import { mountPalette } from "./palette";
import { SHAPES } from "./shapes";
import { memStore, resetUserPacks, setPackStore } from "./user-packs";

const P = '<path d="M0 0L1 1"/>';
const ROWS: [string, string, string, string, string][] = [
  ["cache", "Cache", "cache", "core", ""], ["sql-database", "SQL database", "data", "core", ""],
  ["redis", "Redis", "cache", "oss", "oss"], ["haproxy", "HAProxy", "network", "oss", "oss"], ["aws-elasticache", "ElastiCache", "cache", "aws", "aws"],
  ["gcp-memorystore", "Memorystore", "cache", "gcp", "gcp"],
];
/** brand logos: [id, name, aliases, category, pack]. The drawn `redis` icon is replaced by logo-redis (hidden from the palette). */
const LOGOS: [string, string, string[], string, string][] = [
  ["logo-redis", "Redis", ["cache", "in memory"], "cache", "logos-cache"], ["logo-memcached", "Memcached", ["cache"], "cache", "logos-cache"],
  ["logo-postgresql", "PostgreSQL", ["postgres", "pg", "sql"], "data", "logos-relational"], ["logo-mysql", "MySQL", ["sql"], "data", "logos-relational"],
];
const BRAND = '<path d="M1 1h4v4z" fill="#4169e1" data-d="#8fa8f5" data-l="#2a4fc4" stroke="none"/>';
const files = (): Record<string, unknown> => ({
  index: { v: 2, icons: ROWS.map(([id, name, cat, pack, vendor]) => [id, name, [], cat, pack, vendor]) },
  "logos-index": { v: 2, icons: LOGOS.map(([id, name, al, cat, pack]) => [id, name, al, cat, pack, "logo"]), hides: ["redis"], groups: [["logos-relational", "Relational databases"], ["logos-cache", "Caches & in-memory"]] },
  ...Object.fromEntries(["core", "oss", "aws", "gcp"].map((p) => [p, { v: 2, pack: p, icons: ROWS.filter((r) => r[3] === p).map((r) => [r[0], P, P]) }])),
  ...Object.fromEntries(["logos-relational", "logos-cache"].map((p) => [p, { v: 2, pack: p, icons: LOGOS.filter((r) => r[4] === p).map((r) => [r[0], "", BRAND]) }])),
});

function fakeEditor() {
  const placed: { id: string; at: unknown; cat: number }[] = [];
  const tools: string[] = [];
  const defaults = { cat: 0, fill: 1, edge: 1, radius: 8, dash: 0, route: 1 };
  const ed = {
    vp: { toWorldX: (x: number) => x, toWorldY: (y: number) => y }, defaults,
    on: (_ev: string, _cb: () => void) => () => {},
    setDefaults: (p: Partial<typeof defaults>) => Object.assign(defaults, p),
    placeIcon: (id: string, at: unknown) => { placed.push({ id, at, cat: defaults.cat }); return { id: "e1" }; },
    select: vi.fn(), setTool: (t: string) => tools.push(t),
  };
  return { ed: ed as unknown as EditorAPI, placed, tools };
}

const tick = (n = 4) => new Promise<void>((r) => { let i = 0; const f = () => (++i >= n ? r() : setTimeout(f, 0)); f(); });
/** "/" opens the drawer; its code is a lazy chunk, so wait until the DOM is there */
const openIt = async () => { key("/"); for (let k = 0; k < 400 && !document.querySelector(".ap-pal:not([hidden])"); k++) await new Promise((r) => setTimeout(r, 5)); await tick(); };
const key = (k: string, o: KeyboardEventInit = {}, t: EventTarget = window) => t.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o }));
const type = (input: HTMLInputElement, v: string) => { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); };

let host: HTMLElement;
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}; // jsdom has no layout
  resetPacks(); resetUserPacks(); setPackStore(memStore());
  const f = files();
  setPackLoader(async (n) => JSON.stringify(f[n]));
  host = document.createElement("div"); document.body.append(host);
  localStorage.clear();
});
afterEach(() => { host.remove(); setPackLoader(null); setPackStore(null); document.documentElement.removeAttribute("data-theme"); });

const names = (): string[] => [...document.querySelectorAll<HTMLElement>(".ap-pal-item .ap-pal-name")].map((e) => e.textContent!);
const heads = (): string[] => [...document.querySelectorAll<HTMLElement>(".ap-pal-head b")].map((e) => e.textContent!);
const chips = (sel: string): string[] => [...document.querySelectorAll<HTMLElement>(`${sel} button`)].map((e) => e.textContent!);
const showAll = () => document.querySelectorAll<HTMLButtonElement>(".ap-pal-all").forEach((b) => { if (b.textContent?.startsWith("Show all")) b.click(); });
const chip = (k: string) => [...document.querySelectorAll<HTMLElement>(".ap-pal-cats button")].find((b) => b.dataset.src === k)!;

describe("icon drawer", () => {
  it("a pack landing while the drawer is open keeps the highlighted tile (no jump back to the top)", async () => {
    const f = files();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setPackLoader(async (n) => { if (n === "aws") await gate; return JSON.stringify(f[n]); }); // aws lands late
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt(); await tick(8);
    document.querySelector<HTMLButtonElement>(".ap-pal-gbtn")!.click(); // the shapes are always there, even before the late pack lands
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    key("ArrowDown", {}, input); key("ArrowDown", {}, input);
    const selected = () => document.querySelector<HTMLElement>('.ap-pal-item[aria-selected="true"] .ap-pal-name')?.textContent;
    const before = selected();
    expect(before).toBeTruthy();
    release(); await tick(8); await new Promise((r) => requestAnimationFrame(() => r(null))); await tick();
    expect(selected()).toBe(before);
    type(input, "cache"); // a new query still starts from the first result
    expect(document.querySelectorAll('.ap-pal-item[aria-selected="true"]').length).toBe(1);
    expect(selected()).toBe(names()[0]);
    p.dispose();
  });
  it("opens on /, browses the logos by category, and a search looks in every pack", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    expect(p.isOpen()).toBe(true);
    expect(heads()).toEqual(["Relational databases", "Caches & in-memory"]); // browsing = the Logos side
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "cache");
    expect(names()).toEqual(expect.arrayContaining(["Cache", "ElastiCache", "Redis"]));
    expect(names()).not.toContain("SQL database");
    expect(heads()).toEqual(expect.arrayContaining(["Caches & in-memory", "Generic", "Drawn: AWS"])); // sections from both sides: the best match leads
    p.dispose();
  });
  it("the Generic side lists every drawn pack and the shapes from SHAPES", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    document.querySelector<HTMLButtonElement>(".ap-pal-gbtn")!.click();
    expect(heads()).toEqual(expect.arrayContaining(["Generic", "Drawn: AWS", "Drawn: Google Cloud", "Shapes"]));
    showAll();
    for (const s of SHAPES) expect(names()).toContain(s.name);
    expect(names()).not.toContain("PostgreSQL");
    p.dispose();
  });

  it("one filter row: All and a short chip per logo category, a Logos | Generic switch; Tab cycles the categories, Alt+→ the generic sets", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    expect(chips(".ap-pal-cats")).toEqual(["All", "SQL", "Cache"]);
    const gb = document.querySelector<HTMLElement>(".ap-pal-gbtn")!, lb = document.querySelector<HTMLElement>(".ap-pal-lbtn")!;
    expect(gb.textContent).toMatch(/^Generic/); expect(lb.textContent).toMatch(/^Logos/); expect(lb.getAttribute("aria-checked")).toBe("true");
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    key("Tab", {}, input); // -> SQL
    expect(names()).toEqual(expect.arrayContaining(["PostgreSQL", "MySQL"])); expect(names()).not.toContain("Redis");
    key("Tab", {}, input); // -> Cache
    expect(names()).toEqual(expect.arrayContaining(["Redis", "Memcached"])); expect(names()).not.toContain("PostgreSQL");
    key("Tab", {}, input); // -> the Generic side
    expect(gb.getAttribute("aria-checked")).toBe("true");
    expect(names()).toEqual(expect.arrayContaining(["Cache", "ElastiCache"])); expect(names()).not.toContain("Redis"); // drawn Cache, not the logo
    expect(chips(".ap-pal-cats")[0]).toBe("All generic");
    key("Tab", {}, input); // wraps to All (logos)
    expect(lb.getAttribute("aria-checked")).toBe("true"); expect(names()).toEqual(expect.arrayContaining(["Redis"]));
    key("Tab", { shiftKey: true }, input); // back to Generic
    expect(gb.getAttribute("aria-checked")).toBe("true");
    for (let i = 0; i < 4; i++) key("ArrowRight", { altKey: true }, input); // generic -> Generic -> open source -> AWS -> Google Cloud ... lands inside the drawn packs
    expect(document.querySelector<HTMLElement>('.ap-pal-cats [aria-pressed="true"]')!.dataset.src).not.toBe("generic");
    expect(names().length).toBeGreaterThan(0);
    p.dispose();
  });

  it("a generic pack chip narrows to one drawn pack; pressing the active chip, or the Logos side, widens again", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    const gb = document.querySelector<HTMLButtonElement>(".ap-pal-gbtn")!;
    gb.click();
    chip("aws").click();
    expect(names()).toEqual(["ElastiCache"]);
    chip("aws").click(); // pressed again: back to all generic
    expect(names()).toEqual(expect.arrayContaining(["Cache", "ElastiCache"]));
    document.querySelector<HTMLButtonElement>(".ap-pal-lbtn")!.click();
    expect(names()).toEqual(expect.arrayContaining(["Redis", "PostgreSQL"]));
    chip("logos-relational").click(); expect(names()).not.toContain("Redis");
    chip("logos-relational").click(); expect(names()).toContain("Redis"); // pressed again: back to All
    p.dispose();
  });

  it("the trademark note is one line and shows only while logos or drawn vendor icons are listed", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    const note = document.querySelector<HTMLElement>(".ap-pal-note")!;
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "sql database");
    expect(note.hidden).toBe(true);
    type(input, "elasticache");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/Trademarks belong to their owners/);
    expect(note.textContent).not.toContain("\n");
    p.dispose();
  });

  it("Enter places the highlighted icon at the view centre in its own category colour, restores the default, and closes", async () => {
    const { ed, placed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "elasticache"); key("Enter", {}, input);
    expect(placed).toEqual([{ id: "aws-elasticache", at: undefined, cat: 1 }]); // cache category index
    expect(ed.defaults.cat).toBe(0);
    expect(p.isOpen()).toBe(false);
    p.dispose();
  });

  it("choosing a shape activates its tool", async () => {
    const { ed, tools } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "rectangle"); key("Enter", {}, input);
    expect(tools).toEqual(["rect"]);
    p.dispose();
  });

  it("loads a user pack from a file, lists it, and removes it", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    const pack = { v: 1, name: "Acme", icons: [{ id: "box", name: "Acme box", aliases: ["acme"], category: "compute", detail: '<rect x="4" y="4" width="20" height="20"/>', glyph: '<rect x="4" y="4" width="10" height="10"/>' }] };
    const fileEl = document.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(fileEl, "files", { value: [new File([JSON.stringify(pack)], "acme.archipack.json")], configurable: true });
    fileEl.dispatchEvent(new Event("change"));
    await tick(8);
    expect(document.querySelector(".ap-pal-msg")!.textContent).toMatch(/Loaded 1 icons from “Acme”/);
    expect(chips(".ap-pal-cats")).toContain("Acme");
    expect(names()).toEqual(["Acme box"]); // switched to the new pack's source
    document.querySelector<HTMLButtonElement>(".ap-pal-packs button")!.click();
    await tick(8);
    expect(document.querySelector<HTMLElement>(".ap-pal-packs")!.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>(".ap-pal-gbtn")!.click();
    expect(chips(".ap-pal-cats")).not.toContain("Acme");
    p.dispose();
  });

  it("a hostile pack is refused with a message and nothing is installed", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    const bad = { v: 1, name: "Evil", icons: [{ id: "x", name: "x", category: "compute", detail: '<path d="M0 0" onload="alert(1)"/>', glyph: '<path d="M0 0"/>' }] };
    const fileEl = document.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(fileEl, "files", { value: [new File([JSON.stringify(bad)], "evil.json")], configurable: true });
    fileEl.dispatchEvent(new Event("change"));
    await tick(8);
    const msg = document.querySelector<HTMLElement>(".ap-pal-msg")!;
    expect(msg.textContent).toMatch(/Not loaded/); expect(msg.dataset.err).toBe("true");
    document.querySelector<HTMLButtonElement>(".ap-pal-gbtn")!.click();
    expect(chips(".ap-pal-cats")).not.toContain("Evil");
    p.dispose();
  });

  it("previews never inject markup into the DOM as elements other than svg shapes", async () => {
    installIndex({ v: 2, icons: [["x", "X", [], "data", "core", ""]] }); installPack({ v: 2, pack: "core", icons: [["x", P, P]] });
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    document.querySelector<HTMLButtonElement>(".ap-pal-gbtn")!.click();
    const tags = new Set([...document.querySelectorAll(".ap-pal-badge *")].map((e) => e.tagName.toLowerCase()));
    expect(tags.size).toBeGreaterThan(0);
    for (const t of tags) expect(["svg", "path", "rect", "ellipse", "circle"]).toContain(t);
    p.dispose();
  });

  it("a section shows a few tiles until \"Show all N\"", async () => {
    const many = Array.from({ length: 12 }, (_, i) => [`logo-x${i}`, `X${i}`, [], "data", "logos-relational", "logo"]);
    installIndex({ v: 2, icons: many as never, groups: [["logos-relational", "Relational databases"]] });
    installPack({ v: 2, pack: "logos-relational", icons: many.map((r) => [r[0], "", BRAND]) as never });
    setPackLoader(null);
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    expect(names().length).toBe(8);
    const more = document.querySelector<HTMLButtonElement>(".ap-pal-all")!;
    expect(more.textContent).toBe("Show all 12");
    more.click();
    expect(names().length).toBe(12);
    expect(document.querySelector<HTMLButtonElement>(".ap-pal-all")!.textContent).toBe("Show fewer");
    p.dispose();
  });
});

describe("arming: click a tile, click the canvas to place, again to stamp, Esc to stop", () => {
  const stageDom = () => {
    const stage = document.createElement("div"); stage.id = "stage";
    const cv = document.createElement("canvas"); stage.append(cv); document.body.append(stage);
    const seen = vi.fn(); stage.addEventListener("pointerdown", seen);
    const click = (x: number, y: number) => cv.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
    return { stage, cv, seen, click };
  };
  const tile = (name: string) => [...document.querySelectorAll<HTMLElement>(".ap-pal-item")].find((t) => t.textContent === name)!;

  it("picking a tile arms it (nothing is placed yet); each canvas click places one at that spot and the canvas never sees the click", async () => {
    const { ed, placed } = fakeEditor(); const p = mountPalette(ed, host); const st = stageDom();
    await openIt();
    tile("Redis").click();
    expect(p.isArmed()).toBe(true); expect(placed.length).toBe(0); expect(p.isOpen()).toBe(true);
    expect(document.querySelector(".ap-stamp")).not.toBeNull();
    expect(tile("Redis").classList.contains("armed")).toBe(true);
    expect(document.querySelector(".ap-pal-armed")!.textContent).toMatch(/Redis armed/);
    st.click(300, 200); st.click(420, 260);
    expect(placed).toEqual([{ id: "logo-redis", at: { x: 300, y: 200 }, cat: 1 }, { id: "logo-redis", at: { x: 420, y: 260 }, cat: 1 }]);
    expect(st.seen).not.toHaveBeenCalled();
    expect(ed.defaults.cat).toBe(0);
    expect(p.isArmed()).toBe(true);
    p.dispose(); st.stage.remove();
  });
  it("a click that is not on the canvas does not place; Esc disarms first, the next Esc closes the drawer", async () => {
    const { ed, placed } = fakeEditor(); const p = mountPalette(ed, host); const st = stageDom();
    await openIt();
    tile("Memcached").click();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    expect(placed.length).toBe(0);
    key("Escape", {}, document.querySelector<HTMLInputElement>(".ap-pal-input")!);
    expect(p.isArmed()).toBe(false); expect(p.isOpen()).toBe(true); expect(document.querySelector(".ap-stamp")).toBeNull();
    st.click(10, 10); expect(placed.length).toBe(0); expect(st.seen).toHaveBeenCalled(); // disarmed: the canvas gets its clicks back
    key("Escape", {}, document.querySelector<HTMLInputElement>(".ap-pal-input")!);
    expect(p.isOpen()).toBe(false);
    p.dispose(); st.stage.remove();
  });
  it("closing the drawer, or disposing it, removes the ghost and every armed listener", async () => {
    const { ed } = fakeEditor();
    const add = vi.spyOn(window, "addEventListener"), rm = vi.spyOn(window, "removeEventListener");
    const nodes0 = document.querySelectorAll("*").length;
    for (let i = 0; i < 10; i++) {
      const h = document.createElement("div"); document.body.append(h);
      const p = mountPalette(ed, h);
      key("/"); for (let k = 0; k < 400 && !document.querySelector(".ap-pal:not([hidden])"); k++) await new Promise((r) => setTimeout(r, 5));
      tile("Redis").click(); expect(p.isArmed()).toBe(true);
      if (i % 2) p.close(); expect(p.isArmed()).toBe(i % 2 === 0);
      p.dispose(); h.remove();
    }
    expect(add.mock.calls.length).toBe(rm.mock.calls.length);
    expect(document.querySelectorAll(".ap-stamp, .ap-pal").length).toBe(0);
    expect(document.querySelectorAll("*").length).toBe(nodes0);
    add.mockRestore(); rm.mockRestore();
  }, 30_000);
});

describe("teardown", () => {
  it("60 mount / open / dispose cycles leave no listeners or DOM behind", async () => {
    const { ed } = fakeEditor();
    const add = vi.spyOn(window, "addEventListener"), rm = vi.spyOn(window, "removeEventListener");
    const nodes0 = document.querySelectorAll("*").length;
    for (let i = 0; i < 60; i++) {
      const h = document.createElement("div"); document.body.append(h);
      const p = mountPalette(ed, h);
      key("/"); for (let k = 0; k < 400 && !h.querySelector(".ap-pal:not([hidden])"); k++) await new Promise((r) => setTimeout(r, 2));
      type(h.querySelector<HTMLInputElement>(".ap-pal-input")!, "cache");
      p.dispose(); h.remove();
    }
    expect(add.mock.calls.length).toBe(rm.mock.calls.length); // every window listener was removed
    expect(document.querySelectorAll(".ap-pal").length).toBe(0);
    expect(document.querySelectorAll("*").length).toBe(nodes0);
    add.mockRestore(); rm.mockRestore();
  }, 60_000);
});

describe("brand logos", () => {
  it("are listed straight away (no opt-in, no network), grouped under their category", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    expect(names()).toEqual(expect.arrayContaining(["PostgreSQL", "MySQL", "Redis", "Memcached"]));
    expect(heads().slice(0, 2)).toEqual(["Relational databases", "Caches & in-memory"]);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals(); p.dispose();
  });
  it("the drawn icon a logo replaces is not listed twice, but the generic cache icon still is", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "redis"); expect(names()).toEqual(["Redis"]);
    type(input, "cache"); expect(names()).toEqual(expect.arrayContaining(["Redis", "Memcached", "Cache", "ElastiCache"]));
    p.dispose();
  });
  it("search finds a logo by its aliases (postgres, pg)", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "postgres"); expect(names()[0]).toBe("PostgreSQL");
    type(input, "pg"); expect(names()[0]).toBe("PostgreSQL");
    p.dispose();
  });
  it("each logo category is one short chip (the long name is its tooltip and section heading); choosing one filters", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    expect(chips(".ap-pal-cats")).toEqual(["All", "SQL", "Cache"]);
    expect(chip("logos-relational").title).toBe("Relational databases");
    chip("logos-cache").click(); await tick(2);
    expect(names()).toEqual(expect.arrayContaining(["Redis", "Memcached"])); expect(names()).not.toContain("PostgreSQL"); expect(names()).not.toContain("Cache");
    expect(heads()).toEqual(["Caches & in-memory"]); // results stay grouped under the category heading
    chip("all").click(); await tick(2);
    expect(names()).toContain("PostgreSQL");
    p.dispose();
  });
  it("previews are real brand colours in the theme's variant; the trademark note shows", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt(); await tick(8);
    const badge = () => document.querySelector<HTMLElement>('.ap-pal-badge[data-logo="true"]')!;
    expect(badge().innerHTML).toContain('fill="#2a4fc4"'); expect(badge().innerHTML).not.toContain("data-");
    expect(document.querySelector<HTMLElement>(".ap-pal-note")!.textContent).toMatch(/Trademarks belong to their owners/);
    p.dispose();
    document.documentElement.dataset.theme = "dark";
    const q = mountPalette(ed, host);
    await openIt(); await tick(8);
    expect(badge().innerHTML).toContain('fill="#8fa8f5"');
    q.dispose();
  });
  it("Enter places icon logo-<slug> in its category's colour and restores the default", async () => {
    const { ed, placed } = fakeEditor(); const p = mountPalette(ed, host);
    await openIt();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "redis"); key("Enter", {}, input);
    expect(placed).toEqual([{ id: "logo-redis", at: undefined, cat: 1 }]); // cache category
    expect(ed.defaults.cat).toBe(0); expect(p.isOpen()).toBe(false);
    p.dispose();
  });
});
