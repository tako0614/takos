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

   - **5a (snapshot before forward migration)**: take a logical dump of
     `deploy_plans`, `deploy_activation_records`,
     `deploy_group_activation_pointers`, `deploy_operation_records`, and the
     structural columns of `resource_binding_set_revisions`. The v3 collapse
     migration drops these tables; the snapshot is the only path back to v2
     data if `db:migrate:rollback` is run later.
   - **5b (point-of-no-return marker)**: once the v3 collapse migration has
     completed and v3 endpoints are accepting traffic, retain the snapshot
     for at least the configured rollback window. Rolling back the v3
     collapse migration without restoring this snapshot is a *structural*
     revert only; deploy history is lost.

### v2 → v3 deterministic ID mapping {#v3-id-mapping}

The collapse migration (`20260430000010_unify_to_deployments`) preserves v2
ids so any retained reference (rollback target, audit trail, CLI output) keeps
resolving against v3 rows without a translation table.

| Rule | v2 source                                                     | v3 destination                                              | Note                                                                                                                            |
| ---- | ------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `deploy_activation_records.id` (plan has activations)         | `deployments.id`                                            | Preferred. Preserves any v2 `rollback_json -> targetActivationId`.                                                              |
| 2    | `deploy_plans.id` (plan has no activation_record)             | `deployments.id`                                            | Plan-only Deployments collapse to `status='resolved'` or `'failed'`.                                                            |
| 3    | `deploy_activation_records.id` (orphan: plan already pruned)  | `deployments.id`                                            | Same id space as Rule 1.                                                                                                        |
| 4    | `deploy_group_activation_pointers.activation_id`              | `group_heads.current_deployment_id`                         | Rule 1 guarantees the id survives.                                                                                              |
| 5    | most-recent prior `deployments` row for the same `group_id`   | `group_heads.previous_deployment_id`                        | Selected via `order by coalesce(applied_at, created_at) desc`; restricted to status `applied` / `rolled-back` and `id <> head`. |
| 6    | `deploy_operation_records.id`                                 | `deployments.conditions[].scope.ref`                        | Operation rows fold into `coalesce(activation_id, plan_id)`'s Deployment; the operation id is preserved in `scope.ref`.         |
| 7    | `deploy_activation_records.rollback_json.targetActivationId`  | `deployments.rollback_target`                               | Rule 1 ensures the target row still exists.                                                                                     |

Rule 5 is what closes H3 (Phase 18.2): without it, every migrated
`group_heads.previous_deployment_id` would be `NULL`, and v3
`POST /groups/:group_id/rollback` could never resolve the rollback target for
groups whose only previous deployment was created under v2.

### DB migration rollback strategy {#db-migration-rollback}

Forward-only migrations are unrecoverable in production. The Phase 18.2
migration runner (`apps/paas/src/adapters/storage/migration-runner/mod.ts`) and
the `db:migrate:down` / `db:migrate:rollback` CLI scripts therefore provide:

1. **Per-migration `down` clause** in `StorageMigrationStatement`. Each
   `down` reverts only the schema this migration created (or the columns it
   added) and is idempotent (`drop table if exists`, `drop column if exists`).
2. **`db:migrate:down --target=<version>`** rolls back every applied migration
   with `version > <version>` in reverse order; **`db:migrate:rollback
   --steps=<n>`** rolls back the N most recent applied migrations.
3. **Production guard**: `--env=production` refuses to execute unless the
   operator passes `--allow-production-rollback`. With that flag the CLI
   additionally requires either an interactive `ROLLBACK` prompt
   confirmation or the non-interactive `--confirm=ROLLBACK` form. Staging
   and local runs do not require these flags.
4. **Forward-only safety valve**: a migration may omit `down` to declare
   itself irreversible (the storage migration ledger itself is one such
   case). The down runner refuses to rollback past such a migration with
   `StorageMigrationDownNotSupportedError` rather than silently leaving
   schema drift.
5. **Data preservation**: down clauses revert structure, not data. Operators
   wanting full data rollback must restore from the snapshot taken in step
   5a above. The v3 collapse migration explicitly documents this in its
   `down` comment.

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
