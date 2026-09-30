/** Service-worker registration. Deliberately conservative: no auto-reload, no skipWaiting on install, so it cannot loop. */
declare const __BUILD_ID__: string | undefined;

export interface PwaOpts { /** called when a newer version has been installed and is waiting */ onUpdateReady?: () => void }
export interface PwaHandle {
  /** activate the waiting version and reload once (only ever after the user asked for it) */
  update(): void;
  dispose(): void;
}

function head(tag: "link" | "meta", attrs: Record<string, string>, key: string): void {
  if (document.head.querySelector(`${tag}[${key}]`)) return;
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.head.appendChild(el);
}

export function registerPwa(opts: PwaOpts = {}): PwaHandle {
  const noop: PwaHandle = { update() {}, dispose() {} };
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !import.meta.env.PROD) return noop;

  const base = import.meta.env.BASE_URL;
  head("link", { rel: "manifest", href: `${base}manifest.webmanifest` }, 'rel="manifest"');
  head("link", { rel: "icon", type: "image/svg+xml", href: `${base}icon.svg` }, 'rel="icon"');
  head("link", { rel: "apple-touch-icon", href: `${base}icon-192.png` }, 'rel="apple-touch-icon"');
  head("meta", { name: "theme-color", content: "#f5f1e6" }, 'name="theme-color"');

  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  let reg: ServiceWorkerRegistration | null = null;
  let reloading = false;
  let disposed = false;
  const cleanups: Array<() => void> = [];

  const onControllerChange = () => { if (!reloading && hadController) { reloading = true; location.reload(); } };

  const watch = (r: ServiceWorkerRegistration) => {
    if (r.waiting && sw.controller) opts.onUpdateReady?.();
    const onFound = () => {
      const w = r.installing;
      if (!w) return;
      const onState = () => { if (w.state === "installed" && sw.controller && !disposed) opts.onUpdateReady?.(); };
      w.addEventListener("statechange", onState);
      cleanups.push(() => w.removeEventListener("statechange", onState));
    };
    r.addEventListener("updatefound", onFound);
    cleanups.push(() => r.removeEventListener("updatefound", onFound));
  };

  const register = () => {
    if (disposed) return;
    const id = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
    sw.register(`${base}sw.js?v=${encodeURIComponent(id)}`, { scope: base }).then((r) => { if (disposed) return; reg = r; watch(r); }).catch(() => { /* offline support is optional */ });
  };
  if (document.readyState === "complete") register();
  else { addEventListener("load", register, { once: true }); cleanups.push(() => removeEventListener("load", register)); }

  return {
    update() {
      if (!reg?.waiting) return;
      sw.addEventListener("controllerchange", onControllerChange);
      cleanups.push(() => sw.removeEventListener("controllerchange", onControllerChange));
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    },
    dispose() { disposed = true; for (const f of cleanups) f(); cleanups.length = 0; },
  };
}
