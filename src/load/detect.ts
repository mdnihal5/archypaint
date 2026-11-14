import type { Role } from "./types";

/**
 * Role detection from what the user drew: a logo / icon id, a shape kind, or (for plain boxes) the label.
 * Table-driven: first matching rule wins, so order matters (specific before generic: "elasticache" must be
 * seen before anything containing "elastic"). Matching is case-insensitive and substring-based on the icon id, with
 * word-boundary rules for short ids ("alb", "ios", "lb") that would otherwise match inside other words.
 * `null` means "no opinion": the graph builder then treats a node that participates in the traffic as a plain service.
 */
const ICON_RULES: readonly (readonly [Role, RegExp])[] = [
  // cache first: "elasticache", "memorystore", "azure-cache-redis" must not fall through to db / search
  ["cache", /redis|valkey|memcache|elasticache|memorystore|cache|cdn|cloudfront|fastly|akamai|bunny/],
  ["queue", /kafka|rabbitmq|pulsar|nats|activemq|(^|[^a-z])sqs|sns|eventbridge|kinesis|(^|[^a-z])msk|pubsub|cloud-tasks|celery|mqtt|service-bus|event-hubs|event-grid|message-queue|dead-letter|queue/],
  // lb before limiter: "application-gateway" / "gateway-lb" are balancers, "api-gateway" is not
  ["lb", /nginx|haproxy|envoy|traefik|load-?balanc|gateway-lb|application-gateway|front-door|reverse-proxy|(^|[^a-z])(elb|alb|nlb|lb)([^a-z]|$)/],
  ["limiter", /kong|api-?gateway|apigee|api-management|rate-?limit/],
  ["db", /postgres|mysql|mariadb|mongo|cassandra|scylla|dynamo|cockroach|sqlite|oracle|yugabyte|tidb|planetscale|neon|supabase|duckdb|aurora|(^|[^a-z])rds|cloud-sql|spanner|couch|firestore|firebase|etcd|hbase|bigtable|neo4j|arango|neptune|influx|timescale|timestream|elasticsearch|opensearch|open-search|solr|meilisearch|clickhouse|druid|snowflake|bigquery|redshift|memorydb|documentdb|cosmos|alloydb|sql-database|nosql|wide-column|key-value|graph-db|time-series|primary-db|read-replica|database|(^|[^a-z])db([^a-z]|$)/],
  ["entry", /client|user|browser|mobile|android|(^|[^a-z])ios([^a-z]|$)|chrome|firefox|safari|microsoft-edge|desktop-app|iot-device|consumer/],
];

/** plain-box labels: the same vocabulary, but entry only when the WHOLE label is a client word ("User Service" is a service) */
const TEXT_ROLES: readonly (readonly [Role, RegExp])[] = [
  ["cache", /\b(redis|valkey|memcached?|cache|cdn)\b/],
  ["queue", /\b(kafka|rabbitmq|sqs|pulsar|nats|queue|broker)\b/],
  ["lb", /\b(load balancer|lb|nginx|haproxy|envoy|traefik|elb|alb)\b/],
  ["limiter", /\b(rate limiter|api gateway|gateway|kong)\b/],
  ["db", /\b(db|database|postgres(ql)?|mysql|mariadb|mongo(db)?|cassandra|dynamodb|cockroach(db)?|sqlite|oracle)\b/],
];
const ENTRY_TEXT = /^(clients?|users?|browsers?|mobile( app)?|web app|customers?|traffic|end users?)$/;

export function detectRole(e: { kind: string; iconId: string; text: string }): Role | null {
  if (e.kind === "arrow") return null;
  const id = e.iconId ? e.iconId.toLowerCase() : "";
  if (id) for (const [role, re] of ICON_RULES) if (re.test(id)) return role;
  if (e.kind === "cylinder") return "db";
  if (!id && e.text) {
    const t = e.text.toLowerCase().trim();
    for (const [role, re] of TEXT_ROLES) if (re.test(t)) return role;
    if (ENTRY_TEXT.test(t)) return "entry";
  }
  return null;
}
