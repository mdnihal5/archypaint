import type { EditorAPI } from "../editor-api";
import * as Renderer from "../renderer";
import type { El } from "../scene";
import { LIGHT, type Theme } from "../theme";
import * as Icons from "../icons";
import { arrowHead, arrowLabelPos, arrowPathD, buildSvg, planExport, unionBounds } from "./svg";
import type { ExportOpts } from "./index";

export class ExportError extends Error {}

const PAD = 24;

export function themeOf(editor: EditorAPI): Theme { return (editor as unknown as { theme?: Theme }).theme ?? LIGHT; }

/** the icons module may load its pack lazily (ensureIcons); feature-detect so this file works with either version */
async function ensureIcons(): Promise<void> {
  await (Icons as unknown as { ensureIcons?: () => Promise<void> }).ensureIcons?.();
}

export function collect(editor: EditorAPI, selectionOnly: boolean): { els: El[]; usedSelection: boolean } {
  const sel = editor.selection();
  if (selectionOnly && sel.size > 0) {
    const els = [...sel].map((id) => editor.scene.els.get(id)).filter((e): e is El => !!e);
    if (els.length) return { els, usedSelection: true };
  }
  return { els: [...editor.scene.els.values()], usedSelection: false };
}

type DrawEl = (ctx: CanvasRenderingContext2D, e: El, th: Theme, z: number, lod: boolean) => void;

/** minimal fallback if the renderer's drawEl is unavailable: keeps export working even if the renderer is reorganised */
const basicDraw: DrawEl = (ctx, e, th) => {
  const c = th.cats[e.cat % th.cats.length]!;
  ctx.beginPath();
  if (e.kind === "ellipse") ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
  else if (e.kind === "diamond") { ctx.moveTo(e.x + e.w / 2, e.y); ctx.lineTo(e.x + e.w, e.y + e.h / 2); ctx.lineTo(e.x + e.w / 2, e.y + e.h); ctx.lineTo(e.x, e.y + e.h / 2); ctx.closePath(); }
  else if (e.kind === "text") { /* label only */ }
  else ctx.roundRect(e.x, e.y, e.w, e.h, e.edge === 0 ? 0 : e.radius);
  if (e.kind !== "text") {
    if (e.fill) { ctx.globalAlpha = e.fill === 1 ? th.tint : 1; ctx.fillStyle = c; ctx.fill(); }
    ctx.globalAlpha = 1; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
  }
  if (e.text) { ctx.fillStyle = e.fill === 2 && e.kind !== "text" ? th.paper : th.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(e.text, e.x + e.w / 2, e.y + e.h / 2); }
};
const drawShape: DrawEl = ((Renderer as unknown as { drawEl?: DrawEl }).drawEl) ?? basicDraw;

function drawArrow(ctx: CanvasRenderingContext2D, e: El, th: Theme): void {
  const c = th.cats[e.cat % th.cats.length]!;
  ctx.globalAlpha = 1; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.setLineDash(e.dash ? [7, 6] : []);
  ctx.stroke(new Path2D(arrowPathD(e)));
  ctx.setLineDash([]);
  const h = arrowHead(e);
  if (h.chevron) ctx.stroke(new Path2D(h.chevron));
  if (h.dot) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(h.dot.x, h.dot.y, h.dot.r, 0, Math.PI * 2); ctx.fill(); }
  if (e.text) {
    const [lx, ly] = arrowLabelPos(e);
    ctx.font = "12px 'JetBrains Mono','DejaVu Sans Mono',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 4; ctx.strokeStyle = th.paper; ctx.strokeText(e.text, lx, ly);
    ctx.fillStyle = th.ink; ctx.fillText(e.text, lx, ly);
  }
}

export interface PngResult { blob: Blob; width: number; height: number; scaledDown: boolean; usedSelection: boolean }

/** Render to a PNG using the same shape code as the live canvas. Frees the bitmap before returning. */
export async function renderPng(editor: EditorAPI, o: ExportOpts = {}): Promise<PngResult> {
  const { els, usedSelection } = collect(editor, !!o.selectionOnly);
  const b = unionBounds(els);
  if (!b) throw new ExportError("Nothing to export — the canvas is empty.");
  const plan = planExport(b, o.scale ?? 2, PAD);
  if (!plan.ok) throw new ExportError(plan.message);
  await ensureIcons();
  const th = themeOf(editor);
  const oc = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(plan.width, plan.height) : Object.assign(document.createElement("canvas"), { width: plan.width, height: plan.height });
  const ctx = oc.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) throw new ExportError("Could not create a drawing surface for the export.");
  try {
    if (o.background ?? true) { ctx.fillStyle = th.paper; ctx.fillRect(0, 0, plan.width, plan.height); }
    const s = plan.scale;
    ctx.setTransform(s, 0, 0, s, -plan.wx * s, -plan.wy * s);
    ctx.font = "13px 'JetBrains Mono','DejaVu Sans Mono',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const e of [...els].sort((a, c) => a.z - c.z)) {
      if (e.kind === "arrow") drawArrow(ctx, e, th);
      else if (e.kind === "icon") Icons.drawIconEl(ctx, e, th, s);
      else drawShape(ctx, e, th, s, false);
      ctx.globalAlpha = 1;
    }
    const blob: Blob = "convertToBlob" in oc
      ? await (oc as OffscreenCanvas).convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((res, rej) => (oc as HTMLCanvasElement).toBlob((bl) => (bl ? res(bl) : rej(new ExportError("PNG encoding failed"))), "image/png"));
    return { blob, width: plan.width, height: plan.height, scaledDown: plan.scaledDown, usedSelection };
  } finally {
    oc.width = 0; oc.height = 0; // release the backing store now rather than at GC
  }
}

export async function renderSvg(editor: EditorAPI, o: ExportOpts = {}): Promise<{ text: string; usedSelection: boolean }> {
  const { els, usedSelection } = collect(editor, !!o.selectionOnly);
  if (!els.length) throw new ExportError("Nothing to export — the canvas is empty.");
  await ensureIcons();
  return { text: buildSvg(els, themeOf(editor), { background: o.background ?? true, padding: PAD, icons: Icons.iconSvg }), usedSelection };
}
