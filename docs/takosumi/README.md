# Takos Deploy v1.0 Core Kit

This kit bundles the Core contract, implementation guidance, official seed
descriptors, provider descriptor examples, and tests for the Deployment-centric
surface defined in
[`core/01-core-contract-v1.0.md`](./core/01-core-contract-v1.0.md). The Core
organizes Core around three records: `Deployment` (input + resolution + desired
state + status + conditions), `ProviderObservation` (observed-side stream), and
`GroupHead` (group-scoped pointer to the current Deployment).

> 現行実装の status は [Current Implementation Note](./current-state) を参照。

## Shape Model (Takosumi)

Takosumi の portable resource model (Shape + Provider + Template) は独立した
Takosumi リポジトリに移管されました。Shape Catalog / Provider Plugins /
Templates / Manifest envelope / Operator Bootstrap / Extending の docs は
[`takosumi/docs/`](https://github.com/tako0614/takosumi/tree/main/docs) を
参照してください。

## Boundary

The Takosumi implementation is a strict
**reference-kernel-with-external-plugins** boundary. The kernel implements Core
semantics; all production providers ship as external plugin bundles outside the
kernel. Cloudflare resource provider plugins, when provided externally, use
Cloudflare-injected runtime bindings and operator-injected control-plane client
references for D1, R2, Queues, and Durable Objects. Cloudflare Containers are
on-demand materialization and are not an always-on process host; Kubernetes or
another external provider plugin can host workloads that require long-running
container processes. See [Current Implementation Note](./current-state) for the
full status.

## Core rule

```text
Core has no domain kinds.
Core defines Deployment / ProviderObservation / GroupHead.
Descriptors define meaning.
Deployments pin descriptors.
Apply uses pinned meaning.
Bindings are explicit.
Routed serving is protocol-agnostic and descriptor-defined.
Resources are reached through access paths.
Providers materialize; they do not define.
Observed provider state is never canonical.
```

## Directory map

```text
core/
  01-core-contract-v1.0.md

types/
  core.ts

schemas/
  core.schema.json

descriptors/
  official-descriptor-set-v1.md
  contexts/
  contracts/
  providers/

implementation/
  implementation-strategy.md
  provider-descriptor-catalog.md
  provider-descriptor-guidelines.md
  providers/

guides/
  authoring-guide.md
  descriptor-authoring-guide.md
  plugin-authoring-guide.md

tests/
  conformance-tests.md
  condition-reason-catalog.md

current-state.md
```

## Cloudflare 用語

Cloudflare Workers / Containers の固有用語 (`{ADMIN_DOMAIN}` / `takos-dispatch`
/ `RoutingDO` / Container DO / dispatch namespace 等) は Core 用語ではなく
tracked reference Workers backend のみで使う materialization detail。canonical
な対応関係は
[Workers backend implementation note](../reference/glossary#workers-backend-implementation-note)
を参照し、具体的な実装は各 architecture / hosting 章の tracked reference Workers
backend 節に置く。

## Descriptor status

The JSON-LD descriptors included here are implementation seed descriptors. They
are not Core built-ins. A Takos distribution may ship them as official
descriptors and must pin their digests in
`Deployment.resolution.descriptor_closure` when the Deployment is recorded.
