import type { Action } from "./types";

/** Menu entry only: the picker element is created on demand and always removed, and the heavy pipeline is imported by editor.insertImage(). */
export const actions: Action[] = [{
  id: "insert-image",
  label: "Insert image or SVG…",
  section: "insert",
  run(c) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"; inp.multiple = true; inp.style.display = "none";
    const done = () => inp.remove();
    inp.addEventListener("change", () => {
      const files = Array.from(inp.files ?? []).slice(0, 20);
      done();
      void (async () => {
        for (const f of files) {
          try { await c.editor.insertImage(f); } catch (e) { c.toast(e instanceof Error ? e.message : "Couldn't insert that image.", "err"); }
        }
      })();
    }, { once: true });
    inp.addEventListener("cancel", done, { once: true });
    document.body.appendChild(inp);
    inp.click();
  },
}];
