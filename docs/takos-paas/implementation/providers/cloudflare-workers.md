# Cloudflare Workers Provider Implementation

Status: implementation guide, non-core.

Cloudflare Workers is the provider. **Workers for Platforms is not a Takos
provider mode and not a canonical Core axis.** It is the recommended Cloudflare
Workers implementation topology for tenant/user Workers: dispatch namespace,
dynamic dispatch Worker, user Workers, and optional outbound Worker.

This document describes how a Cloudflare Workers provider can materialize Takos
Deploy canonical component contracts. It does not change Takos Core semantics
([`../../core/01-core-contract-v1.0.md`](../../core/01-core-contract-v1.0.md)).

## Positioning

Cloudflare Workers can materialize the canonical contract tuple:

```text
runtime.js-worker@v1
artifact.js-module@v1
interface.http@v1
```

Optional contracts may be supported only when the implementation and conformance
tests prove them:

```text
interface.queue@v1
interface.schedule@v1
interface.event@v1
resource runtime-binding injection
```

The Core must not special-case Cloudflare. A self-hosted runtime provider, such
as `takos.runtime-host`, should be able to satisfy the same runtime contract
where possible.

## Cloudflare mapping

Workers for Platforms maps naturally onto these Takos concepts as an
implementation topology of the Cloudflare Workers provider:

| Takos concept                                 | Cloudflare Workers topology concept                                      |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Provider target                               | Cloudflare account + dispatch namespace + dispatch Worker                |
| Component revision                            | User Worker script in a dispatch namespace                               |
| Runtime contract                              | JavaScript Worker runtime                                                |
| Artifact contract                             | ESM Worker module bundle                                                 |
| HTTP interface                                | `fetch()` handler invoked by the dispatch Worker                         |
| Deployment.desired.routes                     | Host/path routing handled by Takos dispatch logic                        |
| Deployment.desired.activation_envelope        | Desired routed assignment from request to User Worker script name        |
| Deployment.conditions[] / ProviderObservation | Uploaded User Worker, attached bindings, dispatch route table generation |
| Deployment.desired.runtime_network_policy     | Custom limits, dispatch middleware, optional outbound Worker             |

## Reference architecture

```text
Incoming routed request
  -> Takos dynamic dispatch Worker
  -> route / tenant / activation lookup
  -> env.DISPATCHER.get(userWorkerName)
  -> User Worker fetch(request)
  -> optional outbound Worker for egress
```

The dispatch Worker is the public/runtime entrypoint for routed traffic. User
Workers do not own public routes directly. Takos routing, activation, canary
assignment, policy, and publication resolution remain canonical in the Takos
control plane.

## Provider target shape

Example EnvSpec-style provider target:

```yaml
providerTargets:
  cf-workers-production:
    provider: cloudflare.workers@v1
    accountRef: cf-prod-account
    dispatchNamespace: takos-tenants
    dispatchWorker: takos-dispatch
    credentialRef: cf-workers-deployer

providerMappings:
  componentShapes:
    materialize.cloudflare-workers-dispatch-js-http@v1:
      target: cf-workers-production
```

`Workers for Platforms` is intentionally not represented as
`mode: workers-for-platforms`. If an implementation needs to pin the topology,
it should select or derive a materialization profile such as:

```text
materialize.cloudflare-workers-dispatch-js-http@v1
```

The exact credential loading mechanism is implementation-specific. The Core only
requires the credential to be isolated from build and component runtimes and
audited when used.

## Materialization profile

The implementation should advertise a tuple profile, not independent capability
lists:

```yaml
componentMaterializationProfiles:
  - ref: materialize.cloudflare-workers-dispatch-js-http@v1
    contracts:
      runtime:
        ref: runtime.js-worker@v1
      artifact:
        ref: artifact.js-module@v1
      interfaces:
        - ref: interface.http@v1
          min: 1
          max: 1
    supportedInjectionModes:
      - runtime-binding
      - env
      - secret-ref
    limitations:
      - dispatch-namespace-backed
      - dynamic-dispatch-worker-required
      - user-worker-bindings-explicit-only
      - provider-runtime-limits-apply
```

Additional profiles such as queue consumer or schedule interfaces must be
separate profiles with their own conformance tests.

## Resolved Deployment behavior

A resolved Deployment targeting Cloudflare Workers should expose at least:

```text
- JS module artifact digest (Deployment.resolution.descriptor_closure)
- dispatch namespace (resolved_graph projection)
- generated User Worker script name
- compatibility date / flags if provider-native config uses them
- attached resource bindings (Deployment.desired.bindings)
- custom limits if configured
- outbound Worker / egress enforcement status if configured
- dispatch route table generation
- activation assignment to script names (Deployment.desired.activation_envelope)
- API rate-limit risk / provider operation queueing
```

Deployment resolution must block (status="failed" with the appropriate
`Deployment.conditions[].reason`) if:

```text
- runtime.js-worker@v1 cannot be satisfied by the selected provider target
- artifact.js-module@v1 is invalid or unsupported
- requested runtime features are unsupported
- requested injection mode is unsupported
- resource binding material cannot be attached to the User Worker
- egress policy requires enforcement but only advisory/unsupported enforcement is available
- required descriptor trust has been revoked or denied by PolicySpec
```

## Apply behavior

Apply should follow this outline (each step appends a `Deployment.conditions[]`
entry with `scope.kind="operation"`):

```text
1. Revalidate the Deployment resolution read set.
2. Build or reuse the prepared JS module artifact.
3. Upload or update the User Worker script in the dispatch namespace.
4. Attach declared bindings to the User Worker.
5. Record provider apply progress (script name, namespace, descriptor digests, binding generation).
6. Probe the User Worker through the dispatch Worker when possible.
7. Resolve runtime + binding desired state from Deployment.desired.bindings.
8. Resolve route + network desired state from Deployment.desired.{routes,runtime_network_policy}.
9. Validate activation preview against Deployment.desired.activation_envelope.
10. Persist Deployment.status="applied" with applied_at set.
11. Advance GroupHead.current_deployment_id atomically.
12. Materialize dispatch route table / activation assignment generation.
13. Observe ServingConverged via ProviderObservation, or mark ServingDegraded.
```

Apply must not mutate `Deployment.desired`. Any canary step or rollback uses a
new Deployment (or a GroupHead pointer move for rollback).

## Activation and canary

Cloudflare Workers does not own Takos activation semantics. Takos dispatch logic
should materialize `Deployment.desired.activation_envelope` assignments.

All-at-once:

```text
route -> user-worker-rel-new : 100%
```

Canary:

```text
route -> user-worker-rel-old : 90%
route -> user-worker-rel-new : 10%
Deployment.desired.activation_envelope.primary_assignment.componentAddress
  = component:rel_old
```

The dispatch Worker can choose a script name according to the activation
envelope weights and then call the selected User Worker through the dispatch
namespace binding.

Weighted assignment is routed-serving only. Queue/schedule/event delivery
remains bound to `Deployment.desired.activation_envelope.non_routed_defaults`
unless a separate event canary contract is implemented.

## Resource bindings

Cloudflare Workers resource bindings should be treated as
`Deployment.desired.bindings` material (with the inline `accessPath` per
binding), not publication outputs.

Examples:

```text
D1 / SQLite-like DB -> resource-runtime-binding or sql-runtime-binding
KV -> resource-runtime-binding if a descriptor exists
R2 / object storage -> runtime-binding or S3-style env only if contract permits
Queues -> queue runtime binding for queue producers/consumers when supported
Durable Objects -> runtime binding or provider coordination object when declared
Secrets -> secret-ref / runtime secret binding
```

Resource credentials should not be exposed as publication outputs by default.

Cloudflare-injected runtime bindings are the preferred component access path for
D1, R2, Queues, and Durable Objects. Control-plane operations such as script
upload, D1 migration, R2 bucket provisioning, queue provisioning, and Durable
Object namespace setup require operator-injected client references in the
trusted Cloudflare plugin configuration. The PaaS kernel must not construct
Cloudflare SDK/network clients by default, and the Cloudflare plugin must fail
closed when a required operator client reference is missing. In staging and
production the required client set includes the request actor/auth adapters as
well as provider, storage, runtime-agent, and the other selected PaaS ports.

## Runtime network policy

Cloudflare Workers can support parts of
`Deployment.desired.runtime_network_policy` through:

```text
- dispatch Worker middleware
- custom limits for CPU/subrequests
- optional outbound Worker for egress allow/block/logging
- platform-side auth/rate limit checks before User Worker invocation
```

The provider must report enforcement level:

```text
enforced | advisory | unsupported
```

If PolicySpec requires enforced egress or private network denial, advisory or
unsupported enforcement must block Deployment resolution.

## Provider operation queue

Cloudflare API operations are provider operations and should be queued with
idempotency keys (default
`deploymentId + operationKind + objectAddress + desiredDigest`) and
retry/backoff. The implementation should handle API rate limits and record
provider operation reasons via `Deployment.conditions[]`
(`scope.kind="operation"`) such as:

```text
ProviderRateLimited
ProviderCredentialDenied
ProviderObjectConflict
ProviderOperationTimedOut
ProviderPackageExecutionFailed
```

## Non-goals

Cloudflare Workers provider implementation must not:

```text
- redefine runtime.js-worker@v1 semantics
- treat Workers for Platforms as a Core kind or provider mode
- expose resource credentials as publication outputs by default
- mutate Deployment.desired after Deployment.status="applied"
- make provider state canonical (ProviderObservation is observed-side only)
- hide provider limitations from the Deployment record
```

## Relationship to self-hosted runtime

Cloudflare Workers is a cloud provider target, not a core assumption. Apps
written against portable contracts should be able to run on a self-hosted
JavaScript runtime provider unless they request provider-native Cloudflare
features.
