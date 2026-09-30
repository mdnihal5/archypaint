// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorAPI } from "./editor-api";
import { installIndex, installPack, resetPacks, setPackLoader } from "./icon-pack";
import { mountPalette } from "./palette";
import { SHAPES } from "./shapes";
import { memStore, resetUserPacks, setPackStore } from "./user-packs";
import { memLogoStore, OPT_IN_KEY, RESTRICTED_KEY, setLogoEnv } from "./logos";

const P = '<path d="M0 0L1 1"/>';
const ROWS: [string, string, string, string, string][] = [
  ["cache", "Cache", "cache", "core", ""], ["sql-database", "SQL database", "data", "core", ""],
  ["redis", "Redis", "cache", "oss", "oss"], ["aws-elasticache", "ElastiCache", "cache", "aws", "aws"],
  ["gcp-memorystore", "Memorystore", "cache", "gcp", "gcp"],
];
const files = (): Record<string, unknown> => ({
  index: { v: 2, icons: ROWS.map(([id, name, cat, pack, vendor]) => [id, name, [], cat, pack, vendor]) },
  ...Object.fromEntries(["core", "oss", "aws", "gcp"].map((p) => [p, { v: 2, pack: p, icons: ROWS.filter((r) => r[3] === p).map((r) => [r[0], P, P]) }])),
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
const heads = (): string[] => [...document.querySelectorAll<HTMLElement>(".ap-pal-head:not([hidden])")].map((e) => e.textContent!);
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
    expect(heads()).toEqual(expect.arrayContaining(["Core", "Open source", "AWS", "Google Cloud", "Shapes"]));
    for (const s of SHAPES) expect(names()).toContain(s.name);
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "cache");
    expect(names()).toEqual(expect.arrayContaining(["Cache", "ElastiCache"]));
    expect(names()).not.toContain("SQL database");
    p.dispose();
  });

  it("source chips list only packs that exist; Alt+→ cycles the source filter", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    expect(chips(".ap-pal-src")).toEqual(["all sources", "Core", "Open source", "AWS", "Google Cloud", "official logos"]);
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    key("ArrowRight", { altKey: true }, input); // -> Core
    key("ArrowRight", { altKey: true }, input); key("ArrowRight", { altKey: true }, input); // -> AWS
    expect(names()).toEqual(["ElastiCache"]);
    p.dispose();
  });

  it("the vendor disclaimer shows only while vendor icons are listed", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    const note = document.querySelector<HTMLElement>(".ap-pal-note")!;
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "sql database");
    expect(note.hidden).toBe(true);
    type(input, "elasticache");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/not affiliated with or endorsed by the vendor/);
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
    expect(chips(".ap-pal-src")).toContain("Acme");
    expect(names()).toEqual(["Acme box"]); // switched to the new pack's source
    document.querySelector<HTMLButtonElement>(".ap-pal-packs button")!.click();
    await tick(8);
    expect(document.querySelector<HTMLElement>(".ap-pal-packs")!.hidden).toBe(true);
    expect(chips(".ap-pal-src")).not.toContain("Acme");
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
    expect(chips(".ap-pal-src")).not.toContain("Evil");
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


const waitFor = async (cond: () => boolean, ms = 1500): Promise<void> => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 5)); };

describe("official logos (opt-in, on demand)", () => {
  const KAFKA = '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Apache Kafka</title><path d="M1 1L5 5"/></svg>';
  let fetchMock: ReturnType<typeof vi.fn>;
  let ok = true;
  beforeEach(() => {
    ok = true;
    fetchMock = vi.fn(async (_u: string) => { if (!ok) throw new TypeError("offline"); return new Response(KAFKA, { status: 200 }); });
    setLogoEnv({ fetch: fetchMock as never, store: () => memLogoStore() });
  });
  afterEach(() => { setLogoEnv(null); });

  const logosChip = () => [...document.querySelectorAll<HTMLElement>(".ap-pal-src button")].find((b) => b.dataset.src === "logos")!;
  const visible = (sel: string) => { const e = document.querySelector<HTMLElement>(sel); return !!e && !e.hidden; };
  const restrictedKey = () => document.querySelector<HTMLElement>(".ap-pal-restricted");

  it("shows a consent panel and lists or fetches nothing until the user opts in", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    logosChip().click(); await waitFor(() => visible(".ap-pal-logos"));
    expect(visible(".ap-pal-logos")).toBe(true);
    expect(document.querySelector(".ap-pal-logos p")!.textContent).toContain("cdn.jsdelivr.net");
    expect(names()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(OPT_IN_KEY)).toBeNull();
    p.dispose();
  });

  it("opting in lists the catalog (still no network), hides restricted brands, and remembers the choice", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick();
    logosChip().click(); await waitFor(() => visible(".ap-pal-logos"));
    document.querySelector<HTMLElement>(".ap-pal-logos button")!.click(); await waitFor(() => names().includes("PostgreSQL"));
    expect(localStorage.getItem(OPT_IN_KEY)).toBe("1");
    expect(visible(".ap-pal-logos")).toBe(false);
    expect(names()).toContain("PostgreSQL");
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    type(input, "mongo"); expect(names()).toEqual([]); // restricted: hidden
    type(input, "docker"); expect(names()).toEqual([]);
    type(input, "kafka"); expect(names()).toEqual(["Kafka"]);
    expect(fetchMock).not.toHaveBeenCalled(); // listing and previews never download
    expect(document.querySelector<HTMLElement>(".ap-pal-note")!.textContent).toContain("Trademarks belong to their owners");
    p.dispose();
  });

  it("restricted brands appear only after a second, explicit choice", async () => {
    const { ed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick(); logosChip().click(); await waitFor(() => visible(".ap-pal-logos"));
    document.querySelector<HTMLElement>(".ap-pal-logos button")!.click(); await waitFor(() => visible(".ap-pal-restricted"));
    restrictedKey()!.querySelector("button")!.click(); await tick();
    expect(localStorage.getItem(RESTRICTED_KEY)).toBe("1");
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    for (const [q, n] of [["mongo", "MongoDB"], ["docker", "Docker"], ["linux", "Linux"]] as const) { type(input, q); expect(names()).toContain(n); }
    expect(fetchMock).not.toHaveBeenCalled();
    p.dispose();
  });

  it("placing a logo downloads it once from the pinned URL, then places icon logo-<slug> in its category colour", async () => {
    localStorage.setItem(OPT_IN_KEY, "1");
    const { ed, placed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick(10);
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    logosChip().click(); await waitFor(() => names().includes("PostgreSQL"));
    type(input, "kafka"); await tick();
    key("Enter", {}, input); await waitFor(() => placed.length > 0 || !!document.querySelector(".ap-pal-msg[data-err=\"true\"]:not([hidden])"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/simple-icons@\d+\.\d+\.\d+\/icons\/apachekafka\.svg$/);
    expect(placed).toEqual([{ id: "logo-apachekafka", at: undefined, cat: 4 }]); // queue category
    expect(p.isOpen()).toBe(false);
    p.dispose();
  });

  it("20 mount / use logos / dispose cycles leave no listeners, styles, DOM or cache connections behind", async () => {
    localStorage.setItem(OPT_IN_KEY, "1");
    const add = vi.spyOn(window, "addEventListener"), rm = vi.spyOn(window, "removeEventListener");
    const nodes0 = document.querySelectorAll("*").length, styles0 = document.querySelectorAll("style").length;
    for (let i = 0; i < 20; i++) {
      const { ed } = fakeEditor();
      const h = document.createElement("div"); document.body.append(h);
      const p = mountPalette(ed, h);
      key("/"); await tick(2);
      logosChip().click(); await waitFor(() => names().includes("PostgreSQL"));
      type(document.querySelector<HTMLInputElement>(".ap-pal-input")!, "kafka");
      p.dispose(); h.remove();
    }
    expect(add.mock.calls.length).toBe(rm.mock.calls.length);
    expect(document.querySelectorAll("style").length).toBe(styles0);
    expect(document.querySelectorAll("*").length).toBe(nodes0);
    add.mockRestore(); rm.mockRestore();
  }, 30_000);

  it("a failed download places nothing, says so, and Enter retries", async () => {
    localStorage.setItem(OPT_IN_KEY, "1");
    const { ed, placed } = fakeEditor(); const p = mountPalette(ed, host);
    key("/"); await tick(10);
    const input = document.querySelector<HTMLInputElement>(".ap-pal-input")!;
    logosChip().click(); await waitFor(() => names().includes("PostgreSQL"));
    type(input, "kafka"); await tick();
    ok = false;
    key("Enter", {}, input); await waitFor(() => !!document.querySelector(".ap-pal-msg[data-err=\"true\"]:not([hidden])"));
    expect(placed).toEqual([]);
    expect(document.querySelector(".ap-pal-msg")!.textContent).toContain("Couldn't load");
    expect(p.isOpen()).toBe(true);
    ok = true;
    key("Enter", {}, input); await waitFor(() => placed.length > 0);
    expect(placed.map((x) => x.id)).toEqual(["logo-apachekafka"]);
    p.dispose();
  });
});
