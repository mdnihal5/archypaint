/**
 * Shareable link: the whole document, deflated and base64url-encoded into the URL fragment (`#d=…`). The fragment is
 * never sent to a server, so a link is a file you can paste anywhere; nothing is stored anywhere.
 *
 * Everything decoded from a link is hostile input: the compressed size, the inflated size (counted while streaming, so a
 * zip bomb stops early) and the document itself (the format validator) are all bounded.
 */
import type { EditorAPI } from "./editor-api";
import type { FeatureCtx } from "./features/types";
import { LIMITS, parseArch, serializeArch } from "./io/format";

/** a link longer than this is refused: chat apps and some browsers truncate long URLs */
export const LINK_MAX = 60_000;
export const COMPRESSED_MAX = 200 * 1024;
export const INFLATED_MAX = 5 * 1024 * 1024;
const PREFIX = "#d=";

/* ------------------------------------------------------------------ base64url */

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** null when the text is not valid base64url (bad characters, or a length no byte string can have) */
export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const b = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  try {
    const bin = atob(b);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/* ------------------------------------------------------------------ deflate */

export const hasCodec = (): boolean => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

export async function deflateText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export type Inflated = { ok: true; text: string } | { ok: false; reason: "too_large" | "corrupt" };

/** inflate with a hard cap on the OUTPUT, counted chunk by chunk: a 5 KB bomb stops after the first few chunks past the cap */
export async function inflateBytes(bytes: Uint8Array, maxOut = INFLATED_MAX): Promise<Inflated> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxOut) { await reader.cancel().catch(() => {}); return { ok: false, reason: "too_large" }; }
      chunks.push(value);
    }
  } catch { return { ok: false, reason: "corrupt" }; }
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  try { return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(all) }; } catch { return { ok: false, reason: "corrupt" }; }
}

/* ------------------------------------------------------------------ encode / decode a fragment */

export type Encoded = { ok: true; hash: string } | { ok: false; message: string };

export async function encodeShareHash(text: string, max = LINK_MAX): Promise<Encoded> {
  if (!hasCodec()) return { ok: false, message: "This browser can't compress links. Save the file and send that instead." };
  const hash = PREFIX + toBase64Url(await deflateText(text));
  if (hash.length > max) return { ok: false, message: `This diagram is too large for a link (${Math.round(hash.length / 1024)} KB, the limit is ${Math.round(max / 1024)} KB). Save it as a file instead.` };
  return { ok: true, hash };
}

export type Decoded = { ok: true; text: string } | { ok: false; message: string };
const DAMAGED = "This share link is damaged or incomplete.";

export async function decodeShareHash(hash: string): Promise<Decoded> {
  if (!hash.startsWith(PREFIX)) return { ok: false, message: "Not a share link." };
  const data = hash.slice(PREFIX.length);
  if (data.length > Math.ceil((COMPRESSED_MAX * 4) / 3) + 4) return { ok: false, message: "This share link is too large to open." };
  if (!hasCodec()) return { ok: false, message: "This browser can't open share links." };
  const bytes = fromBase64Url(data);
  if (!bytes || !bytes.length || bytes.length > COMPRESSED_MAX) return { ok: false, message: DAMAGED };
  const r = await inflateBytes(bytes);
  if (r.ok) return r;
  return { ok: false, message: r.reason === "too_large" ? "This share link expands to more data than archypaint will open." : DAMAGED };
}

/* ------------------------------------------------------------------ the document <-> text */

export function documentText(editor: EditorAPI, name: string): string {
  const now = Date.now();
  const v = editor.vp;
  return serializeArch({ meta: { name, created: now, updated: now }, view: { x: v.x, y: v.y, zoom: v.zoom }, settings: {}, scene: editor.scene.toJSON() });
}

/** a fallback when the clipboard is blocked: show the link in a selected text box instead of losing it */
async function showLink(url: string): Promise<void> {
  const m = await import("./ui/present-ui");
  m.showLinkBox(url);
}

export async function copyShareLink(c: FeatureCtx): Promise<void> {
  if (!c.editor.scene.els.size) { c.toast("There is nothing to share yet.", "err"); return; }
  const enc = await encodeShareHash(documentText(c.editor, c.io.docName()));
  if (!enc.ok) { c.toast(enc.message, "err"); return; }
  const url = location.origin + location.pathname + enc.hash;
  try {
    await navigator.clipboard.writeText(url);
    c.toast(`Link copied (${Math.round(url.length / 1024 * 10) / 10} KB). Anyone with it can view this diagram; nothing is uploaded.`);
  } catch {
    await showLink(url);
  }
}

/* ------------------------------------------------------------------ opening a link */

export type SharedCtx = Pick<FeatureCtx, "editor" | "io" | "toast" | "stage">;

/**
 * Open the document in `hash` READ-ONLY. The caller must NOT have called io.restore(): autosave stays disarmed, so
 * neither this document nor any edit can overwrite the user's own autosaved sheet. "Make an editable copy" is the
 * only way it becomes theirs. Returns false (after telling the user) when the link can't be opened, so the caller can
 * fall back to the normal startup.
 */
export async function openSharedFromHash(c: SharedCtx, hash: string = location.hash): Promise<boolean> {
  const d = await decodeShareHash(hash);
  if (!d.ok) { c.toast(d.message, "err"); return false; }
  const p = parseArch(d.text);
  if (!p.ok) { c.toast(`This share link isn't a valid archypaint diagram (${p.error.message}).`, "err"); return false; }
  const f = p.value;
  c.editor.load(f.scene);
  c.editor.zoomToFit();
  c.editor.markSaved();
  c.io.setDocName(f.meta.name.slice(0, LIMITS.maxName));
  c.editor.setReadOnly(true);
  const ui = await import("./ui/present-ui");
  ui.mountSharedBar(c, () => {
    history.replaceState(null, "", location.pathname + location.search); // the copy is no longer "the link"
    c.editor.setReadOnly(false);
    c.io.adoptCurrent();
  });
  return true;
}
