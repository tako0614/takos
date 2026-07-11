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

The token value is not a public OpenTofu output. A publication may keep its signing authority in a sensitive Output;
Takosumi's bind-time grant broker resolves that protected value and injects only a scoped consumer credential through
the Run's dispatch-only environment.

## Takos Capabilities

Takos uses the Capsule output projection capability catalog directly:

| Takos surface                    | Service identity / capability                                               |
| -------------------------------- | --------------------------------------------------------------------------- |
| MCP tools                        | app-provided `protocol.mcp.server` publications                             |
| launcher / embedded UI           | app-provided `interface.ui.surface` publications                            |
| file handlers                    | app-provided `interface.file.handler` publications                          |
| Takos product-internal Workspace APIs | `storage.filesystem`, `source.repository` runtime projections          |
| Workspace file and object tools  | installable `takos-storage`: `storage.object` + `protocol.mcp.server`       |
| key-value / SQL storage          | app-provided `storage.key_value`, `storage.sql`                             |
| Git                              | installable `takos-git`: `source.git.smart_http` + `protocol.mcp.server`   |
| sandbox computer                 | installable `takos-computer`: `protocol.mcp.server`                         |
| agent runtime                    | `automation.agent_runtime`, `automation.tool_provider`                      |
| same-Workspace output/control access | `deployment.outputs`, `auth.bootstrap_token`, `control.api`             |

`storage.filesystem` and `source.repository` remain internal Takos product projections. They do not add static agent
tools; agent file/Git operations are discovered from the installed MCP servers above.

## Bindings And Grants

Consumers do not receive API keys from public outputs. A consumer declares the publication, requested scopes, and env
injection names. Takosumi keeps the Capsule Output, policy, and audit evidence, resolves one producer in the Workspace,
and mints a prefix-scoped credential during the plan Run for supported service capabilities.

Endpoint discovery and runtime authority are separate facts:

- `service_exports` describes what a producer Capsule exposes.
- `service_bindings` or product-side runtime config records what a consumer app requests.
- `storage.object` and `source.git.smart_http` scoped authority is minted at bind time from protected producer signing
  material and delivered through the dispatch-only Run environment.

Takos runtime services use product-neutral service-form identities where they exist. For example, `takos-office`
consumes the independently installed `storage.object` publication and requests `files:read` / `files:write`.

That consume injects `OBJECT_STORAGE_API_URL`, a consumer-scoped `OBJECT_STORAGE_ACCESS_TOKEN`, and
`OBJECT_STORAGE_KEY_PREFIX`. For Git, `takos-computer` requests `repos:read` / `repos:write` and receives
`TAKOS_GIT_BASE_URL`, `TAKOS_GIT_ACCESS_TOKEN`, and `TAKOS_GIT_REPO_PREFIX`. These credentials never become public
Output values.

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
