import type { Ctx } from "./ctx";
import { h } from "./dom";

/**
 * The mark: a tiny system diagram — two boxes joined by an elbow connector, the
 * request-path (accent) box at the end. It is the product in miniature, drawn with the same line weight as the
 * canvas, and it takes its colours from the page tokens so it follows light/dark.
 */
export const MARK = `<svg class="mk" viewBox="0 0 32 32" width="24" height="24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
<rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="var(--ink)" stroke-width="1.6"/>
<rect x="6" y="17" width="8.5" height="8.5" rx="1.8" stroke="var(--ink)" stroke-width="1.7"/>
<path d="M14.5 21.25H16.5V10.75H17.5" stroke="var(--ink)" stroke-width="1.7"/>
<rect x="17.5" y="6.5" width="8.5" height="8.5" rx="1.8" stroke="var(--red-ink)" stroke-width="1.7" fill="var(--red-ink)" fill-opacity=".2"/>
</svg>`;

/** The mark and name on their own, top-right: shown only in the read-only share view, where the rest of the chrome is hidden. */
export function mountBrand(ctx: Ctx, root: HTMLElement): void {
  const el = h("div", { class: "ap-brand", attrs: { role: "img", "aria-label": "archypaint" } });
  el.innerHTML = MARK;
  el.append(h("span", { text: "archypaint", attrs: { "aria-hidden": "true" }, style: { font: "600 13px/1 var(--sans)" } }));
  root.append(el);
  ctx.d.add(() => el.remove());
}
