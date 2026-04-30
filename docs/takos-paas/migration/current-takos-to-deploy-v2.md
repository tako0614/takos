# Migration Plan: Current Takos Deploy to Deploy v3 v1.0

This document maps current Takos deploy concepts onto the v3 Deployment-centric
records, then preserves the legacy v2 Core object coverage matrix that the
migration validator (`scripts/validate-migration-core-coverage.ts`) consumes.
The legacy v2 coverage matrix is retained verbatim as a compatibility shim and
is the **only** location in `takos-paas/` (outside this file) where v2 record
names like `CorePlan`, `CoreApplyRun`, `CoreActivationRecord`,
`CoreBindingSetRevision`, `CoreGroupActivationPointer`, `CoreProviderMaterialization`,
`CoreRouterConfig`, and `CoreRuntimeNetworkPolicy` appear; everywhere else the
docs use the v3 record names (`Deployment`, `ProviderObservation`, `GroupHead`).

## v2 → v3 record collapse {#v3-collapse}

v3 collapses the v2 record set onto three records. The full mapping table lives
in [`../core/01-core-contract-v1.0.md`](../core/01-core-contract-v1.0.md) § 18;
the summary is:

| v2 record / concept            | v3 location                                                          |
| ------------------------------ | -------------------------------------------------------------------- |
| Plan                           | Deployment with status `resolved` (and beyond)                       |
| ApplyRun                       | Deployment status transition `applying` -> `applied`                 |
| ApplyPhase                     | Deployment.conditions[] entries with `scope.kind="phase"`            |
| OperationRun                   | Deployment.conditions[] entries with `scope.kind="operation"`        |
| RolloutRun                     | Deployment.desired.activation_envelope.rollout_strategy              |
| AppRelease                     | Deployment itself; the Deployment is the release                     |
| ActivationRecord               | Deployment.desired.activation_envelope                               |
| GroupActivationPointer         | GroupHead                                                            |
| BindingSetRevision             | Deployment.desired.bindings                                          |
| RouterConfig                   | Deployment.desired.routes (+ activation_envelope.route_assignments)  |
| RuntimeNetworkPolicy           | Deployment.desired.runtime_network_policy                            |
| DescriptorClosure              | Deployment.resolution.descriptor_closure                             |
| ResolvedGraph                  | Deployment.resolution.resolved_graph                                 |
| CoreProjectionRecord           | Deployment.resolution.resolved_graph.projections                     |
| CorePolicyDecisionRecord       | Deployment.policy_decisions[]                                        |
| CoreApprovalRecord             | Deployment.approval                                                  |
| ProviderMaterialization        | Deployment.conditions[] (apply-time, scope.kind="operation")         |
| ProviderObservation            | ProviderObservation (retained as a separate stream)                  |
| ResourceInstance               | retained as an independent record                                    |
| MigrationLedger                | retained as an independent record                                    |

### v3 migration steps

1. Resolve every active group's most recent applied state into a single
   `Deployment` record with `status="applied"`. The `Deployment.input.manifest_snapshot`
   is the manifest that produced the v2 Plan; `Deployment.resolution` is built by
   joining the v2 Plan's DescriptorClosure + ResolvedGraph; `Deployment.desired`
   joins v2 BindingSetRevision + RouterConfig + RuntimeNetworkPolicy +
   ActivationRecord; `Deployment.policy_decisions[]` and `Deployment.approval`
   absorb v2 CorePolicyDecisionRecord / CoreApprovalRecord; provider apply
   progress and observation results are projected into `Deployment.conditions[]`
   with `scope.kind="operation"` (or into `ProviderObservation` for observed-side
   data).
2. Synthesize one `GroupHead` per group. `GroupHead.current_deployment_id` is
   the Deployment id from step 1; `GroupHead.previous_deployment_id` is the
   prior applied Deployment if available; `generation` is preserved from the v2
   GroupActivationPointer.
3. Backfill historical Deployments from older v2 Plans / ApplyRuns / ActivationRecords
   that fall inside the rollback window. Deployments outside the rollback window
   MAY be archived without `resolution`/`desired` payloads.
4. Replay any in-flight v2 ApplyRun as a fresh v3 Deployment in `applying`
   status; do not migrate its mutable apply-phase state.
5. Switch CLI / public API callers to `POST /api/public/v1/deployments`,
   `POST /api/public/v1/deployments/:id/apply`, and
   `POST /api/public/v1/groups/:group_id/rollback`. Decommission
   `/api/public/v1/deploy/plans`, `/api/public/v1/deploy/applies`, and
   `/api/public/v1/spaces/:spaceId/group-deployment-snapshots/*`. Spec § 17
   carries the full path mapping.

The legacy v2 migration steps below are retained for the migration validator
(coverage matrix + descriptor bootstrap + safety checklist) and for operators
running the projection layer that bridges legacy v2 stores into the v3 record
shape.

---

## Migration principle (v2 compatibility projection)

Do not migrate by changing runtime behavior first. First create projections and compatibility records so old deploy state can be represented in the new model.

```text
Current inventory
  -> canonical Component graph
  -> ResolvedGraph projections
  -> AppRelease / RouterConfig / RuntimeNetworkPolicy
  -> ActivationRecord / GroupActivationPointer
  -> Deployment (with resolution / desired / status / conditions) + GroupHead
```

---

## Current primitive mapping

| Current concept | Deploy v2 mapping |
|---|---|
| worker | Component with runtime/artifact/interface contract instances |
| service/container | Component with runtime/artifact/interface contract instances |
| resource | ResourceInstance + CoreBindingResolutionInput + descriptor-backed resource claim projection |
| route | Exposure + RouterConfig route/listener record |
| publication | CorePublicationSpec + CorePublicationResolution + CoreProjectionRecord when projected |
| consume edge | CoreBindingResolutionInput-driven CoreBindingSetRevision input |
| deployment | AppRelease + ProviderMaterialization records |
| current deployment pointer | GroupActivationPointer -> ActivationRecord |
| routing KV / dispatch table | ProviderMaterialization / ProviderObservation for RouterConfig |
| group deployment snapshot | Plan / ResolvedGraph / AppRelease / ActivationRecord history |
| rollback | New Plan that advances GroupActivationPointer to compatible prior ActivationRecord or creates equivalent new ActivationRecord |

---

## Core object coverage matrix

This matrix is the migration validator source. Each current coverage area must name the concrete Core objects that preserve its meaning during the compatibility projection.

| Current coverage area | Required Core object coverage |
|---|---|
| worker | `CoreAppSpec`, `CoreComponentSpec`, `CoreContractInstanceSpec`, `CoreDescriptorClosure`, `CoreResolvedGraph` |
| service/container | `CoreAppSpec`, `CoreComponentSpec`, `CoreContractInstanceSpec`, `CoreDescriptorClosure`, `CoreResolvedGraph` |
| resource | `ResourceInstance`, `CoreBindingResolutionInput`, `CoreResourceAccessPath`, `CoreBindingSetRevision`, `CoreProviderMaterialization` |
| route | `CoreExposureSpec`, `RouterConfig`, `CoreActivationRecord`, `CoreRouteActivationAssignment`, `CoreProviderMaterialization`, `CoreProviderObservation` |
| publication | `CorePublicationSpec`, `CorePublicationResolution`, `CoreProjectionRecord` |
| consume edge | `CoreConsumeSpec`, `CoreBindingSetRevision`, `CoreBindingResolutionReport`, `CoreBindingResolutionInput` |
| deployment | `CorePlan`, `CorePlannedOperation`, `AppRelease`, `CoreProviderMaterialization` |
| current deployment pointer | `GroupActivationPointer`, `CoreActivationRecord` |
| routing KV / dispatch table | `RouterConfig`, `CoreProviderMaterialization`, `CoreProviderObservation` |
| group deployment snapshot | `CorePlan`, `CoreResolvedGraph`, `AppRelease`, `CoreActivationRecord` |
| rollback | `CorePlan`, `CorePlanReadSetEntry`, `CoreActivationRecord`, `GroupActivationPointer`, `ResourceInstance` |

---

## Step 1: descriptor set bootstrap

Create official descriptors for existing Takos primitives:

```text
runtime.js-worker@v1
artifact.js-module@v1
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
interface.tcp@v1
interface.queue@v1
interface.schedule@v1
interface.event@v1
resource.sql.sqlite-serverless@v1
resource.sql.postgres@v1
resource.object-store.s3@v1
publication.mcp-server@v1
publication.http-endpoint@v1
publication.topic@v1
```

Pin descriptor digests in a DescriptorClosure for every migrated group.

---

## Step 2: convert current inventory to components

Example worker conversion:

```text
current worker web
  -> app.component:web
  -> runtime.js-worker@v1
  -> artifact.js-module@v1
  -> interface.http@v1 if routed
```

Example container conversion:

```text
current service api
  -> app.component:api
  -> runtime.oci-container@v1
  -> artifact.oci-image@v1
  -> interface.http@v1 if routed
```

Do not expose `kind` as canonical. It may remain in authoring/exported convenience manifests.

---

## Step 3: convert resources

Current resource record:

```text
D1 / R2 / queue / SQL / object-store
```

becomes:

```text
ResourceInstance
CoreBindingResolutionInput
CoreResourceAccessPath, if consumed by a component
```

Resource credentials are not publications by default.

---

## Step 4: convert routes

Current route:

```text
hostname/path -> workload
```

becomes:

```text
Exposure target -> component contract instance
RouterConfig route/listener -> exposure
ProviderMaterialization -> actual router/gateway/dispatch state
```

For Cloudflare dispatch, routing table/KV/DO/dispatch namespace state is ProviderMaterialization and ProviderObservation, not canonical desired state.

---

## Step 5: convert publish / consume

Current `publish[]` becomes:

```text
CorePublicationSpec
CorePublicationResolution
CoreProjectionRecord where applicable
```

Current `consume[]` becomes:

```text
CoreBindingResolutionInput
CoreBindingSetRevision input
CoreBindingValueResolution where secret/credential output is resolved
```

Legacy `consume.env` that implicitly injected unspecified outputs should be converted to explicit output injection.

---

## Step 6: create AppRelease and ActivationRecord history

For each successful current deployment snapshot:

```text
create AppRelease
create RouterConfig
create RuntimeNetworkPolicy, even if empty/default
create ActivationRecord
```

The current successful snapshot becomes:

```text
GroupActivationPointer.currentActivationRecordId
```

---

## Step 7: rollback behavior

Current rollback becomes Deploy v2 rollback Plan:

```text
select prior compatible ActivationRecord/AppRelease
check current ResourceInstance compatibility
check RouterConfig/RuntimeNetworkPolicy compatibility
create/advance GroupActivationPointer
```

Rollback does not restore DB/object-store/queue/secret values.

---

## Step 8: migration safety checklist

Before enabling Deploy v2 Apply for a group:

```text
CoreDescriptorClosure exists
CoreResolvedGraph digest exists
ObjectAddress mapping exists
ResourceInstance mapping exists
CoreBindingSetRevision exists
RouterConfig exists
CoreActivationRecord exists
GroupActivationPointer exists
CoreProviderMaterialization records exist for current provider objects
```

---

## Step 9: deprecate old terms carefully

Old terms may remain in CLI/authoring for compatibility:

```text
worker
service
container
route
publish
consume
```

But canonical API should move toward the v3 Deployment-centric vocabulary:

```text
component
contract instance
Deployment.desired.routes
CorePublicationSpec
Deployment.desired.bindings
Deployment.desired.activation_envelope
GroupHead
ProviderObservation
```
