/**
 * The shipped logo packs, checked as data: what was built by icons/scripts/build-logos.mjs from icons/logos/catalog.mjs.
 * (These read the committed JSON, so a hand edit or a stale build fails here.)
 */
import { describe, expect, it } from "vitest";
import { parseIconMarkup, ROOT_STROKE, type IndexJson, type PackJson } from "./icon-pack";
import { buildIndex, search, type Hit } from "./icon-search";
import { ICON_ALIASES } from "./logos";
import { CATEGORIES, DARK, LIGHT } from "./theme";
import { PATH_CHARS } from "./user-packs";

// node built-ins without @types/node (same trick as ui/contrast.test.ts)
const { readFileSync } = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(p: URL, enc: string): string };
const { gzipSync } = (await import(/* @vite-ignore */ "node:" + "zlib")) as { gzipSync(d: string): { length: number } };
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const logosIndex = JSON.parse(read("./packs/logos-index.json")) as IndexJson;
const drawnIndex = JSON.parse(read("./packs/index.json")) as IndexJson;
const manifest = JSON.parse(read("../icons/logos/manifest.json")) as { id: string; name: string; source: string; licence: string; upstream: string; colour: string; key: string }[];
const pkgJson = JSON.parse(read("../package.json")) as { devDependencies: Record<string, string> };
const packs = new Map<string, PackJson>(logosIndex.groups!.map(([k]) => [k, JSON.parse(read(`./packs/${k}.json`)) as PackJson]));
const markupOf = new Map<string, string>(); for (const p of packs.values()) for (const [id, , m] of p.icons) markupOf.set(id, m);

const lin = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h: string): number => 0.2126 * lin(parseInt(h.slice(1, 3), 16)) + 0.7152 * lin(parseInt(h.slice(3, 5), 16)) + 0.0722 * lin(parseInt(h.slice(5, 7), 16));
const contrast = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** every logo id the previous (opt-in, fetched) catalog offered: saved diagrams may reference all of them */
const OLD_LOGO_SLUGS = `googlebigquery apachecassandra clickhouse cockroachlabs couchbase databricks apachedruid elasticsearch firebase apachehadoop apachehbase apachehive influxdb mariadb mongodb mysql neo4j opensearch postgresql scylladb snowflake sqlite supabase redis akamai apache cloudflare envoyproxy fastly graphql istio kong netlify nginx traefikproxy vercel apacheairflow ansible argo debian django docker elixir erlang fastapi apacheflink github githubactions gitlab go helm openjdk javascript jenkins kotlin kubernetes linux nodedotjs nomad php python pytorch redhat ruby rust scala apachespark spring springboot swift tensorflow terraform trino typescript ubuntu apachekafka natsdotio apachepulsar rabbitmq auth0 consul etcd keycloak letsencrypt okta vault android angular apple googlechrome firefox ios macos nextdotjs react safari svelte vuedotjs datadog grafana jaeger kibana linuxfoundation logstash newrelic opentelemetry pagerduty prometheus sentry splunk stripe`.split(" ");

describe("catalog shape", () => {
  it("has a few hundred logos in a couple of dozen categories, every one with a name, aliases and a valid colour category", () => {
    expect(logosIndex.icons.length).toBeGreaterThanOrEqual(150);
    expect(logosIndex.icons.length).toBeLessThanOrEqual(300);
    expect(packs.size).toBeGreaterThanOrEqual(15);
    const ids = new Set<string>();
    for (const [id, name, aliases, category, pack, vendor] of logosIndex.icons) {
      expect(id, id).toMatch(/^logo-[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ids.has(id), `duplicate ${id}`).toBe(false); ids.add(id);
      expect(name.trim(), id).not.toBe("");
      expect(Array.isArray(aliases) && aliases.every((a) => typeof a === "string" && a === a.trim() && a !== ""), id).toBe(true);
      expect((CATEGORIES as readonly string[]).includes(category), `${id}: ${category}`).toBe(true);
      expect(packs.has(pack), `${id}: pack ${pack}`).toBe(true);
      expect(vendor).toBe("logo");
      expect(markupOf.has(id), `${id} has artwork`).toBe(true);
    }
    expect(markupOf.size).toBe(ids.size); // no orphan artwork
    for (const [k, label] of logosIndex.groups!) {
      expect(label.length).toBeGreaterThan(3);
      expect(logosIndex.icons.filter((r) => r[4] === k).length, `${k} is not empty`).toBeGreaterThanOrEqual(3);
    }
  });
  it("never reuses an id of a drawn icon, and every drawn icon a logo hides exists", () => {
    const drawn = new Set(drawnIndex.icons.map((r) => r[0]));
    for (const [id] of logosIndex.icons) expect(drawn.has(id), id).toBe(false);
    for (const h of logosIndex.hides!) expect(drawn.has(h), `hides ${h}`).toBe(true);
    expect(logosIndex.hides!.length).toBeGreaterThan(50);
  });
  it("covers the technologies system-design diagrams are made of", () => {
    const have = new Set(logosIndex.icons.map((r) => r[0]));
    const must = `postgresql mysql mongodb redis memcached apachecassandra neo4j influxdb elasticsearch snowflake clickhouse apachekafka rabbitmq natsdotio cloudflare akamai fastly nginx envoyproxy kong istio docker kubernetes terraform aws aws-s3 aws-lambda aws-dynamodb aws-ec2 aws-sqs aws-cloudfront microsoft-azure googlecloud gcp-bigtable gcp-pubsub prometheus grafana datadog auth0 okta vault github githubactions jenkins googlechrome android ios react go python stripe twilio slack`.split(" ");
    for (const m of must) expect(have.has(`logo-${m}`), m).toBe(true);
  });
  it("keeps every id the previous opt-in logos used (or maps it)", () => {
    const have = new Set(logosIndex.icons.map((r) => r[0]));
    for (const s of OLD_LOGO_SLUGS) {
      const id = `logo-${s}`;
      expect(have.has(id) || have.has(ICON_ALIASES[id] ?? ""), `${id} would no longer render`).toBe(true);
    }
    for (const to of Object.values(ICON_ALIASES)) expect(have.has(to), to).toBe(true);
  });
});

describe("artwork", () => {
  it("every logo parses with the renderer's own parser: filled paths only, literal brand colours, 24 grid, bounded size", () => {
    for (const [id, , m] of [...packs.values()].flatMap((p) => p.icons)) {
      expect(m.length, id).toBeLessThanOrEqual(12_000);
      const ops = parseIconMarkup(m, ROOT_STROKE.glyph);
      expect(ops.length, id).toBeGreaterThan(0);
      expect(ops.length, id).toBeLessThanOrEqual(40);
      for (const o of ops) {
        expect(o.c, `${id} brand colour`).toMatch(/^#[0-9a-f]{6}$/);
        expect(o.fill && !o.stroke, id).toBe(true);
        expect(PATH_CHARS.test(o.d), `${id} path chars`).toBe(true);
        expect(o.d, id).not.toMatch(/NaN|undefined|Infinity/);
        for (const v of [o.cd, o.cl]) expect(v === "" || /^#[0-9a-f]{6}$/.test(v), id).toBe(true);
      }
      expect(m, id).not.toMatch(/<(g|svg|script|style|image|use|text)\b|url\(|href|\son(?!\w*=)\w+=/i);
    }
  });
  it("a single-colour logo stays visible on BOTH themes, with the build's replacement colours applied", () => {
    for (const [id, , m] of [...packs.values()].flatMap((p) => p.icons)) {
      const ops = parseIconMarkup(m, ROOT_STROKE.glyph);
      if (new Set(ops.map((o) => o.c)).size !== 1) continue;
      const o = ops[0]!;
      expect(contrast(o.cd || o.c, DARK.paper), `${id} on dark`).toBeGreaterThanOrEqual(2);
      expect(contrast(o.cl || o.c, LIGHT.paper), `${id} on light`).toBeGreaterThanOrEqual(1.4);
    }
  });
});

describe("provenance", () => {
  it("records source, licence and upstream for every logo", () => {
    expect(manifest.map((r) => r.id).sort()).toEqual(logosIndex.icons.map((r) => r[0]).sort());
    for (const r of manifest) {
      expect(["CC0-1.0", "Apache-2.0"], r.id).toContain(r.licence);
      expect(r.source, r.id).toMatch(/^(simple-icons|@iconify-json\/(logos|gcp))@\d+\.\d+\.\d+$/);
      expect(r.upstream, r.id).toMatch(/^https:\/\//);
    }
  });
  it("pins the artwork packages to the exact versions the manifest names (reproducible builds)", () => {
    for (const r of manifest) {
      const [name, version] = [r.source.slice(0, r.source.lastIndexOf("@")), r.source.slice(r.source.lastIndexOf("@") + 1)];
      expect(pkgJson.devDependencies[name], name).toBe(version);
    }
  });
});

describe("size budget", () => {
  it("every logo pack, as the app ships it (a JSON string inside a JS chunk), stays well inside the 30 KB gzip lazy-chunk budget", () => {
    for (const [k] of logosIndex.groups!) expect(gzipSync(read(`./packs/${k}.json`)).length / 1024, k).toBeLessThan(26);
    expect(gzipSync(read("./packs/logos-index.json")).length / 1024).toBeLessThan(26);
  });
});

describe("searching the logos", () => {
  const index = buildIndex(logosIndex.icons.map(([id, name, aliases, category, pack, vendor]) => ({ id, name, aliases, category, pack, vendor })), []);
  const top = (q: string, n = 3): string[] => { const out: Hit[] = []; search(index, q, null, out, n); return out.map((h) => h.e.name); };
  it("finds a technology by its common names and abbreviations", () => {
    expect(top("postgres")[0]).toBe("PostgreSQL");
    expect(top("pg")[0]).toBe("PostgreSQL");
    expect(top("k8s")[0]).toBe("Kubernetes");
    expect(top("mongo")[0]).toBe("MongoDB");
    expect(top("redis")[0]).toBe("Redis");
    expect(top("s3")[0]).toBe("Amazon S3");
    expect(top("kafka")[0]).toBe("Kafka");
    expect(top("gke")[0]).toBe("Google Kubernetes Engine");
    expect(top("lambda")[0]).toBe("AWS Lambda");
    expect(top("cdn", 10)).toContain("Cloudflare");
    expect(top("aws")[0]).toBe("AWS");
    expect(top("gcp")[0]).toBe("GCP");
    expect(top("vue")[0]).toBe("Vue.js");
    expect(top("node")[0]).toBe("Node.js");
  });
  it("a category word lists that category's logos (queue -> messaging, warehouse -> OLAP)", () => {
    expect(top("sqs")).toContain("Amazon SQS");
    expect(top("warehouse", 10)).toEqual(expect.arrayContaining(["Snowflake", "BigQuery"]));
    expect(top("time series", 10)).toContain("InfluxDB");
  });
});
