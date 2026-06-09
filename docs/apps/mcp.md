# MCP Server

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module repo and records an **Installation**, typed **Run** entries, and a successful apply updates the **Deployment** and its **OutputSnapshot**. Repo metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref pointing at a plain OpenTofu module repo.
2. Create a **`plan` type Run** and review its diff, warnings, and policy decision.
3. Promote the reviewed plan to an **`apply` type Run**.
4. A successful apply updates the **Deployment** and records its **OutputSnapshot** in the audit ledger.
5. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, execution image / resource limits, and Cloudflare Container execution; account-plane policy, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state and run-ledger evidence. The operator distribution owns account-plane policy, OIDC clients, billing, and dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "repo": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

An `apply` type Run promotes a reviewed `plan` type Run. Takos product routes should call the Takosumi deploy control plane or the operator distribution account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
