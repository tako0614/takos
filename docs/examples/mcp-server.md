# MCP Server

This example installs an MCP server as a plain OpenTofu Capsule and makes it
available to Takos through Takosumi Service Graph. Takos never reads a
Takos-specific MCP manifest from the repository.

## Current Flow

1. Choose a Git URL/ref pointing at an OpenTofu Capsule repository.
2. Create an Installation, then start a `plan` type Run and review its diff,
   warnings, and policy decision.
3. Promote the reviewed plan to an `apply` type Run. A successful apply updates
   the Deployment and OutputSnapshot.
4. Takosumi projects allowlisted non-secret outputs into ServiceExport records.
5. Takos reads ServiceExport records with `protocol.mcp.server` and registers
   them as MCP tools for the Space.

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

Bearer token values are not OpenTofu outputs. If Takos needs runtime authority
to call the service, Takosumi issues it through ServiceGrant.

## Boundary

Provider credentials and resource apply stay in Takosumi Connection /
Installation provider connection / policy. Service identity, binding, grant,
output generation, dependency pinning, and audit stay in Takosumi Service Graph.
Takos owns the MCP user experience.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takos App Interface](/architecture/app-interface)
- [Capsule Runtime Projection](/architecture/capsule-runtime-projection)
