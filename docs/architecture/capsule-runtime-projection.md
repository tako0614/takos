# Capsule Runtime Service Projection

> This page describes how Takos turns a deployed Capsule's well-known OpenTofu Outputs into the runtime services it
> renders and wires (app launcher, MCP registry, file handlers, storage, Git, agent runtime). It is a Takos product
> profile, not a Takosumi public model, a Takosumi-specific repo manifest, an OSS resource driver, or a managed-resource
> backend. The customer-facing Takosumi model stays Workspace / Project / Capsule / Source / ProviderConnection /
> CredentialRecipe / ProviderBinding / Run / StateVersion / Output / Runner / AuditEvent / Operator.

## 1. What this is

Takosumi manages OpenTofu Capsules, Runs, StateVersions, Outputs, ProviderConnections, policy, and audit. Many Capsules
also expose runtime services: HTTP APIs, MCP servers, Git endpoints, object stores, SQL endpoints, agent runtimes, OIDC
clients, and event webhooks.

Takosumi OSS does **not** keep a service-graph ledger. There is no `ServiceExport` / `ServiceBinding` / `ServiceGrant`
table, no capability-token grant issuance, and no vault-minted runtime service token in OSS. Instead, a Capsule may
publish non-secret service descriptors through well-known OpenTofu Outputs, and a host like Takos **projects** those
Outputs into transient, read-only runtime objects:

- a producer Capsule publishes services through the `service_exports` (or the `takos_app` publish convenience) Output;
- a consumer Capsule requests services through the `service_bindings` (or `takos_app` consume) Output;
- Takos reads the deployed Outputs and projects them into `ProjectedServiceExport` / `ProjectedServiceBinding` objects
  that drive its launcher, MCP registry, file handling, storage, Git, and agent surfaces.

The projection is pure and store-free: it reads Output values and shapes them. It writes no ledger rows, issues no
credentials, and grants no runtime authority. Runtime authority for a deployed workload comes from that workload's own
runtime (and from the operator/Cloud secret boundary), not from a Takosumi-issued grant record.

The reference implementation is `takosumi/core/domains/output-projection/service-projection.ts`
(`projectServicesFromOutputs`, `validateProjectedServiceExportsFromOutput`,
`STANDARD_PROJECTED_CAPABILITIES`).

## 2. Ownership

| Concern                | Owner                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| Producer identity      | `Capsule` + successful `Run` + `StateVersion` + `Output`               |
| Producer data source   | `tofu output -json`, filtered through the Capsule output allowlist     |
| Consumer dependency     | output-to-input wiring pinned at plan time                            |
| Runtime authority      | the deployed workload's own runtime / operator-Cloud secret boundary   |
| Audit                  | `Run` / `AuditEvent`                                                    |
| Projection             | Takos host (transient, read-only; outside the Takosumi ledger)         |

Takos consumes these projections to build its app launcher, MCP registry, file handling, storage, Git, and agent
experiences. Takos may also publish first-party services through the same Outputs, but it does not define a separate
Takosumi public standard. For Takos-owned runtime services, the concrete service identity uses the `takos.*` namespace
while the capability remains product-neutral; for example `takos.storage.workspace` is a Takos Workspace Storage service
with the `storage.filesystem` capability.

## 3. Non-Goals

The runtime projection is not:

- a replacement for OpenTofu provider schemas, resource graphs, or state;
- a required in-repository manifest or DSL;
- an OSS resource driver, compatibility gateway, or managed-resource system;
- a service mesh or traffic proxy;
- a secret transport through OpenTofu Outputs;
- a provider credential model. Provider credentials stay outside the projection and are resolved through
  ProviderConnections, CredentialRecipes, ProviderBindings, vault backing material, policy, and runner phase boundaries.

## 4. Projected records

### 4.1 ProjectedServiceExport

A projected export is a non-secret, allowlist-checked description of a service exposed by one producer Capsule, derived
from that Capsule's `service_exports` (or `takos_app` publish) Output.

| field          | meaning                                                          |
| -------------- | ---------------------------------------------------------------- |
| `name`         | producer-local stable name, unique within the Capsule            |
| `capabilities` | capability tokens such as `protocol.mcp.server` or `storage.object` |
| `visibility`   | `private`, `space`, `public`, or `shared`                        |
| `endpoints`    | non-secret endpoint descriptors                                  |
| `auth`         | accepted auth schemes, without secret values                     |
| `labels`       | display/selector labels                                          |
| `metadata`     | display and protocol metadata, never authority                   |

`visibility = "space"` means Workspace-visible. The wire keeps the historical `space` token; it is not a reintroduction
of the retired Takosumi Space public concept.

### 4.2 ProjectedServiceBinding

A projected binding is a consumer Capsule's request to use a service, derived from its `service_bindings` (or `takos_app`
consume) Output. It is read-only configuration, not a required repo manifest.

| field            | meaning                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `name`           | binding name                                                             |
| `target`         | `generated_root`, `workload`, or `runtime` target that receives the wire |
| `selector`       | capability / producer / name / label constraints                        |
| `dependencyMode` | `variable_injection`, `remote_state`, or `published_output`             |
| `grantRequest`   | requested scopes / audience / env names / ttl hints (descriptive)        |

`grantRequest` records what a consumer asks for. In OSS it is descriptive projection metadata only: Takos uses it to wire
non-secret endpoint values into the consumer and to know which env name should receive a secret the deployed workload
already holds. It does not cause Takosumi to mint a credential.

When the host wires a binding into the plan lifecycle, the selected export must be pinned into the consumer's plan-time
output-to-input snapshot. Secret values fail closed and must move through the workload's own runtime secret delivery, not
through the projection.

## 5. Capability Catalog

Capability tokens are product-neutral dotted strings. A token names the class of service being published or requested;
policy, endpoints, and metadata describe what a specific Capsule can actually do. Service ids and producer-local names
are not capability tokens; they may identify the producer when that is the honest service identity.

Standard namespaces: `protocol.*`, `interface.*`, `storage.*`, `source.*`, `compute.*`, `automation.*`, `ai.*`,
`identity.*`, `auth.*`, `messaging.*`, `events.*`, `observability.*`, `billing.*`, `deployment.*`, `control.*`,
`governance.*`.

Standard capabilities (`STANDARD_PROJECTED_CAPABILITIES`):

| capability                 | meaning                                          |
| -------------------------- | ------------------------------------------------ |
| `protocol.mcp.server`      | MCP server endpoint                              |
| `protocol.http.api`        | generic HTTP API endpoint                        |
| `protocol.grpc.api`        | gRPC API endpoint                                |
| `protocol.websocket.api`   | WebSocket API endpoint                           |
| `interface.ui.surface`     | embeddable or launchable UI surface              |
| `interface.file.handler`   | file open/edit handler metadata                  |
| `storage.object`           | object/blob storage API                          |
| `storage.filesystem`       | file-tree storage API                            |
| `storage.key_value`        | key-value storage API                            |
| `storage.sql`              | SQL/database API                                 |
| `storage.vector`           | vector index or vector-search API                |
| `storage.search_index`     | text/search index API                            |
| `source.repository`        | repository metadata, refs, and object access     |
| `source.git.smart_http`    | Git Smart HTTP endpoint                          |
| `compute.job_runner`       | asynchronous job execution endpoint              |
| `compute.sandbox`          | sandboxed execution environment                  |
| `automation.agent_runtime` | agent/task runtime endpoint                      |
| `automation.tool_provider` | tool provider usable by a runtime or agent       |
| `ai.model`                 | model inference endpoint                         |
| `ai.embedding_model`       | embedding model endpoint                         |
| `identity.oidc`            | OIDC issuer/client projection                    |
| `identity.oauth.client`    | OAuth client projection                          |
| `auth.bootstrap_token`     | one-time or short-lived bootstrap token delivery |
| `auth.token_exchange`      | token exchange endpoint                          |
| `auth.webhook_signing`     | webhook/event signing secret authority           |
| `messaging.queue`          | queue service                                    |
| `messaging.pubsub`         | publish/subscribe service                        |
| `events.webhook`           | event ingest webhook                             |
| `events.subscription`      | event subscription stream                        |
| `observability.logs`       | log read/export endpoint                         |
| `observability.metrics`    | metric read/export endpoint                      |
| `observability.traces`     | trace read/export endpoint                       |
| `billing.usage`            | usage reporting / showback integration port      |
| `deployment.outputs`       | non-secret deployment output read API            |
| `control.api`              | scoped same-Workspace support callbacks          |
| `governance.policy`        | policy decision or policy evidence service       |
| `governance.approval`      | approval request/decision service                |

Extension capabilities (non-standard dotted tokens) are rejected unless the projection is explicitly invoked with
`allowExtensionCapabilities`. `billing.*` capabilities do not make official billing an OSS feature; official billing,
payment enforcement, and usage metering sold as a service are Takosumi Cloud-only.

The Takosumi AI Gateway is **not** part of this projection. It is a Cloud-only, OpenAI-compatible runtime API that lives
in the closed `takosumi-cloud` package; it is not an OpenTofu provider credential and not an OSS control-plane feature.

## 6. OpenTofu projection

Takosumi requires no manifest. A Capsule may optionally publish service descriptors through a well-known OpenTofu Output
named `service_exports` (and request services through `service_bindings`), or use the `takos_app` publish/consume
convenience Output.

```hcl
output "service_exports" {
  value = [
    {
      name         = "research-tools"
      capabilities = ["protocol.mcp.server"]
      endpoints = [
        {
          name     = "default"
          protocol = "https"
          url      = "https://example.test/mcp"
        }
      ]
      auth = [
        {
          scheme   = "bearer"
          audience = "research-tools"
          scopes   = ["mcp.invoke"]
        }
      ]
      metadata = {
        title = "Research tools"
      }
      visibility = "space"
    }
  ]
}
```

Rules:

- `service_exports` is optional. A repo without it is still a valid OpenTofu Capsule.
- Secret values, API keys, bearer tokens, private keys, and provider credentials must not appear in `service_exports`.
- The Output passes the same sensitive-flag and output allowlist checks as other Output projections. Takosumi validates
  the shape at apply time (`validateProjectedServiceExportsFromOutput`) and fails closed on a malformed Output.
- If an endpoint is sensitive, do not publish it as an export; let the deployed workload deliver it through its own
  runtime secret path.
- Unknown capability tokens are recorded only when policy explicitly allows extension capabilities.

## 7. Binding resolution

Projection-time binding resolution is fail-closed and host-driven. Takos:

1. Selects candidate exports by Workspace, visibility, capability, producer constraints, and policy.
2. Rejects ambiguous matches unless the binding selector is explicit enough.
3. Checks the producer Output generation, the successful apply Run, and dependency policy.
4. Pins the selected export into the consumer's plan-time output-to-input snapshot when wiring it into a plan.
5. Materializes only non-secret endpoint values into generated-root variables or consumer runtime env, as requested by
   the binding. Secret values fail closed; the projection may name the env var that will receive the secret, but the
   secret value itself comes from the workload runtime / operator-Cloud secret boundary.

Endpoint discovery and runtime authority stay separate facts: a consumer should not learn a secret just because it can
discover an endpoint.

## 8. Auth

Auth schemes that may appear in a projected `auth` descriptor: `none`, `bearer`, `oidc`, `signed_webhook`. These name the
scheme a deployed service accepts; they do not authorize anything by themselves. Provider credentials are never projected
here — they authorize OpenTofu plan/apply/destroy and stay in the ProviderConnection / CredentialRecipe / ProviderBinding
/ vault-runner boundary.

## 9. Takos profile

Takos is a first-party consumer/producer profile over this projection:

| Takos surface                    | service identity / capability                                          |
| -------------------------------- | ---------------------------------------------------------------------- |
| MCP registry                     | app-provided `protocol.mcp.server` publications                        |
| app launcher / embedded UI       | app-provided `interface.ui.surface` publications                       |
| file handlers                    | app-provided `interface.file.handler` publications                     |
| Workspace file storage           | `takos.storage.workspace` providing `storage.filesystem`               |
| object / key-value / SQL storage | `storage.object`, `storage.key_value`, `storage.sql`                   |
| Git UX / clone / refs            | `source.repository`, `source.git.smart_http`                           |
| agent execution                  | `automation.agent_runtime`, `automation.tool_provider`                 |
| same-Workspace output / control  | `deployment.outputs`, `auth.bootstrap_token`, `control.api`            |

Takos-specific UI decisions, launcher ranking, bundled-app seeding, chat/agent UX, and memory behavior stay in Takos.
Output capture, output-to-input wiring, dependency pinning, and audit stay in Takosumi. MCP is represented by the
`protocol.mcp.server` capability in this profile; it is not a Takosumi-specific repo manifest or OSS resource driver.

## 10. Security invariants

- No secret literal in `service_exports` / `service_bindings` / `takos_app` Outputs.
- The projection is read-only and store-free: it issues no credentials and grants no runtime authority.
- Runtime service tokens come from the deployed workload's own runtime (and the operator/Cloud secret boundary), not from
  OpenTofu Outputs and not from a Takosumi grant ledger.
- Provider credentials remain in ProviderConnection / CredentialRecipe / ProviderBinding / vault / runner phase
  boundaries.

## 11. Implementation pointers

- Takos profile owner: `takos/`
- Projection implementation: `takosumi/core/domains/output-projection/service-projection.ts`
- Apply-time Output validation: deploy-control apply path in `takosumi/core/domains/deploy-control/`
