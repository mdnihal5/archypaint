/**
 * Brand logos: how they are told apart from the drawn icons, and how their colours follow the theme.
 *
 * The artwork itself is bundled, one lazy chunk per category (src/packs/logos-*.json, built by icons/scripts/build-logos.mjs from
 * Simple Icons, gilbarbara/logos and the Google Cloud icon set). Nothing is fetched at runtime. A logo is an ordinary glyph-only icon whose
 * paths carry their own brand colour:
 *     <path d="…" fill="#4169e1" data-d="#8fa8f5" data-l="#…" stroke="none"/>
 * `data-d` / `data-l` are the colour to use instead on the dark / light theme where the brand colour would vanish on that theme's
 * paper (a near-black mark on the dark theme, a pale one on the light theme). They are decided at build time, from contrast.
 */

export const LOGO_PREFIX = "logo-";
export const isLogoId = (id: string): boolean => id.startsWith(LOGO_PREFIX);

/** true for the dark theme (theme.ts paper colours: dark "#18181b", light "#ffffff") */
export const isDarkPaper = (paper: string): boolean => paper.length >= 2 && paper.charCodeAt(1) < 56; // first hex digit 0-7

/**
 * Ids that were renamed or dropped: an old document that names one still renders (icon-pack resolves aliases on lookup, the
 * document keeps its old id). `logo-linuxfoundation` was an opt-in logo that is no longer offered; Linux is its closest successor.
 */
export const ICON_ALIASES: Readonly<Record<string, string>> = { "logo-linuxfoundation": "logo-linux" };

/**
 * The logo's markup for one rendering context, as plain SVG (no data-* attributes):
 *   dark  - which theme's alternative colours to apply
 *   mono  - draw every mark in `currentColor` instead (a solid-filled tile: the logo must read on the tile colour, not on paper)
 */
export function themedLogoMarkup(markup: string, dark: boolean, mono = false): string {
  return markup.replace(/ fill="(#[0-9a-f]{6})"((?: fill-opacity="[^"]*")?)((?: data-d="#[0-9a-f]{6}")?)((?: data-l="#[0-9a-f]{6}")?)/g, (_s, c: string, fo: string, d: string, l: string) => {
    if (mono) return ` fill="currentColor"${fo}`;
    const alt = /#[0-9a-f]{6}/.exec(dark ? d : l)?.[0];
    return ` fill="${alt ?? c}"${fo}`;
  });
}
