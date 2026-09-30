import { describe, expect, it } from "vitest";
import { buildIndex, groupByCategory, groupBySection, makeEntry, scoreToken, search, sectionLabel, type Hit } from "./icon-search";

const icons = [
  { id: "cache", name: "Cache", aliases: ["memoize", "redis-like"], category: "cache" },
  { id: "in-memory-cache", name: "In-memory cache", aliases: ["ram cache"], category: "cache" },
  { id: "cron-job", name: "Cron job", aliases: ["scheduler", "timer"], category: "compute" },
  { id: "load-balancer-l7", name: "Load balancer (L7)", aliases: ["lb", "balancer", "http lb"], category: "network" },
  { id: "sql-database", name: "SQL database", aliases: ["db", "relational"], category: "data" },
  { id: "read-replica", name: "Read replica", aliases: ["follower"], category: "data" },
];
const index = buildIndex(icons);
const run = (q: string, cat: string | null = null): Hit[] => { const out: Hit[] = []; search(index, q, cat, out, 24); return out; };

describe("scoreToken ranking: exact > prefix > alias > substring > fuzzy", () => {
  const e = makeEntry("icon", "cron-job", "Cron job", "compute", ["scheduler", "timer"]);
  it("orders the tiers", () => {
    const exact = scoreToken(e, "cron-job");
    const prefix = scoreToken(e, "cro");
    const word = scoreToken(e, "job");
    const aliasExact = scoreToken(e, "timer");
    const aliasPrefix = scoreToken(e, "sched");
    const sub = scoreToken(e, "ron");
    const fuzzy = scoreToken(e, "cjb");
    expect(exact).toBeGreaterThan(aliasExact);
    expect(aliasExact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(aliasPrefix);
    expect(aliasPrefix).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
    expect(scoreToken(e, "zzz")).toBe(0);
  });
});

describe("search", () => {
  it("exact id beats prefix beats alias", () => {
    expect(run("cache")[0]!.e.id).toBe("cache");
    expect(run("db")[0]!.e.id).toBe("sql-database");
    expect(run("sched")[0]!.e.id).toBe("cron-job");
  });
  it("multi-token queries need every token", () => {
    expect(run("read rep").map((h) => h.e.id)).toEqual(["read-replica"]);
    expect(run("read cache")).toHaveLength(0);
  });
  it("restricts by category", () => {
    expect(run("", "data").map((h) => h.e.id).sort()).toEqual(["read-replica", "sql-database"]);
  });
  it("includes built-in shapes", () => {
    const h = run("circle")[0]!;
    expect(h.e.kind).toBe("shape"); expect(h.e.tool).toBe("ellipse");
    expect(run("connector")[0]!.e.tool).toBe("arrow");
  });
  it("reuses the output buffer and honours the limit", () => {
    const out: Hit[] = [];
    search(index, "", null, out, 3); expect(out).toHaveLength(3);
    const before = out.slice();
    search(index, "", null, out, 3);
    expect(out[0]).toBe(before[0]); // Hit objects are recycled, not reallocated
  });
  it("recents rank first on an empty query", () => {
    const out: Hit[] = [];
    search(index, "", null, out, 24, new Set(["read-replica"]));
    expect(out[0]!.e.id).toBe("read-replica");
  });
  it("empty query browses in canonical category order (data, cache, network, compute…)", () => {
    const cats = groupByCategory(run("")).map((h) => h.e.category);
    const uniq = cats.filter((c, i) => cats.indexOf(c) === i);
    expect(uniq.slice(0, 4)).toEqual(["data", "cache", "network", "compute"]);
  });
  it("groups by category, best group first", () => {
    const g = groupByCategory(run("cache"));
    const cats = g.map((h) => h.e.category);
    for (let i = 1; i < cats.length; i++) if (cats[i] !== cats[i - 1]) expect(cats.slice(0, i)).not.toContain(cats[i]);
    expect(g[0]!.e.category).toBe("cache");
  });
});

describe("packs, sources and sections", () => {
  const multi = buildIndex([
    { id: "cache", name: "Cache", aliases: ["memoize"], category: "cache", pack: "core" },
    { id: "aws-elasticache", name: "ElastiCache", aliases: ["amazon redis", "aws cache"], category: "cache", pack: "aws", vendor: "aws" },
    { id: "gcp-memorystore", name: "Memorystore", aliases: ["google redis", "gcp cache"], category: "cache", pack: "gcp", vendor: "gcp" },
    { id: "azure-cache-for-redis", name: "Cache for Redis", aliases: ["azure redis"], category: "cache", pack: "azure", vendor: "azure" },
    { id: "redis", name: "Redis", aliases: ["in-memory store"], category: "cache", pack: "oss", vendor: "oss" },
    { id: "user-x-cache", name: "My cache", aliases: [], category: "cache", pack: "user-x", vendor: "user" },
  ], [{ id: "rect", name: "Rectangle", aliases: ["box"], tool: "rect" }, { id: "cloud", name: "Cloud", aliases: [], tool: "cloud" }]);
  const go = (q: string, source: string | null = null): Hit[] => { const out: Hit[] = []; search(multi, q, null, out, 48, undefined, source); return out; };

  it("searches across every pack", () => {
    expect(go("redis").map((h) => h.e.pack).sort()).toEqual(["azure", "gcp", "oss", "aws"].sort());
    expect(go("cache").length).toBeGreaterThanOrEqual(5);
  });
  it("exact > prefix > alias holds across packs", () => {
    expect(go("redis")[0]!.e.id).toBe("redis"); // exact name beats aliases and substrings elsewhere
    expect(go("aws")[0]!.e.pack).toBe("aws");
  });
  it("the source filter restricts to one pack", () => {
    expect(go("cache", "aws").map((h) => h.e.id)).toEqual(["aws-elasticache"]);
    expect(go("", "gcp").map((h) => h.e.id)).toEqual(["gcp-memorystore"]);
    expect(go("", "user-x").map((h) => h.e.id)).toEqual(["user-x-cache"]);
    expect(go("cloud", "shapes").map((h) => h.e.kind)).toEqual(["shape"]);
  });
  it("shape entries come from the SHAPES list, including new tools", () => {
    expect(go("box")[0]!.e.tool).toBe("rect");
    expect(go("cloud").find((h) => h.e.kind === "shape")!.e.tool).toBe("cloud");
  });
  it("sections are contiguous, best first, in canonical pack order on ties", () => {
    const g = groupBySection(go(""));
    const packs = g.map((h) => h.e.pack);
    expect(packs.filter((p, i) => packs.indexOf(p) === i)).toEqual(["core", "oss", "aws", "gcp", "azure", "user-x", "shapes"]);
    for (let i = 1; i < packs.length; i++) if (packs[i] !== packs[i - 1]) expect(packs.slice(0, i)).not.toContain(packs[i]);
  });
  it("labels", () => {
    expect(["core", "generic2", "oss", "aws", "gcp", "azure", "user-my-cloud"].map(sectionLabel)).toEqual(["Core", "Generic", "Open source", "AWS", "Google Cloud", "Azure", "my-cloud"]);
  });
  it("searching a section name finds its icons", () => {
    expect(go("azure").some((h) => h.e.pack === "azure")).toBe(true);
  });
});
