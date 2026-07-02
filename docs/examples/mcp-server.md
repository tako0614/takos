# MCP Server

This example installs an MCP server as a plain OpenTofu Capsule and makes it
available to Takos through Capsule output projection. Takos never reads a
Takos-specific MCP manifest from the repository.

## Current Flow

1. Choose a Git URL/ref pointing at an OpenTofu Capsule repository.
2. Create a Capsule, then start a `plan` type Run and review its diff,
   warnings, and policy decision.
3. Promote the reviewed plan to an `apply` type Run. A successful apply records
   StateVersion and Output.
4. Takos projects allowlisted non-secret outputs into transient Capsule output
   projection records.
5. Takos reads projected services with `protocol.mcp.server` and registers
   them as MCP tools for the Workspace.

## Service Export Shape

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

Bearer token values are not OpenTofu outputs. Endpoint discovery and runtime
authority stay separate: Takos projects non-secret endpoint metadata, while
the workload runtime receives bearer material through its runtime secret
delivery path.

## Boundary

Provider credentials and resource apply stay in Takosumi ProviderConnection /
ProviderBinding / policy. Service identity, non-secret endpoint metadata,
output generation, dependency pinning, and audit stay in Capsule output projection.
Takos owns the MCP user experience.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takos App Interface](/architecture/app-interface)
- [Capsule Runtime Projection](/architecture/capsule-runtime-projection)
