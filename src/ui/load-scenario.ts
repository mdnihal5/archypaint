import type { Ctx, LoadViewApi } from "./ctx";
import type { Timeline } from "../load/model";
import type { Graph } from "../load/graph";
import { QUEUE } from "../load/graph";
import { fmt } from "../load/model";
import { DARK_LOAD, loadColours } from "./load-draw";
import { onThemeChange, theme } from "../theme";
import { Disposer, h, setAttr, setHidden, setText } from "./dom";
import { svgIcon } from "./glyphs";
import { TL_DT, fmtTime, frameAt, scenarioT, spikeLabel, spikesOf, type Spike } from "./load-fields";

/** series colours (not the status colours: red/amber/green already mean "how loaded"), readable on both papers */
export const SERIES_LIGHT = ["#2b6cb0", "#a45a00", "#8a3fb0"];
export const SERIES_DARK = ["#6cc4ff", "#f0b84a", "#c9a0ff"];
const Y_MAX = 2.5; // utilisation axis: 0 .. 250 %, higher values are clipped at the top edge

export interface Series { v: number; name: string; peak: number; data: Float32Array }
export interface ChartData { series: Series[]; /** largest queue backlog over time, if any queue */ queue: { v: number; name: string; peak: number; at: number } | null; ampPeak: number }

/** the up-to-3 busiest nodes (by peak utilisation) of a timeline, the biggest queue backlog and the peak amplification. Pure. */
export function chartData(g: Graph, tl: Timeline): ChartData {
  const { nodes: n, steps } = tl;
  const peaks: { v: number; peak: number }[] = [];
  let q: ChartData["queue"] = null;
  for (let v = 0; v < n; v++) {
    if (g.hasCap[v]) {
      let p = 0;
      for (let i = 0; i < steps; i++) { const u = tl.util[i * n + v]!; if (u > p) p = u; }
      if (p > 0.005) peaks.push({ v, peak: p });
    }
    if (g.role[v] === QUEUE) {
      for (let i = 0; i < steps; i++) { const b = tl.backlog[i * n + v]!; if (b > (q?.peak ?? 0) + 1e-9) q = { v, name: g.names[v]!, peak: b, at: i * tl.dt }; }
    }
  }
  peaks.sort((a, b) => b.peak - a.peak || a.v - b.v);
  const series: Series[] = peaks.slice(0, 3).map(({ v, peak }) => {
    const data = new Float32Array(steps);
    for (let i = 0; i < steps; i++) data[i] = tl.util[i * n + v]!;
    return { v, name: g.names[v]!, peak, data };
  });
  let ampPeak = 1;
  for (let i = 0; i < steps; i++) if (tl.amp[i]! > ampPeak) ampPeak = tl.amp[i]!;
  return { series, queue: q, ampPeak };
}

/** the one text line under the chart: the biggest queue backlog and the retry amplification (now, when a frame is shown, and their peaks) */
export function chartLine(cd: ChartData, tl: Timeline, frame: number | null): string {
  const parts: string[] = [];
  if (cd.queue) {
    const now = frame === null ? null : tl.backlog[Math.min(frame, tl.steps - 1) * tl.nodes + cd.queue.v]!;
    parts.push(now === null ? `${cd.queue.name} backlog peaks at ${fmt(cd.queue.peak)}` : `${cd.queue.name} backlog ${fmt(now)} (peak ${fmt(cd.queue.peak)})`);
  }
  if (cd.ampPeak > 1.05) {
    const now = frame === null ? null : tl.amp[Math.min(frame, tl.steps - 1)]!;
    parts.push(now === null ? `amplification peaks at ×${cd.ampPeak.toFixed(1)}` : `amp ×${now.toFixed(1)} (peak ×${cd.ampPeak.toFixed(1)})`);
  }
  return parts.join(" · ");
}

const PLAY_G = `<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>`, PAUSE_G = `<path d="M8 5.5v13M16 5.5v13" stroke-width="2.6"/>`;
/** a graph this big builds its timeline on the first play / scrub, not when the spike is created */
const LAZY_SIZE = 2000;

export interface Scenario { dispose(): void }

/**
 * Scenario bar (top centre: spike summary, play/pause, scrubber with the spike window, time, speed, remove) and the utilisation chart
 * (top right). Both exist only while some entry has a spike. requestAnimationFrame runs ONLY while playing; pausing, finishing or
 * closing stops it, so an idle scenario costs nothing. The chart draws only when its data or the playhead frame changes.
 */
export function mountScenario(ctx: Ctx, parent: HTMLElement, lv: LoadViewApi): Scenario {
  const { editor } = ctx;
  const d = new Disposer();
  let chartOn = true, playing = false, raf = 0, last = 0, t = 0, speed = 1, shown = false, cd: ChartData | null = null, cdTl: Timeline | null = null, spikes: { v: number; s: Spike }[] = [];

  const pbtn = h("button", { class: "ap-ib sm", attrs: { type: "button", "aria-label": "Play scenario", title: "Play" } });
  const label = h("span", { class: "scn-label" });
  const range = h("input", { class: "scn-range", attrs: { type: "range", min: 0, max: 600, step: 1, value: 0, "aria-label": "Scenario time" } });
  const win = h("i", { class: "scn-win", attrs: { "aria-hidden": "true" } });
  const tlw = h("div", { class: "scn-tl" }, win, range);
  const time = h("span", { class: "scn-time" });
  const spd = h("button", { class: "ap-btn scn-spd", attrs: { type: "button", title: "Playback speed", "aria-label": "Playback speed 1x" }, text: "1×" });
  const xbtn = h("button", { class: "ap-ib sm", attrs: { type: "button", "aria-label": "Remove the traffic spike", title: "Remove the spike" } }, svgIcon(`<path d="M6 6l12 12M18 6L6 18"/>`, 16));
  // the chart can cover part of the diagram: one toggle folds it away for this session (the bar stays)
  const cbtn = h("button", { class: "ap-ib sm", attrs: { type: "button", "aria-label": "Hide the utilisation chart", "aria-pressed": "true", title: "Chart" } }, svgIcon(`<path d="M4 19h16M6 16l4-5 3 3 5-7"/>`, 16));
  const bar = h("section", { class: "ap-scn ap-card ap-hit", attrs: { "aria-label": "Traffic spike scenario" } }, pbtn, label, tlw, time, spd, cbtn, xbtn);

  const legend = h("div", { class: "lch-legend" });
  const canvas = h("canvas", { attrs: { "aria-label": "Utilisation over time", role: "img" } });
  const line = h("div", { class: "lch-line" });
  const chart = h("section", { class: "ap-lchart ap-card ap-hit", attrs: { "aria-label": "Utilisation over time" } }, h("div", { class: "lch-title", text: "Utilisation over time" }), legend, canvas, line);
  bar.hidden = chart.hidden = true;
  parent.append(bar, chart);

  const setPlayIcon = () => { pbtn.replaceChildren(svgIcon(playing ? PAUSE_G : PLAY_G, 18)); setAttr(pbtn, "aria-label", playing ? "Pause scenario" : "Play scenario"); pbtn.title = playing ? "Pause" : "Play"; };
  setPlayIcon();

  const totalT = () => scenarioT(spikes.map((x) => x.s));

  /* ---------- chart ---------- */
  let cw = 0, chh = 0;
  const drawChart = () => {
    if (chart.hidden) return;
    const g = canvas.getContext("2d");
    const tl = cdTl;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, hh = canvas.clientHeight;
    if (!g || w === 0) return;
    if (cw !== w || chh !== hh) { cw = w; chh = hh; canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const dark = loadColours(theme.paper) === DARK_LOAD, cols = dark ? SERIES_DARK : SERIES_LIGHT, mid = theme.mid, ink = theme.ink;
    const padL = 30, padB = 14, padT = 4, pw = w - padL - 4, ph = hh - padB - padT;
    const yOf = (u: number) => padT + ph - (Math.min(u, Y_MAX) / Y_MAX) * ph;
    g.font = `10px ${getComputedStyle(canvas).fontFamily}`; g.textBaseline = "middle";
    if (!tl || !cd) { g.fillStyle = mid; g.textAlign = "center"; g.fillText("press play to chart the spike", w / 2, hh / 2); return; }
    const T = (tl.steps - 1) * tl.dt, xOf = (s: number) => padL + (s / T) * pw;
    // spike windows
    g.fillStyle = dark ? "rgba(255,111,94,0.14)" : "rgba(197,48,48,0.10)";
    for (const sp of spikes) g.fillRect(xOf(Math.min(T, sp.s.start)), padT, Math.max(1, xOf(Math.min(T, sp.s.start + sp.s.dur)) - xOf(Math.min(T, sp.s.start))), ph);
    // 100 % line and axis labels
    g.strokeStyle = mid; g.globalAlpha = 0.7; g.setLineDash([3, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, yOf(1)); g.lineTo(padL + pw, yOf(1)); g.stroke(); g.setLineDash([]);
    g.globalAlpha = 0.25; g.beginPath(); g.moveTo(padL, yOf(0)); g.lineTo(padL + pw, yOf(0)); g.stroke(); g.globalAlpha = 1;
    g.fillStyle = mid; g.textAlign = "right"; g.fillText("100%", padL - 4, yOf(1)); g.fillText("0", padL - 4, yOf(0));
    g.textAlign = "left"; g.fillText("0 s", padL, hh - 5); g.textAlign = "right"; g.fillText(`${Math.round(T)} s`, padL + pw, hh - 5);
    // series
    const step = Math.max(1, Math.floor(tl.steps / (pw * 1.5)));
    g.lineWidth = 1.6; g.lineJoin = "round";
    cd.series.forEach((s, k) => {
      g.strokeStyle = cols[k]!; g.beginPath();
      for (let i = 0; i < tl.steps; i += step) { const x = xOf(i * tl.dt), y = yOf(s.data[i]!); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    });
    // playhead
    const f = lv.frame();
    if (f !== null) { const x = xOf(Math.min(T, f * tl.dt)); g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke(); }
  };
  const paintLegend = () => {
    legend.textContent = "";
    const dark = loadColours(theme.paper) === DARK_LOAD, cols = dark ? SERIES_DARK : SERIES_LIGHT;
    cd?.series.forEach((s, k) => { const sw = h("i", { class: "lch-sw" }); sw.style.background = cols[k]!; legend.append(h("span", { class: "lch-key" }, sw, s.name)); });
  };
  const paintLine = () => { const tl = cdTl; setText(line, tl && cd ? chartLine(cd, tl, lv.frame()) : ""); };

  /* ---------- bar ---------- */
  const paintBar = () => {
    const f = lv.frame(), tl = lv.timeline();
    const steps = tl ? tl.steps : Math.round(totalT() / TL_DT) + 1;
    if (Number(range.max) !== steps - 1) range.max = String(steps - 1);
    const v = f ?? 0;
    if (Number(range.value) !== v) range.value = String(v);
    setText(time, fmtTime(f === null ? 0 : f * TL_DT));
    range.setAttribute("aria-valuetext", fmtTime(f === null ? 0 : f * TL_DT));
    const T = (steps - 1) * TL_DT;
    const sp = spikes[0]?.s;
    if (sp) { win.style.left = `${(Math.min(sp.start, T) / T) * 100}%`; win.style.width = `${(Math.max(0, Math.min(sp.start + sp.dur, T) - Math.min(sp.start, T)) / T) * 100}%`; }
    // fill = elapsed
    tlw.style.setProperty("--p", `${(v / Math.max(1, steps - 1)) * 100}%`);
  };

  const hide = () => {
    shown = false; pause(); bar.hidden = chart.hidden = true;
    cd = null; cdTl = null; t = 0;
    if (lv.frame() !== null) lv.setFrame(null);
  };

  /** the model changed (an edit, undo, a recompute): re-read the spikes, the timeline and the chart */
  const refreshData = () => {
    const st = lv.steady();
    spikes = st ? spikesOf(st.g) : [];
    if (spikes.length === 0) { if (shown) hide(); return; }
    shown = true;
    bar.hidden = false; chart.hidden = !chartOn;
    setText(label, spikeLabel(spikes));
    setHidden(xbtn, editor.readOnly);
    const big = !!st && st.g.n + st.g.m > LAZY_SIZE;
    const tl = big && lv.frame() === null && !cdTl ? null : lv.timeline();
    if (tl && tl !== cdTl) { cdTl = tl; cd = chartData(st!.g, tl); paintLegend(); }
    else if (!tl) { cdTl = null; cd = null; paintLegend(); }
    paintLine(); paintBar(); drawChart();
  };

  /* ---------- playback: rAF only while playing ---------- */
  const tick = (now: number) => {
    raf = 0;
    if (!playing) return;
    const tl = lv.timeline();
    if (!tl) { pause(); return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt * speed;
    const end = (tl.steps - 1) * tl.dt;
    if (t >= end) { t = end; playing = false; setPlayIcon(); }
    lv.setFrame(frameAt(t, tl.steps));
    if (playing) raf = requestAnimationFrame(tick);
  };
  function pause() { if (raf) cancelAnimationFrame(raf); raf = 0; if (playing) { playing = false; setPlayIcon(); } }
  const start = () => {
    const tl = lv.timeline();
    if (!tl) return;
    const end = (tl.steps - 1) * tl.dt;
    if (lv.frame() === null || t >= end) t = 0; else t = (lv.frame() ?? 0) * tl.dt;
    playing = true; setPlayIcon();
    last = performance.now();
    lv.setFrame(frameAt(t, tl.steps));
    raf = requestAnimationFrame(tick);
  };
  pbtn.addEventListener("click", () => { if (playing) pause(); else start(); });
  cbtn.addEventListener("click", () => { chartOn = !chartOn; setAttr(cbtn, "aria-pressed", String(chartOn)); setAttr(cbtn, "aria-label", chartOn ? "Hide the utilisation chart" : "Show the utilisation chart"); chart.hidden = !chartOn; if (chartOn) drawChart(); });
  spd.addEventListener("click", () => { speed = speed === 1 ? 2 : 1; spd.textContent = speed === 1 ? "1\u00d7" : "2\u00d7"; spd.setAttribute("aria-label", `Playback speed ${speed}x`); });
  range.addEventListener("input", () => {
    const tl = lv.timeline();
    if (!tl) return;
    t = Number(range.value) * tl.dt;
    lv.setFrame(frameAt(t, tl.steps));
  });
  xbtn.addEventListener("click", () => {
    const st = lv.steady();
    if (!st) return;
    const ids = spikes.map((x) => st.g.ids[x.v]!);
    pause();
    editor.setLoad(ids, { spike: undefined });
  });

  // frame / model changes arrive through the view's subscription (the overlay already repaints itself)
  let lastFrame: number | null | undefined, lastSteady: unknown;
  d.add(lv.subscribe(() => {
    const st = lv.steady(), f = lv.frame();
    if (st !== lastSteady) { lastSteady = st; lastFrame = f; refreshData(); return; }
    if (f !== lastFrame) { lastFrame = f; paintBar(); paintLine(); drawChart(); }
  }));
  d.add(onThemeChange(() => { paintLegend(); drawChart(); }));
  const ro = new ResizeObserver(() => drawChart());
  ro.observe(canvas);
  d.add(() => ro.disconnect());
  refreshData();

  return {
    dispose() {
      pause(); d.dispose(); bar.remove(); chart.remove();
      if (lv.frame() !== null) lv.setFrame(null);
      cd = null; cdTl = null;
    },
  };
}
