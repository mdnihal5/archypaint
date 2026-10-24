/** Where the properties panel lives for this viewer: a dragged position and an open flag, both kept in localStorage (never throws). */
export interface PropsPlace { x: number; y: number }
/** `open`: the viewer opened the panel (it never opens by itself, default closed) */
export interface PropsPrefs { pos: PropsPlace | null; open: boolean }

const KEY = "archypaint.props.v1";
const MARGIN = 4;

/** keep a w x h box fully inside the viewport (a box larger than the viewport pins to the top-left margin) */
export function clampPos(p: PropsPlace, w: number, h: number, vw: number, vh: number): PropsPlace {
  const mx = Math.max(MARGIN, vw - w - MARGIN), my = Math.max(MARGIN, vh - h - MARGIN);
  return { x: Math.min(mx, Math.max(MARGIN, p.x)), y: Math.min(my, Math.max(MARGIN, p.y)) };
}

/** validate untrusted JSON into prefs; anything wrong falls back to the default dock, closed */
export function parsePrefs(raw: string | null): PropsPrefs {
  let j: Record<string, unknown> = {};
  try { const p = raw ? JSON.parse(raw) : null; if (p && typeof p === "object") j = p as Record<string, unknown>; } catch { /* corrupt -> defaults */ }
  const pos = j.pos as Record<string, unknown> | null | undefined;
  const ok = pos && typeof pos === "object" && typeof pos.x === "number" && typeof pos.y === "number" && Number.isFinite(pos.x) && Number.isFinite(pos.y);
  return { pos: ok ? { x: pos.x as number, y: pos.y as number } : null, open: j.open === true };
}

export function loadPrefs(): PropsPrefs {
  try { return parsePrefs(localStorage.getItem(KEY)); } catch { return { pos: null, open: false }; }
}
export function savePrefs(p: PropsPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode / quota: applies for this session only */ }
}
