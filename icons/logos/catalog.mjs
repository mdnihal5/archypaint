// The brand-logo catalog: WHICH technologies get a logo, how they are grouped, named and searched.
// Input to icons/scripts/build-logos.mjs, which reads the actual artwork from the pinned npm packages and writes src/packs/logos-*.json.
//
// Row grammar (one per line):  source | Name | aliases (comma separated) | drawn ids this logo replaces (comma separated, optional)
//   source = si:<slug>   Simple Icons 16.33.0     (CC0-1.0 artwork, one path per logo, official brand colour)
//          | lg:<key>    @iconify-json/logos      (gilbarbara/logos, CC0-1.0; multi-colour artwork, includes the AWS service icons)
//          | dv:<key>    @iconify-json/devicon  (devicon, MIT; coloured "original" marks)
//          | gcp:<key>   @iconify-json/gcp        (the official Google Cloud icon set, Apache-2.0)
// `key=slug` overrides the id suffix (used to take an lg: `-icon` mark, the symbol without the wordmark, under the plain brand id).
// The icon id is `logo-<slug>` (si: the Simple Icons slug, so ids of the old opt-in logos are unchanged; lg: the key; gcp: `gcp-<key>`).
// "drawn ids this logo replaces": archypaint's own drawn vendor icons (packs oss/aws/gcp/azure) that stop being listed in the palette
// once the real logo exists. They keep rendering in saved diagrams.
// Trademarks belong to their owners. Listing a brand here is nominative use: "this box is Redis".

/** group key -> [palette section label, default colour category] */
export const GROUPS = {
  relational: ["Relational databases", "data"],
  document: ["Document & key-value stores", "data"],
  widecolumn: ["Wide-column & graph databases", "data"],
  timeseries: ["Time-series & search", "data"],
  warehouse: ["Warehouses, OLAP & data processing", "data"],
  cache: ["Caches & in-memory", "cache"],
  messaging: ["Message queues & streaming", "queue"],
  edge: ["CDN, DNS & edge", "network"],
  proxy: ["Load balancers, proxies & gateways", "network"],
  compute: ["Containers, orchestration & serverless", "compute"],
  clouds: ["Cloud providers", "external"],
  storage: ["Object storage & files", "data"],
  observability: ["Observability & alerting", "external"],
  security: ["Auth, identity & secrets", "security"],
  cicd: ["CI/CD, source & infrastructure as code", "compute"],
  clients: ["Clients, browsers & operating systems", "client"],
  frontend: ["Frontend & mobile frameworks", "client"],
  languages: ["Languages & backend frameworks", "compute"],
  ai: ["AI, ML & notebooks", "compute"],
  thirdparty: ["Payments, messaging & other services", "external"],
};

export const ROWS = {
  relational: `lg:postgresql|PostgreSQL|postgres,pg,psql,sql|postgresql
lg:mysql-icon=mysql|MySQL|sql|mysql
lg:mariadb-icon=mariadb|MariaDB|sql|mariadb
si:sqlite|SQLite|embedded,sql|sqlite
lg:oracle|Oracle Database|oracle,oracledb,oracle db,sql
si:cockroachlabs|CockroachDB|cockroach,distributed sql|cockroachdb
lg:yugabyte-icon=yugabyte|YugabyteDB|yugabyte,distributed sql
si:tidb|TiDB|pingcap,distributed sql
si:planetscale|PlanetScale|vitess,mysql
si:neon|Neon|serverless postgresql,serverless database
si:supabase|Supabase|baas,backend,postgresql
si:duckdb|DuckDB|embedded,olap
lg:aws-aurora|Amazon Aurora|aws,aurora,rds,sql|aws-aurora
lg:aws-rds|Amazon RDS|aws,rds,sql,managed database|aws-rds
gcp:cloud-sql|Google Cloud SQL|gcp,cloud sql,sql|gcp-cloud-sql
gcp:cloud-spanner|Google Cloud Spanner|gcp,spanner,distributed sql|gcp-spanner`,

  document: `si:mongodb|MongoDB|mongo,nosql,document|mongodb
si:apachecouchdb|CouchDB|couch,nosql,document
si:couchbase|Couchbase|nosql,document,kv
dv:firebase|Firebase|firestore,baas,realtime database
gcp:firestore|Google Firestore|gcp,firestore,document,nosql|gcp-firestore
lg:aws-dynamodb|Amazon DynamoDB|aws,dynamodb,dynamo,nosql,key value|aws-dynamodb
si:etcd|etcd|kv,consensus,raft,coordination|etcd`,

  widecolumn: `si:apachecassandra|Cassandra|nosql,wide column,dynamo style|cassandra
si:scylladb|ScyllaDB|scylla,nosql,wide column|scylladb
si:apachehbase|HBase|wide column,hadoop
gcp:bigtable|Google Bigtable|gcp,bigtable,wide column,nosql|gcp-bigtable
si:neo4j|Neo4j|graph,cypher|neo4j
si:arangodb|ArangoDB|graph,multi model
lg:aws-neptune|Amazon Neptune|aws,neptune,graph|aws-neptune`,

  timeseries: `si:influxdb|InfluxDB|influx,time series,tsdb|influxdb
si:timescale|TimescaleDB|timescale,time series,tsdb,postgresql extension
lg:aws-timestream|Amazon Timestream|aws,timestream,time series|aws-timestream
lg:elasticsearch|Elasticsearch|elk,search,lucene,full text|elasticsearch
si:opensearch|OpenSearch|search,lucene,full text|opensearch
lg:aws-open-search|Amazon OpenSearch Service|aws,opensearch service,search|aws-opensearch-service
si:apachesolr|Solr|search,lucene,full text
si:meilisearch|Meilisearch|search,full text
si:algolia|Algolia|search,saas`,

  warehouse: `si:snowflake|Snowflake|warehouse,olap|snowflake
si:googlebigquery|BigQuery|bq,warehouse,olap,gcp|gcp-bigquery
lg:aws-redshift|Amazon Redshift|aws,redshift,warehouse,olap|aws-redshift
si:databricks|Databricks|lakehouse,spark,delta
si:clickhouse|ClickHouse|olap,columnar|clickhouse
si:apachedruid|Druid|olap,realtime analytics
si:trino|Trino|presto,sql,query engine|trino
si:apachehive|Hive|sql on hadoop
dv:hadoop=apachehadoop|Hadoop|hdfs,mapreduce
si:apachespark|Spark|batch,analytics,rdd|spark
si:apacheflink|Flink|stream processing,stateful|flink
lg:aws-athena|Amazon Athena|aws,athena,sql on s3|
lg:aws-glue|AWS Glue|aws,glue,etl|
gcp:dataflow|Google Dataflow|gcp,dataflow,beam,stream processing|gcp-dataflow
gcp:dataproc|Google Dataproc|gcp,dataproc,spark,hadoop|gcp-dataproc
lg:airflow-icon=apacheairflow|Airflow|workflow,dag,orchestrator|airflow
lg:dbt-icon=dbt|dbt|transform,analytics engineering
si:metabase|Metabase|bi,dashboards
si:apachesuperset|Superset|bi,dashboards`,

  cache: `lg:redis|Redis|cache,in memory,key value,kv|redis,memcached
lg:valkey-icon=valkey|Valkey|redis fork,cache,in memory
lg:memcached|Memcached|cache,in memory,memcache|memcached
lg:aws-elasticache|Amazon ElastiCache|aws,elasticache,redis,memcached|aws-elasticache
gcp:memorystore|Google Memorystore|gcp,memorystore,redis,cache|gcp-memorystore`,

  messaging: `si:apachekafka|Kafka|streaming,log,event,broker|kafka
si:rabbitmq|RabbitMQ|amqp,broker,mq|rabbitmq
si:apachepulsar|Pulsar|streaming,broker|pulsar
si:natsdotio|NATS|messaging,jetstream|nats
si:mqtt|MQTT|iot,publish subscribe
si:celery|Celery|task queue,python workers
lg:temporal-icon=temporal|Temporal|workflow,durable execution
lg:aws-sqs|Amazon SQS|aws,sqs,queue|
lg:aws-sns|Amazon SNS|aws,sns,pubsub,notifications|
lg:aws-eventbridge|Amazon EventBridge|aws,eventbridge,event bus|aws-eventbridge
lg:aws-kinesis|Amazon Kinesis|aws,kinesis,streaming|aws-kinesis-streams,aws-kinesis-firehose
lg:aws-msk|Amazon MSK|aws,msk,managed kafka|aws-msk
lg:aws-step-functions|AWS Step Functions|aws,step functions,workflow,state machine|aws-step-functions
gcp:pubsub|Google Pub/Sub|gcp,pubsub,pub sub,messaging|gcp-pubsub
gcp:cloud-tasks|Google Cloud Tasks|gcp,cloud tasks,task queue|gcp-cloud-tasks`,

  edge: `si:cloudflare|Cloudflare|cdn,dns,edge,waf|cloudflare
si:akamai|Akamai|cdn,edge
si:fastly|Fastly|cdn,edge,vcl
si:vercel|Vercel|edge,hosting,serverless|vercel
si:netlify|Netlify|hosting,jamstack
si:bunnydotnet|Bunny.net|bunny,cdn,edge
lg:aws-cloudfront|Amazon CloudFront|aws,cloudfront,cdn,edge|aws-cloudfront
lg:aws-route53|Amazon Route 53|aws,route53,route 53,dns|aws-route53
gcp:cloud-cdn|Google Cloud CDN|gcp,cloud cdn,cdn,edge|gcp-cloud-cdn
gcp:cloud-dns|Google Cloud DNS|gcp,cloud dns,dns|gcp-cloud-dns
si:cloudflareworkers|Cloudflare Workers|workers,edge functions,serverless
si:tailscale|Tailscale|vpn,mesh,wireguard
si:wireguard|WireGuard|vpn,tunnel
lg:aws-vpc|Amazon VPC|aws,vpc,virtual network,subnet|aws-vpc
gcp:virtual-private-cloud|Google VPC|gcp,vpc,virtual network|gcp-vpc`,

  proxy: `si:nginx|NGINX|reverse proxy,web server,lb,load balancer|nginx
dv:haproxy|HAProxy|proxy,load balancer,lb,tcp,l4,l7
si:envoyproxy|Envoy|proxy,service mesh,sidecar|envoy
si:traefikproxy|Traefik|proxy,ingress,load balancer|traefik
lg:kong-icon=kong|Kong|api gateway|kong-gateway
si:caddy|Caddy|web server,reverse proxy,https
si:apache|Apache HTTP Server|httpd,web server
si:istio|Istio|service mesh|istio
lg:linkerd|Linkerd|service mesh
si:graphql|GraphQL|gql,api
lg:grpc|gRPC|rpc,protobuf,http2
si:openapiinitiative|OpenAPI|swagger,api spec
lg:aws-elb|Elastic Load Balancing|aws,elb,alb,nlb,load balancer|aws-alb,aws-nlb,aws-gateway-lb
lg:aws-api-gateway|Amazon API Gateway|aws,api gateway,apigw|aws-api-gateway
gcp:cloud-load-balancing|Google Cloud Load Balancing|gcp,load balancer,glb|gcp-load-balancing
gcp:cloud-api-gateway|Google API Gateway|gcp,api gateway|gcp-api-gateway
gcp:apigee-api-platform|Apigee|gcp,api management,api gateway|gcp-apigee`,

  compute: `si:docker|Docker|container,containers,image|docker
si:kubernetes|Kubernetes|k8s,orchestration,cluster|kubernetes
si:helm|Helm|charts,kubernetes package manager
si:podman|Podman|container,daemonless
lg:openshift|Red Hat OpenShift|openshift,kubernetes,redhat
si:nomad|Nomad|scheduler,hashicorp
si:serverless|Serverless Framework|serverless,faas
lg:aws-ec2|Amazon EC2|aws,ec2,vm,virtual machine,instance|aws-ec2
lg:aws-lambda|AWS Lambda|aws,lambda,serverless,faas,function|aws-lambda
lg:aws-ecs|Amazon ECS|aws,ecs,containers|aws-ecs
lg:aws-eks|Amazon EKS|aws,eks,managed kubernetes|aws-eks
lg:aws-fargate|AWS Fargate|aws,fargate,serverless containers|aws-fargate
lg:aws-elastic-beanstalk|AWS Elastic Beanstalk|aws,beanstalk,paas|aws-elastic-beanstalk
gcp:compute-engine|Google Compute Engine|gcp,gce,vm,virtual machine|gcp-compute-engine
gcp:google-kubernetes-engine|Google Kubernetes Engine|gcp,gke,managed kubernetes|gcp-gke
gcp:cloud-run|Google Cloud Run|gcp,cloud run,serverless containers|gcp-cloud-run
gcp:cloud-functions|Google Cloud Functions|gcp,cloud functions,serverless,faas|gcp-cloud-functions
gcp:app-engine|Google App Engine|gcp,app engine,paas|gcp-app-engine`,

  clouds: `lg:aws|AWS|amazon web services,amazon,cloud
lg:google-cloud=googlecloud|GCP|google cloud,google cloud platform,cloud
lg:microsoft-azure|Microsoft Azure|azure,microsoft,cloud
si:digitalocean|DigitalOcean|do,droplet,cloud
lg:heroku-icon=heroku|Heroku|paas,dyno
lg:ibm|IBM Cloud|ibm,cloud
si:alibabacloud|Alibaba Cloud|aliyun,alibaba,cloud
lg:linode|Linode|akamai connected cloud,vps,cloud
lg:vultr-icon=vultr|Vultr|vps,cloud
si:hetzner|Hetzner|vps,bare metal,cloud
si:flydotio|Fly.io|fly,edge,paas
si:render|Render|paas,hosting
si:railway|Railway|paas,hosting`,

  storage: `lg:aws-s3|Amazon S3|aws,s3,object storage,bucket,blob|aws-s3
gcp:cloud-storage|Google Cloud Storage|gcp,gcs,object storage,bucket,blob|gcp-cloud-storage
lg:aws-glacier|Amazon S3 Glacier|aws,glacier,cold storage,archive|aws-glacier
si:minio|MinIO|object storage,s3 compatible|minio
si:ceph|Ceph|object storage,block,distributed storage
si:backblaze|Backblaze|b2,object storage,backup
si:wasabi|Wasabi|object storage,s3 compatible
lg:cloudinary-icon=cloudinary|Cloudinary|images,media,cdn`,

  observability: `si:prometheus|Prometheus|metrics,monitoring,scrape|prometheus
si:grafana|Grafana|dashboards,monitoring|grafana
si:datadog|Datadog|apm,monitoring
si:newrelic|New Relic|apm,monitoring
lg:kibana|Kibana|elk,dashboards
lg:logstash|Logstash|elk,logs,pipeline
si:splunk|Splunk|logs,siem
si:sentry|Sentry|errors,apm,crash reporting|sentry
si:jaeger|Jaeger|tracing,distributed tracing|jaeger
si:opentelemetry|OpenTelemetry|otel,tracing,metrics
si:fluentd|Fluentd|logs,log shipping
si:pagerduty|PagerDuty|oncall,alerts,incident
lg:aws-cloudwatch|Amazon CloudWatch|aws,cloudwatch,monitoring,logs|aws-cloudwatch
lg:aws-xray|AWS X-Ray|aws,xray,tracing|aws-xray
gcp:cloud-monitoring|Google Cloud Monitoring|gcp,stackdriver,monitoring|gcp-cloud-monitoring
gcp:cloud-logging|Google Cloud Logging|gcp,stackdriver,logging|gcp-cloud-logging`,

  security: `si:auth0|Auth0|auth,identity,oauth,sso
si:okta|Okta|sso,identity,saml
si:keycloak|Keycloak|sso,identity,oidc|keycloak
si:openid|OpenID|oidc,sso
si:jsonwebtokens|JWT|json web token,token,auth
lg:vault-icon=vault|Vault|secrets,hashicorp|vault
si:consul|Consul|service discovery,hashicorp,service mesh|consul
si:letsencrypt|Let's Encrypt|tls,certificates,acme
si:snyk|Snyk|vulnerability scanning,sca
si:sonarqubeserver|SonarQube|code quality,sast
lg:aws-iam|AWS IAM|aws,iam,identity,permissions|aws-iam
lg:aws-cognito|Amazon Cognito|aws,cognito,auth,user pool|aws-cognito
lg:aws-kms|AWS KMS|aws,kms,keys,encryption|aws-kms
lg:aws-secrets-manager|AWS Secrets Manager|aws,secrets manager,secrets|aws-secrets-manager
lg:aws-waf|AWS WAF|aws,waf,web application firewall|aws-waf
lg:aws-shield|AWS Shield|aws,shield,ddos|aws-shield
gcp:identity-and-access-management|Google Cloud IAM|gcp,iam,identity,permissions|gcp-iam
gcp:key-management-service|Google Cloud KMS|gcp,kms,keys,encryption|gcp-kms
gcp:secret-manager|Google Secret Manager|gcp,secret manager,secrets|gcp-secret-manager
gcp:cloud-armor|Google Cloud Armor|gcp,cloud armor,waf,ddos|gcp-cloud-armor`,

  cicd: `si:github|GitHub|git,vcs,source|github
si:githubactions|GitHub Actions|ci,cd,workflow
si:gitlab|GitLab|git,ci,vcs|gitlab
si:bitbucket|Bitbucket|git,vcs
si:git|Git|vcs,version control
dv:jenkins|Jenkins|ci,cd,pipeline|jenkins
si:circleci|CircleCI|ci,cd
si:argo|Argo CD|argocd,gitops,cd,workflows
lg:jfrog|JFrog Artifactory|artifactory,artifacts,registry
si:npm|npm|packages,registry,node package manager
si:terraform|Terraform|iac,hashicorp,infrastructure as code|terraform
si:ansible|Ansible|automation,iac,configuration management|ansible
si:pulumi|Pulumi|iac,infrastructure as code
lg:aws-cloudformation|AWS CloudFormation|aws,cloudformation,iac|aws-cloudformation`,

  clients: `lg:chrome=googlechrome|Chrome|browser,google chrome,web client
lg:firefox|Firefox|browser,mozilla
dv:safari|Safari|browser,webkit
lg:microsoft-edge|Microsoft Edge|edge,browser
si:android|Android|mobile,google
si:apple=ios|iOS|mobile,iphone,apple
si:apple|Apple|ios,macos
si:apple=macos|macOS|mac,apple,os
lg:microsoft-windows-icon=microsoft-windows|Windows|microsoft,os,desktop
si:linux|Linux|tux,os,kernel
si:ubuntu|Ubuntu|linux,os
si:debian|Debian|linux,os
si:redhat|Red Hat|rhel,linux
si:electron|Electron|desktop app,chromium`,

  frontend: `si:react|React|frontend,ui,spa
si:nextdotjs|Next.js|react,ssr,nextjs
lg:angular-icon=angular|Angular|frontend,spa
si:vuedotjs|Vue.js|vue,frontend
lg:nuxt-icon=nuxt|Nuxt|nuxtjs,vue framework,ssr
si:svelte|Svelte|frontend,sveltekit
si:tailwindcss|Tailwind CSS|css,tailwind
si:vite|Vite|bundler,dev server
si:flutter|Flutter|mobile,dart,cross platform
si:swift|Swift|ios,apple
si:kotlin|Kotlin|jvm,android`,

  languages: `si:go|Go|golang|
si:rust|Rust|rustlang
lg:python|Python|py
si:nodedotjs|Node.js|node,nodejs,javascript
lg:java=openjdk|Java|jvm,openjdk
si:typescript|TypeScript|ts
si:javascript|JavaScript|js
si:scala|Scala|jvm
si:ruby|Ruby|rails
si:php|PHP|
si:cplusplus|C++|cpp
lg:c-sharp|C#|csharp,dotnet
si:dotnet|.NET|dotnet,csharp
si:elixir|Elixir|beam,phoenix
si:erlang|Erlang|beam,otp
si:deno|Deno|runtime,typescript
si:bun|Bun|runtime,javascript
si:django|Django|python,framework,web
si:fastapi|FastAPI|python,framework,web
si:flask|Flask|python,framework,web
si:spring|Spring|framework,jvm
si:springboot|Spring Boot|framework,jvm
si:express|Express|expressjs,framework,web`,

  ai: `lg:openai-icon=openai|OpenAI|gpt,chatgpt,llm
si:anthropic|Anthropic|claude,llm
si:huggingface|Hugging Face|models,transformers
si:tensorflow|TensorFlow|tf,ml
si:pytorch|PyTorch|torch,ml
si:nvidia|NVIDIA|gpu,cuda
gcp:vertexai|Google Vertex AI|gcp,vertex,ml|gcp-vertex-ai`,

  thirdparty: `si:stripe|Stripe|payments,billing
si:paypal|PayPal|payments
si:adyen|Adyen|payments
si:razorpay|Razorpay|payments,india
lg:twilio-icon=twilio|Twilio|sms,voice,messaging|twilio
lg:sendgrid-icon=sendgrid|SendGrid|email,transactional email
si:mailgun|Mailgun|email,transactional email
si:mailchimp|Mailchimp|email,marketing
lg:slack-icon=slack|Slack|chat,notifications,webhook
si:discord|Discord|chat,bot,webhook
si:telegram|Telegram|chat,bot
si:whatsapp|WhatsApp|messaging,chat
lg:onesignal|OneSignal|push notifications
lg:segment-icon=segment|Segment|analytics,events
si:mapbox|Mapbox|maps
si:googlemaps|Google Maps|maps,geocoding`,
};
