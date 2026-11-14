import { buildGraph, isTooLarge, MAX_EDGES, MAX_NODES } from "../load/graph";
import { steady, timeline, type Steady, type Timeline } from "../load/model";
import { FACE } from "../renderer";
import { isCurve } from "../connectors";
import type { El } from "../scene";
import { onThemeChange, theme } from "../theme";
import { textWidth } from "../text-edit";
import type { Ctx, LoadEdge, LoadViewApi } from "./ctx";
import { Disposer } from "./dom";
import { plateRects } from "./flow";
import { mountLoadPanels } from "./load-panels";
import { FrameSrc, steadySrc, type Src } from "./load-src";
import { scenarioT, spikesOf, TL_DT } from "./load-fields";
import { CHIP_FS, createCoalescer, loadColours, lod, MIN_RATE, placeChip, rateText, chipSize, readout, TEXT_MIN_ZOOM, type Readout } from "./load-draw";

interface RendererLike { dragging?: ReadonlySet<string>; ghostArrow?: unknown; hidden?: ReadonlySet<string> | null }
interface Chip { v: number; rate: number; text: string; x: number; y: number; w: number; h: number }

/**
 * Load view (read-only): rate chips on arrows, utilisation bars under services that have a capacity. Its own transparent canvas
 * inside #ui (like the flow dots): the drawing layers are never repainted for it and exports never include it (v1: PNG/SVG do
 * not carry the numbers, see docs/plans/load-model.md).
 *
 * Cost model: nothing runs while idle. The model (graph + steady state) is recomputed only after the scene changed, at most once
 * per animation frame; a viewport change only repaints the overlay (visible elements only). While something is being dragged
 * the overlay is cleared and left alone until the gesture ends. Turning the view off frees the canvas, listeners, caches and
 * the result.
 */
export function mountLoadView(ctx: Ctx, root: HTMLElement): void {
  if (ctx.loadView) return;
  const { editor, settings } = ctx;
  const stage = document.getElementById("stage");
  const rd = (editor as unknown as { renderer?: RendererLike }).renderer;
  if (!stage) return;

  const canvas = document.createElement("canvas");
  canvas.className = "ap-load";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  const flowCanvas = root.querySelector(".ap-flow");
  if (flowCanvas) flowCanvas.after(canvas); else root.prepend(canvas); // above the dots, below the chrome
  const g = canvas.getContext("2d");
  if (!g) { canvas.remove(); return; }

  const d = new Disposer();
  const subs = new Set<() => void>();
  let st: Steady | null = null, tooLarge = false, warned = false, stopped = false, drawn = false;
  let lastNonce = -1, dirtyGraph = true;
  // scenario: the timeline is computed lazily (first play / scrub) and dropped whenever the model is rebuilt; `frame` != null = show it
  let gen = 0, tl: Timeline | null = null, tlGen = -1, frame: number | null = null, fsrc: FrameSrc | null = null, ssrc: Src | null = null, disposePanels: (() => void) | null = null;
  const ensureTl = (): Timeline | null => {
    if (!st) return null;
    if (tl && tlGen === gen) return tl;
    const sp = spikesOf(st.g);
    if (sp.length === 0) { tl = null; fsrc = null; return null; }
    tl = timeline(st.g, { dt: TL_DT, T: scenarioT(sp.map((x) => x.s)) }); tlGen = gen;
    fsrc = new FrameSrc(st, tl);
    return tl;
  };
  /** what to draw now: the timeline frame while one is selected, else the steady state */
  const cur = (): Src | null => {
    if (!st) return null;
    if (frame !== null && ensureTl() && fsrc) { fsrc.i = Math.max(0, Math.min(tl!.steps - 1, frame)); return fsrc; }
    return ssrc ??= steadySrc(st);
  };
  // the viewport the overlay was last painted for, whether it is currently shifted, and the pan-settle timer
  let dvx = 0, dvy = 0, dz = 0, shifted = false, settle: ReturnType<typeof setTimeout> | undefined;
  const SETTLE_MS = 120;
  let cw = 0, ch = 0, dpr = 1;
  let chips = new Map<string, Chip>();
  /** per node index: its readout, built on first sight after a recompute (not per frame); cleared with the result */
  let reads: (Readout | null | undefined)[] = [];
  const tmp: El[] = [], plates: number[] = [], pt: [number, number] = [0, 0];
  const FONT = `600 ${CHIP_FS}px ${FACE}`, NODE_FONT = `600 10.5px ${FACE}`;

  const recompute = () => {
    const n = editor.scene.nonce;
    if (n === lastNonce) return;
    lastNonce = n;
    const gr = buildGraph(editor.scene.els.values());
    chips = new Map(); reads = []; gen++; ssrc = null; tl = null; fsrc = null;
    if (isTooLarge(gr)) {
      st = null; tooLarge = true;
      if (!warned) { warned = true; ctx.toast(`Load view skipped: more than ${MAX_NODES} connected shapes or ${MAX_EDGES} arrows`); }
    } else { st = steady(gr); tooLarge = false; warned = false; }
    if (frame !== null && (!st || spikesOf(st.g).length === 0)) frame = null; // the scenario is gone: back to the steady state
    for (const cb of subs) cb();
    ctx.flowKick?.();
  };

  const clear = () => { if (drawn) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch); drawn = false; } };
  const busy = () => !!(rd?.dragging?.size || rd?.ghostArrow);

  const draw = () => {
    if (busy()) { clear(); return; } // arrows being dragged have different geometry: wait for the gesture to end
    clear();
    clearTimeout(settle);
    if (shifted) { canvas.style.transform = ""; shifted = false; }
    const sr = cur();
    if (!st || !sr || cw === 0) return;
    const gr = st.g, vp = editor.vp, z = vp.zoom, s = dpr * z, hidden = rd?.hidden;
    dvx = vp.x; dvy = vp.y; dz = z;
    const col = loadColours(theme.paper);
    g.setTransform(s, 0, 0, s, -vp.x * s, -vp.y * s);
    g.textAlign = "center"; g.textBaseline = "middle";
    editor.scene.query(vp.x, vp.y, vp.x + vp.w / z, vp.y + vp.h / z, tmp);
    const showText = z >= TEXT_MIN_ZOOM;
    g.lineWidth = Math.max(1, 1 / z);
    let font = "";
    for (let i = 0; i < tmp.length; i++) {
      const e = tmp[i]!;
      if (hidden?.has(e.id)) continue;
      if (e.kind === "arrow") {
        if (!showText) continue;
        const ei = gr.edgeIndex.get(e.id);
        if (ei === undefined) continue;
        const rate = sr.edge(ei);
        if (!(rate >= MIN_RATE)) continue;
        let c = chips.get(e.id);
        if (!c || c.v !== e.version || (sr.frame && c.rate !== rate)) { // chips are cleared with every recompute; in a timeline frame the text follows the frame
          const text = rateText(rate);
          if (c && c.v === e.version && c.text === text) { c.rate = rate; } else {
          g.font = font = FONT;
          const sz = chipSize(text, (t) => g.measureText(t).width);
          plateRects(e, (fs) => (t) => textWidth(t, fs), plates);
          placeChip(e.pts, isCurve(e), sz.w, sz.h, plates, pt);
          c = { v: e.version, rate, text, x: c && c.v === e.version ? c.x : pt[0], y: c && c.v === e.version ? c.y : pt[1], w: sz.w, h: sz.h };
          chips.set(e.id, c);
          }
        }
        if (font !== FONT) { g.font = font = FONT; }
        g.fillStyle = theme.paper; g.fillRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h);
        g.strokeStyle = sr.sat(gr.edst[ei]!) ? col.bad : theme.mid; g.strokeRect(c.x - c.w / 2 + 0.5 / z, c.y - c.h / 2 + 0.5 / z, c.w - 1 / z, c.h - 1 / z);
        g.fillStyle = theme.ink; g.fillText(c.text, c.x, c.y + 0.5);
      } else {
        const v = gr.nodeIndex.get(e.id);
        if (v === undefined || !gr.hasCap[v]) continue;
        const L = lod(z, e.w);
        let ro = reads[v];
        if (ro === undefined) ro = reads[v] = readout(gr.role[v]!, sr.in(v), gr.cap[v]!, sr.util(v), sr.dropped(v), sr.growth(v), sr.backlog(v));
        if (!ro) continue;
        const colour = col[ro.level];
        const bw = Math.max(24, Math.min(e.w, 150)), bh = Math.max(4, 2 / z), cx = e.x + e.w / 2, by = e.y + e.h + 6;
        if (L.bar) {
          g.globalAlpha = 0.22; g.fillStyle = theme.mid; g.fillRect(cx - bw / 2, by, bw, bh);
          g.globalAlpha = 1; g.fillStyle = colour; g.fillRect(cx - bw / 2, by, bw * ro.frac, bh);
        }
        if (L.text) {
          if (font !== NODE_FONT) { g.font = font = NODE_FONT; } g.fillStyle = colour; g.fillText(ro.line, cx, by + bh + 9);
          if (ro.extra) { g.fillStyle = col.bad; g.fillText(ro.extra, cx, by + bh + 23); }
        }
      }
    }
    tmp.length = 0;
    drawn = true;
  };

  const sched = createCoalescer(() => {
    if (stopped) return;
    if (dirtyGraph) { dirtyGraph = false; recompute(); }
    draw();
  }, (cb) => requestAnimationFrame(cb), (id) => cancelAnimationFrame(id));

  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight, dd = Math.min(2, window.devicePixelRatio || 1);
    const nw = Math.max(1, Math.round(w * dd)), nh = Math.max(1, Math.round(h * dd));
    if (nw === cw && nh === ch && dd === dpr) return; // equality guard: a resize can never feed itself
    cw = canvas.width = nw; ch = canvas.height = nh; dpr = dd; drawn = false;
    sched.schedule();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  const onScene = () => { dirtyGraph = true; sched.schedule(); };
  d.add(editor.on("change", onScene));
  d.add(editor.on("history", onScene));
  // panning (same zoom) only SHIFTS the finished overlay with a compositor transform, no repaint per frame; one real repaint
  // follows when the pan settles. A zoom change, or a shift past 30 % of the stage, repaints at once.
  d.add(editor.on("viewport", () => {
    const vp = editor.vp, z = vp.zoom;
    if (drawn && z === dz) {
      const dx = Math.round((dvx - vp.x) * z), dy = Math.round((dvy - vp.y) * z);
      if (Math.abs(dx) < vp.w * 0.3 && Math.abs(dy) < vp.h * 0.3) {
        canvas.style.transform = `translate(${dx}px,${dy}px)`; shifted = true;
        clearTimeout(settle); settle = setTimeout(() => sched.schedule(), SETTLE_MS);
        return;
      }
    }
    sched.schedule();
  }));
  d.add(onThemeChange(() => sched.schedule()));
  // a drag moves arrows without an editor event: clear the overlay at the first move, repaint when the pointer is released
  d.on(window, "pointermove", () => { if (drawn && busy()) clear(); }, { passive: true });
  d.on(window, "pointerup", onScene, { passive: true });
  d.add(settings.subscribe((_s, changed) => { if (changed.includes("load") && !settings.get().load) api.stop(); }));

  const edgeInfo = (id: string, out: LoadEdge): boolean => {
    if (!st) return false;
    const ei = st.g.edgeIndex.get(id);
    if (ei === undefined) return false;
    const sr = cur();
    if (!sr) return false;
    out.rate = sr.edge(ei); out.bad = sr.sat(st.g.edst[ei]!);
    return true;
  };
  const api: LoadViewApi = {
    on: true,
    steady: () => st,
    get tooLarge() { return tooLarge; },
    active() { if (!st) return false; for (const j of st.g.entries) if (st.g.rate[j]! > 0) return true; return false; },
    edge: edgeInfo,
    colour: () => loadColours(theme.paper).bad,
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    recompute() { lastNonce = -1; dirtyGraph = true; sched.schedule(); },
    timeline: ensureTl,
    frame: () => frame,
    setFrame(i) {
      if (stopped) return;
      const next = i === null ? null : Math.max(0, Math.floor(i));
      if (next === frame) return;
      if (next !== null && !ensureTl()) return;
      frame = next; reads = [];
      sched.schedule(); ctx.flowKick?.();
      for (const cb of subs) cb();
    },
    source: cur,
    stop() {
      if (stopped) return;
      stopped = true;
      disposePanels?.(); disposePanels = null;
      sched.cancel(); clearTimeout(settle); d.dispose(); ro.disconnect(); subs.clear();
      frame = null; tl = null; fsrc = null; ssrc = null;
      chips = new Map(); st = null; tmp.length = 0; plates.length = 0;
      canvas.remove();
      if (ctx.loadView === api) ctx.loadView = undefined;
      ctx.flowKick?.();
    },
  };
  ctx.loadView = api;
  resize();
  sched.schedule();
  // card, scenario bar and chart: part of this lazy chunk, so they exist only while the view is on
  disposePanels = mountLoadPanels(ctx, root, api);
}
