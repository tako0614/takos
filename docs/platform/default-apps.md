# バンドルアプリ

This page describes Takosumi v1. Takosumi is an OpenTofu-native deploy control plane that installs a plain OpenTofu module and records an **Installation**, typed **Run** entries, **StateSnapshot**, **OutputSnapshot**, and **Deployment** ledger. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Trigger a **`plan` type Run** and review the recorded plan, changes, and warnings before approval.
3. Apply the reviewed plan as an **`apply` type Run**. A successful apply updates the **Deployment** and its **OutputSnapshot**.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, and Cloudflare Container execution used by each run.
5. Infrastructure lifecycle credentials, OIDC clients, billing, domains, and account-plane policy belong to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the Installation, `plan` type Run, `apply` type Run, Deployment, and OutputSnapshot run ledger. Takosumi or another operator distribution owns account-plane policy such as accounts, billing, OIDC, and dashboard.

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

An Installation references the OpenTofu module repo; a `plan` type Run then records the plan an `apply` type Run applies. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
