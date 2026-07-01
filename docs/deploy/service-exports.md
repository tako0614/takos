# OpenTofu Service Exports

Takos app/source repositories are OpenTofu-native. A repository does not need a
Takos-specific or Takosumi-specific manifest file. Takosumi runs the repo as an
OpenTofu Capsule, records Capsule / Run / StateVersion / Output, and Takos
projects runtime services from those Outputs through
[Capsule Runtime Projection](/architecture/capsule-runtime-projection).

## Service Export Output

A Capsule can expose services with the optional `service_exports` OpenTofu
output. Takosumi reads the evaluated JSON from `tofu output -json` after apply
and records ServiceExport rows from allowlisted, non-secret output values.

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

The token value is not an OpenTofu output. Runtime authority is created through
ServiceGrant and delivered through the runtime secret path.

## Takos Capabilities

Takos uses the Service Graph capability catalog directly:

| Takos surface                    | Capability                                                                 |
| -------------------------------- | -------------------------------------------------------------------------- |
| MCP tools                        | `protocol.mcp.server`                                                      |
| launcher / embedded UI           | `interface.ui.surface`                                                     |
| file handlers                    | `interface.file.handler`                                                   |
| storage                          | `storage.filesystem`, `storage.object`, `storage.key_value`, `storage.sql` |
| Git                              | `source.repository`, `source.git.smart_http`                               |
| agent runtime                    | `automation.agent_runtime`, `automation.tool_provider`                     |
| same-space output/control access | `deployment.outputs`, `auth.bootstrap_token`, `control.api`                |

## Bindings And Grants

Consumers do not receive API keys from outputs. Takos creates ServiceBinding
records for the services it needs. Takosumi pins the selected ServiceExport in
DependencySnapshot and issues ServiceGrant records for runtime authority.

Endpoint discovery and token issuance are part of the same binding flow, but
they remain distinct ledger facts:

- ServiceExport describes what a producer Installation exposes.
- ServiceBinding records what a consumer Installation requests.
- ServiceGrant records the scoped runtime authority issued by Accounts/Vault.

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
evaluated output JSON and Takosumi Service Graph records, not raw HCL.

## Boundary

OpenTofu state, provider credentials, resource apply, OIDC clients, billing,
domains, and provider allowlists belong to Takosumi Connection / Installation
provider connection / policy, the Takosumi Accounts plane, or operator-private
config outside this repo. Takos consumes Service Graph records, and Takosumi
records the run ledger for each plan and apply.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takos App Interface](/architecture/app-interface)
- [Capsule Runtime Projection](/architecture/capsule-runtime-projection)
