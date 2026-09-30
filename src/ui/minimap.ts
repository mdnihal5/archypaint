import { fitMini, toMiniX, toMiniY, toWorldX, toWorldY, type MiniMap } from "../minimap-model";
import type { Theme } from "../theme";
import type { Ctx } from "./ctx";
import { h, setHidden } from "./dom";

const W = 200, H = 136;
const REBUILD_MS = 120;

/**
 * Overview map, bottom-right. It draws only when the scene or viewport changed (rAF-coalesced updater, no timers while idle),
 * rebuilds its per-category rect cache at most every 120 ms while a drag is changing the scene, and never allocates per draw.
 */
export function mountMinimap(ctx: Ctx, root: HTMLElement): void {
  const { editor, settings } = ctx;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h("canvas", { attrs: { width: Math.round(W * dpr), height: Math.round(H * dpr), "aria-hidden": "true" } });
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const card = h("div", { class: "ap-mini ap-hit", attrs: { role: "img", "aria-label": "Overview map: click or drag to move the view" } }, canvas);
  root.append(card);
  const g = canvas.getContext("2d");
  const theme = (editor as unknown as { theme?: Theme }).theme;

  // cache: flat [x, y, w, h] per category, plus scene bounds, rebuilt only when Scene.nonce moved
  let built = -1, lastBuild = -1e9, timer: ReturnType<typeof setTimeout> | 0 = 0;
  let cats: number[][] = [];
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  const rebuild = () => {
    const n = theme ? theme.cats.length : 8;
    cats = Array.from({ length: n }, () => []);
    bx0 = by0 = Infinity; bx1 = by1 = -Infinity;
    for (const e of editor.scene.els.values()) {
      if (e.kind === "arrow" && e.w < 1 && e.h < 1) continue;
      cats[e.cat % n]!.push(e.x, e.y, e.w, e.h);
      if (e.x < bx0) bx0 = e.x; if (e.y < by0) by0 = e.y;
      if (e.x + e.w > bx1) bx1 = e.x + e.w; if (e.y + e.h > by1) by1 = e.y + e.h;
    }
    built = editor.scene.nonce; lastBuild = performance.now();
  };

  // Element layer, cached: while the mapping, the rect cache and the theme are unchanged (a pan inside the scene), a frame
  // is one drawImage + the viewport box instead of one fillRect per element — the minimap was the costliest thing drawn
  // on every pan frame at 5,000 shapes. A redraw batches each category into one path (8 fills, not n fillRects).
  const layer = document.createElement("canvas");
  layer.width = canvas.width; layer.height = canvas.height;
  const lg = layer.getContext("2d");
  let layerKey = "";
  const drawLayer = (m: MiniMap) => {
    if (!lg || !theme) return;
    lg.setTransform(dpr, 0, 0, dpr, 0, 0);
    lg.clearRect(0, 0, W, H);
    lg.globalAlpha = 0.8;
    for (let c = 0; c < cats.length; c++) {
      const a = cats[c]!;
      if (!a.length) continue;
      lg.beginPath();
      for (let i = 0; i < a.length; i += 4) lg.rect(toMiniX(m, a[i]!), toMiniY(m, a[i + 1]!), Math.max(1.5, a[i + 2]! * m.scale), Math.max(1.5, a[i + 3]! * m.scale));
      lg.fillStyle = theme.cats[c]!;
      lg.fill();
    }
    lg.globalAlpha = 1;
  };

  let map: MiniMap = fitMini(null, { x: 0, y: 0, w: 1, h: 1 }, W, H);
  const render = () => {
    if (!g || card.hidden) return;
    if (built !== editor.scene.nonce) {
      const wait = REBUILD_MS - (performance.now() - lastBuild);
      if (wait <= 0) rebuild();
      else if (!timer) timer = setTimeout(() => { timer = 0; u.schedule(); }, wait); // trailing rebuild; a rebuild makes built === nonce, so this cannot repeat
    }
    const vp = editor.vp, view = { x: vp.x, y: vp.y, w: vp.w / vp.zoom, h: vp.h / vp.zoom };
    map = fitMini(bx0 === Infinity ? null : { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, view, W, H);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (theme) {
      // the theme object is mutated in place on a light/dark switch, so its colours are part of the key
      const key = `${built}|${map.scale}|${map.ox}|${map.oy}|${map.wx}|${map.wy}|${theme.cats.join()}`;
      if (key !== layerKey) { drawLayer(map); layerKey = key; }
      g.drawImage(layer, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = theme.red; g.strokeStyle = theme.red; g.lineWidth = 1.5;
      const rx = toMiniX(map, view.x), ry = toMiniY(map, view.y), rw = view.w * map.scale, rh = view.h * map.scale;
      g.globalAlpha = 0.1; g.fillRect(rx, ry, rw, rh); g.globalAlpha = 1; g.strokeRect(rx, ry, rw, rh);
    }
  };
  const u = ctx.update("minimap", render);
  ctx.wire(u, "change", "viewport", "history");
  const applySetting = () => { setHidden(card, !settings.get().minimap); u.schedule(); };
  ctx.d.add(settings.subscribe(applySetting));
  applySetting();

  // navigate: the mapping is frozen for the duration of a drag so the view cannot chase its own tail
  let frozen: MiniMap | null = null, px = 0, py = 0;
  const panNow = () => { if (frozen) editor.panTo(toWorldX(frozen, px), toWorldY(frozen, py)); };
  const nav = ctx.update("minimap-nav", panNow); // drag moves are coalesced to one pan per frame
  const at = (e: PointerEvent) => { const b = canvas.getBoundingClientRect(); px = e.clientX - b.left; py = e.clientY - b.top; };
  // press and release apply immediately, so a quick click can never be dropped by clearing `frozen` before the next frame
  const onDown = (e: PointerEvent) => { try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic / vanished pointer */ } frozen = map; at(e); panNow(); e.preventDefault(); };
  const onMove = (e: PointerEvent) => { if (!frozen) return; at(e); nav.schedule(); };
  const onUp = (e: PointerEvent) => { if (frozen) { at(e); panNow(); } frozen = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ } };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);

  // M toggles the map
  ctx.d.on(window, "keydown", (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "m") return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (ctx.modalOpen()) return;
    settings.set({ minimap: !settings.get().minimap }); ctx.refresh();
  });

  ctx.d.add(() => {
    if (timer) clearTimeout(timer);
    canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
    cats = []; frozen = null; layerKey = ""; layer.width = layer.height = 0; card.remove();
  });
}
