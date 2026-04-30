# Takos Deploy v3 Implementation Provider Catalog

Status: implementation guideline, non-core.

This document defines a recommended implementation catalog for common provider targets. It does not change Takos Deploy v3 Core semantics
([`../core/01-core-contract-v1.0.md`](../core/01-core-contract-v1.0.md)).

Core remains small:

```text
Core has no domain kinds.
Descriptors define meaning.
Providers materialize; they do not define.
Observed provider state is never canonical.
```

This catalog provides practical JSON-LD descriptor examples for common provider targets such as Cloudflare Workers, Cloudflare Containers, Cloud Run, Kubernetes, ECS/Fargate, App Runner, Azure Container Apps, and self-hosted Docker/Podman.

## 1. Non-normative status

The JSON-LD descriptors in this folder are implementation templates. A Takos implementation may ship them as official descriptors, replace them with equivalent descriptors, or load a different descriptor set, as long as `Deployment.resolution.descriptor_closure` pins descriptor digests and conformance tests pass.

These examples are intentionally provider capability descriptors, not Core domain kinds.

Provider descriptors are examples and capability profiles. Self-hosted and
cloud provider implementations are external operator-registered plugin bundles;
the PaaS kernel ships no built-in provider implementations. External bundles
must use `TAKOS_KERNEL_PLUGIN_CONFIG` / `pluginConfig[pluginId].clients` to map
adapter keys to operator-owned `KernelPluginClientRegistry` entries. Staging and
production profiles fail closed unless required adapters such as `actor`,
`auth`, `provider`, `storage`, and `runtimeAgent` are supplied. They must not
construct cloud provider SDK clients inside the kernel.

```text
Bad:
  Core knows cloudflare-container.

Good:
  Provider descriptor says it can materialize:
    runtime.oci-container@v1
    artifact.oci-image@v1
    interface.http@v1
```

## 2. Provider catalog shape

A provider descriptor should declare four kinds of facts.

```text
1. Materialization profiles
   Which component contract combinations can be materialized.

2. Router support
   Which route/listener protocols and assignment models can be materialized.

3. Resource access paths
   How components can reach resources.

4. Limitations and native fields
   What is unsupported, advisory, provider-fronted, cost-affecting, or security-sensitive.
```

Provider descriptors must not redefine contract semantics. They may constrain, reject, or report limitations.

## 3. Recommended provider targets

| Provider target | Typical materialization | Notes |
|---|---|---|
| `provider.cloudflare.workers@v1` | JS module worker + HTTP routed interface | Uses dispatch namespace, dynamic dispatch Worker, user Workers, optional outbound Worker. |
| `provider.cloudflare.containers@v1` | OCI image + HTTP interface | Worker-fronted, Durable-Object-backed, on-demand container access through provider bridge; not an always-on process host. |
| `provider.google.cloud-run@v1` | OCI image + HTTP service | Cloud Run revision/traffic model; one container ingress port in the service API. |
| `provider.aws.ecs-fargate@v1` | OCI container service/task | Task definition + service; router usually via ALB/NLB or service mesh. |
| `provider.aws.app-runner@v1` | Source/image to managed web service | Simpler web-app target than ECS. |
| `provider.azure.container-apps@v1` | OCI container app revisions | Supports revisions and ingress traffic split. |
| `provider.kubernetes@v1` | Pods/Deployments/Services/Ingress/Gateway | An always-on provider target for long-running container workloads. |
| `provider.selfhosted.docker-podman@v1` | OCI container on local host | Example operator-owned self-hosted plugin path, usually with Caddy/Traefik. |
| `provider.takos.runtime-host@v1` | JS module runtime host | Self-hosted runtime path for `runtime.js-worker@v1`. |

## 4. Workers family guidance

### Cloudflare Workers provider

### Naming note

Use `provider.cloudflare.workers@v1` as the provider identity. Treat Workers for Platforms as an implementation topology of the Cloudflare Workers provider, not as a provider identity or canonical mode. Implementation notes should still use Cloudflare official terms: dispatch namespace, dynamic dispatch Worker, user Worker, and outbound Worker.


Cloudflare Workers materializes JS runtime components. Workers for Platforms is the recommended implementation topology for tenant/user Workers, using a dispatch namespace, dynamic dispatch Worker, user Workers, and optional outbound Worker.

```text
runtime.js-worker@v1
artifact.js-module@v1
interface.http@v1
```

Provider materialization should look like:

```text
Deployment.resolution.resolved_graph component
  -> Cloudflare user Worker in dispatch namespace

Deployment.desired.routes + Deployment.desired.activation_envelope
  -> dynamic dispatch Worker route table / assignment logic

Deployment.desired.bindings[*].accessPath
  -> direct runtime bindings to D1 / KV / R2 / Queues when supported
```

Cloudflare Workers resource bindings are direct runtime bindings where possible.
Cloudflare D1, R2, Queues, and Durable Objects are represented as resource or
coordination targets with Cloudflare-injected runtime bindings. Provider plugins
receive operator-injected control-plane client references and fail closed when
those references are absent; descriptor metadata must not imply that the PaaS
kernel constructs Cloudflare SDK/network clients.

### Cloudflare Containers

Cloudflare Containers materializes OCI container components, but not like a generic VM/container host. It is worker-fronted and Durable-Object-backed.

```text
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
```

Provider materialization should look like:

```text
Router request
  -> provider fronting Worker / Durable Object
  -> Cloudflare container instance
```

Cloudflare Containers are on-demand materialization behind the Worker/Durable
Object bridge. They may keep instances warm according to provider-native policy,
but they are not an always-on container baseline. Use Kubernetes or another
external always-on provider plugin when the environment requires always-running
processes, pod/service semantics, or operator-managed cluster networking.

Resource access may use a mediated access path:

```text
component container
  -> internal endpoint
  -> provider mediator / outbound handler
  -> Workers binding
  -> D1 / R2 / KV / Durable Object
```

This is not a different resource contract. It is a different
`Deployment.desired.bindings[*].accessPath` selection.

## 5. Other cloud guidance

### Cloud Run

Cloud Run materializes OCI image HTTP services. It has revision and traffic split concepts, so it can support `Deployment.desired.activation_envelope` assignment materialization when provider capability and RouteDescriptor allow it.

Typical descriptor support:

```text
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
```

Cloud Run provider descriptors should declare constraints such as single ingress container port, supported traffic assignment semantics, ingress settings, VPC egress support, and service/job distinction.

### ECS/Fargate

ECS/Fargate materializes OCI containers through task definitions and services. It is not itself a router; router materialization usually depends on ALB/NLB, service discovery, or another gateway.

### Kubernetes

Kubernetes materializes runtime/artifact/interface contracts through Pods, Deployments, Services, Ingress, Gateway API, NetworkPolicy, Secrets, and ConfigMaps. Kubernetes descriptors should be explicit about whether a route is implemented by Service, Ingress, Gateway API, service mesh, or another controller.

### Azure Container Apps

Azure Container Apps materializes container apps with revisions and ingress. Its provider descriptor should distinguish revision assignment, ingress, and runtime/network policy capability.

### Self-hosted Docker/Podman

An operator-owned Docker/Podman plugin can provide a self-hosted container materialization path. It should materialize `Deployment.desired.routes` through Caddy/Traefik or another router, and resolve `Deployment.desired.bindings[*].accessPath` through credentials, internal endpoints, or Takos-managed resource gateways.

## 6. Resource provider examples

Resource providers should declare ResourceContract support, access modes, and access path support.

Examples:

```text
Cloudflare D1:
  resource.sql.sqlite-serverless@v1
  access: sql-runtime-binding, sql-query-api, migration-admin

Cloudflare R2:
  resource.object-store.s3@v1 or object-runtime-binding descriptor

Cloudflare Queues:
  interface.queue@v1 and queue-resource access through injected Worker bindings

Cloudflare Durable Objects:
  provider coordination / runtime binding; not canonical durable state unless a
  descriptor explicitly defines the resource contract and access path

AWS RDS Postgres / Cloud SQL / Neon:
  resource.sql.postgres@v1
  access: database-url, migration-admin

S3 / GCS / MinIO:
  resource.object-store.s3@v1 or provider-specific object descriptor if S3 compatibility is not exact
```

Do not publish resource credentials as publication outputs. Use `Deployment.desired.bindings` (with the inline `accessPath` for each binding).

## 7. Descriptor authoring rule

Provider descriptors should be declarative.

```text
Provider descriptors may declare support, limitations, config constraints, and access path templates.
Provider descriptors must not contain arbitrary executable routing or materialization code.
Provider implementations may execute code, but that implementation mechanism is outside Core.
```

## 8. Minimal provider descriptor checklist

A provider descriptor should state:

```text
- canonical @id and shortName
- materialization profiles
- supported router protocols / assignment granularity
- supported resource access paths
- provider-fronted materialization roles, if any
- credential visibility model
- limitations
- required conformance tests
- provider-native fields, if any
```

## 9. Deployment display expectations

The Deployment record (resolution + desired + conditions) should expose
provider descriptor choices to CLI / API consumers.

```text
Provider target:
  provider.google.cloud-run@v1
  descriptor digest: sha256:...   (from Deployment.resolution.descriptor_closure)

Materialization profile:
  materialize.google-cloud-run.http-service@v1
  (recorded as a projection in Deployment.resolution.resolved_graph)

Component tuple:
  runtime.oci-container@v1
  artifact.oci-image@v1
  interface.http@v1

Limitations (Deployment.conditions[]):
  single ingress port
  provider revision traffic split
```

## 10. Recommended file layout

```text
implementation/provider-descriptors/
  provider.cloudflare.workers.v1.jsonld
  provider.cloudflare.containers.v1.jsonld
  provider.google.cloud-run.v1.jsonld
  provider.aws.ecs-fargate.v1.jsonld
  provider.aws.app-runner.v1.jsonld
  provider.azure.container-apps.v1.jsonld
  provider.kubernetes.v1.jsonld
  provider.selfhosted.docker-podman.v1.jsonld
  provider.takos.runtime-host.v1.jsonld

implementation/resource-provider-descriptors/
  provider.cloudflare.d1.v1.jsonld
  provider.cloudflare.r2.v1.jsonld
  provider.aws.rds-postgres.v1.jsonld
  provider.aws.s3.v1.jsonld
  provider.gcp.cloud-sql-postgres.v1.jsonld
  provider.gcp.cloud-storage.v1.jsonld
```
