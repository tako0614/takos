# Takos Service Graph Profile

> このページは Takos が [Takosumi Service Graph v1](https://takosumi.com/docs/service-graph-spec) をどう使うかの
> product profile です。service の標準 contract は Takosumi が所有します。

## Ownership

Takosumi は Git URL の OpenTofu Capsule を Source / Installation / Run / Deployment / OutputSnapshot として扱い、
`tofu output -json` の結果を記録します。Takos は ServiceExport / ServiceBinding / ServiceGrant を読んで app launcher、
MCP registry、file handler、Git、storage、agent runtime に投影します。

この境界は固定です。

- Takosumi は MCP / file handler / launcher metadata / runtime service grant を Takos-specific service class にしない。
- Service identity / binding / grant の正本は Takosumi Service Graph。
- Takosumi source repo に `.takosumi` manifest、Takosumi 専用 metadata field、component graph DSL を要求しない。
- API key や bearer token literal を OpenTofu output に置かない。
- Provider credentials、state backend、resource apply は Connection / Installation provider connection / policy / runner
  boundary が所有する。

## Service Exports

Capsule が service を公開する場合は `service_exports` output を使えます。

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

Takos は raw HCL を読まず、Takosumi が記録した ServiceExport を読みます。locals / variables / modules は OpenTofu の責務です。

## Capability Mapping

Takos は次の Service Graph capabilities を使います。

| Takos surface                    | Service Graph capability                                    |
| -------------------------------- | ----------------------------------------------------------- |
| MCP registry                     | `protocol.mcp.server`                                       |
| app launcher / embedded UI       | `interface.ui.surface`                                      |
| file handlers                    | `interface.file.handler`                                    |
| file/object storage              | `storage.filesystem`, `storage.object`                      |
| key-value / SQL resources        | `storage.key_value`, `storage.sql`                          |
| Git UX / clone / refs            | `source.repository`, `source.git.smart_http`                |
| agent execution                  | `automation.agent_runtime`, `automation.tool_provider`      |
| same-space output/control access | `deployment.outputs`, `auth.bootstrap_token`, `control.api` |

## Bindings And Grants

Takos consumes services by creating ServiceBinding records. Takosumi pins the selected ServiceExport in
DependencySnapshot and issues a ServiceGrant when runtime authority is needed. Endpoint discovery and runtime authority
are one binding flow, but secret values never appear in OpenTofu outputs.

## Security Invariants

- No secret literal in `service_exports`.
- Service identity / binding / grant semantics belong to Takosumi Service Graph.
- Runtime service tokens come from ServiceGrant, not from OpenTofu outputs.
- Provider credentials remain in Connection / Installation provider connection / vault / runner phase boundaries.

## Implementation Pointers

- Takos profile owner: `takos/`
- Service Graph spec: `takosumi/docs/service-graph-spec.md`
