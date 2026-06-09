# takos-excel

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repository as an **Installation** and records a run ledger of **`plan` type Run** → **`apply` type Run** → **Deployment** → **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref for the OpenTofu module repository.
2. Create a **`plan` type Run** and review its proposed changes, warnings, and policy decision before approving.
3. Approve the reviewed plan to start an **`apply` type Run**. A successful apply updates the **Deployment** and its **OutputSnapshot** snapshot.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, and Cloudflare Container execution that the run uses.
5. Account-plane policy, credentials, OIDC clients, billing, domains, and dashboard belong to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state under a Connection / ProviderBinding / policy. Takosumi Accounts or another operator distribution owns account-plane policy, billing, OIDC, and dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "git": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

`apply` type Run requests reference the reviewed `plan` type Run before applying. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
