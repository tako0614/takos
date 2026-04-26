# Takos System Architecture - Final

このドキュメントは Takos 全体の構成、各 repository / service / domain の責務、相互関係、通信方式、authority、standalone / integrated / distributed topology を 1 枚で読めるようにまとめた architecture map です。

これは `takos-paas` だけの設計書ではありません。Takos 全体の architecture map です。

Takos は、AI agent が software を作り、配布し、運用し、ユーザーや tenant に届けるための AI-native PaaS software です。

最終方針:

```text
takos-paas は Takos の構成要素として残す。
takos-paas は standalone PaaS としても単体起動できる。
takos-paas から deploy/runtime/registry/audit を別 service としてさらに分けない。
takos-paas 内部は domain module と process role で分ける。
```

Core rule:

```text
Same PaaS core semantics.
Different host modes.
Different adapters.
No default microservice split inside takos-paas.
```

`takos-paas` standalone は UX としては Coolify-like PaaS ですが、内部意味論は Takos-native です。

```text
Coolify-like UX:
  apps / deployments / resources / domains / secrets / providers / logs / backups

Takos-native semantics:
  Plan / Apply / ActivationRecord / RuntimeNetworkPolicy / ResourceContract / DataContract / ProviderPackage / Agent-created app lifecycle
```

---

## 1. Final product architecture

### 1.1 Full Takos distribution

```text
User / Browser / CLI
  │
  ▼
takos-app
  public API gateway / auth / account / billing / OAuth / product UI shell
  │ signed internal RPC
  ▼
takos-paas
  PaaS control plane
  tenant / space / entitlement / deploy / runtime / resource / routing / network / registry / audit
  │
  ├── takos-git
  │     source truth / repositories / refs / objects / source resolution
  │
  ├── takos-agent
  │     agent execution service, backed by takos-agent-engine
  │
  ├── runtime agents
  │     docker hosts / GPU hosts / edge hosts / other runtime hosts
  │
  ├── provider targets
  │     Cloudflare / Cloud Run / Kubernetes / Docker host / AWS / GCP / external providers
  │
  └── audit / observability / registry / provider APIs
```

### 1.2 Standalone Takos PaaS distribution

```text
User / Browser / CLI
  │ HTTPS
  ▼
takos-paas
  standalone PaaS control plane
  public API / UI / local or OIDC auth
  deploy / runtime / resources / routing / network / registry / audit
  │
  ├── source connectors
  │     GitHub / GitLab / Gitea / raw Git / local upload / tarball
  │
  ├── runtime agents
  │     local docker / remote docker / GPU host / edge host
  │
  ├── provider targets
  │     Docker / Kubernetes / Cloud Run / Cloudflare / S3 / Postgres / etc
  │
  ├── local or remote registry
  │
  └── local or remote audit / observability sink
```

### 1.3 Distributed topology

Takos components may run on different clouds, servers, or networks.

```text
Cloudflare / edge:
  takos-app or public edge gateway

VPS / Kubernetes / private cloud:
  takos-paas primary control plane

GitHub / Gitea / takos-git:
  source truth

Docker host / bare metal / GPU host:
  runtime-agent

GCP / AWS / Cloudflare / Kubernetes:
  provider targets

Object storage / DB / audit sink:
  remote support infrastructure
```

Distributed topology is allowed, but canonical writes use a primary control-plane authority.

```text
Distributed dependencies are allowed.
Distributed canonical writers are not assumed.
```

---

## 2. Core service set

Target service set:

| service | product root | responsibility |
|---|---|---|
| `takos-app` | `takos/app` | public API gateway, auth, account, billing, OAuth, product UI shell |
| `takos-paas` | `takos/paas` | standalone-capable PaaS control plane and Full Takos internal PaaS component |
| `takos-git` | `takos/git` | Git hosting, repository object storage, source truth, source resolution |
| `takos-agent` | `takos/agent` | agent execution service |
| `takos-cli` | `takos-cli` | user/operator CLI |
| `takos-private` | `takos-private` | private operator config, secrets, production/staging deploy config |

`takos-deploy` and `takos-runtime` are not target top-level product roots. They are internal domains of `takos-paas`.

```text
takos-deploy as product root:
  absorbed into takos/paas domains/deploy

takos-runtime as product root:
  absorbed into takos/paas domains/runtime
```

Their semantics remain. Their standalone service boundary is removed unless future scale requires extraction.

```text
Service boundary can be merged.
Domain boundary must remain.
```

`takos-agent-engine` is a Rust library, not a service.

Default apps are first-party apps, not Takos core services:

```text
takos-docs
takos-slide
takos-excel
takos-computer
yurucommu
user-created apps
```

They deploy through the same PaaS / deploy / runtime / tenant context model as user apps.

---

## 3. takos-paas final role

`takos-paas` is the Takos PaaS control plane.

It owns platform context and coordinates deploy/runtime/resource/routing/registry/audit domains.

It is both:

```text
1. a component of Full Takos
2. a standalone-capable PaaS product
```

Integrated and standalone modes run the same PaaS core. They differ by host and adapters.

### 3.1 takos-paas does own

```text
tenant / space / group platform context
membership and role context
entitlement and effective policy context
route ownership and domain ownership
PaaS control-plane domain model
Plan / Apply / Activation through deploy domain
runtime materialization coordination through runtime domain
ResourceInstance / ResourceBinding lifecycle through resources domain
RuntimeNetworkPolicy through network domain
ProviderPackage / ResourceContractPackage / DataContractPackage through registry domain
audit projection and security events through audit domain
```

### 3.2 takos-paas does not own

```text
Full Takos public account/profile/billing shell when integrated
Git object truth when integrated with takos-git
agent model/tool execution when integrated with takos-agent
provider cloud truth
observed provider state as canonical truth
tenant workload code semantics
operator secrets in plaintext
```

### 3.3 takos-paas modes

```text
Integrated mode:
  takos-paas is an internal component of Full Takos.
  takos-app owns public auth and API gateway.
  takos-git owns source truth.
  takos-agent owns agent execution.
  takos-private owns operator config and secrets.

Standalone mode:
  takos-paas is independently bootable.
  It includes public API, UI shell, auth adapter, source connectors, deploy/runtime/resource/routing/registry/audit domains, and provider adapters.
```

Invariant:

```text
takos-paas core must not know whether it is integrated or standalone.
Host mode is selected by adapters.
```

---

## 4. takos-paas implementation architecture

`takos-paas` remains one product root. It is not split into many default microservices.

It may run multiple process roles, but its domain model stays in one product.

Recommended code structure:

```text
takos/paas/src/api
  public API / standalone host / integrated internal API / capabilities endpoint

takos/paas/src/domains/core
  tenant / space / group / membership / entitlement / ownership

takos/paas/src/domains/deploy
  Plan / ApplyRun / OperationRun / RolloutRun / ActivationRecord / GroupActivationPointer

takos/paas/src/domains/runtime
  WorkloadRevision / ProviderMaterialization / ObservedProviderState / logs / health / readiness

takos/paas/src/domains/resources
  ResourceInstance / ResourceBinding / MigrationLedger / restore / backup metadata

takos/paas/src/domains/routing
  route ownership / domain ownership / ingress materialization / RouteProjection

takos/paas/src/domains/network
  RuntimeNetworkPolicy / ServiceGrant / WorkloadIdentity / egress satisfaction

takos/paas/src/domains/registry
  ProviderPackage / ResourceContractPackage / DataContractPackage / PackageResolution / trust

takos/paas/src/domains/audit
  append-only audit / audit projection / security events

takos/paas/src/workers
  Apply jobs / provider materialization / repair / registry sync / outbox consumers / background tasks

takos/paas/src/agents
  runtime agent protocol / work leases / host operations / heartbeat / drain / revoke

takos/paas/src/adapters
  auth / source / agent / billing / secret store / provider / registry / audit adapters

takos/paas/src/shared
  ids / errors / conditions / common contracts / utility types
```

This is code and process organization, not service decomposition.

### 4.1 Process roles

`takos-paas` may run multiple process roles from the same product root.

```text
takos-paas-api:
  HTTP API / UI / auth / request handling
  must not run long provider operations

takos-paas-worker:
  ApplyRun / build / provider materialization / outbox event processing
  must not serve tenant HTTP traffic

takos-paas-router:
  runtime request routing, if hosted by PaaS
  must not mutate Plan/Apply/Activation state

takos-paas-runtime-agent:
  Docker host / local runtime host operation
  must not own ActivationRecord

takos-paas-log-worker:
  logs / metrics / redaction
  must not receive provider credentials
```

### 4.2 Domain boundary rules

Each domain exposes:

```text
commands
queries
events
ports
store interface
```

Other domains must not import a domain's store/repository directly.

Examples:

```text
runtime may read ActivationRecord projection but must not mutate ActivationRecord.
deploy may request runtime materialization but must not write observed runtime state.
registry may resolve packages but must not apply provider operations.
audit records facts but must not become business logic.
routing may read activation and ownership projections but must not infer tenant authority alone.
```

Service split is a scale/operation decision, not a semantic requirement.

---

## 5. Authority and consistency model

Takos supports distributed dependencies and remote agents, but canonical writes use a primary control-plane authority.

### 5.1 Strong consistency required

```text
tenant / space / group ownership writes
membership and role writes
entitlement decisions at mutation boundaries
Plan / Apply locks
GroupActivationPointer advancement
ActivationRecord creation
ResourceMigrationLock
provider package trust decisions
provider credential binding
secret binding resolution
route ownership writes
```

### 5.2 Eventual consistency allowed

```text
runtime health
route projections and runtime route cache
workload logs
metrics
provider observed state
audit UI projection
registry metadata cache
billing usage aggregates
```

Important invariant:

```text
GroupActivationPointer update must be strongly consistent.
ProviderMaterialization observation may be eventually consistent.
```

---

## 6. Ports, adapters, and capabilities

Takos PaaS depends on capabilities, not concrete services.

```text
AuthCapability
SourceCapability
AgentCapability
BillingCapability
EntitlementCapability
SecretStoreCapability
RuntimeHostCapability
ProviderMaterializationCapability
AuditSinkCapability
RegistryCapability
NotificationCapability
OperatorConfigCapability
```

Examples:

```text
takos-git:
  SourceCapability provider

GitHub:
  SourceCapability provider

takos-agent:
  AgentCapability provider

disabled agent adapter:
  AgentCapability provider with no execution support
```

### 6.1 Main ports

| port | integrated adapter | standalone adapter |
|---|---|---|
| AuthPort | `takos-app` | local / OIDC / GitHub OAuth |
| SourcePort | `takos-git` | GitHub / GitLab / raw Git / local upload / tarball |
| AgentPort | `takos-agent` | disabled / local / external |
| BillingPort | `takos-app` billing | noop / license |
| EntitlementPolicyPort | `takos-paas` / product policy | local entitlement policy |
| SecretStorePort | platform secret resolver | local encrypted store / secret manager |
| ProviderRegistryPort | platform registry | bundled / local / remote registry |
| OperatorConfigPort | `takos-private` | local config / env / secret manager |
| AuditSinkPort | platform audit | local / remote audit sink |

### 6.2 ActorContext

Host mode changes auth adapter, not the shape of identity seen by the PaaS core.

```ts
interface ActorContext {
  actorId: string;
  actorType: "user" | "service" | "agent";
  identityProvider: "takos-app" | "local" | "oidc" | "github" | "service";
  tenantId?: string;
  spaceId?: string;
  roles: string[];
  requestId?: string;
  reason?: string;
}
```

Rule:

```text
Auth adapter is different.
ActorContext shape is the same.
```

### 6.3 SourceSnapshot

SourcePort output is immutable.

```ts
interface SourceSnapshot {
  sourceKind: "git" | "local-upload" | "tarball" | "catalog";
  originalRef?: string;
  resolvedCommit?: string;
  contentDigest: string;
  treeDigest?: string;
  resolvedAt: string;
}
```

Rules:

```text
Git branch/tag input must resolve to commit digest.
Local upload must resolve to content digest.
Tarball must resolve to archive/content digest.
Deploy never treats moving ref as immutable truth.
```

### 6.4 Billing and entitlement separation

Billing and entitlement are different.

```text
BillingPort:
  account/license/payment/source of commercial plan

EntitlementPolicyPort:
  effective allowed capabilities and limits
```

Standalone mode may use `BillingPort = noop`, but still must have EntitlementPolicy.

---

## 7. Distributed topology and service endpoints

A dependency may be attached as:

```text
embedded:
  same process

local-service:
  same host, different process

remote-service:
  different server or cloud

external-api:
  external SaaS/API

pull-agent:
  runtime agent pulls work from control plane
```

### 7.1 ServiceEndpointRegistry

ServiceEndpointRegistry records where something is.

```ts
interface ServiceEndpoint {
  name: string;
  kind:
    | "auth"
    | "source"
    | "agent"
    | "registry"
    | "runtime-agent"
    | "provider-executor"
    | "audit"
    | "notification"
    | "operator-config";
  mode:
    | "embedded"
    | "local-service"
    | "remote-service"
    | "external-api"
    | "pull-agent";
  endpoint?: string;
  audience?: string;
  trustBundleRef?: string;
  healthCheck?: string;
  healthStatus?: "available" | "degraded" | "offline" | "unknown";
  region?: string;
  dataResidency?: string[];
}
```

### 7.2 ServiceTrustRecord

ServiceTrustRecord records whether a service identity is trusted.

```ts
interface ServiceTrustRecord {
  serviceName: string;
  identityDigest: string;
  trustState: "trusted" | "pending" | "revoked";
  verifiedAt: string;
}
```

### 7.3 ServiceGrant

ServiceGrant records what a trusted service may do.

```ts
interface ServiceGrant {
  caller: string;
  target: string;
  actions: string[];
  scope?: unknown;
}
```

Do not mix:

```text
ServiceEndpoint:
  where is it?

ServiceTrustRecord:
  do we trust it?

ServiceGrant:
  what may it do?
```

---

## 8. Communication model

Communication is separated by purpose.

```text
Public API:
  HTTPS

Internal service call:
  signed RPC / mTLS / service token

Internal domain reaction:
  transactional outbox + domain events

Long-running work:
  job queue / work lease

Runtime agent work:
  pull-based lease / heartbeat / report

Provider operations:
  isolated ProviderPackage execution

Runtime app traffic:
  router / gateway / data plane

Audit/log/metrics:
  append-only audit / redacted logs / metrics stream
```

### 8.1 Signed internal RPC

Remote internal calls must not trust private networks alone.

Internal RPC should bind:

```text
caller service id
target audience
method / path
timestamp
nonce or request id
body digest
actor context digest
signature
```

### 8.2 DomainEvent and transactional outbox

Domain state transition and DomainEvent emission must be atomic through outbox or equivalent.

```ts
interface DomainEvent {
  id: string;
  domain: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  type: string;
  schemaVersion: string;
  objectAddress: string;
  payloadDigest: string;
  idempotencyKey: string;
  createdAt: string;
}
```

Rules:

```text
Consumers must be idempotent.
Consumers must store processed event ids or idempotency keys.
Ordering is guaranteed only per aggregate when aggregateVersion exists.
Global ordering is not guaranteed.
Consumer failure must not roll back the original domain state transition.
```

Example:

```text
paas-deploy commits ActivationRecord
  -> deploy.ActivationRecordCreated
  -> paas-runtime materializes desired state
  -> paas-routing refreshes route projection
  -> paas-audit records activation event
```

---

## 9. Runtime agents

Runtime agents allow `takos-paas` to materialize workloads on remote hosts, Docker hosts, GPU hosts, edge hosts, or private networks.

Default communication should be pull-based.

```text
runtime-agent
  -> enroll
  -> heartbeat
  -> advertise capabilities
  -> lease work
  -> execute
  -> report result
  -> drain / revoke
```

### 9.1 RuntimeAgentRegistration

```ts
interface RuntimeAgentRegistration {
  agentId: string;
  installationId: string;
  providerTarget: string;
  capabilities: string[];
  hostKeyDigest?: string;
  enrollmentTokenId?: string;
  trustState: "pending" | "active" | "degraded" | "draining" | "offline" | "revoked";
  lastHeartbeatAt: string;
}
```

### 9.2 RuntimeAgentWorkLease

```ts
interface RuntimeAgentWorkLease {
  leaseId: string;
  agentId: string;
  operationId: string;
  expiresAt: string;
  renewAfter: string;
}
```

Rules:

```text
Agent work must be leased.
Leases expire.
Agents heartbeat.
Revoked agents receive no new work.
Draining agents receive no new placements.
```

### 9.3 RuntimePlacementDecision

```ts
interface RuntimePlacementDecision {
  workloadAddress: string;
  providerTarget: string;
  runtimeAgentId?: string;
  requirements: string[];
  selectedCapabilities: string[];
  reason: string[];
}
```

---

## 10. ProviderPackage execution

ProviderPackage execution is powerful because it uses provider credentials to touch real infrastructure.

```ts
interface ProviderExecutionPolicy {
  packageTrustLevel: "official" | "verified" | "local" | "untrusted";
  networkPolicy: "provider-api-only" | "restricted" | "operator-defined";
  credentialScope: "provider-target-only";
  filesystem: "ephemeral";
  auditRequired: true;
}
```

Rules:

```text
ProviderPackage cannot access tenant runtime secrets.
ProviderPackage cannot access build secrets.
ProviderPackage cannot access unrelated provider credentials.
ProviderPackage cannot access paas DB directly.
ProviderPackage credential use must be audit logged.
Untrusted packages cannot Apply or materialize.
```

---

## 11. Runtime and tenant workload isolation

Standalone mode may run the control plane and tenant workloads on the same host. They must still be isolated.

Runtime zones:

```text
control-plane:
  takos-paas API / DB / internal services

provider-execution:
  provider packages, provider credentials

tenant-runtime:
  user workloads

observability:
  logs / metrics / traces, redaction
```

Tenant workloads must not access:

```text
paas DB
provider credentials
operator secrets
internal signing keys
control-plane private endpoints
Docker socket by default
host filesystem by default
```

---

## 12. Registry and package trust

`paas-registry` owns:

```text
ProviderPackage
ResourceContractPackage
DataContractPackage
PackageResolution
trust records
revocation records
conformance results
```

### 12.1 Registry RBAC

Separate permissions:

```text
registry:package:install
registry:package:trust
registry:package:revoke
registry:package:update
provider-target:create
provider-target:bind-credential
deploy:plan
deploy:apply
runtime:materialize
```

The person who can trust a ProviderPackage should not automatically be the person who can deploy it to production.

### 12.2 Registry sync

```text
online:
  automatic trust/revocation sync

manual:
  operator-triggered sync

offline:
  local trust records only
```

Example policy:

```yaml
registrySync:
  mode: offline
  whenRevocationUnavailable: allow-with-warning
```

---

## 13. Bootstrap, recovery, and control-plane restore

### 13.1 Bootstrap

Standalone bootstrap creates:

```text
installation id
first tenant
first admin
default space
encryption key
internal signing key
registry trust roots
```

### 13.2 RecoveryMaterial

```ts
interface RecoveryMaterial {
  installationId: string;
  encryptedRootKeyRef: string;
  breakGlassPolicyRef: string;
  createdAt: string;
}
```

Recovery key material must not be stored only in the same database it restores.

### 13.3 Control-plane backup

Backup targets:

```text
paas database
encrypted secret store
artifact store
package registry cache
trust records
audit log
ProviderMaterialization references
operator config
```

### 13.4 Control-plane restore order

```text
1. restore operator config
2. restore or unlock secret store / key material
3. restore paas database
4. restore package registry cache and trust records
5. restore artifact store
6. restart takos-paas in recovery mode
7. rebuild route/runtime/audit projections
8. reconnect runtime agents
9. observe provider state
10. operator confirms exit from recovery mode
```

Recovery mode should not immediately run provider repair until operator confirms.

---

## 14. Self-update and control-plane migration

Self-update is an operator operation, not a tenant app deployment by default.

```text
takos-paas manages apps.
takos-paas self-update is operator operation.
```

### 14.1 ControlPlaneUpgradePlan

```ts
interface ControlPlaneUpgradePlan {
  fromVersion: string;
  toVersion: string;
  dbMigrations: string[];
  runtimeAgentProtocolCompatibility: string;
  providerPackageCompatibility: string;
  registryCompatibility: string;
  rollbackSupported: boolean;
}
```

### 14.2 ControlPlaneMigration

```text
ControlPlaneMigration:
  operator operation
  runs during self-update / maintenance
  cannot be triggered by tenant Plan
```

Invariant:

```text
Tenant Plan must never apply control-plane schema migrations.
```

---

## 15. Capabilities and version matrix

CLI and integrations must not infer mode from URL shape.

```http
GET /.well-known/takos/server-capabilities
```

Example Full Takos:

```json
{
  "distribution": "full-takos",
  "paasMode": "integrated",
  "apiVersion": "takos-paas/v1",
  "deployContract": "deploy-v2",
  "registryContract": "registry-v1",
  "runtimeContract": "runtime-v1",
  "runtimeAgentProtocol": "runtime-agent/v1",
  "providerPackageApi": "provider-package/v1",
  "minCliVersion": "0.8.0",
  "features": ["deploy", "runtime", "resources", "providers", "git", "agent"],
  "source": "takos-git",
  "agent": "takos-agent"
}
```

Example standalone:

```json
{
  "distribution": "standalone-paas",
  "paasMode": "standalone",
  "apiVersion": "takos-paas/v1",
  "deployContract": "deploy-v2",
  "registryContract": "registry-v1",
  "runtimeContract": "runtime-v1",
  "runtimeAgentProtocol": "runtime-agent/v1",
  "providerPackageApi": "provider-package/v1",
  "minCliVersion": "0.8.0",
  "features": ["deploy", "runtime", "resources", "providers"],
  "source": "connectors",
  "agent": "disabled"
}
```

---

## 16. Observability, visibility, and retention

### 16.1 Event classes

```text
AuditEvent:
  security / compliance / irreversible action

RuntimeLog:
  workload logs

ProviderOperationLog:
  provider package execution logs

ControlPlaneEvent:
  Plan / Apply / Activation / Repair progress

Metric:
  health / latency / usage

Trace:
  request flow
```

### 16.2 Visibility

```text
tenant-visible:
  own workload logs, deploy events, app resource health

operator-visible:
  provider operation logs, package trust events, credential use audit, system health

restricted:
  secret material, provider credentials, internal signing tokens
```

### 16.3 Retention

```yaml
observability:
  retention:
    workloadLogs: 30d
    providerOperationLogs: 90d
    auditEvents: 365d
    agentRunLogs: 30d
    traces: 7d
```

Agent run logs may contain user data and tool output. They must not be treated as normal system logs.

---

## 17. Tenant state propagation

Tenant / space / group state changes are domain events.

```text
tenant.suspended
space.read_only
group.degraded
```

Expected reactions:

```text
deploy:
  block Apply

runtime:
  disable or degrade serving according to policy

agent:
  block mutating tools

git/source:
  block writes when read-only

routing:
  optionally return maintenance / disabled response
```

---

## 18. RouteProjection

RouteProjection lets routers detect stale routing state.

```ts
interface RouteProjection {
  routeId: string;
  ownershipGeneration: number;
  activationGeneration: number;
  networkConfigId: string;
  updatedAt: string;
}
```

Router reads RouteProjection and ActivationRecord. Router must not mutate canonical ownership or activation.

---

## 19. Agent capability gates

AgentPort is optional and capability-gated.

```ts
interface AgentCapabilitySet {
  canReadLogs: boolean;
  canProposePlan: boolean;
  canApplyPlan: boolean;
  canEditSource: boolean;
  canManageProviderTargets: boolean;
  canRequestSecrets: boolean;
}
```

Recommended standalone default:

```text
agent can propose Plans
agent cannot Apply without approval
agent cannot manage provider targets by default
agent cannot request secrets by default
```

Agent output is not trusted merely because the agent generated it.

```text
AgentPort output:
  untrusted generated content until reviewed, planned, built, and policy checked
```

---

## 20. OperatorConfigPort

Full Takos uses `takos-private`. Standalone uses local config, env, Kubernetes Secret, or secret manager.

```text
Integrated:
  OperatorConfigPort -> takos-private

Standalone:
  OperatorConfigPort -> local config / env / secret manager / Kubernetes Secret
```

OperatorConfigPort returns:

```text
provider trust roots
operator policy
control-plane secret refs
registry sync config
self-update policy
bootstrap/recovery config
```

---

## 21. Data ownership across Takos

| data / object | owner |
|---|---|
| account, profile, auth session, OAuth | `takos-app` |
| tenant, space, group, membership, entitlement | `paas-core` |
| route ownership / domain ownership | `paas-routing` |
| repository, ref, object, source truth | `takos-git` or SourcePort provider |
| SourceSnapshot metadata | `paas-deploy` with SourcePort origin |
| Plan, ApplyRun, OperationRun | `paas-deploy` |
| ActivationRecord, GroupActivationPointer | `paas-deploy` |
| AppRelease, NetworkConfig desired state | `paas-deploy` |
| RuntimeNetworkPolicy desired state | `paas-network` + `paas-deploy` activation reference |
| WorkloadRevision | `paas-runtime` |
| ProviderMaterialization | `paas-runtime` |
| ObservedProviderState, health, logs | `paas-runtime` |
| ResourceInstance, ResourceBinding | `paas-resources` |
| MigrationLedger | `paas-resources` |
| ProviderPackage, ResourceContractPackage, DataContractPackage | `paas-registry` |
| PackageResolution | `paas-registry` + `paas-deploy` read set |
| ServiceEndpoint / Trust / Grant | `paas-core` / `paas-registry` depending on kind |
| RuntimeAgentRegistration / WorkLease | `paas-agents` |
| Agent run execution state | `takos-agent` |
| Agent engine library | `takos-agent-engine` |
| private operator config and secrets | `takos-private` or OperatorConfigPort |
| unified audit projection | `paas-audit` |

---

## 22. Public API compatibility

API surfaces:

```text
Universal Takos API:
  CLI/common API across full and standalone

Full Takos API:
  account / billing / OAuth / product shell

Standalone PaaS API:
  local auth / provider admin / standalone settings
```

CLI should use server capabilities and API version matrix rather than URL guessing.

---

## 23. Unified Condition model

Use one Condition model for domain health/status.

```ts
interface Condition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason: string;
  message?: string;
  observedGeneration?: number;
  lastTransitionTime: string;
}
```

Conditions can represent:

```text
AgentOffline
ProviderDegraded
RouteProjectionStale
TenantSuspended
RegistryUnavailable
ResourceMigrationFailed
TrustRevoked
MaterializationFailed
```

---

## 24. Public/data/control/provider/agent planes

Separate planes:

```text
public plane:
  browser / CLI / public API

control plane:
  Plan / Apply / registry / auth / policy / audit

data plane:
  user request routing to workloads

provider plane:
  ProviderPackage execution and provider APIs

agent plane:
  agent run and tool execution

observability plane:
  logs / metrics / traces / audit
```

These planes may share product root, but they must not share authority implicitly.

---

## 25. Design invariants

1. This is Takos-wide architecture, not only takos-paas architecture.
2. `takos-paas` is both a Takos component and standalone-capable PaaS control plane.
3. `takos-paas` is one product root by default. It is not split into many default microservices.
4. Integrated, standalone, and distributed modes use the same PaaS core semantics.
5. Differences between modes are host adapters, topology, and process shape, not core object semantics.
6. `takos-deploy` and `takos-runtime` are internal domains of `takos-paas`, not semantic concepts to erase.
7. `takos-app`, `takos-git`, and `takos-agent` remain separate in Full Takos distribution.
8. `takos-paas` product root may contain multiple process roles, but the PaaS core remains the same.
9. Service split inside `takos-paas` is a scale/operation decision, not a semantic requirement.
10. `takos-paas` core must not depend on physical co-location.
11. Dependencies are reached through ports, adapters, ServiceEndpointRegistry, ProviderTargets, RuntimeAgents, or external APIs.
12. Canonical writes use primary control-plane authority.
13. Strongly consistent writes include ownership, Plan/Apply locks, GroupActivationPointer, ResourceMigrationLock, package trust, and credential binding.
14. Private network does not imply trust.
15. Remote internal calls require signed RPC, mTLS, or equivalent service identity.
16. ServiceEndpoint, ServiceTrustRecord, and ServiceGrant are separate concepts.
17. Domain state transition and DomainEvent emission must be atomic through outbox or equivalent.
18. DomainEvent consumers must be idempotent.
19. Runtime agents must enroll, heartbeat, lease work, report results, drain, and be revokable.
20. ProviderPackage execution is sandboxed and credential-scoped.
21. Tenant workloads must not access control-plane DB, provider credentials, operator secrets, internal signing keys, or control-plane private endpoints.
22. Standalone mode still uses Tenant / Space / Group.
23. SourcePort adapters must return immutable SourceSnapshot values.
24. Agent output and source connector output are untrusted until validated through source/build/Plan/policy.
25. Control-plane restore and ControlPlaneMigration are operator operations, not tenant app operations.
26. Registry trust/revocation behavior must be defined for online, manual, and offline sync modes.
27. Self-update is operator operation unless explicitly enabled by policy.
28. Router reads route projections and activation state but must not mutate canonical ownership or activation.
29. No distributed transaction is assumed across providers, clouds, agents, or services.
30. Provider state is observed and materialized, never canonical Takos state.
