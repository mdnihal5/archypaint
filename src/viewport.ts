export class Viewport {
  /** world coordinates of the top-left corner of the screen */
  x = 0; y = 0; zoom = 1;
  /** css pixels */
  w = 0; h = 0;
  /** bumps on every change so caches can key off it */
  version = 0;

  static readonly MIN = 0.05;
  static readonly MAX = 8;

  resize(w: number, h: number): void { this.w = w; this.h = h; this.version++; }

  panBy(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom; this.y -= dyScreen / this.zoom; this.version++;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const z = Math.min(Viewport.MAX, Math.max(Viewport.MIN, this.zoom * factor));
    if (z === this.zoom) return;
    const wx = this.x + sx / this.zoom, wy = this.y + sy / this.zoom;
    this.zoom = z;
    this.x = wx - sx / z; this.y = wy - sy / z;
    this.version++;
  }

  reset(): void { this.x = 0; this.y = 0; this.zoom = 1; this.version++; }

  toWorldX(sx: number): number { return this.x + sx / this.zoom; }
  toWorldY(sy: number): number { return this.y + sy / this.zoom; }
}
