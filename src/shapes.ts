/**
 * Drawable shapes offered by the palette and the tool strip. Owned by the editing workstream: add an entry here
 * when a new tool exists (its `tool` must be a valid Tool in input.ts). The palette reads this list and calls
 * editor.setTool(tool) — it never hard-codes shapes.
 */
export interface ShapeDef { id: string; name: string; aliases: readonly string[]; tool: string }

export const SHAPES: readonly ShapeDef[] = [
  { id: "rect", name: "Rectangle", aliases: ["box", "square", "rounded"], tool: "rect" },
  { id: "ellipse", name: "Ellipse", aliases: ["circle", "oval"], tool: "ellipse" },
  { id: "diamond", name: "Diamond", aliases: ["decision", "rhombus"], tool: "diamond" },
  { id: "text", name: "Text", aliases: ["label", "note", "annotation"], tool: "text" },
  { id: "arrow", name: "Arrow", aliases: ["connector", "link", "edge"], tool: "arrow" },
  { id: "line", name: "Line", aliases: ["plain connector", "no arrowhead"], tool: "line" },
  { id: "cylinder", name: "Database drum", aliases: ["cylinder", "db shape", "storage drum"], tool: "cylinder" },
  { id: "cloud", name: "Cloud", aliases: ["internet", "external network"], tool: "cloud" },
  { id: "hexagon", name: "Hexagon", aliases: ["hex", "service shape"], tool: "hexagon" },
  { id: "parallelogram", name: "Parallelogram", aliases: ["input output", "io shape"], tool: "parallelogram" },
  { id: "triangle", name: "Triangle", aliases: ["warning shape"], tool: "triangle" },
  { id: "star", name: "Star", aliases: ["favourite", "highlight"], tool: "star" },
  { id: "note", name: "Sticky note", aliases: ["post-it", "comment", "annotation"], tool: "note" },
  { id: "brace", name: "Curly brace", aliases: ["bracket", "range", "bracing"], tool: "brace" },
  { id: "badge", name: "Step badge", aliases: ["number", "step", "marker", "flow number"], tool: "badge" },
  { id: "frame", name: "Frame / region", aliases: ["container", "vpc", "boundary", "zone", "availability zone"], tool: "frame" },
  { id: "lane", name: "Swimlane", aliases: ["pool", "lanes", "swim lane"], tool: "lane" },
  { id: "legend", name: "Legend", aliases: ["key", "colour key", "insert legend"], tool: "legend" },
  { id: "renumber", name: "Renumber badges", aliases: ["number badges", "fix step numbers"], tool: "renumber" },
];
