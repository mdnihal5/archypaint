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

---
## Decisions so far (Nihal, 2026-11-12, second pass). Still NO implementation until he says finalized.
- Wanted: cache, load balancer, queues, loops/retries with limits, latency, traffic spikes, rate-limiting algorithms
  (token bucket, leaky bucket, fixed window, sliding window).
- Capacity is per service. Dropped traffic is visible. Flow animation follows the load.
- Capacity typing, entry-rate details, steady state vs timeline: to be decided after discussion.
- Rule over everything: simple, clean, fast, no UI clutter; show only what is needed, when, and where.

## Proposed engine (to confirm)
Two layers over one graph, both fluid (rates, not individual requests) so they are deterministic and cheap:
1. Steady state: instant answer when anything changes (the t -> infinity result). Always available in Load view.
2. Timeline: time-stepped fluid simulation (virtual step ~100 ms) for spikes, queue filling, retries, breakers,
   token buckets. Runs only while a scenario is playing, never when idle. Cost per step O(nodes + edges).
Per-node state: queue depth, tokens, breaker state. Latency = service time + queue depth / service rate (Little's law).
Honest limit: a fluid model gives mean latency and queue wait, not true percentiles; any p99 shown is labelled as a
rough estimate. Everything is labelled "estimate", not a load test.
Behaviours picked automatically from the icon/kind (Redis -> cache, Kafka/SQS -> queue, nginx/ELB -> load balancer,
API gateway -> rate limiter) so most services need zero typing.

## Progressive disclosure (the anti-clutter rule)
0. Load view off (default): nothing changes anywhere.
1. Load view on (one toggle, top-right cluster): chips on arrows, badge only on services that have a capacity.
2. Select a service while Load view is on: a small draggable "Load" card (same mechanism as the properties panel)
   with only that kind's fields: capacity, replicas, + cache hit %, LB policy, queue size, limiter algo and limit.
   Hidden when nothing is selected. The normal properties panel is untouched.
3. Entry rate: select an entry service, "Entry rate" field in its Load card (from a note variable or a typed number).
4. Scenario bar: one slim row, only when Load view is on AND a scenario exists (Spike x5 for 30 s, play/pause).
Next step when he agrees: a rendered mock of exactly these states (frontend-design approval gate) before any code.

---
## Phase 2a decisions (Load view, read-only), implemented
- Toggle: gauge button in the top-right cluster (same `ap-ib ap-wide` markup as theme and flow, so it hides on phones with them) and a "Load view" chip in the menu's View group. Setting `load` (default off) persists in the same settings store as `flow`; `?load=on|off` overrides for a session (scripts). No shortcut. Startup growth: +0.2 KB gz (68.1 of 69).
- All code is the lazy chunk `ui/load-view.ts` (+ pure `ui/load-draw.ts`); it loads only when the setting is on and unmounts itself (canvas, listeners, observer, caches, result) when it goes off. The chrome exposes it as `ctx.loadView` (`LoadViewApi`: `steady()`, `subscribe`, `recompute()`, `edge()`, `active()`, `stop()`), the hook for the service card and scenario bar. `ctx.flowKick` lets it wake the flow loop.
- Cost: own transparent canvas in `#ui` (never repaints the drawing layers). Model recomputed only after `change`/`history`/pointer-up, only when `scene.nonce` moved, once per animation frame; viewport/theme/resize only repaint the overlay (visible elements via `scene.query`). No loop: idle = 0 frames. During a drag the overlay is cleared and left alone until release.
- Drawing: arrow chip = connector-label plate (`labelBlock`, paper fill) with a 1 px border (mid, or red when the destination is saturated). At t=0.5; if an existing label there, other t along the arrow; on a short arrow, beside the line. Nodes with a capacity only: bar + "6.0k of 9.0k · 67%" (green < 70, amber < 100, red >= 100; tokens in `load-draw.ts`, both themes, >= 4.5:1 on paper, asserted) + red "dropped / rejected / backlog +" line only when non-zero. Arrows below 0.5/s and nodes without capacity draw nothing.
- LOD: text only at zoom >= 0.6; bars while the node is >= 14 px wide on screen.
- Too large (> 3000 connected nodes / 6000 arrows): one toast per session of the view, nothing drawn.
- Flow dots: while Load view is on AND the model has an entry with a rate, speed (0.5x..1.4x) and count (1..6) follow the arrow rate on a log scale, arrows with no traffic show no dots, dots into a saturated node turn red, slow to 0.3x and bunch toward it. With Load view off, or on a diagram with no rate, the dots are exactly as before. Reduced motion and the flow toggle still win.
- Present mode: the overlay lives in `#ui`, which present hides, so numbers are not shown while presenting (same as the dots). Read-only shared view: the toggle works and the overlay draws.
- PNG/SVG export does NOT include the overlay in v1 (it is a separate canvas, like the flow dots). Revisit with phase 5.
- Benchmark switches: `?mixed=N&loadspecs=1&load=on` (perf: `node perf/run.mjs 5000 --mixed --load`).

## Phase 2b decisions (card, scenario bar, chart), implemented
- All of it is part of the `load-view` lazy chunk (`load-panels.ts` mounts `load-card.ts` and `load-scenario.ts`; a separate chunk made rolldown split `logos` out of the entry and cost +0.2 KB startup, so it is a static import of the lazy chunk). Startup stays 68.1 KB gz. Pure logic (roles -> fields, "10k" parsing, ranges mirrored from cleanLoad and asserted against it, card placement, scenario T) is in `load-fields.ts`; `load-src.ts` is the one numbers source (steady or a timeline frame) read by overlay, flow dots and card.
- Card: only for ONE selected service (rect, ellipse, icon...) or ONE arrow that is in the graph, never auto-opened, hidden while a label is edited. Beside the element (flips, clamped under the cluster and above the dock, dodges chart / ribbon), follows pan/zoom with a transform, grip-draggable (stays for the session, double-click the grip to follow again). <= 600 px: bottom sheet. Inputs commit on change / Enter / blur via `editor.setLoad` (one undo step), Esc reverts, invalid text is flagged and never committed or clamped. "Acts as" select overrides the detected role.
- Scenario: bar (top centre) and chart (top right) exist only while an entry has a spike. The timeline is cached until the model changes, T = max(60, start + dur + 20). rAF runs only while playing; paused/stopped/off = 0 frames. Graphs over 2000 nodes+arrows chart only after the first play/scrub. Turning the view off frees timeline and frame.
- Known limit: a read-only shared view cannot select by click (input.ts pans on any pointerdown), so the card cannot open there; it renders read-only when an element is selected through the API or is locked.
