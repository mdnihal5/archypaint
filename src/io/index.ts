import type { EditorAPI } from "../editor-api";
import type { SceneJSON } from "../scene";
import { LIGHT, type Theme } from "../theme";
import { Files, fileKindFromName, safeFileName, sniffKind, stripExt, type FSHandle } from "./file";
import { LIMITS, parseArch, serializeArch, type ArchFile, type ArchMeta, type ArchView, type Settings } from "./format";
import { Autosave, idbKV, memKV, serializeSliced, type KV, type SaveStatus, type StorageSource } from "./storage";

export type { SaveStatus } from "./storage";

export interface ExportOpts { scale?: 1 | 2 | 3; selectionOnly?: boolean; background?: boolean }
export interface IOMessage { level: "info" | "warn" | "error"; text: string }

/**
 * Persistence, import/export and offline.
 *
 * Status semantics: `onStatus` reports the AUTOSAVE state (browser storage): dirty -> saving -> saved | error.
 * `editor.dirty()` is separate: it means "differs from the last explicit file save/open" and drives discard prompts.
 *
 * Startup contract: call `restore()` once after the editor exists. Autosave stays disarmed until it resolves,
 * so an empty scene can never overwrite a saved document.
 */
export interface IO {
  newDoc(): void;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  open(): Promise<void>;
  /** restore the autosaved document on startup; true if something was restored */
  restore(): Promise<boolean>;
  exportPng(o?: ExportOpts): Promise<void>;
  exportSvg(o?: ExportOpts): Promise<void>;
  copyPng(o?: ExportOpts): Promise<void>;
  importExcalidraw(): Promise<void>;
  exportExcalidraw(): Promise<void>;
  docName(): string;
  setDocName(n: string): void;
  onStatus(cb: (s: SaveStatus) => void): () => void;
  /** toasts: saved, warnings (lossy import, scaled-down export), errors */
  onMessage(cb: (m: IOMessage) => void): () => void;
  /** app settings stored with the document (e.g. `bg: "grid" | "plain"`) */
  settings(): Settings;
  updateSettings(patch: Settings): void;
  /** fired after a document is opened, dropped or restored, with its settings */
  onLoad(cb: (settings: Settings) => void): () => void;
  dispose(): void;
}

export interface IOOptions {
  /** replace window.confirm with a nicer dialog; resolve true to continue */
  confirm?: (message: string) => boolean | Promise<boolean>;
  /** storage backend override (tests) */
  kv?: KV;
}

/** export/import code is loaded on first use, so it costs nothing at startup */
const lazyExport = () => import("./export");
const lazyExcalidraw = () => import("./excalidraw");
const themeOf = (e: EditorAPI): Theme => (e as unknown as { theme?: Theme }).theme ?? LIGHT;

const DISCARD = "You have changes that are not saved to a file. Continue and discard them?";
const cleanName = (n: string): string => n.replace(/[\u0000-\u001f]/g, "").trim().slice(0, LIMITS.maxName) || "untitled";

export function createIO(editor: EditorAPI, stage: HTMLElement, opts: IOOptions = {}): IO {
  let meta: ArchMeta = { name: "untitled", created: Date.now(), updated: Date.now() };
  let settings: Settings = {};
  let extra: Record<string, unknown> = {};
  let elExtra: Record<string, Record<string, unknown>> = {};
  let handle: FSHandle | null = null;
  let nameDirty = false;
  let busy = false;
  let disposed = false;

  const statusSubs = new Set<(s: SaveStatus) => void>();
  const msgSubs = new Set<(m: IOMessage) => void>();
  const loadSubs = new Set<(s: Settings) => void>();
  const say = (level: IOMessage["level"], text: string) => { for (const f of [...msgSubs]) f({ level, text }); };
  const setStatus = (s: SaveStatus) => { if (!disposed) for (const f of [...statusSubs]) f(s); };

  const vp = editor.vp;
  const view = (): ArchView => ({ x: vp.x, y: vp.y, zoom: vp.zoom });
  const src: StorageSource = {
    version: () => editor.scene.nonce,
    count: () => editor.scene.els.size,
    snapshot: () => ({ els: Array.from(editor.scene.els.values()), groups: Array.from(editor.scene.groups.values()) }),
    meta: () => meta, view, settings: () => settings, extra: () => extra, elExtra: () => elExtra,
    fileDirty: () => editor.dirty() || nameDirty,
  };

  const kv = opts.kv ?? (typeof indexedDB !== "undefined" ? idbKV() : memKV());
  const autosave = new Autosave(src, kv, (s) => {
    setStatus(s);
    if (s === "error") say("error", "Autosave failed — your browser may be blocking or out of storage. Save to a file to be safe.");
  });
  if (typeof document !== "undefined") autosave.attachLifecycle();
  const files = new Files();

  const offs: Array<() => void> = [
    editor.on("change", () => { meta.updated = Date.now(); autosave.schedule(); }),
    editor.on("history", () => { meta.updated = Date.now(); autosave.schedule(); }),
    editor.on("viewport", () => autosave.scheduleView()),
  ];

  const confirmDiscard = async (): Promise<boolean> => {
    if (!editor.dirty() && !nameDirty) return true;
    return opts.confirm ? await opts.confirm(DISCARD) : window.confirm(DISCARD);
  };

  const buildFile = (): Pick<ArchFile, "meta" | "view" | "settings" | "scene" | "extra" | "elExtra"> => ({ meta, view: view(), settings, scene: editor.scene.toJSON(), extra, elExtra });

  const setView = (v: ArchView) => { vp.x = v.x; vp.y = v.y; vp.zoom = Math.min(LIMITS.maxZoom, Math.max(LIMITS.minZoom, v.zoom)); vp.version++; };

  function apply(f: ArchFile, o: { view?: ArchView; markSaved: boolean }): void {
    meta = { ...f.meta }; settings = { ...f.settings }; extra = f.extra; elExtra = f.elExtra; nameDirty = false;
    const v = o.view ?? f.view;
    setView(v);
    editor.load(f.scene);
    if (Math.abs(vp.zoom - v.zoom) > 1e-9 || vp.x !== v.x || vp.y !== v.y) { setView(v); editor.zoomBy(1.000001); } // editor.load reset the view; re-assert and force a redraw
    if (o.markSaved) editor.markSaved();
    for (const f2 of [...loadSubs]) f2(settings);
  }

  function loadScene(scene: SceneJSON, name: string): void {
    meta = { name: cleanName(name), created: Date.now(), updated: Date.now() }; extra = {}; elExtra = {}; nameDirty = false;
    editor.load(scene);
    editor.zoomToFit();
    for (const f of [...loadSubs]) f(settings);
  }

  async function withBusy(fn: () => Promise<void>): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    try { await fn(); } catch (e) { say("error", e instanceof Error ? e.message : String(e)); } finally { busy = false; }
  }

  async function loadFile(file: File, h: FSHandle | null): Promise<void> {
    const r = await files.readText(file);
    if (!r.ok) { say("error", r.message); return; }
    let kind = fileKindFromName(file.name);
    if (kind === "unknown") kind = sniffKind(r.text);
    if (kind === "excalidraw") {
      let raw: unknown;
      try { raw = JSON.parse(r.text); } catch { say("error", `${file.name} is not valid JSON.`); return; }
      const ex = (await lazyExcalidraw()).fromExcalidraw(raw, themeOf(editor));
      if (!ex.ok) { say("error", ex.message); return; }
      handle = null; void autosave.saveHandle(null);
      loadScene(ex.scene, stripExt(file.name));
      say(ex.warnings.length ? "warn" : "info", ex.warnings.length ? `Imported ${file.name}. ${ex.warnings.join("; ")}.` : `Imported ${file.name}.`);
      return;
    }
    const p = parseArch(r.text);
    if (!p.ok) { say("error", p.error.code === "unsupported_version" || p.error.code === "not_archypaint" ? p.error.message : `Could not open ${file.name}: ${p.error.message}`); return; }
    apply(p.value, { markSaved: true });
    meta = { ...meta, name: cleanName(stripExt(file.name)) };
    handle = h; void autosave.saveHandle(h);
    if (p.warnings.length) say("warn", `Opened ${file.name}. ${p.warnings.join("; ")}.`);
  }

  const io: IO = {
    newDoc() {
      void withBusy(async () => {
        if (!(await confirmDiscard())) return;
        meta = { name: "untitled", created: Date.now(), updated: Date.now() }; extra = {}; elExtra = {}; nameDirty = false; handle = null;
        void autosave.saveHandle(null);
        editor.load({ els: [], groups: [] });
        editor.resetView();
        editor.markSaved();
        for (const f of [...loadSubs]) f(settings);
      });
    },

    async save() { await doSave(false); },
    async saveAs() { await doSave(true); },
    open() {
      return withBusy(async () => {
        if (!(await confirmDiscard())) return;
        const picked = await files.pick();
        if (picked) await loadFile(picked.file, picked.handle);
      });
    },

    async restore() {
      let applied = false;
      try {
        const recs = await autosave.loadRecords();
        for (const [label, rec] of [["current", recs.current], ["backup", recs.backup]] as const) {
          if (!rec) continue;
          const p = parseArch(rec.text);
          if (!p.ok) { say("warn", `The autosaved ${label} copy could not be read (${p.error.message}).`); continue; }
          const v: ArchView | undefined = recs.view && label === "current" ? { x: recs.view.x, y: recs.view.y, zoom: recs.view.zoom } : undefined;
          apply(p.value, { ...(v ? { view: v } : {}), markSaved: !rec.fileDirty });
          if (label === "backup") say("warn", "Restored the previous autosave — the latest one was unreadable.");
          applied = true; break;
        }
        const h = recs.handle as FSHandle | undefined;
        if (applied && h && typeof h.createWritable === "function") handle = h;
      } finally { autosave.arm(); }
      if (!disposed) setStatus("saved");
      return applied;
    },

    exportPng(o) {
      return withBusy(async () => {
        const r = await (await lazyExport()).renderPng(editor, o);
        if (r.usedSelection === false && o?.selectionOnly) say("info", "Nothing was selected, so the whole drawing was exported.");
        if (r.scaledDown) say("warn", `The image was scaled down to ${r.width} × ${r.height} px to stay within browser limits.`);
        files.download(r.blob, safeFileName(meta.name, "png"));
      });
    },
    exportSvg(o) {
      return withBusy(async () => {
        const r = await (await lazyExport()).renderSvg(editor, o);
        files.download(new Blob([r.text], { type: "image/svg+xml" }), safeFileName(meta.name, "svg"));
      });
    },
    copyPng(o) {
      return withBusy(async () => {
        const CI = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
        if (!CI || !navigator.clipboard?.write) { say("warn", "Copying images is not supported in this browser — use Export PNG."); return; }
        const X = await lazyExport();
        try {
          // pass a promise: the write is registered inside the user gesture even though rendering is async
          await navigator.clipboard.write([new CI({ "image/png": X.renderPng(editor, o).then((r) => r.blob) })]);
          say("info", "Copied to clipboard.");
        } catch (e) {
          if (e instanceof X.ExportError) throw e;
          say("warn", "The browser blocked clipboard access — use Export PNG instead.");
        }
      });
    },

    importExcalidraw() {
      return withBusy(async () => {
        if (!(await confirmDiscard())) return;
        const picked = await files.pick();
        if (picked) await loadFile(picked.file, null);
      });
    },
    exportExcalidraw() {
      return withBusy(async () => {
        const json = JSON.stringify((await lazyExcalidraw()).toExcalidraw(editor.scene.toJSON(), themeOf(editor)));
        const r = await files.save(new Blob([json], { type: "application/json" }), meta.name, "excalidraw", "application/json", null, true);
        if (r.ok) say("info", "Exported for Excalidraw. Icons become labelled rectangles there; archypaint keeps their details if you re-import.");
        else if (!r.cancelled) say("error", "Could not save the Excalidraw file.");
      });
    },

    docName: () => meta.name,
    setDocName(n) { const c = cleanName(n); if (c === meta.name) return; meta = { ...meta, name: c, updated: Date.now() }; nameDirty = true; autosave.schedule(); },
    onStatus(cb) { statusSubs.add(cb); return () => { statusSubs.delete(cb); }; },
    onMessage(cb) { msgSubs.add(cb); return () => { msgSubs.delete(cb); }; },
    settings: () => settings,
    updateSettings(patch) { settings = { ...settings, ...patch }; autosave.schedule(); },
    onLoad(cb) { loadSubs.add(cb); return () => { loadSubs.delete(cb); }; },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const f of offs) f();
      offs.length = 0;
      autosave.dispose();
      files.dispose();
      statusSubs.clear(); msgSubs.clear(); loadSubs.clear();
    },
  };

  files.onDrop(stage, (f) => {
    void withBusy(async () => { if (await confirmDiscard()) await loadFile(f, null); });
  });

  async function doSave(forcePicker: boolean): Promise<void> {
    return withBusy(async () => {
      setStatus("saving");
      let version = editor.scene.nonce;
      let text = await serializeSliced({ ...src.snapshot(), meta, view: view(), settings, extra, elExtra }, { isStale: () => editor.scene.nonce !== version });
      if (text === null) { version = editor.scene.nonce; text = serializeArch(buildFile()); } // still being edited: take a consistent synchronous snapshot instead
      const r = await files.save(new Blob([text], { type: "application/json" }), meta.name, "archypaint", "application/json", handle, forcePicker);
      if (!r.ok) { setStatus(r.cancelled ? "dirty" : "error"); if (!r.cancelled) say("error", "Could not save the file."); return; }
      handle = r.handle;
      void autosave.saveHandle(handle);
      if (handle) { const n = stripExt(handle.name); if (n !== meta.name) meta = { ...meta, name: cleanName(n) }; }
      // Only what was written counts as saved. Edits made while the picker was open (or during the write) stay
      // unsaved, so the discard prompt still protects them.
      const clean = editor.scene.nonce === version;
      if (clean) editor.markSaved();
      nameDirty = false;
      setStatus(clean ? "saved" : "dirty");
      say("info", handle ? `Saved ${handle.name}.` : `Downloaded ${safeFileName(meta.name, "archypaint")}.`);
      autosave.schedule();
    });
  }

  return io;
}
