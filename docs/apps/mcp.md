# MCP Server

MCP servers appear in Takos as tools that can be used from a Workspace. Users install a plain OpenTofu Capsule rather
than a Takos-specific MCP manifest, and Takos reads the non-secret service metadata from the Capsule Outputs recorded
after a successful apply.

## Current Flow

1. Install a Git URL/ref that points at an OpenTofu Capsule.
2. Review the Takosumi `plan` Run and approve the saved plan.
3. A successful `apply` records StateVersion and Output.
4. Takos reads projected service metadata with the `protocol.mcp.server` capability and shows the server as Workspace tools.
5. Runtime authority comes from the deployed runtime/account-plane boundary. API keys and bearer token literals are never read from OpenTofu outputs.

## Boundary

Takos owns tool discovery, display, consent, and invocation UX. Takosumi owns Output projection, dependency pinning,
policy, and audit evidence. Provider credentials remain in ProviderConnection / ProviderBinding / vault / runner phase
boundaries.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Service exports](/deploy/service-exports)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
