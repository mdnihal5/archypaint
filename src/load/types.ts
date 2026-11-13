/**
 * Load model data stored on elements as `El.load` (optional; absent = the element takes no part beyond passing traffic).
 * Plan + approved mock: docs/plans/load-model.md, docs/ui-mocks/load-view.html.
 * Keys are short because they are persisted per element. Every number is validated/clamped by cleanLoad (io/format.ts).
 */
export type Role = "entry" | "service" | "lb" | "limiter" | "cache" | "queue" | "db";
export type Algo = "token" | "leaky" | "fixed" | "sliding";

export interface LoadSpec {
  /** what the element acts as; absent = detected from its icon / shape (see load/detect.ts) */
  role?: Role;
  /** requests/s ONE replica can serve (service, lb, cache, db, limiter); for a queue: messages/s it drains. Absent = unlimited */
  cap?: number;
  /** replicas, 1..1000 (default 1); total capacity = cap * rep */
  rep?: number;
  /** service time per request in ms, 0..60000 (default by role) */
  ms?: number;
  /** entry only: requests/s it produces */
  rate?: number;
  /** entry only: client retries per failed request, 0..5 (default 0) */
  retries?: number;
  /** entry only: 1 = exponential backoff + jitter on retries */
  backoff?: 0 | 1;
  /** entry only: traffic spike scenario [multiplier 1..100, start s 0..600, duration s 1..600] */
  spike?: [number, number, number];
  /** cache only: hit ratio in percent, 0..100 (default 80) */
  hit?: number;
  /** queue only: max depth in messages (default 100000); beyond it new messages are dropped */
  depth?: number;
  /** limiter only: algorithm (default token), limit in requests/s, burst (token bucket size / leaky bucket queue size) */
  algo?: Algo; limit?: number; burst?: number;
  /** arrows only: share weight of the source's output (default 1; outputs split by weight) */
  w?: number;
  /** arrows only: calls made per request passing along this arrow (fan-out), 0..100 (default 1) */
  x?: number;
}
