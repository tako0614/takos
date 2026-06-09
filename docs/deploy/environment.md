# 環境変数

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records an **Installation**, then a **`plan` type Run**, an **`apply` type Run**, and a resulting **Deployment** plus **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Start a `plan` type Run and review the recorded plan, changes, warnings, and policy decision.
3. Approve the reviewed plan to start an `apply` type Run. A successful apply updates the Deployment and its OutputSnapshot.
4. Connections hold credential references, ProviderBindings resolve the connection for each provider (+ optional alias), and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, domains, and account-plane policy belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws` / `gcp` / `cloudflare`; the `cloudflare` target provisions the D1/KV/R2/Queues backing resources). Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state. Takosumi or another operator distribution owns account-plane policy and Connection / ProviderBinding / policy configuration.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "deploy/opentofu"
  }
}
```

An Installation starts a `plan` type Run; approving the recorded plan starts an `apply` type Run that updates the Deployment and OutputSnapshot. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
