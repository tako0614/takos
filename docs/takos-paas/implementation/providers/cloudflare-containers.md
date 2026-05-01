# Takos Deploy Cloudflare Containers Provider Notes

Cloudflare Containers should be implemented as a provider target, not as a Takos
Core kind. The current surface exposes this through the Deployment record
([`../../core/01-core-contract-v1.0.md`](../../core/01-core-contract-v1.0.md)).

## Position

Cloudflare Containers materializes this canonical component tuple:

```text
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
```

The materialization is provider-fronted:

```text
request
  -> Worker / gateway
  -> Durable Object-backed Container class
  -> Container instance
```

Provider-created Worker / Durable Object / Container bridge objects are surfaced
through `Deployment.conditions[]` (apply-time scope.kind="operation") and the
ProviderObservation stream, not as AppSpec components, unless the user
explicitly declares them.

Cloudflare Containers are on-demand container materialization behind the
Worker/Durable Object bridge. They may use provider-native warmup or
`sleepAfter` policy, but Takos must not document them as an always-on container
provider. Kubernetes or another external always-on provider plugin can satisfy
workloads that need long-running process, pod/service, or cluster networking
semantics.

## Capability descriptor

```yaml
materializationProfiles:
  - ref: materialize.cloudflare-container-http@v1
    requiredContractSlots:
      - slot: runtime
        ref: runtime.oci-container@v1
        min: 1
        max: 1
      - slot: artifact
        ref: artifact.oci-image@v1
        min: 1
        max: 1
      - slot: httpInterface
        ref: interface.http@v1
        min: 1
        max: many
    limitations:
      - worker-fronted
      - durable-object-backed
      - http-ingress-only
      - no-direct-end-user-tcp-udp
      - provider-managed-placement
      - image-retention-required-for-rollback
```

## Provider-native config

```yaml
providerNative:
  cloudflare.containers.class@v1:
    components:
      api:
        values:
          defaultPort: 8080
          requiredPorts: [8080]
          sleepAfter: "5m"
          enableInternet: false
          pingEndpoint: "healthz"
          instanceType: "basic"
          maxInstances: 10
```

These values belong in EnvSpec / PolicySpec unless they are truly app-behavior
requirements. `pingEndpoint` is the Cloudflare Container liveness probe. It is
not runtime-service `GET /ping`, which remains an authenticated control-plane
smoke probe.

## Runtime network policy

Cloudflare Containers should prefer controlled egress:

```text
enableInternet=false
+ outbound bridge / virtual host handler
+ explicit Deployment.desired.runtime_network_policy allowlist
```

Resource access should be represented as `Deployment.desired.bindings` material,
not as publication output.

D1, R2, Queues, and Durable Objects should be reached through explicit
`Deployment.desired.bindings[*].accessPath` entries. For container workloads,
that usually means an internal endpoint or provider mediator that uses
Cloudflare-injected Worker bindings. Control-plane operations still require
operator-injected client references in the trusted Cloudflare plugin. In staging
and production this includes the auth/actor boundary and every required PaaS
adapter selected for the profile; the PaaS kernel does not construct Cloudflare
SDK/network clients by default.

## Activation

Cloudflare Containers does not change activation semantics.

```text
Deployment.desired.activation_envelope:
  desired HTTP serving assignment

Deployment.conditions[] (scope.kind="operation"):
  Worker / Durable Object / Container class / image / route apply progress

ProviderObservation:
  convergence, readiness, rollout progress
```

`ActivationCommitted` and `ServingConverged` are distinct
`Deployment.conditions[]` reasons.

## Artifact retention

Container image availability is required for rollback.

The provider plugin should record (typically alongside ProviderObservation
metadata):

```text
source image digest
provider registry image ref
provider image digest/ref
retention deadline
rollback protection reason
```

Images referenced by the current Deployment via `GroupHead`, by retained
Deployments inside the rollback window, or by any resolved-but-not-yet-applied
Deployment must be protected from garbage collection.

## Cloudflare references

- Cloudflare Containers overview: https://developers.cloudflare.com/containers/
- Container Interface:
  https://developers.cloudflare.com/containers/container-class/
- Lifecycle / architecture:
  https://developers.cloudflare.com/containers/platform-details/architecture/
- Image management:
  https://developers.cloudflare.com/containers/platform-details/image-management/
- Pricing: https://developers.cloudflare.com/containers/pricing/
