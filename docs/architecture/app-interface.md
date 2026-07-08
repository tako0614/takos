# Takos App Interface

> This page summarizes how a Takos app (a Capsule) publishes and consumes runtime services. The full model lives in
> [Capsule Runtime Projection](./capsule-runtime-projection). Takos projects a deployed Capsule's well-known OpenTofu
> Outputs into transient, read-only runtime objects; Takosumi OSS keeps no service-graph ledger and issues no runtime
> grants.

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
| Workspace file storage           | `takos.storage.workspace` providing `storage.filesystem`   |
| object / key-value / SQL storage | `storage.object`, `storage.key_value`, `storage.sql`       |
| Git UX / clone / refs            | `source.repository`, `source.git.smart_http`               |
| agent execution                  | `automation.agent_runtime`, `automation.tool_provider`     |
| same-Workspace output / control  | `deployment.outputs`, `auth.bootstrap_token`, `control.api` |

## Consuming services

A Capsule consumes services through the `service_bindings` Output (or `app_deployment` consume). Takos selects matching
exports, pins them into the consumer's plan-time output-to-input snapshot, and wires only non-secret endpoint values into
the consumer. The projection is read-only and store-free: it issues no credentials. Secret values fail closed and are
delivered by the deployed workload's own runtime, not by a Takosumi grant.

For Takos Workspace files, apps consume the Takos-owned service identity and map its URL output into their workload env:

```hcl
consume = [
  {
    publication = "takos.storage.workspace"
    request = {
      scopes = ["files:read", "files:write"]
    }
    inject = {
      env = {
        url = "TAKOS_STORAGE_API_URL"
      }
    }
  }
]
```

This maps endpoint discovery only. Bearer authority is not projected from OpenTofu Outputs; apps use
`TAKOS_STORAGE_ACCESS_TOKEN` or the existing `TAKOS_ACCESS_TOKEN` runtime binding supplied by their workload runtime.

## Security invariants

- No secret literal in `service_exports` / `service_bindings` / `app_deployment` Outputs.
- The projection grants no runtime authority; runtime service tokens come from the deployed workload's runtime, not from
  OpenTofu Outputs.
- Provider credentials remain in the ProviderConnection / CredentialRecipe / ProviderBinding / vault / runner phase
  boundary.

## Implementation pointers

- Takos profile owner: `takos/`
- Canonical model: [Capsule Runtime Projection](./capsule-runtime-projection)
- Projection implementation: `takosumi/core/domains/output-projection/service-projection.ts`
