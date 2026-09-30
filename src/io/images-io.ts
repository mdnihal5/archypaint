import type { Scene } from "../scene";
import type { ArchFile } from "./format";

/** Everything the file layer does with pictures, kept in a lazy chunk: sheets without images never load it. */
type Say = (level: "info" | "warn" | "error", text: string) => void;

export const imageKeysOf = (scene: Scene): string[] => { const s = new Set<string>(); for (const e of scene.els.values()) if (e.kind === "image" && e.img) s.add(e.img); return [...s]; };

/** images embedded in an opened file go into the local store; the map is never kept in memory, and keys are remapped to the stored content hash */
export async function hydrateFile(f: ArchFile, say: Say): Promise<void> {
  const { images, ...rest } = f.extra as Record<string, unknown>;
  f.extra = rest;
  if (images === undefined) return;
  try {
    const remap = await (await import("../images")).hydrateImages(images);
    for (const el of f.scene.els) if (el.kind === "image" && remap[el.img]) el.img = remap[el.img]!;
  } catch { say("warn", "Some images in this file could not be loaded."); }
}

export async function hydrateExcalidraw(images: Record<string, string>, els: Array<{ kind: string; img: string }>): Promise<boolean> {
  try {
    const remap = await (await import("../images")).hydrateImages(images);
    for (const el of els) if (el.kind === "image" && remap[el.img]) el.img = remap[el.img]!;
    return true;
  } catch { return false; }
}

/** a saved file is self-contained: pictures travel inside it (under `images`), capped at 20 MB. Returns the extra to write, or an error to show. */
export async function embedForSave(scene: Scene, extra: Record<string, unknown>, say: Say): Promise<{ extra: Record<string, unknown> } | { error: string }> {
  const c = await (await import("../images")).collectImages(imageKeysOf(scene));
  if (c.tooBig) return { error: "The images in this drawing are over the 20 MB a file can embed. Remove or shrink some and save again." };
  if (c.missing.length) say("warn", `${c.missing.length} image(s) are no longer in this browser's storage and could not be saved.`);
  return { extra: Object.keys(c.images).length ? { ...extra, images: c.images } : extra };
}

/** pictures for an Excalidraw export: what could not be embedded degrades to labelled rectangles there */
export async function collectForExport(scene: Scene, say: Say): Promise<Record<string, string>> {
  const c = await (await import("../images")).collectImages(imageKeysOf(scene));
  if (c.tooBig || c.missing.length) say("warn", "Some images could not be embedded (too large or missing); they export as labelled rectangles.");
  return c.images;
}

/** once per startup, when idle: delete stored images no element of the restored sheet uses (history is empty now, so this is safe) */
export async function gcUnused(scene: Scene): Promise<void> { await (await import("../images")).gcImages(new Set(imageKeysOf(scene))); }
