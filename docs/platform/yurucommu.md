# yurucommu

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repository and records an **Installation**, then **`plan` type Run** and **`apply` type Run** entries, and on success a **Deployment** with its **OutputSnapshot**. Repository metadata comes from generic information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref for the OpenTofu module repository.
2. Create a `plan` type Run and review its proposed changes, warnings, and run ledger entry.
3. Apply the reviewed plan as an `apply` type Run, which records a Deployment and its OutputSnapshot on success.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for the run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, domains, and account-plane policy belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state and run ledger evidence. Takosumi or another operator distribution owns account-plane policy, billing, OIDC, and the dashboard.

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

`apply` type Run requests reference the reviewed `plan` type Run returned by the plan step. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/control-api)
