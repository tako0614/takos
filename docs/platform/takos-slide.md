# takos-slide

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module from a Git repository and records an **Installation**, then a **`plan` type Run** and **`apply` type Run** per run, with successful applies updating **Deployment** and **OutputSnapshot**. Repository metadata comes from generic information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref for the app's OpenTofu module.
2. Create an Installation and run a **`plan` type Run**; review the resolved commit, requested bindings, plan diff, and warnings.
3. Approve the reviewed plan to trigger an **`apply` type Run**; a successful apply updates **Deployment** and **OutputSnapshot**.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state and policy decisions. Takosumi or another operator distribution owns account-plane policy, billing, OIDC, and dashboard.

## Install Input Shape

```json
{
  "spaceId": "space_1",
  "git": {
    "url": "https://github.com/example/app.git",
    "ref": "v1.2.3"
  }
}
```

Takosumi resolves the requested ref to an immutable commit at `plan` type Run time, and the `apply` type Run applies the reviewed commit. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control plane](https://takosumi.com/docs/reference/model)
