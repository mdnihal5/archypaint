export interface Theme {
  paper: string; grid: string; gridMajor: string; ink: string; mid: string; red: string; card: string;
  cats: readonly string[]; tint: number;
}

// category order is part of the file format: data, cache, network, compute, queue, security, client, external
export const CATEGORIES = ["data", "cache", "network", "compute", "queue", "security", "client", "external"] as const;

/** colours 8..23 extend the eight categories; file format stores the index (0..255), old readers wrap it with % length */
const MORE_LIGHT = ["#c0364f", "#b3261e", "#c2570c", "#9a6b00", "#4d7c0f", "#047857", "#0369a1", "#1d4ed8", "#4338ca", "#7e22ce", "#a21caf", "#be185d", "#7c4a2d", "#475569", "#27272a", "#1e3a5f"];
const MORE_DARK = ["#ff7a90", "#ff6b60", "#ffa04d", "#f5c04a", "#a3d94a", "#34d399", "#7dd3fc", "#78a6ff", "#9aa0ff", "#c39bff", "#f08be6", "#ff8fc0", "#d19a76", "#94a3b8", "#d4d4d8", "#8fb5e6"];
export const COLOUR_NAMES = [...["data", "cache", "network", "compute", "queue", "security", "client", "external"],
  "rose", "brick", "orange", "amber", "lime", "emerald", "sky", "blue", "indigo", "violet", "fuchsia", "pink", "brown", "slate", "charcoal", "navy"] as const;

export const LIGHT: Theme = {
  paper: "#ffffff", grid: "#f0f0f3", gridMajor: "#e4e4ea", ink: "#1b1b1f", mid: "#5c5c66", red: "#c2412d", card: "#ffffff",
  cats: ["#2b6f9e", "#a25a17", "#2d7b4d", "#6a4fa3", "#0e777e", "#9b3d6b", "#4d5a64", "#7a6a3a", ...MORE_LIGHT], tint: 0.13,
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
