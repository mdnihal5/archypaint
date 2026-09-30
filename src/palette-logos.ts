/**
 * The palette's "official logos" source (lazy chunk: loaded only when the Logos chip is used or the user already opted in,
 * so none of this — catalog, consent UI, fetch layer — costs anything in the entry bundle).
 *
 * Listing and previews never touch the network: entries come from the static catalog, and a logo's preview is a letter tile
 * until it has been placed once. A download starts only when the user places a logo.
 */
import type { EditorAPI } from "./editor-api";
import { hasLogoIcon, iconInner, ROOT_ATTRS } from "./icon-pack";
import { makeEntry, type Entry } from "./icon-search";
import { closeLogos, ensureLogo, isOptedIn, lastError, setInUseProbe, setOptedIn, setShowRestricted, showRestricted } from "./logos";
import { LOGOS } from "./logos-catalog";

export interface LogosDeps {
  panel: HTMLElement;
  /** the consent box and the restricted line are inserted before this element */
  before: HTMLElement;
  editor: EditorAPI;
  say(text: string, err?: boolean): void;
  /** opt-in or the restricted toggle changed what is listed: rebuild the index and repaint */
  changed(): void;
  focus(): void;
  /** world point of the pointer, if it is over the canvas */
  pointer(): { x: number; y: number } | undefined;
  /** the logo is ready: the palette closes and places the icon (colour, selection, recents) */
  placed(e: Entry, at: { x: number; y: number } | undefined): void;
}

export interface LogosUI {
  rev(): number;
  entries(): readonly Entry[];
  /** show or hide the consent / restricted panels for the Logos source; true while the consent panel replaces the list */
  view(active: boolean): boolean;
  note: string;
  badge(e: Entry): string;
  place(e: Entry): void;
  dispose(): void;
}

export const LOGO_NOTE = "Logos are downloaded from cdn.jsdelivr.net when you place them and cached in this browser. Trademarks belong to their owners.";
const RESTRICTED_HIDDEN = "Docker, MongoDB, Linux, Apple and Linux Foundation marks have stricter trademark policies, so they are hidden unless you ask.";
const RESTRICTED_SHOWN = "Showing brands with stricter trademark policies (Docker, MongoDB, Linux, Apple).";

const CSS = `.ap-pal-logos{padding:14px 18px;font-size:13px;line-height:1.5;border-top:1px solid color-mix(in srgb,var(--ink,#26323b) 25%,transparent)}
.ap-pal-logos p{margin:0 0 10px;max-width:56ch}
.ap-pal-logos button{font:inherit;font-size:12px;padding:6px 12px;border:1.5px solid var(--red,#c2412d);background:transparent;color:var(--red,#c2412d);cursor:pointer;border-radius:4px}
.ap-pal-restricted{padding:6px 18px;font-size:11px;color:var(--mid,#5f6a73);border-top:1px solid color-mix(in srgb,var(--ink,#26323b) 25%,transparent)}
.ap-pal-restricted button{all:unset;cursor:pointer;color:var(--red,#c2412d);border-bottom:1px solid currentColor;margin-left:6px}
.ap-pal-logos[hidden],.ap-pal-restricted[hidden]{display:none}`;

const words = (s: string): string[] => s.split(/[\s\-_/]+/).filter(Boolean);

export function createLogosUI(d: LogosDeps): LogosUI {
  let optedIn = isOptedIn(), withRestricted = showRestricted();
  let rev = 0, cachedRev = -1, cached: Entry[] = [];
  let placing = false, retryForce = false, disposed = false;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.className = "ap-pal-logos"; box.hidden = true;
  const para = document.createElement("p"); para.textContent = LOGO_NOTE;
  const enable = document.createElement("button"); enable.type = "button"; enable.textContent = "Enable official logos";
  box.append(para, enable);

  const restricted = document.createElement("div");
  restricted.className = "ap-pal-restricted"; restricted.hidden = true;
  const rText = document.createElement("span");
  const rBtn = document.createElement("button"); rBtn.type = "button";
  restricted.append(rText, rBtn);
  d.panel.insertBefore(box, d.before); d.panel.insertBefore(restricted, d.before);

  const paintRestricted = (): void => { rText.textContent = withRestricted ? RESTRICTED_SHOWN : RESTRICTED_HIDDEN; rBtn.textContent = withRestricted ? "hide them" : "show them"; };

  const onEnable = (): void => { optedIn = true; setOptedIn(true); rev++; d.say(""); d.changed(); d.focus(); };
  const onToggle = (): void => { withRestricted = !withRestricted; setShowRestricted(withRestricted); rev++; d.changed(); d.focus(); };
  enable.addEventListener("click", onEnable);
  rBtn.addEventListener("click", onToggle);

  const onCanvas = (): ReadonlySet<string> => {
    const s = new Set<string>();
    for (const el of d.editor.scene.els.values()) if (el.kind === "icon" && el.iconId.startsWith("logo-")) s.add(el.iconId);
    return s;
  };

  return {
    rev: () => rev,
    note: LOGO_NOTE,
    entries() {
      if (!optedIn) return [];
      if (cachedRev !== rev) {
        cached = [];
        for (const l of LOGOS) {
          if (l.restricted && !withRestricted) continue;
          const e = makeEntry("logo", `logo-${l.slug}`, l.name, l.category, l.aliases, undefined, "logos", "logo");
          e.lid = l.slug; e.words = words(`${l.slug} ${l.name.toLowerCase()}`);
          cached.push(e);
        }
        cachedRev = rev;
      }
      return cached;
    },
    view(active) {
      box.hidden = !(active && !optedIn);
      restricted.hidden = !(active && optedIn);
      if (!restricted.hidden) paintRestricted();
      return active && !optedIn;
    },
    badge(e) {
      // a logo already in the icon layer shows itself; otherwise a letter tile. Asked without side effects: iconInner() on an
      // uninstalled logo would start a restore or a download.
      const g = hasLogoIcon(e.id) ? iconInner(e.id, "glyph") : null;
      if (g) return `<svg viewBox="0 0 24 24" ${ROOT_ATTRS} stroke-width="1.75">${g}</svg>`;
      const c = e.name.charAt(0);
      return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="700" font-family="inherit">${/^[A-Za-z0-9]$/.test(c) ? c : "•"}</text></svg>`;
    },
    place(e) {
      if (placing || disposed) return;
      placing = true;
      const at = d.pointer();
      d.say(`Downloading ${e.name}…`);
      setInUseProbe(onCanvas);
      void ensureLogo(e.id.slice(5), { force: retryForce }).then((r) => {
        if (disposed) return;
        if (r === "ok") { retryForce = false; d.say(""); d.placed(e, at); }
        else if (r === "blocked") d.say("Turn on official logos first (and, for Docker, MongoDB, Linux or Apple, choose “show them”).", true);
        else { retryForce = true; d.say(`Couldn't load the ${e.name} logo (${lastError || "offline?"}). Press Enter to try again.`, true); }
      }).finally(() => { placing = false; });
    },
    dispose() {
      disposed = true;
      enable.removeEventListener("click", onEnable); rBtn.removeEventListener("click", onToggle);
      box.remove(); restricted.remove(); style.remove();
      cached = []; closeLogos(); // release the cache connection and state with the palette
    },
  };
}
