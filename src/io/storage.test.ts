import { describe, expect, it } from "vitest";
import { serializeArch } from "./format";
import { Autosave, DEBOUNCE_MS, MAX_WAIT_MS, memKV, serializeSliced, type KV, type SaveStatus, type StorageEnv, type StorageSource } from "./storage";
import { el } from "./testkit";
import type { ElJSON } from "../scene";

const many = (n: number): ElJSON[] => Array.from({ length: n }, (_, i) => el({ id: `e${i.toString(36)}`, z: i + 1, x: i, text: `n${i}` }));
const hdr = { meta: { name: "d", created: 1, updated: 1 }, view: { x: 0, y: 0, zoom: 1 }, settings: {} };

describe("serializeSliced", () => {
  it("produces exactly the same text as the synchronous serialiser", async () => {
    const els = many(500);
    const a = await serializeSliced({ els, groups: [], ...hdr });
    expect(a).toBe(serializeArch({ ...hdr, scene: { els, groups: [] } }));
  });

  it("yields to the event loop between slices when over budget", async () => {
    let t = 0, yields = 0;
    const out = await serializeSliced({ els: many(2000), groups: [], ...hdr }, { budgetMs: 4, now: () => (t += 5), yieldFn: async () => { yields++; } });
    expect(out).not.toBeNull();
    expect(yields).toBeGreaterThanOrEqual(10);
  });

  it("returns null (no torn snapshot) when the document changes mid-serialise", async () => {
    let stale = false;
    const out = await serializeSliced({ els: many(1000), groups: [], ...hdr }, { budgetMs: 0, now: (() => { let t = 0; return () => (t += 5); })(), yieldFn: async () => { stale = true; }, isStale: () => stale });
    expect(out).toBeNull();
  });
});

/* ---------------------------------------------------------------- Autosave with fake timers + in-memory KV */

function harness(kvOverride?: KV) {
  let clock = 0, nonce = 1, dirty = false, name = "doc";
  const timers = new Map<number, { at: number; f: () => void }>();
  let tid = 0;
  const idleQ: Array<() => void> = [];
  const env: StorageEnv = {
    setTimeout: (f, ms) => { const id = ++tid; timers.set(id, { at: clock + ms, f }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
    now: () => clock,
    idle: (f) => { idleQ.push(f); return idleQ.length; },
    cancelIdle: () => { idleQ.length = 0; },
    yieldFn: async () => {},
  };
  let els = many(3);
  const src: StorageSource = {
    version: () => nonce, snapshot: () => ({ els, groups: [] }), meta: () => ({ name, created: 1, updated: 1 }), view: () => ({ x: 0, y: 0, zoom: 1 }),
    settings: () => ({}), extra: () => ({}), elExtra: () => ({}), fileDirty: () => dirty,
  };
  const kv = kvOverride ?? memKV();
  const statuses: SaveStatus[] = [];
  const a = new Autosave(src, kv, (s) => statuses.push(s), env);
  const tick = async (ms: number) => {
    clock += ms;
    for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.f(); }
    while (idleQ.length) { idleQ.shift()!(); }
    await new Promise((r) => setTimeout(r, 0)); // let the awaited serialise/write promise chain settle
    await new Promise((r) => setTimeout(r, 0));
  };
  return { a, kv, tick, statuses, edit: () => { nonce++; els = many(3 + nonce); }, setName: (n: string) => { name = n; }, timers, setDirty: (d: boolean) => { dirty = d; } };
}

describe("Autosave", () => {
  it("does nothing until armed (an empty scene must never overwrite a saved one)", async () => {
    const h = harness();
    h.a.schedule(); await h.tick(5000);
    expect(await h.kv.get("current")).toBeUndefined();
  });

  it("coalesces a burst of changes into one write after the debounce", async () => {
    const h = harness(); h.a.arm();
    let writes = 0; const real = h.kv.writeDoc.bind(h.kv); h.kv.writeDoc = async (r) => { writes++; return real(r); };
    for (let i = 0; i < 20; i++) { h.edit(); h.a.schedule(); await h.tick(50); }
    expect(writes).toBe(0);
    await h.tick(DEBOUNCE_MS);
    expect(writes).toBe(1);
    expect(h.statuses).toContain("dirty"); expect(h.statuses).toContain("saving"); expect(h.statuses.at(-1)).toBe("saved");
  });

  it("caps the wait: continuous editing still saves within MAX_WAIT_MS", async () => {
    const h = harness(); h.a.arm();
    let writes = 0; const real = h.kv.writeDoc.bind(h.kv); h.kv.writeDoc = async (r) => { writes++; return real(r); };
    for (let t = 0; t < MAX_WAIT_MS + 2000; t += 500) { h.edit(); h.a.schedule(); await h.tick(500); }
    expect(writes).toBeGreaterThanOrEqual(1);
  });

  it("keeps one rolling backup of the previous document", async () => {
    const h = harness(); h.a.arm();
    h.edit(); h.a.schedule(); await h.tick(DEBOUNCE_MS);
    const first = (await h.kv.get("current")) as { text: string };
    h.edit(); h.a.schedule(); await h.tick(DEBOUNCE_MS);
    const second = (await h.kv.get("current")) as { text: string };
    const backup = (await h.kv.get("backup")) as { text: string };
    expect(second.text).not.toBe(first.text);
    expect(backup.text).toBe(first.text);
  });

  it("does not rewrite an unchanged document", async () => {
    const h = harness(); h.a.arm();
    let writes = 0; const real = h.kv.writeDoc.bind(h.kv); h.kv.writeDoc = async (r) => { writes++; return real(r); };
    h.edit(); h.a.schedule(); await h.tick(DEBOUNCE_MS);
    h.a.schedule(); await h.tick(DEBOUNCE_MS);
    expect(writes).toBe(1);
  });

  it("records the file-dirty flag so a restore knows whether to prompt on discard", async () => {
    const h = harness(); h.a.arm(); h.setDirty(true);
    h.edit(); h.a.schedule(); await h.tick(DEBOUNCE_MS);
    expect(((await h.kv.get("current")) as { fileDirty: boolean }).fileDirty).toBe(true);
  });

  it("surfaces quota/permission failures as status 'error', never as an exception", async () => {
    const kv = memKV(); kv.writeDoc = async () => { throw new DOMException("full", "QuotaExceededError"); };
    const h = harness(kv); h.a.arm();
    h.edit(); h.a.schedule();
    await expect(h.tick(DEBOUNCE_MS)).resolves.toBeUndefined();
    expect(h.statuses).toContain("error");
    expect(h.a.lastError).toBeInstanceOf(DOMException);
  });

  it("flushSync (page hide) writes immediately without waiting for the debounce", async () => {
    const h = harness(); h.a.arm();
    h.edit(); h.a.flushSync();
    await h.tick(0);
    expect(await h.kv.get("current")).toBeDefined();
  });

  it("flushSync starts the write synchronously through writeDocNow (no awaits before it — the page may be gone)", () => {
    const h = harness(); h.a.arm();
    let now = 0, slow = 0;
    const real = h.kv.writeDocNow.bind(h.kv);
    h.kv.writeDocNow = (r) => { now++; return real(r); };
    h.kv.writeDoc = async (r) => { slow++; return r as never; };
    h.edit(); h.a.flushSync();
    expect(now).toBe(1); // called before flushSync returned, not in a later microtask
    expect(slow).toBe(0);
  });

  it("dispose cancels pending timers and closes the backend: nothing is written afterwards", async () => {
    const h = harness(); h.a.arm();
    let writes = 0; const real = h.kv.writeDoc.bind(h.kv); h.kv.writeDoc = async (r) => { writes++; return real(r); };
    h.edit(); h.a.schedule();
    h.a.dispose();
    expect(h.timers.size).toBe(0);
    await h.tick(DEBOUNCE_MS * 5);
    expect(writes).toBe(0);
    h.a.schedule(); h.a.flushSync();
    expect(writes).toBe(0);
  });

  it("restores 'current' and falls back to 'backup' records", async () => {
    const h = harness(); h.a.arm();
    h.edit(); h.a.schedule(); await h.tick(DEBOUNCE_MS);
    h.edit(); h.a.schedule(); await h.tick(DEBOUNCE_MS);
    const recs = await h.a.loadRecords();
    expect(recs.current?.text).toBeTruthy();
    expect(recs.backup?.text).toBeTruthy();
  });

  it("view changes never rewrite the document (separate tiny record)", async () => {
    const h = harness(); h.a.arm();
    let docWrites = 0; const real = h.kv.writeDoc.bind(h.kv); h.kv.writeDoc = async (r) => { docWrites++; return real(r); };
    h.a.scheduleView(); await h.tick(3000);
    expect(docWrites).toBe(0);
  });
});
