// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "./editor";
import { installIndex, resetPacks } from "./icon-pack";
import { layoutGraph } from "./layout";
import { buildElements, chromeReserve, importGraph, makeResolver, sizeOf } from "./textimport";
import { parseDiagram } from "./textdsl";
import { LIGHT } from "./theme";

const fakeCtx = new Proxy({}, {
  get: (t: Record<string, unknown>, k: string) => (k === "measureText" ? () => ({ width: 40 }) : k in t ? t[k] : () => undefined),
  set: (t: Record<string, unknown>, k: string, v) => { t[k] = v; return true; },
});

const ICONS = [
  { id: "postgresql", name: "PostgreSQL", aliases: ["postgres", "pg", "sql", "rdbms"], category: "data" },
  { id: "sql-database", name: "SQL database", aliases: ["sql", "rdbms", "mysql"], category: "data" },
  { id: "redis", name: "Redis", aliases: ["cache", "in-memory"], category: "cache" },
  { id: "cache", name: "Cache", aliases: ["memcached"], category: "cache" },
  { id: "load-balancer-l7", name: "Load balancer (L7)", aliases: ["lb", "balancer", "nginx"], category: "network" },
  { id: "load-balancer-l4", name: "Load balancer (L4)", aliases: ["lb", "balancer"], category: "network" },
  { id: "kafka", name: "Kafka", aliases: ["stream"], category: "queue" },
  { id: "cron-job", name: "Cron job", aliases: ["cron", "scheduler"], category: "compute" },
];

describe("makeResolver: never a silent wrong icon", () => {
  const r = makeResolver(ICONS);
  it("exact id / name / unique alias match, ignoring case, spaces and punctuation", () => {
    expect(r.exact("postgresql")).toBe("postgresql");
    expect(r.exact("PostgreSQL")).toBe("postgresql");
    expect(r.exact("Cron Job")).toBe("cron-job");
    expect(r.exact("cron_job")).toBe("cron-job");
    expect(r.exact("postgres")).toBe("postgresql"); // unique alias
    expect(r.exact("scheduler")).toBe("cron-job");
    expect(r.exact("Load balancer (L7)")).toBe("load-balancer-l7");
  });
  it("an alias shared by several icons is ambiguous and matches nothing; so is anything partial", () => {
    expect(r.exact("lb")).toBeNull(); // l4 and l7
    expect(r.exact("sql")).toBeNull(); // postgresql and sql-database
    expect(r.exact("balancer")).toBeNull();
    expect(r.exact("postgre")).toBeNull();
    expect(r.exact("red")).toBeNull();
    expect(r.exact("")).toBeNull();
    expect(r.exact("widgets")).toBeNull();
  });
  it("an exact id beats an alias that other icons also use", () => {
    expect(r.exact("cache")).toBe("cache");
  });
  it("loose: a unique prefix, else a unique substring (>= 3 chars); ambiguity still yields nothing", () => {
    expect(r.loose("kaf")).toBe("kafka");
    expect(r.loose("ronjob")).toBe("cron-job");
    expect(r.loose("load")).toBeNull(); // l4 and l7
    expect(r.loose("lo")).toBeNull(); // too short
    expect(r.loose("zzz")).toBeNull();
  });
});

describe("ambiguity is explained, never silent", () => {
  const r = makeResolver(ICONS.map((i) => ({ ...i, pack: "core" })));
  it("pick ranks candidates (core pack first, then shortest id) and lists the others", () => {
    expect(r.pick!("load-balancer")).toEqual({ id: "load-balancer-l4", others: ["load-balancer-l7"] });
    expect(r.pick!("zzzz")).toBeNull();
    expect(r.pick!("kafka")).toBeNull(); // a single candidate is loose()'s job, not a "pick"
  });
  it("vendor packs rank after core", () => {
    const rr = makeResolver([{ id: "aws-lbx", name: "AWS LBX", aliases: [], pack: "aws" }, { id: "my-lbx", name: "My LBX", aliases: [], pack: "core" }]);
    expect(rr.pick!("lbx")).toEqual({ id: "my-lbx", others: ["aws-lbx"] });
  });
  it("ambiguous() lists what a shared alias could mean; exact ids and unique aliases are not ambiguous", () => {
    expect(r.ambiguous!("lb")).toEqual(["load-balancer-l4", "load-balancer-l7"]);
    expect(r.ambiguous!("sql")).toEqual(["postgresql", "sql-database"]);
    expect(r.ambiguous!("redis")).toEqual([]);
    expect(r.ambiguous!("postgres")).toEqual([]);
    expect(r.ambiguous!("")).toEqual([]);
  });
  it("`lb: load-balancer` gets an icon AND a warning that names the alternative", () => {
    const g = parseDiagram("a -> lb\nlb: load-balancer", { resolver: r });
    expect(g.errors).toEqual([]);
    expect(g.nodes.find((n) => n.key === "lb")!.iconId).toBe("load-balancer-l4");
    const w = g.warnings.find((x) => /matches several icons/.test(x.msg))!;
    expect(w.line).toBe(2);
    expect(w.msg).toContain("load-balancer-l7");
  });
  it("an exact id in the attribute has no warning", () => {
    const g = parseDiagram("lb: load-balancer-l7", { resolver: r });
    expect(g.nodes[0]!.iconId).toBe("load-balancer-l7");
    expect(g.warnings).toEqual([]);
  });
  it("a bare ambiguous name stays a box with a hint on its first line", () => {
    const g = parseDiagram("x -> y\nclient -> lb", { resolver: r });
    const lb = g.nodes.find((n) => n.key === "lb")!;
    expect(lb.iconId).toBe("");
    const w = g.warnings.find((x) => /could be/.test(x.msg))!;
    expect(w.line).toBe(2);
    expect(w.msg).toContain("load-balancer-l4 or load-balancer-l7");
    expect(w.msg).toContain("lb: <icon>");
  });
});

describe("buildElements", () => {
  const defaults = { cat: 0, fill: 0 as const, edge: 1 as const, route: 1 as const };
  const build = (text: string, center = { x: 500, y: 300 }) => {
    const g = parseDiagram(text, { resolver: makeResolver(ICONS) });
    expect(g.errors).toEqual([]);
    return { g, b: buildElements(g, { defaults, center, categoryOf: (id) => (id === "redis" ? 1 : null) }) };
  };

  it("creates nodes then bound arrows; icons get their category; shapes map to kinds", () => {
    const { b } = build("client -> lb: x\nclient -> redis\nredis -> db\ndb: cylinder");
    expect(b.nodes).toBe(4);
    const byText = Object.fromEntries(b.els.filter((e) => e.kind !== "arrow").map((e) => [e.text, e]));
    expect(byText["redis"]).toMatchObject({ kind: "icon", iconId: "redis", cat: 1 });
    expect(byText["db"]!.kind).toBe("cylinder");
    expect(byText["client"]!.kind).toBe("rect");
    const ids = new Set(b.els.map((e) => e.id));
    for (const a of b.els.filter((e) => e.kind === "arrow")) { expect(ids.has(a.src)).toBe(true); expect(ids.has(a.dst)).toBe(true); }
    expect(b.els.filter((e) => e.kind === "arrow").length).toBe(b.edges);
  });
  it("dashed and labelled arrows, and default styles are applied", () => {
    const { b } = build("a ==> b : async", { x: 0, y: 0 });
    const a = b.els.find((e) => e.kind === "arrow")!;
    expect(a).toMatchObject({ dash: 1, text: "async", route: 1, head: 1 });
    expect(b.els.find((e) => e.text === "a")).toMatchObject({ fill: 0, edge: 1, radius: 8 });
  });
  it("the result is centred on the requested point and is deterministic", () => {
    const one = build("a -> b -> c", { x: 1000, y: -400 });
    const nodes = one.b.els.filter((e) => e.kind !== "arrow");
    const cx = (Math.min(...nodes.map((e) => e.x)) + Math.max(...nodes.map((e) => e.x + e.w))) / 2;
    const cy = (Math.min(...nodes.map((e) => e.y)) + Math.max(...nodes.map((e) => e.y + e.h))) / 2;
    expect(Math.abs(cx - 1000)).toBeLessThanOrEqual(1);
    expect(Math.abs(cy + 400)).toBeLessThanOrEqual(1);
    expect(JSON.stringify(build("a -> b -> c", { x: 1000, y: -400 }).b.els)).toBe(JSON.stringify(one.b.els));
  });
  it("direction: TB lays out downwards, LR rightwards", () => {
    const lr = build("a -> b").b.els.filter((e) => e.kind !== "arrow");
    const tb = build("direction: TB\na -> b").b.els.filter((e) => e.kind !== "arrow");
    expect(lr[1]!.x).toBeGreaterThan(lr[0]!.x + lr[0]!.w - 1);
    expect(tb[1]!.y).toBeGreaterThan(tb[0]!.y + tb[0]!.h - 1);
  });
  it("nested groups: members carry deepest -> shallowest ids; unused groups are not invented", () => {
    const { b } = build("[outer] {\n a -> b\n [inner] {\n  c\n }\n}\nd");
    expect(b.groups.map((x) => x.name)).toEqual(["outer", "inner"]);
    const ids = Object.fromEntries(b.els.filter((e) => e.kind !== "arrow").map((e) => [e.text, e.groupIds]));
    expect(ids["c"]).toEqual(["ig2", "ig1"]);
    expect(ids["a"]).toEqual(["ig1"]);
    expect(ids["d"]).toEqual([]);
  });
  it("Mermaid shapes map to kinds; round boxes get the soft corner", () => {
    const g = parseDiagram("flowchart LR\nA[(db)] --> B(rounded) --> C{d}");
    const b = buildElements(g, { defaults, center: { x: 0, y: 0 } });
    const kinds = Object.fromEntries(b.els.filter((e) => e.kind !== "arrow").map((e) => [e.text, e]));
    expect(kinds["db"]!.kind).toBe("cylinder");
    expect(kinds["rounded"]).toMatchObject({ kind: "rect", edge: 2, radius: 18 });
    expect(kinds["d"]!.kind).toBe("diamond");
  });
  it("sizes grow with the label and never collapse", () => {
    const small = sizeOf({ key: "a", label: "a", shape: "box", iconId: "", group: "" });
    const big = sizeOf({ key: "a", label: "a very long service name here", shape: "box", iconId: "", group: "" });
    expect(big.w).toBeGreaterThan(small.w);
    expect(small.w).toBeGreaterThanOrEqual(96);
    expect(sizeOf({ key: "a", label: "x\ny\nz", shape: "box", iconId: "", group: "" }).h).toBeGreaterThan(small.h);
  });
});

let stage: HTMLDivElement;
let ed: Editor;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
  stage = document.createElement("div");
  stage.setPointerCapture = () => {}; stage.releasePointerCapture = () => {};
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  stage.append(a, b); document.body.append(stage);
  ed = createEditor({ stage, staticCanvas: a, liveCanvas: b, theme: LIGHT });
  ed.renderer.resize(1200, 800, 1);
  resetPacks();
  installIndex({ v: 2, icons: ICONS.map((i) => [i.id, i.name, i.aliases, i.category, "core", ""]) });
});
afterEach(() => { ed.destroy(); stage.remove(); resetPacks(); });

const parse = (t: string) => parseDiagram(t, { resolver: makeResolver(ICONS) });
const snap = () => JSON.stringify([...ed.scene.els.values()].map((e) => ({ ...e })).sort((a, b) => (a.id < b.id ? -1 : 1)));

describe("importGraph in the editor", () => {
  it("adds everything in ONE undo step; arrows are bound and routed; the result is selected", () => {
    ed.setTool("rect");
    const before = ed.scene.els.size;
    const r = importGraph(ed, parse("client -> lb -> [api1, api2] -> postgres\n[tier] { api1, api2 }"))!;
    expect(r.nodes).toBe(5);
    expect(ed.scene.els.size).toBe(before + 5 + 5);
    const els = [...ed.scene.els.values()];
    const arrows = els.filter((e) => e.kind === "arrow");
    expect(arrows.length).toBe(5);
    for (const a of arrows) {
      expect(ed.scene.els.get(a.src)).toBeTruthy();
      expect(ed.scene.els.get(a.dst)).toBeTruthy();
      expect(a.pts.length).toBeGreaterThanOrEqual(4); // routed
    }
    expect(ed.selection().size).toBe(10);
    expect(ed.scene.groups.size).toBe(1);
    expect([...ed.scene.groups.values()][0]!.name).toBe("tier");
    const grouped = els.filter((e) => e.groupIds.length);
    expect(grouped.map((e) => e.text).sort()).toEqual(["api1", "api2"]);
    expect(ed.canUndo()).toBe(true);
  });
  it("undo removes all of it in one step (including groups) and redo restores it exactly", () => {
    ed.setTool("rect");
    const s0 = snap();
    importGraph(ed, parse("[g] { a -> b }\nb -> c"));
    const s1 = snap();
    expect(s1).not.toBe(s0);
    ed.undo();
    expect(snap()).toBe(s0);
    expect(ed.scene.groups.size).toBe(0);
    expect(ed.canUndo()).toBe(false); // the import was the only step
    ed.redo();
    expect(JSON.parse(snap())).toEqual(JSON.parse(s1)); // key order may differ after restore; the content must not
    expect(ed.scene.groups.size).toBe(1);
  });
  it("existing content is untouched and the import becomes normal, editable content", () => {
    ed.importElements({ els: buildElements(parse("x -> y"), { defaults: { cat: 0, fill: 0, edge: 1, route: 1 }, center: { x: 0, y: 0 } }).els, groups: [] }, false);
    const existing = new Set(ed.scene.els.keys());
    const r = importGraph(ed, parse("a -> b"))!;
    for (const id of existing) expect(ed.scene.els.has(id)).toBe(true);
    const fresh = [...ed.scene.els.values()].filter((e) => !existing.has(e.id));
    expect(fresh.length).toBe(r.nodes + r.edges);
    const a = fresh.find((e) => e.text === "a")!;
    ed.select([a.id]); ed.setStyle({ cat: 3 });
    expect(a.cat).toBe(3);
    ed.undo(); expect(a.cat).not.toBe(3);
    ed.undo(); expect(fresh.every((e) => !ed.scene.els.has(e.id))).toBe(true);
  });
  it("importing into a sheet with content places the new diagram BELOW it, never on top", () => {
    importGraph(ed, parse("a -> b -> c"));
    const first = ed.scene.bounds()!;
    const before = new Set(ed.scene.els.keys());
    importGraph(ed, parse("x -> y -> z"));
    const fresh = [...ed.scene.els.values()].filter((e) => !before.has(e.id) && e.kind !== "arrow");
    expect(fresh.length).toBe(3);
    for (const e of fresh) expect(e.y).toBeGreaterThanOrEqual(first.y + first.h + 50);
    // and horizontally centred under the old content
    const cx = (Math.min(...fresh.map((e) => e.x)) + Math.max(...fresh.map((e) => e.x + e.w))) / 2;
    expect(Math.abs(cx - (first.x + first.w / 2))).toBeLessThanOrEqual(2);
  });
  it("an empty sheet gets the import centred in the current view", () => {
    ed.panTo(2000, 1500);
    importGraph(ed, parse("a -> b"));
    const b = ed.scene.bounds()!;
    expect(Math.abs(b.x + b.w / 2 - 2000)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.y + b.h / 2 - 1500)).toBeLessThanOrEqual(40); // arrows are thin, so the box centre can sit a hair off
  });
  it("moving an imported node reroutes its arrows (they are really bound)", () => {
    importGraph(ed, parse("a -> b"));
    const a = [...ed.scene.els.values()].find((e) => e.text === "a")!;
    const arrow = [...ed.scene.els.values()].find((e) => e.kind === "arrow")!;
    const before = [...arrow.pts];
    ed.select([a.id]); ed.nudge(0, 300);
    expect(arrow.pts).not.toEqual(before);
  });
  it("zoom-to-fit keeps everything inside the area the panels leave free, wide or tall, big or small", () => {
    const cases = ["a -> b", "a -> b -> c -> d -> e -> f -> g -> h -> i -> j -> k -> l", "direction: TB\na -> [b, c, d, e, f, g] -> h -> i -> j -> k"];
    for (const text of cases) {
      ed.undo(); // clear the previous case (no-op first time)
      importGraph(ed, parse(text));
      const vp = ed.vp, r = chromeReserve(vp.w);
      for (const e of ed.scene.els.values()) {
        if (e.kind === "arrow") continue;
        const left = (e.x - vp.x) * vp.zoom, right = (e.x + e.w - vp.x) * vp.zoom, top = (e.y - vp.y) * vp.zoom, bottom = (e.y + e.h - vp.y) * vp.zoom;
        expect(left).toBeGreaterThanOrEqual(r.left - 1);
        expect(right).toBeLessThanOrEqual(vp.w - r.right + 1);
        expect(top).toBeGreaterThanOrEqual(-1);
        expect(bottom).toBeLessThanOrEqual(vp.h + 1);
      }
    }
  });
  it("narrow screens reserve no chrome", () => {
    expect(chromeReserve(700)).toEqual({ left: 0, right: 0 });
    expect(chromeReserve(1280).right).toBeGreaterThan(250);
  });
  it("refuses a graph with errors or no nodes", () => {
    expect(importGraph(ed, parse("a ->"))).toBeNull();
    expect(importGraph(ed, parse(""))).toBeNull();
    expect(ed.scene.els.size).toBe(0);
  });
  it("icons resolve from the loaded index and keep the name as their label", () => {
    const r = importGraph(ed, parse("postgres -> Redis -> widgets"))!;
    expect(r.icons).toBe(2);
    const icons = [...ed.scene.els.values()].filter((e) => e.kind === "icon");
    expect(icons.map((e) => [e.iconId, e.text]).sort()).toEqual([["postgresql", "postgres"], ["redis", "Redis"]]);
    expect(icons.find((e) => e.iconId === "redis")!.cat).toBe(1); // category from the icon's own metadata
  });
});

describe("importElements safety", () => {
  it("drops unknown kinds and garbage, caps the count, never throws on hostile input", () => {
    expect(ed.importElements({ els: [], groups: [] })).toEqual([]);
    expect(ed.importElements({ els: null as never, groups: null as never })).toEqual([]);
    const good = buildElements(parse("a -> b"), { defaults: { cat: 0, fill: 0, edge: 1, route: 1 }, center: { x: 0, y: 0 } }).els;
    const bad = [{ ...good[0]!, kind: "nope" as never }, { ...good[0]!, x: "1" as never }, null as never];
    expect(ed.importElements({ els: bad, groups: [] })).toEqual([]);
    expect(ed.scene.els.size).toBe(0);
    const nan = [{ ...good[0]!, x: NaN, w: -5 }];
    const ids = ed.importElements({ els: nan, groups: [] }, false);
    expect(ids.length).toBe(1);
    const e = ed.scene.els.get(ids[0]!)!;
    expect(Number.isFinite(e.x) && e.w >= 1).toBe(true);
  });
});

describe("speed", () => {
  it("2,000 nodes and 3,000 arrows: parse + build + apply is fast (layout excluded)", () => {
    const lines: string[] = [];
    for (let i = 1; i < 2000; i++) lines.push(`n${Math.floor(i / 2)} -> n${i}`);
    for (let i = 0; i < 1000; i++) lines.push(`n${i} ==> n${(i * 7 + 13) % 2000}`);
    const text = lines.join("\n");
    const resolver = makeResolver(ICONS);

    const t0 = performance.now();
    const g = parseDiagram(text, { resolver });
    const tParse = performance.now() - t0;
    expect(g.errors).toEqual([]);
    expect(g.nodes.length).toBe(2000);

    const t1 = performance.now();
    layoutGraph(g.nodes.map((n) => ({ id: n.key, ...sizeOf(n) })), g.edges.map((e) => ({ from: e.from, to: e.to })), { direction: g.direction });
    const tLayout = performance.now() - t1;

    const t2 = performance.now();
    const r = importGraph(ed, g, false)!;
    const tAll = performance.now() - t2; // includes one layout run
    const tBuildApply = Math.max(0, tAll - tLayout);
    expect(r.nodes).toBe(2000);
    expect(ed.scene.els.size).toBeGreaterThanOrEqual(2000 + 1900);
    // eslint-disable-next-line no-console
    console.log(`[textimport perf] parse ${tParse.toFixed(0)} ms, layout ${tLayout.toFixed(0)} ms, build+apply ${tBuildApply.toFixed(0)} ms (jsdom)`);
    // jsdom + a cold JIT + parallel test workers make wall-clock asserts flaky, so this only catches a catastrophic (e.g. quadratic)
    // slowdown; the real-Chrome flow (perf check in the feature's Puppeteer script) holds the 300 ms budget
    expect(tParse + tBuildApply).toBeLessThan(1500);
    // and one undo removes it all
    ed.undo();
    expect(ed.scene.els.size).toBe(0);
  });
});
