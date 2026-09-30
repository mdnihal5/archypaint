/**
 * Image / SVG elements: import pipeline, content-addressed storage, bounded bitmap cache, drawing.
 *
 * This whole module is lazy (first image inserted, first image element drawn, first save/export that embeds one).
 * Nothing here runs at startup. Everything arriving from outside — files, drops, pastes, a saved document — is
 * untrusted: sizes are checked from the header BEFORE any decode, SVG goes through an allow-list sanitiser, and every
 * failure is an ImageError carrying a message fit for a toast, never an unhandled throw.
 */
import type { El } from "./scene";
import { requestImageRepaint, setImageDrawer } from "./renderer";
import type { Theme } from "./theme";

export const IMAGE_LIMITS = {
  maxInputBytes: 8 * 1024 * 1024,
  maxSide: 1600,
  maxPixels: 40_000_000,
  maxSvgChars: 200_000,
  maxSvgNodes: 5000,
  maxSvgDepth: 32,
  maxSvgUse: 100,
  /** total image bytes embedded in one saved file */
  maxEmbedBytes: 20 * 1024 * 1024,
  /** decoded bitmaps kept in memory (width * height * 4) */
  cacheBytes: 48 * 1024 * 1024,
  /** longest side of a freshly inserted image, in world units */
  insertWorld: 360,
} as const;

export class ImageError extends Error {}

const KEY_RE = /^[0-9a-f]{16}$/;
export const isImageKey = (k: unknown): k is string => typeof k === "string" && KEY_RE.test(k);

/* ------------------------------------------------------------------ header sniffing (no decode) */

export type RasterType = "png" | "jpeg" | "webp" | "gif";
export interface Dims { type: RasterType; w: number; h: number }
const MIME: Record<RasterType, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** Width/height from the file header alone, so a decompression bomb is refused before any pixel is allocated. */
export function sniffDims(b: Uint8Array): Dims | null {
  const n = b.length;
  const be16 = (i: number) => (b[i]! << 8) | b[i + 1]!, le16 = (i: number) => b[i]! | (b[i + 1]! << 8);
  const be32 = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  if (n >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    const w = be32(16), h = be32(20);
    return w > 0 && h > 0 ? { type: "png", w, h } : null;
  }
  if (n >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    const w = le16(6), h = le16(8);
    return w > 0 && h > 0 ? { type: "gif", w, h } : null;
  }
  if (n >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    for (let guard = 0; guard < 4096 && i + 9 < n; guard++) {
      if (b[i] !== 0xff) return null;
      let m = b[i + 1]!;
      while (m === 0xff && i + 2 < n) { i++; m = b[i + 1]!; } // fill bytes
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // markers without a length
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = be16(i + 5), w = be16(i + 7);
        return w > 0 && h > 0 ? { type: "jpeg", w, h } : null;
      }
      i += 2 + be16(i + 2);
    }
    return null;
  }
  if (n >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const tag = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (tag === "VP8 ") { const w = le16(26) & 0x3fff, h = le16(28) & 0x3fff; return w > 0 && h > 0 ? { type: "webp", w, h } : null; }
    if (tag === "VP8L") {
      const w = 1 + (b[21]! | ((b[22]! & 0x3f) << 8)), h = 1 + ((b[22]! >> 6) | (b[23]! << 2) | ((b[24]! & 0x0f) << 10));
      return { type: "webp", w, h };
    }
    if (tag === "VP8X") { const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)); return { type: "webp", w, h }; }
  }
  return null;
}

/* ------------------------------------------------------------------ SVG sanitiser */

const SVG_NS = "http://www.w3.org/2000/svg";
/** kept as-is */
const OK_EL = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "use", "symbol", "style"]);
/** a document containing any of these is refused outright (scripting, embedding, external loads, animation) */
const BAD_EL = new Set(["script", "foreignobject", "image", "iframe", "object", "embed", "audio", "video", "animate", "animatetransform", "animatemotion", "set", "handler", "listener", "canvas", "link", "filter", "feimage", "a"]);
const OK_ATTR = new Set(["id", "class", "style", "d", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "points", "fill", "stroke",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "fill-opacity", "fill-rule", "clip-rule",
  "opacity", "transform", "viewbox", "preserveaspectratio", "xmlns", "version", "gradientunits", "gradienttransform", "spreadmethod", "offset", "stop-color", "stop-opacity",
  "fx", "fy", "clip-path", "mask", "clippathunits", "maskunits", "maskcontentunits", "href", "xlink:href", "font-family", "font-size", "font-weight", "font-style", "text-anchor",
  "dominant-baseline", "dx", "dy", "display", "visibility", "vector-effect", "xml:space", "xmlns:xlink", "letter-spacing", "mix-blend-mode"]);
/** values that could load something, run something, or smuggle a payload */
const BAD_VALUE = /javascript:|data:|vbscript:|@import|expression\s*\(|<\s*script|&#|url\(\s*(?!#|['"]?#)/i;

export interface SvgOk { ok: true; text: string; w: number; h: number }
export interface SvgBad { ok: false; error: string }

function num(v: string | null): number {
  if (v === null) return NaN;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(v);
  return m ? Number(m[1]) : NaN;
}

/** Parse untrusted SVG text and return a cleaned, size-normalised copy, or the reason it was refused. */
export function sanitizeSvg(text: string): SvgOk | SvgBad {
  const bad = (error: string): SvgBad => ({ ok: false, error });
  if (text.length > IMAGE_LIMITS.maxSvgChars) return bad(`SVG is larger than ${IMAGE_LIMITS.maxSvgChars / 1000} KB`);
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) return bad("SVG uses a DOCTYPE, entity or external stylesheet");
  // cheap guard before the real parse: a document with far more tags than we would ever accept is refused without building a DOM for it
  if ((text.match(/<[A-Za-z]/g)?.length ?? 0) > IMAGE_LIMITS.maxSvgNodes + 1) return bad("SVG has too many elements");
  let doc: Document;
  try { doc = new DOMParser().parseFromString(text, "image/svg+xml"); } catch { return bad("SVG could not be parsed"); }
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return bad("not a valid SVG file");

  let nodes = 0, uses = 0, problem: string | null = null;
  const useTargets: string[] = [];
  const walk = (el: Element, depth: number): void => {
    if (problem) return;
    if (++nodes > IMAGE_LIMITS.maxSvgNodes) { problem = "SVG has too many elements"; return; }
    if (depth > IMAGE_LIMITS.maxSvgDepth) { problem = "SVG is nested too deeply"; return; }
    for (const child of Array.from(el.children)) {
      const name = child.localName.toLowerCase();
      if (BAD_EL.has(name)) { problem = `SVG contains <${name}>, which is not allowed`; return; }
      if (!OK_EL.has(name)) { child.remove(); continue; } // metadata, title, sodipodi:*, ...: harmless noise
      if (name === "style") {
        const css = child.textContent ?? "";
        if (css.length > 10_000 || BAD_VALUE.test(css) || /url\(/i.test(css)) { problem = "SVG <style> is not allowed to load anything"; return; }
      }
      if (name === "use") { if (++uses > IMAGE_LIMITS.maxSvgUse) { problem = "SVG uses too many <use> references"; return; } }
      for (const a of Array.from(child.attributes)) {
        const an = a.name.toLowerCase();
        if (an.startsWith("on")) { problem = "SVG contains an event handler"; return; }
        if (!OK_ATTR.has(an)) { child.removeAttribute(a.name); continue; }
        if (BAD_VALUE.test(a.value)) { problem = `SVG attribute "${an}" is not allowed`; return; }
        if ((an === "href" || an === "xlink:href")) {
          if (!a.value.startsWith("#")) { problem = "SVG links to an external resource"; return; }
          if (name === "use") useTargets.push(a.value.slice(1));
        }
      }
      walk(child, depth + 1);
      if (problem) return;
    }
  };
  for (const a of Array.from(root.attributes)) {
    const an = a.name.toLowerCase();
    if (an.startsWith("on")) return bad("SVG contains an event handler");
    if (!OK_ATTR.has(an)) root.removeAttribute(a.name);
    else if (BAD_VALUE.test(a.value)) return bad(`SVG attribute "${an}" is not allowed`);
  }
  walk(root, 1);
  if (problem) return bad(problem);
  // a <use> pointing at something that itself contains <use> is how exponential "SVG bombs" are built
  for (const id of useTargets) {
    const t = doc.getElementById(id) ?? Array.from(doc.getElementsByTagName("*")).find((n) => n.getAttribute("id") === id);
    if (t && (t.localName.toLowerCase() === "use" || t.getElementsByTagName("use").length)) return bad("SVG has nested <use> references");
  }

  // intrinsic size: the viewBox wins, else numeric width/height (no percentages)
  let w = NaN, h = NaN;
  const vb = root.getAttribute("viewBox");
  if (vb) { const p = vb.trim().split(/[\s,]+/).map(Number); if (p.length === 4 && p.every(Number.isFinite)) { w = p[2]!; h = p[3]!; } }
  if (!(w > 0 && h > 0)) { w = num(root.getAttribute("width")); h = num(root.getAttribute("height")); }
  if (!(w > 0 && h > 0) || w > 1e6 || h > 1e6) return bad("SVG needs a viewBox or a pixel width and height");
  const k = Math.min(1, 1024 / Math.max(w, h)) ;
  const ow = Math.max(1, Math.round(w * k)), oh = Math.max(1, Math.round(h * k));
  root.setAttribute("width", String(ow)); root.setAttribute("height", String(oh));
  if (!vb) root.setAttribute("viewBox", `0 0 ${w} ${h}`);
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", SVG_NS);
  const out = new XMLSerializer().serializeToString(root);
  if (out.length > IMAGE_LIMITS.maxSvgChars) return bad("SVG is too large after cleaning");
  return { ok: true, text: out, w: ow, h: oh };
}

/* ------------------------------------------------------------------ storage (content-addressed) */

export interface ImageStore {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  close(): void;
}

export function memImageStore(): ImageStore & { data: Map<string, Blob> } {
  const data = new Map<string, Blob>();
  return {
    data,
    async has(k) { return data.has(k); }, async get(k) { return data.get(k); },
    async put(k, b) { data.set(k, b); }, async delete(k) { data.delete(k); },
    async keys() { return [...data.keys()]; }, close() { data.clear(); },
  };
}

interface Rec { key: string; blob: Blob; bytes: number }
export function idbImageStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): ImageStore {
  let dbp: Promise<IDBDatabase> | null = null;
  let closed = false;
  const open = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error("IndexedDB unavailable"));
    return (dbp ??= new Promise((res, rej) => {
      const r = factory.open("archypaint-images", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("blobs", { keyPath: "key" }); };
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbp = null; }; if (closed) db.close(); res(db); };
      r.onerror = () => { dbp = null; rej(r.error); };
      r.onblocked = () => { dbp = null; rej(new Error("IndexedDB blocked")); };
    }));
  };
  const req = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (tx: IDBTransaction): Promise<void> => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error("aborted")); });
  return {
    async has(k) { const db = await open(); return (await req(db.transaction("blobs").objectStore("blobs").count(k))) > 0; },
    async get(k) { const db = await open(); const r = await req(db.transaction("blobs").objectStore("blobs").get(k)) as Rec | undefined; return r?.blob; },
    async put(k, b) { const db = await open(); const tx = db.transaction("blobs", "readwrite"); tx.objectStore("blobs").put({ key: k, blob: b, bytes: b.size } satisfies Rec); await done(tx); },
    async delete(k) { const db = await open(); const tx = db.transaction("blobs", "readwrite"); tx.objectStore("blobs").delete(k); await done(tx); },
    async keys() { const db = await open(); return (await req(db.transaction("blobs").objectStore("blobs").getAllKeys())) as string[]; },
    close() { closed = true; dbp?.then((d) => d.close()).catch(() => {}); dbp = null; },
  };
}

let store: ImageStore | null = null;
const getStore = (): ImageStore => (store ??= idbImageStore());
/** tests: swap the backend (null = default IndexedDB) */
export function setImageStore(s: ImageStore | null): void { store?.close(); store = s; }
export function closeImageStore(): void { store?.close(); store = null; }

/* ------------------------------------------------------------------ hashing */

/** Pure-JS SHA-256: SubtleCrypto does not exist on insecure pages (http:// on a LAN address), and a picture must still be insertable there. */
export function sha256(data: Uint8Array): Uint8Array {
  const K = new Uint32Array(64);
  for (let i = 0, n = 2; i < 64; n++) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) K[i++] = (Math.cbrt(n) % 1) * 4294967296; }
  const H = new Uint32Array(8);
  for (let i = 0, n = 2; i < 8; n++) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) H[i++] = (Math.sqrt(n) % 1) * 4294967296; }
  const len = data.length, padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data); padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 4294967296)); dv.setUint32(padded.length - 4, (len * 8) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15]!, b = w[i - 2]!; w[i] = (w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H as unknown as number[] as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0; H[1] = (H[1]! + b) >>> 0; H[2] = (H[2]! + c) >>> 0; H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0; H[5] = (H[5]! + f) >>> 0; H[6] = (H[6]! + g) >>> 0; H[7] = (H[7]! + h) >>> 0;
  }
  const out = new Uint8Array(32), o = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) o.setUint32(i * 4, H[i]!);
  return out;
}

export async function hashBytes(buf: ArrayBuffer): Promise<string> {
  let d: Uint8Array | null = null;
  try { if (typeof crypto !== "undefined" && crypto.subtle) d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf)); } catch { d = null; }
  d ??= sha256(new Uint8Array(buf));
  let s = "";
  for (let i = 0; i < 8; i++) s += d[i]!.toString(16).padStart(2, "0");
  return s;
}

/* ------------------------------------------------------------------ codec (replaceable in tests) */

export interface Bitmapish { width: number; height: number; close(): void }
export interface Codec {
  decode(blob: Blob, resize?: { w: number; h: number }): Promise<Bitmapish>;
  /** re-encode `bm` at w x h; null when the browser cannot produce `type` */
  encode(bm: Bitmapish, w: number, h: number, type: string, quality: number): Promise<Blob | null>;
}

const browserCodec: Codec = {
  decode(blob, resize) {
    if (blob.type === "image/svg+xml") return decodeSvg(blob, resize);
    return createImageBitmap(blob, resize ? { resizeWidth: resize.w, resizeHeight: resize.h, resizeQuality: "high" } : undefined);
  },
  async encode(bm, w, h, type, quality) {
    const src = bm as unknown as CanvasImageSource;
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d")!.drawImage(src, 0, 0, w, h);
      const b = await c.convertToBlob({ type, quality });
      return b.type === type ? b : null;
    }
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(src, 0, 0, w, h);
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, type, quality));
    c.width = c.height = 0;
    return b && b.type === type ? b : null;
  },
};
let codec: Codec = browserCodec;
export function setCodec(c: Codec | null): void { codec = c ?? browserCodec; }

/** an SVG blob -> bitmap through <img> (an SVG loaded this way cannot run script). The object URL is always revoked. */
async function decodeSvg(blob: Blob, resize?: { w: number; h: number }): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const w = resize?.w ?? (img.naturalWidth || 300), h = resize?.h ?? (img.naturalHeight || 150);
    return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
  } finally { URL.revokeObjectURL(url); }
}

/* ------------------------------------------------------------------ import pipeline */

export interface Prepared { key: string; w: number; h: number; type: string; bytes: number }

function looksLikeSvg(b: Uint8Array): boolean {
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).toLowerCase();
  return head.includes("<svg");
}

/**
 * Validate, downscale/re-encode and store an image. Resolves with its content key and intrinsic size.
 * Order matters: size check, header sniff and pixel cap all happen before anything is decoded.
 */
export async function prepareImage(input: Blob): Promise<Prepared> {
  if (input.size > IMAGE_LIMITS.maxInputBytes) throw new ImageError(`That image is ${(input.size / 1048576).toFixed(1)} MB; the limit is ${IMAGE_LIMITS.maxInputBytes / 1048576} MB.`);
  if (input.size === 0) throw new ImageError("That file is empty.");
  const buf = await input.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let out: Blob, w: number, h: number;

  const dims = sniffDims(bytes);
  if (dims) {
    if (dims.w * dims.h > IMAGE_LIMITS.maxPixels) throw new ImageError(`That image is ${dims.w} × ${dims.h} px; the limit is ${IMAGE_LIMITS.maxPixels / 1e6} megapixels.`);
    const mime = MIME[dims.type];
    const original = new Blob([buf], { type: mime });
    let bm: Bitmapish;
    try { bm = await codec.decode(original); } catch { throw new ImageError("That image could not be read (is the file damaged?)."); }
    try {
      const k = Math.min(1, IMAGE_LIMITS.maxSide / Math.max(dims.w, dims.h));
      w = Math.max(1, Math.round(dims.w * k)); h = Math.max(1, Math.round(dims.h * k));
      out = original;
      // re-encode only when it shrinks the file: downscaled images always, large JPEGs as WebP
      if (k < 1 || (dims.type === "jpeg" && input.size > 200_000)) {
        const type = dims.type === "jpeg" ? "image/webp" : MIME[dims.type === "gif" ? "png" : dims.type];
        const re = await codec.encode(bm, w, h, type, 0.85).catch(() => null);
        if (re && (k < 1 || re.size < input.size)) out = re;
      }
    } finally { bm.close(); }
  } else if (looksLikeSvg(bytes)) {
    const r = sanitizeSvg(new TextDecoder().decode(bytes));
    if (!r.ok) throw new ImageError(r.error + ".");
    out = new Blob([r.text], { type: "image/svg+xml" }); w = r.w; h = r.h;
  } else throw new ImageError("Unsupported file. Use PNG, JPEG, WebP, GIF or SVG.");

  const key = await hashBytes(await out.arrayBuffer());
  const st = getStore();
  try { if (!(await st.has(key))) await st.put(key, out); setUsedFlag(true); }
  catch { throw new ImageError("Couldn't store the image (browser storage is full or blocked)."); }
  return { key, w, h, type: out.type, bytes: out.size };
}

/** initial world-space size for a fresh image: fit the longest side to insertWorld, never upscale small images past 1x */
export function fitInsertSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, IMAGE_LIMITS.insertWorld / Math.max(w, h));
  return { w: Math.max(8, Math.round(w * k)), h: Math.max(8, Math.round(h * k)) };
}

/* ------------------------------------------------------------------ files: embed + hydrate */

const MAX_DATA_URL = Math.ceil(IMAGE_LIMITS.maxEmbedBytes * 1.4) + 64;
const DATA_RE = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/;

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface Collected { images: Record<string, string>; bytes: number; tooBig: boolean; missing: string[] }

/** data URLs for the given keys, for embedding in a saved file or an export. Stops and reports when the cap would be exceeded. */
export async function collectImages(keys: Iterable<string>): Promise<Collected> {
  const images: Record<string, string> = {};
  const missing: string[] = [];
  let bytes = 0, tooBig = false;
  const st = getStore();
  for (const k of new Set(keys)) {
    if (!isImageKey(k)) { missing.push(k); continue; }
    let b: Blob | undefined;
    try { b = await st.get(k); } catch { b = undefined; }
    if (!b) { missing.push(k); continue; }
    if (bytes + b.size > IMAGE_LIMITS.maxEmbedBytes) { tooBig = true; break; }
    bytes += b.size;
    images[k] = `data:${b.type};base64,${toBase64(new Uint8Array(await b.arrayBuffer()))}`;
  }
  return { images, bytes, tooBig, missing };
}

/**
 * Load the `images` map of an opened file into the store. The file is untrusted: each entry is shape-checked, SVG is
 * sanitised again, raster headers are size-checked, and the stored key is the hash of what was actually stored. Returns
 * old key -> stored key so the caller can remap elements (identical for files this app wrote).
 */
export async function hydrateImages(map: unknown): Promise<Record<string, string>> {
  const remap: Record<string, string> = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return remap;
  const st = getStore();
  let total = 0, n = 0;
  for (const [key, val] of Object.entries(map as Record<string, unknown>)) {
    if (++n > 5000 || !isImageKey(key) || typeof val !== "string" || val.length > MAX_DATA_URL) continue;
    const m = DATA_RE.exec(val);
    if (!m) continue;
    let bytes: Uint8Array;
    try { bytes = fromBase64(m[2]!); } catch { continue; }
    total += bytes.length;
    if (total > IMAGE_LIMITS.maxEmbedBytes * 2) break;
    let blob: Blob;
    if (m[1] === "image/svg+xml") {
      const r = sanitizeSvg(new TextDecoder().decode(bytes));
      if (!r.ok) continue;
      blob = new Blob([r.text], { type: "image/svg+xml" });
    } else {
      const d = sniffDims(bytes);
      if (!d || d.w * d.h > IMAGE_LIMITS.maxPixels || MIME[d.type] !== m[1]) continue;
      blob = new Blob([bytes as BlobPart], { type: m[1] });
    }
    const real = await hashBytes(await blob.arrayBuffer());
    try { if (!(await st.has(real))) await st.put(real, blob); setUsedFlag(true); } catch { continue; }
    remap[key] = real;
    cache?.forget(key); cache?.forget(real);
  }
  return remap;
}

/** delete stored images no element refers to. Run once at startup (undo history is empty then), never mid-session. */
export async function gcImages(referenced: ReadonlySet<string>): Promise<number> {
  const st = getStore();
  let gone = 0, left = 0;
  for (const k of await st.keys().catch(() => [] as string[])) { if (!referenced.has(k)) { await st.delete(k).catch(() => {}); gone++; } else left++; }
  if (!left) setUsedFlag(false); // nothing stored any more: the next startup need not load this chunk at all
  return gone;
}

/** tells io (which must not load this chunk at startup) that images exist in storage */
const FLAG = "archypaint.images.v1";
function setUsedFlag(on: boolean): void { try { if (on) localStorage.setItem(FLAG, "1"); else localStorage.removeItem(FLAG); } catch { /* blocked storage */ } }

/* ------------------------------------------------------------------ bounded bitmap cache */

type State = "loading" | "ready" | "missing" | "big";
interface Entry { bmp: Bitmapish | null; state: State; bytes: number; used: number }

export interface BitmapCache {
  get(key: string): Bitmapish | null;
  state(key: string): State | "none";
  forget(key: string): void;
  total(): number;
  size(): number;
  clear(): void;
}

/**
 * Decoded bitmaps, least-recently-drawn evicted (and close()d) over `maxBytes`. An entry drawn in the last
 * `keepMs` is never evicted: if everything visible does not fit, the newcomer is marked "big" and drawn as a
 * placeholder instead of thrashing decode/evict every frame.
 */
export function createBitmapCache(o: { maxBytes: number; load(key: string): Promise<Bitmapish | null>; ready(): void; now?: () => number; keepMs?: number }): BitmapCache {
  const entries = new Map<string, Entry>();
  const now = o.now ?? (() => performance.now());
  const keepMs = o.keepMs ?? 300;
  let total = 0, alive = true;

  const evictFor = (need: number): boolean => {
    if (total + need <= o.maxBytes) return true;
    const t = now();
    for (const [k, e] of entries) { // Map iterates oldest-first; get() re-inserts on use, so this is LRU order
      if (total + need <= o.maxBytes) break;
      if (e.state !== "ready" || t - e.used < keepMs) continue;
      entries.delete(k); total -= e.bytes; e.bmp?.close();
    }
    return total + need <= o.maxBytes;
  };

  const start = (key: string): Entry => {
    const e: Entry = { bmp: null, state: "loading", bytes: 0, used: now() };
    entries.set(key, e);
    o.load(key).then((bmp) => {
      if (!alive || entries.get(key) !== e) { bmp?.close(); return; }
      if (!bmp) e.state = "missing";
      else {
        const bytes = bmp.width * bmp.height * 4;
        if (evictFor(bytes)) { e.bmp = bmp; e.bytes = bytes; e.state = "ready"; total += bytes; }
        else { bmp.close(); e.state = "big"; }
      }
      o.ready();
    }, () => { if (alive && entries.get(key) === e) { e.state = "missing"; o.ready(); } });
    return e;
  };

  return {
    get(key) {
      let e = entries.get(key);
      if (!e) e = start(key);
      else { e.used = now(); entries.delete(key); entries.set(key, e); } // refresh recency
      return e.state === "ready" ? e.bmp : null;
    },
    state: (key) => entries.get(key)?.state ?? "none",
    forget(key) { const e = entries.get(key); if (!e) return; entries.delete(key); total -= e.bytes; e.bmp?.close(); },
    total: () => total,
    size: () => entries.size,
    clear() { for (const e of entries.values()) e.bmp?.close(); entries.clear(); total = 0; },
  } satisfies BitmapCache & { _?: never };
}

/** wait (bounded) until every key has left "loading" — used before an export draws them */
export async function preloadImages(keys: Iterable<string>, timeoutMs = 10_000): Promise<void> {
  const c = theCache();
  const list = [...new Set(keys)];
  const t0 = performance.now();
  for (const k of list) c.get(k);
  while (list.some((k) => c.state(k) === "loading") && performance.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 25));
}

/* ------------------------------------------------------------------ drawing */

let cache: BitmapCache | null = null;
function theCache(): BitmapCache {
  return (cache ??= createBitmapCache({
    maxBytes: IMAGE_LIMITS.cacheBytes,
    ready: () => requestImageRepaint(),
    async load(key) {
      const b = await getStore().get(key).catch(() => undefined);
      if (!b) return null;
      try {
        if (b.type === "image/svg+xml") return await codec.decode(b); // sized by the normalised width/height
        return await codec.decode(b);
      } catch { return null; }
    },
  }));
}
/** drop every decoded bitmap (teardown, tests) */
export function clearImageCache(): void { cache?.clear(); cache = null; }
export function imageCacheStats(): { entries: number; bytes: number } { return { entries: cache?.size() ?? 0, bytes: cache?.total() ?? 0 }; }

const LABEL = 18;

function placeholder(ctx: CanvasRenderingContext2D, e: El, th: Theme, x: number, y: number, w: number, h: number, dashed: boolean): void {
  const col = th.cats[e.cat % th.cats.length]!;
  ctx.globalAlpha = th.tint * 1.4; ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.6; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, w, h);
  if (dashed) ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/** the renderer's `image` branch: fit (contain) into the box above the label strip; placeholder while loading / missing */
export function drawImageEl(ctx: CanvasRenderingContext2D, e: El, th: Theme, z: number, hideText: boolean): void {
  const reserve = e.text ? LABEL : 0;
  const bx = e.x, by = e.y, bw = e.w, bh = Math.max(4, e.h - reserve);
  const c = theCache();
  const bmp = e.img ? c.get(e.img) : null;
  if (!bmp) {
    const st = e.img ? c.state(e.img) : "missing";
    placeholder(ctx, e, th, bx, by, bw, bh, st !== "loading");
    if (st === "missing" && z >= 0.4) { ctx.fillStyle = th.mid; ctx.font = "11px 'JetBrains Mono','DejaVu Sans Mono',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("image missing", bx + bw / 2, by + bh / 2, Math.max(20, bw - 8)); }
  } else {
    const k = Math.min(bw / bmp.width, bh / bmp.height);
    const dw = bmp.width * k, dh = bmp.height * k, dx = bx + (bw - dw) / 2, dy = by + (bh - dh) / 2;
    if (e.fill === 1) { ctx.globalAlpha = th.tint; ctx.fillStyle = th.cats[e.cat % th.cats.length]!; ctx.fillRect(bx, by, bw, bh); ctx.globalAlpha = 1; }
    const r = e.edge === 0 ? 0 : Math.min(e.radius, dw / 2, dh / 2);
    if (r > 0.5) { ctx.save(); ctx.beginPath(); ctx.roundRect(dx, dy, dw, dh, r); ctx.clip(); ctx.drawImage(bmp as unknown as CanvasImageSource, dx, dy, dw, dh); ctx.restore(); }
    else ctx.drawImage(bmp as unknown as CanvasImageSource, dx, dy, dw, dh);
  }
  if (e.text && z >= 0.5 && !hideText) {
    ctx.globalAlpha = 1; ctx.fillStyle = th.ink; ctx.font = "12px 'JetBrains Mono','DejaVu Sans Mono',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(e.text, e.x + e.w / 2, e.y + e.h - LABEL / 2, Math.max(20, e.w + 16));
  }
}

// installing the drawer is what this module's first import does: the renderer shows placeholders until then
setImageDrawer(drawImageEl, clearImageCache);
