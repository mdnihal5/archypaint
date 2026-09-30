import type { Ctx } from "./ctx";
import { setAttr } from "./dom";
import { h } from "./dom";
import { mountLayers } from "./layers";
import { mountProps } from "./props";

/** Right column: properties (when something is selected) above layers (when the scene is non-empty). One updater. */
export function mountRight(ctx: Ctx, root: HTMLElement): { toggleNarrow(): void; setNarrow(open: boolean): void } {
  const col = h("div", { class: "ap-right", attrs: { "data-any": "false", "data-open": "false" } });
  root.append(col);
  const props = mountProps(ctx, col);
  const layers = mountLayers(ctx, col);

  const render = () => {
    props.render();
    layers.render();
    setAttr(col, "data-any", props.visible() || layers.visible() ? "true" : "false");
  };
  const u = ctx.update("right", render);
  ctx.wire(u, "change", "selection");
  ctx.d.add(ctx.settings.subscribe(() => u.schedule()));
  ctx.d.add(() => col.remove());
  render();
  const set = (open: boolean) => setAttr(col, "data-open", open ? "true" : "false");
  return { toggleNarrow: () => set(col.getAttribute("data-open") !== "true"), setNarrow: set };
}
