import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./theme";
import { logoUrl, LOGOS, SI_VERSION } from "./logos-catalog";
import { OPT_IN_KEY } from "./logos";

// node built-ins via a computed specifier: the project has no @types/node (same approach as ui/contrast.test.ts)
const { readFileSync } = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(p: URL, enc: string): string };
const { gzipSync } = (await import(/* @vite-ignore */ "node:" + "zlib")) as { gzipSync(s: string): { length: number } };

describe("logo catalog", () => {
  it("has unique, well-formed rows for ~100 technologies", () => {
    expect(LOGOS.length).toBeGreaterThanOrEqual(100);
    const slugs = new Set<string>();
    for (const l of LOGOS) {
      expect(l.slug).toMatch(/^[a-z0-9]{1,40}$/);
      expect(slugs.has(l.slug)).toBe(false); slugs.add(l.slug);
      expect(l.name.trim().length).toBeGreaterThan(0);
      expect(l.hex).toMatch(/^[0-9a-f]{6}$/);
      expect((CATEGORIES as readonly string[]).includes(l.category)).toBe(true);
      for (const a of l.aliases) expect(a).toBe(a.trim());
    }
  });

  it("covers the technologies that recur in system-design breakdowns", () => {
    const have = new Set(LOGOS.map((l) => l.slug));
    for (const s of ["apachekafka", "redis", "postgresql", "mysql", "mongodb", "apachecassandra", "scylladb", "clickhouse", "elasticsearch", "rabbitmq", "nginx", "kubernetes", "prometheus", "grafana", "apacheflink", "apachespark", "go", "rust", "python", "react", "cloudflare", "terraform", "stripe", "docker", "linux", "apple", "macos"]) expect(have.has(s), s).toBe(true);
  });

  it("flags exactly the brands with stricter policies as restricted", () => {
    const restricted = LOGOS.filter((l) => l.restricted).map((l) => l.slug).sort();
    expect(restricted).toEqual(["apple", "docker", "linux", "linuxfoundation", "macos", "mongodb"]);
  });

  it("never lists marks that are not in Simple Icons (our own drawings cover those)", () => {
    const have = new Set(LOGOS.map((l) => l.slug));
    for (const s of ["aws", "amazonaws", "azure", "windows", "memcached", "dynamodb", "haproxy", "grpc", "twilio"]) expect(have.has(s), s).toBe(false);
  });

  it("uses one pinned, immutable URL shape", () => {
    expect(SI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(logoUrl("redis")).toBe(`https://cdn.jsdelivr.net/npm/simple-icons@${SI_VERSION}/icons/redis.svg`);
  });

  it("is compact: under 6 KB gzipped, so the lazy chunk stays tiny", () => {
    const src = readFileSync(new URL("./logos-catalog.ts", import.meta.url), "utf8");
    expect(gzipSync(src).length).toBeLessThan(6 * 1024);
  });

  it("uses the same opt-in storage keys as the palette (which cannot import this chunk)", () => {
    const pal = readFileSync(new URL("./palette.ts", import.meta.url), "utf8");
    expect(pal).toContain(`"${OPT_IN_KEY}"`); // the only flag the palette reads itself; the rest lives in the lazy palette-logos chunk
  });
});
