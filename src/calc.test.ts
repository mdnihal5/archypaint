import { describe, expect, it } from "vitest";
import { evalCalc, formatQuantity, MAX_DEPTH, MAX_LINES, MAX_LINE_CHARS, SAMPLE } from "./calc";

/** value of the last line of a note */
const last = (src: string) => { const r = evalCalc(src); return r[r.length - 1]!; };
const val = (src: string) => last(src).value;
const txt = (src: string) => last(src).text;
const err = (src: string) => last(src).err;

describe("numbers and suffixes", () => {
  it("plain, decimal and exponent forms", () => {
    expect(val("1")).toBe(1);
    expect(val("1.5")).toBe(1.5);
    expect(val(".5")).toBe(0.5);
    expect(val("1e3")).toBe(1000);
    expect(val("2.5E-2")).toBe(0.025);
    expect(val("1e+2")).toBe(100);
  });
  it("magnitude suffixes k m b t, case-insensitive", () => {
    expect(val("3k")).toBe(3000);
    expect(val("10M")).toBe(10e6);
    expect(val("1.5B")).toBe(1.5e9);
    expect(val("2t")).toBe(2e12);
    expect(val("1e3K")).toBe(1e6);
  });
  it("byte suffixes are decimal and carry the byte dimension", () => {
    expect(val("2KB")).toBe(2000);
    expect(txt("2KB")).toBe("2 KB");
    expect(txt("1.5gb")).toBe("1.5 GB");
    expect(txt("3PB")).toBe("3 PB");
    expect(txt("512 bytes".replace(" ", "*"))).toBe("512 B");
  });
  it("percent divides by 100", () => {
    expect(val("20%")).toBeCloseTo(0.2);
    expect(val("50% * 10")).toBe(5);
    expect(val("200 * 15%")).toBe(30);
    expect(val("10%%")).toBeCloseTo(0.001);
  });
  it("unknown units are errors, not silent zeros", () => {
    expect(err("5xyz")).toMatch(/unknown unit/);
    expect(err("5e")).toMatch(/unknown unit/);
  });
});

describe("operators and precedence", () => {
  it("* and / bind tighter than + and -", () => {
    expect(val("2 + 3 * 4")).toBe(14);
    expect(val("10 - 4 / 2")).toBe(8);
    expect(val("(2 + 3) * 4")).toBe(20);
  });
  it("left-associative - and /, right-associative ^", () => {
    expect(val("10 - 3 - 2")).toBe(5);
    expect(val("100 / 10 / 5")).toBe(2);
    expect(val("2 ^ 3 ^ 2")).toBe(512);
    expect(val("-2 ^ 2")).toBe(-4); // unary minus applies to the power, like written maths
    expect(val("2 ^ -1")).toBe(0.5);
  });
  it("unary signs stack", () => {
    expect(val("--5")).toBe(5);
    expect(val("+-+5")).toBe(-5);
    expect(val("3 - -2")).toBe(5);
  });
  it("× and ÷ are accepted", () => {
    expect(val("6 × 7")).toBe(42);
    expect(val("84 ÷ 2")).toBe(42);
  });
  it("whitespace is free", () => {
    expect(val("  2*   3\t+1 ")).toBe(7);
  });
});

describe("named values, references and constants", () => {
  it("later lines see earlier ones; names are case-insensitive", () => {
    const r = evalCalc("A = 4\nb = a * 2\nB + 1");
    expect(r.map((x) => x.value)).toEqual([4, 8, 9]);
  });
  it("a line may reference a LATER line", () => {
    const r = evalCalc("total = part * 2\npart = 21");
    expect(r[0]!.value).toBe(42);
    expect(r[1]!.value).toBe(21);
  });
  it("time constants are seconds, and make rates", () => {
    expect(val("day")).toBe(86400);
    expect(val("2 * hour")).toBe(7200);
    expect(val("week / day")).toBe(7);
    expect(txt("10M / day")).toBe("115.7 /s");
    expect(txt("3 * day")).toBe("3 days");
  });
  it("the sample note evaluates without errors", () => {
    const r = evalCalc(SAMPLE);
    expect(r.filter((x) => x.kind === "line").every((x) => x.err === "")).toBe(true);
    const by = Object.fromEntries(r.filter((x) => x.name).map((x) => [x.name, x.text]));
    expect(by.dau).toBe("10 M");
    expect(by.storage_per_day).toBe("400 GB");
    expect(by.peak).toMatch(/\/s$/);
  });
  it("comments and blanks are rows that carry no value", () => {
    const r = evalCalc("# title\n\nx = 1");
    expect(r.map((x) => x.kind)).toEqual(["comment", "blank", "line"]);
    expect(r[0]!.expr).toBe("title");
  });
  it("a bare expression is shown without a name", () => {
    const r = last("2 * 3");
    expect(r.name).toBe("");
    expect(r.value).toBe(6);
  });
  it("reserved names cannot be redefined, duplicates are flagged", () => {
    expect(err("day = 3")).toMatch(/reserved/);
    expect(err("max = 3")).toMatch(/reserved/);
    const r = evalCalc("a = 1\na = 2");
    expect(r[1]!.err).toMatch(/already defined/);
    expect(r[0]!.value).toBe(1);
  });
  it("unknown names are errors naming the culprit", () => {
    expect(err("x = y + 1")).toMatch(/unknown "y"/);
  });
});

describe("dimensions (bytes, seconds)", () => {
  it("bytes scale and print with units", () => {
    expect(txt("2KB * 1M")).toBe("2 GB");
    expect(txt("4GB / 86400")).toBe("46.3 KB");
    expect(txt("4GB / day")).toBe("46.3 KB/s");
    expect(txt("500 * 2KB")).toBe("1 MB");
  });
  it("adding different dimensions is an error", () => {
    expect(err("2KB + 3")).toBe("unit mismatch");
    expect(err("1 + day")).toBe("unit mismatch");
    expect(val("2KB + 3KB")).toBe(5000);
  });
  it("dimensions cancel and combine", () => {
    expect(txt("2KB / 1KB")).toBe("2");
    expect(txt("(1KB * 1KB) / 1KB")).toBe("1 KB");
    expect(txt("1KB ^ 2")).toMatch(/B\^2/);
    expect(err("2 ^ 1KB")).toMatch(/plain number/);
    expect(err("1KB ^ 0.5")).toMatch(/whole/);
  });
  it("formatQuantity covers counts, K/M/B/T and tiny values", () => {
    expect(formatQuantity({ v: 12, b: 0, s: 0 })).toBe("12");
    expect(formatQuantity({ v: 1234, b: 0, s: 0 })).toBe("1.23 K");
    expect(formatQuantity({ v: 1.5e6, b: 0, s: 0 })).toBe("1.5 M");
    expect(formatQuantity({ v: 7.2e9, b: 0, s: 0 })).toBe("7.2 B");
    expect(formatQuantity({ v: 3e12, b: 0, s: 0 })).toBe("3 T");
    expect(formatQuantity({ v: 0.000001, b: 0, s: 0 })).toMatch(/^1e-6|0\.000001$/);
    expect(formatQuantity({ v: 1e-9, b: 0, s: 0 })).toBe("1.00e-9");
    expect(formatQuantity({ v: 0, b: 0, s: 0 })).toBe("0");
    expect(formatQuantity({ v: -2500, b: 0, s: 0 })).toBe("-2.5 K");
    expect(formatQuantity({ v: 999, b: 1, s: 0 })).toBe("999 B");
  });
});

describe("functions", () => {
  it("min / max / ceil / floor / round / abs", () => {
    expect(val("min(3, 1, 2)")).toBe(1);
    expect(val("max(3, 1, 2)")).toBe(3);
    expect(val("ceil(2.1)")).toBe(3);
    expect(val("floor(2.9)")).toBe(2);
    expect(val("round(2.5)")).toBe(3);
    expect(val("abs(-4)")).toBe(4);
  });
  it("log2 / log10 / sqrt", () => {
    expect(val("log2(1024)")).toBe(10);
    expect(val("log10(1000)")).toBeCloseTo(3);
    expect(val("sqrt(144)")).toBe(12);
    expect(txt("sqrt(4KB * 1KB)")).toMatch(/B/);
  });
  it("min as a function versus the minute constant", () => {
    expect(val("min(5, 2)")).toBe(2);
    expect(val("min")).toBe(60);
    expect(val("2 * min")).toBe(120);
  });
  it("errors: arity, domain, units, missing paren", () => {
    expect(err("min()")).toMatch(/needs a value/);
    expect(err("ceil(1, 2)")).toMatch(/one value/);
    expect(err("log2(0)")).toMatch(/non-positive/);
    expect(err("log10(-3)")).toMatch(/non-positive/);
    expect(err("sqrt(-1)")).toMatch(/negative/);
    expect(err("sqrt(2KB)")).toMatch(/cannot be square-rooted/);
    expect(err("log2(1KB)")).toMatch(/plain number/);
    expect(err("max(1KB, 2)")).toBe("unit mismatch");
    expect(err("max(1, 2")).toMatch(/missing \)/);
    expect(err("ceil")).toMatch(/needs \( \)/);
    expect(err("min(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17)")).toMatch(/too many arguments/);
  });
});

describe("errors and numeric edge cases", () => {
  it("divide by zero, overflow and NaN never produce a value", () => {
    expect(err("1 / 0")).toBe("divide by zero");
    expect(err("1e308 * 10")).toBe("too large");
    expect(err("10 ^ 400")).toMatch(/too large|exponent/);
    expect(err("0 ^ -1")).toBe("too large");
    expect(err("(0 - 1) ^ 0.5")).toBe("not a number");
    expect(err("1e999")).toMatch(/too large/);
    expect(err("1e308 + 1e308")).toBe("too large");
  });
  it("denormals and tiny results print in exponent form without crashing", () => {
    const r = last("x = 1e-300 * 1e-20");
    expect(r.err).toBe("");
    expect(r.text).toMatch(/e-/);
    expect(last("5e-324 / 2").err).toBe("");
  });
  it("syntax errors are reported, not thrown", () => {
    for (const bad of ["1 +", "* 2", "(1", "1)", "1 2", "a b", "1 + + +", "@", "x = ", "1 = 2", "a = b = 3", ",", "()"]) {
      expect(() => evalCalc(bad)).not.toThrow();
      expect(last(bad).value).toBeNull();
      expect(last(bad).err).not.toBe("");
    }
  });
  it("one bad line does not break the others", () => {
    const r = evalCalc("a = 1\nb = oops\nc = a + 1");
    expect(r.map((x) => x.value)).toEqual([1, null, 2]);
    expect(r[1]!.err).toMatch(/unknown/);
  });
  it("a line that depends on a bad line says so", () => {
    const r = evalCalc("a = 1 / 0\nb = a + 1");
    expect(r[1]!.err).toMatch(/depends on a bad line/);
  });
});

describe("cycles", () => {
  it("self reference", () => { expect(err("a = a + 1")).toBe("circular reference"); });
  it("two- and three-line cycles mark every member", () => {
    expect(evalCalc("a = b\nb = a").map((x) => x.err)).toEqual(["circular reference", "circular reference"]);
    expect(evalCalc("a = b\nb = c\nc = a").every((x) => x.err === "circular reference")).toBe(true);
  });
  it("a line outside the cycle that uses it is an error too, but unrelated lines survive", () => {
    const r = evalCalc("a = b\nb = a\nc = a\nd = 5");
    expect(r[2]!.err).not.toBe("");
    expect(r[3]!.value).toBe(5);
  });
  it("a long dependency chain evaluates (no stack problems at the line limit)", () => {
    const lines = ["v0 = 1"];
    for (let i = 1; i < MAX_LINES; i++) lines.push(`v${i} = v${i - 1} + 1`);
    expect(evalCalc(lines.join("\n")).at(-1)!.value).toBe(MAX_LINES);
    const rev = lines.slice().reverse(); // worst case: every line references a line below it
    expect(evalCalc(rev.join("\n"))[0]!.value).toBe(MAX_LINES);
  });
});

describe("limits and hostile input", () => {
  it("nesting deeper than MAX_DEPTH is an error, at MAX_DEPTH - 2 it works", () => {
    const nest = (n: number) => "(".repeat(n) + "1" + ")".repeat(n);
    expect(val(nest(MAX_DEPTH - 2))).toBe(1);
    expect(err(nest(MAX_DEPTH + 10))).toMatch(/deeply nested/);
    expect(err("-".repeat(100) + "1")).toMatch(/deeply nested/);
    expect(err("2" + "^2".repeat(60))).toMatch(/deeply nested/);
    expect(err("max(".repeat(30) + "1" + ")".repeat(30))).toMatch(/deeply nested/);
  });
  it("line length and token count are capped", () => {
    expect(err("x = " + "1+".repeat(MAX_LINE_CHARS) + "1")).toMatch(/too long/);
    expect(err("1" + "+1".repeat(300))).toMatch(/too long/); // > 400 tokens but < 200 chars is impossible; still bounded
  });
  it("only the first MAX_LINES lines count", () => {
    const src = Array.from({ length: MAX_LINES + 10 }, (_, i) => `a${i} = ${i}`).join("\n");
    const r = evalCalc(src);
    expect(r.length).toBe(MAX_LINES + 1);
    expect(r.at(-1)!.err).toMatch(/only the first/);
  });
  it("100k characters of garbage finishes quickly and never throws", () => {
    const t0 = performance.now();
    for (const junk of ["(".repeat(100_000), "9".repeat(100_000), "a".repeat(100_000), "+-*/^".repeat(20_000), "1+".repeat(50_000), "\n".repeat(100_000), "x=1\n".repeat(25_000), "\u0000￿💥".repeat(10_000)]) {
      expect(() => evalCalc(junk)).not.toThrow();
    }
    expect(performance.now() - t0).toBeLessThan(500);
  });
  it("random printable junk never throws", () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const alphabet = "0123456789.+-*/^()%,=_ abcxyzkmbtdayKBMB#\n";
    for (let k = 0; k < 500; k++) {
      let s = "";
      for (let i = 0, n = Math.floor(rnd() * 120); i < n; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      expect(() => evalCalc(s)).not.toThrow();
    }
  });
  it("prototype-pollution style names are just unknown names", () => {
    expect(err("__proto__ + 1")).toMatch(/unknown/);
    expect(err("constructor")).toMatch(/unknown/);
    expect(err("toString")).toMatch(/unknown/);
    expect(err("5constructor")).toMatch(/unknown unit/);
    expect(err("hasOwnProperty = 1")).toBe("");
    const r = evalCalc("__proto__ = 5\nx = __proto__ + 1");
    expect(r[1]!.value).toBe(6);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("evaluation is deterministic", () => {
    expect(evalCalc(SAMPLE)).toEqual(evalCalc(SAMPLE));
  });
});
