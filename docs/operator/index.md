# オペレーター向けガイド

This page has been reset for Takosumi v1. Takosumi is the OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records a run ledger of **`plan` type Run**, **`apply` type Run**, **Deployment**, and **OutputSnapshot** entries. Installation display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref pointing at a plain OpenTofu module repo, and a Connection / ProviderBinding / policy.
2. Run a plan; Takosumi records a `plan` type Run with the reviewed plan, changes, warnings, and policy decision.
3. Apply the reviewed plan; Takosumi records an `apply` type Run, and a successful apply updates the `Deployment` and `OutputSnapshot`.
4. Destroy is recorded as an `apply` type Run against the same Installation, keeping the run ledger append-only.
5. Connections hold credential references, ProviderBindings bind each provider (plus optional alias) used by the module to a default / connection / manual / disabled resolution, and policy resolves provider allowlists, state backend, execution image/resource limits, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, domains, and implementation bindings belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws` | `gcp` | `cloudflare`; the `cloudflare` target provisions the D1/KV/R2/Queues backing resources). Takosumi records the Installation, `plan` type Run, `apply` type Run, Deployment, and OutputSnapshot run ledger. Connection / ProviderBinding / policy resolve the execution boundary, and the operator distribution owns account-plane policy and implementation bindings.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  },
  "deploymentProfileId": "profile_default"
}
```

A plan produces a `plan` type Run; applying the reviewed plan produces an `apply` type Run that updates the `Deployment` and `OutputSnapshot`. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
