import { CALC_TEMPLATES } from "./calc-templates";
import { SAMPLE } from "./calc-view";

/**
 * The starter picker shown when a capacity note is inserted. Lazy chunk (with the templates). One small dialog: a list of starters, keys
 * 1-7 / arrows / Enter / Esc, click to choose. It owns the keyboard while open (capture phase, so the canvas shortcuts never see a key) and
 * removes every listener and node when it closes. Resolves to the note text, or null when dismissed.
 */
const CSS = `
.ap-cpick{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(0,0,0,.28);font-family:'JetBrains Mono','DejaVu Sans Mono',monospace;color:var(--ink,#1b1b1f)}
.ap-cpick-box{width:min(460px,calc(100vw - 32px));background:var(--card,#fff);border:1px solid color-mix(in srgb,var(--ink,#1b1b1f) 30%,transparent);border-radius:16px;padding:16px 8px 8px;box-shadow:0 18px 48px -12px rgba(0,0,0,.35)}
.ap-cpick h2{margin:0 12px 2px;font-size:15px}
.ap-cpick p{margin:0 12px 10px;font-size:11px;color:var(--mid,#5c5c66)}
.ap-cpick button{all:unset;box-sizing:border-box;display:flex;align-items:baseline;gap:10px;width:100%;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px}
.ap-cpick button[aria-selected=true]{background:color-mix(in srgb,var(--red,#c2412d) 12%,transparent)}
.ap-cpick kbd{font:inherit;font-size:11px;color:var(--red,#c2412d);flex:none;width:12px}
.ap-cpick small{color:var(--mid,#5c5c66);font-size:11px;margin-left:auto;text-align:right}
`;

export function pickCalcTemplate(): Promise<string | null> {
  return new Promise((resolve) => {
    const items = [{ title: "Quick sample", blurb: "a few lines to start from", text: SAMPLE }, ...CALC_TEMPLATES];
    const style = document.createElement("style"); style.textContent = CSS;
    const root = document.createElement("div"); root.className = "ap-cpick"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Capacity note starters");
    const box = document.createElement("div"); box.className = "ap-cpick-box";
    const h = document.createElement("h2"); h.textContent = "New capacity note";
    const note = document.createElement("p"); note.textContent = "Every starter is guesses to edit, not facts. Pick the closest one.";
    box.append(h, note);
    const prev = document.activeElement;
    let sel = 0, done = false;
    const btns = items.map((it, i) => {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "option");
      const k = document.createElement("kbd"); k.textContent = String(i + 1);
      const t = document.createElement("span"); t.textContent = it.title;
      const s = document.createElement("small"); s.textContent = it.blurb;
      b.append(k, t, s);
      b.addEventListener("click", () => finish(it.text));
      b.addEventListener("pointermove", () => { if (sel !== i) { sel = i; paint(); } });
      box.append(b);
      return b;
    });
    const paint = () => btns.forEach((b, i) => b.setAttribute("aria-selected", String(i === sel)));
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey, true);
      root.remove(); style.remove();
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); finish(null); }
      else if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % items.length; paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; paint(); }
      else if (e.key === "Enter") { e.preventDefault(); finish(items[sel]!.text); }
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= items.length) { e.preventDefault(); finish(items[Number(e.key) - 1]!.text); }
      else if (e.key === "Tab") e.preventDefault();
    };
    root.addEventListener("pointerdown", (e) => { if (e.target === root) finish(null); });
    root.append(box);
    document.head.append(style); document.body.append(root);
    window.addEventListener("keydown", onKey, true);
    paint(); btns[0]!.focus();
  });
}
