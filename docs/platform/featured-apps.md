# おすすめアプリ

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Create a Capsule from a Git URL/ref pointing at an OpenTofu Capsule.
2. Trigger a **`plan` type Run** and review the recorded plan, changes, and warnings before approval.
3. Apply the reviewed plan as an **`apply` type Run**. A successful apply records StateVersion and Output.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to an explicit provider connection (an explicit ProviderConnection), and policy resolves provider allowlists, state backend, and Cloudflare Container execution used by each run.
5. Infrastructure lifecycle credentials, OIDC clients, billing, domains, and account-plane policy belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records the Capsule, `plan` Run, `apply` Run, StateVersion, and Output run ledger. Takosumi Accounts plane owns account-plane policy such as accounts, billing, OIDC, and dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "source": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

A Capsule references the OpenTofu Capsule repo; a `plan` type Run records the plan, then an `apply` type Run applies
the reviewed plan. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane
install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
