import type { EditorAPI } from "./editor-api";

/** Sequential, bounded insertion of dropped / pasted pictures (lazy: loaded on the first picture, never at startup). */
const MAX_QUEUE = 20;
let queue: Array<{ file: File; at?: { x: number; y: number } }> = [];
let running = false;
let stopped = false;

export function enqueue(editor: EditorAPI, files: File[], at?: { x: number; y: number }): void {
  stopped = false;
  let dropped = 0;
  files.forEach((file, i) => {
    if (queue.length >= MAX_QUEUE) { dropped++; return; }
    queue.push({ file, at: at ? { x: at.x + i * 24, y: at.y + i * 24 } : undefined });
  });
  if (dropped) editor.notice("warn", `Too many images at once: ${dropped} skipped (up to ${MAX_QUEUE} at a time).`);
  void pump(editor);
}

async function pump(editor: EditorAPI): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let next = queue.shift(); next && !stopped; next = queue.shift()) {
      try { await editor.insertImage(next.file, next.at); }
      catch (e) { editor.notice("error", e instanceof Error ? e.message : "Couldn't insert that image."); }
    }
  } finally { running = false; }
}

/** editor teardown: forget anything still waiting */
export function cancelQueue(): void { stopped = true; queue = []; }
