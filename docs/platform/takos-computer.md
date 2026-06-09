# takos-computer

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records an **Installation**, a **`plan` type Run** for each plan, an **`apply` type Run** for each apply/destroy, and the resulting **Deployment** plus **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref pointing at a plain OpenTofu module.
2. Run a plan; Takosumi records a `plan` type Run with the reviewed plan, changes, and warnings.
3. Apply the reviewed plan; Takosumi records an `apply` type Run and, on success, updates the `Deployment` and its `OutputSnapshot`.
4. Destroy is recorded as an `apply` type Run against the same `Installation` so approvals stay tied to the current `Deployment`.
5. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, execution image, and Cloudflare Container execution; account-plane policy, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws` | `gcp` | `cloudflare`; the `cloudflare` target provisions the D1/KV/R2/Queues backing resources). Takosumi records Installation / Run / Deployment / OutputSnapshot and audit trail. Takosumi or another operator distribution owns account-plane policy, OIDC clients, billing, and domains.

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

An apply request references the reviewed `plan` type Run, and Takosumi records the resulting `apply` type Run, `Deployment`, and `OutputSnapshot`. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi deploy model](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
