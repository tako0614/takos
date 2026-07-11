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

Takosumi OSS does **not** keep a service-graph ledger or persist `ServiceExport` / `ServiceBinding` / `ServiceGrant` as
public ledger entities. Instead, a Capsule may publish non-secret service descriptors through well-known OpenTofu
Outputs, and a host like Takos **projects** those Outputs into transient, read-only runtime objects:

- a producer Capsule publishes services through the `service_exports` (or the `app_deployment` publish convenience) Output;
- a consumer Capsule requests services through the `service_bindings` (or `app_deployment` consume) Output;
- Takos reads the deployed Outputs and projects them into `ProjectedServiceExport` / `ProjectedServiceBinding` objects
  that drive its launcher, MCP registry, file handling, storage, Git, and agent surfaces.

The projection parser is pure and store-free: it reads Output values and shapes them. Credential materialization is a
separate deploy-control concern. For supported `storage.object` and `source.git.smart_http` consumes, Takosumi resolves
one same-Workspace producer, derives verbs from requested scopes, mints a prefix-scoped credential from the producer's
protected signing output, and injects it through the plan Run credential channel. This does not recreate a Service Graph
ledger, and the credential never enters public Outputs or logs.

The reference implementation is `takosumi/core/domains/output-projection/service-projection.ts`
(`projectServicesFromOutputs`, `validateProjectedServiceExportsFromOutput`,
`STANDARD_PROJECTED_CAPABILITIES`).

## 2. Ownership

| Concern              | Owner                                                                |
| -------------------- | -------------------------------------------------------------------- |
| Producer identity    | `Capsule` + successful `Run` + `StateVersion` + `Output`             |
| Producer data source | `tofu output -json`, filtered through the Capsule output allowlist   |
| Consumer dependency  | output-to-input wiring pinned at plan time                           |
| Runtime authority    | workload runtime plus Takosumi bind-time scoped grants where supported |
| Audit                | `Run` / `AuditEvent`                                                 |
| Projection           | Takos host (transient, read-only; outside the Takosumi ledger)       |

Takos consumes these projections to build its app launcher, MCP registry, file handling, storage, Git, and agent
experiences. Takos may also publish first-party services through the same Outputs, but it does not define a separate
Takosumi public standard. Takos still projects its product-internal `storage.filesystem` and `source.repository` APIs.
Those are not static agent tools: agent-facing storage and Git operations are supplied by normal installable Capsules.
`takos-storage` publishes `storage.object` and an MCP server, `takos-git` publishes `source.git.smart_http` and an MCP
server, and `takos-computer` publishes its sandbox MCP server.

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
from that Capsule's `service_exports` (or `app_deployment` publish) Output.

| field          | meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `name`         | producer-local stable name, unique within the Capsule               |
| `capabilities` | capability tokens such as `protocol.mcp.server` or `storage.object` |
| `visibility`   | `private`, `space`, `public`, or `shared`                           |
| `endpoints`    | non-secret endpoint descriptors                                     |
| `auth`         | accepted auth schemes, without secret values                        |
| `labels`       | display/selector labels                                             |
| `metadata`     | display and protocol metadata, never authority                      |

`visibility = "space"` means Workspace-visible. The wire keeps the historical `space` token; it is not a reintroduction
of the retired Takosumi Space public concept.

### 4.2 ProjectedServiceBinding

A projected binding is a consumer Capsule's request to use a service, derived from its `service_bindings` (or `app_deployment`
consume) Output. It is read-only configuration, not a required repo manifest.

| field            | meaning                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `name`           | binding name                                                             |
| `target`         | `generated_root`, `workload`, or `runtime` target that receives the wire |
| `selector`       | capability / producer / name / label constraints                         |
| `dependencyMode` | `variable_injection`, `remote_state`, or `published_output`              |
| `grantRequest`   | requested scopes / audience / env names / ttl hints (descriptive)        |

`grantRequest` records what a consumer asks for. The projection parser only normalizes it. During a plan Run, the
deploy-control grant broker recognizes supported publications, converts `files:*` or `repos:*` scopes into the producer's
verbs, and injects the resulting endpoint, token, prefix, and Workspace context through declared OpenTofu variables.
Other bindings still require an explicit runtime credential path; arbitrary capability metadata does not mint a token.

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
| `storage.filesystem`       | Takos product-internal Workspace file-tree projection; not an agent tool |
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
named `service_exports` (and request services through `service_bindings`), or use the `app_deployment` publish/consume
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

Binding resolution is fail-closed. Takosumi:

1. Selects candidate exports by Workspace, visibility, capability, producer constraints, and policy.
2. Rejects ambiguous matches unless the binding selector is explicit enough.
3. Checks the producer Output generation, the successful apply Run, and dependency policy.
4. Pins the selected export into the consumer's plan-time output-to-input snapshot when wiring it into a plan.
5. Materializes non-secret endpoint values into generated-root variables or consumer runtime env.
6. For supported scoped-token publications, resolves protected producer signing material, mints the consumer-specific
   credential, and injects it through the dispatch-only plan environment. Missing/ambiguous producers and unavailable
   signing authority fail closed.

Endpoint discovery and runtime authority stay separate facts: a consumer should not learn a secret just because it can
discover an endpoint.

## 8. Auth

Auth schemes that may appear in a projected `auth` descriptor: `none`, `bearer`, `oidc`, `signed_webhook`. These name the
scheme a deployed service accepts; they do not authorize anything by themselves. Provider credentials are never projected
here — they authorize OpenTofu plan/apply/destroy and stay in the ProviderConnection / CredentialRecipe / ProviderBinding
/ vault-runner boundary.

## 9. Takos profile

Takos is a first-party consumer/producer profile over this projection:

| Takos surface                    | service identity / capability                               |
| -------------------------------- | ----------------------------------------------------------- |
| MCP registry                     | app-provided `protocol.mcp.server` publications             |
| app launcher / embedded UI       | app-provided `interface.ui.surface` publications            |
| file handlers                    | app-provided `interface.file.handler` publications          |
| Takos product-internal Workspace APIs | `storage.filesystem`, `source.repository` projections  |
| Workspace file and object UX     | installable `takos-storage`: `storage.object` + MCP         |
| key-value / SQL storage          | app-provided `storage.key_value`, `storage.sql`             |
| Git UX / clone / refs            | installable `takos-git`: `source.git.smart_http` + MCP      |
| sandbox computer                 | installable `takos-computer`: `protocol.mcp.server`         |
| agent execution                  | `automation.agent_runtime`, `automation.tool_provider`      |
| same-Workspace output / control  | `deployment.outputs`, `auth.bootstrap_token`, `control.api` |

The internal Workspace projections remain product APIs, while the agent discovers file/repository actions from the
installed MCP publications.

Takos-specific UI decisions, launcher ranking, explicit app install UX, chat/agent UX, and memory behavior stay in Takos.
Output capture, output-to-input wiring, dependency pinning, and audit stay in Takosumi. MCP is represented by the
`protocol.mcp.server` capability in this profile; it is not a Takosumi-specific repo manifest or OSS resource driver.

## 10. Security invariants

- No secret literal in `service_exports` / `service_bindings` / `app_deployment` Outputs.
- The projection parser is read-only and store-free; bind-time credential issuance stays in Takosumi deploy-control and
  does not create a public Service Graph ledger.
- Scoped runtime tokens come from protected producer signing material, are injected only into the consumer Run, and do
  not appear in public OpenTofu Outputs, logs, or audit payloads.
- Provider credentials remain in ProviderConnection / CredentialRecipe / ProviderBinding / vault / runner phase
  boundaries.

## 11. Implementation pointers

- Takos profile owner: `takos/`
- Projection implementation: `takosumi/core/domains/output-projection/service-projection.ts`
- Apply-time Output validation: deploy-control apply path in `takosumi/core/domains/deploy-control/`
