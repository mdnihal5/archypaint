/** A small language-agnostic highlighter for fenced code: comments, strings, numbers, keywords, calls. One shared keyword list for every language. */
export type Role = "ink" | "mid" | "kw" | "str" | "num" | "fn";
export type Tok = [text: string, role: Role];

const KW = new Set("func return if else for while range go def class import from let const var function async await new nil null true false None True False select insert update delete where and or not in is struct type interface package".split(" "));

/** which comment markers a fence tag allows: `i--` in JS or `this.#x` must not turn grey. No tag or an unknown tag allows all three. */
const MARKERS: Record<string, string> = { go: "\\/\\/", js: "\\/\\/", ts: "\\/\\/", javascript: "\\/\\/", typescript: "\\/\\/", py: "#", python: "#", sql: "--" };
const ALL = "\\/\\/|#|--";
const cache = new Map<string, RegExp>();
function regexFor(lang: string): RegExp {
  const m = MARKERS[lang] ?? ALL;
  let re = cache.get(m);
  if (!re) cache.set(m, re = new RegExp(`((?:${m}).*)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`[^\`]*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Za-z_]\\w*)\\b(?=\\s*\\()|\\b([A-Za-z_]\\w*)\\b|(\\s+|.)`, "g"));
  re.lastIndex = 0;
  return re;
}

export function tokens(line: string, lang = ""): Tok[] {
  const out: Tok[] = [], re = regexFor(lang);
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const role: Role = m[1] ? "mid" : m[2] ? "str" : m[3] ? "num" : m[4] ? (KW.has(m[4]) ? "kw" : "fn") : m[5] ? (KW.has(m[5]) ? "kw" : "ink") : "ink";
    const last = out[out.length - 1];
    if (last && last[1] === role && role !== "kw" && role !== "fn") last[0] += m[0]; else out.push([m[0], role]);
  }
  return out;
}
