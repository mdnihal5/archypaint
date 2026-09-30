import type { Ctx } from "./ctx";
import { h } from "./dom";

/**
 * The mark: a tiny system diagram — two boxes joined by an elbow connector, the
 * request-path (red pencil) box at the end. It is the product in miniature, drawn with the same line weight as the
 * canvas, and it takes its colours from the page tokens so it follows light/dark.
 */
const MARK = `<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
<rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="var(--ink)" stroke-width="1.6"/>
<rect x="6" y="17" width="8.5" height="8.5" rx="1.8" stroke="var(--ink)" stroke-width="1.7"/>
<path d="M14.5 21.25H16.5V10.75H17.5" stroke="var(--ink)" stroke-width="1.7"/>
<rect x="17.5" y="6.5" width="8.5" height="8.5" rx="1.8" stroke="var(--red-ink)" stroke-width="1.7" fill="var(--red-ink)" fill-opacity=".2"/>
</svg>`;

/** Top-right brand: mark + wordmark, on the same line as the menu button. Purely decorative: it takes no pointer events. */
export function mountBrand(_ctx: Ctx, root: HTMLElement): void {
  const el = h("div", { class: "ap-brand", attrs: { role: "img", "aria-label": "archypaint" } });
  el.innerHTML = MARK;
  el.append(h("span", { class: "ap-brand-word", text: "archypaint", attrs: { "aria-hidden": "true" } }));
  root.append(el);
  _ctx.d.add(() => el.remove());
}
