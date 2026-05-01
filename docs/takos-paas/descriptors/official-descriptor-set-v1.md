# Takos Deploy Official Descriptor Set v1.0

This document proposes the initial official descriptor set for a Takos
distribution. Deployments pin descriptors via
`Deployment.resolution.descriptor_closure`
([`../core/01-core-contract-v1.0.md`](../core/01-core-contract-v1.0.md) § 6).

These descriptors are **not Core built-ins**. Core remains kindless. A Takos
distribution may ship this descriptor set so users have a practical standard
vocabulary.

## Naming rule

Canonical descriptor URI:

```text
https://takos.dev/contracts/<domain>/<name>/v<major>
```

Authoring alias:

```text
<domain>.<name>@v<major>
```

Examples:

```text
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
resource.sql.postgres@v1
publication.mcp-server@v1
```

## Principles

```text
Contract = behavior / meaning.
Provider = materialization.
Operational detail = EnvSpec / PolicySpec / provider target.
```

Good descriptor names:

```text
runtime.oci-container@v1
runtime.js-worker@v1
artifact.oci-image@v1
interface.http@v1
resource.sql.postgres@v1
resource.object-store.s3@v1
publication.mcp-server@v1
```

Avoid descriptor names that encode provider identity or deployment location:

```text
cloudrun.container@v1
neon.postgres.managed@v1
cloudflare-d1-db@v1
```

Provider-specific behavior belongs in provider materialization descriptors,
EnvSpec, and PolicySpec.

---

## Minimum runtime descriptors

### `runtime.js-worker@v1`

Canonical URI:

```text
https://takos.dev/contracts/runtime/js-worker/v1
```

Lifecycle domain:

```text
revisioned-runtime
```

Minimum descriptor obligations:

```text
supported injection modes
runtime identity model
readiness observation method
secret visibility model
log redaction support
live rebind support, if any
```

Typical artifact contracts:

```text
artifact.js-module@v1
```

Typical interface contracts:

```text
interface.http@v1
interface.queue@v1
interface.schedule@v1
interface.event@v1
```

### `runtime.oci-container@v1`

Canonical URI:

```text
https://takos.dev/contracts/runtime/oci-container/v1
```

Lifecycle domain:

```text
revisioned-runtime
```

Minimum descriptor obligations:

```text
process model: command / args / env
shutdown and drain behavior
supported injection modes
filesystem and mount model
log model
readiness observation method
resource limit expression
security baseline
secret visibility model
```

Typical artifact contracts:

```text
artifact.oci-image@v1
```

Typical interface contracts:

```text
interface.http@v1
interface.tcp@v1
interface.udp@v1
interface.queue@v1
```

---

## Minimum artifact descriptors

### `artifact.js-module@v1`

```text
https://takos.dev/contracts/artifact/js-module/v1
```

Meaning:

```text
An immutable JavaScript module artifact suitable for a compatible JavaScript runtime descriptor.
```

Required metadata:

```text
artifact digest
module format
source/build provenance if available
```

### `artifact.oci-image@v1`

```text
https://takos.dev/contracts/artifact/oci-image/v1
```

Meaning:

```text
An immutable OCI image artifact, addressed by digest for production use.
```

Required metadata:

```text
image ref
image digest
platform if relevant
mirrored ref if retained by Takos
```

---

## Minimum interface descriptors

### `interface.http@v1`

```text
https://takos.dev/contracts/interface/http/v1
```

Meaning:

```text
Component can receive HTTP-like request traffic.
```

Descriptor must define:

```text
routable protocol model
HTTP routing compatibility
health/probe model
assignment granularity, usually request-level
whether weighted assignment is supported
```

### `interface.tcp@v1`

```text
https://takos.dev/contracts/interface/tcp/v1
```

Meaning:

```text
Component can receive TCP connection-oriented routed traffic.
```

Descriptor must define:

```text
connection-level assignment semantics
session/drain behavior
probe model or unknown convergence status
```

### `interface.udp@v1`

```text
https://takos.dev/contracts/interface/udp/v1
```

Meaning:

```text
Component can receive UDP datagram routed traffic.
```

Descriptor must define:

```text
packet-level assignment semantics
probe model or unknown convergence status
weighted assignment limits for stateless traffic
```

### `interface.queue@v1`

```text
https://takos.dev/contracts/interface/queue/v1
```

Meaning:

```text
Component can receive queued asynchronous messages.
```

Descriptor must define:

```text
delivery model
assignment model
consumer rebind behavior
retry and dead-letter expectations when supported
```

### `interface.schedule@v1`

```text
https://takos.dev/contracts/interface/schedule/v1
```

Meaning:

```text
Component can receive scheduler-triggered invocations.
```

Descriptor must define:

```text
schedule expression model
assignment model
catch-up and missed-run behavior
```

### `interface.event@v1`

```text
https://takos.dev/contracts/interface/event/v1
```

Meaning:

```text
Component can receive asynchronous event delivery.
```

Descriptor must define:

```text
delivery model
assignment model
target stability expectations
idempotent consumer rebind expectations
```

---

## Minimum resource descriptors

### `resource.sql.postgres@v1`

```text
https://takos.dev/contracts/resource/sql/postgres/v1
```

Access modes should include:

```text
database-url
migration-admin
sql-query-api, if a gateway is available
```

Permission namespace:

```text
sql:read
sql:write
sql:ddl
```

### `resource.sql.sqlite-serverless@v1`

```text
https://takos.dev/contracts/resource/sql/sqlite-serverless/v1
```

Access modes may include:

```text
sql-runtime-binding
sql-query-api
migration-admin
```

It does not imply a database URL.

### `resource.object-store.s3@v1`

```text
https://takos.dev/contracts/resource/object-store/s3/v1
```

Meaning:

```text
S3-compatible object-store API semantics. This does not imply AWS S3 provider.
```

Access modes may include:

```text
s3-api
object-runtime-binding
object-api
```

### `resource.key-value@v1`

```text
https://takos.dev/contracts/resource/key-value/v1
```

Meaning:

```text
Durable key-value storage exposed through a runtime binding.
```

Access modes may include:

```text
kv-runtime-binding
```

### `resource.queue.at-least-once@v1`

```text
https://takos.dev/contracts/resource/queue/at-least-once/v1
```

Meaning:

```text
At-least-once delivery queue with descriptor-defined retry, visibility timeout, ordering, and DLQ behavior.
```

Access modes may include:

```text
queue-producer
queue-consumer-subscription
queue-runtime-binding
```

### `resource.secret@v1`

```text
https://takos.dev/contracts/resource/secret/v1
```

Meaning:

```text
Credential material generated or managed by Takos and injected only through explicit bindings.
```

Access modes may include:

```text
secret-env-binding
```

### `resource.vector-index@v1`

```text
https://takos.dev/contracts/resource/vector-index/v1
```

Access modes may include:

```text
vector-runtime-binding
```

### `resource.analytics-engine@v1`

```text
https://takos.dev/contracts/resource/analytics-engine/v1
```

Access modes may include:

```text
analytics-runtime-binding
```

### `resource.workflow@v1`

```text
https://takos.dev/contracts/resource/workflow/v1
```

Access modes may include:

```text
workflow-runtime-binding
```

### `resource.durable-object@v1`

```text
https://takos.dev/contracts/resource/durable-object/v1
```

Access modes may include:

```text
durable-object-runtime-binding
```

---

## Minimum publication descriptors

### `publication.http-endpoint@v1`

Output examples:

```text
url
endpoint
```

### `publication.mcp-server@v1`

Output examples:

```text
url
transport
metadata
```

### `publication.topic@v1`

Output examples:

```text
message-payload
consumer-binding
```

Credential-bearing built-in publications, such as API keys or OAuth clients,
should use `secret-ref` by default and must define lifecycle semantics.

---

## Composite descriptors

A composite descriptor bundles a runtime contract instance with one or more
related resource, route, or publication contract instances under a single
authoring alias. Composites are an authoring convenience: the compiler MUST
expand a composite reference into canonical component / contract instance form
before resolution finalises, and the expansion descriptor's digest MUST be
included in `Deployment.resolution.descriptor_closure`
([`../core/01-core-contract-v1.0.md`](../core/01-core-contract-v1.0.md) § 5).

Composites are profile-agnostic. The shape they emit always uses canonical
`runtime.*` and `resource.*` contract refs. Provider materialisation (Cloudflare
Workers vs AWS Lambda, Cloudflare D1 vs AWS RDS, R2 vs S3, Cloud Run vs Workers)
is decided downstream by the `provider-selection` policy gate, exactly as it is
for non-composite components. The composite fixes the _shape_, not the provider.

The compiler emits one additional descriptor pin per composite expansion:

```text
authoring.composite-expansion@v1
```

Plus the composite's authoring alias itself (e.g.
`composite.serverless-with-postgres@v1`). Both are recorded in
`descriptor_closure.resolutions[]`, and a `shape-derivation` dependency edge is
added from each pinned canonical descriptor to the composite alias.

### Naming

Canonical composite descriptor URI:

```text
https://takos.dev/contracts/composite/<name>/v<major>
```

Authoring alias:

```text
composite.<name>@v<major>
```

### `composite.serverless-with-postgres@v1`

Canonical URI:

```text
https://takos.dev/contracts/composite/serverless-with-postgres/v1
```

Lifecycle domain:

```text
revisioned-runtime
```

Expansion table (canonical contract refs that the compiler emits):

```text
runtime    = runtime.js-worker@v1
resources  = resource.sql.postgres@v1   (binding env DATABASE_URL)
```

Provider materialisation table (decided by `provider-selection`):

```text
Cloudflare profile  -> runtime: Cloudflare Workers
                       resource: Cloudflare Hyperdrive Postgres
                       or external resource.sql.postgres@v1 provider
AWS profile         -> runtime: AWS Lambda or ECS Fargate
                       resource: AWS RDS Postgres
GCP profile         -> runtime: Cloud Run
                       resource: Cloud SQL Postgres
Selfhosted / k8s    -> runtime: process / k8s deployment
                       resource: selfhosted Postgres
```

Manifest example:

```yaml
name: my-saas
compute:
  api:
    type: composite.serverless-with-postgres@v1
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build
        artifact: bundle
```

### `composite.web-app-with-cdn@v1`

Canonical URI:

```text
https://takos.dev/contracts/composite/web-app-with-cdn/v1
```

Lifecycle domain:

```text
revisioned-runtime
```

Expansion table:

```text
runtime       = runtime.js-worker@v1   (with runtimeCapabilities = [edge-cdn])
resources     = resource.object-store.s3@v1   (binding env ASSETS_BUCKET)
publications  = publication.http-endpoint@v1
routes        = interface.http@v1   (path /, protocol https)
```

Provider materialisation table:

```text
Cloudflare profile  -> runtime: Cloudflare Workers
                       resource: Cloudflare R2
                       cdn:      Cloudflare custom hostname
AWS profile         -> runtime: AWS Lambda
                       resource: AWS S3
                       cdn:      AWS CloudFront custom domain
GCP profile         -> runtime: Cloud Run
                       resource: Google Cloud Storage
                       cdn:      Cloud CDN custom domain
Selfhosted / k8s    -> runtime: process / k8s deployment
                       resource: selfhosted object-store
                       cdn:      Caddy / nginx
```

Manifest example:

```yaml
name: marketing-site
compute:
  web:
    type: composite.web-app-with-cdn@v1
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build
        artifact: bundle
```

### Authoring rules

A composite reference MUST appear as a `compute.<name>.type` value. All other
authoring fields on the same compute (env, depends, consume, build, image,
requirements, triggers, containers) are preserved through the expansion.
Composite-emitted resources, publications, and routes are named
`<component>-<suffix>` (e.g. `api-db`, `web-edge`, `web-site`). A composite
expansion MUST NOT clobber a user-declared resource, publication, or route of
the same name; the compiler refuses to compile in that case.
