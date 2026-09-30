// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasLogoIcon, iconInner, resetPacks } from "./icon-pack";
import {
  CACHE_MAX, closeLogos, ensureLogo, glyphMarkup, logoCacheBytes, MAX_SVG, memLogoStore, OPT_IN_KEY, RESTRICTED_KEY, restoreLogo,
  setInUseProbe, setLogoEnv, setOptedIn, setShowRestricted, svgProblem,
} from "./logos";

const svg = (d: string, extra = "") => `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"${extra}><title>X</title><path d="${d}"/></svg>`;
const OK = svg("M1 1L5 5zM9.5 2.25c-.5 1-2 1.5-3 .5");
const res = (body: string, init?: ResponseInit) => new Response(body, { status: 200, ...init });

describe("svgProblem (every downloaded file is treated as hostile)", () => {
  it("accepts the exact shape Simple Icons serves", () => { expect(svgProblem(OK)).toBeNull(); });
  it("returns the path data", () => { const o = { d: "" }; svgProblem(OK, o); expect(o.d).toBe("M1 1L5 5zM9.5 2.25c-.5 1-2 1.5-3 .5"); });
  it.each([
    ["empty", ""],
    ["not a string", 42],
    ["too large", svg("M" + "1 ".repeat(MAX_SVG))],
    ["script element", OK.replace("<title>X</title>", "<script>alert(1)</script>")],
    ["event attribute", svg("M1 1", ' onload="alert(1)"')],
    ["wrong viewBox", OK.replace("0 0 24 24", "0 0 100 100")],
    ["extra attribute", OK.replace('role="img"', 'role="img" style="x"')],
    ["duplicate attribute", OK.replace('role="img"', 'role="img" role="img"')],
    ["two paths", OK.replace("</svg>", '<path d="M1 1"/></svg>')],
    ["nested svg", OK.replace("</svg>", "<svg></svg></svg>")],
    ["style element", OK.replace("</svg>", "<style>*{}</style></svg>")],
    ["foreignObject", OK.replace("<title>X</title>", "<foreignObject/>")],
    ["href / use", OK.replace("</svg>", '<use href="x"/></svg>')],
    ["markup in title", OK.replace("<title>X</title>", "<title><b>x</b></title>")],
    ["path with letters outside the alphabet", svg("M1 1 javascript:alert(1)")],
    ["path with url()", svg("M1 1 url(x)")],
    ["path not starting with M", svg("L1 1")],
    ["empty path", svg("")],
    ["entity", svg("M1 1&#x0A;")],
    ["trailing junk", OK + "<script/>"],
    ["prefixed junk", "junk" + OK],
  ])("rejects: %s", (_n, input) => { expect(svgProblem(input)).not.toBeNull(); });
  it("does not backtrack catastrophically on a hostile attribute soup", () => {
    const t0 = performance.now();
    svgProblem("<svg" + ' a="1"'.repeat(1500) + ">" + "x".repeat(2000));
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe("glyphMarkup", () => {
  it("wraps validated path data in our own markup only", () => {
    expect(glyphMarkup("M1 1L5 5z")).toBe('<path d="M1 1L5 5z" fill="currentColor" stroke="none"/>');
  });
  it("re-checks with the user-pack grammar", () => { expect(glyphMarkup('M1 1"/><script>')).toBeNull(); expect(glyphMarkup("M1 1 x")).toBeNull(); });
});

describe("ensureLogo", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let store: ReturnType<typeof memLogoStore>;
  let now = 1_000_000;
  const setup = (impl: (u: string, i: RequestInit) => Promise<Response>, prefill?: (s: ReturnType<typeof memLogoStore>) => void) => {
    fetchMock = vi.fn(impl);
    store = memLogoStore(); prefill?.(store);
    setLogoEnv({ fetch: fetchMock as never, store: () => store, now: () => now });
  };
  beforeEach(() => { localStorage.clear(); resetPacks(); now = 1_000_000; });
  afterEach(() => { vi.useRealTimers(); setLogoEnv(null); setInUseProbe(null); closeLogos(); });

  it("does not touch the network before the user opts in", async () => {
    setup(async () => res(OK));
    expect(await ensureLogo("redis")).toBe("blocked");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hasLogoIcon("logo-redis")).toBe(false);
  });

  it("downloads once opted in: fixed URL, no credentials, no referrer, no redirects; installs only our markup; persists it", async () => {
    setup(async () => res(OK)); setOptedIn(true);
    expect(await ensureLogo("redis")).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/simple-icons@\d+\.\d+\.\d+\/icons\/redis\.svg$/);
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(hasLogoIcon("logo-redis")).toBe(true);
    expect(iconInner("logo-redis", "glyph")).toBe('<path d="M1 1L5 5zM9.5 2.25c-.5 1-2 1.5-3 .5" fill="currentColor" stroke="none"/>');
    expect(store.data.get("redis")?.d).toContain("M1 1L5 5");
    expect(logoCacheBytes()).toBeGreaterThan(0);
  });

  it("only ever requests catalog slugs: a hostile document cannot steer the URL", async () => {
    setup(async () => res(OK)); setOptedIn(true);
    for (const bad of ["../../etc/passwd", "redis/../../x", "REDIS", "", "a".repeat(80), "not-a-real-brand", "evil.example"]) expect(await ensureLogo(bad)).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("de-dupes concurrent requests for one logo", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    setup(async () => { await gate; return res(OK); }); setOptedIn(true);
    const a = ensureLogo("redis"), b = ensureLogo("redis"), c = ensureLogo("redis");
    release();
    expect(await Promise.all([a, b, c])).toEqual(["ok", "ok", "ok"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never runs more than 3 downloads at once", async () => {
    let cur = 0, peak = 0; const gates: Array<() => void> = [];
    setup(() => new Promise<Response>((r) => { cur++; peak = Math.max(peak, cur); gates.push(() => { cur--; r(res(OK)); }); })); setOptedIn(true);
    const all = ["redis", "nginx", "kubernetes", "grafana", "rust", "python"].map((s) => ensureLogo(s));
    await vi.waitFor(() => expect(gates.length).toBe(3));
    expect(peak).toBe(3);
    while (gates.length) { gates.shift()!(); await new Promise((r) => setTimeout(r, 5)); }
    expect(await Promise.all(all)).toEqual(Array(6).fill("ok"));
    expect(peak).toBe(3);
  });

  it("retries exactly once on a server error, then succeeds or gives up", async () => {
    let n = 0;
    setup(async () => (++n === 1 ? res("", { status: 503 }) : res(OK))); setOptedIn(true);
    expect(await ensureLogo("redis")).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    setup(async () => res("", { status: 500 })); setOptedIn(true);
    expect(await ensureLogo("nginx")).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + one retry, no more
  });

  it("does not retry a 404 or an invalid file", async () => {
    setup(async () => res("nope", { status: 404 })); setOptedIn(true);
    expect(await ensureLogo("redis")).toBe("failed"); expect(fetchMock).toHaveBeenCalledTimes(1);
    setup(async () => res(OK.replace("<title>X</title>", "<script>1</script>"))); setOptedIn(true);
    expect(await ensureLogo("nginx")).toBe("failed"); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hasLogoIcon("logo-nginx")).toBe(false);
  });

  it("times out after 6 s per attempt (aborting the request), retries once, then fails", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    setup((_u, init) => new Promise<Response>((_r, rej) => { signals.push(init.signal!); init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))); })); setOptedIn(true);
    const p = ensureLogo("redis");
    await vi.advanceTimersByTimeAsync(5900); expect(signals.length).toBe(1); expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(200); expect(signals[0]!.aborted).toBe(true); expect(signals.length).toBe(2);
    await vi.advanceTimersByTimeAsync(6100);
    expect(await p).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0); // no timer left behind
  });

  it("after a failure: no retry loop for 60 s; an explicit retry (force) or the passing of time tries again", async () => {
    let ok = false;
    setup(async () => (ok ? res(OK) : res("", { status: 404 }))); setOptedIn(true);
    expect(await ensureLogo("redis")).toBe("failed"); const calls = fetchMock.mock.calls.length;
    for (let i = 0; i < 5; i++) expect(await ensureLogo("redis")).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(calls); // cool-down: the draw path cannot hammer a failing CDN
    ok = true;
    expect(await ensureLogo("redis", { force: true })).toBe("ok");
    setup(async () => (ok ? res(OK) : res("", { status: 404 }))); setOptedIn(true); ok = false;
    expect(await ensureLogo("nginx")).toBe("failed");
    ok = true; now += 61_000;
    expect(await ensureLogo("nginx")).toBe("ok");
  });

  it("refuses an oversized response (declared or streamed) without buffering it", async () => {
    setup(async () => res(OK, { headers: { "content-length": String(MAX_SVG + 1) } })); setOptedIn(true);
    expect(await ensureLogo("redis")).toBe("failed");
    const big = new ReadableStream<Uint8Array>({ start(c) { const chunk = new TextEncoder().encode("x".repeat(4096)); for (let i = 0; i < 10; i++) c.enqueue(chunk); c.close(); } });
    setup(async () => new Response(big, { status: 200 })); setOptedIn(true);
    expect(await ensureLogo("nginx")).toBe("failed");
  });

  it("restricted brands are not fetched until the user enabled them too", async () => {
    setup(async () => res(OK)); setOptedIn(true);
    expect(await ensureLogo("docker")).toBe("blocked"); expect(fetchMock).not.toHaveBeenCalled();
    setShowRestricted(true);
    expect(await ensureLogo("docker")).toBe("ok"); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(RESTRICTED_KEY)).toBe("1"); expect(localStorage.getItem(OPT_IN_KEY)).toBe("1");
  });

  it("works offline after a restart: a cached logo needs neither opt-in state nor the network", async () => {
    const d = "M1 1L5 5z";
    setup(async () => { throw new TypeError("offline"); }, (s) => { s.data.set("redis", { slug: "redis", d, bytes: 500, used: 1 }); });
    expect(await ensureLogo("redis")).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hasLogoIcon("logo-redis")).toBe(true);
  });

  it("ignores corrupt or hostile rows in the cache", async () => {
    setup(async () => res(OK), (s) => { s.data.set("redis", { slug: "redis", d: "M1 1 <script>", bytes: 10, used: 1 }); s.data.set("unknown", { slug: "unknown", d: "M1 1", bytes: 10, used: 1 }); });
    expect(await ensureLogo("redis")).toBe("blocked"); // the bad row was not installed, and (not opted in) nothing is fetched
    expect(hasLogoIcon("logo-redis")).toBe(false);
  });

  it("a document drawing an uninstalled logo restores it from the cache but never downloads without opt-in", async () => {
    setup(async () => res(OK), (s) => { s.data.set("nginx", { slug: "nginx", d: "M2 2L9 9z", bytes: 300, used: 1 }); });
    expect(iconInner("logo-nginx", "glyph")).toBeNull(); // first draw: not installed yet, kicks the restore
    await vi.waitFor(() => expect(hasLogoIcon("logo-nginx")).toBe(true));
    iconInner("logo-redis", "glyph"); // not cached, not opted in
    await new Promise((r) => setTimeout(r, 30));
    expect(hasLogoIcon("logo-redis")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the cache under its byte cap by evicting the least recently used logos, never one that is on the canvas", async () => {
    const d = "M1 1L5 5z";
    setup(async () => res(OK), (s) => {
      for (const [i, slug] of ["nginx", "rust", "python", "grafana"].entries()) s.data.set(slug, { slug, d, bytes: 60 * 1024, used: i + 1 }); // 240 KB: over the 200 KB cap
    });
    setOptedIn(true);
    setInUseProbe(() => new Set(["logo-nginx"])); // the oldest one is in use
    expect(await ensureLogo("redis")).toBe("ok");
    expect(logoCacheBytes()).toBeLessThanOrEqual(CACHE_MAX);
    expect(store.data.has("nginx")).toBe(true); // protected
    expect(store.data.has("rust")).toBe(false); // the oldest unprotected was evicted
    expect(store.data.has("redis")).toBe(true);
  });

  it("refuses to cache past twice the cap when everything is in use", async () => {
    const d = "M1 1L5 5z";
    setup(async () => res(OK), (s) => { for (const slug of ["nginx", "rust", "python", "grafana", "go"]) s.data.set(slug, { slug, d, bytes: 90 * 1024, used: 1 }); });
    setOptedIn(true);
    setInUseProbe(() => new Set(["nginx", "rust", "python", "grafana", "go"].map((s) => "logo-" + s)));
    expect(await ensureLogo("redis")).toBe("failed");
    expect(hasLogoIcon("logo-redis")).toBe(false);
  });

  it("restoreLogo is the draw-path entry and shares the same rules", async () => {
    setup(async () => res(OK)); setOptedIn(true);
    expect(await restoreLogo("redis")).toBe("ok");
    expect(hasLogoIcon("logo-redis")).toBe(true);
  });

  it("survives a storage that throws (logos still work for the session)", async () => {
    setup(async () => res(OK)); setOptedIn(true);
    store.all = async () => { throw new Error("no idb"); }; store.put = async () => { throw new Error("quota"); };
    expect(await ensureLogo("redis")).toBe("ok");
  });

  it("closeLogos leaves no in-flight work or state behind", async () => {
    setup(async () => res(OK)); setOptedIn(true);
    await ensureLogo("redis"); closeLogos();
    expect(logoCacheBytes()).toBe(0);
  });
});
