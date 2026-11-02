import { headerPart, orderEl, serializeArch, type ArchMeta, type ArchView, type ElLike, type Settings } from "./format";
import type { GroupInfo } from "../scene";
import { INDEX, bkey, newBoardId } from "./keys";
export { INDEX, bkey, newBoardId };

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

/**
 * Layout of the one "docs" store. Every board has its own records, keyed `b:<id>:<kind>`; a single small "boards" record is the index
 * (what the switcher lists, which board is open, boards deleted but still undoable). Reading the list never touches a document.
 */
const idOf = (key: string): string => key.split(":")[1] ?? "";

/** which write of a board a tab last saw: another tab's write is detected by `tab` + `seq` */
export interface Stamp { tab?: string | undefined; seq: number }
export interface DocRec { key: string; text: string; name: string; savedAt: number; fileDirty: boolean; tab?: string; seq?: number }
export interface ViewRec { key: string; x: number; y: number; zoom: number }
export interface HandleRec { key: string; handle: unknown }
export interface BoardMeta { id: string; name: string; savedAt: number }
export interface IndexRec { key: typeof INDEX; active: string; boards: BoardMeta[]; /** savedAt of the newest old-layout "current" already copied into a board: older builds keep writing there, newer writes are recovered once */ legacy?: { at: number }; /** deleted boards waiting out their undo window */ trash?: Array<{ id: string; at: number; meta: BoardMeta }> }
export type Rec = DocRec | ViewRec | HandleRec | IndexRec;

/** one read-write transaction over the store: reads are awaited, writes are queued and commit together */
export interface Tx { get(key: string): Promise<Rec | undefined>; put(rec: Rec): void; del(key: string): void }

export interface WriteOpts {
  /** the writer's identity and what it last saw of this board; omitted = unguarded (no other writer exists) */
  guard?: { tab: string; known: Stamp | null };
  /** id for the copy a conflicting write is saved under */
  spare?: string;
}
export interface WriteResult { ok: boolean; id: string; stamp: Stamp }

export interface KV {
  get(key: string): Promise<Rec | undefined>;
  /** run `fn` atomically (a readwrite transaction); an exception rolls everything back */
  tx<T>(fn: (t: Tx) => Promise<T>): Promise<T>;
  /**
   * atomically: copy the existing "current" of the board to its "backup", write the new "current", and upsert the board in the index.
   * With `guard`, a board changed by ANOTHER tab since this one last saw it (or deleted by it) is not overwritten: the document is saved
   * as a new board instead (`ok: false`, `id` = that copy).
   */
  writeDoc(rec: DocRec, o?: WriteOpts): Promise<WriteResult>;
  /** unload path: must start the write synchronously (no awaits before it) or the page may be gone first; skips backup rotation */
  writeDocNow(rec: DocRec, o?: WriteOpts): Promise<WriteResult>;
  put(rec: ViewRec | HandleRec): Promise<void>;
  delete(key: string): Promise<void>;
  close(): void;
}

const copyName = (n: string): string => `${n} (copy)`.slice(0, 200);

function write(tx: KV["tx"], rec: DocRec, o: WriteOpts | undefined, rotate: boolean): Promise<WriteResult> {
  return tx(async (t) => {
    const id = idOf(rec.key);
    const [cur, ixr] = await Promise.all([t.get(rec.key), t.get(INDEX)]) as [DocRec | undefined, IndexRec | undefined];
    const g = o?.guard;
    const mine = !g || (cur ? cur.tab === g.tab || (!!g.known && cur.tab === g.known.tab && (cur.seq ?? 0) === g.known.seq) : !g.known);
    let w = rec, bid = id;
    if (!mine) { bid = o?.spare ?? `c${Math.random().toString(36).slice(2, 8)}`; w = { ...rec, key: bkey(bid, "current"), name: copyName(rec.name) }; }
    else if (cur && rotate) t.put({ ...cur, key: bkey(id, "backup") });
    const stamp: Stamp = { tab: g?.tab, seq: mine ? (cur?.seq ?? 0) + 1 : 1 };
    t.put(g ? { ...w, tab: g.tab, seq: stamp.seq } : w);
    const ix: IndexRec = ixr ?? { key: INDEX, active: bid, boards: [] };
    const m: BoardMeta = { id: bid, name: w.name, savedAt: w.savedAt }, i = ix.boards.findIndex((b) => b.id === bid);
    if (i < 0) ix.boards.push(m); else ix.boards[i] = m;
    if (ix.trash) ix.trash = ix.trash.filter((x) => x.id !== bid); // writing to a board revives it
    if (!mine || i < 0) ix.active = bid; // a board new to the index (a copy, a shared link made editable) is the one now open
    t.put(ix);
    return { ok: mine, id: bid, stamp };
  });
}
type Base = Omit<KV, "writeDoc" | "writeDocNow" | "put" | "delete">;
const withDocs = <B extends Base>(k: B): B & KV => ({
  ...k,
  writeDoc: (rec, o) => write(k.tx, rec, o, true),
  writeDocNow: (rec, o) => write(k.tx, rec, o, false),
  put: (rec) => k.tx(async (t) => { t.put(rec); }),
  delete: (key) => k.tx(async (t) => { t.del(key); }),
});

export function memKV(): KV & { data: Map<string, Rec> } {
  const data = new Map<string, Rec>();
  let chain: Promise<unknown> = Promise.resolve(); // transactions run one at a time, like IndexedDB readwrite transactions on one store
  const t: Tx = { get: async (k) => data.get(k), put: (r) => { data.set(r.key, r); }, del: (k) => { data.delete(k); } };
  return withDocs({
    data,
    async get(k: string) { return data.get(k); },
    tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> { const r = chain.then(() => fn(t)); chain = r.catch(() => {}); return r; },
    close() { data.clear(); },
  });
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
  return withDocs({
    async get(key: string) { const db = await open(); return reqP(db.transaction(STORE, "readonly").objectStore(STORE).get(key)) as Promise<Rec | undefined>; },
    // no await before the transaction when the connection is already open: the unload path relies on the first request being issued synchronously
    async tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
      const db = dbNow ?? await open();
      const tx = db.transaction(STORE, "readwrite"), st = tx.objectStore(STORE);
      const done = txDone(tx);
      try {
        const r = await fn({ get: (k) => reqP(st.get(k)) as Promise<Rec | undefined>, put: (rec) => { st.put(rec); }, del: (k) => { st.delete(k); } });
        await done;
        return r;
      } catch (e) { try { tx.abort(); } catch { /* already finished */ } done.catch(() => {}); throw e; }
    },
    close() { closed = true; dbNow = null; dbp?.then((d) => d.close()).catch(() => {}); dbp = null; },
  });
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
  /** the board being saved, and which write of it this tab last saw (null = no record yet) */
  id = "b0";
  known: Stamp | null = null;
  /** fired when a write found the board changed elsewhere and saved this tab's version as a new board instead */
  onMoved?: (id: string, name: string) => void;
  /** identifies this page load among the tabs sharing the store */
  private readonly tab = `t${Math.random().toString(36).slice(2, 8)}`;
  private inflight: Promise<void> | null = null;
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

  /** save to another board from now on (the caller has flushed the previous one). `known` = the stamp of the record just loaded. */
  bind(id: string, known: Stamp | null): void {
    this.id = id; this.known = known; this.armed = true; this.savedKey = this.key(); this.savedView = this.viewKey();
    this.clearTimers();
    this.emit("saved");
  }
  /** write the open board now (also its view); true when nothing is left unsaved */
  async flush(): Promise<boolean> {
    if (!this.armed || this.disposed) return true;
    this.clearTimers();
    this.writeView();
    for (let i = 0; i < 3; i++) {
      await this.inflight?.catch(() => {});
      this.rerun = false;
      await this.run();
      if (this.key() === this.savedKey) return true;
    }
    return false;
  }
  private clearTimers(): void {
    if (this.timer !== null) this.env.clearTimeout(this.timer);
    if (this.idleH !== null) this.env.cancelIdle(this.idleH);
    if (this.viewTimer !== null) this.env.clearTimeout(this.viewTimer);
    this.timer = this.idleH = this.viewTimer = null;
  }
  private moved(r: WriteResult, name: string): void {
    this.known = r.stamp;
    if (r.ok) return;
    this.id = r.id;
    this.onMoved?.(r.id, copyName(name));
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
    this.kv.put({ key: bkey(this.id, "view"), x: v.x, y: v.y, zoom: v.zoom }).catch((e) => this.fail(e));
  }

  /** serialise (sliced) and write now */
  run(): Promise<void> {
    if (this.running) { this.rerun = true; return this.inflight ?? Promise.resolve(); }
    return (this.inflight = this.runOnce().finally(() => { this.inflight = null; }));
  }
  private async runOnce(): Promise<void> {
    if (!this.armed || this.disposed) return;
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
      const name = this.src.meta().name;
      this.moved(await this.kv.writeDoc({ key: bkey(this.id, "current"), text, name, savedAt: this.env.now(), fileDirty: this.src.fileDirty() }, { guard: { tab: this.tab, known: this.known }, spare: newBoardId() }), name);
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
      const name = this.src.meta().name;
      this.kv.writeDocNow({ key: bkey(this.id, "current"), text, name, savedAt: this.env.now(), fileDirty }, { guard: { tab: this.tab, known: this.known }, spare: newBoardId() }).then((r) => this.moved(r, name), (e) => this.fail(e));
    } catch (e) { this.fail(e); }
  }

  async loadIndex(): Promise<IndexRec | undefined> {
    try { return (await this.kv.get(INDEX)) as IndexRec | undefined; } catch (e) { this.fail(e); return undefined; }
  }
  /** savedAt of the old-layout "current" record, 0 when there is none (cheap: one read) */
  async legacySavedAt(): Promise<number> {
    try { return ((await this.kv.get("current")) as DocRec | undefined)?.savedAt ?? 0; } catch { return 0; }
  }
  /** is there a document in the old single-document layout (to be moved into a board) */
  async hasLegacy(): Promise<boolean> {
    try { return !!((await this.kv.get("current")) ?? (await this.kv.get("backup"))); } catch (e) { this.fail(e); return false; }
  }

  /** the records of one board: "current", the rolling "backup", the saved view and the file handle */
  async loadRecords(id: string = this.id): Promise<{ current?: DocRec; backup?: DocRec; view?: ViewRec; handle?: unknown }> {
    try {
      const [c, b, v, h] = await Promise.all([this.kv.get(bkey(id, "current")), this.kv.get(bkey(id, "backup")), this.kv.get(bkey(id, "view")), this.kv.get(bkey(id, "handle"))]);
      return { ...(c ? { current: c as DocRec } : {}), ...(b ? { backup: b as DocRec } : {}), ...(v ? { view: v as ViewRec } : {}), ...(h ? { handle: (h as HandleRec).handle } : {}) };
    } catch (e) { this.fail(e); return {}; }
  }

  async saveHandle(handle: unknown | null): Promise<void> {
    const key = bkey(this.id, "handle");
    try { if (handle) await this.kv.put({ key, handle }); else await this.kv.delete(key); } catch { /* handles are best effort */ }
  }

  async clear(): Promise<void> {
    try { await Promise.all([this.kv.delete(bkey(this.id, "current")), this.kv.delete(bkey(this.id, "backup")), this.kv.delete(bkey(this.id, "view"))]); } catch (e) { this.fail(e); }
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
