import { describe, expect, it } from "vitest";
import { LIMITS, parseDiagram, type Graph, type IconResolver } from "./textdsl";

const ICONS: Record<string, string> = { postgres: "postgresql", redis: "redis", kafka: "kafka", "load balancer": "load-balancer-l7", "cron job": "cron-job", worker: "worker", "load-balancer": "load-balancer-l7" };
const resolver: IconResolver = {
  exact: (n) => ICONS[n.toLowerCase()] ?? null,
  loose: (n) => ICONS[n.toLowerCase()] ?? (n.toLowerCase().startsWith("load") ? "load-balancer-l7" : null),
};
const dsl = (t: string): Graph => parseDiagram(t, { resolver });
const mer = (t: string): Graph => parseDiagram(t.startsWith("flowchart") || t.startsWith("graph") ? t : "flowchart LR\n" + t);
const keys = (g: Graph) => g.nodes.map((n) => n.key);
const pairs = (g: Graph) => g.edges.map((e) => `${e.from}>${e.to}`);

describe("DSL: chains, lists, labels, arrows", () => {
  it("parses a chain with a fan-out list", () => {
    const g = dsl("client -> lb -> [api1, api2] -> postgres");
    expect(g.errors).toEqual([]);
    expect(keys(g)).toEqual(["client", "lb", "api1", "api2", "postgres"]);
    expect(pairs(g)).toEqual(["client>lb", "lb>api1", "lb>api2", "api1>postgres", "api2>postgres"]);
    expect(g.syntax).toBe("dsl");
    expect(g.direction).toBe("LR");
  });
  it("label goes on the last arrow of the line; a colon inside a word does not split", () => {
    const g = dsl("a -> b -> c : http\nx -> api:8080");
    expect(g.edges.map((e) => e.label)).toEqual(["", "http", ""]);
    expect(g.nodes.find((n) => n.key === "api:8080")).toBeTruthy();
  });
  it("==> and dashed shafts are async; -> is solid", () => {
    const g = dsl("a ==> b\nb -.-> c\nc ..> d\nd --> e\ne -> f");
    expect(g.edges.map((e) => e.dashed)).toEqual([true, true, true, false, false]);
  });
  it("a > with no shaft is ordinary text", () => {
    const g = dsl('"a>b" -> c\nx > y');
    expect(keys(g)).toContain("a>b");
    expect(keys(g)).toContain("x > y");
  });
  it("names with spaces, quotes and unicode; keys are case-insensitive, labels keep the first spelling", () => {
    const g = dsl('"Load Balancer" -> Åpi -> api\nÅPI -> 数据库');
    expect(g.errors).toEqual([]);
    expect(g.nodes.find((n) => n.key === "åpi")!.label).toBe("Åpi");
    expect(keys(g)).toContain("数据库");
    expect(g.nodes.length).toBe(4);
  });
  it("dedupes identical arrows and ignores self links with a warning", () => {
    const g = dsl("a -> b\na -> b\nc -> c");
    expect(g.edges.length).toBe(1);
    expect(g.warnings.some((w) => /itself/.test(w.msg) && w.line === 3)).toBe(true);
  });
  it("comments: # at the start or after a space, but not inside a word or quotes", () => {
    const g = dsl("# whole line\na -> b  # trailing\nC# -> \"x # y\"");
    expect(g.errors).toEqual([]);
    expect(keys(g)).toEqual(["a", "b", "c#", "x # y"]);
  });
  it("';' separates statements on one line", () => {
    expect(pairs(dsl("a -> b; b -> c"))).toEqual(["a>b", "b>c"]);
  });
  it("bare declarations, several per line", () => {
    expect(keys(dsl("a, b, c"))).toEqual(["a", "b", "c"]);
  });
  it("Windows line endings", () => {
    const g = dsl("a -> b\r\nb -> c\r\n");
    expect(g.errors).toEqual([]);
    expect(pairs(g)).toEqual(["a>b", "b>c"]);
  });
});

describe("DSL: attributes, icons and shapes", () => {
  it("a bare name becomes an icon only on an EXACT match; no guessing", () => {
    const g = dsl("postgres -> Redis -> widgets -> load balancer -> cron job");
    const byKey = Object.fromEntries(g.nodes.map((n) => [n.key, n.iconId]));
    expect(byKey).toEqual({ postgres: "postgresql", redis: "redis", widgets: "", "load balancer": "load-balancer-l7", "cron job": "cron-job" });
    expect(dsl("postgre -> red").nodes.every((n) => n.iconId === "")).toBe(true);
  });
  it("db: cylinder sets the shape; lb: load-balancer sets the icon (id or alias), order independent", () => {
    const g = dsl("lb: load-balancer\nclient -> lb -> db\ndb: cylinder");
    expect(g.nodes.find((n) => n.key === "lb")!.iconId).toBe("load-balancer-l7");
    expect(g.nodes.find((n) => n.key === "db")!.shape).toBe("cylinder");
    expect(g.errors).toEqual([]);
  });
  it("an explicit attribute beats exact-match inference (postgres: diamond stays a diamond box)", () => {
    const g = dsl("postgres: diamond\npostgres -> x");
    const n = g.nodes.find((n) => n.key === "postgres")!;
    expect(n.shape).toBe("diamond");
    expect(n.iconId).toBe("");
  });
  it("an attribute can also carry a label", () => {
    const g = dsl('lb: load-balancer "Edge LB"');
    expect(g.nodes[0]!.label).toBe("Edge LB");
    expect(g.nodes[0]!.iconId).toBe("load-balancer-l7");
  });
  it("a loose (explicit) icon name may be a unique prefix; an unknown one warns with its line and stays a box", () => {
    const g = dsl("a -> b\nb: load\na: nonsense");
    expect(g.nodes.find((n) => n.key === "b")!.iconId).toBe("load-balancer-l7");
    const w = g.warnings.find((x) => /nonsense/.test(x.msg))!;
    expect(w.line).toBe(3);
    expect(g.nodes.find((n) => n.key === "a")!.shape).toBe("box");
  });
  it("direction: TB and 'direction TD'", () => {
    expect(dsl("direction: TB\na -> b").direction).toBe("TB");
    expect(dsl("direction TD\na -> b").direction).toBe("TB");
    const g = dsl("direction: sideways\na -> b");
    expect(g.direction).toBe("LR");
    expect(g.warnings.length).toBe(1);
  });
});

describe("DSL: groups", () => {
  it("single line group", () => {
    const g = dsl('[tier-1] { a b_c "load balancer" }\nx -> a');
    expect(g.groups).toEqual([{ key: "tier-1", name: "tier-1", parent: "" }]);
    // whitespace-separated names in a one-line block are one statement: a single node named "a b_c ..." — use commas or ';'
    expect(g.errors).toEqual([]);
  });
  it("one-line group with commas / semicolons", () => {
    const g = dsl("[tier-1] { a, b, c }\n[t2] { x -> y; y -> z }");
    expect(g.nodes.filter((n) => n.group === "tier-1").map((n) => n.key)).toEqual(["a", "b", "c"]);
    expect(g.nodes.filter((n) => n.group === "t2").map((n) => n.key)).toEqual(["x", "y", "z"]);
  });
  it("multi-line and nested groups; members of a nested group belong to the innermost", () => {
    const g = dsl("[backend] {\n  api -> worker\n  [db tier] {\n    pg\n    redis\n  }\n}\nclient -> api");
    expect(g.errors).toEqual([]);
    expect(g.groups.map((x) => [x.name, x.parent])).toEqual([["backend", ""], ["db tier", "backend"]]);
    expect(Object.fromEntries(g.nodes.map((n) => [n.key, n.group]))).toEqual({ api: "backend", worker: "backend", pg: "db tier", redis: "db tier", client: "" });
  });
  it("a node already in another group is kept there, with a warning", () => {
    const g = dsl("[a] { x }\n[b] { x }");
    expect(g.nodes[0]!.group).toBe("a");
    expect(g.warnings.some((w) => /already in group/.test(w.msg))).toBe(true);
  });
  it("errors: unclosed group, stray }, group without a name", () => {
    expect(dsl("[a] {\n x").errors[0]).toMatchObject({ line: 1 });
    expect(dsl("[a] {\n x").errors[0]!.msg).toMatch(/never closed/);
    expect(dsl("x\n}").errors[0]).toMatchObject({ line: 2 });
    expect(dsl("[] { a }").errors[0]!.msg).toMatch(/needs a name/);
  });
});

describe("DSL: errors carry line numbers", () => {
  it("a dangling arrow", () => {
    const g = dsl("a -> b\nb ->\nc");
    expect(g.errors).toEqual([{ line: 2, msg: "a name is missing next to an arrow" }]);
  });
  it("an unclosed list", () => {
    expect(dsl("a -> [b, c").errors[0]).toMatchObject({ line: 1 });
  });
  it("empty input and comment-only input", () => {
    expect(dsl("").errors.length).toBe(1);
    expect(dsl("# nothing\n\n").errors.length).toBe(1);
  });
});

describe("Mermaid subset", () => {
  it("shapes: [] () {} [()] (()) {{}} [[]] ([])", () => {
    const g = mer("A[box] --> B(round)\nB --> C{dec}\nC --> D[(store)]\nD --> E((circle))\nE --> F{{hex}}\nF --> G[[sub]]\nG --> H([stad])");
    expect(g.errors).toEqual([]);
    expect(g.nodes.map((n) => [n.key, n.shape, n.label])).toEqual([
      ["A", "box", "box"], ["B", "round", "round"], ["C", "diamond", "dec"], ["D", "cylinder", "store"],
      ["E", "ellipse", "circle"], ["F", "hexagon", "hex"], ["G", "box", "sub"], ["H", "round", "stad"],
    ]);
    expect(g.syntax).toBe("mermaid");
  });
  it("arrows: --> --- -.-> -.- ==> and chained edges", () => {
    const g = mer("A --> B --- C -.-> D -.- E ==> F");
    expect(g.edges.map((e) => [e.from + e.to, e.dashed])).toEqual([["AB", false], ["BC", false], ["CD", true], ["DE", true], ["EF", false]]);
  });
  it("labels: |text| and -- text -->, plus . and == forms", () => {
    const g = mer("A -->|yes| B\nB -- maybe --> C\nC -. slow .-> D\nD == big ==> E");
    expect(g.errors).toEqual([]);
    expect(g.edges.map((e) => e.label)).toEqual(["yes", "maybe", "slow", "big"]);
    expect(g.edges[2]!.dashed).toBe(true);
  });
  it("A & B --> C & D is a cross product", () => {
    expect(pairs(mer("A & B --> C & D"))).toEqual(["A>C", "A>D", "B>C", "B>D"]);
  });
  it("ids with hyphens and unicode; text with quotes, tags and brackets", () => {
    const g = mer('web-1["Front (edge) <b>end</b>"] --> db_2[(数据库<br/>主)]');
    expect(g.errors).toEqual([]);
    expect(g.nodes[0]).toMatchObject({ key: "web-1", label: "Front (edge) end" });
    expect(g.nodes[1]!.label).toBe("数据库\n主");
  });
  it("direction: LR, TB, TD, RL and BT (with a warning for the last two); graph keyword; header with ';'", () => {
    expect(parseDiagram("flowchart TB\nA-->B").direction).toBe("TB");
    expect(parseDiagram("graph TD\nA-->B").direction).toBe("TB");
    expect(parseDiagram("flowchart RL\nA-->B").warnings.length).toBe(1);
    expect(parseDiagram("flowchart BT\nA-->B").direction).toBe("TB");
    expect(pairs(parseDiagram("graph LR; A-->B"))).toEqual(["A>B"]);
  });
  it("subgraphs: flat, titled, nested; nodes belong to the innermost", () => {
    const g = mer("subgraph one [Edge tier]\n  A --> B\n  subgraph two\n    C\n  end\nend\nB --> C\nD");
    expect(g.errors).toEqual([]);
    expect(g.groups).toEqual([{ key: "one", name: "Edge tier", parent: "" }, { key: "two", name: "two", parent: "one" }]);
    expect(Object.fromEntries(g.nodes.map((n) => [n.key, n.group]))).toEqual({ A: "one", B: "one", C: "two", D: "" });
  });
  it("a bracketed definition wins over an earlier bare mention; the first definition wins over later ones", () => {
    const g = mer("A --> B\nB[Service B] --> C\nB[other]");
    expect(g.nodes.find((n) => n.key === "B")!.label).toBe("Service B");
  });
  it("warnings, never crashes: style / classDef / class / click / linkStyle / :::class / x-o heads / bidirectional", () => {
    const g = mer("A --> B\nstyle A fill:#f00\nclassDef big fill:#f9f\nclass A big\nclick A callback\nlinkStyle 0 stroke:red\nC:::big --> D\nA --x B\nE <--> F");
    expect(g.errors).toEqual([]);
    const msgs = g.warnings.map((w) => w.msg).join(" | ");
    for (const w of ["style", "classdef", "class", "click", "linkstyle", ":::", "x / o", "bidirectional"]) expect(msgs.toLowerCase()).toContain(w.toLowerCase());
    expect(g.warnings.find((w) => /style/.test(w.msg))!.line).toBe(3); // the helper adds a "flowchart LR" header line
  });
  it("other diagram types are a clear error, not a crash", () => {
    for (const head of ["sequenceDiagram", "erDiagram", "gantt", "classDiagram", "stateDiagram-v2", "pie", "mindmap"]) {
      const g = parseDiagram(head + "\n  A->>B: hi");
      expect(g.errors[0]!.msg).toMatch(/not supported/);
      expect(g.nodes.length).toBe(0);
    }
  });
  it("syntax errors with line numbers: unterminated bracket, dangling arrow, unclosed subgraph, stray end, bad arrow, bad label", () => {
    expect(mer("A --> B[oops").errors[0]).toMatchObject({ line: 2 });
    expect(mer("A -->").errors[0]).toMatchObject({ line: 2 });
    expect(mer("subgraph s\nA --> B").errors[0]!.msg).toMatch(/never closed/);
    expect(mer("A --> B\nend").errors[0]).toMatchObject({ line: 3 });
    expect(mer("A - B").errors[0]!.msg).toMatch(/not an arrow/);
    expect(mer("A -->|yes B").errors[0]!.msg).toMatch(/unterminated/);
    expect(mer("A -- never\nB").errors.length).toBe(1);
  });
  it("%% comment lines and blank lines are skipped; trailing junk after a statement is a line-numbered error", () => {
    expect(pairs(mer("%% hi\n\nA --> B\n%% bye"))).toEqual(["A>B"]);
    expect(mer("A --> B %% trailing").errors[0]).toMatchObject({ line: 2 });
  });
});

describe("limits and hostile input", () => {
  it("text over 200 KB is rejected before any parsing", () => {
    const g = parseDiagram("a -> b\n".repeat(40_000));
    expect(g.errors).toHaveLength(1);
    expect(g.errors[0]!.msg).toMatch(/limit/);
    expect(g.nodes.length).toBe(0);
  });
  it("more than 2,000 nodes stops with a precise line number", () => {
    const text = Array.from({ length: LIMITS.maxNodes + 5 }, (_, i) => `n${i}`).join("\n");
    const g = parseDiagram(text);
    expect(g.errors[0]).toMatchObject({ line: LIMITS.maxNodes + 1 });
    expect(g.nodes.length).toBe(LIMITS.maxNodes);
  });
  it("more than 5,000 arrows stops", () => {
    const n = 101;
    const lines: string[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) lines.push(`a${i} -> a${j}`);
    const g = parseDiagram(lines.join("\n"));
    expect(g.errors[0]!.msg).toMatch(/arrows/);
    expect(g.edges.length).toBe(LIMITS.maxEdges);
  });
  it("long labels are cut to 120 characters with one warning", () => {
    const long = "x".repeat(500);
    const g = parseDiagram(`"${long}" -> "${long}y"`);
    expect(g.nodes.every((n) => n.label.length === LIMITS.maxLabel)).toBe(true);
    expect(g.warnings.length).toBe(1);
    const m = mer(`A[${long}] --> B`);
    expect(m.nodes[0]!.label.length).toBe(LIMITS.maxLabel);
  });
  it("pathological inputs finish fast (no regex backtracking): long runs of shaft chars, quotes, brackets, colons", () => {
    const cases = [
      "a " + "-".repeat(50_000) + "> b",
      "a " + "=-.".repeat(20_000) + " b",
      '"'.repeat(60_000),
      "[".repeat(60_000),
      "a -> " + "[".repeat(30_000),
      "x: " + "\"a\" ".repeat(20_000),
      "flowchart LR\nA " + "-- ".repeat(20_000) + "--> B",
      "flowchart LR\nA[" + "(".repeat(50_000),
      "flowchart LR\n" + "A & ".repeat(20_000) + "B",
      "flowchart LR\nA -" + ".".repeat(60_000) + "-> B",
      "<".repeat(80_000),
      "a : ".repeat(40_000),
    ];
    for (const c of cases) {
      const t0 = performance.now();
      const g = parseDiagram(c.slice(0, LIMITS.maxChars));
      expect(performance.now() - t0).toBeLessThan(400);
      expect(Array.isArray(g.errors)).toBe(true);
    }
  });
  it("arbitrary junk never throws", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alphabet = ['a', 'B', ' ', '-', '>', '=', '.', '[', ']', '(', ')', '{', '}', '"', ':', ';', '|', '&', '#', '%', '\n', '<', '/', '\\', 'x', 'o', '数', '\t'];
    for (let i = 0; i < 400; i++) {
      let s = rnd() < 0.5 ? "flowchart LR\n" : "";
      const n = Math.floor(rnd() * 120);
      for (let k = 0; k < n; k++) s += alphabet[Math.floor(rnd() * alphabet.length)]!;
      expect(() => parseDiagram(s, { resolver })).not.toThrow();
    }
  });
});
