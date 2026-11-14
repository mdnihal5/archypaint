import type { Steady, Timeline } from "../load/model";

/**
 * Where the Load view reads its numbers from: the steady-state result, or one frame of the timeline (while a scenario plays or is
 * scrubbed). One shape for both so the overlay, the flow dots and the card never branch on the mode.
 * Frame values: `in` = util * capacity (only meaningful where hasCap), growth is 0 (a queue shows its backlog instead).
 */
export interface Src {
  readonly frame: boolean;
  edge(e: number): number;
  in(v: number): number;
  util(v: number): number;
  dropped(v: number): number;
  growth(v: number): number;
  /** queue depth / buffered requests; -1 in steady state (not a quantity there) */
  backlog(v: number): number;
  /** a node at or over capacity */
  sat(v: number): boolean;
  /** retry amplification of the whole drawing at this moment */
  amp(): number;
}

export function steadySrc(st: Steady): Src {
  const g = st.g;
  return {
    frame: false,
    edge: (e) => st.edge[e]!, in: (v) => st.in[v]!, util: (v) => st.util[v]!, dropped: (v) => st.dropped[v]!, growth: (v) => st.growth[v]!,
    backlog: () => -1, sat: (v) => st.sat[v] === 1,
    amp: () => { let a = 1; for (const j of g.entries) a = Math.max(a, st.amp[j]!); return a; },
  };
}

/** one reusable object: set `.i` to move to another frame (no allocation per frame) */
export class FrameSrc implements Src {
  readonly frame = true;
  i = 0;
  constructor(private readonly st: Steady, readonly tl: Timeline) {}
  edge(e: number): number { return this.tl.edgeRate[this.i * this.tl.edges + e]!; }
  util(v: number): number { return this.tl.util[this.i * this.tl.nodes + v]!; }
  in(v: number): number { const g = this.st.g; return g.hasCap[v] ? this.util(v) * g.cap[v]! : 0; }
  dropped(v: number): number { return this.tl.dropped[this.i * this.tl.nodes + v]!; }
  growth(_v?: number): number { return 0; }
  backlog(v: number): number { return this.tl.backlog[this.i * this.tl.nodes + v]!; }
  sat(v: number): boolean { return this.util(v) >= 1; }
  amp(): number { return this.tl.amp[this.i]!; }
}
