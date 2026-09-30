export interface Theme {
  paper: string; grid: string; gridMajor: string; ink: string; mid: string; red: string; card: string;
  cats: readonly string[]; tint: number;
}

// category order is part of the file format: data, cache, network, compute, queue, security, client, external
export const CATEGORIES = ["data", "cache", "network", "compute", "queue", "security", "client", "external"] as const;

export const LIGHT: Theme = {
  paper: "#f5f1e6", grid: "#dcd5c1", gridMajor: "#cbc3ab", ink: "#26323b", mid: "#5f6a73", red: "#c2412d", card: "#fbf9f2",
  cats: ["#2b6f9e", "#a25a17", "#2d7b4d", "#6a4fa3", "#0e777e", "#9b3d6b", "#4d5a64", "#7a6a3a"], tint: 0.13,
};
export const DARK: Theme = {
  paper: "#16171b", grid: "#22242a", gridMajor: "#2c2f37", ink: "#e7e9ee", mid: "#9aa1ac", red: "#ff6f5e", card: "#1d1f26",
  cats: ["#5aa9e6", "#f0913a", "#4cc38a", "#a48af0", "#34c6cf", "#e879b0", "#a9b3be", "#d4bb6a"], tint: 0.16,
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
