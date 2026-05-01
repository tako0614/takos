# Takos Deploy v1.0 Conformance Tests

This catalog defines acceptance tests for implementations of the
Deployment-centric Core surface defined in
[`../core/01-core-contract-v1.0.md`](../core/01-core-contract-v1.0.md). Tests
are grouped by conformance surface.

## Severity

```text
MUST    required for the relevant conformance surface
SHOULD  strongly recommended
MAY     optional
```

---

## Core conformance MUST tests

### Descriptor and Deployment resolution

- A resolved Deployment MUST include `Deployment.resolution.descriptor_closure`.
- Apply MUST use `Deployment.resolution.descriptor_closure` and MUST NOT
  re-fetch descriptor URLs or remote contexts to reinterpret meaning (invariant
  3).
- A descriptor digest change after resolution MUST surface a `DescriptorChanged`
  / `ReadSetChanged` condition and force re-resolution; the existing Deployment
  MUST NOT be silently re-pinned.
- Ambiguous alias expansion MUST block resolution (`DescriptorAliasAmbiguous`).
- A descriptor denied by PolicySpec MUST block resolution (`PolicyDenied`).
- Descriptors MUST be declarative; descriptors that contain arbitrary executable
  behavior MUST be rejected.
- Provider capability descriptors MUST NOT reinterpret contract semantics.

### ObjectAddress

- Every projection in `Deployment.resolution.resolved_graph` and every entry in
  `Deployment.desired.{routes,bindings,resources}` MUST carry an ObjectAddress.
- Operation idempotency keys MUST include the object address or an equivalent
  stable reference (default key:
  `deploymentId + operationKind + objectAddress + desiredDigest`).
- Rename MUST NOT be inferred by name similarity.

### Deployment lifecycle and activation

- `Deployment.desired` MUST be immutable once `Deployment.status="applied"`
  (invariant 8).
- `GroupHead.current_deployment_id` MUST select the current applied Deployment
  for a group and MUST advance atomically (invariant 11).
- Advancing GroupHead MUST be the canonical activation commit; the new
  Deployment MUST gain an `ActivationCommitted` condition.
- Assignments inside `Deployment.desired.activation_envelope` MUST sum to a
  total weight of 100 across `assignments[]`, with `primary_assignment` always
  present.
- Provider convergence failure MUST NOT mutate `Deployment.desired` or any prior
  Deployment's fields. Repair creates a new Deployment.
- A change to `Deployment.desired.routes` MUST require a new Deployment.
- A change to `Deployment.desired.runtime_network_policy` MUST require a new
  Deployment.
- Route-specific or protocol-specific assignments, if supported, MUST be
  represented in `Deployment.desired.activation_envelope.route_assignments` (or
  another envelope-owned digested field) and MUST NOT exist only in provider
  state.

### Provider state

- Provider apply progress (recorded as `Deployment.conditions[]` with
  `scope.kind="operation"`) MUST be separate from `ProviderObservation`.
- Observed provider state (ProviderObservation) MUST NOT become canonical
  desired state (invariant 9).
- A missing provider object MUST create a condition / repair Deployment, not a
  silent canonical mutation.

### Rollback

- Rollback MUST be a `GroupHead` pointer move that retargets
  `current_deployment_id` to a retained Deployment; no new Deployment is created
  for rollback itself (invariant 12).
- Rollback MUST NOT restore durable ResourceInstance state by default.
- Rollback MUST NOT reverse migrations by default.
- Rollback MUST use the retained `Deployment.input.manifest_snapshot` and the
  retained descriptor closure of the target Deployment, not a source rebuild.

---

## Binding conformance MUST tests

- Publication output MUST NOT be injected automatically.
- A new publication output MUST NOT be injected into existing
  `Deployment.desired.bindings`.
- Resource credential MUST NOT be a publication output by default.
- Provider-assigned output MUST NOT be directly injectable.
- Env target collisions MUST block resolution unless the runtime explicitly
  supports merge and precedence is declared.
- Secret or credential raw env injection MUST require contract support, grant,
  policy, and approval.
- The structure of `Deployment.desired.bindings` MUST be immutable after
  `applied` (invariant 8).
- Binding value resolution MUST record `resolvedVersion` / `resolvedAt` for each
  binding when available.
- `SecretVersionRevoked` MUST mark affected bindings degraded or require a new
  repair Deployment.

---

## Resource access conformance MUST tests

- Each `Deployment.desired.bindings[*]` MUST expose its access path entry to the
  Deployment record.
- AccessMode MUST be contract-scoped in the canonical
  `Deployment.resolution.resolved_graph`.
- Multiple valid access paths MUST be selected by EnvSpec/PolicySpec or
  resolution MUST block with alternatives.
- An access path with external `networkBoundary` MUST satisfy
  `Deployment.desired.runtime_network_policy`.
- Credential visibility MUST be represented for each access path stage that
  handles credentials.
- Cloudflare D1, R2, Queues, and Durable Objects MUST be represented through
  explicit access path entries on `Deployment.desired.bindings` when selected.
- Cloudflare provider plugins MUST fail closed when required operator-injected
  client references are missing; the PaaS kernel MUST NOT construct Cloudflare
  SDK/network clients by default.

---

## Router conformance MUST tests

- Routing meaning carried by `Deployment.desired.routes` MUST be
  protocol-agnostic.
- InterfaceDescriptor and RouteDescriptor compatibility MUST be checked before
  the activation envelope is finalized.
- Weighted assignment unsupported by descriptor/provider MUST block resolution.
- `ServingConverged` MUST be separate from `ActivationCommitted`.
- Provider/router convergence failure MUST create `ServingDegraded` or an
  equivalent `Deployment.conditions[]` entry.
- Cloudflare Containers MUST be treated as on-demand
  Worker/Durable-Object-backed materialization, not as the always-on provider
  baseline.
- Kubernetes or another external always-on provider plugin MUST satisfy
  long-running container workload conformance.

---

## Publication conformance MUST tests

- A publication resolution change MUST NOT mutate existing consumer bindings on
  previously applied Deployments.
- Publication withdrawal MUST prevent new consumers and stall/degrade existing
  consumers.
- Publication projection MUST NOT be ProviderObservation.
- A withdrawn publication MUST NOT remain discoverable as ready.
- An ambiguous short publication address MUST block resolution.

---

## Security conformance MUST tests

- Provider target credentials MUST NOT be visible to component runtime or build
  runtime.
- Credential injection MUST be auditable.
- A policy `deny` decision MUST NOT be overridden by approval unless break-glass
  is explicitly defined.
- A `Deployment.approval` MUST be valid only for the matching policy decision's
  subjectDigest.
- Descriptor policy bootstrap trust MUST NOT depend on the policy descriptor
  currently being evaluated.

---

## SHOULD tests

- The Deployment record SHOULD expose descriptor trust and policy decision
  summary.
- The Deployment record SHOULD expose materialization slot mapping.
- The Deployment record SHOULD expose binding resolution details for every
  consume.
- The Deployment record SHOULD expose access path limitations.
- Implementations SHOULD retain descriptors in Takos-controlled or immutable
  storage during the rollback window.
- ProviderObservation SHOULD classify drift reason via `drift_status`.

---

## MAY tests

- JSON-LD descriptors MAY be supported.
- Provider-fronted materialization MAY be supported.
- Route-specific assignments MAY be supported, but canonical desired state must
  live in `Deployment.desired.activation_envelope.route_assignments`.
- Advanced canary / shadow traffic MAY be supported by non-Core modules driving
  multiple Deployments.
