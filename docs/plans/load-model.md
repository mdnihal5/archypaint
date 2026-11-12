# Load model: capacity, requests and flow animation (planned, not started)

Asked for by Nihal 2026-11-12. Parked until he says go. Earlier mock: `docs/ui-mocks/numbers-on-diagram.html`
(the sliders there were a demo; the real inputs live in the capacity note).

## Goal
Each service gets a capacity; requests enter at the edge, flow through the arrows, and every service shows how much
it receives against what it can take. The flow dots speed up, thin out or pile up to match. It should behave like a
real production system (caches absorb reads, load balancers split, queues buffer, retries amplify), not like
arithmetic on labels.

## Hard constraints (his north star)
- Default UI unchanged: no new always-visible control, no canvas shrink. Everything appears only in an opt-in
  "Load" view (one toggle in the existing top-right cluster, off by default) and in the properties panel of a
  selected shape.
- Startup JS stays under the 69 KB gate (now 67.3): all of it in a lazy chunk next to calc.
- No per-frame work when idle. The model recomputes only when the graph, a capacity or the note changes; the flow
  dots read a cached result.
- Hostile input bounded like calc.ts (max nodes/edges visited, cycle-safe, no eval).

## Model (steady state first)
Per node: `cap` (requests/s one replica can serve), `rep` (replicas, default 1). Effective capacity = cap * rep.
Per arrow: optional `share` (fraction of the source's output sent along it, default split evenly) and `mult`
(fan-out: one request becomes N downstream calls, default 1).
Sources: a node marked as an entry gets `rate` from a capacity-note variable (`{peak}`), the single source of truth.
Propagation: traverse from entries in topological order; arrival `lambda` at a node = sum over incoming arrows of
(source output * share * mult). Cycles (retries, feedback) are solved by bounded iteration with damping, and flagged
if they do not converge ("retry storm").
Per node result: utilisation `rho = lambda / (cap*rep)`; status green < 0.7, amber < 1, red >= 1; served =
min(lambda, capacity); the excess is dropped (or queued if the node is a queue).
Node behaviours chosen by kind/icon, each a small pure function:
- cache: hit rate splits output into served-locally and miss path.
- load balancer: splits evenly (or by weights) across downstream replicas.
- queue/broker: absorbs, depth grows at (lambda - mu) while overloaded; downstream sees min(lambda, mu).
- database: read/write mix, write amplification optional.
- default service: passes served requests on.
Later (phase 3): latency estimate (M/M/1-style W = 1/(mu - lambda), shown only below saturation), p99 hints, retry
amplification, scenarios (spike for N seconds) as a timeline.

## Presentation
- Arrow chip (same plate as labels): rate, e.g. "56k /s". Node badge under the node only when it has a capacity:
  "11k of 8k  139%" in green/amber/red. No capacity -> node looks exactly as today.
- Flow dots: speed and density scale with the arrow's rate (log scale, clamped so 5,000 arrows stay cheap); an
  arrow into an overloaded node turns red and its dots bunch up; dropped load fades out at the node. Reduced-motion
  and the existing flow toggle still win.
- Where capacity is typed (open choice, he has not picked): line `cap 8k` in the node's own label, or a "Capacity"
  field in the properties panel. Recommendation: the panel field (discoverable, no hidden syntax) plus the label form
  as a power-user shortcut.

## Phases and how each is verified
1. Pure model `src/load.ts` (lazy): graph traversal, splits, caches, queues, cycles. Verify: table-driven unit tests
   (known small topologies with hand-computed answers), property test (conserved flow: served + dropped = in),
   cycle and size-bomb tests.
2. Data + panel: `cap`, `rep`, `share`, `mult`, entry flag on elements; format/save/Excalidraw/undo carry them; old
   files load unchanged. Verify: round-trip tests, ui-check at 390 and 1280 px, no overflow.
3. Load view overlay: chips + badges, toggle. Verify: ui-check real clicks, screenshots dark/light, export shows
   the numbers.
4. Flow animation driven by rate/utilisation. Verify: perf benchmark at 5,000 shapes vs baseline (frame time,
   idle frames = 0, heap flat), flow dots test.
5. Latency/queue depth/scenarios. Own plan once 1-4 are used.
Gate for every phase: tests, build, startup size, ui-check, interact benchmark, 5,000-shape benchmark twice vs
baseline, heap flat, 0 idle frames.

## Open questions for Nihal
1. Capacity typing: panel field, label line, or both?
2. Is steady state enough for v1, or is the spike scenario (traffic burst, queue filling) the part you care about?
3. Entry rate: one global note variable, or each entry node with its own?
4. Should dropped traffic be visible (red leak at the node) or only the percentage?
