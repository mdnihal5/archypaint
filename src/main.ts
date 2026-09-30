import "./ui/ui.css";
import { createEditor } from "./editor";
import { createIO } from "./io";
import { registerPwa } from "./io/pwa";
import { mountPalette } from "./palette";
import { bboxOfPts, computeArrowPts, sceneRectOf } from "./connectors";
import { stress, stressMixed } from "./stress";
import { onThemeChange, theme } from "./theme";
import { mountUI } from "./ui";
import { createSettings } from "./ui/settings";

const stage = document.getElementById("stage")!;

// settings first: it applies the stored/URL theme to the shared `theme` object the renderer will hold
const settings = createSettings();
const editor = createEditor({
  stage, theme,
  staticCanvas: document.getElementById("static") as HTMLCanvasElement,
  liveCanvas: document.getElementById("live") as HTMLCanvasElement,
});
const { scene, renderer } = editor;

// live theme / background switch: the theme object is mutated in place, one repaint picks it up
const offTheme = onThemeChange(() => renderer.invalidate(true, true));

const n = Number(new URLSearchParams(location.search).get("stress") ?? 0);
const mixed = Number(new URLSearchParams(location.search).get("mixed") ?? 0);
if (n > 0) stress(scene, n);
if (mixed > 0) {
  const rectOf = sceneRectOf(scene);
  stressMixed(scene, mixed, (id) => { const a = scene.els.get(id)!; const pts = computeArrowPts(a, rectOf); const b = bboxOfPts(pts); scene.set(a, b.x, b.y, b.w, b.h); scene.patch(a, { pts }); });
}

let lw = 0, lh = 0, ldpr = 0;
const ro = new ResizeObserver(() => {
  const w = stage.clientWidth, h = stage.clientHeight, d = window.devicePixelRatio || 1;
  if (w === lw && h === lh && d === ldpr) return; // equality guard: a resize can never feed itself
  lw = w; lh = h; ldpr = d;
  renderer.resize(w, h, d);
});
ro.observe(stage);

const io = createIO(editor, stage);
const paletteHost = document.createElement("div");
paletteHost.id = "palette-host";
document.body.append(paletteHost);
const palette = mountPalette(editor, paletteHost);
let ui = mountUI({ editor, io, palette, settings, hud: renderer });

// restore the autosaved sheet (skipped for benchmark runs so they stay deterministic)
if (n === 0 && mixed === 0) void io.restore().then((restored) => { if (restored) ui.refresh(); });

// offline support (production only, so the dev server is never cached). An update is applied only when there is no unsaved work: never a surprise reload.
// Never reload on our own: a reload drops undo history, selection and the view mid-session. A waiting worker takes over by
// itself once every archypaint tab has been closed, so the user just needs to know.
let updateToldOnce = false;
const pwa = import.meta.env.PROD ? registerPwa({ onUpdateReady: () => {
  if (updateToldOnce) return;
  updateToldOnce = true;
  ui.toast("A new version of archypaint is ready. It loads the next time you open it.");
} }) : null;

const ap = { scene, vp: editor.vp, renderer, editor, io, palette, ui, settings, mountUI, /** tear down and rebuild the chrome: the leak check calls this in a loop */ remountUI() { ui.dispose(); ui = mountUI({ editor, io, palette, settings, hud: renderer }); ap.ui = ui; } };
(window as unknown as { __ap: unknown }).__ap = ap;

// dev/HMR: release everything the previous module instance attached
if (import.meta.hot) import.meta.hot.dispose(() => { ui.dispose(); palette.dispose(); io.dispose(); pwa?.dispose(); offTheme(); ro.disconnect(); settings.dispose(); paletteHost.remove(); editor.destroy(); });
