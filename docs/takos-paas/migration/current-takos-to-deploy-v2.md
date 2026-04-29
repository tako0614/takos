# Migration Plan: Current Takos Deploy to Deploy v2 v1.0

This document maps current Takos deploy concepts to Deploy v2 Core records.

## Migration principle

Do not migrate by changing runtime behavior first. First create projections and compatibility records so old deploy state can be represented in the new model.

```text
Current inventory
  -> canonical Component graph
  -> ResolvedGraph projections
  -> AppRelease / RouterConfig / RuntimeNetworkPolicy
  -> ActivationRecord / GroupActivationPointer
```

---

## Current primitive mapping

| Current concept | Deploy v2 mapping |
|---|---|
| worker | Component with runtime/artifact/interface contract instances |
| service/container | Component with runtime/artifact/interface contract instances |
| resource | ResourceInstance + ResourceBinding + descriptor-backed resource claim projection |
| route | Exposure + RouterConfig route/listener record |
| publication | PublicationDeclaration + PublicationResolution + optional PublicationProjection |
| consume edge | PublicationConsumerBinding or ResourceBinding-driven BindingSetRevision input |
| deployment | AppRelease + ProviderMaterialization records |
| current deployment pointer | GroupActivationPointer -> ActivationRecord |
| routing KV / dispatch table | ProviderMaterialization / ProviderObservation for RouterConfig |
| group deployment snapshot | Plan / ResolvedGraph / AppRelease / ActivationRecord history |
| rollback | New Plan that advances GroupActivationPointer to compatible prior ActivationRecord or creates equivalent new ActivationRecord |

---

## Step 1: descriptor set bootstrap

Create official descriptors for existing Takos primitives:

```text
runtime.js-worker@v1
artifact.js-module@v1
runtime.oci-container@v1
artifact.oci-image@v1
interface.http@v1
route.http@v1
resource.sql.sqlite-serverless@v1
resource.object-store.s3@v1
resource.queue.at-least-once@v1
publication.mcp-server@v1
publication.file-handler@v1
publication.ui-surface@v1
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
ResourceBinding
ResourceAccessPath, if consumed by a component
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
PublicationDeclaration
PublicationResolution
PublicationProjection where applicable
```

Current `consume[]` becomes:

```text
PublicationConsumerBinding
BindingSetRevision input
BindingValueResolution where secret/credential output is resolved
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
DescriptorClosure exists
ResolvedGraph digest exists
ObjectAddress mapping exists
ResourceInstance mapping exists
BindingSetRevision exists
RouterConfig exists
ActivationRecord exists
GroupActivationPointer exists
ProviderMaterialization records exist for current provider objects
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

But canonical API should move toward:

```text
component
contract instance
RouterConfig
PublicationDeclaration
BindingSetRevision
ActivationRecord
```
