import type { EditorAPI } from "./editor-api";

/**
 * Drop and paste of image files onto the canvas. Only what must be synchronous lives here (recognising a picture and
 * calling preventDefault, so the browser does not navigate to the dropped file); queueing and inserting are lazy.
 */
const pics = (fl?: FileList | null): File[] => (fl ? Array.from(fl).filter((f) => f.type.startsWith("image/")) : []);

export function installImageInput(editor: EditorAPI, stage: HTMLElement): () => void {
  let done = false;
  let q: typeof import("./images-queue") | null = null;
  const send = (files: File[], at?: { x: number; y: number }) => { void import("./images-queue").then((m) => { q = m; if (!done) m.enqueue(editor, files, at); }); };
  const hasPic = (e: DragEvent) => { const it = Array.from(e.dataTransfer?.items ?? []); return !!e.dataTransfer?.types.includes("Files") && (!it.length || it.some((i) => i.kind === "file" && i.type.startsWith("image/"))); };
  const onOver = (e: DragEvent) => { if (hasPic(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } };
  const onDrop = (e: DragEvent) => {
    const f = pics(e.dataTransfer?.files);
    if (!f.length) return;
    e.preventDefault();
    const b = stage.getBoundingClientRect();
    send(f, { x: editor.vp.toWorldX(e.clientX - b.left), y: editor.vp.toWorldY(e.clientY - b.top) });
  };
  const onPaste = (e: ClipboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const f = pics(e.clipboardData?.files);
    if (!f.length) return;
    e.preventDefault();
    send(f);
  };
  stage.addEventListener("dragover", onOver);
  stage.addEventListener("drop", onDrop);
  window.addEventListener("paste", onPaste);
  return () => {
    if (done) return; // idempotent: a second teardown must not remove listeners twice
    done = true;
    stage.removeEventListener("dragover", onOver);
    stage.removeEventListener("drop", onDrop);
    window.removeEventListener("paste", onPaste);
    q?.cancelQueue(); // only if it was ever loaded: teardown must not fetch a chunk
  };
}
