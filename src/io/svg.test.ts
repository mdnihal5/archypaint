import { describe, expect, it } from "vitest";
import { LIGHT } from "../theme";
import { arrowHead, arrowPathD, buildSvg, elBounds, esc, planExport, unionBounds, EXPORT_LIMITS } from "./svg";
import { el, wellFormed } from "./testkit";
import { basename } from "./file-names";

const noIcons = () => null;
const opts = { background: true, padding: 24, icons: noIcons };

describe("SVG export", () => {
  const scene = [
    el({ id: "a", kind: "rect", x: 0, y: 0, w: 120, h: 70, text: "api <gateway> & \"co\"", cat: 3, z: 1 }),
    el({ id: "b", kind: "ellipse", x: 200, y: 0, w: 100, h: 70, text: "db", cat: 0, fill: 2, z: 2 }),
    el({ id: "c", kind: "diamond", x: 100, y: 120, w: 90, h: 90, cat: 1, fill: 0, z: 3 }),
    el({ id: "d", kind: "text", x: 300, y: 200, w: 80, h: 20, text: "multi\nline", z: 4 }),
    el({ id: "e", kind: "arrow", x: 120, y: 35, w: 80, h: 0, pts: [120, 35, 160, 35, 160, 35, 200, 35], src: "a", dst: "b", head: 1, dash: 1, text: "HTTP", z: 5 }),
    el({ id: "f", kind: "arrow", x: 0, y: 0, w: 10, h: 10, pts: [], head: 2, route: 0, z: 6 }),
    el({ id: "g", kind: "icon", x: 20, y: 240, w: 96, h: 96, iconId: "sql-database", text: "orders", z: 7 }),
    el({ id: "h", kind: "icon", x: 140, y: 240, w: 30, h: 30, iconId: "cache", z: 8 }),
  ];

  it("is well-formed XML with escaped text and no external references", () => {
    const svg = buildSvg(scene, LIGHT, { ...opts, icons: (id, tier) => `<rect x="1" y="1" width="9" height="9" stroke="currentColor" fill="none" data-t="${tier}${id}"/>` });
    expect(wellFormed(svg)).toBeNull();
    expect(svg).toContain("&lt;gateway&gt; &amp; &quot;co&quot;");
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toMatch(/<script|<image|<foreignObject/i);
  });

  it("inlines each used icon once per tier, chooses the tier by size, and colours via `color`", () => {
    const svg = buildSvg(scene, LIGHT, { ...opts, icons: () => `<path d="M0 0L9 9" stroke="currentColor"/>` });
    expect(svg.match(/<symbol /g)!.length).toBe(2);
    expect(svg).toContain('id="ap-ic-sql-database-detail"');
    expect(svg).toContain('id="ap-ic-cache-glyph"');
    expect(svg).toMatch(/<use href="#ap-ic-sql-database-detail"[^>]* color="#/);
  });

  it("falls back to a labelled tile when an icon is unknown, and rejects unsafe icon markup", () => {
    const missing = buildSvg([scene[6]!], LIGHT, opts);
    expect(missing).toContain("sql-database");
    expect(wellFormed(missing)).toBeNull();
    for (const evil of ['<script>alert(1)</script>', '<path onload="x()" d="M0 0"/>', '<use href="http://evil/x.svg#a"/>', '<foreignObject/>']) {
      const svg = buildSvg([scene[6]!], LIGHT, { ...opts, icons: () => evil });
      expect(svg).not.toContain(evil);
      expect(wellFormed(svg)).toBeNull();
    }
  });

  it("strips characters that are illegal in XML", () => {
    const svg = buildSvg([el({ id: "x", text: "a\u0001b\u0008c\uD800d", z: 1 })], LIGHT, opts);
    expect(wellFormed(svg)).toBeNull();
    expect(svg).toContain("abcd");
  });

  it("omits the background when asked, and copes with an empty scene", () => {
    expect(buildSvg(scene, LIGHT, { ...opts, background: false })).not.toContain(`fill="${LIGHT.paper}"/>`);
    expect(wellFormed(buildSvg([], LIGHT, opts))).toBeNull();
  });

  it("escape() covers markup characters", () => { expect(esc(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;"); });
});

describe("arrows", () => {
  it("rounds elbow corners, keeps sharp corners sharp, smooths curves", () => {
    const pts = [0, 0, 100, 0, 100, 100];
    const round = arrowPathD(el({ id: "a", kind: "arrow", pts, route: 1, edge: 1 }));
    const sharp = arrowPathD(el({ id: "a", kind: "arrow", pts, route: 1, edge: 0 }));
    const curve = arrowPathD(el({ id: "a", kind: "arrow", pts, route: 2 }));
    expect(round).toContain("Q"); expect(sharp).not.toContain("Q"); expect(curve).toContain("Q");
    expect(arrowPathD(el({ id: "a", kind: "arrow", pts: [0, 0, 50, 20], route: 2 }))).toContain("C");
  });
  it("head geometry: chevron follows the last segment, dot sits on the tip, none draws nothing", () => {
    expect(arrowHead(el({ id: "a", kind: "arrow", pts: [0, 0, 100, 0], head: 1 })).chevron).toMatch(/^M/);
    expect(arrowHead(el({ id: "a", kind: "arrow", pts: [0, 0, 100, 0], head: 2 })).dot).toMatchObject({ x: 100, y: 0 });
    expect(arrowHead(el({ id: "a", kind: "arrow", pts: [0, 0, 100, 0], head: 0 }))).toEqual({});
  });
  it("a zero-length final segment does not produce NaN", () => {
    const h = arrowHead(el({ id: "a", kind: "arrow", pts: [0, 0, 50, 0, 50, 0], head: 1 }));
    expect(h.chevron).not.toMatch(/NaN/);
  });
  it("bounds include the arrow's routed points, not just its box", () => {
    const b = elBounds(el({ id: "a", kind: "arrow", x: 0, y: 0, w: 10, h: 10, pts: [0, 0, 500, -40] }));
    expect(b).toEqual({ x: 0, y: -40, w: 500, h: 50 });
    expect(unionBounds([])).toBeNull();
  });
});

describe("planExport: size guards", () => {
  it("passes small drawings through untouched", () => {
    const p = planExport({ x: 0, y: 0, w: 800, h: 600 }, 2, 24);
    expect(p).toMatchObject({ ok: true, scaledDown: false, scale: 2, width: 1696, height: 1296 });
  });
  it("scales down (and says so) past the side limit", () => {
    const p = planExport({ x: 0, y: 0, w: 20000, h: 500 }, 3, 0);
    expect(p.ok && p.scaledDown).toBe(true);
    if (p.ok) expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(EXPORT_LIMITS.maxSide);
  });
  it("scales down past the megapixel limit", () => {
    const p = planExport({ x: 0, y: 0, w: 15000, h: 15000 }, 1, 0);
    expect(p.ok && p.scaledDown).toBe(true);
    if (p.ok) expect(p.width * p.height).toBeLessThanOrEqual(EXPORT_LIMITS.maxPixels);
  });
  it("refuses with a clear message when the drawing is absurdly large", () => {
    const p = planExport({ x: 0, y: 0, w: 5e6, h: 5e6 }, 1, 0);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.message).toMatch(/SVG/);
  });
  it("never yields a zero-size bitmap", () => {
    const p = planExport({ x: 0, y: 0, w: 0, h: 0 }, 1, 0);
    expect(p.ok && p.width >= 1 && p.height >= 1).toBe(true);
  });
});

describe("file names", () => {
  it("sanitises names and keeps extensions", () => {
    expect(basename("my/doc: v2?", "png")).toBe("my-doc- v2-.png");
    expect(basename("", "svg")).toBe("untitled.svg");
    expect(basename("....hidden", "png")).toBe("hidden.png");
  });
});
