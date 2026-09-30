import { headerPart, orderEl, serializeArch, type ArchMeta, type ArchView, type ElLike, type Settings } from "./format";
import type { GroupInfo } from "../scene";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

/* ------------------------------------------------------------------ pure parts (tested without a browser) */

/** yield to the event loop so input and rendering can run between slices */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((r) => setTimeout(r, 0));
}

export interface SliceInput {
  els: readonly ElLike[];
  groups: GroupInfo[];
  meta: ArchMeta; view: ArchView; settings: Settings;
  extra?: Record<string, unknown>;
  elExtra?: Record<string, Record<string, unknown>>;
}
export interface SliceOpts {
  /** time budget per slice, ms (default 4) */
  budgetMs?: number;
  /** return true to abandon (the document changed mid-serialise, so the snapshot would be torn) */
  isStale?: () => boolean;
  yieldFn?: () => Promise<void>;
  now?: () => number;
  /** above this size skip the z-sort (a sort cannot be sliced); Map order is already z order in practice */
  sortLimit?: number;
}

/**
 * Serialise in time-sliced chunks so a 200k-element document never blocks the main thread for more than
 * about one slice at a time. Returns null when `isStale` fired — the caller retries instead of writing a torn snapshot.
 */
export async function serializeSliced(inp: SliceInput, o: SliceOpts = {}): Promise<string | null> {
  const budget = o.budgetMs ?? 4, now = o.now ?? (() => performance.now()), yieldFn = o.yieldFn ?? yieldToMain;
  const { head, tail } = headerPart({ meta: inp.meta, view: inp.view, settings: inp.settings, groups: inp.groups, ...(inp.extra ? { extra: inp.extra } : {}) });
  const sortLimit = o.sortLimit ?? 50_000;
  const els = inp.els.length <= sortLimit ? [...inp.els].sort((a, b) => a.z - b.z) : inp.els;
  const parts: string[] = [];
  let t0 = now();
  for (let i = 0; i < els.length; i++) {
    const e = els[i]!;
    parts.push(orderEl(e, inp.elExtra?.[e.id]));
    if ((i & 127) === 127 && now() - t0 > budget) {
      await yieldFn();
      if (o.isStale?.()) return null;
      t0 = now();
    }
  }
  if (o.isStale?.()) return null;
  return head + (parts.length ? "\n" : "") + parts.join(",\n") + tail;
}

/* ------------------------------------------------------------------ key-value backend */

export interface DocRec { key: "current" | "backup"; text: string; name: string; savedAt: number; fileDirty: boolean }
export interface ViewRec { key: "view"; x: number; y: number; zoom: number }
export interface HandleRec { key: "handle"; handle: unknown }
export type Rec = DocRec | ViewRec | HandleRec;

export interface KV {
  get(key: Rec["key"]): Promise<Rec | undefined>;
  /** atomically: copy the existing "current" to "backup", then write the new "current" */
  writeDoc(rec: DocRec): Promise<void>;
  /** unload path: must start the write synchronously (no awaits before it) or the page may be gone first; skips backup rotation */
  writeDocNow(rec: DocRec): Promise<void>;
  put(rec: ViewRec | HandleRec): Promise<void>;
  delete(key: Rec["key"]): Promise<void>;
  close(): void;
}

export function memKV(): KV & { data: Map<string, Rec> } {
  const data = new Map<string, Rec>();
  return {
    data,
    async get(k) { return data.get(k); },
    async writeDoc(rec) { const cur = data.get("current"); if (cur) data.set("backup", { ...(cur as DocRec), key: "backup" }); data.set("current", rec); },
    async writeDocNow(rec) { data.set("current", rec); },
    async put(r) { data.set(r.key, r); },
    async delete(k) { data.delete(k); },
    close() { data.clear(); },
  };
}

const DB = "archypaint", STORE = "docs";

const reqP = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (tx: IDBTransaction): Promise<void> => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error("transaction aborted")); });

/** IndexedDB backend. The connection is opened lazily and closed in close() (also on versionchange, so a second tab can upgrade). */
export function idbKV(factory: IDBFactory = indexedDB): KV {
  let dbp: Promise<IDBDatabase> | null = null;
  let closed = false;
  let dbNow: IDBDatabase | null = null; // set once the connection is open, so the unload path can write synchronously
  const open = (): Promise<IDBDatabase> => (dbp ??= new Promise((res, rej) => {
    const r = factory.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "key" }); };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbp = null; dbNow = null; }; if (closed) db.close(); else dbNow = db; res(db); };
    r.onerror = () => { dbp = null; rej(r.error); };
    r.onblocked = () => { dbp = null; rej(new Error("IndexedDB blocked by another tab")); };
  }));
  return {
    async get(key) { const db = await open(); return reqP(db.transaction(STORE, "readonly").objectStore(STORE).get(key)) as Promise<Rec | undefined>; },
    async writeDoc(rec) {
      const db = await open();
      const tx = db.transaction(STORE, "readwrite"); const st = tx.objectStore(STORE);
      const done = txDone(tx);
      const cur = await reqP(st.get("current")) as DocRec | undefined;
      if (cur) st.put({ ...cur, key: "backup" });
      st.put(rec);
      await done;
    },
    writeDocNow(rec) {
      const db = dbNow;
      if (!db) return this.writeDoc(rec);
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      return txDone(tx);
    },
    async put(rec) { const db = await open(); const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(rec); await txDone(tx); },
    async delete(key) { const db = await open(); const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(key); await txDone(tx); },
    close() { closed = true; dbNow = null; dbp?.then((d) => d.close()).catch(() => {}); dbp = null; },
  };
}

/* ------------------------------------------------------------------ autosave */

export interface StorageSource {
  /** changes whenever the scene changes (Scene.nonce) */
  version(): number;
  /** element count, O(1) — autosave consults it on every edit, so it must not copy the scene */
  count?(): number;
  /** live references — cheap; consistency is guaranteed by the version check, not by copying */
  snapshot(): { els: readonly ElLike[]; groups: GroupInfo[] };
  meta(): ArchMeta; view(): ArchView; settings(): Settings;
  extra(): Record<string, unknown>;
  elExtra(): Record<string, Record<string, unknown>>;
  /** true when the document has unsaved changes relative to its file */
  fileDirty(): boolean;
}

export interface StorageEnv {
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  now: () => number;
  idle: (f: () => void) => unknown;
  cancelIdle: (h: unknown) => void;
  yieldFn?: () => Promise<void>;
}

export function browserEnv(): StorageEnv {
  const w = globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  return {
    setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as number),
    now: () => Date.now(),
    idle: (f) => (w.requestIdleCallback ? w.requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 0)),
    cancelIdle: (h) => (w.cancelIdleCallback ? w.cancelIdleCallback(h as number) : clearTimeout(h as number)),
  };
}

export const DEBOUNCE_MS = 800;
export const FAST_DEBOUNCE_MS = 250;
export const FAST_SAVE_MAX_ELS = 3000;
export const MAX_WAIT_MS = 10_000;
export const VIEW_DEBOUNCE_MS = 1500;
const MAX_ATTEMPTS = 3;

export class Autosave {
  lastError: unknown = null;
  private armed = false;
  private timer: unknown = null;
  private idleH: unknown = null;
  private viewTimer: unknown = null;
  private firstAt = 0;
  private running = false;
  private rerun = false;
  private disposed = false;
  private savedKey = "";
  private savedView = "";
  private off: Array<() => void> = [];

  constructor(private src: StorageSource, private kv: KV, private emit: (s: SaveStatus) => void, private env: StorageEnv = browserEnv()) {}

  /** page lifecycle: hide/unload -> best-effort synchronous flush */
  attachLifecycle(doc: Document = document, win: Window = window): void {
    const hidden = () => { if (doc.visibilityState === "hidden") this.flushSync(); };
    const pagehide = () => this.flushSync();
    doc.addEventListener("visibilitychange", hidden);
    win.addEventListener("pagehide", pagehide);
    this.off.push(() => doc.removeEventListener("visibilitychange", hidden), () => win.removeEventListener("pagehide", pagehide));
  }

  /** autosave stays disarmed until the startup restore has finished, so an empty scene can never overwrite a saved one */
  arm(): void { this.armed = true; this.savedKey = this.key(); this.savedView = this.viewKey(); }

  private key(): string { return `${this.src.version()}|${this.src.meta().name}|${JSON.stringify(this.src.settings())}|${this.src.fileDirty() ? 1 : 0}`; }
  private viewKey(): string { const v = this.src.view(); return `${v.x.toFixed(1)}|${v.y.toFixed(1)}|${v.zoom.toFixed(4)}`; }

  schedule(): void {
    if (!this.armed || this.disposed) return;
    this.emit("dirty");
    const now = this.env.now();
    if (this.timer === null && this.idleH === null) this.firstAt = now;
    if (this.timer !== null) this.env.clearTimeout(this.timer);
    // small sheets serialise in well under a frame, so save quickly: the window in which an edit can be lost on close is tiny
    const debounce = (this.src.count?.() ?? this.src.snapshot().els.length) < FAST_SAVE_MAX_ELS ? FAST_DEBOUNCE_MS : DEBOUNCE_MS;
    const wait = Math.max(0, Math.min(debounce, MAX_WAIT_MS - (now - this.firstAt)));
    this.timer = this.env.setTimeout(() => {
      this.timer = null;
      this.idleH = this.env.idle(() => { this.idleH = null; void this.run(); });
    }, wait);
  }

  /** the view (pan/zoom) is a tiny separate record, debounced: panning never rewrites the whole document */
  scheduleView(): void {
    if (!this.armed || this.disposed) return;
    if (this.viewTimer !== null) this.env.clearTimeout(this.viewTimer);
    this.viewTimer = this.env.setTimeout(() => { this.viewTimer = null; this.writeView(); }, VIEW_DEBOUNCE_MS);
  }

  private writeView(): void {
    const k = this.viewKey();
    if (k === this.savedView || this.disposed) return;
    this.savedView = k;
    const v = this.src.view();
    this.kv.put({ key: "view", x: v.x, y: v.y, zoom: v.zoom }).catch((e) => this.fail(e));
  }

  /** serialise (sliced) and write now */
  async run(): Promise<void> {
    if (!this.armed || this.disposed) return;
    if (this.running) { this.rerun = true; return; }
    this.running = true;
    try {
      const k = this.key();
      if (k === this.savedKey) { this.emit("saved"); return; }
      this.emit("saving");
      let text: string | null = null;
      let version = this.src.version();
      for (let a = 0; a < MAX_ATTEMPTS && text === null && !this.disposed; a++) {
        version = this.src.version();
        const snap = this.src.snapshot();
        text = await serializeSliced(
          { ...snap, meta: this.src.meta(), view: this.src.view(), settings: this.src.settings(), extra: this.src.extra(), elExtra: this.src.elExtra() },
          { isStale: () => this.src.version() !== version || this.disposed, ...(this.env.yieldFn ? { yieldFn: this.env.yieldFn } : {}) },
        );
      }
      if (this.disposed) return;
      if (text === null) { this.emit("dirty"); this.rerun = true; return; } // still being edited; try again after the next quiet period
      await this.kv.writeDoc({ key: "current", text, name: this.src.meta().name, savedAt: this.env.now(), fileDirty: this.src.fileDirty() });
      this.savedKey = `${version}|${this.src.meta().name}|${JSON.stringify(this.src.settings())}|${this.src.fileDirty() ? 1 : 0}`;
      this.lastError = null;
      this.emit(this.key() === this.savedKey ? "saved" : "dirty");
    } catch (e) {
      this.fail(e);
    } finally {
      this.running = false;
      if (this.rerun && !this.disposed) { this.rerun = false; this.schedule(); }
    }
  }

  /** hidden / pagehide: the page may be frozen, so serialise synchronously and fire the write without awaiting it */
  flushSync(): void {
    if (!this.armed || this.disposed) return;
    this.writeView();
    if (this.key() === this.savedKey) return;
    try {
      const snap = this.src.snapshot();
      const text = serializeArch({ meta: this.src.meta(), view: this.src.view(), settings: this.src.settings(), scene: { els: snap.els as never, groups: snap.groups }, extra: this.src.extra(), elExtra: this.src.elExtra() });
      const version = this.src.version();
      const fileDirty = this.src.fileDirty();
      this.savedKey = `${version}|${this.src.meta().name}|${JSON.stringify(this.src.settings())}|${fileDirty ? 1 : 0}`;
      this.kv.writeDocNow({ key: "current", text, name: this.src.meta().name, savedAt: this.env.now(), fileDirty }).catch((e) => this.fail(e));
    } catch (e) { this.fail(e); }
  }

  /** newest usable document text: "current", else the rolling "backup" */
  async loadRecords(): Promise<{ current?: DocRec; backup?: DocRec; view?: ViewRec; handle?: unknown }> {
    try {
      const [c, b, v, h] = await Promise.all([this.kv.get("current"), this.kv.get("backup"), this.kv.get("view"), this.kv.get("handle")]);
      return { ...(c ? { current: c as DocRec } : {}), ...(b ? { backup: b as DocRec } : {}), ...(v ? { view: v as ViewRec } : {}), ...(h ? { handle: (h as HandleRec).handle } : {}) };
    } catch (e) { this.fail(e); return {}; }
  }

  async saveHandle(handle: unknown | null): Promise<void> {
    try { if (handle) await this.kv.put({ key: "handle", handle }); else await this.kv.delete("handle"); } catch { /* handles are best effort */ }
  }

  async clear(): Promise<void> {
    try { await Promise.all([this.kv.delete("current"), this.kv.delete("backup"), this.kv.delete("view")]); } catch (e) { this.fail(e); }
  }

  private fail(e: unknown): void { this.lastError = e; if (!this.disposed) this.emit("error"); }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) this.env.clearTimeout(this.timer);
    if (this.viewTimer !== null) this.env.clearTimeout(this.viewTimer);
    if (this.idleH !== null) this.env.cancelIdle(this.idleH);
    this.timer = this.idleH = this.viewTimer = null;
    for (const f of this.off) f();
    this.off = [];
    this.kv.close();
  }
}
