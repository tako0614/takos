# OpenTofu Service Exports

Takos app/source repositories are OpenTofu-native. A repository does not need a
Takos-specific or Takosumi-specific manifest file. Takosumi runs the repo as an
OpenTofu Capsule, records Capsule / Run / StateVersion / Output, and Takos
projects runtime services from those Outputs through
[Capsule Runtime Projection](/architecture/capsule-runtime-projection).

## Service Export Output

A Capsule can expose services with the optional `service_exports` OpenTofu
output. Takosumi reads the evaluated JSON from `tofu output -json` after apply
and Takos projects allowlisted, non-secret output values into runtime service
metadata.

Installable apps can also publish an `app_deployment` OpenTofu output. That
output is a typed app declaration for install discovery and plan UI: compute,
resources, routes, publications, and non-secret env defaults. It is still plain
OpenTofu output, not a separate Takosumi source file.

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

The token value is not an OpenTofu output. Runtime authority is delivered
through the workload runtime secret materialization path.

## Takos Capabilities

Takos uses the Capsule output projection capability catalog directly:

| Takos surface                    | Service identity / capability                                               |
| -------------------------------- | --------------------------------------------------------------------------- |
| MCP tools                        | app-provided `protocol.mcp.server` publications                             |
| launcher / embedded UI           | app-provided `interface.ui.surface` publications                            |
| file handlers                    | app-provided `interface.file.handler` publications                          |
| Workspace file storage           | `storage.filesystem`                                                        |
| object / key-value / SQL storage | `storage.object`, `storage.key_value`, `storage.sql`                        |
| Git                              | `source.repository`, `source.git.smart_http`                                |
| agent runtime                    | `automation.agent_runtime`, `automation.tool_provider`                      |
| same-Workspace output/control access | `deployment.outputs`, `auth.bootstrap_token`, `control.api`             |

## Bindings And Grants

Consumers do not receive API keys from outputs. Takos records which projected
service capability it consumes, and Takosumi keeps the Capsule Output, policy,
and audit evidence that authorized the run.

Endpoint discovery and runtime authority are separate facts:

- `service_exports` describes what a producer Capsule exposes.
- `service_bindings` or product-side runtime config records what a consumer app requests.
- Scoped runtime authority is delivered through workload runtime secret materialization, not through OpenTofu Outputs.

Takos runtime services use product-neutral service-form identities where they exist. For example, a document app should
consume `storage.filesystem` and request `files:read` / `files:write`.

That consume maps the storage endpoint URL. It does not mint a bearer token from OpenTofu Outputs; storage authority
must arrive through workload runtime secret materialization such as `TAKOS_STORAGE_ACCESS_TOKEN` or
`TAKOS_ACCESS_TOKEN`.

## Source Detection

Takos treats these files as installable OpenTofu source signals, in order:

- `main.tf`
- `outputs.tf`
- `takos.tf`
- `opentofu/main.tf`
- `opentofu/outputs.tf`
- `infra/main.tf`
- `infra/outputs.tf`
- `deploy/opentofu/main.tf`
- `deploy/opentofu/outputs.tf`

OpenTofu modules may use variables, locals, and modules. Takos consumes the
evaluated output JSON and Capsule output projection records, not raw HCL.

## Boundary

OpenTofu state, provider credentials, resource apply, OIDC clients, billing,
domains, and provider allowlists belong to Takosumi ProviderConnection /
CredentialRecipe / ProviderBinding / policy, the Takosumi Accounts plane, or operator-private
config outside this repo. Takos consumes Capsule output projection records, and Takosumi
records the run ledger for each plan and apply.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takos App Interface](/architecture/app-interface)
- [Capsule Runtime Projection](/architecture/capsule-runtime-projection)
