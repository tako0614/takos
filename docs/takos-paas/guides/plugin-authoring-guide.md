# Takos PaaS Kernel Plugin Authoring Guide

Takos PaaS plugins provide implementation adapters for kernel I/O ports. They do
not define Core semantics. Core records — `Deployment` (with its inlined
`resolution.descriptor_closure`, `resolution.resolved_graph`, `desired.bindings`,
`desired.routes`, `desired.runtime_network_policy`, `desired.activation_envelope`,
`policy_decisions[]`, `approval`, `conditions[]`), `ProviderObservation`, and
`GroupHead` — remain owned by the PaaS kernel.

## Required manifest

A plugin exports a `TakosPaaSKernelPlugin` with a manifest.

```ts
import type { TakosPaaSKernelPlugin } from "takos-paas-contract/plugin";

export default {
  manifest: {
    id: "operator.example.self-hosted",
    name: "Example Operator Plugin",
    version: "1.0.0",
    kernelApiVersion: "2026-04-29",
    capabilities: [
      {
        port: "provider",
        kind: "docker",
        externalIo: ["process"],
      },
    ],
  },
  createAdapters(context) {
    return {
      provider: createProviderAdapter(context),
    };
  },
} satisfies TakosPaaSKernelPlugin;
```

## Kernel ports

Production and staging must explicitly select every kernel I/O port:

```text
auth
notification
operator-config
storage
source
provider
queue
object-storage
kms
secret-store
router-config
observability
runtime-agent
```

If a selected plugin does not declare the selected port, boot fails. If it
declares the port but does not return the corresponding adapter, boot fails.
Reference/noop plugins are rejected in staging and production. `runtime-agent`
is not declaration-only: a selected production plugin must return a
`RuntimeAgentRegistry` adapter for that port.

## Configuration

Use `TAKOS_KERNEL_PLUGIN_SELECTIONS` to select plugin ids and
`TAKOS_KERNEL_PLUGIN_CONFIG` to pass operator-owned configuration.

```json
{
  "storage": "operator.example.self-hosted",
  "provider": "operator.example.self-hosted",
  "queue": "operator.example.self-hosted"
}
```

```json
{
  "operator.example.self-hosted": {
    "dataDir": "/var/lib/takos-paas",
    "internalServiceSecret": "replace-with-operator-secret",
    "storage": {
      "databaseUrl": "postgresql://takos:takos@postgres:5432/takos"
    },
    "kms": {
      "keyMaterial": "replace-with-operator-kms-root"
    },
    "provider": {
      "execute": true
    }
  }
}
```

Do not add new `TAKOS_*_BACKEND` or `TAKOS_*_ADAPTER` selectors to the kernel.
Provider-specific settings belong under plugin config.

## Self-hosted plugin bundle

The kernel does not ship a built-in self-hosted implementation. A self-hosted
bundle is an external operator-owned plugin. Use an operator namespace such as:

```text
operator.example.self-hosted
```

It should provide the ports selected by the deployment:

```text
auth              signed service auth
notification      filesystem JSONL sink
operator-config   operator-supplied local config
storage           Postgres storage driver
source            Git source snapshots
provider          Docker materializer
queue             filesystem queue
object-storage    filesystem object storage
kms               configured WebCrypto KMS
secret-store      filesystem KMS-encrypted secret store
router-config     filesystem router config
observability     filesystem audit/metrics sink
runtime-agent     runtime-agent registry adapter
```

Staging and production require real injected adapters for every selected port
and must fail closed when a required client reference is absent.

When the `storage` port is selected, the returned `StorageDriver` must provide
transactional stores for the full canonical control-plane state: core,
Deployment / GroupHead, runtime desired/observed state, ProviderObservation
streams, resources, registry, audit, usage aggregates, and service endpoints.

## Operator profile bundles

The ecosystem external plugin root `takos-paas-plugins` provides profile bundle
implementations for:

```text
operator.takos.selfhosted
operator.takos.cloudflare
operator.takos.aws
operator.takos.gcp
```

Each profile declares all required ports plus `coordination`. Local/test
execution can use deterministic fake adapters. Staging and production must bind
real adapters or provider clients through `operatorConfig[pluginId].clients` and
an operator-provided `KernelPluginClientRegistry`. The profile package includes
adapter wrappers and conformance tests for Cloudflare, AWS, GCP, and self-hosted
targets, but cloud provider SDK clients, runtime bindings, and control-plane
credentials remain outside the PaaS kernel.

The Cloudflare deployment scaffold runs the PaaS API behind a Worker and
Cloudflare Container. Cloudflare Containers are on-demand Worker/Durable
Object-backed infrastructure, not a strict always-on process host.

The profile package also provides an operator bootstrap module and client
registry helpers. Use those helpers to select a profile for every required port
and inject real clients before serving the PaaS app. Cloudflare Worker binding
helpers cover R2 object storage and Queue enqueue; Queue lease/ack semantics and
D1 transactional storage must come from full operator-injected clients. Durable
Object bindings can back the coordination port. AWS and GCP HTTP gateway clients
and gateway handlers are available for operator-owned gateway endpoints, but
storage transactions still require an injected storage driver.

## Dynamic modules

`TAKOS_KERNEL_PLUGIN_MODULES` is a local/operator experiment loader. It is
ignored unless explicitly enabled and rejected in staging and production.
Production third-party plugin enablement uses the trusted signed manifest
installer. The plugin implementation must already be available in an
operator-controlled registry; the kernel verifies the signed envelope, publisher
key, kernel API compatibility, implementation manifest equality, and policy
before registering it. Dynamic module loading remains local-only.
