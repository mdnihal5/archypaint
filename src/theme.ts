export interface Theme {
  paper: string; grid: string; gridMajor: string; ink: string; mid: string; red: string; card: string;
  cats: readonly string[]; tint: number;
}

// category order is part of the file format: data, cache, network, compute, queue, security, client, external
export const CATEGORIES = ["data", "cache", "network", "compute", "queue", "security", "client", "external"] as const;

/** colours 8..23 extend the eight categories; the file format stores the index (0..255), old readers wrap it with % length.
 *  Light theme: soft, light tones (they are drawn as strokes and fills, so they stay visible but never dark). */
const MORE_LIGHT = ["#ff8a80", "#ffab6e", "#dcae3b", "#9ad14b", "#4fd1a5", "#3fd0d4", "#5bb6f5", "#8f9bff", "#b69bff", "#e08cf0", "#ff8fb8", "#e99aa5", "#d4a98a", "#a9b4c2", "#b4b9c2", "#9fb6cf"];
const MORE_DARK = ["#ff7a6e", "#ffa75e", "#f0cf6a", "#a3d94a", "#5be0b2", "#4fdde0", "#6cc4ff", "#9aa6ff", "#c1a6ff", "#ec9bf7", "#ff9cc2", "#f2a3ad", "#dcb293", "#b3becc", "#d0d4db", "#a9c1da"];
export const COLOUR_NAMES = [...["data", "cache", "network", "compute", "queue", "security", "client", "external"],
  "coral", "peach", "sand", "lime", "mint", "aqua", "sky", "periwinkle", "lilac", "orchid", "pink", "rosewood", "clay", "fog", "silver", "pearl"] as const;

/** "#fff" / "fff" / "#FFAA00" -> "#ffaa00"; anything else -> "" (the only way a user colour enters the scene, so it can never carry markup into an export) */
export function normHex(v: unknown): string {
  if (typeof v !== "string") return "";
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return "";
  const h = m[1]!.toLowerCase();
  return "#" + (h.length === 3 ? h.split("").map((c) => c + c).join("") : h);
}

/** the colour an element is drawn in: its own custom hex when set, else its category/colour slot */
export function colourOf(th: Theme, e: { cat: number; hex?: string | undefined }): string {
  return e.hex ? e.hex : th.cats[e.cat % th.cats.length]!;
}

/** text/glyph colour that stays readable on a solid fill of `col`: ink on light fills, paper on dark ones */
const onCache = new Map<string, boolean>();
export function onSolid(th: Theme, col: string): string {
  let light = onCache.get(col);
  if (light === undefined) {
    const h = col.replace("#", ""), lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
    light = L > 0.3; onCache.set(col, light);
  }
  return light ? th.ink : th.paper;
}

export const LIGHT: Theme = {
  paper: "#ffffff", grid: "#fdfdfe", gridMajor: "#f7f7fa", ink: "#141418", mid: "#565660", red: "#5b57d1", card: "#ffffff",
  cats: ["#5aa9e6", "#f0913a", "#4cc38a", "#a48af0", "#34c6cf", "#e879b0", "#a9b3be", "#d4bb6a", ...MORE_LIGHT], tint: 0.13,
};
export const DARK: Theme = {
  paper: "#18181b", grid: "#1e1e22", gridMajor: "#242428", ink: "#e4e4e7", mid: "#a1a1aa", red: "#ff6f5e", card: "#202024",
  cats: ["#5aa9e6", "#f0913a", "#4cc38a", "#a48af0", "#34c6cf", "#e879b0", "#a9b3be", "#d4bb6a", ...MORE_DARK], tint: 0.16,
};

export type ThemeMode = "light" | "dark" | "system";
export type BgMode = "grid" | "plain";

/**
 * The ONE live theme object. The renderer holds a reference to it, so applyTheme() mutates it in place and a
 * single renderer.invalidate() repaints in the new theme — no editor changes needed.
 */
export const theme: Theme = { ...LIGHT, cats: [...LIGHT.cats] };

const listeners = new Set<() => void>();
/** subscribe to live theme/background changes; returns unsubscribe */
export function onThemeChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function systemDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

const CLEAR = "rgba(0,0,0,0)";

/**
 * Resolve `mode`, mutate the shared theme, set data-theme / data-bg on <html>. In "plain" background the canvas
 * grid colours are made transparent (the renderer draws grid lines with theme.grid / theme.gridMajor), which hides
 * the grid without touching renderer code. Returns the resolved light/dark.
 */
export function applyTheme(mode: ThemeMode, bg: BgMode, notify = true): "light" | "dark" {
  const dark = mode === "system" ? systemDark() : mode === "dark";
  const src = dark ? DARK : LIGHT;
  Object.assign(theme, src, { cats: [...src.cats] });
  if (bg === "plain") { theme.grid = CLEAR; theme.gridMajor = CLEAR; }
  if (typeof document !== "undefined") {
    const r = document.documentElement;
    r.dataset.theme = dark ? "dark" : "light";
    r.dataset.bg = bg;
  }
  if (notify) listeners.forEach((f) => f());
  return dark ? "dark" : "light";
}

/** legacy entry point: apply from ?theme= / system and return the shared theme */
export function pickTheme(): Theme {
  const q = new URLSearchParams(location.search).get("theme");
  applyTheme(q === "dark" || q === "light" ? q : "system", "grid", false);
  return theme;
}
