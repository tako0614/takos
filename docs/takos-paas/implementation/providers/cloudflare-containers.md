# Takos Deploy v2 Cloudflare Containers Provider Notes

Cloudflare Containers should be implemented as a provider target, not as a Takos Core kind.

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

Provider-created Worker / Durable Object / Container bridge objects are ProviderMaterialization records, not AppSpec components, unless the user explicitly declares them.

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
          pingEndpoint: "localhost/ready"
          instanceType: "basic"
          maxInstances: 10
```

These values belong in EnvSpec / PolicySpec unless they are truly app-behavior requirements.

## RuntimeNetworkPolicy

Cloudflare Containers should prefer controlled egress:

```text
enableInternet=false
+ outbound bridge / virtual host handler
+ explicit RuntimeNetworkPolicy allowlist
```

Resource access should be represented as BindingSetRevision material, not as publication output.

## Activation

Cloudflare Containers does not change activation semantics.

```text
ActivationRecord:
  desired HTTP serving assignment

ProviderMaterialization:
  Worker / Durable Object / Container class / image / route materialization

Observed provider state:
  convergence, readiness, rollout progress
```

`ActivationCommitted` and `ServingConverged` are distinct.

## Artifact retention

Container image availability is required for rollback.

ProviderMaterialization / WorkloadRevision should record:

```text
source image digest
provider registry image ref
provider image digest/ref
retention deadline
rollback protection reason
```

Images referenced by current activation, rollback windows, retained releases, or prepared plans must be protected from garbage collection.

## Cloudflare references

- Cloudflare Containers overview: https://developers.cloudflare.com/containers/
- Container Interface: https://developers.cloudflare.com/containers/container-class/
- Lifecycle / architecture: https://developers.cloudflare.com/containers/platform-details/architecture/
- Image management: https://developers.cloudflare.com/containers/platform-details/image-management/
- Pricing: https://developers.cloudflare.com/containers/pricing/
