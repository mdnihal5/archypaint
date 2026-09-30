import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorAPI } from "./editor-api";
import { parseArch } from "./io/format";
import { Scene } from "./scene";
import { Viewport } from "./viewport";
import {
  COMPRESSED_MAX, copyShareLink, decodeShareHash, documentText, encodeShareHash, fromBase64Url, inflateBytes, INFLATED_MAX, LINK_MAX, openSharedFromHash, toBase64Url,
} from "./share";

/** deflate arbitrary bytes with the platform codec (no Node-only imports: the project has no @types/node) */
const deflateBytes = async (b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
const randomText = (n: number): string => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536))); return toBase64Url(b); };

const sceneWith = (n: number) => { const s = new Scene(); for (let i = 0; i < n; i++) s.add({ kind: "rect", x: i * 10, y: i, text: `node ${i}` }); return s; };
const docOf = (n: number) => documentText({ scene: sceneWith(n), vp: new Viewport() } as unknown as EditorAPI, "demo");

describe("base64url", () => {
  it("round-trips every length 0..70 and all byte values, without padding or url-unsafe characters", () => {
    for (let len = 0; len <= 70; len++) {
      const b = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 251) & 255);
      const s = toBase64Url(b);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(s)).toEqual(b);
    }
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64Url(toBase64Url(all))).toEqual(all);
  });
  it("large inputs do not blow the argument limit of String.fromCharCode", () => {
    const b = new Uint8Array(300_000).map((_, i) => i & 255);
    expect(fromBase64Url(toBase64Url(b))).toEqual(b);
  });
  it("rejects bad characters, padding, standard-alphabet characters and impossible lengths", () => {
    for (const bad of ["ab!d", "abc=", "a+b/", "ab cd", "abcde", "a", "é"]) expect(fromBase64Url(bad)).toBeNull();
    expect(fromBase64Url("")).toEqual(new Uint8Array(0));
  });
});

describe("codec", () => {
  it("a document survives encode -> decode -> parse unchanged", async () => {
    const text = docOf(40);
    const enc = await encodeShareHash(text);
    if (!enc.ok) throw new Error(enc.message);
    expect(enc.hash.startsWith("#d=")).toBe(true);
    expect(enc.hash.length).toBeLessThan(text.length); // it actually compresses
    const dec = await decodeShareHash(enc.hash);
    expect(dec).toEqual({ ok: true, text });
    const p = parseArch(text);
    expect(p.ok && p.value.scene.els.length).toBe(40);
  });
  it("unicode text round-trips", async () => {
    const s = new Scene(); s.add({ kind: "text", text: "données · 日本語 · 🚀" });
    const text = documentText({ scene: s, vp: new Viewport() } as unknown as EditorAPI, "é");
    const dec = await decodeShareHash((await encodeShareHash(text) as { hash: string }).hash);
    expect(dec).toEqual({ ok: true, text });
  });
  it("refuses a link over the limit with a message that points to saving a file", async () => {
    const big = randomText(100_000); // incompressible
    const r = await encodeShareHash(big);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/file/i);
    expect(LINK_MAX).toBe(60_000);
  });
});

describe("decodeShareHash on hostile input", () => {
  const dec = (h: string) => decodeShareHash(h);
  it("not a share link / empty / garbage", async () => {
    expect((await dec("")).ok).toBe(false);
    expect((await dec("#x=abc")).ok).toBe(false);
    expect((await dec("#d=")).ok).toBe(false);
    expect((await dec("#d=!!!!")).ok).toBe(false);
    expect((await dec("#d=abcde")).ok).toBe(false);
  });
  it("valid base64 that is not deflate data", async () => {
    const r = await dec("#d=" + toBase64Url(new TextEncoder().encode("hello, this is not compressed data at all")));
    expect(r.ok).toBe(false);
  });
  it("truncated stream", async () => {
    const enc = await encodeShareHash(docOf(30));
    if (!enc.ok) throw new Error("setup");
    const cut = enc.hash.slice(0, Math.floor(enc.hash.length * 0.6));
    const r = await dec(cut);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/damaged|incomplete/);
  });
  it("a zip bomb (tiny compressed, huge inflated) is stopped at the output cap, not after inflating it all", async () => {
    const bomb = await deflateBytes(new Uint8Array(40 * 1024 * 1024).fill(0x20)); // 40 MB of spaces -> a few KB
    expect(bomb.length).toBeLessThan(100_000);
    const t0 = performance.now();
    const r = await dec("#d=" + toBase64Url(bomb));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/more data/);
    expect(performance.now() - t0).toBeLessThan(5000);
    const direct = await inflateBytes(bomb, INFLATED_MAX);
    expect(direct).toEqual({ ok: false, reason: "too_large" });
  });
  it("an oversized fragment is rejected before any decoding", async () => {
    const r = await dec("#d=" + "A".repeat(COMPRESSED_MAX * 2));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/too large/);
  });
  it("valid deflate of invalid UTF-8 is 'damaged', not a crash", async () => {
    const r = await dec("#d=" + toBase64Url(await deflateBytes(Uint8Array.from([0xff, 0xfe, 0xfd, 0x80]))));
    expect(r.ok).toBe(false);
  });
});

const fake = () => {
  const scene = new Scene();
  let ro = false, saved = false, zoomed = 0;
  const editor = { scene, vp: new Viewport(),
    load: vi.fn((d) => scene.replaceAll(d)), zoomToFit: () => { zoomed++; }, markSaved: () => { saved = true; },
    setReadOnly: vi.fn((v: boolean) => { ro = v; }), get readOnly() { return ro; } } as unknown as EditorAPI;
  const io = { setDocName: vi.fn(), adoptCurrent: vi.fn(), docName: () => "demo" };
  const toast = vi.fn();
  return { editor, io, toast, stage: null as unknown as HTMLElement, state: () => ({ ro, saved, zoomed }) };
};

describe("openSharedFromHash", () => {
  it("loads the diagram read-only and never touches autosave", async () => {
    const f = fake();
    const enc = await encodeShareHash(docOf(5));
    if (!enc.ok) throw new Error("setup");
    vi.doMock("./ui/present-ui", () => ({ mountSharedBar: vi.fn() }));
    const ok = await openSharedFromHash(f as never, enc.hash);
    expect(ok).toBe(true);
    expect(f.editor.scene.els.size).toBe(5);
    expect(f.state()).toEqual({ ro: true, saved: true, zoomed: 1 });
    expect(f.io.adoptCurrent).not.toHaveBeenCalled(); // the shared document did not become the user's sheet
    expect(f.io.setDocName).toHaveBeenCalledWith("demo");
    expect(f.toast).not.toHaveBeenCalled();
  });
  it("a damaged link toasts a friendly error and returns false so the caller can restore normally", async () => {
    const f = fake();
    expect(await openSharedFromHash(f as never, "#d=AAAA")).toBe(false);
    expect(f.toast).toHaveBeenCalledWith(expect.stringMatching(/damaged|incomplete/), "err");
    expect(f.editor.scene.els.size).toBe(0);
    expect(f.state().ro).toBe(false);
  });
  it("a well-formed envelope around something that is not an archypaint document is refused", async () => {
    const f = fake();
    const enc = await encodeShareHash(JSON.stringify({ hello: "world" }));
    if (!enc.ok) throw new Error("setup");
    expect(await openSharedFromHash(f as never, enc.hash)).toBe(false);
    expect(f.toast).toHaveBeenCalledWith(expect.stringMatching(/isn't a valid archypaint/), "err");
  });
  it("a hostile document (NaN-ish coordinates, absurd sizes) is rejected by the format validator", async () => {
    const f = fake();
    const good = JSON.parse(docOf(1));
    good.scene.els[0].x = 1e300;
    const enc = await encodeShareHash(JSON.stringify(good));
    if (!enc.ok) throw new Error("setup");
    expect(await openSharedFromHash(f as never, enc.hash)).toBe(false);
    expect(f.editor.scene.els.size).toBe(0);
  });
});


describe("copyShareLink", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock("./ui/present-ui"); });
  const ctxOf = (n: number) => { const editor = { scene: sceneWith(n), vp: new Viewport() } as unknown as EditorAPI; const toast = vi.fn(); return { c: { editor, io: { docName: () => "demo" }, toast, confirm: async () => true, stage: null as unknown as HTMLElement }, toast }; };

  it("copies origin + path + #d=… and says nothing is uploaded", async () => {
    const writeText = vi.fn(async (_t: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } }); vi.stubGlobal("location", { origin: "https://x.test", pathname: "/app/" });
    const { c, toast } = ctxOf(6);
    await copyShareLink(c as never);
    const url = writeText.mock.calls[0]![0] as string;
    expect(url.startsWith("https://x.test/app/#d=")).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/copied.*nothing is uploaded/i));
    const back = await decodeShareHash(url.slice(url.indexOf("#")));
    expect(back.ok && parseArch(back.text).ok).toBe(true);
  });
  it("when the clipboard is blocked the link is shown in a box instead of being lost", async () => {
    const showLinkBox = vi.fn();
    vi.doMock("./ui/present-ui", () => ({ showLinkBox }));
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } }); vi.stubGlobal("location", { origin: "https://x.test", pathname: "/" });
    const { c, toast } = ctxOf(3);
    await copyShareLink(c as never);
    expect(showLinkBox).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/x\.test\/#d=/));
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), "err");
  });
  it("an empty diagram has nothing to share", async () => {
    vi.stubGlobal("location", { origin: "https://x.test", pathname: "/" });
    const { c, toast } = ctxOf(0);
    await copyShareLink(c as never);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/nothing to share/i), "err");
  });
});
