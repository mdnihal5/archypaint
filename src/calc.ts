/**
 * Back-of-envelope calculator for capacity notes. Pure, no DOM, no eval / Function / regex parsing.
 *
 * A note is up to 40 lines:
 *     # comment
 *     dau = 10M
 *     qps = dau * reqs_per_user / 86400      (later lines may be referenced; cycles are errors)
 *     storage_per_day = qps * 86400 * 2KB
 *     peak = qps * 3
 *     dau * 20 / day                         (a bare expression is shown without a name)
 *
 * Numbers take magnitude suffixes k m b t (thousand, million, billion, trillion) and byte suffixes kb mb gb tb pb
 * (decimal, 1 KB = 1,000 B — the convention interview estimates use), a trailing % divides by 100, and the constants
 * sec min hour day week month year are seconds. Bytes and seconds are tracked as dimensions, so `2KB * 1M` prints
 * "2 GB", `4 GB / day` prints "46.3 KB/s" and `2KB + 3` is an error instead of a wrong number.
 *
 * Hostile input is bounded: <= 40 lines, <= 200 chars per line, <= 400 tokens per line, expression depth <= 32,
 * <= 64 function arguments in total, and every line is evaluated at most once (memoised, cycle-checked).
 */

export const MAX_LINES = 40;
export const MAX_LINE_CHARS = 200;
export const MAX_TOKENS = 400;
export const MAX_DEPTH = 32;

export interface CalcRow {
  /** "blank" and "comment" rows render dimmed / empty; "line" rows carry a value or an error */
  kind: "blank" | "comment" | "line";
  /** the variable name, or "" for a bare expression / comment */
  name: string;
  /** the source expression (or the comment text), trimmed */
  expr: string;
  /** formatted result, "" when there is an error */
  text: string;
  /** the numeric result, null when there is an error */
  value: number | null;
  /** short error message, "" when fine */
  err: string;
}

/** dimension exponents: bytes and seconds */
interface Q { v: number; b: number; s: number }
class CalcError extends Error {}
const fail = (m: string): never => { throw new CalcError(m); };

/* ---------------------------------------------------------------- tokenizer */

type Tok =
  | { t: "num"; q: Q }
  | { t: "id"; s: string }
  | { t: "op"; s: "+" | "-" | "*" | "/" | "^" | "(" | ")" | "," | "%" | "=" };

// Maps, not object literals: a plain object would resolve "constructor", "toString" or "__proto__" through Object.prototype
const MAG = new Map<string, number>(Object.entries({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }));
const BYTES = new Map<string, number>(Object.entries({ kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15 }));
const CONSTS = new Map<string, Q>(Object.entries({
  sec: { v: 1, b: 0, s: 1 }, second: { v: 1, b: 0, s: 1 }, seconds: { v: 1, b: 0, s: 1 },
  min: { v: 60, b: 0, s: 1 }, minute: { v: 60, b: 0, s: 1 },
  hour: { v: 3600, b: 0, s: 1 }, day: { v: 86400, b: 0, s: 1 }, week: { v: 604800, b: 0, s: 1 },
  month: { v: 2592000, b: 0, s: 1 }, year: { v: 31536000, b: 0, s: 1 },
  byte: { v: 1, b: 1, s: 0 }, bytes: { v: 1, b: 1, s: 0 },
  pi: { v: Math.PI, b: 0, s: 0 },
}));
const FUNCS = new Set(["min", "max", "ceil", "floor", "round", "abs", "log2", "log10", "sqrt"]);
// `min` is both a function and the minute constant: it is a function only when followed by "("
const isDigit = (c: number) => c >= 48 && c <= 57;
const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 32 || c === 9) { i++; continue; }
    if (out.length >= MAX_TOKENS) fail("expression too long");
    if (isDigit(c) || (c === 46 && i + 1 < n && isDigit(src.charCodeAt(i + 1)))) {
      let j = i;
      while (j < n && isDigit(src.charCodeAt(j))) j++;
      if (j < n && src.charCodeAt(j) === 46) { j++; while (j < n && isDigit(src.charCodeAt(j))) j++; }
      // exponent: e / E followed by digits or sign+digits (not a unit letter such as in "5e" alone)
      if (j < n && (src.charCodeAt(j) | 32) === 101) {
        let k = j + 1;
        if (k < n && (src.charCodeAt(k) === 43 || src.charCodeAt(k) === 45)) k++;
        if (k < n && isDigit(src.charCodeAt(k))) { while (k < n && isDigit(src.charCodeAt(k))) k++; j = k; }
      }
      let v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) fail("number too large");
      let b = 0;
      let k = j;
      while (k < n && isAlpha(src.charCodeAt(k))) k++;
      if (k > j) {
        const suf = src.slice(j, k).toLowerCase();
        const bm = BYTES.get(suf), mm = MAG.get(suf);
        if (bm !== undefined) { v *= bm; b = 1; }
        else if (mm !== undefined) v *= mm;
        else fail(`unknown unit "${src.slice(j, k)}"`);
        j = k;
      }
      if (!Number.isFinite(v)) fail("number too large");
      out.push({ t: "num", q: { v, b, s: 0 } });
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i + 1;
      while (j < n && (isAlpha(src.charCodeAt(j)) || isDigit(src.charCodeAt(j)))) j++;
      out.push({ t: "id", s: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    const ch = src[i]!;
    if ("+-*/^(),%=".includes(ch)) { out.push({ t: "op", s: ch as never }); i++; continue; }
    if (ch === "×") { out.push({ t: "op", s: "*" }); i++; continue; }
    if (ch === "÷") { out.push({ t: "op", s: "/" }); i++; continue; }
    fail(`unexpected "${ch.length === 1 && c < 128 ? ch : "?"}"`);
  }
  return out;
}

/* ---------------------------------------------------------------- dimensions and arithmetic */

const same = (a: Q, b: Q) => a.b === b.b && a.s === b.s;
const finite = (v: number): number => {
  if (Number.isNaN(v)) return fail("not a number");
  if (!Number.isFinite(v)) return fail("too large");
  return v;
};

function add(a: Q, b: Q, sign: 1 | -1): Q {
  if (!same(a, b)) fail("unit mismatch");
  return { v: finite(a.v + sign * b.v), b: a.b, s: a.s };
}
const mul = (a: Q, b: Q): Q => ({ v: finite(a.v * b.v), b: a.b + b.b, s: a.s + b.s });
function div(a: Q, b: Q): Q {
  if (b.v === 0) fail("divide by zero");
  return { v: finite(a.v / b.v), b: a.b - b.b, s: a.s - b.s };
}
function pow(a: Q, e: Q): Q {
  if (e.b || e.s) fail("exponent must be a plain number");
  if ((a.b || a.s) && !Number.isInteger(e.v)) fail("unit exponent must be whole");
  if (e.v > 1000 || e.v < -1000) fail("exponent too large");
  return { v: finite(Math.pow(a.v, e.v)), b: a.b * e.v, s: a.s * e.v };
}

/* ---------------------------------------------------------------- parser / evaluator */

interface Scope { lookup(name: string): Q }

/** recursive descent over the token array; evaluates while parsing (no AST) with a hard depth limit */
class Parser {
  private i = 0;
  private depth = 0;
  constructor(private toks: readonly Tok[], private scope: Scope) {}

  run(): Q {
    const q = this.expr();
    if (this.i < this.toks.length) fail("unexpected input");
    return q;
  }

  private peek(): Tok | undefined { return this.toks[this.i]; }
  private isOp(s: string): boolean { const t = this.toks[this.i]; return !!t && t.t === "op" && t.s === s; }
  private enter(): void { if (++this.depth > MAX_DEPTH) fail("expression too deeply nested"); }

  private expr(): Q {
    this.enter();
    let a = this.term();
    for (;;) {
      if (this.isOp("+")) { this.i++; a = add(a, this.term(), 1); }
      else if (this.isOp("-")) { this.i++; a = add(a, this.term(), -1); }
      else break;
    }
    this.depth--;
    return a;
  }

  private term(): Q {
    let a = this.unary();
    for (;;) {
      if (this.isOp("*")) { this.i++; a = mul(a, this.unary()); }
      else if (this.isOp("/")) { this.i++; a = div(a, this.unary()); }
      else break;
    }
    return a;
  }

  private unary(): Q {
    if (this.isOp("-")) { this.i++; this.enter(); const q = this.unary(); this.depth--; return { v: -q.v, b: q.b, s: q.s }; }
    if (this.isOp("+")) { this.i++; this.enter(); const q = this.unary(); this.depth--; return q; }
    return this.power();
  }

  private power(): Q {
    const base = this.postfix();
    if (this.isOp("^")) { this.i++; this.enter(); const e = this.unary(); this.depth--; return pow(base, e); }
    return base;
  }

  private postfix(): Q {
    let q = this.primary();
    while (this.isOp("%")) { this.i++; q = { v: q.v / 100, b: q.b, s: q.s }; }
    return q;
  }

  private primary(): Q {
    const t = this.toks[this.i];
    if (!t) return fail("unexpected end");
    if (t.t === "num") { this.i++; return t.q; }
    if (t.t === "op") {
      if (t.s === "(") {
        this.i++;
        const q = this.expr();
        if (!this.isOp(")")) fail("missing )");
        this.i++;
        return q;
      }
      return fail(`unexpected "${t.s}"`);
    }
    // identifier: function call, constant or named value
    this.i++;
    const next = this.peek();
    if (next && next.t === "op" && next.s === "(" && FUNCS.has(t.s)) { this.i++; return this.call(t.s); }
    if (FUNCS.has(t.s) && t.s !== "min") return fail(`${t.s} needs ( )`);
    return this.scope.lookup(t.s);
  }

  private call(name: string): Q {
    const args: Q[] = [];
    this.enter();
    if (!this.isOp(")")) {
      for (;;) {
        args.push(this.expr());
        if (args.length > 16) fail("too many arguments");
        if (this.isOp(",")) { this.i++; continue; }
        break;
      }
    }
    if (!this.isOp(")")) fail("missing )");
    this.i++;
    this.depth--;
    if (!args.length) fail(`${name} needs a value`);
    const a = args[0]!;
    switch (name) {
      case "min": case "max": {
        let r = a;
        for (let k = 1; k < args.length; k++) {
          const x = args[k]!;
          if (!same(r, x)) fail("unit mismatch");
          if (name === "min" ? x.v < r.v : x.v > r.v) r = x;
        }
        return r;
      }
      case "ceil": return one(args, (v) => Math.ceil(v), a);
      case "floor": return one(args, (v) => Math.floor(v), a);
      case "round": return one(args, (v) => Math.round(v), a);
      case "abs": return one(args, (v) => Math.abs(v), a);
      case "log2": case "log10": {
        one(args, (v) => v, a);
        if (a.b || a.s) fail("log needs a plain number");
        if (a.v <= 0) fail("log of a non-positive number");
        return { v: name === "log2" ? Math.log2(a.v) : Math.log10(a.v), b: 0, s: 0 };
      }
      default: { // sqrt
        one(args, (v) => v, a);
        if (a.v < 0) fail("sqrt of a negative number");
        if ((a.b % 2) || (a.s % 2)) fail("unit cannot be square-rooted");
        return { v: Math.sqrt(a.v), b: a.b / 2, s: a.s / 2 };
      }
    }
  }
}

function one(args: readonly Q[], f: (v: number) => number, a: Q): Q {
  if (args.length !== 1) fail("takes one value");
  return { v: finite(f(a.v)), b: a.b, s: a.s };
}

/* ---------------------------------------------------------------- formatting */

function sig(v: number, digits = 3): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a < 1e-6) return v.toExponential(2);
  if (a >= 100) return String(Math.round(v * 10) / 10 === Math.round(v) ? Math.round(v) : Math.round(v * 10) / 10);
  const s = v.toPrecision(digits);
  return s.includes("e") ? String(Number(s)) : String(Number(s));
}

function humanCount(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e15) return `${sig(v / 1e12, 4)} T`;
  if (a >= 1e12) return `${sig(v / 1e12)} T`;
  if (a >= 1e9) return `${sig(v / 1e9)} B`;
  if (a >= 1e6) return `${sig(v / 1e6)} M`;
  if (a >= 1e3) return `${sig(v / 1e3)} K`;
  return sig(v);
}

function humanBytes(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e15) return `${sig(v / 1e15)} PB`;
  if (a >= 1e12) return `${sig(v / 1e12)} TB`;
  if (a >= 1e9) return `${sig(v / 1e9)} GB`;
  if (a >= 1e6) return `${sig(v / 1e6)} MB`;
  if (a >= 1e3) return `${sig(v / 1e3)} KB`;
  return `${sig(v)} B`;
}

const sup = (n: number) => (n === 1 ? "" : `^${n}`);

/** format a quantity: counts get K/M/B/T, bytes get KB..PB, seconds^-1 become "/s" */
export function formatQuantity(q: { v: number; b: number; s: number }): string {
  const { v, b, s } = q;
  if (b === 0 && s === 0) return humanCount(v);
  if (b === 1 && s === 0) return humanBytes(v);
  if (b === 0 && s === -1) return `${humanCount(v)} /s`;
  if (b === 1 && s === -1) return `${humanBytes(v)}/s`;
  if (b === 0 && s === 1) return v >= 86400 && v % 86400 === 0 ? `${sig(v / 86400)} days` : v >= 3600 ? `${sig(v / 3600)} h` : `${sig(v)} s`;
  const parts: string[] = [];
  if (b) parts.push(`B${sup(b)}`);
  if (s) parts.push(`s${sup(s)}`);
  return `${sig(v)} ${parts.join("·")}`;
}

/* ---------------------------------------------------------------- whole-note evaluation */

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** split "name = expr" (a single top-level "=" after a valid name) from a bare expression */
function splitLine(line: string): { name: string; expr: string } {
  const eq = line.indexOf("=");
  if (eq > 0) {
    const name = line.slice(0, eq).trim();
    if (NAME.test(name)) return { name: name.toLowerCase(), expr: line.slice(eq + 1).trim() };
  }
  return { name: "", expr: line.trim() };
}

/** Evaluate a capacity note. Never throws; every line yields a row. */
export function evalCalc(text: string): CalcRow[] {
  const raw = text.length > MAX_LINES * (MAX_LINE_CHARS + 1) ? text.slice(0, MAX_LINES * (MAX_LINE_CHARS + 1)) : text;
  const lines = raw.split("\n");
  const rows: CalcRow[] = [];
  const defs = new Map<string, number>(); // name -> line index
  const parsed: Array<{ name: string; expr: string; toks: Tok[] | null; err: string } | null> = [];

  for (let li = 0; li < lines.length && li < MAX_LINES; li++) {
    const line = lines[li]!;
    const trimmed = line.trim();
    if (!trimmed) { parsed.push(null); rows.push({ kind: "blank", name: "", expr: "", text: "", value: null, err: "" }); continue; }
    if (trimmed[0] === "#") { parsed.push(null); rows.push({ kind: "comment", name: "", expr: trimmed.replace(/^#+\s*/, ""), text: "", value: null, err: "" }); continue; }
    const { name, expr } = splitLine(line);
    let toks: Tok[] | null = null, err = "";
    if (line.length > MAX_LINE_CHARS) err = "line too long";
    else if (name && (CONSTS.has(name) || FUNCS.has(name))) err = `"${name}" is reserved`;
    else if (name && defs.has(name)) err = `"${name}" is already defined`;
    else {
      try { toks = tokenize(expr); if (!toks.length) err = "empty"; }
      catch (e) { err = e instanceof CalcError ? e.message : "bad expression"; }
    }
    if (name && !defs.has(name) && !err) defs.set(name, parsed.length);
    parsed.push({ name, expr, toks, err });
    rows.push({ kind: "line", name, expr: trimmed, text: "", value: null, err: "" });
  }
  if (lines.length > MAX_LINES) rows.push({ kind: "line", name: "", expr: "", text: "", value: null, err: `only the first ${MAX_LINES} lines count` });

  // memoised, cycle-checked evaluation of named lines
  const memo = new Map<number, Q | string>(); // Q on success, string error message
  const active = new Set<number>();
  const evalAt = (idx: number): Q => {
    const hit = memo.get(idx);
    if (hit !== undefined) { if (typeof hit === "string") return fail(hit); return hit; }
    const p = parsed[idx]!;
    if (p.err || !p.toks) { memo.set(idx, p.err || "empty"); return fail(p.err || "empty"); }
    if (active.has(idx)) return fail("circular reference");
    active.add(idx);
    try {
      const q = new Parser(p.toks, {
        lookup: (n) => {
          const c = CONSTS.get(n);
          if (c) return c;
          const at = defs.get(n);
          if (at === undefined) return fail(`unknown "${n}"`);
          try { return evalAt(at); } catch (e) { return fail(e instanceof CalcError && e.message === "circular reference" ? "circular reference" : `depends on a bad line (${n})`); }
        },
      }).run();
      memo.set(idx, q);
      return q;
    } catch (e) {
      const m = e instanceof CalcError ? e.message : e instanceof RangeError ? "expression too deeply nested" : "bad expression";
      memo.set(idx, m);
      return fail(m);
    } finally { active.delete(idx); }
  };

  for (let li = 0; li < parsed.length; li++) {
    const p = parsed[li];
    if (!p) continue;
    const row = rows[li]!;
    try { const q = evalAt(li); row.value = q.v; row.text = formatQuantity(q); }
    catch (e) { row.err = e instanceof CalcError ? e.message : "bad expression"; }
  }
  return rows;
}

export { SAMPLE } from "./calc-view";
