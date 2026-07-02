# yurucommu

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref for the OpenTofu Capsule repository.
2. Create a `plan` type Run and review its proposed changes, warnings, and run ledger entry.
3. Apply the reviewed plan as an `apply` type Run, which records a StateVersion and Output on success.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to an explicit provider connection (an explicit ProviderConnection), and policy resolves provider allowlists, state backend, and Cloudflare Container execution for the run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, domains, and account-plane policy belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records Run, StateVersion, Output, policy, and audit evidence and run ledger evidence. Takosumi Accounts plane owns account-plane policy, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "repository": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

`apply` type Run requests reference the reviewed `plan` type Run returned by the plan step. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
