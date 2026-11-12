import { arrowLabels, bezierAt, effectiveRoute, isCurve, labelBlock, pointAtT, roundedPolyline, sceneRectOf, type RectOf } from "../connectors";
import type { El } from "../scene";
import type { Theme } from "../theme";
import { textWidth } from "../text-edit";
import type { Ctx } from "./ctx";

/**
 * Flow animation: small red-pencil dots travelling along POINTED arrows (head arrow / dot), start -> pointer, that are connected at
 * BOTH ends. Plain lines and arrows with an open end are not animated.
 *
 * Built to cost nothing when it cannot be seen and little when it can:
 *  - its own transparent canvas above the drawing (the static layer is never redrawn for it; exports never include it);
 *  - the frame loop runs ONLY while there is something to show: setting on, tab visible, motion not reduced, nothing being
 *    dragged, zoomed in enough to see a dot, and between 1 and CAP pointed arrows in view. Otherwise zero frames;
 *  - it rests after 30 s without input (battery) and wakes on the next input;
 *  - ~30 fps, constant screen speed, path geometry cached per arrow version, no per-frame allocation.
 */
const CAP = 150;
const FRAME_MS = 33;
const REST_MS = 30_000;
const MIN_ZOOM = 0.25;
const SPEED = 55; // screen px / s
const DOT = 3.3; // screen px radius
const BEZIER_STEPS = 18;

interface Path { v: number; poly: number[]; cum: number[]; len: number }
interface Plates { v: number; r: number[] }
interface RendererLike { dragging?: ReadonlySet<string>; ghostArrow?: unknown; hidden?: ReadonlySet<string> | null; degraded?: boolean; theme?: Theme }

const probe: [number, number] = [0, 0];
const lpt: [number, number] = [0, 0];

/**
 * The plates the renderer paints behind an arrow's labels, as flat world-space rects [x, y, w, h, ...] (one per non-empty label; a
 * multi-line label is ONE plate over the whole block, sized by `labelBlock` like the drawn one). `out` is reset and filled.
 */
export function plateRects(e: El, measure: (fs: number) => (t: string) => number, out: number[]): void {
  out.length = 0;
  const ls = arrowLabels(e);
  if (ls.length === 0 || e.pts.length < 4) return;
  const fs = e.fs || 13, m = measure(fs), curve = isCurve(e);
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!;
    if (!l.text) continue;
    pointAtT(e.pts, curve, l.t, lpt);
    const b = labelBlock(l.text, fs, m);
    out.push(lpt[0] - b.w / 2, lpt[1] - b.h / 2, b.w, b.h);
  }
}

/** clip `g` to the view rect minus every plate (even-odd), so a dot never paints over a label */
export interface ClipTarget { beginPath(): void; rect(x: number, y: number, w: number, h: number): void; clip(rule: "evenodd"): void }
export function clipOutPlates(g: ClipTarget, x: number, y: number, w: number, h: number, plates: readonly number[]): void {
  g.beginPath();
  g.rect(x, y, w, h);
  for (let i = 0; i < plates.length; i += 4) g.rect(plates[i]!, plates[i + 1]!, plates[i + 2]!, plates[i + 3]!);
  g.clip("evenodd");
}

/**
 * An end is connected when the router can resolve it, through the very same resolver connectors use (`sceneRectOf`): a shape of any
 * kind, a group with members, or another arrow (a branch end). Nothing here lists kinds.
 */
export function endResolves(rectOf: RectOf, id: string): boolean {
  return id !== "" && (rectOf(id) !== null || !!rectOf.host?.(id, 0.5, probe));
}

/** a pointed arrow connected at both ends: the only kind that flows */
export function flows(rectOf: RectOf, e: El): boolean {
  return e.kind === "arrow" && e.head !== 0 && endResolves(rectOf, e.src) && endResolves(rectOf, e.dst);
}

export function mountFlow(ctx: Ctx, root: HTMLElement): void {
  const { editor, settings } = ctx;
  const stage = document.getElementById("stage");
  const theme = (editor as unknown as { theme?: Theme }).theme;
  const rd = (editor as unknown as { renderer?: RendererLike }).renderer;
  if (!stage || !theme) return;

  const canvas = document.createElement("canvas");
  canvas.className = "ap-flow";
  canvas.setAttribute("aria-hidden", "true");
  root.prepend(canvas); // inside #ui (pointer-events: none), above the drawing layers, below the chrome
  const g = canvas.getContext("2d");
  if (!g) { canvas.remove(); return; }

  const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  let cw = 0, ch = 0, dpr = 1;
  let raf = 0, last = 0, lastInput = performance.now(), disposed = false, painted = false;
  let cache = new Map<string, Path>();
  let list: El[] = [];
  /** every listed arrow's label plates, concatenated; rebuilt with the list (never per frame) */
  let plates: number[] = [];
  let plateCache = new Map<string, Plates>();
  let builtNonce = -1, builtVp = -1;
  const tmp: El[] = [];
  const pt: [number, number] = [0, 0];

  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight, d = Math.min(2, window.devicePixelRatio || 1);
    const nw = Math.max(1, Math.round(w * d)), nh = Math.max(1, Math.round(h * d));
    if (nw === cw && nh === ch && d === dpr) return; // equality guard: a resize can never feed itself
    cw = canvas.width = nw; ch = canvas.height = nh; dpr = d; painted = false;
    kick();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  const pathOf = (e: El): Path | null => {
    const hit = cache.get(e.id);
    if (hit && hit.v === e.version) return hit;
    const p = e.pts, n = p.length;
    if (n < 4) return null;
    const poly: number[] = [];
    // matches connectors.ts's arrowDist (hit-testing) and routeArrow: a soft-edged ELBOW
    // (route 1, edge 2) also routes as an 8-number cubic bezier, same as a literal curve route.
    // Checking e.route alone (not effectiveRoute) missed that case: the dot walked the 4 raw
    // control points as straight polyline vertices instead of sampling the curve between them,
    // visibly cutting the corner instead of tracking the arrow's actual rendered path.
    if (n === 8 && effectiveRoute(e.route, e.edge) === 2) { for (let i = 0; i <= BEZIER_STEPS; i++) { bezierAt(p, i / BEZIER_STEPS, pt); poly.push(pt[0], pt[1]); } }
    // round-edged elbows are DRAWN with rounded corners (renderer arcTo): walk those arcs, not the sharp corner points
    else if (e.edge === 1 && n > 4) for (const v of roundedPolyline(p)) poly.push(v);
    else for (let i = 0; i < n; i++) poly.push(p[i]!);
    const cum = [0];
    let len = 0;
    for (let i = 2; i < poly.length; i += 2) { len += Math.hypot(poly[i]! - poly[i - 2]!, poly[i + 1]! - poly[i - 1]!); cum.push(len); }
    if (!(len > 0)) return null;
    const out = { v: e.version, poly, cum, len };
    cache.set(e.id, out);
    return out;
  };

  /** pointed arrows in view; rebuilt only when the scene or the viewport changed */
  const refresh = () => {
    const vp = editor.vp, nonce = editor.scene.nonce;
    if (nonce === builtNonce && vp.version === builtVp) return;
    builtNonce = nonce; builtVp = vp.version;
    editor.scene.query(vp.x, vp.y, vp.x + vp.w / vp.zoom, vp.y + vp.h / vp.zoom, tmp);
    list = [];
    const rectOf = sceneRectOf(editor.scene);
    const keep = new Map<string, Path>();
    for (const e of tmp) {
      // a connection is two ends: an arrow attached at only one end (or to something since deleted) is unfinished, so nothing flows along it
      if (!flows(rectOf, e)) continue;
      list.push(e);
      const c = cache.get(e.id);
      if (c) keep.set(e.id, c);
    }
    // label plates: the dots must not run over a label. Measured here, once per arrow version, never in the frame
    plates = [];
    const pkeep = new Map<string, Plates>();
    for (const e of list) {
      let pc = plateCache.get(e.id);
      if (!pc || pc.v !== e.version) { pc = { v: e.version, r: [] }; plateRects(e, (fs) => (t) => textWidth(t, fs), pc.r); }
      pkeep.set(e.id, pc);
      for (let i = 0; i < pc.r.length; i++) plates.push(pc.r[i]!);
    }
    plateCache = pkeep;
    cache = keep; // entries for arrows that left the view are dropped: the cache tracks what is visible, not the whole sheet
  };

  const canRun = (): boolean => {
    if (disposed || !settings.get().flow || mq?.matches || document.visibilityState !== "visible") return false;
    if (performance.now() - lastInput > REST_MS) return false;
    if (editor.vp.zoom < MIN_ZOOM || rd?.degraded) return false;
    if (rd?.dragging?.size || rd?.ghostArrow) return false; // arrows being dragged are drawn by the live layer with different geometry
    refresh();
    return list.length > 0 && list.length <= CAP;
  };

  const clear = () => { if (painted) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch); painted = false; } };

  const frame = (t: number) => {
    raf = 0;
    if (!canRun()) { clear(); return; } // not scheduling again: the loop is OFF until an event kicks it
    raf = requestAnimationFrame(frame);
    if (t - last < FRAME_MS - 2) return;
    last = t;
    const vp = editor.vp, z = vp.zoom, s = dpr * z, r = DOT / z;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    g.setTransform(s, 0, 0, s, -vp.x * s, -vp.y * s);
    // keep label plates readable: clip the dots to everything EXCEPT the plates (even-odd: view rect minus plates)
    const clipped = plates.length > 0 && vp.zoom >= 0.3; // the renderer draws no label plates below 0.3
    if (clipped) {
      g.save();
      clipOutPlates(g, vp.x, vp.y, vp.w / z, vp.h / z, plates);
    }
    const base = (t / 1000) * (SPEED / z); // world units travelled since t = 0
    const hidden = rd?.hidden;
    let colour = "";
    for (const e of list) {
      if (hidden?.has(e.id)) continue;
      const p = pathOf(e);
      if (!p) continue;
      // red pencil = "what is happening": the dots stay visible on a line of any category colour
      const col = theme.red;
      if (col !== colour) { g.fillStyle = col; g.strokeStyle = col; colour = col; }
      const gap = Math.max(70 / z, p.len / 6), count = Math.max(1, Math.floor(p.len / gap));
      const step = p.len / count, off = base % step;
      g.lineWidth = 1.4 / z;
      for (let k = 0; k < count; k++) {
        const d = off + k * step;
        // walk to the segment holding arc length d
        let i = 1;
        while (i < p.cum.length - 1 && p.cum[i]! < d) i++;
        const l0 = p.cum[i - 1]!, seg = p.cum[i]! - l0, f = seg > 0 ? (d - l0) / seg : 0;
        const x = p.poly[2 * i - 2]! + (p.poly[2 * i]! - p.poly[2 * i - 2]!) * f, y = p.poly[2 * i - 1]! + (p.poly[2 * i + 1]! - p.poly[2 * i - 1]!) * f;
        const dx = p.poly[2 * i]! - p.poly[2 * i - 2]!, dy = p.poly[2 * i + 1]! - p.poly[2 * i - 1]!, sl = Math.hypot(dx, dy) || 1;
        // short fading tail behind the dot, then the dot; async (dashed) arrows get hollow dots
        g.globalAlpha = 0.22; g.beginPath(); g.arc(x - (dx / sl) * r * 4.2, y - (dy / sl) * r * 4.2, r * 0.7, 0, 6.2832); g.fill();
        g.globalAlpha = 0.45; g.beginPath(); g.arc(x - (dx / sl) * r * 2.2, y - (dy / sl) * r * 2.2, r * 0.85, 0, 6.2832); g.fill();
        g.globalAlpha = 0.95; g.beginPath(); g.arc(x, y, r, 0, 6.2832);
        if (e.dash) { g.lineWidth = 1.6 / z; g.stroke(); g.fillStyle = theme.paper; g.globalAlpha = 0.9; g.fill(); g.fillStyle = col; } else g.fill();
      }
    }
    g.globalAlpha = 1;
    if (clipped) g.restore();
    painted = true;
  };

  function kick() { if (!raf && !disposed) raf = requestAnimationFrame(frame); }

  // anything that can change whether there is something to animate
  const offs = [
    editor.on("change", kick), editor.on("viewport", kick), editor.on("history", kick), editor.on("tool", kick), editor.on("selection", kick),
    settings.subscribe((_s, changed) => { if (changed.includes("flow")) { if (!settings.get().flow) clear(); kick(); } }),
  ];
  const onInput = () => { const was = performance.now() - lastInput > REST_MS; lastInput = performance.now(); if (was) kick(); };
  const onVis = () => kick();
  const onMotion = () => { clear(); kick(); };
  ctx.d.on(window, "pointerdown", onInput, { passive: true, capture: true });
  ctx.d.on(window, "keydown", onInput, { passive: true, capture: true });
  ctx.d.on(window, "wheel", onInput, { passive: true, capture: true });
  ctx.d.on(document, "visibilitychange", onVis);
  mq?.addEventListener("change", onMotion);
  kick();

  ctx.d.add(() => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const off of offs) off();
    mq?.removeEventListener("change", onMotion);
    ro.disconnect();
    cache.clear(); plateCache.clear(); plates = []; list = []; tmp.length = 0;
    canvas.remove();
  });
}
