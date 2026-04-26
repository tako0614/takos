# 04. Runtime Contracts

## 1. Purpose

This document defines how workloads, bindings, events, service identity, Direct Workload Deploy, and readiness fit into Takos Deploy v2.

## 2. Workload contracts

Core workload kinds:

```text
js-worker
container
job
```

Compose is an input format, not a core workload kind.

```text
compose.yaml -> generated container workload(s)
```

## 3. JS worker

A JS worker uses a runtime contract.

```yaml
workloads:
  web:
    kind: js-worker
    runtime:
      contract: takos-worker@v1
      profile: worker-portable-small@v1
      features:
        - web.fetch
        - web.crypto.subtle
```

Provider-native worker features are explicit.

```yaml
portability:
  mode: provider-native

workloads:
  web:
    kind: js-worker
    providerNative:
      cloudflare.workers.compatibility@v1:
        required: true
        fallback: block
        values:
          compatibilityDate: "2026-04-25"
          flags:
            - nodejs_compat
          providesRuntimeFeatures:
            - node.buffer
            - node.crypto
```

Portable worker does not receive raw provider objects unless policy explicitly permits native binding in provider-native mode.

## 4. Container

Container contract must define:

```text
image or build source
digest pinning
prepared artifact reuse
entrypoint/command policy
env and secret injection
readiness
shutdown signal
timeout
resource limits
logs
network identity
```

In shared tenancy, the following are blocked unless a provider-native policy explicitly allows them:

```text
privileged
host network
host port
hostPath mount
Docker socket mount
devices
dangerous cap_add
```

## 5. Job

Job contract must define:

```text
input
idempotency key
checkpoint
retry
timeout
parallelism
grant scope
logs/events
cancel behavior
exit status
```

DataMigrationJob is a controlled job with MigrationJob metadata, checkpoint, ledger, and optional release gate.

## 6. Direct Workload Deploy

Direct Workload Deploy is a user-facing shortcut.

It accepts:

```text
worker bundle
worker source + build command
container image
Dockerfile
compose service
```

It compiles into generated AppSpec and EnvSpec. It never bypasses Plan, Apply, ActivationRecord, policy, readiness, audit, or package resolution.

Once a group is manifest-managed, direct workload deploy must not silently mutate AppSpec.

Allowed outcomes:

```text
block and ask for manifest update
write manifest explicitly
apply an explicit CLI patch according to policy
```

## 7. BindingSetRevision

BindingSetRevision is immutable in structure and resolution policy.

It does not always imply immutable secret values.

```ts
interface SecretBindingRef {
  bindingName: string;
  secretName: string;
  resolution: "latest-at-activation" | "pinned-version";
  pinnedVersionId?: string;
  rollbackPolicy: "re-resolve" | "reuse-pinned-version";
}
```

Default:

```text
resolution: latest-at-activation
rollbackPolicy: re-resolve
```

Rollback does not restore old secret values by default.

## 8. Resource access

Resource access is declared by consume edges and migrations.

Required access modes are derived from:

```text
workload consume edges
migration declarations
publication/resource operation requirements
```

Explicit `requireAccessModes` may add constraints.

```yaml
resources:
  db:
    contract: sql.postgres@v1
    requirements:
      requireAccessModes:
        - database-url
```

## 9. Native binding

Native binding exposes provider raw resource interface.

Rules:

```text
portable:
  native-binding forbidden

provider-native:
  native-binding allowed only if policy permits
```

Plan must show enforcement impact. If raw binding bypasses Takos grant enforcement, scope enforcement may be downgraded to advisory and require approval.

## 10. Workload identity and service grants

Internal calls must carry Takos-issued identity.

```ts
interface WorkloadIdentity {
  workloadAddress: string;
  appReleaseId: string;
  audience: string[];
}

interface ServiceGrant {
  caller: string;
  target: string;
  actions: string[];
  scope?: unknown;
}
```

Service binding / internal-url must verify caller identity and grant.

URL knowledge alone is not authorization.

## 11. EventSubscriptionRevision

Event subscriptions belong to AppRelease.

Types:

```text
queue
schedule
internal-event
```

Queue delivery profile must define:

```text
at-least-once delivery
visibility timeout
max retries
batch size
partial ack
DLQ
consumer overlap support
```

Schedule delivery profile must define:

```text
cron expression
timezone
delivery: at-least-once
overlap policy: forbid | allow | skip-if-running
```

During canary, event subscriptions target primaryAppReleaseId unless an explicit event canary extension is used.

## 12. Readiness

Readiness is declaration plus observation.

```ts
interface ReadinessObservation {
  objectAddress: string;
  status: "ready" | "not-ready" | "unknown";
  reason?: string;
  observedAt: string;
}
```

Examples:

```text
worker ready:
  bundle deployed
  bindings resolved
  runtime can accept request

container ready:
  image pulled
  process running
  healthcheck passing
  endpoint reachable

resource ready:
  instance available
  migration ledger readable
  required grants/bindings available
```
