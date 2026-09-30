import type { Scene, Kind } from "./scene";

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** deterministic scene of n shapes at ~one shape per 200x140 world cell */
export function stress(scene: Scene, n: number, seed = 1): void {
  const rnd = mulberry32(seed);
  const cols = Math.ceil(Math.sqrt(n * 1.4));
  const kinds: Kind[] = ["rect", "rect", "ellipse", "diamond"];
  const labels = ["api", "db", "cache", "queue", "worker", "lb", "cdn", "auth"];
  for (let i = 0; i < n; i++) {
    const cx = i % cols, cy = Math.floor(i / cols);
    scene.add({
      kind: kinds[Math.floor(rnd() * kinds.length)]!,
      x: cx * 200 + rnd() * 30, y: cy * 140 + rnd() * 20, w: 100 + rnd() * 50, h: 60 + rnd() * 30,
      cat: Math.floor(rnd() * 8), fill: Math.floor(rnd() * 3) as 0 | 1 | 2, radius: rnd() < 0.5 ? 0 : 8 + Math.floor(rnd() * 10),
      text: `${labels[Math.floor(rnd() * labels.length)]}-${i}`,
    });
  }
}

const MIXED_ICONS = ["browser", "load-balancer-l7", "app-server", "sql-database", "cache", "kafka-topic", "worker", "read-replica",
  "aws-ec2", "aws-s3", "aws-lambda", "gcp-bigquery", "gcp-pubsub", "azure-cosmos-db", "kafka", "redis", "postgresql", "kubernetes"];
const MIXED_SHAPES: Kind[] = ["rect", "ellipse", "cylinder", "cloud", "hexagon", "note"];

/**
 * A realistic diagram at scale: ~60% icons from every pack, ~25% shapes (incl. path-drawn kinds), and an arrow
 * between most neighbours (labelled every 4th), grouped in clusters of 8. This is what a real sheet costs to draw;
 * plain rectangles (stress()) flatter the renderer.
 */
export function stressMixed(scene: Scene, n: number, route: (id: string) => void, seed = 7): void {
  const rnd = mulberry32(seed);
  const nodes = Math.round(n * 0.62);
  const cols = Math.ceil(Math.sqrt(nodes * 1.2));
  const ids: string[] = [];
  for (let i = 0; i < nodes; i++) {
    const cx = i % cols, cy = Math.floor(i / cols);
    const icon = rnd() < 0.7;
    const e = icon
      ? scene.add({ kind: "icon", iconId: MIXED_ICONS[Math.floor(rnd() * MIXED_ICONS.length)]!, x: cx * 220, y: cy * 170, w: 96, h: 96 + 18, text: `svc-${i}`, cat: Math.floor(rnd() * 8) })
      : scene.add({ kind: MIXED_SHAPES[Math.floor(rnd() * MIXED_SHAPES.length)]!, x: cx * 220, y: cy * 170, w: 130, h: 80, text: `node-${i}`, cat: Math.floor(rnd() * 8), fill: Math.floor(rnd() * 3) as 0 | 1 | 2 });
    ids.push(e.id);
  }
  let arrows = 0;
  for (let i = 0; i < nodes && arrows < n - nodes; i++) {
    const right = (i + 1) % cols !== 0 ? ids[i + 1] : undefined, down = ids[i + cols];
    for (const to of [right, down]) {
      if (!to || arrows >= n - nodes || rnd() < 0.15) continue;
      const a = scene.add({ kind: "arrow", src: ids[i]!, dst: to, route: (rnd() < 0.6 ? 1 : rnd() < 0.5 ? 0 : 2) as 0 | 1 | 2, dash: (rnd() < 0.3 ? 1 : 0) as 0 | 1, text: arrows % 4 === 0 ? "http" : "", cat: Math.floor(rnd() * 8) });
      route(a.id);
      arrows++;
    }
  }
  for (let g = 0; g * 8 < nodes; g++) {
    const gid = `g${g}`;
    scene.groups.set(gid, { id: gid, name: `tier-${g}`, cat: g % 8, collapsed: false, locked: false });
    for (let k = g * 8; k < Math.min(nodes, g * 8 + 8); k++) { const e = scene.els.get(ids[k]!); if (e) scene.patch(e, { groupIds: [gid] }); }
  }
}
