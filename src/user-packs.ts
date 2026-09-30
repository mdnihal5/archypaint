/**
 * User icon packs (README §4.7): official vendor icons may only be loaded by the user, never bundled.
 * A pack is a `.archipack.json` file:
 *   { "v": 1, "name": "My cloud", "icons": [{ "id": "vm", "name": "Virtual machine", "aliases": ["compute"],
 *       "category": "compute", "detail": "<inner SVG, 64 grid>", "glyph": "<inner SVG, 24 grid>" }] }
 * Everything in a pack is untrusted input. The markup is checked against a strict grammar (self-closing
 * shape elements, allow-listed attributes with value patterns, currentColor/none only) BEFORE it is ever
 * parsed for drawing or put in the palette's innerHTML — so a hostile pack can neither run script nor
 * exhaust memory. Every failure is a returned message, never a throw.
 */
import { installUserIcons, parseIconMarkup, removeUserIcons, ROOT_STROKE } from "./icon-pack";
import { CATEGORIES } from "./theme";

export const MAX_PACK_BYTES = 5 * 1024 * 1024;
export const MAX_ICONS = 2000;
export const MAX_MARKUP = 8000;
const MAX_OPS = 200;
const MAX_PATH = 4000;

export interface UserIcon { id: string; name: string; aliases: string[]; category: string; detail: string; glyph: string }
export interface UserPack { v: 1; name: string; icons: UserIcon[] }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface UserPackInfo { key: string; name: string; count: number }

const NUM = /^-?\d{1,4}(\.\d{1,4})?$/;
const OPACITY = /^(0|1|0?\.\d{1,3}|1\.0)$/;
const ATTR: Record<string, RegExp | ((v: string) => boolean)> = {
  d: (v) => v.length <= MAX_PATH && /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]*$/.test(v),
  points: (v) => v.length <= 2000 && /^[0-9.,\s+-]+$/.test(v),
  fill: /^(currentColor|none)$/, stroke: /^(currentColor|none)$/,
  "fill-opacity": OPACITY, "stroke-opacity": OPACITY,
  "stroke-width": NUM, "stroke-dasharray": /^[0-9. ,]{1,40}$/,
  "stroke-linecap": /^(butt|round|square)$/, "stroke-linejoin": /^(miter|round|bevel)$/,
  x: NUM, y: NUM, width: NUM, height: NUM, rx: NUM, ry: NUM, cx: NUM, cy: NUM, r: NUM, x1: NUM, y1: NUM, x2: NUM, y2: NUM,
};
const TAGS = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"]);
const ELEMENT = /\s*<([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/>/y;
const ATTR_RE = /\s+([a-z-]+)="([^"]*)"/g;

/** null when the markup is acceptable, else the reason */
export function markupProblem(markup: unknown): string | null {
  if (typeof markup !== "string" || !markup.trim()) return "empty markup";
  if (markup.length > MAX_MARKUP) return "markup too large";
  let pos = 0, n = 0;
  ELEMENT.lastIndex = 0;
  while (pos < markup.length && /\S/.test(markup.slice(pos))) {
    ELEMENT.lastIndex = pos;
    const m = ELEMENT.exec(markup);
    if (!m) return "markup must be self-closing shape elements only";
    if (!TAGS.has(m[1]!)) return `element <${m[1]}> is not allowed`;
    if (++n > MAX_OPS) return "too many elements";
    for (const a of m[2]!.matchAll(ATTR_RE)) {
      const rule = ATTR[a[1]!];
      if (!rule) return `attribute "${a[1]}" is not allowed`;
      if (!(typeof rule === "function" ? rule(a[2]!) : rule.test(a[2]!))) return `bad value for "${a[1]}"`;
    }
    pos = ELEMENT.lastIndex;
  }
  if (!n) return "no shapes";
  return null;
}

function tier(markup: unknown, rootStroke: number): string | null {
  const bad = markupProblem(markup);
  if (bad) return bad;
  try {
    const ops = parseIconMarkup(markup as string, rootStroke);
    if (!ops.length) return "no shapes";
    for (const o of ops) if (/NaN|undefined|Infinity/.test(o.d) || !(o.fill || o.stroke)) return "unusable shape";
  } catch (e) { return e instanceof Error ? e.message : "unparseable markup"; }
  return null;
}

const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f<>&"']/g, "").trim();
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const isCat = (c: string): boolean => (CATEGORIES as readonly string[]).includes(c);

/** validate an untrusted pack object; returns a normalised copy (ids still un-namespaced) */
export function validateUserPack(json: unknown): Result<UserPack> {
  const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
  if (!json || typeof json !== "object" || Array.isArray(json)) return fail("not an icon pack (expected a JSON object)");
  const j = json as Record<string, unknown>;
  if (j.v !== 1) return fail("unsupported pack version (expected v: 1)");
  if (typeof j.name !== "string") return fail("pack needs a name");
  const name = clean(j.name).slice(0, 40);
  if (!name || !slug(name)) return fail("pack needs a name with letters or digits");
  if (!Array.isArray(j.icons)) return fail("pack needs an icons array");
  if (j.icons.length === 0) return fail("pack has no icons");
  if (j.icons.length > MAX_ICONS) return fail(`too many icons (max ${MAX_ICONS})`);
  const seen = new Set<string>();
  const icons: UserIcon[] = [];
  for (let i = 0; i < j.icons.length; i++) {
    const r = j.icons[i] as Record<string, unknown> | null;
    const at = `icon #${i + 1}`;
    if (!r || typeof r !== "object" || Array.isArray(r)) return fail(`${at}: not an object`);
    if (typeof r.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id) || r.id.length > 60) return fail(`${at}: id must be kebab-case (max 60)`);
    if (seen.has(r.id)) return fail(`${at}: duplicate id "${r.id}"`);
    seen.add(r.id);
    if (typeof r.name !== "string" || !clean(r.name)) return fail(`${at} (${r.id}): needs a name`);
    const aliases = r.aliases === undefined ? [] : r.aliases;
    if (!Array.isArray(aliases) || aliases.length > 12 || aliases.some((a) => typeof a !== "string" || a.length > 40)) return fail(`${at} (${r.id}): aliases must be up to 12 short strings`);
    if (typeof r.category !== "string" || !isCat(r.category)) return fail(`${at} (${r.id}): category must be one of ${CATEGORIES.join(", ")}`);
    const bd = tier(r.detail, ROOT_STROKE.detail); if (bd) return fail(`${at} (${r.id}) detail: ${bd}`);
    const bg = tier(r.glyph, ROOT_STROKE.glyph); if (bg) return fail(`${at} (${r.id}) glyph: ${bg}`);
    icons.push({ id: r.id, name: clean(r.name).slice(0, 80), aliases: (aliases as string[]).map((a) => clean(a)).filter(Boolean), category: r.category, detail: r.detail as string, glyph: r.glyph as string });
  }
  return { ok: true, value: { v: 1, name, icons } };
}

/** text -> validated pack; enforces the byte cap first */
export function parsePackText(text: string): Result<UserPack> {
  if (text.length > MAX_PACK_BYTES) return { ok: false, error: "file too large (max 5 MB)" };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, error: "not valid JSON" }; }
  return validateUserPack(json);
}

/* ------------------------------------------------------------------ persistence (own tiny IndexedDB) */

export interface StoredPack { key: string; pack: UserPack }
export interface PackStore { put(p: StoredPack): Promise<void>; delete(key: string): Promise<void>; all(): Promise<StoredPack[]>; close(): void }

export function memStore(): PackStore & { data: Map<string, StoredPack> } {
  const data = new Map<string, StoredPack>();
  return { data, async put(p) { data.set(p.key, structuredClone(p)); }, async delete(k) { data.delete(k); }, async all() { return [...data.values()].map((x) => structuredClone(x)); }, close() {} };
}

export function idbStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): PackStore {
  let dbp: Promise<IDBDatabase> | null = null;
  let closed = false;
  const open = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error("IndexedDB unavailable"));
    return (dbp ??= new Promise((res, rej) => {
      const r = factory.open("archypaint-icon-packs", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("packs", { keyPath: "key" }); };
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbp = null; }; if (closed) db.close(); res(db); };
      r.onerror = () => { dbp = null; rej(r.error); };
      r.onblocked = () => { dbp = null; rej(new Error("IndexedDB blocked")); };
    }));
  };
  const done = (tx: IDBTransaction): Promise<void> => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error("aborted")); });
  return {
    async put(p) { const db = await open(); const tx = db.transaction("packs", "readwrite"); tx.objectStore("packs").put(p); await done(tx); },
    async delete(k) { const db = await open(); const tx = db.transaction("packs", "readwrite"); tx.objectStore("packs").delete(k); await done(tx); },
    async all() {
      const db = await open();
      return new Promise<StoredPack[]>((res, rej) => { const q = db.transaction("packs").objectStore("packs").getAll(); q.onsuccess = () => res(q.result as StoredPack[]); q.onerror = () => rej(q.error); });
    },
    close() { closed = true; dbp?.then((d) => d.close()).catch(() => {}); dbp = null; },
  };
}

/* ------------------------------------------------------------------ registry */

let store: PackStore | null = null;
const getStore = (): PackStore => (store ??= idbStore());
const packs = new Map<string, { name: string; count: number }>();

/** tests: swap the backend (null = default IndexedDB) */
export function setPackStore(s: PackStore | null): void { store?.close(); store = s; }
export function resetUserPacks(): void { packs.clear(); }
export function closeUserPackStore(): void { store?.close(); store = null; }

export function listUserPacks(): UserPackInfo[] { return [...packs].map(([key, v]) => ({ key, ...v })); }

function install(pack: UserPack): UserPackInfo {
  const key = `user-${slug(pack.name)}`;
  packs.set(key, { name: pack.name, count: pack.icons.length }); // registry first: listeners fired by the install read it
  installUserIcons(key, pack.icons.map((i) => ({ ...i, id: `${key}-${i.id}` })));
  return { key, name: pack.name, count: pack.icons.length };
}

/** validate + install + persist. Persisting is best effort: the pack still works for this session if storage fails. */
export async function addUserPackFromText(text: string): Promise<Result<UserPackInfo & { persisted: boolean }>> {
  const v = parsePackText(text);
  if (!v.ok) return v;
  const info = install(v.value);
  let persisted = true;
  try { await getStore().put({ key: info.key, pack: v.value }); } catch { persisted = false; }
  return { ok: true, value: { ...info, persisted } };
}

export async function removeUserPack(key: string): Promise<void> {
  packs.delete(key);
  removeUserIcons(key);
  try { await getStore().delete(key); } catch { /* nothing more to do */ }
}

/** reload persisted packs (called lazily by icon-pack's ensureIcons). Invalid stored packs are dropped, not thrown. */
export async function loadStoredUserPacks(): Promise<void> {
  let all: StoredPack[];
  try { all = await getStore().all(); } catch { return; }
  for (const s of all) {
    const v = validateUserPack(s.pack);
    if (v.ok) install(v.value);
    else void getStore().delete(s.key).catch(() => {});
  }
}
