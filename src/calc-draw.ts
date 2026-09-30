import { calcRows, CALC_LINE, CALC_PAD } from "./calc-view";
import type { El } from "./scene";
import type { Theme } from "./theme";

// Lazy chunk (loaded with the evaluator): the capacity-note draw routine lives here so the entry bundle only holds a tiny dispatch.
const FONT = "13px 'JetBrains Mono','DejaVu Sans Mono',monospace";
const BOLD_FONT = "700 13px 'JetBrains Mono','DejaVu Sans Mono',monospace";

/** capacity note: the sticky-note look with a right-aligned result column. Results come from a per-version cache (calc-view), never a per-frame evaluation. */
export function drawCalc(ctx: CanvasRenderingContext2D, e: El, th: Theme, z: number, lod: boolean, hideText: boolean): void {
  const col = th.cats[e.cat % th.cats.length]!;
  const f = Math.max(8, Math.min(18, e.w * 0.06, e.h * 0.25));
  ctx.beginPath();
  ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.w, e.y); ctx.lineTo(e.x + e.w, e.y + e.h - f); ctx.lineTo(e.x + e.w - f, e.y + e.h); ctx.lineTo(e.x, e.y + e.h); ctx.closePath();
  if (lod) { ctx.globalAlpha = 0.55; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; return; }
  if (e.fill === 1) { ctx.globalAlpha = th.tint; ctx.fillStyle = col; ctx.fill(); }
  else if (e.fill === 2) { ctx.globalAlpha = 0.9; ctx.fillStyle = col; ctx.fill(); }
  ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 1 / z); ctx.lineJoin = "round"; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(e.x + e.w - f, e.y + e.h); ctx.lineTo(e.x + e.w - f, e.y + e.h - f); ctx.lineTo(e.x + e.w, e.y + e.h - f);
  ctx.globalAlpha = 0.7; ctx.lineWidth = Math.max(1.5, 1 / z); ctx.stroke(); ctx.globalAlpha = 1;
  if (z < 0.3 || hideText || !e.text) return;
  const rows = calcRows(e);
  ctx.textBaseline = "middle";
  const left = e.x + CALC_PAD, right = e.x + e.w - CALC_PAD, solid = e.fill === 2;
  const lines = rows ?? e.text.split("\n", 40).map((t) => ({ kind: "line" as const, name: "", expr: t, text: "", value: null, err: "" }));
  for (let i = 0; i < lines.length; i++) {
    const r = lines[i]!, y = e.y + CALC_PAD + i * CALC_LINE + CALC_LINE / 2;
    if (r.kind === "blank") continue;
    const resText = r.err ? r.err : r.text ? `→ ${r.text}` : "";
    const resW = resText ? (resText.length + 1) * 7.9 : 0;
    ctx.textAlign = "left";
    ctx.fillStyle = r.kind === "comment" ? th.mid : solid ? th.paper : th.ink;
    ctx.globalAlpha = r.kind === "comment" ? 0.9 : 1;
    ctx.fillText(r.kind === "comment" ? `# ${r.expr}` : r.expr, left, y, Math.max(40, right - left - resW - 8));
    ctx.globalAlpha = 1;
    if (!resText) continue;
    ctx.textAlign = "right";
    if (r.err) { ctx.fillStyle = th.red; ctx.fillText(`! ${r.err}`, right, y, Math.max(40, right - left - 40)); }
    else { ctx.fillStyle = solid ? th.paper : th.ink; ctx.font = BOLD_FONT; ctx.fillText(resText, right, y, Math.max(40, right - left - 40)); ctx.font = FONT; }
  }
  ctx.textAlign = "center";
}

