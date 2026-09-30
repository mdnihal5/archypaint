/** 24-unit line glyphs for the chrome (same 1.6–1.75 stroke language as the icon library). Static strings only. */
const G = {
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
  alignLeft: `<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>`,
  alignCenter: `<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="7.5" y="14" width="9" height="4" rx="1"/>`,
  alignRight: `<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>`,
  alignTop: `<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>`,
  alignMiddle: `<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="7.5" width="4" height="9" rx="1"/>`,
  alignBottom: `<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>`,
  distH: `<path d="M4 4v16M20 4v16"/><rect x="9.5" y="7" width="5" height="10" rx="1"/>`,
  distV: `<path d="M4 4h16M4 20h16"/><rect x="7" y="9.5" width="10" height="5" rx="1"/>`,
  matchW: `<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/><path d="M4 12h16M4 11v2M20 11v2"/>`,
  matchH: `<rect x="4" y="4" width="6" height="16" rx="1"/><rect x="14" y="4" width="6" height="16" rx="1"/><path d="M12 4v16M11 4h2M11 20h2"/>`,
  matchBoth: `<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><path d="M14 4h6v6M10 20H4v-6"/>`,
  lock: `<rect x="5" y="11" width="14" height="9" rx="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
  unlock: `<rect x="5" y="11" width="14" height="9" rx="1.6"/><path d="M8 11V8a4 4 0 0 1 7.5-1.5"/>`,
  map: `<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><rect x="11" y="10" width="6" height="5" rx="0.8"/>`,
  copyStyle: `<rect x="8" y="8" width="12" height="12" rx="1.6"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>`,
  pasteStyle: `<rect x="5" y="5" width="14" height="16" rx="1.6"/><path d="M9 5V3.5h6V5M9 11h6M9 15h4"/>`,
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
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
} as const;

export type GlyphName = keyof typeof G;

export function glyph(name: GlyphName, size = 20): SVGSVGElement {
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
  s.innerHTML = G[name];
  return s;
}
