// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectImages, createBitmapCache, sha256, drawImageEl, fitInsertSize, gcImages, hashBytes, hydrateImages, IMAGE_LIMITS, ImageError, imageCacheStats,
  clearImageCache, memImageStore, prepareImage, sanitizeSvg, setCodec, setImageStore, sniffDims, type Bitmapish, type Codec,
} from "./images";
import { LIGHT } from "./theme";
import type { El } from "./scene";

/* ---------------------------------------------------------------- synthetic file headers */

const png = (w: number, h: number, pad = 64): Uint8Array => {
  const b = new Uint8Array(24 + pad);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return b;
};
const gif = (w: number, h: number): Uint8Array => { const b = new Uint8Array(32); b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); b[6] = w & 255; b[7] = w >> 8; b[8] = h & 255; b[9] = h >> 8; return b; };
const jpeg = (w: number, h: number, size = 300): Uint8Array => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // SOI + APP0 (length 16)
  const o = 20; // SOF0
  b.set([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3], o);
  return b;
};
const webpX = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0]);
  const w1 = w - 1, h1 = h - 1;
  b.set([w1 & 255, (w1 >> 8) & 255, (w1 >> 16) & 255, h1 & 255, (h1 >> 8) & 255, (h1 >> 16) & 255], 24);
  return b;
};
const webpLossy = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  b[26] = w & 255; b[27] = (w >> 8) & 0x3f; b[28] = h & 255; b[29] = (h >> 8) & 0x3f;
  return b;
};
const webpLossless = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c]);
  const bits = (w - 1) | ((h - 1) << 14);
  b[21] = bits & 255; b[22] = (bits >> 8) & 255; b[23] = (bits >> 16) & 255; b[24] = (bits >> 24) & 255;
  return b;
};

describe("sniffDims (header only, before any decode)", () => {
  it("reads PNG, GIF, JPEG and the three WebP flavours", () => {
    expect(sniffDims(png(1000, 2000))).toEqual({ type: "png", w: 1000, h: 2000 });
    expect(sniffDims(gif(320, 200))).toEqual({ type: "gif", w: 320, h: 200 });
    expect(sniffDims(jpeg(4032, 3024))).toEqual({ type: "jpeg", w: 4032, h: 3024 });
    expect(sniffDims(webpX(1920, 1080))).toEqual({ type: "webp", w: 1920, h: 1080 });
    expect(sniffDims(webpLossy(640, 480))).toEqual({ type: "webp", w: 640, h: 480 });
    expect(sniffDims(webpLossless(800, 600))).toEqual({ type: "webp", w: 800, h: 600 });
  });
  it("returns null for garbage, truncated and zero-sized headers — never throws or loops", () => {
    expect(sniffDims(new Uint8Array(0))).toBeNull();
    expect(sniffDims(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(sniffDims(png(0, 10))).toBeNull();
    expect(sniffDims(png(10, 10).subarray(0, 12))).toBeNull();
    expect(sniffDims(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    const evil = new Uint8Array(100000).fill(0xff); evil[0] = 0xff; evil[1] = 0xd8; // a JPEG that is all fill bytes
    expect(sniffDims(evil)).toBeNull();
    const loop = new Uint8Array(5000); loop.set([0xff, 0xd8]); for (let i = 2; i + 3 < loop.length; i += 4) { loop[i] = 0xff; loop[i + 1] = 0xe1; loop[i + 2] = 0; loop[i + 3] = 2; }
    expect(sniffDims(loop)).toBeNull(); // zero-progress marker chain hits the guard
  });
});

/* ---------------------------------------------------------------- SVG sanitiser */

const wrap = (inner: string, attrs = 'viewBox="0 0 100 50"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe("sanitizeSvg", () => {
  it("accepts ordinary vector art and normalises the size", () => {
    const r = sanitizeSvg(wrap('<g fill="#f00"><path d="M0 0L50 50"/><rect x="1" y="1" width="9" height="9"/><circle cx="5" cy="5" r="3"/></g>'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.w, r.h]).toEqual([100, 50]);
    expect(r.text).toContain('width="100"'); expect(r.text).toContain("viewBox");
  });
  it("scales a huge viewBox down to a sane intrinsic size", () => {
    const r = sanitizeSvg(wrap("<path d='M0 0L1 1'/>", 'viewBox="0 0 8000 4000"'));
    expect(r.ok && r.w).toBe(1024); expect(r.ok && r.h).toBe(512);
  });
  it("takes the size from width/height when there is no viewBox, and adds one", () => {
    const r = sanitizeSvg(wrap("<path d='M0 0L1 1'/>", 'width="64px" height="32"'));
    expect(r.ok && r.text).toContain('viewBox="0 0 64 32"');
  });
  it("is idempotent: cleaning a cleaned file changes nothing (hydrating our own saved file keeps the same key)", () => {
    const a = sanitizeSvg(wrap('<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>'));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = sanitizeSvg(a.text);
    expect(b.ok && b.text).toBe(a.text);
  });
  it("strips harmless noise (metadata, title, namespaced attributes) instead of refusing", () => {
    const r = sanitizeSvg(wrap('<title>x</title><metadata>m</metadata><path d="M0 0L1 1" inkscape:label="a" data-x="1" xmlns:inkscape="http://www.inkscape.org"/>'));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.text).not.toContain("metadata"); expect(r.text).not.toContain("data-x"); expect(r.text).not.toContain("<title"); }
  });

  const HOSTILE: Array<[string, string]> = [
    ["script element", wrap('<script>alert(1)</script><path d="M0 0"/>')],
    ["foreignObject", wrap('<foreignObject><iframe src="http://evil"/></foreignObject>')],
    ["image element", wrap('<image href="http://evil/x.png" width="10" height="10"/>')],
    ["anchor", wrap('<a href="javascript:alert(1)"><rect width="9" height="9"/></a>')],
    ["onload handler on root", wrap('<path d="M0 0"/>', 'viewBox="0 0 10 10" onload="alert(1)"')],
    ["onclick handler", wrap('<rect width="9" height="9" onclick="alert(1)"/>')],
    ["use with external href", wrap('<use href="http://evil/x.svg#a"/>')],
    ["use with javascript href", wrap('<use xlink:href="javascript:alert(1)" xmlns:xlink="http://www.w3.org/1999/xlink"/>')],
    ["fill with external url()", wrap('<rect width="9" height="9" fill="url(http://evil/p)"/>')],
    ["style attribute loading a url", wrap('<rect width="9" height="9" style="background:url(http://evil/x)"/>')],
    ["style element with @import", wrap('<style>@import "http://evil/x.css";</style><rect width="9" height="9"/>')],
    ["style element with url()", wrap('<style>rect{fill:url(http://evil)}</style><rect width="9" height="9"/>')],
    ["data: URI in an attribute", wrap('<rect width="9" height="9" fill="data:text/html,x"/>')],
    ["animate", wrap('<rect width="9" height="9"><animate attributeName="x" from="0" to="9"/></rect>')],
    ["set", wrap('<rect width="9" height="9"><set attributeName="onclick" to="alert(1)"/></rect>')],
    ["filter (can load feImage)", wrap('<filter id="f"><feImage href="http://evil"/></filter><rect width="9" height="9" filter="url(#f)"/>')],
    ["doctype with entities", '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&a;</text></svg>'],
    ["xml-stylesheet", '<?xml-stylesheet href="http://evil/x.css"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'],
    ["nested use (exponential bomb)", wrap('<defs><g id="a"><use href="#b"/></g><g id="b"><rect width="1" height="1"/></g></defs><use href="#a"/>')],
    ["too many use", wrap(`<defs><rect id="r" width="1" height="1"/></defs>${'<use href="#r"/>'.repeat(120)}`)],
    ["too many nodes", wrap("<rect width='1' height='1'/>".repeat(5100))],
    ["too deep", wrap("<g>".repeat(40) + "<rect width='1' height='1'/>" + "</g>".repeat(40))],
    ["no size at all", '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'],
    ["percentage size only", '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><path d="M0 0L1 1"/></svg>'],
    ["not svg", "<html><body>hi</body></html>"],
    ["not xml", "this is not xml"],
    ["broken xml", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path></svg>'],
  ];
  for (const [name, doc] of HOSTILE) {
    it(`refuses: ${name}`, () => {
      const r = sanitizeSvg(doc);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(3);
    });
  }
  it("refuses an oversized document without parsing it", () => {
    const big = wrap(`<!-- ${"x".repeat(IMAGE_LIMITS.maxSvgChars)} --><path d="M0 0"/>`);
    const r = sanitizeSvg(big);
    expect(!r.ok && r.error).toMatch(/larger than/);
  });
  it("never lets a dangerous token survive in the cleaned output of accepted files", () => {
    for (const doc of [wrap('<path d="M0 0" stroke="#000"/>'), wrap('<g id="x"><rect width="2" height="2" style="fill:#fff"/></g><use href="#x"/>')]) {
      const r = sanitizeSvg(doc);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.text).not.toMatch(/script|javascript:|onload|foreignObject|http:\/\/(?!www\.w3\.org)/i);
    }
  });
});

/* ---------------------------------------------------------------- import pipeline (fake codec, in-memory store) */

function fakeCodec() {
  const closed: number[] = [];
  let n = 0;
  const c = {
    decodes: 0, encodes: [] as Array<{ w: number; h: number; type: string }>, failDecode: false, encodeReturns: null as Blob | null | "same-type",
    decode: vi.fn(async (_b: Blob): Promise<Bitmapish> => {
      c.decodes++;
      if (c.failDecode) throw new Error("bad image");
      const id = n++; return { width: 10, height: 10, close: () => { closed.push(id); } };
    }),
    encode: vi.fn(async (_bm: Bitmapish, w: number, h: number, type: string): Promise<Blob | null> => {
      c.encodes.push({ w, h, type });
      if (c.encodeReturns === "same-type") return new Blob([new Uint8Array(50).fill(7)], { type });
      return c.encodeReturns;
    }),
    closed,
  };
  return c satisfies Codec & Record<string, unknown>;
}

const blobOf = (b: Uint8Array, type = "") => new Blob([b as BlobPart], { type });

describe("prepareImage", () => {
  let store: ReturnType<typeof memImageStore>;
  let codec: ReturnType<typeof fakeCodec>;
  beforeEach(() => { store = memImageStore(); setImageStore(store); codec = fakeCodec(); setCodec(codec); localStorage.clear(); });
  afterEach(() => { setImageStore(null); setCodec(null); });

  it("rejects an oversized file before reading or decoding it", async () => {
    const big = new Blob([new Uint8Array(IMAGE_LIMITS.maxInputBytes + 1)]);
    await expect(prepareImage(big)).rejects.toThrow(ImageError);
    await expect(prepareImage(big)).rejects.toThrow(/MB/);
    expect(codec.decode).not.toHaveBeenCalled();
  });
  it("rejects an empty file and unsupported content", async () => {
    await expect(prepareImage(new Blob([]))).rejects.toThrow(/empty/);
    await expect(prepareImage(new Blob(["hello world, not an image"]))).rejects.toThrow(/Unsupported/);
    expect(codec.decode).not.toHaveBeenCalled();
  });
  it("refuses a decompression bomb from its header alone — nothing is decoded", async () => {
    await expect(prepareImage(blobOf(png(30000, 30000), "image/png"))).rejects.toThrow(/megapixels/);
    await expect(prepareImage(blobOf(jpeg(20000, 20000), "image/jpeg"))).rejects.toThrow(/megapixels/);
    expect(codec.decode).not.toHaveBeenCalled();
    expect(store.data.size).toBe(0);
  });
  it("turns a decode failure into a friendly error and stores nothing", async () => {
    codec.failDecode = true;
    await expect(prepareImage(blobOf(png(100, 100), "image/png"))).rejects.toThrow(/could not be read/);
    expect(store.data.size).toBe(0);
  });
  it("keeps a small PNG byte-for-byte, stores it under its content hash, and reports its size", async () => {
    const bytes = png(800, 600, 200);
    const r = await prepareImage(blobOf(bytes, "image/png"));
    expect([r.w, r.h]).toEqual([800, 600]);
    expect(r.key).toMatch(/^[0-9a-f]{16}$/);
    expect(r.key).toBe(await hashBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    expect(codec.encode).not.toHaveBeenCalled(); // no pointless re-encode
    expect(store.data.get(r.key)!.size).toBe(bytes.length);
    expect(codec.closed.length).toBe(1); // the probe bitmap was released
    expect(localStorage.getItem("archypaint.images.v1")).toBe("1");
  });
  it("de-dupes: the same picture twice is stored once", async () => {
    const put = vi.spyOn(store, "put");
    const a = await prepareImage(blobOf(png(300, 300, 100), "image/png"));
    const b = await prepareImage(blobOf(png(300, 300, 100), "image/png"));
    expect(a.key).toBe(b.key);
    expect(put).toHaveBeenCalledTimes(1);
    expect(store.data.size).toBe(1);
  });
  it("downscales anything over 1600 px on its longest side, keeping the aspect ratio", async () => {
    codec.encodeReturns = "same-type";
    const r = await prepareImage(blobOf(png(4000, 3000, 500), "image/png"));
    expect(codec.encodes).toEqual([{ w: 1600, h: 1200, type: "image/png" }]);
    expect([r.w, r.h]).toEqual([1600, 1200]);
    expect(store.data.get(r.key)!.size).toBe(50); // what the encoder produced, not the original
  });
  it("re-encodes a large JPEG as WebP, and keeps the original if the browser cannot", async () => {
    const big = jpeg(1200, 800, 400_000);
    codec.encodeReturns = new Blob([new Uint8Array(1000)], { type: "image/webp" });
    const a = await prepareImage(blobOf(big, "image/jpeg"));
    expect(codec.encodes[0]!.type).toBe("image/webp");
    expect(store.data.get(a.key)!.type).toBe("image/webp");
    codec.encodeReturns = null; codec.encodes.length = 0;
    const b = await prepareImage(blobOf(jpeg(1200, 801, 400_000), "image/jpeg"));
    expect(store.data.get(b.key)!.type).toBe("image/jpeg");
  });
  it("never keeps a re-encode that is bigger than the original", async () => {
    codec.encodeReturns = new Blob([new Uint8Array(900_000)], { type: "image/webp" });
    const r = await prepareImage(blobOf(jpeg(1200, 800, 400_000), "image/jpeg"));
    expect(store.data.get(r.key)!.type).toBe("image/jpeg");
  });
  it("stores a cleaned SVG (not the original) and refuses a hostile one with the reason", async () => {
    const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><metadata>x</metadata><path d="M0 0L9 9"/></svg>`;
    const r = await prepareImage(new Blob([good], { type: "image/svg+xml" }));
    expect([r.w, r.h, r.type]).toEqual([40, 20, "image/svg+xml"]);
    const text = await store.data.get(r.key)!.text();
    expect(text).not.toContain("metadata");
    await expect(prepareImage(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>1</script></svg>']))).rejects.toThrow(/script/);
    expect(codec.decode).not.toHaveBeenCalled(); // an SVG is never handed to the decoder before it is cleaned
  });
  it("reports a full or blocked store instead of throwing something cryptic", async () => {
    vi.spyOn(store, "put").mockRejectedValue(new DOMException("full", "QuotaExceededError"));
    await expect(prepareImage(blobOf(png(10, 10, 100), "image/png"))).rejects.toThrow(/storage/);
  });
  it("survives 300 rapid imports of the same file with one stored copy (paste spam)", async () => {
    const b = blobOf(png(64, 64, 100), "image/png");
    await Promise.all(Array.from({ length: 300 }, () => prepareImage(b).catch(() => null)));
    expect(store.data.size).toBe(1);
  });
});

describe("sha256 fallback (pages without SubtleCrypto)", () => {
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  it("matches the standard test vectors", () => {
    expect(hex(sha256(new TextEncoder().encode("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex(sha256(new Uint8Array(0)))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex(sha256(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
  it("agrees with Node's SHA-256 on binary data of awkward lengths (block boundaries 55/56/63/64/65)", () => {
    const want: Record<string, string> = {"1": "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a", "55": "0c74b286e2c8b409ed0fd89f5a8344aeb274bda5d9bfbe7b8e537cfc6142736d", "56": "8136496fb4867a08f8c0f1afaf000ef4093ecc2d544f4f808ef9d5945ca4c2fa", "63": "a7c6fa71b10f6f7bd8ce26f79db5693d265b2cde42e61955077e77c8764bc26f", "64": "3ea97ec766b8247739939247b4d4cb362cf13c100deb0cc2ba5391f762023852", "65": "7fc8e770811fb1035a2279b782a7b04024fe6a2229e9bb11a99686d3ca65f4a7", "1000": "44a1b8c5e1f8849fc62fcbfadd4f4ab312021e40f8e16b2a4f9307493ca45102", "70001": "a27e5119273e90995f9a80b4183ee9b19bb0a6c3fe8896fe388c235157a79c0c"};
    for (const [n, h] of Object.entries(want)) {
      const len = Number(n);
      const b = new Uint8Array(len).map((_, i) => (i * 31 + len) & 255);
      expect(hex(sha256(b))).toBe(h);
    }
  });
  it("hashBytes works with no crypto.subtle at all", async () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try { expect(await hashBytes(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe("ba7816bf8f01cfea"); }
    finally { if (real) Object.defineProperty(globalThis, "crypto", real); }
  });
});

describe("fitInsertSize", () => {
  it("fits the longest side to 360 world units, never enlarges, and never collapses", () => {
    expect(fitInsertSize(1600, 800)).toEqual({ w: 360, h: 180 });
    expect(fitInsertSize(100, 50)).toEqual({ w: 100, h: 50 });
    expect(fitInsertSize(10000, 1)).toEqual({ w: 360, h: 8 });
  });
});

/* ---------------------------------------------------------------- bounded bitmap cache */

function bm(w: number, h: number) { const close = vi.fn(); return { width: w, height: h, close } satisfies Bitmapish; }

describe("bitmap cache", () => {
  it("evicts the least recently drawn and closes its bitmap; recently drawn ones stay", async () => {
    let t = 0;
    const made = new Map<string, ReturnType<typeof bm>>();
    const ready = vi.fn();
    const c = createBitmapCache({ maxBytes: 3 * 400, now: () => t, keepMs: 100, ready, load: async (k) => { const b = bm(10, 10); made.set(k, b); return b; } }); // each bitmap = 400 bytes
    for (const k of ["a", "b", "c"]) { c.get(k); await Promise.resolve(); await Promise.resolve(); }
    expect(c.total()).toBe(1200); expect(c.size()).toBe(3);
    t = 1000; c.get("a"); // a is the most recently drawn; b is now the oldest
    t = 2000;
    c.get("d"); await Promise.resolve(); await Promise.resolve();
    expect(made.get("b")!.close).toHaveBeenCalledTimes(1); // evicted
    expect(made.get("a")!.close).not.toHaveBeenCalled();
    expect(c.state("b")).toBe("none");
    expect(c.total()).toBeLessThanOrEqual(1200);
  });
  it("never evicts what was drawn in the last keepMs; the newcomer becomes 'big' instead of thrashing", async () => {
    let t = 0;
    const c = createBitmapCache({ maxBytes: 800, now: () => t, keepMs: 300, ready: () => {}, load: async () => bm(10, 10) });
    c.get("a"); c.get("b"); await Promise.resolve(); await Promise.resolve();
    t = 10; c.get("a"); c.get("b");
    c.get("c"); await Promise.resolve(); await Promise.resolve();
    expect(c.state("c")).toBe("big");
    expect(c.state("a")).toBe("ready"); expect(c.state("b")).toBe("ready");
  });
  it("calls ready() once per state change, marks missing blobs, and does not retry them every frame", async () => {
    const ready = vi.fn(); const load = vi.fn(async () => null);
    const c = createBitmapCache({ maxBytes: 1e6, ready, load });
    for (let i = 0; i < 50; i++) c.get("gone");
    await Promise.resolve(); await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(c.state("gone")).toBe("missing");
    for (let i = 0; i < 50; i++) c.get("gone");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("a load that fails becomes 'missing'; one that finishes after clear() is closed, not leaked", async () => {
    const c = createBitmapCache({ maxBytes: 1e6, ready: () => {}, load: async () => { throw new Error("x"); } });
    c.get("x"); await Promise.resolve(); await Promise.resolve();
    expect(c.state("x")).toBe("missing");
    let resolve!: (b: Bitmapish) => void;
    const late = bm(5, 5);
    const c2 = createBitmapCache({ maxBytes: 1e6, ready: () => {}, load: () => new Promise((r) => { resolve = r; }) });
    c2.get("y"); c2.clear(); resolve(late); await Promise.resolve(); await Promise.resolve();
    expect(late.close).toHaveBeenCalledTimes(1);
  });
  it("forget() and clear() close everything they drop", async () => {
    const all: Array<ReturnType<typeof bm>> = [];
    const c = createBitmapCache({ maxBytes: 1e6, ready: () => {}, load: async () => { const b = bm(4, 4); all.push(b); return b; } });
    c.get("a"); c.get("b"); await Promise.resolve(); await Promise.resolve();
    c.forget("a"); expect(all[0]!.close).toHaveBeenCalledTimes(1); expect(c.total()).toBe(64);
    c.clear(); expect(all[1]!.close).toHaveBeenCalledTimes(1); expect(c.total()).toBe(0); expect(c.size()).toBe(0);
  });
  it("holds at most maxBytes across 2,000 different images (memory bound)", async () => {
    let t = 0;
    const c = createBitmapCache({ maxBytes: 100 * 400, now: () => t, keepMs: 0, ready: () => {}, load: async () => bm(10, 10) });
    let peak = 0;
    for (let i = 0; i < 2000; i++) { t += 10; c.get(`k${i}`); await Promise.resolve(); await Promise.resolve(); peak = Math.max(peak, c.total()); }
    expect(peak).toBeLessThanOrEqual(100 * 400);
    expect(c.size()).toBeLessThanOrEqual(100);
  });
});

/* ---------------------------------------------------------------- embed / hydrate / gc */

describe("collectImages / hydrateImages / gcImages", () => {
  let store: ReturnType<typeof memImageStore>;
  beforeEach(() => { store = memImageStore(); setImageStore(store); setCodec(fakeCodec()); localStorage.clear(); });
  afterEach(() => { setImageStore(null); setCodec(null); });

  it("round-trips a picture through a data URL into another store, under the same key", async () => {
    const r = await prepareImage(blobOf(png(200, 100, 300), "image/png"));
    const srcSize = store.data.get(r.key)!.size;
    const out = await collectImages([r.key, r.key]); // duplicates collapse
    expect(Object.keys(out.images)).toEqual([r.key]);
    expect(out.images[r.key]).toMatch(/^data:image\/png;base64,/);
    const other = memImageStore(); setImageStore(other);
    const remap = await hydrateImages(out.images);
    expect(remap).toEqual({ [r.key]: r.key });
    expect(other.data.has(r.key)).toBe(true);
    expect(other.data.get(r.key)!.size).toBe(srcSize);
  });
  it("reports missing keys and non-keys instead of throwing", async () => {
    const out = await collectImages(["0123456789abcdef", "not-a-key"]);
    expect(out.images).toEqual({}); expect(out.missing.sort()).toEqual(["0123456789abcdef", "not-a-key"]);
  });
  it("stops at the 20 MB cap and says so", async () => {
    for (const k of ["aaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaa2"]) await store.put(k, new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "image/png" }));
    const out = await collectImages(["aaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaa2"]);
    expect(out.tooBig).toBe(true);
    expect(Object.keys(out.images).length).toBe(1);
  });
  it("skips hostile or malformed entries in an opened file and keeps the good one", async () => {
    const good = `data:image/png;base64,${btoa(String.fromCharCode(...png(40, 40, 100)))}`;
    const bombPng = `data:image/png;base64,${btoa(String.fromCharCode(...png(50000, 50000, 10)))}`;
    const mismatch = `data:image/jpeg;base64,${btoa(String.fromCharCode(...png(40, 40, 100)))}`; // says jpeg, is png
    const badSvg = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>1</script></svg>')}`;
    const html = `data:text/html;base64,${btoa("<script>1</script>")}`;
    const remap = await hydrateImages({
      "1111111111111111": good, "2222222222222222": bombPng, "3333333333333333": mismatch, "4444444444444444": badSvg,
      "5555555555555555": html, "6666666666666666": "data:image/png;base64,!!!notbase64!!!", "nope": good, "7777777777777777": 42,
    });
    expect(Object.keys(remap)).toEqual(["1111111111111111"]); // only the good one
    expect(store.data.size).toBe(1);
    for (const junk of [null, undefined, 5, "x", [], [1, 2]]) expect(await hydrateImages(junk)).toEqual({});
  });
  it("re-keys to the hash of what was actually stored, so a lying key cannot alias another picture", async () => {
    const png1 = `data:image/png;base64,${btoa(String.fromCharCode(...png(40, 40, 100)))}`;
    const remap = await hydrateImages({ "9999999999999999": png1 });
    expect(remap["9999999999999999"]).toMatch(/^[0-9a-f]{16}$/);
    expect(remap["9999999999999999"]).not.toBe("9999999999999999");
    expect(store.data.has(remap["9999999999999999"]!)).toBe(true);
    expect(store.data.has("9999999999999999")).toBe(false);
  });
  it("gc deletes only unreferenced blobs, and clears the 'images used' flag when nothing is left", async () => {
    localStorage.setItem("archypaint.images.v1", "1");
    await store.put("aaaaaaaaaaaaaaaa", new Blob(["1"])); await store.put("bbbbbbbbbbbbbbbb", new Blob(["2"]));
    expect(await gcImages(new Set(["aaaaaaaaaaaaaaaa"]))).toBe(1);
    expect([...store.data.keys()]).toEqual(["aaaaaaaaaaaaaaaa"]);
    expect(localStorage.getItem("archypaint.images.v1")).toBe("1");
    expect(await gcImages(new Set())).toBe(1);
    expect(store.data.size).toBe(0);
    expect(localStorage.getItem("archypaint.images.v1")).toBeNull();
  });
});

/* ---------------------------------------------------------------- drawing */

function recorder() {
  const calls: Array<[string, unknown[]]> = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => { calls.push([k, a]); }),
    set: (t, k: string, v) => { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, has: (n: string) => calls.some((c) => c[0] === n), count: (n: string) => calls.filter((c) => c[0] === n).length };
}
const imgEl = (o: Partial<El> = {}): El => ({ id: "e1", kind: "image", x: 10, y: 20, w: 200, h: 100, z: 1, version: 1, cat: 0, fill: 0, radius: 8, text: "", edge: 1, groupIds: [], iconId: "", img: "aaaaaaaaaaaaaaaa", locked: false, n: 0, o: 0, src: "", dst: "", sp: -1, dp: -1, route: 1, dash: 0, head: 1, pts: [], gx0: 0, gy0: 0, gx1: 0, gy1: 0, seen: 0, ...o }) as El;

describe("drawImageEl", () => {
  let store: ReturnType<typeof memImageStore>;
  beforeEach(() => { clearImageCache(); store = memImageStore(); setImageStore(store); });
  afterEach(() => { clearImageCache(); setImageStore(null); setCodec(null); });

  it("draws a placeholder while loading, then the bitmap fitted (contain) inside the box; nothing decodes per frame", async () => {
    await store.put("aaaaaaaaaaaaaaaa", new Blob(["x"], { type: "image/png" }));
    const made: Bitmapish[] = [];
    const decode = vi.fn(async () => { const b = { width: 400, height: 100, close: vi.fn() }; made.push(b); return b; });
    setCodec({ decode, encode: async () => null });
    const e = imgEl();
    const r1 = recorder(); drawImageEl(r1.ctx, e, LIGHT, 1, false);
    expect(r1.has("strokeRect")).toBe(true); expect(r1.has("drawImage")).toBe(false); // placeholder
    await new Promise((r) => setTimeout(r, 10));
    const r2 = recorder(); drawImageEl(r2.ctx, e, LIGHT, 1, false);
    const di = r2.calls.find((c) => c[0] === "drawImage")!;
    expect(di).toBeTruthy();
    const [, dx, dy, dw, dh] = di[1] as number[];
    expect(dw).toBe(200); expect(dh).toBe(50); // 400x100 into 200x100 -> 200x50, centred vertically
    expect(dx).toBe(10); expect(dy).toBe(20 + 25);
    for (let i = 0; i < 100; i++) drawImageEl(recorder().ctx, e, LIGHT, 1, false);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(imageCacheStats().entries).toBe(1);
  });
  it("shows 'image missing' for a key that is not in storage, and reserves a label strip when there is text", async () => {
    const e = imgEl({ img: "ffffffffffffffff", text: "logo" });
    drawImageEl(recorder().ctx, e, LIGHT, 1, false);
    await new Promise((r) => setTimeout(r, 10));
    const r = recorder(); drawImageEl(r.ctx, e, LIGHT, 1, false);
    const texts = r.calls.filter((c) => c[0] === "fillText").map((c) => c[1][0]);
    expect(texts).toContain("image missing"); expect(texts).toContain("logo");
    const hidden = recorder(); drawImageEl(hidden.ctx, e, LIGHT, 1, true);
    expect(hidden.calls.filter((c) => c[0] === "fillText").map((c) => c[1][0])).not.toContain("logo");
  });
});
