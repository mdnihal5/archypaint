import type { Ctx } from "./ctx";
import { setAttr } from "./dom";
import { h } from "./dom";
import { mountLayers } from "./layers";
import { mountProps, type PropsPanel } from "./props";
import { loadPrefs } from "./props-pos";

/** Right column: properties (when opened by the viewer) above layers (when the scene is non-empty). One updater. */
export function mountRight(ctx: Ctx, root: HTMLElement): { toggleNarrow(): void; setNarrow(open: boolean): void } {
  const col = h("div", { class: "ap-right", attrs: { "data-any": "false", "data-open": "false" } });
  root.append(col);
  const layers = mountLayers(ctx, col);
  // the properties card is closed by default, so its ~200 nodes are built on first open, not at load
  let props: PropsPanel | null = null;
  const ensureProps = (): PropsPanel => {
    if (!props) { props = mountProps(ctx, col); col.prepend(props.el); }
    return props;
  };
  if (loadPrefs().open) ensureProps();
  else {
    const first = () => ensureProps().toggle();
    ctx.toggleProps = first;
    ctx.propsOpen = () => false;
    ctx.d.add(() => { if (ctx.toggleProps === first) { ctx.toggleProps = undefined; ctx.propsOpen = undefined; } });
  }

  const render = () => {
    props?.render();
    layers.render();
    setAttr(col, "data-any", props?.visible() || layers.visible() ? "true" : "false");
  };
  // the properties card opens only when the viewer asks (I / the toggle button) and stays where they put it: nothing moves it
  const u = ctx.update("right", render);
  ctx.wire(u, "change", "selection", "edit");
  ctx.d.add(ctx.settings.subscribe(() => u.schedule()));
  ctx.d.add(() => col.remove());
  render();
  const set = (open: boolean) => setAttr(col, "data-open", open ? "true" : "false");
  return { toggleNarrow: () => set(col.getAttribute("data-open") !== "true"), setNarrow: set };
}
