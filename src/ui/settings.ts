import { applyTheme, type BgMode, type ThemeMode } from "../theme";

export interface Settings {
  bg: BgMode;
  theme: ThemeMode;
  /** show the sheet frame (border, zone references, title block) */
  frame: boolean;
  /** status footer (shapes / visible / frame ms) */
  hud: boolean;
  /** layers panel */
  layers: boolean;
  /** overview map (bottom-right) */
  minimap: boolean;
  /** title-block fields (per-browser, not per-document: the scene format has no metadata slot) */
  scale: string;
  rev: string;
}

export const DEFAULTS: Settings = { bg: "grid", theme: "system", frame: true, hud: true, layers: true, minimap: true, scale: "1:1", rev: "0" };
const KEY = "archypaint.settings.v1";

const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v.slice(0, 24) : d);

/** validate untrusted JSON (localStorage) into a full Settings — never throws, never trusts shape */
export function parseSettings(raw: string | null): Settings {
  let j: Record<string, unknown> = {};
  try { const p = raw ? JSON.parse(raw) : null; if (p && typeof p === "object") j = p as Record<string, unknown>; } catch { /* corrupt -> defaults */ }
  return {
    bg: oneOf(j.bg, ["grid", "plain"], DEFAULTS.bg),
    theme: oneOf(j.theme, ["light", "dark", "system"], DEFAULTS.theme),
    frame: bool(j.frame, DEFAULTS.frame),
    hud: bool(j.hud, DEFAULTS.hud),
    layers: bool(j.layers, DEFAULTS.layers),
    minimap: bool(j.minimap, DEFAULTS.minimap),
    scale: str(j.scale, DEFAULTS.scale),
    rev: str(j.rev, DEFAULTS.rev),
  };
}

function readStore(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
function writeStore(s: Settings): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode / quota: setting still applies for this session */ } }

export interface SettingsStore {
  get(): Readonly<Settings>;
  set(patch: Partial<Settings>): void;
  subscribe(cb: (s: Readonly<Settings>, changed: ReadonlyArray<keyof Settings>) => void): () => void;
  dispose(): void;
}

/**
 * Settings are the only writable UI state that outlives a session. set() is equality-guarded (no-op patches do
 * nothing), persists in try/catch, applies theme/background/frame attributes, then notifies. A set() issued from
 * inside a subscriber is rejected: settings changes must originate from user actions, never from a subscriber.
 */
export function createSettings(): SettingsStore {
  let cur = parseSettings(readStore());
  // URL overrides are session-only (used by scripts/tests): they never overwrite the stored preference
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  const ut = q?.get("theme"), ub = q?.get("bg");
  if (ut === "light" || ut === "dark") cur = { ...cur, theme: ut };
  if (ub === "grid" || ub === "plain") cur = { ...cur, bg: ub };

  const subs = new Set<(s: Readonly<Settings>, c: ReadonlyArray<keyof Settings>) => void>();
  let notifying = false;

  const applyDom = (s: Settings, notifyTheme: boolean) => {
    applyTheme(s.theme, s.bg, notifyTheme);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.frame = s.frame ? "on" : "off";
      document.documentElement.dataset.hud = s.hud ? "on" : "off";
    }
  };
  applyDom(cur, false);

  const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const onSys = () => { if (cur.theme === "system") { applyDom(cur, true); subs.forEach((f) => f(cur, ["theme"])); } };
  mq?.addEventListener("change", onSys);

  return {
    get: () => cur,
    set(patch) {
      if (notifying) { console.warn("[archypaint/ui] settings.set() called from a subscriber; ignored"); return; }
      const changed = (Object.keys(patch) as Array<keyof Settings>).filter((k) => patch[k] !== undefined && patch[k] !== cur[k]);
      if (!changed.length) return;
      cur = { ...cur, ...patch };
      writeStore(cur);
      applyDom(cur, changed.includes("theme") || changed.includes("bg"));
      notifying = true;
      try { subs.forEach((f) => f(cur, changed)); } finally { notifying = false; }
    },
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    dispose() { mq?.removeEventListener("change", onSys); subs.clear(); },
  };
}
