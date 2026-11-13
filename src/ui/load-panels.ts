import "./load-panels.css";
import type { Ctx, LoadViewApi } from "./ctx";
import { mountLoadCard } from "./load-card";
import { mountScenario } from "./load-scenario";

/**
 * The Load view's panels, one lazy chunk loaded only while the view is on: the per-service card, the spike scenario bar and the
 * utilisation chart. Returns the teardown (DOM, listeners, subscriptions, the play loop) that the view runs when it turns off.
 */
export function mountLoadPanels(ctx: Ctx, root: HTMLElement, lv: LoadViewApi): () => void {
  const card = mountLoadCard(ctx, root, lv);
  const scn = mountScenario(ctx, root, lv);
  return () => { scn.dispose(); card.dispose(); };
}
