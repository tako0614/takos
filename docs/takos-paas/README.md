# Takos Deploy v2 v1.0 Final, Single Kit

This kit bundles the final Core contract, implementation guidance, official seed descriptors, provider descriptor examples, tests, and migration notes in one ZIP.

## Core rule

```text
Core has no domain kinds.
Core defines deployment meta-objects.
Descriptors define meaning.
Plans pin descriptors.
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

tests/
  conformance-tests.md
  condition-reason-catalog.md

migration/
  current-takos-to-deploy-v2.md
```

## Cloudflare naming

Use `provider.cloudflare.workers@v1` as the provider identity. Treat **Workers for Platforms** as an implementation topology of Cloudflare Workers, not as a provider identity or canonical mode. The implementation docs still use Cloudflare official terms: dispatch namespace, dynamic dispatch Worker, user Worker, and outbound Worker.

Cloudflare Containers are represented as a provider that materializes `runtime.oci-container@v1 + artifact.oci-image@v1 + interface.http@v1` through provider-fronted container materialization.

## Descriptor status

The JSON-LD descriptors included here are implementation seed descriptors. They are not Core built-ins. A Takos distribution may ship them as official descriptors and must pin their digests in DescriptorClosure during Plan.
