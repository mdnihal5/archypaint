import { LIMITS } from "./format";

/* File System Access API is not in the TS DOM lib for this target; declare only what is used. */
interface FSWritable { write(data: Blob | string): Promise<void>; close(): Promise<void> }
export interface FSHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FSWritable>;
  queryPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
}
interface PickerOpts { types?: Array<{ description: string; accept: Record<string, string[]> }>; suggestedName?: string; multiple?: boolean; excludeAcceptAllOption?: boolean }
interface FSWindow { showSaveFilePicker?(o?: PickerOpts): Promise<FSHandle>; showOpenFilePicker?(o?: PickerOpts): Promise<FSHandle[]> }

export type FileKind = "archypaint" | "excalidraw" | "unknown";

export function fileKindFromName(name: string): FileKind {
  const n = name.toLowerCase();
  if (n.endsWith(".archypaint")) return "archypaint";
  if (n.endsWith(".excalidraw")) return "excalidraw";
  return "unknown";
}

/** decide by content when the extension does not say (.json etc.) */
export function sniffKind(text: string): FileKind {
  const head = text.slice(0, 4096);
  if (/"app"\s*:\s*"archypaint"/.test(head)) return "archypaint";
  if (/"type"\s*:\s*"excalidraw/.test(head)) return "excalidraw";
  return "unknown";
}

export function stripExt(name: string): string {
  return name.replace(/\.(archypaint|excalidraw|json|png|svg)$/i, "") || "untitled";
}

export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^\.+/, "").trim().slice(0, 100) || "untitled";
  return `${base}.${ext}`;
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

export type SaveResult = { ok: true; handle: FSHandle | null; name: string } | { ok: false; cancelled: boolean; error?: unknown };

export class Files {
  private urls = new Set<string>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private off: Array<() => void> = [];
  private disposed = false;

  hasPicker(): boolean { return typeof (window as FSWindow).showSaveFilePicker === "function"; }

  /** write text/blob. With the picker: overwrite the kept handle, or ask for one. Without: download. */
  async save(data: Blob, suggested: string, ext: string, mime: string, handle: FSHandle | null, forcePicker: boolean): Promise<SaveResult> {
    const w = window as FSWindow;
    if (w.showSaveFilePicker) {
      try {
        let h = handle;
        if (h && !forcePicker && h.requestPermission) {
          const p = (await h.queryPermission?.({ mode: "readwrite" })) ?? "prompt";
          if (p !== "granted" && (await h.requestPermission({ mode: "readwrite" })) !== "granted") h = null;
        }
        if (!h || forcePicker) h = await w.showSaveFilePicker({ suggestedName: safeFileName(suggested, ext), types: [{ description: ext === "archypaint" ? "archypaint document" : "file", accept: { [mime]: [`.${ext}`] } }] });
        const wr = await h.createWritable();
        try { await wr.write(data); } finally { await wr.close(); }
        return { ok: true, handle: h, name: h.name };
      } catch (e) {
        if (isAbort(e)) return { ok: false, cancelled: true };
        // permission/picker failures fall through to the download path below
        if (!(e instanceof DOMException)) return { ok: false, cancelled: false, error: e };
      }
    }
    this.download(data, safeFileName(suggested, ext));
    return { ok: true, handle: null, name: safeFileName(suggested, ext) };
  }

  download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    const t = setTimeout(() => { URL.revokeObjectURL(url); this.urls.delete(url); this.timers.delete(t); }, 15_000);
    this.timers.add(t);
  }

  /** pick a file to open: picker if available, else a transient <input type=file> that is always removed again */
  async pick(): Promise<{ file: File; handle: FSHandle | null } | null> {
    const w = window as FSWindow;
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker({ multiple: false, types: [{ description: "archypaint or Excalidraw", accept: { "application/json": [".archypaint", ".excalidraw", ".json"] } }] });
        if (!h) return null;
        return { file: await h.getFile(), handle: h };
      } catch (e) { if (isAbort(e)) return null; /* else fall back to <input> */ }
    }
    return new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = ".archypaint,.excalidraw,.json,application/json"; inp.style.display = "none";
      const done = (f: File | null) => { inp.remove(); resolve(f ? { file: f, handle: null } : null); };
      inp.addEventListener("change", () => done(inp.files?.[0] ?? null), { once: true });
      inp.addEventListener("cancel", () => done(null), { once: true });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  /** enforce the size limit BEFORE reading the file into memory */
  async readText(file: File): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
    if (file.size > LIMITS.maxFileChars) return { ok: false, message: `${file.name} is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${LIMITS.maxFileChars / 1048576} MB` };
    try { return { ok: true, text: await file.text() }; }
    catch (e) { return { ok: false, message: `could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}` }; }
  }

  /** drag-and-drop of documents onto the stage; returns nothing — listeners are removed by dispose() */
  onDrop(stage: HTMLElement, cb: (file: File) => void): void {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const over = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f && !this.disposed) cb(f);
    };
    stage.addEventListener("dragover", over);
    stage.addEventListener("drop", drop);
    this.off.push(() => stage.removeEventListener("dragover", over), () => stage.removeEventListener("drop", drop));
  }

  dispose(): void {
    this.disposed = true;
    for (const f of this.off) f();
    this.off = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls.clear();
  }
}
