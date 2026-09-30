/**
 * Text -> diagram graph. Two syntaxes, auto-detected, both parsed by hand-written character scanners (no regex with
 * nested quantifiers, so hostile input cannot trigger catastrophic backtracking) under hard limits.
 *
 * (A) compact DSL, one statement per line:
 *       client -> lb -> [api1, api2] -> postgres        chains; [a, b] fans out (every a to every b)
 *       a -> b : label                                   label on the LAST arrow of the line
 *       a ==> b                                          dashed / async   (also -.->  ..>)
 *       lb: load-balancer      db: cylinder              node attribute: an icon (id / name / alias) or a shape
 *       lb: load-balancer "Edge LB"                      ...optionally with a label
 *       [tier-1] { a b "load balancer" }                 group (also multi-line, nestable)
 *       direction: TB                                    LR (default) or TB
 *       # comment                                        '#' at line start or after a space
 *     A bare name that matches an icon EXACTLY (id, name or a unique alias) becomes that icon; nothing fuzzy is guessed.
 *
 * (B) a safe subset of Mermaid flowcharts: flowchart|graph LR|TB|TD, A[text] A(text) A{text} A[(db)] A((c)) A{{hex}} A[[s]],
 *     --> --- -.-> -.- ==> ===, -->|label|, -- label -->, A & B --> C, chains, subgraph ... end. Everything else
 *     (style, classDef, class, click, linkStyle, other diagram types) is reported, never guessed.
 *
 * The parser is pure: icon matching is injected, so this file has no DOM and no dependencies.
 */

export const LIMITS = { maxChars: 200_000, maxNodes: 2_000, maxEdges: 5_000, maxLabel: 120 } as const;

export type ShapeName = "box" | "round" | "ellipse" | "diamond" | "cylinder" | "cloud" | "hexagon" | "parallelogram" | "triangle" | "star" | "note";
export interface Diag { line: number; msg: string }
export interface GNode { key: string; label: string; shape: ShapeName; iconId: string; group: string; /** first line that mentioned it */ line?: number }
export interface GEdge { from: string; to: string; label: string; dashed: boolean }
export interface GGroup { key: string; name: string; parent: string }
export interface Graph {
  syntax: "dsl" | "mermaid";
  direction: "LR" | "TB";
  nodes: GNode[]; edges: GEdge[]; groups: GGroup[];
  warnings: Diag[]; errors: Diag[];
}

/** Injected icon matching. `exact`: id / name / unique alias only (used for bare names). `loose`: also a unique prefix/substring (used when the user names the icon explicitly). */
export interface IconResolver {
  exact(name: string): string | null;
  loose(name: string): string | null;
  /** explicit `name: icon` with several plausible icons: the best-ranked one plus the others, so the parser can say what it chose */
  pick?(name: string): { id: string; others: string[] } | null;
  /** icons a bare name could mean when it is ambiguous (two or more); [] when it is exact or unknown */
  ambiguous?(name: string): string[];
}
export interface ParseOpts { resolver?: IconResolver }

const SHAPE_WORDS: Record<string, ShapeName> = {
  box: "box", rect: "box", rectangle: "box", square: "box", round: "round", rounded: "round",
  ellipse: "ellipse", circle: "ellipse", oval: "ellipse", diamond: "diamond", decision: "diamond", rhombus: "diamond",
  cylinder: "cylinder", db: "cylinder", database: "cylinder", cloud: "cloud", hexagon: "hexagon",
  parallelogram: "parallelogram", triangle: "triangle", star: "star", note: "note",
};
export const SHAPE_KEYWORDS: readonly string[] = Object.keys(SHAPE_WORDS);

/* ------------------------------------------------------------------ small scanners */

const isWs = (c: number): boolean => c === 32 || c === 9 || c === 13 || c === 160;
const isIdChar = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 127;

/** index of the first `ch` at or after `from` that is outside "double quotes"; -1 if none */
function findUnquoted(s: string, from: number, ch: string): number {
  let q = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && q) { i++; continue; }
    if (c === '"') q = !q;
    else if (!q && c === ch) return i;
  }
  return -1;
}

/** split on `ch` outside quotes */
function splitUnquoted(s: string, ch: string): string[] {
  const out: string[] = [];
  let q = false, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && q) { i++; continue; }
    if (c === '"') q = !q;
    else if (!q && c === ch) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).split('\\"').join('"');
  return t;
}

/** collapse runs of whitespace (manual: no regex) */
function squash(s: string): string {
  let out = "", prev = true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isWs(c) || c === 10) { if (!prev) { out += " "; prev = true; } } else { out += s[i]; prev = false; }
  }
  return prev && out.length ? out.slice(0, -1) : out;
}

/** drop <...> tags from a Mermaid label; <br> / <br/> become a newline */
function stripTags(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "<") { out += s[i]; continue; }
    const j = s.indexOf(">", i + 1);
    if (j < 0 || j - i > 12) { out += s[i]; continue; } // a literal "<" (not a tag): keep
    const tag = s.slice(i + 1, j).trim().toLowerCase();
    if (tag === "br" || tag === "br/" || tag === "br /") out += "\n";
    i = j;
  }
  return out;
}

/* ------------------------------------------------------------------ shared builder */

class Builder {
  nodes: GNode[] = [];
  edges: GEdge[] = [];
  groups: GGroup[] = [];
  warnings: Diag[] = [];
  errors: Diag[] = [];
  stopped = false;
  private nidx = new Map<string, number>();
  private gidx = new Map<string, number>();
  private eset = new Set<string>();
  private explicit = new Set<string>();
  private warnedLong = false;

  warn(line: number, msg: string): void { if (this.warnings.length < 200) this.warnings.push({ line, msg }); }
  fail(line: number, msg: string): void { if (this.errors.length < 50) this.errors.push({ line, msg }); }
  /** a limit error ends parsing: nothing after it can matter and scanning on would waste time */
  stop(line: number, msg: string): void { this.fail(line, msg); this.stopped = true; }

  label(line: number, raw: string): string {
    let s = raw;
    if (s.length > LIMITS.maxLabel) { s = s.slice(0, LIMITS.maxLabel); if (!this.warnedLong) { this.warnedLong = true; this.warn(line, `labels are limited to ${LIMITS.maxLabel} characters; longer ones were cut`); } }
    return s;
  }

  /** get-or-create; returns the node key, or "" when the node limit stopped parsing */
  node(key: string, label: string, line: number, group: string): string {
    if (this.stopped) return "";
    let i = this.nidx.get(key);
    if (i === undefined) {
      if (this.nodes.length >= LIMITS.maxNodes) { this.stop(line, `too many nodes (limit ${LIMITS.maxNodes})`); return ""; }
      i = this.nodes.push({ key, label: this.label(line, label), shape: "box", iconId: "", group: "", line }) - 1;
      this.nidx.set(key, i);
    }
    if (group) this.assign(key, group, line);
    return key;
  }

  get(key: string): GNode | undefined { const i = this.nidx.get(key); return i === undefined ? undefined : this.nodes[i]; }

  assign(nodeKey: string, group: string, line: number): void {
    const n = this.get(nodeKey);
    if (!n) return;
    if (!n.group) n.group = group;
    else if (n.group !== group && !this.isAncestor(group, n.group)) this.warn(line, `"${n.label}" is already in group "${this.groupName(n.group)}"; kept there`);
  }
  private isAncestor(anc: string, of: string): boolean {
    for (let k = of, guard = 0; k && guard < 64; guard++) { if (k === anc) return true; const g = this.groups[this.gidx.get(k) ?? -1]; k = g ? g.parent : ""; }
    return false;
  }
  groupName(key: string): string { return this.groups[this.gidx.get(key) ?? -1]?.name ?? key; }

  group(key: string, name: string, parent: string, line: number): string {
    if (!this.gidx.has(key)) {
      if (this.groups.length >= 500) { this.stop(line, "too many groups (limit 500)"); return ""; }
      this.gidx.set(key, this.groups.push({ key, name: this.label(line, name), parent }) - 1);
    }
    return key;
  }

  /** sets shape / icon / label; `explicit` definitions beat inference and later bare references */
  define(key: string, patch: { shape?: ShapeName; iconId?: string; label?: string }, line: number, explicit = true): void {
    const n = this.get(key);
    if (!n) return;
    if (this.explicit.has(key) && explicit) return; // the first explicit definition wins
    if (explicit) this.explicit.add(key);
    if (patch.shape) n.shape = patch.shape;
    if (patch.iconId !== undefined) n.iconId = patch.iconId;
    if (patch.label !== undefined) n.label = this.label(line, patch.label);
  }
  isExplicit(key: string): boolean { return this.explicit.has(key); }

  edge(from: string, to: string, label: string, dashed: boolean, line: number): void {
    if (this.stopped || !from || !to) return;
    if (from === to) { this.warn(line, "a node linked to itself is ignored"); return; }
    const k = `${from}\u0000${to}\u0000${label}\u0000${dashed ? 1 : 0}`;
    if (this.eset.has(k)) return;
    if (this.edges.length >= LIMITS.maxEdges) { this.stop(line, `too many arrows (limit ${LIMITS.maxEdges})`); return; }
    this.eset.add(k);
    this.edges.push({ from, to, label: this.label(line, label), dashed });
  }

  done(syntax: Graph["syntax"], direction: Graph["direction"]): Graph {
    return { syntax, direction, nodes: this.nodes, edges: this.edges, groups: this.groups, warnings: this.warnings, errors: this.errors };
  }
}

/* ------------------------------------------------------------------ entry point */

const MERMAID_OTHER = ["sequencediagram", "erdiagram", "gantt", "classdiagram", "statediagram", "pie", "journey", "gitgraph", "mindmap", "timeline", "quadrantchart", "requirementdiagram", "c4context", "sankey", "xychart", "block", "architecture", "kanban", "packet"];

function firstWord(line: string): string {
  let i = 0;
  while (i < line.length && isWs(line.charCodeAt(i))) i++;
  let j = i;
  while (j < line.length && !isWs(line.charCodeAt(j)) && line[j] !== "-" && line[j] !== ";") j++;
  return line.slice(i, j);
}

export function parseDiagram(text: string, opts: ParseOpts = {}): Graph {
  const b = new Builder();
  if (text.length > LIMITS.maxChars) {
    b.fail(1, `text is ${Math.round(text.length / 1000)} KB; the limit is ${LIMITS.maxChars / 1000} KB`);
    return b.done("dsl", "LR");
  }
  const lines = text.split("\n");
  // detect: the first meaningful line decides
  let first = "";
  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith("%%") || (t[0] === "#" && t.indexOf("#") === 0)) continue;
    first = t; break;
  }
  const fw = firstWord(first).toLowerCase();
  if (fw === "flowchart" || fw === "graph" || fw === "flowchart-elk") return parseMermaid(lines, b);
  if (MERMAID_OTHER.includes(fw.replace(/-/g, ""))) {
    b.fail(1, `"${firstWord(first)}" diagrams are not supported — only flowcharts (flowchart LR / TB)`);
    return b.done("mermaid", "LR");
  }
  return parseDsl(lines, b, opts.resolver);
}

/* ------------------------------------------------------------------ (A) DSL */

interface Op { dashed: boolean }

/** split a statement into [element, op, element, ...] around `->`-style operators; brackets and quotes protect their contents */
function splitChain(s: string): { parts: string[]; ops: Op[] } {
  const parts: string[] = [], ops: Op[] = [];
  let q = false, depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && q) { i++; continue; }
    if (c === '"') { q = !q; continue; }
    if (q) continue;
    if (c === "[") depth++;
    else if (c === "]") { if (depth > 0) depth--; }
    else if (c === ">" && depth === 0) {
      let k = i;
      while (k > start && (s[k - 1] === "-" || s[k - 1] === "=" || s[k - 1] === ".")) k--;
      if (k === i) continue; // a '>' with no shaft before it is ordinary text
      const shaft = s.slice(k, i);
      parts.push(s.slice(start, k));
      ops.push({ dashed: shaft.indexOf("=") >= 0 || shaft.indexOf(".") >= 0 });
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return { parts, ops };
}

function stripComment(line: string): string {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && q) { i++; continue; }
    if (c === '"') q = !q;
    else if (!q && c === "#" && (i === 0 || isWs(line.charCodeAt(i - 1)))) return line.slice(0, i);
  }
  return line;
}

/** "[name] {" at the start of a statement */
function isGroupOpener(t: string): boolean {
  const close = findUnquoted(t, 1, "]");
  return close > 0 && t.slice(close + 1).trim()[0] === "{";
}

function parseDsl(lines: string[], b: Builder, resolver?: IconResolver): Graph {
  let direction: "LR" | "TB" = "LR";
  const stack: { key: string; line: number }[] = [];
  const cur = (): string => (stack.length ? stack[stack.length - 1]!.key : "");
  const nameKey = (name: string): string => squash(name).toLowerCase();

  const ref = (name: string, line: number): string => {
    const clean = squash(name);
    if (!clean) return "";
    const k = b.node(nameKey(clean), clean, line, cur());
    return k;
  };

  /** "[a, b]" or "name" -> node keys */
  const element = (text: string, line: number): string[] | null => {
    const t = text.trim();
    if (!t) { b.fail(line, "a name is missing next to an arrow"); return null; }
    if (t[0] === "[") {
      if (t[t.length - 1] !== "]") { b.fail(line, "unclosed [ in a list of names"); return null; }
      const out: string[] = [];
      for (const piece of splitUnquoted(t.slice(1, -1), ",")) {
        const n = unquote(piece);
        if (!n) continue;
        const k = ref(n, line);
        if (k) out.push(k);
      }
      if (!out.length && !b.stopped) { b.fail(line, "empty list of names"); return null; }
      return out;
    }
    const k = ref(unquote(t), line);
    return k ? [k] : (b.stopped ? null : (b.fail(line, "a name is missing"), null));
  };

  const chain = (s: string, line: number): void => {
    const { parts, ops } = splitChain(s);
    // a label: "a -> b : text" — the first unquoted ':' followed by a space (or the end) in the last element
    let label = "";
    const lastIdx = parts.length - 1;
    let last = parts[lastIdx]!;
    for (let ci = findUnquoted(last, 0, ":"); ci >= 0; ci = findUnquoted(last, ci + 1, ":")) {
      const nx = last.charCodeAt(ci + 1);
      if (ci + 1 >= last.length || isWs(nx)) { label = unquote(last.slice(ci + 1)); last = last.slice(0, ci); break; }
    }
    parts[lastIdx] = last;
    const sets: string[][] = [];
    for (const p of parts) { const e = element(p, line); if (!e) return; sets.push(e); }
    for (let i = 0; i + 1 < sets.length; i++) {
      const lab = i === sets.length - 2 ? label : "";
      for (const a of sets[i]!) for (const z of sets[i + 1]!) { b.edge(a, z, lab, ops[i]!.dashed, line); if (b.stopped) return; }
    }
  };

  const attribute = (s: string, colon: number, line: number): void => {
    const name = unquote(s.slice(0, colon));
    const valueRaw = s.slice(colon + 1).trim();
    if (nameKey(name) === "direction") {
      const v = valueRaw.toUpperCase();
      if (v === "LR" || v === "TB") direction = v; else if (v === "TD") direction = "TB"; else b.warn(line, `direction must be LR or TB, got "${valueRaw}"`);
      return;
    }
    const key = ref(name, line);
    if (!key) return;
    // an optional quoted label after the spec:  lb: load-balancer "Edge LB"
    let spec = valueRaw, label: string | undefined;
    const qi = valueRaw.indexOf('"');
    if (qi >= 0) { label = unquote(valueRaw.slice(qi)); spec = valueRaw.slice(0, qi).trim(); }
    const sw = SHAPE_WORDS[spec.toLowerCase()];
    if (sw) { b.define(key, { shape: sw, iconId: "", ...(label !== undefined ? { label } : {}) }, line); return; }
    const icon = spec ? (resolver?.exact(spec) ?? resolver?.loose(spec) ?? null) : null;
    if (icon) { b.define(key, { iconId: icon, shape: "box", ...(label !== undefined ? { label } : {}) }, line); return; }
    const pk = spec ? resolver?.pick?.(spec) : null;
    if (pk) {
      b.define(key, { iconId: pk.id, shape: "box", ...(label !== undefined ? { label } : {}) }, line);
      b.warn(line, `"${spec}" matches several icons; used "${pk.id}" (also ${pk.others.slice(0, 3).join(", ")}${pk.others.length > 3 ? ", …" : ""}) — write the exact icon id to choose`);
      return;
    }
    b.warn(line, spec ? `"${spec}" is not a known shape or icon; "${name}" stays a box` : `nothing after "${name}:"`);
    if (label !== undefined) b.define(key, { label }, line);
  };

  const statement = (s: string, line: number): void => {
    const t = s.trim();
    if (!t || b.stopped) return;
    if (t === "}") { if (stack.length) stack.pop(); else b.fail(line, "a } with no matching group"); return; }
    // "... }" closes the innermost group after its last statement
    if (t[t.length - 1] === "}" && stack.length && findUnquoted(t, 0, "{") < 0) { statement(t.slice(0, -1), line); stack.pop(); return; }
    if (t[0] === "[") {
      const close = findUnquoted(t, 1, "]");
      if (close > 0) {
        const rest = t.slice(close + 1).trim();
        if (rest[0] === "{") { groupOpen(t.slice(1, close), rest.slice(1), line); return; }
      }
    }
    const { parts } = splitChain(t);
    if (parts.length > 1) { chain(t, line); return; }
    const colon = findUnquoted(t, 0, ":");
    if (colon > 0) { attribute(t, colon, line); return; }
    if (t.length > 10 && t.slice(0, 10).toLowerCase() === "direction " ) { attribute("direction:" + t.slice(10), 9, line); return; }
    // "name" or "a, b, c"
    for (const piece of splitUnquoted(t, ",")) { const n = unquote(piece); if (n) ref(n, line); }
  };

  const groupOpen = (nameRaw: string, after: string, line: number): void => {
    const name = squash(unquote(nameRaw));
    if (!name) { b.fail(line, "a group needs a name:  [name] { ... }"); return; }
    const key = b.group(nameKey(name), name, cur(), line);
    if (!key) return;
    stack.push({ key, line });
    let body = after.trim();
    if (body.endsWith("}")) { body = body.slice(0, -1); for (const st of splitUnquoted(body, ";")) statement(st, line); stack.pop(); return; }
    if (body) for (const st of splitUnquoted(body, ";")) statement(st, line);
  };

  for (let li = 0; li < lines.length && !b.stopped; li++) {
    const line = li + 1;
    const t = stripComment(lines[li]!).trim();
    if (!t) continue;
    // a one-line group "[g] { a; b }" keeps its body together (groupOpen splits it); everything else splits on ';'
    if (t[0] === "[" && isGroupOpener(t)) { statement(t, line); continue; }
    for (const st of splitUnquoted(t, ";")) statement(st, line);
  }
  if (!b.stopped) for (const g of stack) b.fail(g.line, `group "${b.groupName(g.key)}" is never closed with }`);

  // inference last, so explicit `name: icon` lines win regardless of order: only exact / unique-alias matches
  if (resolver && !b.stopped) {
    for (const n of b.nodes) {
      if (b.isExplicit(n.key) || n.iconId) continue;
      const id = resolver.exact(n.label);
      if (id) { n.iconId = id; continue; }
      const amb = resolver.ambiguous?.(n.label);
      if (amb && amb.length > 1) b.warn(n.line ?? 1, `"${n.label}" could be ${amb.slice(0, 3).join(" or ")}${amb.length > 3 ? " …" : ""} — left as a box; write  ${n.label}: <icon>  to choose`);
    }
  }
  if (!b.nodes.length && !b.errors.length) b.fail(1, "nothing to import yet — try:  client -> lb -> api -> db");
  return b.done("dsl", direction);
}

/* ------------------------------------------------------------------ (B) Mermaid flowchart subset */

const UNSUPPORTED_STMT = new Set(["style", "linkstyle", "classdef", "class", "click", "accdescr", "acctitle", "callback", "link"]);

interface MOp { dashed: boolean; label: string }

function parseMermaid(lines: string[], b: Builder): Graph {
  let direction: "LR" | "TB" = "LR";
  const stack: { key: string; line: number }[] = [];
  const cur = (): string => (stack.length ? stack[stack.length - 1]!.key : "");
  let headerSeen = false;
  const warned = new Set<string>();
  const warnOnce = (line: number, msg: string): void => { if (!warned.has(msg)) { warned.add(msg); b.warn(line, msg); } };

  const setDirection = (word: string, line: number): void => {
    const d = word.toUpperCase();
    if (d === "LR" || d === "RL") { direction = "LR"; if (d === "RL") warnOnce(line, "direction RL is drawn as LR"); }
    else if (d === "TB" || d === "TD" || d === "BT") { direction = "TB"; if (d === "BT") warnOnce(line, "direction BT is drawn as TB"); }
    else if (d) b.warn(line, `unknown direction "${word}"; using LR`);
  };

  /** text of a bracketed label beginning at s[i] (just after the opener); returns [text, indexAfterCloser] or null */
  const until = (s: string, i: number, closer: string): [string, number] | null => {
    let q = false;
    for (let k = i; k < s.length; k++) {
      const c = s[k]!;
      if (c === '"') { q = !q; continue; }
      if (!q && s.startsWith(closer, k)) return [s.slice(i, k), k + closer.length];
    }
    return null;
  };

  const cleanText = (raw: string, line: number): string => {
    let t = raw.trim();
    if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') t = t.slice(1, -1);
    t = stripTags(t);
    // a leading/trailing newline from <br/> is noise
    return b.label(line, t.split("\n").map((x) => squash(x)).join("\n").trim());
  };

  /** one node reference: id, optional shape + text, optional :::class. Returns [key, nextIndex] or null on a syntax error */
  const nodeRef = (s: string, start: number, line: number): [string, number] | null => {
    let i = start;
    while (i < s.length && isWs(s.charCodeAt(i))) i++;
    const idStart = i;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (isIdChar(c)) { i++; continue; }
      if (c === 45 /* - */ && i > idStart && i + 1 < s.length && isIdChar(s.charCodeAt(i + 1))) { i++; continue; }
      break;
    }
    const id = s.slice(idStart, i);
    if (!id) { b.fail(line, `expected a node name at "${s.slice(idStart, idStart + 12)}"`); return null; }
    let shape: ShapeName | undefined, text: string | undefined;
    const c = s[i];
    const take = (closer: string, open: number, sh: ShapeName): boolean => {
      const r = until(s, i + open, closer);
      if (!r) { b.fail(line, `unterminated "${s.slice(i, i + open)}" — expected "${closer}"`); return false; }
      shape = sh; text = cleanText(r[0], line); i = r[1];
      return true;
    };
    if (c === "[") {
      const n = s[i + 1];
      if (n === "(") { if (!take(")]", 2, "cylinder")) return null; }
      else if (n === "[") { if (!take("]]", 2, "box")) return null; }
      else if (n === "/" || n === "\\") {
        const r = until(s, i + 2, n === "/" ? "/]" : "\\]") ?? until(s, i + 2, n === "/" ? "\\]" : "/]");
        if (!r) { b.fail(line, `unterminated "[${n}"`); return null; }
        shape = "parallelogram"; text = cleanText(r[0], line); i = r[1];
      } else if (!take("]", 1, "box")) return null;
    } else if (c === "(") {
      const n = s[i + 1];
      if (n === "(") { if (!take("))", 2, "ellipse")) return null; }
      else if (n === "[") { if (!take("])", 2, "round")) return null; }
      else if (!take(")", 1, "round")) return null;
    } else if (c === "{") {
      if (s[i + 1] === "{") { if (!take("}}", 2, "hexagon")) return null; }
      else if (!take("}", 1, "diamond")) return null;
    } else if (c === ">" ) {
      if (!take("]", 1, "box")) return null;
    }
    if (s.startsWith(":::", i)) {
      i += 3; while (i < s.length && isIdChar(s.charCodeAt(i))) i++;
      warnOnce(line, "class styling (:::name) is ignored");
    }
    const key = b.node(id, text && text.length ? text : id, line, cur());
    if (!key) return null;
    if (shape !== undefined || text !== undefined) b.define(key, { ...(shape ? { shape } : {}), ...(text !== undefined && text.length ? { label: text } : {}) }, line);
    return [key, i];
  };

  const refGroup = (s: string, start: number, line: number): [string[], number] | null => {
    const keys: string[] = [];
    let i = start;
    for (;;) {
      const r = nodeRef(s, i, line);
      if (!r) return null;
      keys.push(r[0]); i = r[1];
      let j = i;
      while (j < s.length && isWs(s.charCodeAt(j))) j++;
      if (s[j] === "&") { i = j + 1; continue; }
      return [keys, i];
    }
  };

  /** an operator at s[i]; null when there is none. Returns [op, indexAfter] */
  const readOp = (s: string, start: number, line: number): [MOp, number] | null | "error" => {
    let i = start;
    while (i < s.length && isWs(s.charCodeAt(i))) i++;
    if (i >= s.length) return null;
    let bidir = false;
    if (s[i] === "<") { bidir = true; i++; }
    const isShaft = (c: string | undefined): boolean => c === "-" || c === "=" || c === ".";
    if (!isShaft(s[i])) return bidir ? (b.fail(line, `expected "-->" after "<"`), "error") : null;
    let j = i;
    while (isShaft(s[j])) j++;
    const shaft = s.slice(i, j);
    let dashed = shaft.indexOf(".") >= 0;
    let label = "";
    let end = j;
    const nx = s[j];
    if (nx === ">") { end = j + 1; }
    else if ((nx === "x" || nx === "o") && shaft.length >= 2 && (j + 1 >= s.length || isWs(s.charCodeAt(j + 1)) || s[j + 1] === ";")) { end = j + 1; warnOnce(line, "x / o arrow heads are drawn as plain arrows"); }
    else if (shaft.length === 2 && isWs(s.charCodeAt(j))) {
      // "-- text -->"  /  "-. text .->"  /  "== text ==>"
      let k = j, found = -1, foundEnd = -1;
      while (k < s.length) {
        if (isShaft(s[k]) && (isWs(s.charCodeAt(k - 1)) || k === j)) {
          let m = k; while (isShaft(s[m])) m++;
          if (m - k >= 2 || s[m] === ">") { if (s[m] === ">") { found = k; foundEnd = m + 1; } else if (m >= s.length || isWs(s.charCodeAt(m)) || s[m] === ";") { found = k; foundEnd = m; } if (found >= 0) break; }
          k = m;
        } else k++;
      }
      if (found < 0) { b.fail(line, `a link label "${shaft} … " never reaches its arrow`); return "error"; }
      label = cleanText(s.slice(j, found), line);
      const term = s.slice(found, foundEnd);
      if (term.indexOf(".") >= 0) dashed = true;
      end = foundEnd;
    } else if (shaft.length < 3) {
      return bidir ? (b.fail(line, "incomplete arrow"), "error") : (b.fail(line, `"${shaft}" is not an arrow — use -->, --- , -.-> or ==>`), "error");
    } else end = j; // "---", "===", "-.-": a line with no head
    if (bidir) warnOnce(line, "bidirectional arrows are drawn one-way");
    // |label|
    let p = end;
    while (p < s.length && isWs(s.charCodeAt(p))) p++;
    if (s[p] === "|") {
      const r = until(s, p + 1, "|");
      if (!r) { b.fail(line, 'unterminated link label |…|'); return "error"; }
      label = cleanText(r[0], line); end = r[1];
    }
    return [{ dashed, label }, end];
  };

  const statement = (s: string, line: number): void => {
    const t = s.trim();
    if (!t || b.stopped) return;
    const w = firstWord(t).toLowerCase();
    if (w === "subgraph") {
      const rest = t.slice(8).trim();
      let id: string, name: string;
      const br = rest.indexOf("[");
      if (br > 0 && rest[rest.length - 1] === "]") { id = squash(unquote(rest.slice(0, br))); name = cleanText(rest.slice(br + 1, -1), line); }
      else { id = squash(unquote(rest)); name = id; }
      if (!id) { b.fail(line, "a subgraph needs a name"); return; }
      const key = b.group(id, name || id, cur(), line);
      if (key) stack.push({ key, line });
      return;
    }
    if (w === "end") { if (stack.length) stack.pop(); else b.fail(line, '"end" with no open subgraph'); return; }
    if (w === "direction") { setDirection(t.slice(9).trim(), line); return; }
    if (UNSUPPORTED_STMT.has(w)) { warnOnce(line, `"${w}" lines are not supported and were ignored`); return; }
    const r = refGroup(t, 0, line);
    if (!r) return;
    let [from, i] = r;
    for (;;) {
      const op = readOp(t, i, line);
      if (op === null) break;
      if (op === "error") return;
      const nr = refGroup(t, op[1], line);
      if (!nr) return;
      for (const a of from) for (const z of nr[0]) { b.edge(a, z, op[0].label, op[0].dashed, line); if (b.stopped) return; }
      from = nr[0]; i = nr[1];
    }
    let k = i; while (k < t.length && isWs(t.charCodeAt(k))) k++;
    if (k < t.length) b.fail(line, `unexpected "${t.slice(k, k + 14)}"`);
  };

  for (let li = 0; li < lines.length && !b.stopped; li++) {
    const line = li + 1;
    const raw = lines[li]!.trim();
    if (!raw || raw.startsWith("%%")) continue;
    const pieces = splitUnquoted(raw, ";");
    if (!headerSeen) {
      headerSeen = true;
      setDirection(squash(pieces[0]!).split(" ")[1] ?? "", line);
      pieces.shift();
    }
    for (const st of pieces) statement(st, line);
  }
  if (!b.stopped) for (const g of stack) b.fail(g.line, `subgraph "${b.groupName(g.key)}" is never closed with "end"`);
  if (!b.nodes.length && !b.errors.length) b.fail(1, "the flowchart has no nodes");
  return b.done("mermaid", direction);
}
