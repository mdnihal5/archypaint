import type { HistState } from "../history";
import { bkey, INDEX, newBoardId } from "./keys";
import type { BoardMeta, DocRec, IndexRec, KV, Stamp } from "./storage";

/**
 * Boards: several designs in one browser. This whole module is a lazy chunk (loaded on the first switcher open, the first
 * file open, or once when an old single-document store has to be migrated); the hot path (restore, autosave) lives in
 * storage.ts and io/index.ts.
 *
 * Only the OPEN board's scene is in memory. Switching = flush the open board, remember its last few undo steps, load the other.
 */

export const UNDO_MS = 7000;
export const MAX_BOARDS = 100;
export const STASH_STEPS = 20;
/** boards deleted by another tab are only swept at startup when they have been waiting this long (never under a live undo toast) */
const SWEEP_AGE_MS = 60_000;
const KINDS = ["current", "backup", "view", "handle"] as const;

/* ------------------------------------------------------------------ migration of the old single-document layout */

/**
 * The old layout had one document: "current", "backup", "view" and "handle" at the top level. Move them into board `b0` and write the
 * index, all in ONE transaction: either the whole move happens or nothing does, and a second tab doing the same sees the index and stops.
 * Nothing is rewritten: the records are copied as stored. The old keys are LEFT in place as a read-only snapshot: a cached older build
 * or a stale tab still finds its sheet there, and what it writes afterwards is picked up by recoverLegacy.
 */
export function migrateLegacy(kv: KV): Promise<IndexRec | undefined> {
  return kv.tx(async (t) => {
    const have = await t.get(INDEX) as IndexRec | undefined;
    if (have) return have;
    const [current, backup, view, handle] = await Promise.all(KINDS.map((k) => t.get(k)));
    const src = (current ?? backup) as DocRec | undefined;
    if (!src) return undefined;
    const id = "b0";
    for (const [k, rec] of [["current", current], ["backup", backup], ["view", view], ["handle", handle]] as const) if (rec) t.put({ ...rec, key: bkey(id, k) } as never);
    const ix: IndexRec = { key: INDEX, active: id, boards: [{ id, name: src.name || "untitled", savedAt: src.savedAt }], legacy: { at: src.savedAt } };
    t.put(ix);
    return ix;
  });
}

const recoveredName = (n: string): string => `${n || "untitled"} (recovered)`.slice(0, 200);

/**
 * An older build (cached by the service worker, or a tab left open across the update) kept writing the old-layout "current" after the
 * migration. If that record is newer than the last one imported, copy it into a new board "<name> (recovered)" and remember its savedAt
 * in the index so the same write is never imported twice. The open board is not touched. Returns the new board, or undefined.
 */
export function recoverLegacy(kv: KV): Promise<{ id: string; name: string } | undefined> {
  return kv.tx(async (t) => {
    const ix = await t.get(INDEX) as IndexRec | undefined;
    const cur = await t.get("current") as DocRec | undefined;
    if (!ix || !cur || cur.savedAt <= (ix.legacy?.at ?? 0)) return undefined;
    let id = newBoardId();
    while (ix.boards.some((b) => b.id === id) || ix.trash?.some((x) => x.id === id)) id = newBoardId();
    const name = recoveredName(cur.name);
    t.put({ ...cur, key: bkey(id, "current"), name } as DocRec);
    const view = await t.get("view");
    if (view) t.put({ ...view, key: bkey(id, "view") } as never);
    ix.boards.push({ id, name, savedAt: cur.savedAt });
    ix.legacy = { at: cur.savedAt };
    t.put(ix);
    return { id, name };
  });
}

/** delete the records of boards whose undo window is over (all of them when `maxAge` is 0) */
export function sweepTrash(kv: KV, now = Date.now(), maxAge = SWEEP_AGE_MS): Promise<number> {
  return kv.tx(async (t) => {
    const ix = await t.get(INDEX) as IndexRec | undefined;
    const old = ix?.trash?.filter((x) => now - x.at >= maxAge) ?? [];
    if (!ix || !old.length) return 0;
    for (const x of old) for (const k of KINDS) t.del(bkey(x.id, k));
    ix.trash = ix.trash!.filter((x) => !old.includes(x));
    t.put(ix);
    return old.length;
  });
}

/** image keys used by every board but the open one (the startup image sweep must not delete their pictures) */
export async function otherImageKeys(kv: KV, openId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const ix = await kv.get(INDEX) as IndexRec | undefined;
  for (const b of [...(ix?.boards ?? []), ...(ix?.trash?.map((x) => x.meta) ?? [])]) {
    if (b.id === openId) continue;
    for (const k of ["current", "backup"] as const) {
      const text = ((await kv.get(bkey(b.id, k))) as DocRec | undefined)?.text;
      if (text) for (const m of text.matchAll(/"img":\s*"([0-9a-f]{16})"/g)) out.add(m[1]!);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ the manager */

export interface BoardRecs { current?: DocRec; backup?: DocRec; view?: { x: number; y: number; zoom: number }; handle?: unknown }
export interface BoardRow extends BoardMeta { current: boolean }
export interface Removed { name: string; /** put the board back; false once its undo window is over */ undo(): Promise<boolean> }

/** what the manager needs from createIO (everything else it does through the KV) */
export interface BoardsHost {
  kv: KV;
  /** the open board */
  id(): string;
  name(): string;
  /** write the open board now; false if something is still unsaved afterwards */
  flush(): Promise<boolean>;
  /** which write of the open board this tab last saw (what a stash is valid for) */
  stamp(): Stamp | null;
  loadRecords(id: string): Promise<BoardRecs>;
  /** copy out the open board's newest undo steps */
  takeHistory(steps: number): HistState;
  /**
   * Make `id` the open board, synchronously. Returns false (and changes nothing) when its records exist but cannot be read.
   * `recs` empty = a new, empty board named `name`. `hist` is adopted as the undo stacks.
   */
  activate(id: string, name: string, recs: BoardRecs, hist?: HistState): boolean;
  /** rename the open board (document name; saved with the next autosave) */
  setName(name: string): void;
  clean(name: string): string;
  say(level: "info" | "warn" | "error", text: string): void;
}

export interface BoardsApi {
  /** the open board first, then the others by last edit */
  list(): Promise<BoardRow[]>;
  create(name?: string): Promise<string | null>;
  switchTo(id: string): Promise<boolean>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string): Promise<string | null>;
  remove(id: string): Promise<Removed | null>;
  /** open a new board and let `fill` load a document into it (File > Open: never overwrites the open board) */
  createFrom(name: string, fill: () => void): Promise<boolean>;
  /** undo stacks currently held for boards that are not open (diagnostics, tests) */
  stashed(): { boards: number; snapshots: number };
  dispose(): void;
}

export function createBoards(h: BoardsHost, o: { undoMs?: number; maxBoards?: number; steps?: number; stashBudget?: number } = {}): BoardsApi {
  const undoMs = o.undoMs ?? UNDO_MS, maxBoards = o.maxBoards ?? MAX_BOARDS, steps = o.steps ?? STASH_STEPS, budget = o.stashBudget ?? 100_000;
  /** undo stacks of boards that are not open. Map order = least recently left first; bounded by steps per board and `budget` snapshots overall. */
  const stash = new Map<string, { hist: HistState; stamp: Stamp | null }>();
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; meta: BoardMeta; wasOpen: boolean }>();
  let gone = false;

  const kv = h.kv;
  const readIndex = async (): Promise<IndexRec> => ((await kv.get(INDEX)) as IndexRec | undefined) ?? { key: INDEX, active: h.id(), boards: [] };
  /** read-modify-write of the index, atomic across tabs */
  const edit = (fn: (ix: IndexRec) => void): Promise<IndexRec> => kv.tx(async (t) => {
    const ix = (await t.get(INDEX) as IndexRec | undefined) ?? { key: INDEX, active: h.id(), boards: [] };
    fn(ix); t.put(ix); return ix;
  });
  const remember = (id: string, hist: HistState, stamp: Stamp | null) => {
    stash.delete(id);
    if (hist.undo.length || hist.redo.length) stash.set(id, { hist, stamp });
    let total = 0;
    for (const v of stash.values()) total += v.hist.weight;
    for (const [k, v] of stash) { if (total <= budget) break; total -= v.hist.weight; stash.delete(k); }
  };
  const sameStamp = (a: Stamp | null, r?: DocRec): boolean => !!a && !!r && a.tab === r.tab && a.seq === (r.seq ?? 0);

  /** flush the open board and keep its undo steps; false when it could not be saved (then nothing may be swapped away) */
  async function leave(): Promise<boolean> {
    if (!(await h.flush())) { h.say("error", "Could not save this board, so it stays open."); return false; }
    remember(h.id(), h.takeHistory(steps), h.stamp());
    return true;
  }
  /** swap synchronously: edits made after the flush would be lost, so no await may sit between leave() and this */
  function enter(id: string, name: string, recs: BoardRecs): boolean {
    const keep = stash.get(id);
    const ok = h.activate(id, name, recs, keep && sameStamp(keep.stamp, recs.current) ? keep.hist : undefined);
    if (ok) stash.delete(id);
    return ok;
  }
  const purge = (id: string): Promise<unknown> => {
    pending.delete(id); stash.delete(id);
    return kv.tx(async (t) => {
      for (const k of KINDS) t.del(bkey(id, k));
      const ix = await t.get(INDEX) as IndexRec | undefined;
      if (ix?.trash) { ix.trash = ix.trash.filter((x) => x.id !== id); t.put(ix); }
    }).catch(() => { /* stays in the trash list: swept at the next startup */ });
  };
  const uniqueId = (ix: IndexRec): string => { let id = newBoardId(); while (ix.boards.some((b) => b.id === id) || ix.trash?.some((x) => x.id === id)) id = newBoardId(); return id; };
  const recent = (ix: IndexRec, except: string) => ix.boards.filter((b) => b.id !== except).sort((a, b) => b.savedAt - a.savedAt)[0];

  const api: BoardsApi = {
    async list() {
      await h.flush();
      const ix = await readIndex(), open = h.id();
      const rows = ix.boards.map((b) => ({ ...b, current: b.id === open }));
      // the open board may not be in the index yet (never saved): it is still the one on screen
      if (!rows.some((r) => r.current)) rows.push({ id: open, name: h.name(), savedAt: Date.now(), current: true });
      return rows.sort((a, b) => Number(b.current) - Number(a.current) || b.savedAt - a.savedAt);
    },

    async create(name = "untitled") {
      const ix = await readIndex();
      if (ix.boards.length >= maxBoards) { h.say("warn", `You can keep up to ${maxBoards} boards. Delete one first.`); return null; }
      const id = uniqueId(ix), nm = h.clean(name);
      if (!(await leave())) return null;
      // leave() flushed the old board; from here to enter() nothing may wait
      if (!enter(id, nm, {})) return null;
      await edit((x) => { if (!x.boards.some((b) => b.id === id)) x.boards.push({ id, name: nm, savedAt: Date.now() }); x.active = id; });
      return id;
    },

    async createFrom(name, fill) {
      const ix = await readIndex();
      if (ix.boards.length >= maxBoards) { h.say("warn", `You can keep up to ${maxBoards} boards. Delete one first.`); return false; }
      const id = uniqueId(ix), nm = h.clean(name);
      if (!(await leave())) return false;
      if (!enter(id, nm, {})) return false;
      fill();
      await edit((x) => { if (!x.boards.some((b) => b.id === id)) x.boards.push({ id, name: h.name(), savedAt: Date.now() }); x.active = id; });
      return true;
    },

    async switchTo(id) {
      if (id === h.id()) return true;
      const ix = await readIndex(), meta = ix.boards.find((b) => b.id === id);
      if (!meta) return false;
      const recs = await h.loadRecords(id); // read first: an unreadable board must not cost the open one anything
      const from = h.id();
      if (!(await leave())) return false;
      if (!enter(id, meta.name, recs)) { stash.delete(from); h.say("error", `Could not read “${meta.name}”. It stays as it is; this board is still open.`); return false; }
      void edit((x) => { x.active = id; }).catch(() => {});
      return true;
    },

    async rename(id, name) {
      const nm = h.clean(name);
      await edit((x) => { const b = x.boards.find((v) => v.id === id); if (b) b.name = nm; });
      if (id === h.id()) h.setName(nm);
    },

    async duplicate(id) {
      if (id === h.id() && !(await h.flush())) return null;
      const ix = await readIndex(), meta = ix.boards.find((b) => b.id === id);
      if (!meta) return null;
      if (ix.boards.length >= maxBoards) { h.say("warn", `You can keep up to ${maxBoards} boards. Delete one first.`); return null; }
      const recs = await h.loadRecords(id), src = recs.current ?? recs.backup;
      if (!src) { h.say("error", "That board has nothing saved yet."); return null; }
      const nid = uniqueId(ix), nm = h.clean(`${meta.name} copy`), now = Date.now();
      await kv.tx(async (t) => {
        t.put({ ...src, key: bkey(nid, "current"), name: nm, savedAt: now, seq: 1, fileDirty: false });
        if (recs.view) t.put({ key: bkey(nid, "view"), ...recs.view });
        const x = await t.get(INDEX) as IndexRec | undefined ?? { key: INDEX, active: h.id(), boards: [] };
        x.boards.push({ id: nid, name: nm, savedAt: now }); t.put(x);
      });
      return nid;
    },

    async remove(id) {
      const wasOpen = id === h.id();
      if (wasOpen) await h.flush(); // so the board is in the index, with its latest edits
      const ix = await readIndex();
      // an open board that was never edited has no index entry yet: it can still be deleted
      const meta = ix.boards.find((b) => b.id === id) ?? (wasOpen ? { id, name: h.name(), savedAt: Date.now() } : undefined);
      if (!meta) return null;
      if (wasOpen) {
        // read the board to open instead BEFORE flushing: nothing may wait between leave() and enter(), or an edit made meanwhile is lost
        const next = recent(ix, id);
        const recs = next ? await h.loadRecords(next.id) : {};
        const nid = next?.id ?? uniqueId(ix), nm = next?.name ?? "untitled";
        // flush first (so Undo brings back the latest edits), then open it, or a fresh board when this was the last
        if (!(await leave())) return null;
        if (!enter(nid, nm, recs)) { stash.delete(h.id()); h.say("error", `Could not read “${nm}”, so “${meta.name}” was not deleted.`); return null; }
        await edit((x) => {
          x.boards = x.boards.filter((b) => b.id !== id);
          if (!x.boards.some((b) => b.id === nid)) x.boards.push({ id: nid, name: nm, savedAt: Date.now() });
          x.active = nid; (x.trash ??= []).push({ id, at: Date.now(), meta });
        });
        // the deleted board's stack stays in the stash for Undo (the budget still bounds it); enter() above kept it
      } else {
        await edit((x) => { x.boards = x.boards.filter((b) => b.id !== id); (x.trash ??= []).push({ id, at: Date.now(), meta }); });
      }
      const timer = setTimeout(() => { void purge(id); }, undoMs);
      pending.set(id, { timer, meta, wasOpen });
      return {
        name: meta.name,
        async undo() {
          const p = pending.get(id);
          if (!p || gone) return false;
          clearTimeout(p.timer); pending.delete(id);
          await edit((x) => { x.trash = x.trash?.filter((v) => v.id !== id); if (!x.boards.some((b) => b.id === id)) x.boards.push(p.meta); });
          if (p.wasOpen) await api.switchTo(id);
              return true;
        },
      };
    },

    stashed() { let n = 0; for (const v of stash.values()) n += v.hist.weight; return { boards: stash.size, snapshots: n }; },
    dispose() { gone = true; for (const p of pending.values()) clearTimeout(p.timer); pending.clear(); stash.clear(); },
  };
  return api;
}
