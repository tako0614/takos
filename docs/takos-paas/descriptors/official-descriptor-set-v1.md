# Takos Deploy v2 Official Descriptor Set v1.0

This document proposes the initial official descriptor set for a Takos distribution.

These descriptors are **not Core built-ins**. Core remains kindless. A Takos distribution may ship this descriptor set so users have a practical standard vocabulary.

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

Provider-specific behavior belongs in provider materialization descriptors, EnvSpec, and PolicySpec.

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
interface.internal-service@v1
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
interface.internal-service@v1
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
route compatibility with route.http@v1
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
Component can receive UDP-like routed traffic.
```

Descriptor must define whether assignment is:

```text
flow-level
datagram-level
provider-defined
unsupported
```

If deterministic assignment semantics cannot be defined, weighted assignment must be unsupported.

---

## Minimum route descriptors

### `route.http@v1`

```text
https://takos.dev/contracts/route/http/v1
```

Meaning:

```text
RouterConfig can match HTTP host/path/method-like routing keys and forward to compatible interface descriptors.
```

### `route.tcp@v1`

```text
https://takos.dev/contracts/route/tcp/v1
```

Meaning:

```text
RouterConfig can bind/listen on TCP-like endpoint and forward connections to compatible interface descriptors.
```

### `route.udp@v1`

```text
https://takos.dev/contracts/route/udp/v1
```

Meaning:

```text
RouterConfig can bind/listen on UDP-like endpoint and forward datagrams or flows according to descriptor-defined semantics.
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

### `publication.file-handler@v1`

Output examples:

```text
url
mimeTypes
extensions
```

### `publication.ui-surface@v1`

Output examples:

```text
url
embed metadata
```

Credential-bearing built-in publications, such as API keys or OAuth clients, should use `secret-ref` by default and must define lifecycle semantics.

---

## Minimum data descriptors

### `data.generic-json@v1`

Meaning:

```text
Generic JSON payload descriptor for low-risk internal payloads.
```

For cross-group event/publication/service payloads, implementations SHOULD define specific data descriptors.
