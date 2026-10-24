import type { EditorAPI } from "../editor-api";
import { ensureCalc } from "../calc-view";
import * as Renderer from "../renderer";
import type { El } from "../scene";
import { LIGHT, colourOf, onSolid, type Theme } from "../theme";
import * as Icons from "../icons";
import { arrowLabels, isCurve, pointAtT } from "../connectors";
import { exportGroups, type GroupOutline } from "../groups";
import { textWidth } from "../text-edit";
import { arrowHead, arrowPathD, boundsWithGroups, buildSvg, planExport, unionBounds } from "./svg";
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

/** the group outlines an export of `els` should show: groups whose members are all in `els` (see exportGroups) */
export function groupsFor(editor: EditorAPI, els: readonly El[]): GroupOutline[] {
  const sc = editor.scene;
  if (sc.groups.size === 0) return [];
  const total = new Map<string, number>();
  for (const e of sc.els.values()) for (const g of e.groupIds) total.set(g, (total.get(g) ?? 0) + 1);
  return exportGroups(els, sc.groups.values(), (id) => total.get(id) ?? 0);
}

/** dashed, tinted outline and name tag per group, under the elements: the same drawing as Renderer.drawGroups (which works from the live GroupIndex) */
function drawGroupOutlines(ctx: CanvasRenderingContext2D, th: Theme, groups: readonly GroupOutline[]): void {
  for (const g of groups) {
    const col = th.cats[g.cat % th.cats.length]!, b = g.box;
    ctx.globalAlpha = 0.05; ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 14); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([8, 4]); ctx.stroke(); ctx.setLineDash([]);
    if (g.name) {
      ctx.fillStyle = col; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(g.name, b.x + 12, b.y - 8);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
    }
  }
}

type DrawEl = (ctx: CanvasRenderingContext2D, e: El, th: Theme, z: number, lod: boolean) => void;

/** minimal fallback if the renderer's drawEl is unavailable: keeps export working even if the renderer is reorganised */
const basicDraw: DrawEl = (ctx, e, th) => {
  const c = colourOf(th, e);
  ctx.beginPath();
  if (e.kind === "ellipse") ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
  else if (e.kind === "diamond") { ctx.moveTo(e.x + e.w / 2, e.y); ctx.lineTo(e.x + e.w, e.y + e.h / 2); ctx.lineTo(e.x + e.w / 2, e.y + e.h); ctx.lineTo(e.x, e.y + e.h / 2); ctx.closePath(); }
  else if (e.kind === "text") { /* label only */ }
  else ctx.roundRect(e.x, e.y, e.w, e.h, e.edge === 0 ? 0 : e.radius);
  if (e.kind !== "text") {
    if (e.fill) { ctx.globalAlpha = e.fill === 1 ? th.tint : 1; ctx.fillStyle = c; ctx.fill(); }
    ctx.globalAlpha = 1; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
  }
  if (e.text) { ctx.fillStyle = e.fill === 2 && e.kind !== "text" ? onSolid(th, c) : th.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(e.text, e.x + e.w / 2, e.y + e.h / 2); }
};
const drawShape: DrawEl = ((Renderer as unknown as { drawEl?: DrawEl }).drawEl) ?? basicDraw;

function drawArrow(ctx: CanvasRenderingContext2D, e: El, th: Theme): void {
  const c = colourOf(th, e);
  ctx.globalAlpha = 1; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.setLineDash(e.dash ? [7, 6] : []);
  ctx.stroke(new Path2D(arrowPathD(e)));
  ctx.setLineDash([]);
  const h = arrowHead(e);
  if (h.chevron) ctx.stroke(new Path2D(h.chevron));
  if (h.dot) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(h.dot.x, h.dot.y, h.dot.r, 0, Math.PI * 2); ctx.fill(); }
  const ls = arrowLabels(e);
  if (ls.length) {
    const curve = isCurve(e), at: [number, number] = [0, 0];
    ctx.font = `${e.fs || 12}px 'JetBrains Mono','DejaVu Sans Mono',monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const l of ls) {
      pointAtT(e.pts, curve, l.t, at);
      ctx.lineWidth = 4; ctx.strokeStyle = th.paper; ctx.strokeText(l.text, at[0], at[1]);
      ctx.fillStyle = th.ink; ctx.fillText(l.text, at[0], at[1]);
    }
  }
}

export const imageKeys = (els: readonly El[]): string[] => [...new Set(els.filter((e) => e.kind === "image" && e.img).map((e) => e.img))];
async function preloadImages(els: readonly El[]): Promise<void> {
  const keys = imageKeys(els);
  if (keys.length) await (await import("../images")).preloadImages(keys);
}

export interface PngResult { blob: Blob; width: number; height: number; scaledDown: boolean; usedSelection: boolean }

/** Render to a PNG using the same shape code as the live canvas. Frees the bitmap before returning. */
export async function renderPng(editor: EditorAPI, o: ExportOpts = {}): Promise<PngResult> {
  const { els, usedSelection } = collect(editor, !!o.selectionOnly);
  const groups = groupsFor(editor, els);
  const b = boundsWithGroups(unionBounds(els), groups); // the outlines and name tags sit outside the members: they must not be cropped
  if (!b) throw new ExportError("Nothing to export — the canvas is empty.");
  const plan = planExport(b, o.scale ?? 2, PAD);
  if (!plan.ok) throw new ExportError(plan.message);
  await ensureIcons();
  if (els.some((e) => e.kind === "calc")) await ensureCalc().catch(() => {}); // results are cached per element once the evaluator is loaded
  await preloadImages(els); // image elements: decode their bitmaps before drawing (same cache and drawer as the canvas)
  const th = themeOf(editor);
  const oc = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(plan.width, plan.height) : Object.assign(document.createElement("canvas"), { width: plan.width, height: plan.height });
  const ctx = oc.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) throw new ExportError("Could not create a drawing surface for the export.");
  try {
    if (o.background ?? true) { ctx.fillStyle = th.paper; ctx.fillRect(0, 0, plan.width, plan.height); }
    const s = plan.scale;
    ctx.setTransform(s, 0, 0, s, -plan.wx * s, -plan.wy * s);
    ctx.font = "13px 'JetBrains Mono','DejaVu Sans Mono',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    drawGroupOutlines(ctx, th, groups);
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
  const calc = els.some((e) => e.kind === "calc") ? await ensureCalc().catch(() => null) : null;
  const keys = imageKeys(els);
  let images: Record<string, string> | undefined;
  if (keys.length) {
    const r = await (await import("../images")).collectImages(keys);
    if (r.tooBig) throw new ExportError("The images in this drawing are too large to embed in an SVG (20 MB limit). Export as PNG, or remove some images.");
    images = r.images;
  }
  return { text: buildSvg(els, themeOf(editor), { background: o.background ?? true, padding: PAD, icons: Icons.iconSvg, groups: groupsFor(editor, els), measure: textWidth, ...(calc ? { calc: calc.evalCalc } : {}), ...(images ? { images } : {}) }), usedSelection };
}
