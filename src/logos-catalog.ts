/**
 * Official-logo catalog: WHICH technologies can be fetched as logos. No logo files live in this repo or bundle.
 *
 * Each row was checked against simple-icons@16.33.0 (data/simple-icons.json for the title and brand colour, and a real
 * request to the pinned jsDelivr URL for the file). The SVG licence (CC0) is not the constraint; trademarks are, so:
 *   - nothing is downloaded until the user opts in (see logos.ts),
 *   - rows flagged `restricted` (MongoDB, Docker, Apple/macOS, Linux and its foundation) stay hidden until a second,
 *     explicit choice, because those owners' policies are stricter,
 *   - logos not in Simple Icons (AWS, Azure, Windows, Memcached, DynamoDB, HAProxy, gRPC, Twilio...) are NOT here;
 *     archypaint's own drawn icons cover them.
 * Loaded lazily (dynamic import): it costs nothing until the Logos source is used.
 */
export const SI_VERSION = "16.33.0";
export const logoUrl = (slug: string): string => `https://cdn.jsdelivr.net/npm/simple-icons@${SI_VERSION}/icons/${slug}.svg`;

export interface Logo {
  slug: string; name: string; aliases: readonly string[];
  /** same vocabulary as the icon categories */
  category: "data" | "cache" | "network" | "compute" | "queue" | "security" | "client" | "external";
  /** brand colour, lowercase hex without #. Informational: logos are drawn in the category colour */
  hex: string;
  restricted: boolean;
}

const CATS = ["data", "cache", "network", "compute", "queue", "security", "client", "external"] as const;

/** slug|name|aliases (comma separated)|category index|brand hex|1 when restricted */
const DATA = `googlebigquery|BigQuery|bq,warehouse|0|669df6|
apachecassandra|Cassandra|nosql,wide column|0|1287b1|
clickhouse|ClickHouse|olap,columnar|0|ffcc01|
cockroachlabs|CockroachDB|cockroach,distributed sql|0|6933ff|
couchbase|Couchbase|nosql|0|ea2328|
databricks|Databricks|lakehouse,spark|0|ff3621|
apachedruid|Druid|olap|0|29f1fb|
elasticsearch|Elasticsearch|elk,search,lucene|0|005571|
firebase|Firebase|firestore,baas|0|dd2c00|
apachehadoop|Hadoop|hdfs,mapreduce|0|66ccff|
apachehbase|HBase|wide column|0|be160c|
apachehive|Hive|sql on hadoop|0|fdee21|
influxdb|InfluxDB|influx,time series|0|22adf6|
mariadb|MariaDB|sql|0|003545|
mongodb|MongoDB|mongo,nosql,document|0|47a248|1
mysql|MySQL|sql|0|4479a1|
neo4j|Neo4j|graph|0|4581c3|
opensearch|OpenSearch|search|0|005eb8|
postgresql|PostgreSQL|postgres,pg,psql,sql|0|4169e1|
scylladb|ScyllaDB|scylla,nosql|0|6cd5e7|
snowflake|Snowflake|warehouse|0|29b5e8|
sqlite|SQLite|embedded,sql|0|003b57|
supabase|Supabase|baas,backend|0|3fcf8e|
redis|Redis|cache,in memory,keyvalue|1|ff4438|
akamai|Akamai|cdn,edge|2|0096d6|
apache|Apache HTTP Server|httpd,web server|2|d22128|
cloudflare|Cloudflare|cdn,dns,edge|2|f38020|
envoyproxy|Envoy|proxy,service mesh|2|ac6199|
fastly|Fastly|cdn,edge|2|ff282d|
graphql|GraphQL|gql,api|2|e10098|
istio|Istio|service mesh|2|466bb0|
kong|Kong|api gateway|2|003459|
netlify|Netlify|hosting|2|00c7b7|
nginx|NGINX|reverse proxy,web server,lb|2|009639|
traefikproxy|Traefik|proxy,ingress|2|24a1c1|
vercel|Vercel|edge,hosting|2|000000|
apacheairflow|Airflow|workflow,dag|3|017cee|
ansible|Ansible|automation,iac|3|ee0000|
argo|Argo CD|argocd,gitops,cd|3|ef7b4d|
debian|Debian|linux,os|3|a81d33|
django|Django|framework,web|3|092e20|
docker|Docker|container,containers|3|2496ed|1
elixir|Elixir|beam|3|4b275f|
erlang|Erlang|beam,otp|3|a90533|
fastapi|FastAPI|framework,web|3|009688|
apacheflink|Flink|stream processing|3|e6526f|
github|GitHub|git,vcs|3|181717|
githubactions|GitHub Actions|ci,cd|3|2088ff|
gitlab|GitLab|git,ci|3|fc6d26|
go|Go (Golang)|golang|3|00add8|
helm|Helm|k8s,charts|3|0f1689|
openjdk|Java (OpenJDK)|java,jvm|3|000000|
javascript|JavaScript|js|3|f7df1e|
jenkins|Jenkins|ci,cd,pipeline|3|d24939|
kotlin|Kotlin|jvm|3|7f52ff|
kubernetes|Kubernetes|k8s,orchestration|3|326ce5|
linux|Linux|tux,os|3|fcc624|1
nodedotjs|Node.js|node,nodejs,javascript|3|5fa04e|
nomad|Nomad|scheduler,hashicorp|3|00ca8e|
php|PHP||3|777bb4|
python|Python|py|3|3776ab|
pytorch|PyTorch|torch,ml|3|ee4c2c|
redhat|Red Hat|rhel,linux|3|ee0000|
ruby|Ruby|rails|3|cc342d|
rust|Rust|rustlang|3|000000|
scala|Scala|jvm|3|dc322f|
apachespark|Spark|batch,analytics|3|e25a1c|
spring|Spring|framework,jvm|3|000000|
springboot|Spring Boot|framework,jvm|3|6db33f|
swift|Swift|ios|3|f05138|
tensorflow|TensorFlow|tf,ml|3|ff6f00|
terraform|Terraform|iac,hashicorp|3|844fba|
trino|Trino|presto,sql|3|dd00a1|
typescript|TypeScript|ts|3|3178c6|
ubuntu|Ubuntu|linux,os|3|e95420|
apachekafka|Kafka|streaming,log,event|4|231f20|
natsdotio|NATS|messaging|4|27aae1|
apachepulsar|Pulsar|streaming|4|188fff|
rabbitmq|RabbitMQ|amqp,broker,mq|4|ff6600|
auth0|Auth0|auth,identity|5|eb5424|
consul|Consul|service discovery,hashicorp|5|f24c53|
etcd|etcd|kv,consensus|5|419eda|
keycloak|Keycloak|sso,identity|5|4d4d4d|
letsencrypt|Let's Encrypt|tls,certificates|5|003a70|
okta|Okta|sso,identity|5|007dc1|
vault|Vault|secrets,hashicorp|5|ffec6e|
android|Android|mobile|6|3ddc84|
angular|Angular|frontend|6|0f0f11|
apple|Apple||6|000000|1
googlechrome|Chrome|browser|6|4285f4|
firefox|Firefox|browser|6|ff7139|
ios|iOS|mobile,apple|6|000000|
macos|macOS|mac,apple,os|6|000000|1
nextdotjs|Next.js|react,ssr|6|000000|
react|React|frontend,ui|6|61dafb|
safari|Safari|browser|6|006cff|
svelte|Svelte|frontend|6|ff3e00|
vuedotjs|Vue.js|vue,frontend|6|4fc08d|
datadog|Datadog|apm,monitoring|7|632ca6|
grafana|Grafana|dashboards,monitoring|7|f46800|
jaeger|Jaeger|tracing|7|66cfe3|
kibana|Kibana|elk,dashboards|7|005571|
linuxfoundation|Linux Foundation|lf|7|003778|1
logstash|Logstash|elk,logs|7|005571|
newrelic|New Relic|apm,monitoring|7|1ce783|
opentelemetry|OpenTelemetry|otel,tracing|7|000000|
pagerduty|PagerDuty|oncall,alerts|7|06ac38|
prometheus|Prometheus|metrics,monitoring|7|e6522c|
sentry|Sentry|errors,apm|7|362d59|
splunk|Splunk|logs|7|000000|
stripe|Stripe|payments|7|635bff|`;

export const LOGOS: readonly Logo[] = DATA.split("\n").map((line) => {
  const [slug, name, aliases, cat, hex, r] = line.split("|") as [string, string, string, string, string, string | undefined];
  return { slug, name, aliases: aliases ? aliases.split(",") : [], category: CATS[Number(cat)]!, hex, restricted: r === "1" };
});
