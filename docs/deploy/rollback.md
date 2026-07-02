# ロールバック

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Create a Capsule from a Git URL/ref pointing at the OpenTofu module.
2. Trigger a `plan` type Run and review its plan summary, diff, and policy decision.
3. Approve the reviewed plan to start an `apply` type Run; a successful `apply` type Run updates the StateVersion and Output.
4. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit provider connection, and policy resolves provider allowlists, state backend, and Cloudflare Container execution used by each typed Runs.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, and domains belong to the Takosumi Accounts plane; Takosumi records the run ledger and audit trail.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records Run, StateVersion, Output, policy, and audit evidence and the audit trail. Takosumi Accounts plane owns account-plane policy, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

A `plan` type Run is reviewed before its plan is approved into an `apply` type Run. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

provider data copy / schema migration の巻き戻しは rollback の current guarantee ではありません。Rollback は Capsule の
retained successful StateVersion を基準に、新しい reviewed Run / StateVersion / Output を作る control-plane 操作です。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi model](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
