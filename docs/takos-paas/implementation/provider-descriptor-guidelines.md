# Takos Deploy v3 Implementation Provider Descriptor Guidelines

Status: implementation guidance, not Core semantics.

This document defines how an implementation can ship practical descriptor definitions for Workers-like runtimes, containers, cloud services, and self-hosted providers while keeping Takos Deploy v3 Core kindless
([`../core/01-core-contract-v1.0.md`](../core/01-core-contract-v1.0.md)).

## 1. Principle

Takos Deploy v3 Core does not define provider-specific kinds.

Do not add Core kinds such as:

```text
cloudflare-worker
cloudflare-container
google-cloud-run
aws-ecs-fargate
kubernetes-deployment
postgres-neon
cloudflare-d1
```

Instead:

```text
Contract descriptors define meaning.
Provider descriptors declare what contract tuples and resource contracts they can materialize.
Provider implementations materialize; they do not define Core meaning.
```

## 2. Descriptor seed set

A Takos distribution should ship a small official descriptor seed set. These descriptors are not Core built-ins. They are the first dictionary a normal implementation can use.

Recommended contract descriptors:

```text
runtime.js-worker@v1
runtime.oci-container@v1
artifact.js-module@v1
artifact.oci-image@v1
interface.http@v1
interface.tcp@v1
interface.udp@v1
interface.queue@v1
interface.schedule@v1
interface.event@v1
resource.sql.postgres@v1
resource.sql.sqlite-serverless@v1
resource.object-store.s3@v1
publication.http-endpoint@v1
publication.mcp-server@v1
```

Recommended provider descriptors:

```text
provider.cloudflare.workers@v1
provider.cloudflare.containers@v1
provider.google.cloud-run@v1
provider.kubernetes.generic@v1
provider.aws.ecs-fargate@v1
provider.cloudflare.d1@v1
provider.cloudflare.r2@v1
provider.aws.s3@v1
provider.neon.postgres@v1
provider.selfhost.takos-runtime-host@v1
provider.selfhost.docker-podman@v1
provider.selfhost.postgres@v1
provider.selfhost.minio@v1
```

## 3. Workers-like providers

For Cloudflare, use `provider.cloudflare.workers@v1` as the provider descriptor. Treat Workers for Platforms as an implementation topology that uses dispatch namespaces, dynamic dispatch Workers, user Workers, and optional outbound Workers.


Workers-like providers usually materialize:

```text
runtime.js-worker@v1
artifact.js-module@v1
interface.http@v1
```

For Cloudflare Workers, implementation descriptors should model:

```text
dispatch namespace
dynamic dispatch worker
user worker
explicit user worker bindings
optional outbound worker / egress mediator
```

The provider descriptor should expose Cloudflare Workers as a materializer of JS-worker contracts, not as a Core kind.

## 4. Container providers

Container providers usually materialize:

```text
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
```

But not all container providers are equivalent.

Provider descriptors must declare limitations such as:

```text
http-ingress-only
no-direct-end-user-tcp-udp
provider-managed-placement
provider-managed-revisions
requires-load-balancer
image-retention-required-for-rollback
```

Examples:

```text
Cloudflare Containers:
  Worker-fronted, Durable-Object-backed, on-demand HTTP-oriented container
  runtime. It is not an always-on provider target.

Google Cloud Run:
  Managed container service with revisions and traffic split.

AWS ECS/Fargate:
  Task-definition/service-based container runtime with load balancer integration.

Kubernetes:
  Deployment/Pod + Service + Ingress/Gateway materialization. This is the first
  always-on provider target for long-running container workloads.

Self-hosted Docker/Podman:
  Container runtime behind Caddy/Traefik or Takos gateway.
```

## 5. Resource providers

Resource providers satisfy ResourceContract descriptors.

Examples:

```text
provider.cloudflare.d1@v1:
  resource.sql.sqlite-serverless@v1
  access modes: sql-runtime-binding, sql-query-api, migration-admin

provider.neon.postgres@v1:
  resource.sql.postgres@v1
  access modes: database-url, migration-admin

provider.cloudflare.r2@v1:
  resource.object-store.s3@v1
  access modes: s3-api, object-runtime-binding, object-api

provider.aws.s3@v1:
  resource.object-store.s3@v1
  access modes: s3-api

provider.selfhost.minio@v1:
  resource.object-store.s3@v1
  access modes: s3-api
```

Resource provider descriptors must not redefine the ResourceContract. They may constrain support, declare access paths, and report limitations.

## 6. Resource access paths

Major cloud providers differ most in resource access paths.

```text
Cloudflare Workers:
  direct runtime binding for D1, R2, Queues, and Durable Objects where the
  descriptor and provider capability allow it

Cloudflare Containers:
  internal endpoint -> provider mediator -> direct runtime binding

Cloud Run:
  env/secret credential, provider connector, internal gateway

ECS/Fargate:
  env/secret credential, VPC networking, load balancer, IAM task role

Kubernetes:
  SecretRef, service DNS, sidecar, service mesh, gateway

Self-hosted Docker:
  env credential, internal service URL, local gateway
```

The Core should not care which path is used. The Deployment must record the selected access path on `Deployment.desired.bindings[*].accessPath`.

Cloudflare provider plugins must rely on Cloudflare-injected runtime bindings
inside Workers and operator-injected control-plane client references for
deployment, migration, and observation operations. They must fail closed when
the operator has not supplied the required client references. Descriptor text
must not suggest that the PaaS kernel constructs Cloudflare SDK/network clients.

## 7. Provider descriptor JSON-LD pattern

A provider descriptor should be declarative.

Good:

```json
{
  "@context": "https://takos.dev/contexts/deploy-v2.jsonld",
  "@id": "https://takos.dev/providers/google/cloud-run/v1",
  "@type": "ProviderCapabilityDescriptor",
  "shortRef": "provider.google.cloud-run@v1",
  "materializationProfiles": [
    {
      "ref": "materialize.cloud-run-service-http@v1",
      "contracts": {
        "runtime": "runtime.oci-container@v1",
        "artifact": "artifact.oci-image@v1",
        "interfaces": ["interface.http@v1"]
      },
      "roles": ["runtime", "router"],
      "limitations": ["provider-managed-revisions", "provider-managed-scaling"]
    }
  ]
}
```

Provider support reports can also declare protocol reachability explicitly with
`interfaceContracts` and `routeProtocols`. The PaaS conformance service derives
`routeProtocols` from materialization profile interfaces when possible, and uses
the explicit fields to validate external provider plugins without bundling a
provider implementation into the kernel.

Bad:

```json
{
  "materialize": "function(config) { callCloudApi(config) }"
}
```

Descriptors are dictionaries, not programs.

## 8. Provider adoption order

Suggested implementation order:

```text
1. provider.selfhost.takos-runtime-host@v1
2. provider.selfhost.docker-podman@v1
3. provider.selfhost.postgres@v1 / provider.selfhost.minio@v1
4. provider.cloudflare.workers@v1
5. provider.cloudflare.d1@v1 / provider.cloudflare.r2@v1
6. provider.cloudflare.containers@v1
7. provider.google.cloud-run@v1
8. provider.kubernetes.generic@v1
9. provider.aws.ecs-fargate@v1
10. provider.aws.s3@v1 / provider.neon.postgres@v1
```

Self-hosted providers should exist before cloud-only paths so Takos can run without depending on a public cloud.

## 9. Required Deployment output

For every selected provider, the resolved Deployment should expose:

```text
provider descriptor id and digest (Deployment.resolution.descriptor_closure)
selected materialization profile (Deployment.resolution.resolved_graph projections)
contract tuple matched
slot mapping
provider limitations (Deployment.conditions[])
access path selection (Deployment.desired.bindings[*].accessPath)
egress enforcement report (Deployment.conditions[] tied to runtime_network_policy)
artifact retention requirements
assignment support / weighted support (Deployment.desired.activation_envelope)
ServingConverged observation model (ProviderObservation)
```

## 10. Descriptor pack in this kit

The accompanying descriptor seed directory contains JSON-LD examples under:

```text
contexts/
contracts/
providers/
selfhost/
```

These examples are seed definitions. Production implementations must pin descriptor digests in `Deployment.resolution.descriptor_closure` and enforce PolicySpec before use.
