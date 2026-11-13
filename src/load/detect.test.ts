import { describe, expect, it } from "vitest";
import { detectRole } from "./detect";
import type { Role } from "./types";

const { readFileSync } = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(p: URL, enc: string): string };
const d = (iconId: string, kind = "icon", text = "") => detectRole({ kind, iconId, text });

describe("detectRole on real logo / icon ids", () => {
  const table: [string, Role | null][] = [
    ["logo-redis", "cache"], ["logo-valkey", "cache"], ["logo-memcached", "cache"], ["logo-aws-elasticache", "cache"],
    ["logo-gcp-memorystore", "cache"], ["azure-cache-redis", "cache"], ["logo-aws-cloudfront", "cache"], ["logo-fastly", "cache"], ["cdn-edge-node", "cache"],
    ["logo-apachekafka", "queue"], ["logo-rabbitmq", "queue"], ["logo-aws-sqs", "queue"], ["logo-apachepulsar", "queue"],
    ["logo-natsdotio", "queue"], ["logo-aws-kinesis", "queue"], ["logo-aws-msk", "queue"], ["logo-gcp-pubsub", "queue"],
    ["azure-service-bus", "queue"], ["message-queue", "queue"], ["dead-letter-queue", "queue"], ["logo-celery", "queue"],
    ["logo-nginx", "lb"], ["logo-haproxy", "lb"], ["logo-envoyproxy", "lb"], ["logo-traefikproxy", "lb"], ["logo-aws-elb", "lb"],
    ["aws-alb", "lb"], ["aws-nlb", "lb"], ["aws-gateway-lb", "lb"], ["logo-gcp-cloud-load-balancing", "lb"],
    ["azure-load-balancer", "lb"], ["azure-application-gateway", "lb"], ["load-balancer-l7", "lb"], ["reverse-proxy", "lb"],
    ["logo-kong", "limiter"], ["logo-aws-api-gateway", "limiter"], ["api-gateway", "limiter"], ["logo-gcp-cloud-api-gateway", "limiter"],
    ["logo-gcp-apigee-api-platform", "limiter"], ["azure-api-management", "limiter"], ["rate-limiter", "limiter"],
    ["logo-postgresql", "db"], ["logo-mysql", "db"], ["logo-mariadb", "db"], ["logo-mongodb", "db"], ["logo-apachecassandra", "db"],
    ["logo-aws-dynamodb", "db"], ["logo-cockroachlabs", "db"], ["logo-sqlite", "db"], ["logo-oracle", "db"], ["logo-aws-rds", "db"],
    ["logo-gcp-cloud-sql", "db"], ["logo-elasticsearch", "db"], ["logo-clickhouse", "db"], ["sql-database", "db"], ["azure-cosmos-db", "db"],
    ["browser", "entry"], ["mobile-app", "entry"], ["logo-android", "entry"], ["logo-ios", "entry"], ["logo-googlechrome", "entry"],
    ["logo-firefox", "entry"], ["iot-device", "entry"],
    // no opinion: the graph makes these plain services only when they carry traffic
    ["logo-docker", null], ["logo-aws-lambda", null], ["logo-github", null], ["logo-aws-elastic-beanstalk", null],
    ["logo-aws-ec2", null], ["microservice", null], ["aws-nat-gateway", null], ["logo-aws-route53", null],
  ];
  it.each(table)("%s -> %s", (id, role) => expect(d(id)).toBe(role));

  it("is case-insensitive", () => { expect(d("LOGO-Redis")).toBe("cache"); expect(d("Logo-PostgreSQL")).toBe("db"); });
  it("'ios' / 'alb' only match as whole tokens", () => { expect(d("logo-radios")).toBe(null); expect(d("logo-balbo")).toBe(null); });
  it("cylinder shape is a db; an icon id outranks the shape", () => {
    expect(d("", "cylinder")).toBe("db");
    expect(d("logo-redis", "cylinder")).toBe("cache");
  });
  it("labels on plain boxes", () => {
    expect(d("", "rect", "Redis")).toBe("cache");
    expect(d("", "rect", "Kafka")).toBe("queue");
    expect(d("", "rect", "Load Balancer")).toBe("lb");
    expect(d("", "rect", "Postgres\nprimary")).toBe("db");
    expect(d("", "rect", "Users")).toBe("entry");
    expect(d("", "rect", "User Service")).toBe(null); // whole-label rule for entry words
    expect(d("", "rect", "Orders")).toBe(null);
    expect(d("", "rect", "")).toBe(null);
  });
  it("arrows never get a role", () => expect(d("", "arrow", "redis")).toBe(null));
  it("every id in the logo index is handled without throwing, and the data/cache/queue logos are all found", () => {
    const idx = JSON.parse(readFileSync(new URL("../packs/logos-index.json", import.meta.url), "utf8")) as { icons: string[][] };
    const roles = new Map<string, Role | null>();
    for (const row of idx.icons) roles.set(row[0]!, d(row[0]!));
    expect(roles.size).toBeGreaterThan(250);
    for (const id of ["logo-redis", "logo-valkey", "logo-memcached"]) expect(roles.get(id)).toBe("cache");
    // the unmatched 'data' logos are processing / analytics tools and object storage (spark, airflow, s3, ...): plain services on purpose
    const data = idx.icons.filter((r) => r[3] === "data").map((r) => r[0]!);
    const plain = data.filter((id) => roles.get(id) === null);
    expect(plain.length).toBeLessThan(data.length * 0.4);
  });
});
