# Takos App Interface

> This page summarizes how a Takos app (a Capsule) publishes and consumes runtime services. The full model lives in
> [Capsule Runtime Projection](./capsule-runtime-projection). Takos projects a deployed Capsule's well-known OpenTofu
> Outputs into transient, read-only runtime objects. Takosumi OSS keeps no service-graph ledger; its deploy-control
> boundary may still mint a scoped bind-time credential for supported service consumes.

## Ownership

Takosumi treats a Git-URL OpenTofu Capsule as Source / Capsule / Run / StateVersion / Output and records the result of
`tofu output -json`. Takos reads a Capsule's published `service_exports` / `service_bindings` / `app_deployment` Outputs and
projects them into its app launcher, MCP registry, file handlers, Git, storage, and agent runtime.

This boundary is fixed.

- Takosumi does not turn MCP / file handler / launcher metadata into a Takos-specific service class.
- Output capture, output-to-input wiring, dependency pinning, and audit belong to Takosumi.
- A Takosumi Source repo is never required to ship a `.takosumi` manifest, a Takosumi-specific metadata field, or a
  component-graph DSL.
- API keys and bearer-token literals never go in OpenTofu Outputs.
- A supported consume such as `storage.object` or `source.git.smart_http` can request scopes and env injection. Takosumi
  resolves one same-Workspace producer, mints a prefix-scoped credential from the producer's protected signing material,
  and injects it into the consumer plan without exposing it as a public Output.
- Provider credentials, state backend, and resource apply belong to the ProviderConnection / CredentialRecipe /
  ProviderBinding / policy / runner boundary.

## Publishing services

A Capsule publishes a service through the `service_exports` Output (or the `app_deployment` publish convenience).

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

Takos does not read raw HCL; it reads the projected export Takosumi recorded from the Output. locals / variables /
modules stay OpenTofu's responsibility.

## Capability mapping

| Takos surface                    | service identity / capability                              |
| -------------------------------- | ---------------------------------------------------------- |
| MCP registry                     | app-provided `protocol.mcp.server` publications            |
| app launcher / embedded UI       | app-provided `interface.ui.surface` publications           |
| file handlers                    | app-provided `interface.file.handler` publications         |
| Takos product-internal Workspace APIs | `storage.filesystem`, `source.repository` runtime projections |
| Workspace file and object UX     | installable `takos-storage`: `storage.object` + MCP        |
| key-value / SQL storage          | app-provided `storage.key_value`, `storage.sql`            |
| Git UX / clone / refs            | installable `takos-git`: `source.git.smart_http` + MCP     |
| sandbox computer                 | installable `takos-computer`: `protocol.mcp.server`        |
| agent execution                  | `automation.agent_runtime`, `automation.tool_provider`     |
| same-Workspace output / control  | `deployment.outputs`, `auth.bootstrap_token`, `control.api` |

The product-internal projections above remain Takos application APIs; they are not static agent tools. Agent-facing
file and repository operations come from the installed Capsule MCP publications.

## Consuming services

A Capsule consumes services through the `service_bindings` Output (or `app_deployment` consume). Takosumi selects and
pins the matching producer Output into the plan. The projection parser stays read-only and store-free, while the
deploy-control grant broker handles supported scoped credentials during the plan.

For example, `takos-office` consumes the independently installed `takos-storage` Capsule:

```hcl
consume = [
  {
    publication = "storage.object"
    request = {
      scopes = ["files:read", "files:write"]
    }
    inject = {
      env = {
        url    = "OBJECT_STORAGE_API_URL"
        token  = "OBJECT_STORAGE_ACCESS_TOKEN"
        prefix = "OBJECT_STORAGE_KEY_PREFIX"
      }
    }
  }
]
```

`files:read` produces read/list authority; `files:write` produces read/write/delete/list authority. The generated token
is confined to the consumer's Workspace/Capsule prefix. `takos-computer` uses the same flow with
`source.git.smart_http`, `repos:read` / `repos:write`, and `TAKOS_GIT_BASE_URL` /
`TAKOS_GIT_ACCESS_TOKEN` / `TAKOS_GIT_REPO_PREFIX`. Missing or ambiguous producers and unavailable signing authority
fail closed.

## Security invariants

- No secret literal in `service_exports` / `service_bindings` / `app_deployment` Outputs.
- The projection parser does not persist a Service Graph. Supported bind-time grants are minted by Takosumi
  deploy-control, passed through the dispatch-only run credential channel, and never written to public Outputs or logs.
- Provider credentials remain in the ProviderConnection / CredentialRecipe / ProviderBinding / vault / runner phase
  boundary.

## Implementation pointers

- Takos profile owner: `takos/`
- Canonical model: [Capsule Runtime Projection](./capsule-runtime-projection)
- Projection implementation: `takosumi/core/domains/output-projection/service-projection.ts`
