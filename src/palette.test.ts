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
    setDefaults: (p: Partial<typeof defaults>) => Object.assign(defaults, p),
    placeIcon: (id: string, at: unknown) => { placed.push({ id, at, cat: defaults.cat }); return { id: "e1" }; },
    select: vi.fn(), setTool: (t: string) => tools.push(t),
  };
  return { ed: ed as unknown as EditorAPI, placed, tools };
}

const tick = (n = 4) => new Promise<void>((r) => { let i = 0; const f = () => (++i >= n ? r() : setTimeout(f, 0)); f(); });
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

const names = (): string[] => [...document.querySelectorAll<HTMLElement>(".ap-pal-row:not([hidden]) .ap-pal-name")].map((e) => e.textContent!);
const heads = (): string[] => [...document.querySelectorAll<HTMLElement>(".ap-pal-row:not([hidden]) .ap-pal-head:not([hidden])")].map((e) => e.textContent!);
const chips = (sel: string): string[] => [...document.querySelectorAll<HTMLElement>(`${sel} button`)].map((e) => e.textContent!);

describe("palette", () => {
  it("a pack landing while the palette is open keeps the selected row (no jump back to the top)", async () => {
    const f = files();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setPackLoader(async (n) => { if (n === "aws") await gate; return JSON.stringify(f[n]); }); // aws lands late
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
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
  it("opens on /, searches every pack, groups by section, and lists shapes from SHAPES", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    expect(p.isOpen()).toBe(true);
    expect(heads()).toEqual(expect.arrayContaining(["Relational databases", "Caches & in-memory", "Generic", "Drawn: AWS", "Drawn: Google Cloud", "Shapes"]));
    expect(heads().indexOf("Relational databases")).toBeLessThan(heads().indexOf("Generic")); // logos first, drawn icons below
    for (const s of SHAPES) expect(names()).toContain(s.name);
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "cache");
    expect(names()).toEqual(expect.arrayContaining(["Cache", "ElastiCache", "Redis"]));
    expect(names()).not.toContain("SQL database");
    p.dispose();
  });

  it("one filter row: All, a short chip per logo category that exists, and a Generic icons toggle; Tab cycles the categories, Alt+→ the generic sets", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    expect(document.querySelectorAll(".ap-pal-chips").length).toBe(0); // the old three stacked rows are gone
    expect(chips(".ap-pal-cats")).toEqual(["All", "SQL", "Cache"]);
    expect(document.querySelector<HTMLElement>(".ap-pal-gbtn")!.textContent).toBe("Generic icons");
    expect(document.querySelector<HTMLElement>(".ap-pal-gsel")!.hidden).toBe(true);
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    key("Tab", {}, input); // -> SQL
    expect(names()).toEqual(expect.arrayContaining(["PostgreSQL", "MySQL"])); expect(names()).not.toContain("Redis");
    key("Tab", {}, input); // -> Cache
    expect(names()).toEqual(expect.arrayContaining(["Redis", "Memcached"])); expect(names()).not.toContain("PostgreSQL");
    key("Tab", {}, input); // -> Generic icons
    expect(names()).toEqual(expect.arrayContaining(["Cache", "ElastiCache"])); expect(names()).not.toContain("Redis"); // drawn Cache, not the logo
    expect(document.querySelector<HTMLElement>(".ap-pal-gsel")!.hidden).toBe(false);
    key("Tab", {}, input); // wraps to All
    expect(names()).toEqual(expect.arrayContaining(["Redis", "Cache"]));
    key("Tab", { shiftKey: true }, input); // back to Generic icons
    expect(document.querySelector<HTMLElement>(".ap-pal-gbtn")!.getAttribute("aria-pressed")).toBe("true");
    for (let i = 0; i < 4; i++) key("ArrowRight", { altKey: true }, input); // generic -> Generic -> open source -> AWS -> Google Cloud ... lands inside the drawn packs
    expect(document.querySelector<HTMLSelectElement>(".ap-pal-gsel")!.value).not.toBe("generic");
    expect(names().length).toBeGreaterThan(0);
    p.dispose();
  });

  it("the generic selector narrows to one drawn pack; pressing the active chip or the toggle clears the filter", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const gb = document.querySelector<HTMLButtonElement>(".ap-pal-gbtn")!, sel = document.querySelector<HTMLSelectElement>(".ap-pal-gsel")!;
    gb.click(); expect(sel.hidden).toBe(false);
    sel.value = "aws"; sel.dispatchEvent(new Event("change"));
    expect(names()).toEqual(["ElastiCache"]);
    gb.click(); expect(sel.hidden).toBe(true); expect(names()).toEqual(expect.arrayContaining(["Redis", "ElastiCache"]));
    const sql = [...document.querySelectorAll<HTMLButtonElement>(".ap-pal-cats button")].find((b) => b.textContent === "SQL")!;
    sql.click(); expect(names()).not.toContain("Redis");
    sql.click(); expect(names()).toContain("Redis"); // pressed again: back to All
    p.dispose();
  });

  it("the trademark note is one line and shows only while logos or drawn vendor icons are listed", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
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

  it("Enter places the icon with its own category colour and restores the default", async () => {
    const { ed, placed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "elasticache"); key("Enter", {}, input);
    expect(placed).toEqual([{ id: "aws-elasticache", at: undefined, cat: 1 }]); // cache category index
    expect(ed.defaults.cat).toBe(0);
    expect(p.isOpen()).toBe(false);
    p.dispose();
  });

  it("choosing a shape activates its tool", async () => {
    const { ed, tools } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "rectangle"); key("Enter", {}, input);
    expect(tools).toEqual(["rect"]);
    p.dispose();
  });

  it("loads a user pack from a file, lists it, and removes it", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const pack = { v: 1, name: "Acme", icons: [{ id: "box", name: "Acme box", aliases: ["acme"], category: "compute", detail: '<rect x="4" y="4" width="20" height="20"/>', glyph: '<rect x="4" y="4" width="10" height="10"/>' }] };
    const fileEl = document.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(fileEl, "files", { value: [new File([JSON.stringify(pack)], "acme.archipack.json")], configurable: true });
    fileEl.dispatchEvent(new Event("change"));
    await tick(8);
    expect(document.querySelector(".ap-pal-msg")!.textContent).toMatch(/Loaded 1 icons from “Acme”/);
    expect([...document.querySelectorAll<HTMLOptionElement>(".ap-pal-gsel option")].map((o) => o.textContent)).toContain("Acme");
    expect(names()).toEqual(["Acme box"]); // switched to the new pack's source
    document.querySelector<HTMLButtonElement>(".ap-pal-packs button")!.click();
    await tick(8);
    expect(document.querySelector<HTMLElement>(".ap-pal-packs")!.hidden).toBe(true);
    expect([...document.querySelectorAll<HTMLOptionElement>(".ap-pal-gsel option")].map((o) => o.textContent)).not.toContain("Acme");
    p.dispose();
  });

  it("a hostile pack is refused with a message and nothing is installed", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const bad = { v: 1, name: "Evil", icons: [{ id: "x", name: "x", category: "compute", detail: '<path d="M0 0" onload="alert(1)"/>', glyph: '<path d="M0 0"/>' }] };
    const fileEl = document.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(fileEl, "files", { value: [new File([JSON.stringify(bad)], "evil.json")], configurable: true });
    fileEl.dispatchEvent(new Event("change"));
    await tick(8);
    const msg = document.querySelector<HTMLElement>(".ap-pal-msg")!;
    expect(msg.textContent).toMatch(/Not loaded/); expect(msg.dataset.err).toBe("true");
    expect([...document.querySelectorAll<HTMLOptionElement>(".ap-pal-gsel option")].map((o) => o.textContent)).not.toContain("Evil");
    p.dispose();
  });

  it("previews never inject markup into the DOM as elements other than svg shapes", async () => {
    installIndex({ v: 2, icons: [["x", "X", [], "data", "core", ""]] }); installPack({ v: 2, pack: "core", icons: [["x", P, P]] });
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const tags = new Set([...document.querySelectorAll(".ap-pal-badge *")].map((e) => e.tagName.toLowerCase()));
    for (const t of tags) expect(["svg", "path", "rect", "ellipse", "circle"]).toContain(t);
    p.dispose();
  });
});

describe("teardown", () => {
  it("60 mount / open / dispose cycles leave no listeners or DOM behind", async () => {
    const { ed } = fakeEditor();
    const add = vi.spyOn(window, "addEventListener"), rm = vi.spyOn(window, "removeEventListener");
    const nodes0 = document.querySelectorAll("*").length;
    for (let i = 0; i < 60; i++) {
      const h = document.createElement("div"); document.body.append(h);
      const p = mountPalette(ed, h);
      key("/"); await tick(1);
      type(document.querySelector<HTMLInputElement>(".ap-pal-input")!, "cache");
      p.dispose(); h.remove();
    }
    expect(add.mock.calls.length).toBe(rm.mock.calls.length); // every window listener was removed
    expect(document.querySelectorAll(".ap-pal").length).toBe(0);
    expect(document.querySelectorAll("style#ap-palette-css").length).toBe(0);
    expect(document.querySelectorAll("*").length).toBe(nodes0);
    add.mockRestore(); rm.mockRestore();
  }, 30_000);
});


describe("brand logos", () => {
  const srcBtn = (k: string) => [...document.querySelectorAll<HTMLElement>(".ap-pal-cats button")].find((b) => b.dataset.src === k)!;

  it("are listed straight away (no opt-in, no network), grouped under their category, above the drawn icons", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    expect(names()).toEqual(expect.arrayContaining(["PostgreSQL", "MySQL", "Redis", "Memcached"]));
    expect(heads().slice(0, 2)).toEqual(["Relational databases", "Caches & in-memory"]);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals(); p.dispose();
  });
  it("the drawn icon a logo replaces is not listed twice, but the generic cache icon still is", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "redis"); expect(names()).toEqual(["Redis"]);
    type(input, "cache"); expect(names()).toEqual(expect.arrayContaining(["Redis", "Memcached", "Cache", "ElastiCache"]));
    p.dispose();
  });
  it("search finds a logo by its aliases (postgres, pg)", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "postgres"); expect(names()[0]).toBe("PostgreSQL");
    type(input, "pg"); expect(names()[0]).toBe("PostgreSQL");
    p.dispose();
  });
  it("each logo category is one short chip (the long name is its tooltip and list heading); choosing one filters", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    expect(chips(".ap-pal-cats")).toEqual(["All", "SQL", "Cache"]);
    expect(srcBtn("logos-relational").title).toBe("Relational databases");
    srcBtn("logos-cache").click(); await tick(2);
    expect(names()).toEqual(expect.arrayContaining(["Redis", "Memcached"])); expect(names()).not.toContain("PostgreSQL"); expect(names()).not.toContain("Cache");
    expect(heads()).toEqual(["Caches & in-memory"]); // results stay grouped under the category heading
    srcBtn("all").click(); await tick(2);
    expect(names()).toContain("PostgreSQL");
    p.dispose();
  });
  it("previews are real brand colours in the theme's variant, on a neutral badge; the trademark note shows", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick(8);
    const badge = () => document.querySelector<HTMLElement>('.ap-pal-badge[data-logo="true"]')!;
    expect(badge().innerHTML).toContain('fill="#2a4fc4"'); expect(badge().innerHTML).not.toContain("data-");
    expect(document.querySelector<HTMLElement>(".ap-pal-note")!.textContent).toMatch(/Trademarks belong to their owners/);
    p.dispose();
    document.documentElement.dataset.theme = "dark";
    const q = mountPalette(ed, host);
    key("/"); await tick(8);
    expect(badge().innerHTML).toContain('fill="#8fa8f5"');
    q.dispose();
  });
  it("Enter places icon logo-<slug> in its category's colour and restores the default", async () => {
    const { ed, placed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "redis"); key("Enter", {}, input);
    expect(placed).toEqual([{ id: "logo-redis", at: undefined, cat: 1 }]); // cache category
    expect(ed.defaults.cat).toBe(0); expect(p.isOpen()).toBe(false);
    p.dispose();
  });
  it("20 mount / use / dispose cycles leave no listeners, styles or DOM behind", async () => {
    const add = vi.spyOn(window, "addEventListener"), rm = vi.spyOn(window, "removeEventListener");
    const nodes0 = document.querySelectorAll("*").length, styles0 = document.querySelectorAll("style").length;
    for (let i = 0; i < 20; i++) {
      const { ed } = fakeEditor();
      const h = document.createElement("div"); document.body.append(h);
      const p = mountPalette(ed, h);
      key("/"); await tick(2);
      for (let k = 0; k < 200 && !srcBtn("logos-cache"); k++) await new Promise((r) => setTimeout(r, 5)); // the index lands asynchronously, and the repaint is coalesced to a frame
      srcBtn("logos-cache").click();
      type(document.querySelector<HTMLInputElement>(".ap-pal-input")!, "redis");
      p.dispose(); h.remove();
    }
    expect(add.mock.calls.length).toBe(rm.mock.calls.length);
    expect(document.querySelectorAll("style").length).toBe(styles0);
    expect(document.querySelectorAll("*").length).toBe(nodes0);
    add.mockRestore(); rm.mockRestore();
  }, 30_000);
});
