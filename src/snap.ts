/** Nearest-line snap for one axis, reused across a drag (no allocation): `d` is the shift to apply, `g` the matched world coordinate (NaN = none). */
export class Snap {
  d = 0; g = NaN; best = 0;
  reset(thr: number): void { this.best = thr; this.d = 0; this.g = NaN; }
  /** try the three neighbour lines (low edge, centre, high edge) against one of my coordinates; NaN `v` never matches */
  try3(v: number, c0: number, c1: number, c2: number): void { this.one(v, c0); this.one(v, c1); this.one(v, c2); }
  private one(v: number, c: number): void {
    const d = c - v, a = d < 0 ? -d : d;
    if (a < this.best) { this.best = a; this.d = d; this.g = c; }
  }
}
