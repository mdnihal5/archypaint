import type { ElJSON } from "../scene";

export function el(p: Partial<ElJSON> & { id: string }): ElJSON {
  return {
    kind: "rect", x: 0, y: 0, w: 100, h: 60, z: 1, version: 1, cat: 0, fill: 1, radius: 8, text: "", edge: 1, groupIds: [], iconId: "", locked: false, n: 0, o: 0,
    src: "", dst: "", sp: -1, dp: -1, route: 1, dash: 0, head: 1, pts: [], ...p,
  };
}

const ENT = /&(?!(?:amp|lt|gt|quot|#39);)/;
/** minimal well-formedness check for the SVG we generate: balanced tags, quoted attributes, escaped text. Returns an error or null. */
export function wellFormed(xml: string): string | null {
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/y;
  let i = 0;
  while (i < xml.length) {
    if (xml[i] === "<") {
      tag.lastIndex = i;
      const m = tag.exec(xml);
      if (!m) return `bad tag at ${i}: ${xml.slice(i, i + 60)}`;
      const [whole, close, name, , self] = m;
      if (close) { if (stack.pop() !== name) return `mismatched </${name}> at ${i}`; }
      else if (!self) stack.push(name!);
      i += whole.length;
    } else {
      const j = xml.indexOf("<", i);
      const text = xml.slice(i, j < 0 ? xml.length : j);
      if (ENT.test(text)) return `unescaped & near ${i}`;
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return "control character in text";
      i = j < 0 ? xml.length : j;
    }
  }
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : null;
}
