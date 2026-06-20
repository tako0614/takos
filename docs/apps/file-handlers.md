# File Handlers

File handlers let installed apps open or edit selected file types from a Workspace. Takos discovers them through
Takosumi Service Graph, not through a Takos-specific manifest.

## Current Flow

1. Install an app Capsule from Git.
2. Review and apply the Takosumi plan.
3. The app exposes a non-secret ServiceExport capability such as `interface.file.handler`.
4. Takos reads the bound export and shows the handler for matching files in the Workspace.
5. Runtime authority, when needed, comes from ServiceGrant rather than OpenTofu output values.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takosumi records the run ledger (Installation / Run / Deployment / OutputSnapshot) for the applied OpenTofu Capsule, while Connections hold credential references, Installation provider connections resolve each provider (+ optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and policy resolves provider allowlists and state handling. The embedded Takosumi Accounts plane owns account-plane policy (OIDC / billing / dashboard).

## Install Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "source": "github.com/example/takos//deploy/opentofu",
    "ref": "main"
  },
  "vars": {
    "target": "cloudflare"
  }
}
```

Selecting a target runs a `plan` type Run and then an `apply` type Run, which updates the Deployment and records
non-sensitive endpoints as OutputSnapshot. Takos product routes rely on the Takosumi deploy-control ledger and
Service Graph instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
