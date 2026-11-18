/** The markdown subset: headings (#, ##, ###), bullets, numbered lines, **bold**, `code`, fenced code. Anything else is plain text as written. */
export type Block =
  | { k: "h"; level: 1 | 2 | 3; text: string }
  | { k: "li"; text: string }
  | { k: "ol"; num: string; text: string }
  | { k: "p"; text: string }
  | { k: "blank" }
  | { k: "code"; lang: string; lines: string[] };

export function parse(src: string): Block[] {
  const out: Block[] = [];
  let code: { lang: string; lines: string[] } | null = null;
  for (const l of src.split("\n")) {
    if (code) {
      if (/^```\s*$/.test(l)) { out.push({ k: "code", ...code }); code = null; } else code.lines.push(l);
      continue;
    }
    let m: RegExpExecArray | null;
    if (l.startsWith("```")) code = { lang: l.slice(3).trim().split(/\s+/)[0]!.toLowerCase(), lines: [] };
    else if ((m = /^(#{1,3}) (.*)$/.exec(l))) out.push({ k: "h", level: m[1]!.length as 1 | 2 | 3, text: m[2]! });
    else if ((m = /^[-*] (.*)$/.exec(l))) out.push({ k: "li", text: m[1]! });
    else if ((m = /^(\d{1,9})\. (.*)$/.exec(l))) out.push({ k: "ol", num: m[1]!, text: m[2]! });
    else if (l.trim() === "") out.push({ k: "blank" });
    else out.push({ k: "p", text: l });
  }
  if (code) out.push({ k: "code", ...code }); // an unclosed fence runs to the end of the text, like most renderers
  return out;
}

export interface Span { t: string; k: "p" | "b" | "c" }
/** split a line into plain, **bold** and `code` spans (an unmatched marker stays literal) */
export function parseInline(s: string): Span[] {
  const out: Span[] = [];
  for (const p of s.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    if (!p) continue;
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) out.push({ t: p.slice(2, -2), k: "b" });
    else if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) out.push({ t: p.slice(1, -1), k: "c" });
    else out.push({ t: p, k: "p" });
  }
  return out;
}
