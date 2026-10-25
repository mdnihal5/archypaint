/** 24-unit line glyphs for the chrome (same 1.6–1.75 stroke language as the icon library). Static strings only. */
export const G = {
  select: `<path d="M5 3l13 7.2-5.6 1.6L10.4 18z"/>`,
  hand: `<path d="M8 12V6.5a1.3 1.3 0 0 1 2.6 0V11M10.6 11V4.8a1.3 1.3 0 0 1 2.6 0V11M13.2 11V5.8a1.3 1.3 0 0 1 2.6 0V13M15.8 9.5a1.3 1.3 0 0 1 2.6 0V14c0 3.6-2.2 6-5.6 6-2.4 0-3.7-1-5-3.2L5 13.2a1.3 1.3 0 0 1 2.2-1.3L8 13"/>`,
  rect: `<rect x="4" y="5" width="16" height="14" rx="1.4"/>`,
  diamond: `<path d="M12 3l9 9-9 9-9-9z"/>`,
  ellipse: `<ellipse cx="12" cy="12" rx="9" ry="7"/>`,
  arrow: `<path d="M4 12h15M14 7l5 5-5 5"/>`,
  line: `<path d="M5 12h14"/>`,
  text: `<path d="M5 20l7-16 7 16M8 14h8"/>`,
  icons: `<rect x="4" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4"/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
  cylinder: `<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>`,
  cloud: `<path d="M7 18.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9a4.75 4.75 0 0 1 .5 9.5z"/>`,
  hexagon: `<path d="M7 4h10l4.5 8L17 20H7l-4.5-8z"/>`,
  parallelogram: `<path d="M8 5h13l-5 14H3z"/>`,
  triangle: `<path d="M12 4l9 16H3z"/>`,
  star: `<path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6L3.4 9.8l6-.7z"/>`,
  note: `<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>`,
  brace: `<path d="M15 4c-2.2 0-3 1-3 3v2c0 1.5-1 2.5-2.5 3 1.5.5 2.5 1.5 2.5 3v2c0 2 .8 3 3 3"/>`,
  badge: `<circle cx="12" cy="12" r="8.5"/><path d="M10 9.5l2-1.5v8"/>`,
  frame: `<rect x="3.5" y="5" width="17" height="14" rx="2" stroke-dasharray="3 2.5"/><path d="M3.5 9h7"/>`,
  lane: `<rect x="3.5" y="4" width="17" height="16" rx="1"/><path d="M8 4v16M8 9.3h12.5M8 14.7h12.5"/>`,
  shapes: `<path d="M12 3.5l4 6.5H8z"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4"/><circle cx="17" cy="16.8" r="3.8"/>`,
  legend: `<rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M7 9h2M11.5 9H17M7 12.5h2M11.5 12.5H17M7 16h2M11.5 16H17"/>`,
  renumber: `<path d="M5 7h8M5 12h8M5 17h8"/><path d="M17 9l2-1.5V17"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>`,
  undo: `<path d="M8 6L3.5 10.5 8 15M4 10.5h9.5a5 5 0 0 1 0 10H10"/>`,
  redo: `<path d="M16 6l4.5 4.5L16 15M20 10.5h-9.5a5 5 0 0 0 0 10H14"/>`,
  fit: `<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  minus: `<path d="M5 12h14"/>`,
  layers: `<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>`,
  sliders: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 5v4M9 15v4"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  chevron: `<path d="M9 6l6 6-6 6"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>`,
  moon: `<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>`,
  flow: `<path d="M3 17c3.5 0 4-10 9-10s5.5 10 9 10" stroke-dasharray="0.1 4.2" stroke-width="2.6"/>`,
} as const;

export type GlyphName = keyof typeof G;

/** an svg icon from inner markup (24-unit grid, 1.7 stroke, round caps): the lazy chunks use it for the glyphs the first paint does not need */
export function svgIcon(inner: string, size = 20): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.7");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.innerHTML = inner;
  return s;
}

export function glyph(name: GlyphName, size = 20): SVGSVGElement { return svgIcon(G[name], size); }
