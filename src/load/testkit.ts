import { buildGraph, isTooLarge, type ElLike, type Graph } from "./graph";
import type { LoadSpec } from "./types";

/** test helper: nodes by id with a LoadSpec (role given explicitly), arrows as [src, dst, spec?] */
export function mk(nodes: Record<string, LoadSpec>, edges: [string, string, LoadSpec?][]): Graph {
  const els: ElLike[] = [];
  for (const [id, load] of Object.entries(nodes)) els.push({ id, kind: "rect", iconId: "", text: id, src: "", dst: "", load });
  edges.forEach(([s, d, load], i) => els.push({ id: `e${i}`, kind: "arrow", iconId: "", text: "", src: s, dst: d, load }));
  const g = buildGraph(els);
  if (isTooLarge(g)) throw new Error("too large");
  return g;
}
